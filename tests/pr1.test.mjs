import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOlderData, detectGaps, HOUR } from '../src/core.js';

const b = (time, close) => ({ time, open: close, high: close, low: close, close, volume: 1 });

test('mergeOlderData prepends strictly older bars', () => {
  const existing = [b(1000, 5), b(2000, 6)];
  const older = [b(500, 4), b(100, 3)];
  const { bars, added } = mergeOlderData(existing, older);
  assert.equal(added, 2);
  assert.deepEqual(bars.map((x) => x.time), [100, 500, 1000, 2000]);
});

test('mergeOlderData dedupes by time (existing wins)', () => {
  const existing = [b(1000, 5), b(2000, 6)];
  const older = [b(1000, 99), b(500, 4)]; // 1000 overlaps
  const { bars, added } = mergeOlderData(existing, older);
  assert.equal(added, 1);
  assert.equal(bars.find((x) => x.time === 1000).close, 5); // existing kept
});

test('mergeOlderData ignores newer or same-time bars', () => {
  const existing = [b(1000, 5)];
  const { bars, added } = mergeOlderData(existing, [b(1500, 9), b(1000, 9)]);
  assert.equal(added, 0);
  assert.equal(bars, existing); // untouched, same reference
});

test('mergeOlderData sorts unsorted older input', () => {
  const existing = [b(1000, 5)];
  const { bars, added } = mergeOlderData(existing, [b(300, 2), b(100, 1), b(600, 3)]);
  assert.equal(added, 3);
  assert.deepEqual(bars.map((x) => x.time), [100, 300, 600, 1000]);
});

test('mergeOlderData handles empty/invalid input', () => {
  assert.deepEqual(mergeOlderData([b(1, 1)], []), { bars: [b(1, 1)], added: 0 });
  // null / NaN-time bars are ignored; a strictly-older bar still lands
  const { bars, added } = mergeOlderData([b(1, 1)], [null, { time: NaN }, b(0.5, 2)]);
  assert.equal(added, 1);
  assert.equal(bars[0].time, 0.5);
});

test('detectGaps finds interval jumps above threshold', () => {
  // 1h bars with one 6h hole at index 3 and a 2h hole (below threshold) at 6
  const bars = [];
  let t = 0;
  for (let i = 0; i < 10; i++) {
    if (i === 3) t += 6 * HOUR;
    else if (i === 6) t += 2 * HOUR; // only 2× dt → not a gap at threshold 3
    else t += HOUR;
    bars.push(b(t, 1));
  }
  const gaps = detectGaps(bars, 0, 9, HOUR, 3);
  assert.deepEqual(gaps, [3]);
});

test('detectGaps respects visible range and degenerate dt', () => {
  const bars = [b(0, 1), b(HOUR * 10, 1), b(HOUR * 20, 1)];
  assert.deepEqual(detectGaps(bars, 0, 2, HOUR, 3), [1, 2]);
  // gap at index 1 is outside the range; the jump *into* index 2 still counts
  assert.deepEqual(detectGaps(bars, 2, 2, HOUR, 3), [2]);
  assert.deepEqual(detectGaps(bars, 0, 0, HOUR, 3), []);
  // dt = 0 falls back to HOUR baseline, should not throw
  assert.deepEqual(detectGaps(bars, 0, 2, 0, 3), [1, 2]);
});
