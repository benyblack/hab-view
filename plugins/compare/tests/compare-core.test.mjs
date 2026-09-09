// wickchart-compare — the pure model: normalization, sampling/alignment,
// rebasing. Plain data in / data out, no chart involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SERIES, normalizeSeries, sampleAt, timeWindow, computeLine } from '../core.mjs';

const T0 = Date.UTC(2026, 2, 4);
const H = 3_600_000;
// closes 100 + i → pct(i, first) = i exactly
const ethBars = Array.from({ length: 100 }, (_, i) => ({ time: T0 + i * H, close: 100 + i }));
// value series 200 + 2i → ratio vs ethBars is a constant 0.5, diff is −100 − i
const valBars = Array.from({ length: 100 }, (_, i) => ({ time: T0 + i * H, value: 200 + 2 * i }));

/* ------------------------- normalizeSeries ------------------------- */

test('normalizeSeries: percent path, derived path, junk dropped, cap enforced', () => {
  const out = normalizeSeries([
    { label: ' ETH ', data: ethBars, color: '#0f0', width: 2 },
    { label: 'ratio', op: 'ratio', a: ethBars, b: valBars },
    { label: 'diff', op: 'diff', a: ethBars, b: valBars },
    { label: 'bad op', op: 'geo', data: ethBars }, // junk op → percent path, data present
    null,
    {},
    { label: '', data: ethBars },
    { label: 'no data' },
    { label: 'empty', data: [] },
    { label: 'bad op no data', op: 'geo' },
    'junk',
  ]);
  assert.equal(out.length, 4);
  assert.deepEqual(out[0], { label: 'ETH', op: 'percent', samples: out[0].samples, color: '#0f0', width: 2 });
  assert.equal(out[1].op, 'ratio');
  assert.equal(out[2].op, 'diff');
  assert.equal(out[3].op, 'percent', 'unknown op falls through to percent');
  assert.equal(normalizeSeries([{ label: 'tiny', data: [{ time: 1, close: 5 }] }]).length, 1, 'a single sample is kept');
  assert.equal(
    normalizeSeries(Array.from({ length: 10 }, (_, i) => ({ label: 's' + i, data: ethBars }))).length,
    MAX_SERIES
  );
  assert.deepEqual(normalizeSeries('nope'), []);
});

test('normalizeSeries: seconds → ms, unsorted input sorted, {value} fallback, clamps', () => {
  const out = normalizeSeries([
    {
      label: 'X',
      data: [
        { time: (T0 + 5 * H) / 1000, close: 5 },
        { time: T0 / 1000, close: 1 },
        { time: 'junk', close: 3 },
        { time: T0 + 2 * H, value: 3 },
      ],
      color: 'nope',
      width: 99,
    },
  ]);
  assert.deepEqual(out[0].samples, [[T0, 1], [T0 + 2 * H, 3], [T0 + 5 * H, 5]]);
  assert.equal(out[0].color, null);
  assert.equal(out[0].width, 4, 'width clamps to 4');
  assert.equal(normalizeSeries([{ label: 'X', data: ethBars, width: 0.5 }])[0].width, 1, 'width clamps to 1');
});

test('mergeOp via normalizeSeries: constant ratio 0.5 and diff −100−i; b-gap skips', () => {
  const [ratio] = normalizeSeries([{ label: 'R', op: 'ratio', a: ethBars, b: valBars }]);
  assert.equal(ratio.samples.length, 100);
  assert.equal(ratio.samples[50][1], 0.5);
  assert.equal(ratio.samples[99][0], T0 + 99 * H);
  const [diff] = normalizeSeries([{ label: 'D', op: 'diff', a: ethBars, b: valBars }]);
  assert.equal(diff.samples[10][1], -110);
  // b starts 10 bars late → those a times are skipped (no denominator)
  const lateB = [{ time: T0 + 10 * H, value: 2 }, { time: T0 + 20 * H, value: 2 }];
  const [short] = normalizeSeries([{ label: 'S', op: 'ratio', a: ethBars, b: lateB }]);
  assert.equal(short.samples.length, 90, 'leading times without b are dropped');
  assert.equal(short.samples[0][0], T0 + 10 * H);
});

/* ------------------------- sampleAt / timeWindow ------------------------- */

test('sampleAt: exact hit, nearest-before, null before the start', () => {
  const samples = [[T0, 1], [T0 + H, 2], [T0 + 3 * H, 4]];
  assert.equal(sampleAt(samples, T0 + H), 2);
  assert.equal(sampleAt(samples, T0 + 2 * H), 2, 'between samples → earlier one');
  assert.equal(sampleAt(samples, T0 + 99 * H), 4, 'past the end → last sample');
  assert.equal(sampleAt(samples, T0 - 1), null);
});

test('timeWindow: full, partial, and gap windows', () => {
  assert.deepEqual(timeWindow(ethBars, T0, T0 + 99 * H), [0, 99]);
  assert.deepEqual(timeWindow(ethBars, T0 + 10 * H, T0 + 19 * H), [10, 19]);
  assert.deepEqual(timeWindow(ethBars, T0 - 5 * H, T0 + 3 * H), [0, 3], 'clamps low');
  assert.deepEqual(timeWindow(ethBars, T0 + 95 * H, T0 + 200 * H), [95, 99], 'clamps high');
  assert.equal(timeWindow(ethBars, T0 + 200 * H, T0 + 300 * H), null);
  assert.equal(timeWindow([], T0, T0), null);
  const gapped = [{ time: T0 }, { time: T0 + 10 * H }];
  assert.equal(timeWindow(gapped, T0 + H, T0 + 2 * H), null, 'window inside a gap');
});

/* ------------------------- computeLine ------------------------- */

test('computeLine: first/visible/anchor rebasing', () => {
  const [def] = normalizeSeries([{ label: 'ETH', data: ethBars }]);
  const times = ethBars.map((b) => b.time);

  const first = computeLine(def, times, 'first');
  assert.equal(first[0].pct, 0);
  assert.ok(Math.abs(first[42].pct - 42) < 1e-9, 'pct(i) = i for closes 100+i');
  assert.equal(first[42].raw, 142);

  const visible = computeLine(def, times.slice(20), 'visible'); // panned window
  assert.equal(visible[0].pct, 0);
  assert.ok(Math.abs(visible[50].pct - ((170 / 120 - 1) * 100)) < 1e-9, 'anchor = first visible sample');

  const anchored = computeLine(def, times, T0 + 5 * H);
  assert.equal(anchored[5].pct, 0);
  assert.equal(anchored[6].pct, (106 / 105 - 1) * 100);

  const before = computeLine(def, times, T0 - 10 * H);
  assert.equal(before[0].pct, 0, 'anchor before the data falls back to the first sample');
});

test('computeLine: derived entries keep raw values; unsampled times are null', () => {
  const [ratio] = normalizeSeries([{ label: 'R', op: 'ratio', a: ethBars, b: valBars }]);
  const line = computeLine(ratio, [T0 + H, T0 + 2 * H], 'first');
  assert.equal(line[0].pct, 0, 'constant ratio → flat 0%');
  assert.equal(line[1].raw, 0.5);

  const sparse = [{ time: T0, close: 1 }, { time: T0 + 10 * H, close: 2 }];
  const [def] = normalizeSeries([{ label: 'S', data: sparse }]);
  const line2 = computeLine(def, [T0 + H, T0 + 5 * H, T0 + 10 * H], 'first');
  assert.deepEqual(line2, [
    { t: T0 + H, pct: 0, raw: 1 },
    { t: T0 + 5 * H, pct: 0, raw: 1 },
    { t: T0 + 10 * H, pct: 100, raw: 2 },
  ], 'times before the first sample carry the last known value forward');
});
