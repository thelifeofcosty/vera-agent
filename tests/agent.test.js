const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../js/agent.js');
const { MERCHANTS, AREA_ALIASES } = require('../js/data.js');

const TODAY = '2026-11-24';
const ctx = (extra) => Object.assign(
  { merchants: MERCHANTS, bookings: [], location: 'Ginza', today: TODAY, areaAliases: AREA_ALIASES },
  extra
);
const parse = (text) => V.parsePrompt(text, { areaAliases: AREA_ALIASES });

test('parses the example prompt from the pitch', () => {
  const r = parse("I'm looking for a guided tour for 4 people around 12 PM and our budget is under £40 per person.");
  assert.equal(r.partySize, 4);
  assert.equal(r.time, '12:00');
  assert.equal(r.category, 'tour');
  assert.equal(r.budget.perPerson, 40);
  assert.equal(r.autonomous, false);
});

test('parses times, areas, totals, currencies and autonomy', () => {
  assert.equal(parse('dinner at 7:30pm').time, '19:30');
  assert.equal(parse('table at 19:00').time, '19:00');
  assert.equal(parse('lunch').time, '12:30');
  assert.equal(parse('ramen in Harajuku').area, 'Shibuya');
  assert.equal(parse('something tomorrow').dayOffset, 1);
  assert.equal(parse('dinner for 2 under £100 in total').budget.perPerson, 50);
  assert.equal(parse('walk under 5000 yen').budget.perPerson, 26);
  assert.equal(parse('a table for 12 pm').partySize, 1, '"for 12 pm" is a time, not a party size');
  assert.equal(parse('sushi tonight, just book it').autonomous, true);
  assert.deepEqual(parse('vegan lunch').dietary, ['vegan']);
  assert.deepEqual(parse('wheelchair accessible tour').access, ['step-free']);
});

test('only ever returns merchants that accept Visa', () => {
  const res = V.search(parse('ramen in Ginza'), ctx());
  assert.ok(res.options.length > 0);
  for (const o of res.options) assert.equal(o.merchant.acceptsVisa, true);
  assert.ok(!res.options.some((o) => o.merchant.id === 'm08'), 'cash-only stand is excluded');
});

test('respects budget, dietary and access filters', () => {
  const res = V.search(parse('guided tour for 4 around 12pm under £40 per person'), ctx());
  assert.ok(res.options.length > 0);
  for (const o of res.options) {
    assert.ok(o.perPerson <= 40);
    assert.equal(o.merchant.category, 'tour');
  }
  const vegan = V.search(parse('vegan lunch'), ctx());
  assert.deepEqual(vegan.options.map((o) => o.merchant.id), ['m07']);

  const tooCheap = V.search(parse('step-free walk under £10'), ctx());
  assert.equal(tooCheap.options.length, 0);
  assert.ok(tooCheap.notes.length > 0, 'explains why nothing was found');
});

test('respects capacity: a full slot is not offered again', () => {
  const req = parse('rickshaw tour in Asakusa for 4 at 12pm');
  const first = V.search(req, ctx());
  const pick = first.options.find((o) => o.merchant.id === 'm09');
  assert.equal(pick.time, '12:00');

  const booking = V.processPayment(V.createBooking(pick, req, 'hands-on'), { spendLimit: 500, authorised: true });
  const second = V.search(req, ctx({ bookings: [booking] }));
  const again = second.options.find((o) => o.merchant.id === 'm09');
  assert.ok(!again || again.time !== '12:00');
});

test('payment: pays within limit, holds above limit or without authorisation', () => {
  const req = parse('sushi dinner for 2 in Ginza');
  const opt = V.search(req, ctx()).options.find((o) => o.merchant.id === 'm01'); // £85pp, prepay

  const paid = V.processPayment(V.createBooking(opt, req, 'autonomous'), { spendLimit: 500, authorised: true });
  assert.equal(paid.status, 'confirmed');
  assert.match(paid.confirmation, /^VERA-[A-Z0-9]{6}$/);
  assert.equal(paid.payment.amount, 170);

  const held = V.processPayment(V.createBooking(opt, req, 'autonomous'), { spendLimit: 100, authorised: true });
  assert.equal(held.status, 'awaiting_approval');
  assert.equal(held.payment, null);

  const approved = V.processPayment(held, { spendLimit: 100, authorised: true, overrideLimit: true });
  assert.equal(approved.status, 'confirmed');

  const noAuto = V.processPayment(V.createBooking(opt, req, 'autonomous'), { spendLimit: 500, authorised: false });
  assert.equal(noAuto.status, 'awaiting_approval');
});

test('no payment is taken when the merchant does not require prepayment', () => {
  const req = parse('tempura dinner in Ginza');
  const opt = V.search(req, ctx()).options.find((o) => o.merchant.id === 'm04');
  const b = V.processPayment(V.createBooking(opt, req, 'hands-on'), { spendLimit: 0, authorised: false });
  assert.equal(b.status, 'confirmed');
  assert.equal(b.payment, null);
});

test('cancellation follows the merchant policy (UC-003)', () => {
  const pay = (text, id) => {
    const req = parse(text);
    const opt = V.search(req, ctx()).options.find((o) => o.merchant.id === id);
    return V.processPayment(V.createBooking(opt, req, 'hands-on'), { spendLimit: 500, authorised: true });
  };

  const free = V.cancelBooking(pay('walking tour in Ginza', 'm02'));
  assert.equal(free.ok, true);
  assert.equal(free.booking.status, 'cancelled');
  assert.equal(free.booking.payment.refunded, true);

  const strict = V.cancelBooking(pay('sushi in Ginza', 'm01'));
  assert.equal(strict.ok, false);
  assert.equal(strict.booking.status, 'confirmed');
});

test('learns from ratings and ranks liked things higher', () => {
  const liked = { status: 'confirmed', category: 'tour', tags: ['history'], rating: 5 };
  const disliked = { status: 'confirmed', category: 'tour', tags: ['food'], rating: 1 };
  const prefs = V.learnPreferences([liked, disliked]);
  assert.ok(prefs.history > 0);
  assert.ok(prefs.food < 0);

  const req = parse('tour in Ginza');
  const before = V.search(req, ctx()).options.map((o) => o.merchant.id);
  const after = V.search(req, ctx({ bookings: [liked, disliked] })).options.map((o) => o.merchant.id);
  assert.equal(after[0], 'm02', 'history tour ranks first after a 5-star history booking');
  assert.ok(before.length === after.length);
});
