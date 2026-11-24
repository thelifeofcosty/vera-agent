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
    'Guided tour for 4 around 12 PM, under £40 per person',
    'Vegan lunch for two',
    'Sushi-making class in Shibuya tomorrow afternoon',
    'Dinner for 2 under £100 in total, just book it',
    'Step-free walk in Shinjuku this morning',
  ];

  // Picture for each merchant card (falls back to the category).
  const ICONS = {
    m01: '🍣', m02: '🏯', m03: '🐟', m04: '🍤', m05: '🎭', m06: '🍵', m07: '🥗', m08: '🍜',
    m09: '🛺', m10: '👘', m11: '🍢', m12: '🌃', m13: '🍜', m14: '🍱', m15: '🏮', m16: '🌿',
  };
  const CATEGORY_ICON = { tour: '🗺️', restaurant: '🍽️', class: '🎨', culture: '🎭' };
  const iconFor = (id, category) => ICONS[id] || CATEGORY_ICON[category] || '✨';

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

  function friendlyDate(iso) {
    if (iso === todayISO()) return 'Today';
    if (iso === V.addDays(todayISO(), 1)) return 'Tomorrow';
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

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
  const scroller = $('#scroller');

  function scrollDown() {
    requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
  }

  let toastTimer = null;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  /** A button that needs a second tap to confirm (instead of a browser confirm dialog). */
  function confirmButton(label, armedLabel, className, onConfirm) {
    let timer = null;
    const btn = el('button', { type: 'button', class: className }, label);
    btn.addEventListener('click', () => {
      if (btn.classList.contains('armed')) {
        clearTimeout(timer);
        onConfirm();
        return;
      }
      btn.classList.add('armed');
      btn.textContent = armedLabel;
      timer = setTimeout(() => { btn.classList.remove('armed'); btn.textContent = label; }, 3000);
    });
    return btn;
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
    const body = el('div', { class: 'body' }, ...children);
    const node = el('div', { class: 'msg agent' }, el('span', { class: 'avatar', 'aria-hidden': 'true' }, 'V'), body);
    messages.append(node);
    scrollDown();
    return body;
  }

  function showTyping() {
    const node = el('div', { class: 'msg agent typing', 'aria-label': 'VERA is thinking' },
      el('span', { class: 'avatar', 'aria-hidden': 'true' }, 'V'),
      el('div', { class: 'body' }, el('i'), el('i'), el('i')));
    messages.append(node);
    scrollDown();
    return node;
  }

  // ------------------------------------------------------------ chat flow

  let busy = false;

  function handlePrompt(text) {
    if (busy) return;
    busy = true;
    addUser(text);
    const typing = showTyping();
    setTimeout(() => {
      typing.remove();
      busy = false;
      respond(text);
    }, 700);
  }

  function respond(text) {
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
      el('div', { class: 'understood', 'aria-label': 'What I understood' },
        V.describeRequest(req, result.area).split(' · ').map((p) => el('span', {}, p))),
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
        el('p', {}, el('strong', {}, 'Auto mode: '), msg),
        el('div', { class: 'options' }, optionCard(best, null)),
        others ? el('p', { class: 'muted' }, 'I compared ' + (others + 1) + ' options. You can cancel this in Bookings.') : null);
      say(msg);
      return;
    }

    const intro = 'Here ' + (result.options.length > 1 ? 'are ' + result.options.length + ' options' : 'is 1 option') + ". Pick one and I'll book it.";
    const body = addAgent(header, el('p', {}, intro));
    const list = el('div', { class: 'options' });
    for (const opt of result.options) {
      list.append(optionCard(opt, () => {
        body.querySelectorAll('.options button').forEach((b) => { b.disabled = true; });
        const booking = book(opt, req, 'hands-on', true);
        const msg = bookingSentence(booking);
        addAgent(el('p', {}, msg));
        say(msg);
      }));
    }
    body.append(list);
    scrollDown();
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
    const when = friendlyDate(b.date).toLowerCase() + ' at ' + b.time;
    if (b.status === 'awaiting_approval') {
      return 'I\'ve held ' + b.merchantName + ' for ' + b.partySize + ' ' + when + ', but the ' + V.money(b.total) +
        ' payment needs your approval in Bookings.';
    }
    const paid = b.payment ? ' Paid ' + V.money(b.total) + ' securely.' : ' Pay at the venue.';
    return '✅ Booked ' + b.merchantName + ' for ' + b.partySize + ' ' + when + '.' + paid + ' Confirmation ' + b.confirmation + '.';
  }

  function optionCard(opt, onBook) {
    const m = opt.merchant;
    const label = m.prepay ? 'Book · ' + V.money(opt.total) : 'Reserve';
    return el('article', { class: 'option' },
      el('div', { class: 'hero cat-' + m.category },
        el('span', { class: 'emoji', 'aria-hidden': 'true' }, iconFor(m.id, m.category)),
        el('span', { class: 'rating' }, '★ ' + m.rating.toFixed(1))),
      el('div', { class: 'content' },
        el('h3', {}, m.name),
        el('div', { class: 'meta' },
          m.area + ' · ' + opt.time + ' · ' + opt.partySize + (opt.partySize === 1 ? ' person' : ' people') +
          ' · ' + (m.cancellation === 'free' ? 'Free cancellation' : 'Non-refundable')),
        el('p', { class: 'blurb' }, m.blurb),
        el('ul', {}, opt.reasons.slice(1).map((r) => el('li', {}, r))),
        el('div', { class: 'row' },
          el('span', { class: 'price' }, V.money(opt.perPerson), el('small', {}, ' / person' + (m.prepay ? '' : ' · pay at venue'))),
          onBook ? el('button', { type: 'button', class: 'btn primary', onclick: onBook }, label) : null)));
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
      root.append(el('div', { class: 'empty' },
        el('div', { class: 'big', 'aria-hidden': 'true' }, '🎫'),
        el('strong', {}, 'No bookings yet'),
        'Ask VERA for something in Chat and it will show up here.'));
      return;
    }

    const order = (b) => (b.status === 'cancelled' ? '1' : '0') + b.date + b.time;
    const sorted = state.bookings.slice().sort((a, b) => order(a).localeCompare(order(b)));
    for (const b of sorted) {
      const actions = el('div', { class: 'actions' });

      if (b.status === 'awaiting_approval') {
        actions.append(el('button', {
          type: 'button', class: 'btn primary',
          onclick: () => {
            replaceBooking(V.processPayment(b, { spendLimit: state.settings.spendLimit, authorised: true, overrideLimit: true }));
            toast('Paid ' + V.money(b.total) + '. ' + b.merchantName + ' is confirmed.');
          },
        }, 'Approve ' + V.money(b.total)));
      }
      if (b.status !== 'cancelled') {
        const risky = b.payment && b.cancellation !== 'free';
        actions.append(confirmButton('Cancel', risky ? 'Non-refundable, try anyway?' : 'Tap to confirm', 'btn danger', () => {
          const res = V.cancelBooking(b);
          replaceBooking(res.booking);
          toast(res.message);
        }));
      }
      if (b.status === 'confirmed') {
        const stars = el('span', { class: 'stars', role: 'group', 'aria-label': 'Rate this experience' });
        for (let i = 1; i <= 5; i++) {
          stars.append(el('button', {
            type: 'button', class: b.rating >= i ? 'on' : '', 'aria-label': i + ' star' + (i > 1 ? 's' : ''),
            onclick: () => { replaceBooking(V.rateBooking(b, i)); toast('Thanks! VERA will use this for future suggestions.'); },
          }, '★'));
        }
        actions.append(stars);
      }

      const payment = b.payment
        ? (b.payment.refunded ? 'Refunded' : 'Paid ' + V.money(b.total))
        : b.prepay ? V.money(b.total) + ' due' : V.money(b.total) + ' at venue';

      root.append(el('article', { class: 'booking' + (b.status === 'cancelled' ? ' is-cancelled' : '') },
        el('div', { class: 'tile cat-' + b.category, 'aria-hidden': 'true' }, iconFor(b.merchantId, b.category)),
        el('div', {},
          el('div', { class: 'top' },
            el('h3', {}, b.merchantName),
            el('span', { class: 'badge ' + b.status }, STATUS_LABEL[b.status] || b.status)),
          el('div', { class: 'meta' },
            friendlyDate(b.date) + ', ' + b.time + ' · ' + b.partySize + (b.partySize === 1 ? ' person' : ' people') + ' · ' + b.area),
          el('div', { class: 'meta' },
            payment + (b.confirmation ? ' · ' + b.confirmation : '') + ' · ' + (b.mode === 'autonomous' ? 'Auto' : 'Hands-on'))),
        actions,
        el('details', { class: 'log' },
          el('summary', {}, 'Agent log'),
          el('ol', {}, b.log.map((l) => el('li', {},
            new Date(l.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ': ' + l.msg))))));
    }
  }

  // ------------------------------------------------------------- settings

  function renderSettings() {
    const form = $('#settings');
    const loc = $('#location');
    loc.replaceChildren(...AREAS.map((a) => el('option', { value: a }, a)));
    loc.value = state.settings.location;
    form.spendLimit.value = state.settings.spendLimit;
    form.autoPay.checked = state.settings.autoPay;
    form.speak.checked = state.settings.speak;
    $('#where-label').textContent = state.settings.location + ', Tokyo';
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
    $('#where-label').textContent = state.settings.location + ', Tokyo';
  });

  $('#reset').replaceWith(confirmButton('Reset demo data', 'Tap again to delete everything', 'btn danger wide', () => {
    state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    save();
    renderSettings();
    renderBookings();
    setMode(state.mode);
    messages.replaceChildren();
    greet();
    showTab('chat');
    toast('Demo data reset.');
  }));

  // ---------------------------------------------------------- mode & tabs

  function setMode(mode) {
    state.mode = mode;
    save();
    document.querySelectorAll('.mode button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  }
  document.querySelectorAll('.mode button').forEach((b) => b.addEventListener('click', () => {
    setMode(b.dataset.mode);
    toast(b.dataset.mode === 'autonomous'
      ? 'Auto mode: VERA books the best match for you.'
      : 'Hands-on mode: VERA suggests, you choose.');
  }));

  function showTab(name) {
    document.querySelectorAll('.tabbar button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
    $('#dock').hidden = name !== 'chat';
    if (name === 'chat') scrollDown(); else scroller.scrollTop = 0;
  }
  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#where').addEventListener('click', () => { showTab('settings'); $('#location').focus(); });

  // -------------------------------------------------------------- composer

  const input = $('#prompt');
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
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
      el('p', {}, el('strong', {}, "Hi, I'm VERA 👋 "),
        "Tell me what you'd like to do and I'll find it, book it and, if needed, pay for it."),
      el('p', { class: 'muted' },
        'Hands-on: I suggest, you choose. Auto: I book the best match (or add "just book it"). ' +
        'This is a demo: all bookings and payments are simulated.'));
  }

  renderSettings();
  renderBookings();
  setMode(state.mode);
  greet();
})();
