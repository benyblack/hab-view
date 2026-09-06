import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIndicators, normalizeIndicatorResult, BUILTIN_INDICATORS,
  calcBollinger, calcMACD,
} from '../src/core.js';

const bars = Array.from({ length: 60 }, (_, i) => {
  const c = 100 + Math.sin(i / 5) * 10 + i * 0.2;
  return { time: i * 3600e3, open: c - 1, high: c + 2, low: c - 2, close: c, volume: 10 };
});

/* ---------------- parsing ---------------- */

test('parseIndicators: known tokens route to overlays/panes', () => {
  const r = parseIndicators('sma:20 ema:21 rsi:14 volume', BUILTIN_INDICATORS);
  assert.equal(r.volume, true);
  assert.equal(r.overlays.length, 2);
  assert.equal(r.panes.length, 1);
  assert.equal(r.panes[0].name, 'rsi');
  assert.equal(r.panes[0].params.period, 14);
});

test('parseIndicators: multi-param with slashes', () => {
  const r = parseIndicators('macd:8/21/5', BUILTIN_INDICATORS);
  assert.deepEqual(r.panes[0].params, { fast: 8, slow: 21, signal: 5 });
});

test('parseIndicators: defaults fill missing params', () => {
  const r = parseIndicators('macd bb', BUILTIN_INDICATORS);
  assert.deepEqual(r.panes[0].params, { fast: 12, slow: 26, signal: 9 });
  assert.deepEqual(r.overlays[0].params, { period: 20, mult: 2 });
});

test('parseIndicators: @color override and dedupe', () => {
  const r = parseIndicators('sma:20@#ff0000 sma:20 ema', BUILTIN_INDICATORS);
  assert.equal(r.overlays.length, 2); // duplicate sma:20 dropped
  assert.equal(r.overlays[0].color, '#ff0000');
  assert.equal(r.overlays[1].color, null);
});

test('parseIndicators: unknown tokens collected, empty parses to nothing', () => {
  const r = parseIndicators('nonsense sma:9', BUILTIN_INDICATORS);
  assert.deepEqual(r.unknown, ['nonsense']);
  assert.equal(r.overlays.length, 1);
  const empty = parseIndicators('', BUILTIN_INDICATORS);
  assert.equal(empty.volume, false);
  assert.deepEqual(parseIndicators(null, BUILTIN_INDICATORS).overlays, []);
});

/* ---------------- normalization ---------------- */

test('normalizeIndicatorResult shapes', () => {
  const single = normalizeIndicatorResult([1, 2, 3]);
  assert.equal(single.lines.length, 1);
  assert.deepEqual(single.lines[0].values, [1, 2, 3]);
  assert.equal(single.histogram, null);

  const multi = normalizeIndicatorResult({
    lines: [{ name: 'a', values: [1] }],
    histogram: [0.5],
  });
  assert.equal(multi.lines.length, 1);
  assert.deepEqual(multi.histogram, [0.5]);

  assert.equal(normalizeIndicatorResult(null).lines.length, 0);
});

/* ---------------- builtin computes ---------------- */

test('builtin bb compute returns 3 aligned lines', () => {
  const def = BUILTIN_INDICATORS.get('bb');
  const res = normalizeIndicatorResult(def.compute(bars, { period: 20, mult: 2 }));
  assert.deepEqual(res.lines.map((l) => l.name), ['upper', 'mid', 'lower']);
  const last = bars.length - 1;
  assert.ok(res.lines[0].values[last] > res.lines[1].values[last]);
  assert.ok(res.lines[1].values[last] > res.lines[2].values[last]);
  // sanity vs direct calc
  const direct = calcBollinger(bars.map((b) => b.close), 20, 2);
  assert.equal(res.lines[0].values[last], direct.upper[last]);
});

test('builtin macd compute returns lines + histogram', () => {
  const def = BUILTIN_INDICATORS.get('macd');
  const res = normalizeIndicatorResult(def.compute(bars, { fast: 12, slow: 26, signal: 9 }));
  assert.deepEqual(res.lines.map((l) => l.name), ['macd', 'signal']);
  assert.ok(Array.isArray(res.histogram));
  const last = bars.length - 1;
  const direct = calcMACD(bars.map((b) => b.close));
  assert.ok(Math.abs(res.histogram[last] - direct.hist[last]) < 1e-12);
});

test('builtin sma/ema/rsi computes work over bars', () => {
  const closes = bars.map((b) => b.close);
  const sma = normalizeIndicatorResult(BUILTIN_INDICATORS.get('sma').compute(bars, { period: 5 }));
  assert.ok(Math.abs(sma.lines[0].values[4] - (closes[0] + closes[1] + closes[2] + closes[3] + closes[4]) / 5) < 1e-12);
  const rsi = normalizeIndicatorResult(BUILTIN_INDICATORS.get('rsi').compute(bars, { period: 14 }));
  assert.ok(isFinite(rsi.lines[0].values[59]));
});
