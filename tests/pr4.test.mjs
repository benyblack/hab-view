import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, HOUR } from '../src/core.js';

const bars = (closes, dtMs = HOUR) =>
  closes.map((c, i) => ({
    time: i * dtMs,
    open: c, high: c, low: c, close: c,
    volume: i % 2 === 0 ? 100 : 300,
  }));

test('computeStats: basic change, range, up/dn counts', () => {
  const s = computeStats(bars([100, 102, 101, 103]), 0, 3, HOUR);
  assert.equal(s.n, 4);
  assert.ok(Math.abs(s.changePct - 3) < 1e-9);
  assert.equal(s.min, 100);
  assert.equal(s.max, 103);
  assert.equal(s.up, 2);
  assert.equal(s.dn, 1);
  assert.equal(s.avgVolume, 200); // (100+300+100+300)/4
});

test('computeStats: max drawdown tracks running peak', () => {
  // peak 120 → 96 is a 20% drawdown, later recovery doesn't reduce it
  const s = computeStats(bars([100, 120, 96, 110]), 0, 3, HOUR);
  assert.ok(Math.abs(s.maxDDPct - 20) < 1e-9);
});

test('computeStats: constant series has zero vol and drawdown', () => {
  const s = computeStats(bars([50, 50, 50, 50]), 0, 3, HOUR);
  assert.equal(s.changePct, 0);
  assert.equal(s.maxDDPct, 0);
  assert.equal(s.annVolPct, 0);
  assert.equal(s.up, 3); // flat closes count as up (>= prev)
});

test('computeStats: annualized vol scales with interval', () => {
  const noisy = Array.from({ length: 50 }, (_, i) => 100 * (1 + 0.01 * ((i % 2) ? 1 : -1)));
  const hourly = computeStats(bars(noisy, HOUR), 0, 49, HOUR);
  const daily = computeStats(bars(noisy, 24 * HOUR), 0, 49, 24 * HOUR);
  assert.ok(hourly.annVolPct > 0);
  // same per-bar variance, more bars per year → higher annualization factor
  assert.ok(hourly.annVolPct > daily.annVolPct);
});

test('computeStats: guards', () => {
  assert.equal(computeStats(bars([1, 2, 3]), 0, 0, HOUR), null); // n < 2
  assert.equal(computeStats([], 0, 1, HOUR), null);
  assert.equal(computeStats(bars([1, 2]), 5, 1, HOUR), null); // out of range
});
