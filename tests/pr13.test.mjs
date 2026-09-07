import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceToFreq } from '../src/core.js';

test('priceToFreq maps linearly across the scale', () => {
  const s = { min: 100, max: 200 };
  assert.equal(priceToFreq(100, s, 180, 880), 180);
  assert.equal(priceToFreq(200, s, 180, 880), 880);
  assert.equal(priceToFreq(150, s, 180, 880), 530);
});

test('priceToFreq clamps out-of-range prices', () => {
  const s = { min: 100, max: 200 };
  assert.equal(priceToFreq(50, s, 180, 880), 180);
  assert.equal(priceToFreq(999, s, 180, 880), 880);
});

test('priceToFreq maps through log space when useLog', () => {
  // in log mode the scale bounds are already log10 values (2 → 3)
  const s = { min: 2, max: 3, useLog: true };
  // log-mid price 316.2 sits at the frequency midpoint
  const mid = priceToFreq(316.22776601683796, s, 180, 880);
  assert.ok(Math.abs(mid - 530) < 1);
  assert.equal(priceToFreq(100, s, 180, 880), 180);
  assert.equal(priceToFreq(1000, s, 180, 880), 880);
});

test('priceToFreq guards degenerate scales', () => {
  assert.equal(priceToFreq(5, null, 180, 880), 530); // no scale → midpoint
  assert.equal(priceToFreq(5, { min: 1, max: 1 }, 180, 880), 530); // flat
});
