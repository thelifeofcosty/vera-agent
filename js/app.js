/* VERA demo UI. All agent logic lives in agent.js; this file only wires it to the page. */
(function () {
  'use strict';

  const { MERCHANTS, AREAS, AREA_ALIASES } = window.VeraData;
  const V = window.Vera;
  const STORE_KEY = 'vera-demo-v1';

  const DEFAULT_STATE = {
    mode: 'hands-on',
    settings: { location: 'Ginza', spendLimit: 200, autoPay: true, speak: false },
    bookings: [],
  };

  const EXAMPLES = [
    "I'm looking for a guided tour for 4 people around 12 PM, budget under £40 per person",
    'Vegan lunch for two',
    'Sushi-making class in Shibuya tomorrow afternoon',
    'Dinner for 2 under £100 in total, just book it',
    'Step-free walk in Shinjuku this morning',
  ];

  // ---------------------------------------------------------------- state

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        return {
          mode: saved.mode || DEFAULT_STATE.mode,
          settings: Object.assign({}, DEFAULT_STATE.settings, saved.settings),
          bookings: Array.isArray(saved.bookings) ? saved.bookings : [],
        };
      }
    } catch (e) { /* storage unavailable: run in memory */ }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  const todayISO = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  const merchantById = (id) => MERCHANTS.find((m) => m.id === id);

  // ------------------------------------------------------------- DOM utils

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const $ = (sel) => document.querySelector(sel);
  const messages = $('#messages');

  function scrollDown() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  function say(text) {
    if (!state.settings.speak || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch (e) { /* ignore */ }
  }

  function addUser(text) {
    messages.append(el('div', { class: 'msg user' }, text));
    scrollDown();
  }

  function addAgent(...children) {
    const node = el('div', { class: 'msg agent' }, ...children);
    messages.append(node);
    scrollDown();
    return node;
  }

  // ------------------------------------------------------------ chat flow

  function handlePrompt(text) {
    addUser(text);
    const req = V.parsePrompt(text, { areaAliases: AREA_ALIASES });
    const result = V.search(req, {
      merchants: MERCHANTS,
      bookings: state.bookings,
      location: state.settings.location,
      today: todayISO(),
      areaAliases: AREA_ALIASES,
    });
    const autonomous = state.mode === 'autonomous' || req.autonomous;

    const header = [
      el('p', { class: 'understood' }, 'I understood: ' + V.describeRequest(req, result.area)),
      el('details', { class: 'steps' },
        el('summary', {}, 'How I searched'),
        el('ol', {}, result.steps.map((s) => el('li', {}, s)))),
      result.notes.map((n) => el('p', { class: 'note' }, n)),
    ];

    if (!result.options.length) {
      const msg = "I couldn't find anything that fits. Try a different time, area or budget.";
      addAgent(header, el('p', {}, msg));
      say(msg);
      return;
    }

    if (autonomous) {
      const best = result.options[0];
      const booking = book(best, req, 'autonomous', state.settings.autoPay);
      const others = result.options.length - 1;
      const msg = bookingSentence(booking);
      addAgent(header,
        el('p', {}, 'Autonomous mode: I picked the best match. ' + msg),
        optionCard(best, null),
        others ? el('p', { class: 'understood' }, 'I also considered ' + others + ' other option' + (others > 1 ? 's' : '') + '. You can cancel this in Bookings if you change your mind.') : null);
      say(msg);
      return;
    }

    const intro = 'Here are ' + result.options.length + ' option' + (result.options.length > 1 ? 's' : '') + ". Pick one and I'll book it.";
    const node = addAgent(header, el('p', {}, intro));
    const list = el('div', { class: 'options' });
    for (const opt of result.options) {
      list.append(optionCard(opt, () => {
        node.querySelectorAll('.options button').forEach((b) => { b.disabled = true; });
        const booking = book(opt, req, 'hands-on', true);
        const msg = bookingSentence(booking);
        addAgent(el('p', {}, msg));
        say(msg);
      }));
    }
    node.append(list);
    say(intro);
  }

  function book(option, req, mode, authorised) {
    let booking = V.createBooking(option, req, mode);
    booking = V.processPayment(booking, { spendLimit: state.settings.spendLimit, authorised });
    state.bookings.push(booking);
    save();
    renderBookings();
    return booking;
  }

  function bookingSentence(b) {
    const when = (b.date === todayISO() ? 'today' : b.date) + ' at ' + b.time;
    if (b.status === 'awaiting_approval') {
      return 'I\'ve held ' + b.merchantName + ' for ' + b.partySize + ' ' + when + ', but the ' + V.money(b.total) +
        ' payment needs your approval in Bookings.';
    }
    const paid = b.payment ? ' Paid ' + V.money(b.total) + ' securely.' : ' Pay at the venue.';
    return 'Booked ' + b.merchantName + ' for ' + b.partySize + ' ' + when + '.' + paid + ' Confirmation ' + b.confirmation + '.';
  }

  function optionCard(opt, onBook) {
    const m = opt.merchant;
    const label = m.prepay ? 'Book & pay ' + V.money(opt.total) : 'Reserve (pay at venue)';
    return el('article', { class: 'option' },
      el('h3', {}, m.name),
      el('div', { class: 'meta' },
        m.area + ' · ' + m.category + ' · ' + opt.time + ' · ' + opt.partySize + (opt.partySize === 1 ? ' person' : ' people') +
        ' · ' + (m.cancellation === 'free' ? 'free cancellation' : 'non-refundable')),
      el('p', { class: 'blurb' }, m.blurb),
      el('ul', {}, opt.reasons.map((r) => el('li', {}, r))),
      el('div', { class: 'row' },
        el('span', { class: 'price' }, V.money(opt.perPerson) + ' pp · ' + V.money(opt.total) + ' total'),
        onBook ? el('button', { type: 'button', class: 'primary', onclick: onBook }, label) : null));
  }

  // -------------------------------------------------------------- bookings

  const STATUS_LABEL = { confirmed: 'Confirmed', awaiting_approval: 'Needs approval', cancelled: 'Cancelled', held: 'Held' };

  function replaceBooking(updated) {
    state.bookings = state.bookings.map((b) => (b.id === updated.id ? updated : b));
    save();
    renderBookings();
  }

  function renderBookings() {
    const root = $('#bookings');
    root.replaceChildren();
    const active = state.bookings.filter((b) => b.status !== 'cancelled').length;
    $('#booking-count').textContent = active ? String(active) : '';

    if (!state.bookings.length) {
      root.append(el('p', { class: 'empty' }, 'No bookings yet. Ask VERA for something in the Chat tab.'));
      return;
    }

    const sorted = state.bookings.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    for (const b of sorted) {
      const actions = el('div', { class: 'actions' });

      if (b.status === 'awaiting_approval') {
        actions.append(el('button', {
          type: 'button', class: 'primary',
          onclick: () => replaceBooking(V.processPayment(b, { spendLimit: state.settings.spendLimit, authorised: true, overrideLimit: true })),
        }, 'Approve ' + V.money(b.total)));
      }
      if (b.status !== 'cancelled') {
        actions.append(el('button', {
          type: 'button', class: 'secondary',
          onclick: () => {
            const policy = b.payment && b.cancellation !== 'free' ? ' This merchant is non-refundable, so cancellation may be refused.' : '';
            if (!window.confirm('Cancel ' + b.merchantName + '?' + policy)) return;
            const res = V.cancelBooking(b);
            replaceBooking(res.booking);
            window.alert(res.message);
          },
        }, 'Cancel'));
      }
      if (b.status === 'confirmed') {
        const stars = el('span', { class: 'stars', 'aria-label': 'Rate this experience' });
        for (let i = 1; i <= 5; i++) {
          stars.append(el('button', {
            type: 'button', class: b.rating >= i ? 'on' : '', 'aria-label': i + ' star' + (i > 1 ? 's' : ''),
            onclick: () => replaceBooking(V.rateBooking(b, i)),
          }, '★'));
        }
        actions.append(stars);
      }

      root.append(el('article', { class: 'booking' },
        el('h3', {}, b.merchantName, el('span', { class: 'badge ' + b.status }, STATUS_LABEL[b.status] || b.status)),
        el('div', { class: 'meta' },
          b.date + ' at ' + b.time + ' · ' + b.partySize + (b.partySize === 1 ? ' person' : ' people') + ' · ' + b.area),
        el('div', { class: 'meta' },
          V.money(b.total) + ' · ' +
          (b.payment ? (b.payment.refunded ? 'refunded' : 'paid via ' + b.payment.method) : b.prepay ? 'not paid yet' : 'pay at venue') +
          (b.confirmation ? ' · ' + b.confirmation : '') + ' · booked in ' + b.mode + ' mode'),
        actions,
        el('details', { class: 'log' },
          el('summary', {}, 'Agent log (incident report)'),
          el('ol', {}, b.log.map((l) => el('li', {}, new Date(l.at).toLocaleTimeString() + ': ' + l.msg))))));
    }
  }

  // ------------------------------------------------------------- settings

  function renderSettings() {
    const form = $('#settings');
    const loc = $('#location');
    loc.replaceChildren(...AREAS.map((a) => el('option', { value: a }, a + ', Tokyo')));
    loc.value = state.settings.location;
    form.spendLimit.value = state.settings.spendLimit;
    form.autoPay.checked = state.settings.autoPay;
    form.speak.checked = state.settings.speak;
  }

  $('#settings').addEventListener('change', (e) => {
    const f = e.currentTarget;
    state.settings = {
      location: f.location.value,
      spendLimit: Math.max(0, Number(f.spendLimit.value) || 0),
      autoPay: f.autoPay.checked,
      speak: f.speak.checked,
    };
    save();
  });

  $('#reset').addEventListener('click', () => {
    if (!window.confirm('Delete all demo bookings and settings?')) return;
    state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    save();
    renderSettings();
    renderBookings();
    setMode(state.mode);
    messages.replaceChildren();
    greet();
  });

  // ---------------------------------------------------------- mode & tabs

  function setMode(mode) {
    state.mode = mode;
    save();
    document.querySelectorAll('.mode button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  }
  document.querySelectorAll('.mode button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  function showTab(name) {
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
  }
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // -------------------------------------------------------------- composer

  const input = $('#prompt');
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    handlePrompt(text);
  });

  $('#examples').append(...EXAMPLES.map((x) => el('button', {
    type: 'button', class: 'chip', onclick: () => { input.value = x; input.focus(); },
  }, x)));

  // Voice input (speech-to-text) where the browser supports it.
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (Recognition) {
    const mic = $('#mic');
    mic.hidden = false;
    let rec = null;
    mic.addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      rec = new Recognition();
      rec.lang = 'en-GB';
      rec.interimResults = false;
      rec.onresult = (e) => { input.value = e.results[0][0].transcript; };
      rec.onend = () => {
        mic.classList.remove('listening');
        rec = null;
        if (input.value.trim()) $('#composer').requestSubmit();
      };
      rec.onerror = () => { /* onend still fires */ };
      mic.classList.add('listening');
      rec.start();
    });
  }

  // ------------------------------------------------------------------ boot

  function greet() {
    addAgent(
      el('p', {}, "Hi, I'm VERA. Tell me what you'd like to do and I'll find it, book it and, if needed, pay for it."),
      el('p', { class: 'understood' },
        'Hands-on mode: I suggest, you choose. Autonomous mode: I book the best match for you (or add "just book it" to any request). ' +
        'You are in ' + state.settings.location + ', Tokyo. Change that in Settings.'));
  }

  renderSettings();
  renderBookings();
  setMode(state.mode);
  greet();
})();
