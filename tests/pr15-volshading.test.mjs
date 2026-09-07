import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcRealizedVol,
  volRegimeBands,
  percentileOfSorted,
  parseVolShading,
  encodeStateQuery,
  decodeStateQuery,
} from '../src/core.js';

/* ---------------- calcRealizedVol ---------------- */

test('calcRealizedVol matches hand-computed stddev of log returns', () => {
  const closes = [100, 101, 99, 104, 102, 108];
  const vol = calcRealizedVol(closes, 3);
  assert.equal(vol.length, closes.length);
  assert.ok(vol[0] === null && vol[1] === null && vol[2] === null); // needs 3 returns
  const rets = [Math.log(101 / 100), Math.log(99 / 101), Math.log(104 / 99)];
  const mean = rets.reduce((a, b) => a + b, 0) / 3;
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / 3);
  assert.ok(Math.abs(vol[3] - sd) < 1e-12);
  // window slides: vol[4] covers ln(99/101), ln(104/99), ln(102/104)
  const rets4 = [Math.log(99 / 101), Math.log(104 / 99), Math.log(102 / 104)];
  const mean4 = rets4.reduce((a, b) => a + b, 0) / 3;
  const sd4 = Math.sqrt(rets4.reduce((a, r) => a + (r - mean4) ** 2, 0) / 3);
  assert.ok(Math.abs(vol[4] - sd4) < 1e-12);
});

test('calcRealizedVol: flat series → zero, short/garbage input → all null', () => {
  const flat = calcRealizedVol(new Array(30).fill(100), 10);
  assert.ok(flat.slice(10).every((x) => x === 0));
  assert.ok(flat.slice(0, 10).every((x) => x === null));
  assert.ok(calcRealizedVol([], 5).length === 0);
  assert.ok(calcRealizedVol([100], 5).every((x) => x === null));
  // non-positive closes produce NaN returns → vol stays null until a clean window
  const junk = calcRealizedVol([100, 0, 101, 102, 103, 104], 2);
  assert.equal(junk[2], null);
  assert.ok(junk[5] > 0);
});

test('calcRealizedVol rejects period < 2', () => {
  assert.ok(calcRealizedVol([1, 2, 3], 1).every((x) => x === null));
});

/* ---------------- volRegimeBands ---------------- */

test('volRegimeBands splits a linear distribution into 30/40/30', () => {
  const vals = Array.from({ length: 100 }, (_, i) => i + 1);
  vals.push(null, null); // nulls tolerated
  const { regimes, sorted, q1, q2 } = volRegimeBands(vals, 30, 70);
  assert.equal(sorted.length, 100);
  assert.ok(Math.abs(q1 - 30.7) < 1e-9);
  assert.ok(Math.abs(q2 - 70.3) < 1e-9);
  const counts = [0, 0, 0];
  for (let i = 0; i < 100; i++) counts[regimes[i]]++;
  assert.deepEqual(counts, [30, 40, 30]);
  assert.equal(regimes[100], -1); // null → unknown
  assert.equal(regimes[101], -1);
});

test('volRegimeBands: degenerate spread classifies all as normal', () => {
  const vol = calcRealizedVol(new Array(40).fill(50), 10);
  const { regimes } = volRegimeBands(vol, 30, 70);
  assert.ok(regimes.every((r) => r === 1 || r === -1));
});

test('volRegimeBands handles empty input', () => {
  const { regimes, q1, q2 } = volRegimeBands([], 30, 70);
  assert.deepEqual(regimes, []);
  assert.ok(Number.isNaN(q1) && Number.isNaN(q2));
});

/* ---------------- percentileOfSorted ---------------- */

test('percentileOfSorted returns 0–100 with sane endpoints', () => {
  const sorted = Array.from({ length: 101 }, (_, i) => i); // 0..100
  assert.equal(percentileOfSorted(sorted, 0), 0);
  assert.equal(percentileOfSorted(sorted, 100), 100);
  assert.ok(Math.abs(percentileOfSorted(sorted, 50) - 50) < 1e-9);
  assert.equal(percentileOfSorted(sorted, -5), 0); // below everything
  assert.equal(percentileOfSorted(sorted, 500), 100); // above everything
  assert.ok(Number.isNaN(percentileOfSorted(sorted, NaN)));
  assert.ok(Number.isNaN(percentileOfSorted([], 5)));
  assert.equal(percentileOfSorted([7], 7), 50);
});

/* ---------------- parseVolShading ---------------- */

test('parseVolShading: defaults, custom values, and clamping', () => {
  assert.deepEqual(parseVolShading(''), { p1: 30, p2: 70, period: 20 });
  assert.deepEqual(parseVolShading(null), { p1: 30, p2: 70, period: 20 });
  assert.deepEqual(parseVolShading('true'), { p1: 30, p2: 70, period: 20 });
  assert.deepEqual(parseVolShading('25/80/14'), { p1: 25, p2: 80, period: 14 });
  assert.deepEqual(parseVolShading('10/90'), { p1: 10, p2: 90, period: 20 });
  // inverted / out-of-range inputs are pulled back so p1 ≤ p2 - 2
  const inv = parseVolShading('90/10');
  assert.ok(inv.p1 <= inv.p2 - 2);
  const neg = parseVolShading('-40/-10/0');
  assert.equal(neg.period, 2); // period clamped up to 2
  assert.ok(neg.p2 >= 2);
  assert.deepEqual(parseVolShading('30/70/99999').period, 500);
});

/* ---------------- URL state round trip ---------------- */

test('encode/decode round-trips volshading toggle and custom cutoffs', () => {
  assert.equal(decodeStateQuery(encodeStateQuery({ volshading: true })).volshading, true);
  assert.equal(decodeStateQuery(encodeStateQuery({ volshading: '25/80' })).volshading, '25/80');
  const off = decodeStateQuery(encodeStateQuery({ volshading: false }));
  assert.equal('volshading' in off && off.volshading, false);
  assert.equal(decodeStateQuery(encodeStateQuery({})).volshading, undefined);
});
