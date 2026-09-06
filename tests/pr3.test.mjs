import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionPnl, checkAlertCross } from '../src/core.js';

/* ---------------- position P&L ---------------- */

test('positionPnl long', () => {
  assert.equal(positionPnl({ side: 'long', entry: 100 }, 110), 10);
  assert.equal(positionPnl({ side: 'long', entry: 100 }, 90), -10);
});

test('positionPnl short inverts', () => {
  assert.equal(positionPnl({ side: 'short', entry: 100 }, 90), 10);
  assert.equal(positionPnl({ side: 'short', entry: 100 }, 110), -10);
});

test('positionPnl scales with qty and defaults to 1', () => {
  assert.equal(positionPnl({ entry: 100, qty: 0.5 }, 110), 5);
  assert.equal(positionPnl({ entry: 100 }, 110), 10);
});

test('positionPnl guards invalid input', () => {
  assert.equal(positionPnl(null, 100), 0);
  assert.equal(positionPnl({ entry: 100 }, NaN), 0);
});

/* ---------------- alert crossing ---------------- */

test('checkAlertCross: above direction', () => {
  const a = { price: 100, direction: 'above' };
  assert.equal(checkAlertCross(a, 99, 101), true);
  assert.equal(checkAlertCross(a, 101, 102), false); // already above
  assert.equal(checkAlertCross(a, 99, 99.5), false); // didn't reach
  assert.equal(checkAlertCross(a, 101, 99), false); // falling through
});

test('checkAlertCross: below direction', () => {
  const a = { price: 100, direction: 'below' };
  assert.equal(checkAlertCross(a, 101, 99), true);
  assert.equal(checkAlertCross(a, 99, 98), false);
  assert.equal(checkAlertCross(a, 99, 101), false);
});

test('checkAlertCross: default crosses both ways, touch counts as start not fire', () => {
  const a = { price: 100 };
  assert.equal(checkAlertCross(a, 99, 101), true);
  assert.equal(checkAlertCross(a, 101, 99), true); // cross fires both directions
  assert.equal(checkAlertCross(a, 100, 101), true); // touch → above fires
  assert.equal(checkAlertCross(a, 99, 100), false); // touch only, not beyond
});

test('checkAlertCross: guards', () => {
  assert.equal(checkAlertCross(null, 1, 2), false);
  assert.equal(checkAlertCross({ price: 1 }, NaN, 2), false);
  assert.equal(checkAlertCross({ price: 1 }, 1, NaN), false);
});
