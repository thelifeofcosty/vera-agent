/*
 * VERA agent core: pure functions, no DOM. Runs in the browser and in Node (for tests).
 *
 * The three holons from the design map onto:
 *   1. Discover  -> parsePrompt() + search()      (find Visa-accepting merchants that fit the prompt)
 *   2. Select    -> search() ranking + learnPreferences()   (personalise the shortlist)
 *   3. Pay       -> createBooking() + processPayment()      (price-limit check, handshake, pay)
 * plus cancelBooking() / rateBooking() for UC-003 and the feedback loop.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Vera = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- helpers

  const NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };

  // Rough demo rates into GBP. A real build would use Visa's FX rates.
  const TO_GBP = { gbp: 1, usd: 0.79, eur: 0.85, jpy: 0.0052 };
  const CURRENCY_SYMBOL = { '£': 'gbp', $: 'usd', '€': 'eur', '¥': 'jpy' };
  const CURRENCY_WORD = {
    pound: 'gbp', pounds: 'gbp', gbp: 'gbp', quid: 'gbp',
    dollar: 'usd', dollars: 'usd', usd: 'usd',
    euro: 'eur', euros: 'eur', eur: 'eur',
    yen: 'jpy', jpy: 'jpy',
  };

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasWord = (text, word) =>
    new RegExp('(^|[^a-z])' + escapeRe(word) + 's?([^a-z]|$)').test(text);

  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (h, m) => pad(h) + ':' + pad(m || 0);
  const money = (n) => '£' + (Math.round(n * 100) / 100).toFixed(Number.isInteger(n) ? 0 : 2);

  function addDays(isoDate, days) {
    const d = new Date(isoDate + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function randomCode(len) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  // ------------------------------------------------------ prompt parsing

  function parsePartySize(t) {
    const n = '(\\d{1,2}|' + Object.keys(NUMBER_WORDS).join('|') + ')';
    const toNum = (s) => (NUMBER_WORDS[s] !== undefined ? NUMBER_WORDS[s] : parseInt(s, 10));

    let m = t.match(new RegExp('\\b' + n + '\\s+(?:people|persons|guests|adults|pax|of us)\\b'));
    if (m) return toNum(m[1]);
    m = t.match(new RegExp(
      '\\b(?:for|party of|group of|table for)\\s+' + n +
      '\\b(?!\\s*(?:am|pm|a\\.m|p\\.m|:|\\.\\d|o.?clock|hours?|mins?|minutes?|pounds|quid|gbp|yen|euros?|dollars?))'
    ));
    if (m) return toNum(m[1]);
    if (/\b(couple|for us two|the two of us|my partner and i|me and my partner)\b/.test(t)) return 2;
    return 1;
  }

  function parseTime(t) {
    let m = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.?|p\.m\.?)(?![a-z])/);
    if (m) {
      let h = parseInt(m[1], 10) % 12;
      if (m[3][0] === 'p') h += 12;
      return fmtTime(h, parseInt(m[2] || '0', 10));
    }
    m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (m) return fmtTime(parseInt(m[1], 10), parseInt(m[2], 10));

    const words = [
      [/\b(noon|midday)\b/, '12:00'],
      [/\bbreakfast\b/, '09:00'],
      [/\blunch\b/, '12:30'],
      [/\b(dinner|tonight|supper)\b/, '19:00'],
      [/\bevening\b/, '18:30'],
      [/\bafternoon\b/, '15:00'],
      [/\bmorning\b/, '10:00'],
      [/\bnight\b/, '20:00'],
    ];
    for (const [re, time] of words) if (re.test(t)) return time;
    return null;
  }

  function parseBudget(t, partySize) {
    const sym = '([£$€¥])?';
    const num = '(\\d+(?:[.,]\\d+)?)\\s*(k)?';
    const unit = '\\s*(pounds|quid|gbp|dollars?|usd|euros?|eur|yen|jpy)?';
    const lead = '(?:under|below|less than|max(?:imum)?(?: of)?|up to|within|no more than|at most|' +
      'budget(?: is| of)?(?: about| around)?|spend(?:ing)?(?: about| around)?)';

    let m = t.match(new RegExp(lead + '\\s*' + sym + '\\s*' + num + unit));
    if (!m) m = t.match(new RegExp('([£$€¥])\\s*' + num + unit));
    if (!m) m = t.match(new RegExp('()\\b' + num + '\\s*(pounds|quid|gbp|dollars?|usd|euros?|eur|yen|jpy)\\b'));
    if (!m) return null;

    let amount = parseFloat(m[2].replace(',', '.'));
    if (m[3]) amount *= 1000;
    const currency = CURRENCY_SYMBOL[m[1]] || CURRENCY_WORD[m[4]] || 'gbp';
    const gbp = amount * TO_GBP[currency];

    const isTotal = /\b(in total|total|altogether|overall|for all of us|for everyone|for the group)\b/.test(t);
    const perPerson = isTotal ? gbp / Math.max(1, partySize) : gbp;
    return {
      perPerson: Math.round(perPerson * 100) / 100,
      basis: isTotal ? 'total' : 'per person',
      original: { amount, currency },
    };
  }

  // Order matters: "sushi-making workshop" is a class, "food tour" is a tour.
  const CATEGORY_RULES = [
    ['class', /\b(class|classes|workshop|lesson|ceremony|making|cooking|course)\b/],
    ['culture', /\b(museum|gallery|kabuki|theatre|theater|show|performance|exhibition)\b/],
    ['tour', /\b(tour|tours|guided|guide|walk|walking|stroll|sightseeing|rickshaw)\b/],
    ['restaurant', /\b(restaurant|dinner|lunch|breakfast|brunch|eat|eating|food|meal|table|dine|dining|sushi|ramen|tempura|izakaya|yakitori|omakase)\b/],
  ];

  function parseCategory(t) {
    for (const [cat, re] of CATEGORY_RULES) if (re.test(t)) return cat;
    return null;
  }

  function parseDietary(t) {
    const out = [];
    if (/\bvegan\b/.test(t)) out.push('vegan');
    else if (/\bvegetarian|veggie\b/.test(t)) out.push('vegetarian');
    if (/\bgluten[- ]free|coeliac|celiac\b/.test(t)) out.push('gluten-free');
    return out;
  }

  function parseAccess(t) {
    return /\b(wheelchair|step[- ]free|accessible|accessibility|mobility|pushchair|stroller)\b/.test(t)
      ? ['step-free'] : [];
  }

  function parseArea(t, aliases) {
    for (const [word, area] of Object.entries(aliases || {})) {
      if (hasWord(t, word)) return area;
    }
    return null;
  }

  const AUTONOMOUS_RE =
    /\b(just book|book it|book one|book the best|book something|go ahead|you choose|you pick|you decide|choose for me|pick for me|surprise me|handle it|sort it out)\b/;

  /**
   * Turn a free-text (or transcribed voice) prompt into a structured request.
   */
  function parsePrompt(text, opts) {
    const options = opts || {};
    const raw = String(text || '').trim();
    const t = ' ' + raw.toLowerCase().replace(/[,!?;]/g, ' ').replace(/\s+/g, ' ') + ' ';
    const partySize = Math.min(Math.max(parsePartySize(t), 1), 20);
    return {
      raw,
      text: t,
      partySize,
      time: parseTime(t),
      dayOffset: /\btomorrow\b/.test(t) ? 1 : 0,
      budget: parseBudget(t, partySize),
      category: parseCategory(t),
      area: parseArea(t, options.areaAliases),
      dietary: parseDietary(t),
      access: parseAccess(t),
      autonomous: AUTONOMOUS_RE.test(t),
    };
  }

  const CATEGORY_LABEL = {
    tour: 'a tour', restaurant: 'a restaurant', class: 'a class or experience', culture: 'a show or cultural visit',
  };

  /** Human-readable summary of what the agent understood. */
  function describeRequest(req, area) {
    const parts = [CATEGORY_LABEL[req.category] || 'something to do'];
    parts.push(req.partySize === 1 ? '1 person' : req.partySize + ' people');
    parts.push((req.dayOffset ? 'tomorrow' : 'today') + (req.time ? ' around ' + req.time : ''));
    if (req.budget) parts.push('up to ' + money(req.budget.perPerson) + ' per person');
    if (area) parts.push('in ' + area);
    if (req.dietary.length) parts.push(req.dietary.join(', '));
    if (req.access.length) parts.push('step-free access');
    return parts.join(' · ');
  }

  // ------------------------------------------------ preferences (learning)

  /**
   * Learn tag weights from past bookings: every kept booking adds +1 to its tags and
   * category, and a rating shifts that by (stars - 3).
   */
  function learnPreferences(bookings) {
    const weights = {};
    for (const b of bookings || []) {
      if (b.status === 'cancelled') continue;
      const delta = 1 + (typeof b.rating === 'number' ? b.rating - 3 : 0);
      for (const tag of [b.category].concat(b.tags || [])) {
        weights[tag] = (weights[tag] || 0) + delta;
      }
    }
    return weights;
  }

  // ------------------------------------------------------------- search

  function bookedSeats(bookings, merchantId, date, time) {
    let n = 0;
    for (const b of bookings || []) {
      if (b.merchantId === merchantId && b.date === date && b.time === time && b.status !== 'cancelled') {
        n += b.partySize;
      }
    }
    return n;
  }

  function pickSlot(m, req, date, bookings) {
    const want = req.time ? toMinutes(req.time) : null;
    let best = null;
    for (const s of m.slots) {
      const left = m.capacity - bookedSeats(bookings, m.id, date, s);
      if (left < req.partySize) continue;
      const diff = want === null ? 0 : Math.abs(toMinutes(s) - want);
      if (want !== null && diff > 90) continue;
      if (!best || diff < best.diff || (diff === best.diff && toMinutes(s) < toMinutes(best.time))) {
        best = { time: s, diff, left };
      }
    }
    return best;
  }

  /**
   * Find, filter and rank options for a request.
   *
   * ctx = { merchants, bookings, location, today: 'YYYY-MM-DD', areaAliases }
   * Returns { area, date, options: [...], steps: [...], notes: [...] }
   */
  function search(req, ctx) {
    const merchants = ctx.merchants || [];
    const bookings = ctx.bookings || [];
    const date = addDays(ctx.today, req.dayOffset || 0);
    const prefs = learnPreferences(bookings);
    const steps = [];
    const notes = [];

    // Holon 1: discover. Only Visa-accepting merchants are eligible.
    let pool = merchants.filter((m) => m.acceptsVisa);
    const skipped = merchants.length - pool.length;
    steps.push('Checked ' + merchants.length + ' merchants in the directory; ' + pool.length + ' accept Visa' +
      (skipped ? ' (' + skipped + ' skipped)' : ''));

    let area = req.area || ctx.location || null;
    if (area) {
      const inArea = pool.filter((m) => m.area === area);
      if (inArea.length) {
        pool = inArea;
        steps.push(pool.length + ' are in ' + area + (req.area ? '' : ' (your current location)'));
      } else {
        notes.push('Nothing listed in ' + area + ', so I searched all of Tokyo.');
        area = null;
      }
    }

    const narrow = (label, fn) => {
      const next = pool.filter(fn);
      if (!next.length && pool.length) notes.push('Nothing left after filtering for ' + label + '.');
      pool = next;
      steps.push(label + ': ' + pool.length + ' left');
    };

    if (req.category) narrow(CATEGORY_LABEL[req.category].replace(/^an? /, ''), (m) => m.category === req.category);

    // Specific interests ("sushi", "temple", "walking") narrow further, but only if something matches.
    const vocab = Array.from(new Set(merchants.flatMap((m) => m.tags)));
    const mentioned = vocab.filter((tag) => hasWord(req.text || '', tag));
    if (mentioned.length) {
      const matching = pool.filter((m) => m.tags.some((tag) => mentioned.includes(tag)));
      if (matching.length) {
        pool = matching;
        steps.push('Matched your interests (' + mentioned.join(', ') + '): ' + pool.length + ' left');
      } else if (pool.length) {
        notes.push('Nothing here matches "' + mentioned.join(', ') + '" exactly, so these are the closest alternatives.');
      }
    }

    for (const d of req.dietary || []) narrow(d, (m) => m.dietary.includes(d));
    for (const a of req.access || []) narrow('step-free access', (m) => m.access.includes(a));

    if (req.budget) {
      const cap = req.budget.perPerson;
      const over = pool.filter((m) => m.price > cap);
      narrow('budget ' + money(cap) + ' per person', (m) => m.price <= cap);
      if (!pool.length && over.length) {
        const cheapest = over.reduce((a, b) => (a.price < b.price ? a : b));
        notes.push('The cheapest match is ' + cheapest.name + ' at ' + money(cheapest.price) + ' per person.');
      }
    }

    // Availability for the party size and time.
    const withSlots = [];
    for (const m of pool) {
      const slot = pickSlot(m, req, date, bookings);
      if (slot) withSlots.push({ m, slot });
    }
    if (pool.length && !withSlots.length) {
      notes.push('No free slots for ' + req.partySize + (req.time ? ' near ' + req.time : '') + '.');
    }
    steps.push('Checked live availability for ' + req.partySize + ': ' + withSlots.length + ' left');

    // Holon 2: select. Rank by rating, interest match, learned preferences, time fit, price.
    const options = withSlots.map(({ m, slot }) => {
      const reasons = [];
      let score = m.rating * 20;
      reasons.push(m.rating.toFixed(1) + '★ from ' + m.reviews.toLocaleString('en-GB') + ' reviews');

      const hits = m.tags.filter((tag) => mentioned.includes(tag));
      score += hits.length * 12;
      if (hits.length) reasons.push('Matches ' + hits.join(', '));

      let pref = 0;
      for (const tag of [m.category].concat(m.tags)) pref += prefs[tag] || 0;
      pref = Math.max(-10, Math.min(15, pref * 2));
      score += pref;
      if (pref > 0) reasons.push('Similar to things you have booked and liked');
      if (pref < 0) reasons.push('Ranked lower: similar to things you rated poorly');

      score -= slot.diff / 15;
      if (req.time) reasons.push(slot.diff === 0 ? 'Free at ' + slot.time : 'Closest free slot: ' + slot.time);

      if (req.budget) {
        score += (1 - m.price / req.budget.perPerson) * 5;
        reasons.push(money(m.price) + ' per person, within budget');
      }
      if (m.access.includes('step-free') && req.access.length) reasons.push('Step-free access');

      return {
        merchant: m,
        date,
        time: slot.time,
        partySize: req.partySize,
        perPerson: m.price,
        total: m.price * req.partySize,
        score: Math.round(score * 10) / 10,
        reasons,
      };
    });

    options.sort((a, b) => b.score - a.score);
    return { area, date, options: options.slice(0, 5), steps, notes, preferences: prefs };
  }

  // ---------------------------------------------------- booking & payment

  function createBooking(option, req, mode) {
    const m = option.merchant;
    return {
      id: 'bk_' + Date.now().toString(36) + randomCode(4),
      merchantId: m.id,
      merchantName: m.name,
      area: m.area,
      category: m.category,
      tags: m.tags.slice(),
      date: option.date,
      time: option.time,
      partySize: option.partySize,
      perPerson: option.perPerson,
      total: option.total,
      prepay: m.prepay,
      cancellation: m.cancellation,
      mode,
      prompt: req.raw,
      createdAt: new Date().toISOString(),
      status: 'held',
      confirmation: null,
      payment: null,
      rating: null,
      log: [
        { at: new Date().toISOString(), msg: 'Prompt received (' + mode + ' mode): "' + req.raw + '"' },
        { at: new Date().toISOString(), msg: 'Selected ' + m.name + ' for ' + option.partySize + ' at ' + option.time + ' on ' + option.date },
      ],
    };
  }

  function addLog(booking, msg) {
    booking.log.push({ at: new Date().toISOString(), msg });
  }

  /**
   * Holon 3: pay. Returns a new booking object (never mutates the input).
   *
   * opts.spendLimit       per-booking limit in GBP
   * opts.authorised       has the user allowed the agent to pay (hands-on click, or auto-pay setting)?
   * opts.overrideLimit    user explicitly approved a payment above the limit
   */
  function processPayment(booking, opts) {
    const b = JSON.parse(JSON.stringify(booking));
    const o = opts || {};

    if (!b.prepay) {
      b.status = 'confirmed';
      b.confirmation = b.confirmation || 'VERA-' + randomCode(6);
      addLog(b, 'Reservation confirmed with the merchant booking system. No prepayment needed: pay at the venue.');
      return b;
    }

    addLog(b, 'Price check: total ' + money(b.total) + ' vs your per-booking limit ' + money(o.spendLimit || 0));
    if (b.total > (o.spendLimit || 0) && !o.overrideLimit) {
      b.status = 'awaiting_approval';
      addLog(b, 'Over your limit. Booking held: waiting for you to approve the payment.');
      return b;
    }
    if (!o.authorised) {
      b.status = 'awaiting_approval';
      addLog(b, 'Auto-pay is off. Booking held: waiting for you to approve the payment.');
      return b;
    }

    addLog(b, 'Handshake (simulated): agent presented a signed agent credential to the merchant agent.');
    addLog(b, 'Handshake (simulated): merchant verified the signature and returned a payment request.');
    const token = 'tok_' + randomCode(12).toLowerCase();
    b.payment = {
      method: 'Click to Pay (simulated)',
      token,
      amount: b.total,
      currency: 'GBP',
      at: new Date().toISOString(),
      refunded: false,
    };
    addLog(b, 'Paid ' + money(b.total) + ' with a tokenised card (' + token + '). No card number shared with the merchant.');
    b.status = 'confirmed';
    b.confirmation = 'VERA-' + randomCode(6);
    addLog(b, 'Booking confirmed: ' + b.confirmation);
    return b;
  }

  /** UC-003. Returns { ok, booking, message }. Never mutates the input. */
  function cancelBooking(booking) {
    const b = JSON.parse(JSON.stringify(booking));
    if (b.status === 'cancelled') return { ok: false, booking: b, message: 'This booking is already cancelled.' };

    if (b.status === 'awaiting_approval' || !b.payment || b.cancellation === 'free') {
      b.status = 'cancelled';
      let message = 'Cancelled ' + b.merchantName + '.';
      if (b.payment) {
        b.payment.refunded = true;
        message += ' ' + money(b.payment.amount) + ' will be refunded to your card.';
      }
      addLog(b, message);
      return { ok: true, booking: b, message };
    }

    const message = b.merchantName + ' is non-refundable, so the booking stays active.';
    addLog(b, 'Cancellation refused by the merchant: ' + message);
    return { ok: false, booking: b, message };
  }

  function rateBooking(booking, stars) {
    const b = JSON.parse(JSON.stringify(booking));
    b.rating = Math.max(1, Math.min(5, Math.round(stars)));
    addLog(b, 'You rated this ' + b.rating + '/5. VERA will use this for future suggestions.');
    return b;
  }

  return {
    parsePrompt,
    describeRequest,
    search,
    learnPreferences,
    createBooking,
    processPayment,
    cancelBooking,
    rateBooking,
    money,
    addDays,
  };
});
