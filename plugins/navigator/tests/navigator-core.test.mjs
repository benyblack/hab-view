// wickchart-navigator — pure model: silhouette downsampling, window
// fractions, drag math. Plain data in / data out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { profile, windowFractions, dragWindow } from '../core.mjs';

const T0 = Date.UTC(2026, 2, 4);
const H = 3_600_000;
const bars = Array.from({ length: 100 }, (_, i) => ({
  time: T0 + i * H,
  open: 1, high: 110 + (i % 10), low: 90 - (i % 7), close: 100, volume: 1,
}));

test('profile: buckets cover the span with per-bucket low/high', () => {
  const prof = profile(bars, 50); // 2 bars per bucket
  assert.equal(prof.length, 50);
  for (const b of prof) {
    assert.ok(b, 'every bucket has bars here');
    assert.ok(b.lo < b.hi);
  }
  // bucket 0 = bars 0..1 → lo 89 (90−1), hi 111 (110+1)
  assert.equal(prof[0].lo, 89);
  assert.equal(prof[0].hi, 111);
  // global extremes survive downsampling
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of prof) {
    lo = Math.min(lo, b.lo);
    hi = Math.max(hi, b.hi);
  }
  assert.equal(lo, 84, '90 - (i % 7) min over i=0..99 is 84');
  assert.equal(hi, 119, '110 + (i % 10) max is 119');
});

test('profile: empty buckets, degenerate inputs', () => {
  const sparse = [
    { time: T0, high: 10, low: 5 },
    { time: T0 + 90 * H, high: 20, low: 15 },
  ];
  const prof = profile(sparse, 100);
  assert.equal(prof.length, 100);
  assert.deepEqual(prof[0], { lo: 5, hi: 10 });
  assert.deepEqual(prof[99], { lo: 15, hi: 20 }, 'the last bar lands in the last bucket');
  assert.equal(prof[90], null);
  assert.deepEqual(profile(bars, 0), []);
  assert.deepEqual(profile([], 10), [null, null, null, null, null, null, null, null, null, null]);
});

test('windowFractions: clamps pan/zoom overshoot to [0,1]', () => {
  const tLast = T0 + 99 * H;
  assert.deepEqual(windowFractions(T0, tLast, T0, tLast), [0, 1]);
  assert.deepEqual(windowFractions(T0, tLast, T0 + 10 * H, T0 + 59 * H), [10 / 99, 59 / 99]);
  assert.deepEqual(windowFractions(T0, tLast, T0 - 10 * H, T0 + 50 * H), [0, 50 / 99], 'past history clamps to 0');
  assert.deepEqual(windowFractions(T0, tLast, T0 + 90 * H, T0 + 200 * H), [90 / 99, 1], 'the future clamps to 1');
  assert.equal(windowFractions(T0, tLast, T0 + 50 * H, T0 + 49 * H), null, 'inverted window');
});

test('dragWindow: move keeps span and grab, edges resize, min span holds', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  // move: window [0.2, 0.5], grab at 0.05 inside → pointer at 0.6 shifts to [0.55, 0.85]
  let [a, b] = dragWindow(0.2, 0.5, 'move', 0.6, 0.05);
  assert.ok(near(a, 0.55) && near(b, 0.85));
  // clamped at both edges, span preserved
  [a, b] = dragWindow(0.2, 0.5, 'move', -1, 0.2);
  assert.deepEqual([a, b], [0, 0.3]);
  [a, b] = dragWindow(0.2, 0.5, 'move', 2, 0.1);
  assert.deepEqual([a, b], [0.7, 1]);
  // left edge drags right but never past the right edge minus min span
  assert.deepEqual(dragWindow(0.2, 0.5, 'l', 0.49), [0.49, 0.5]);
  [a, b] = dragWindow(0.2, 0.5, 'l', 0.9, 0, 0.01);
  assert.ok(near(a, 0.49) && near(b, 0.5));
  assert.deepEqual(dragWindow(0.2, 0.5, 'l', 0.1), [0.1, 0.5]);
  // right edge: grows/shrinks, capped at 1 and at min span
  assert.deepEqual(dragWindow(0.2, 0.5, 'r', 0.8), [0.2, 0.8]);
  assert.deepEqual(dragWindow(0.2, 0.5, 'r', 2), [0.2, 1]);
  [a, b] = dragWindow(0.2, 0.5, 'r', 0.1, 0, 0.01);
  assert.ok(near(a, 0.2) && near(b, 0.21));
  // unknown mode is a no-op
  assert.deepEqual(dragWindow(0.2, 0.5, 'x', 0.9), [0.2, 0.5]);
});
