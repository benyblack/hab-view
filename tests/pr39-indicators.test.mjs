// PR #39 — the indicators batch: vwap, atr, stoch, obv, supertrend,
// donchian, keltner, cci, wr (Williams %R) as built-ins, plus vwap() /
// atr() / obv() as WickScript bar-level functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calcTrueRange, calcATR, calcVWAP, calcOBV, calcStoch, calcCCI,
  calcWilliamsR, calcDonchian, calcKeltner, calcSuperTrend,
  BUILTIN_INDICATORS, parseIndicators, compileScript, evalScript,
  scriptIndicator, predicateTrueSeries,
} from '../src/core.js';

const mk = (o, h, l, c, v = 100, t = 3600e3) => ({ time: t, open: o, high: h, low: l, close: c, volume: v });
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* ---------------- calc functions ---------------- */

test('calcTrueRange: first bar is h−l, then max of the three legs', () => {
  const bars = [mk(10, 12, 8, 10), mk(10, 11, 9, 10), mk(11, 13, 9, 12), mk(12, 12, 10, 11)];
  assert.deepEqual(calcTrueRange(bars), [4, 2, 4, 2]);
});

test('calcATR: Wilder smoothing with SMA seed', () => {
  const bars = [mk(10, 12, 8, 10), mk(10, 11, 9, 10), mk(11, 13, 9, 12), mk(12, 12, 10, 11)];
  const atr = calcATR(bars, 3);
  assert.equal(atr[0], null);
  assert.equal(atr[1], null);
  assert.ok(near(atr[2], 10 / 3)); // (4 + 2 + 4) / 3
  assert.ok(near(atr[3], 26 / 9)); // (10/3 · 2 + 2) / 3
});

test('calcVWAP: hlc3 weighting and UTC-day reset', () => {
  const d = (day, h) => Date.UTC(2024, 0, day, h, 0);
  const bars = [
    mk(10, 12, 8, 10, 100, d(2, 10)),
    mk(11, 15, 9, 12, 300, d(2, 12)),
    mk(12, 14, 10, 13, 200, d(3, 10)),
  ];
  const v = calcVWAP(bars);
  assert.ok(near(v[0], 10)); // tp 10 × 100 / 100
  assert.ok(near(v[1], 11.5)); // (1000 + 12·300) / 400
  assert.ok(near(v[2], 37 / 3)); // new day → reset; tp (14+10+13)/3
  // seconds-based timestamps give the same anchoring
  const secs = bars.map((b) => ({ ...b, time: b.time / 1000 }));
  assert.deepEqual(calcVWAP(secs), v);
});

test('calcOBV: cumulative volume signed by close direction', () => {
  const bars = [
    mk(10, 11, 9, 10, 100),
    mk(10, 12, 9, 11, 50),
    mk(11, 12, 10, 11, 200),
    mk(11, 12, 9, 10, 300),
  ];
  assert.deepEqual(calcOBV(bars), [0, 50, 50, -250]);
});

test('calcStoch: raw %K bounds and smoothing warmup', () => {
  const rising = [mk(0, 1, 0, 1), mk(1, 2, 1, 2), mk(2, 3, 2, 3)];
  const s0 = calcStoch(rising, 3, 1);
  assert.equal(s0.k[2], 100); // close at the window high
  assert.equal(s0.d, s0.k); // no smoothing → d aliases k

  const bars = [mk(10, 12, 8, 11), mk(10, 13, 9, 12), mk(10, 11, 7, 7)];
  const raw = calcStoch(bars, 2, 1);
  assert.equal(raw.k[0], null);
  assert.equal(raw.k[1], 80); // (12−8)/(13−8)
  assert.equal(raw.k[2], 0); // close at the window low
  const sm = calcStoch(bars, 2, 2);
  assert.equal(sm.k[1], null); // one value → window not full
  assert.ok(near(sm.k[2], 40)); // (80 + 0) / 2
  assert.equal(sm.d[2], null); // d needs two k values
});

test('calcCCI: mean-deviation scaling and flat-series guard', () => {
  const flat = [mk(10, 10, 10, 10), mk(10, 10, 10, 10), mk(10, 10, 10, 10)];
  const c0 = calcCCI(flat, 2);
  assert.equal(c0[0], null);
  assert.equal(c0[1], 0); // md 0 → defined as 0, not NaN

  const step = [mk(10, 10, 10, 10), mk(12, 12, 12, 12)];
  const c1 = calcCCI(step, 2);
  assert.ok(near(c1[1], 200 / 3)); // (12−11) / (0.015 · 1)
});

test('calcWilliamsR: 0 at the high, −100 at the low', () => {
  const bars = [mk(10, 12, 8, 11), mk(10, 13, 9, 13), mk(10, 11, 7, 7), mk(7, 14, 6, 14)];
  const w = calcWilliamsR(bars, 3);
  assert.equal(w[1], null);
  assert.equal(w[2], -100); // close 7 at ll 7 of window hh 13
  assert.equal(w[3], 0); // close 14 at hh 14 of window hh 14 ll 6
});

test('calcDonchian: hh/ll channel with mid', () => {
  const bars = [mk(10, 12, 8, 11), mk(10, 13, 9, 12), mk(10, 11, 7, 7)];
  const c = calcDonchian(bars, 3);
  assert.deepEqual([c.upper[0], c.mid[0], c.lower[0]], [null, null, null]);
  assert.deepEqual([c.upper[2], c.mid[2], c.lower[2]], [13, 10, 7]);
});

test('calcKeltner: EMA mid ± mult × ATR', () => {
  const bars = [mk(10, 11, 9, 10), mk(11, 13, 11, 12), mk(13, 15, 13, 14)];
  const k = calcKeltner(bars, 2, 2);
  assert.ok(near(k.mid[1], 11)); // SMA seed of EMA(2)
  assert.ok(near(k.upper[1], 16)); // 11 + 2 · 2.5
  assert.ok(near(k.lower[1], 6));
  assert.ok(near(k.mid[2], 13)); // EMA step: 14·⅔ + 11·⅓
  assert.ok(near(k.upper[2] - k.mid[2], 5.5)); // 2 · ATR = 2 · 2.75
});

test('calcSuperTrend: follows the trend, breaks the line on flips', () => {
  const bars = [
    mk(10, 11, 9, 10),
    mk(10, 12, 10, 11),
    mk(11, 13, 11, 12),
    mk(12, 13, 11, 9), // crash through the lower band
    mk(9, 10, 8, 9),
  ];
  const st = calcSuperTrend(bars, 2, 1);
  assert.deepEqual(st, [null, 9, 10, null, 11]);
  // uptrend support below price, flip gap, then resistance above price
  assert.ok(st[1] < bars[1].close);
  assert.ok(st[4] > bars[4].close);
});

/* ---------------- registry & parsing ---------------- */

test('BUILTIN_INDICATORS carries the batch', () => {
  for (const name of ['vwap', 'supertrend', 'donchian', 'keltner', 'atr', 'stoch', 'obv', 'cci', 'wr']) {
    assert.ok(BUILTIN_INDICATORS.has(name), name);
  }
  assert.equal(BUILTIN_INDICATORS.get('stoch').range[0], 0);
  assert.equal(BUILTIN_INDICATORS.get('stoch').range[1], 100);
  assert.deepEqual(BUILTIN_INDICATORS.get('stoch').guides, [20, 80]);
  assert.deepEqual(BUILTIN_INDICATORS.get('cci').guides, [-100, 100]);
  assert.deepEqual(BUILTIN_INDICATORS.get('wr').guides, [-80, -20]);
  assert.deepEqual(BUILTIN_INDICATORS.get('wr').range, [-100, 0]);
  assert.equal(BUILTIN_INDICATORS.get('obv').fmt, 'compact');
  assert.equal(BUILTIN_INDICATORS.get('atr').fmt, 'price');
});

test('parseIndicators: new tokens, kinds, params, dedupe', () => {
  const r = parseIndicators(
    'vwap supertrend:10/3 donchian:20 keltner:20/2 rsi:14 macd atr:14 stoch:14/3 obv cci:20 wr:14 volume nope',
    BUILTIN_INDICATORS
  );
  assert.equal(r.overlays.length, 4); // vwap supertrend donchian keltner
  assert.equal(r.panes.length, 7); // rsi macd atr stoch obv cci wr
  assert.equal(r.volume, true);
  assert.deepEqual(r.unknown, ['nope']);
  const st = r.overlays.find((e) => e.name === 'supertrend');
  assert.deepEqual(st.params, { period: 10, mult: 3 });
  const so = r.panes.find((e) => e.name === 'stoch');
  assert.deepEqual(so.params, { period: 14, smooth: 3 });
  const defaults = parseIndicators('atr obv', BUILTIN_INDICATORS);
  assert.deepEqual(defaults.panes[0].params, { period: 14 });
  assert.deepEqual(defaults.panes[1].params, {});
  const dup = parseIndicators('vwap vwap', BUILTIN_INDICATORS);
  assert.equal(dup.overlays.length, 1);
});

/* ---------------- WickScript bar-level functions ---------------- */

test('script: vwap() / obv() match the calc functions; atr() warmup', () => {
  const bars = [
    mk(10, 12, 8, 10, 100, Date.UTC(2024, 0, 2, 10)),
    mk(10, 15, 9, 12, 300, Date.UTC(2024, 0, 2, 12)),
    mk(12, 14, 10, 13, 200, Date.UTC(2024, 0, 3, 10)),
    mk(13, 15, 11, 14, 400, Date.UTC(2024, 0, 3, 11)),
  ];
  assert.deepEqual(evalScript(compileScript('vwap()'), bars), calcVWAP(bars));
  assert.deepEqual(evalScript(compileScript('obv()'), bars), calcOBV(bars));
  const atr = evalScript(compileScript('atr(3)'), bars);
  assert.ok(Number.isNaN(atr[1])); // warmup → NaN in script space
  assert.ok(Number.isFinite(atr[3]));
  // composes like any series
  const spread = evalScript(compileScript('close - vwap()'), bars);
  assert.ok(near(spread[0], 0));
  assert.ok(near(spread[1], 12 - 11.5));
});

test('script: bar-level functions work inside alert predicates', () => {
  const bars = [
    mk(10, 20, 20, 10, 100, Date.UTC(2024, 0, 2, 10)), // close 10, vwap 10
    mk(20, 20, 20, 20, 100, Date.UTC(2024, 0, 2, 11)), // close 20, vwap 15
  ];
  assert.deepEqual(predicateTrueSeries(compileScript('crossup(close, vwap())'), bars), [false, true]);
});

test('script: arity validation for the new functions', () => {
  assert.throws(() => compileScript('vwap(5)'), /vwap\(\) takes 0/);
  assert.throws(() => compileScript('atr()'), /atr\(\) takes 1/);
  assert.throws(() => compileScript('atr(close, 14)'), /atr\(\) takes 1/);
  assert.throws(() => compileScript('atr(close)'), /argument 1 must be a whole number/);
  assert.doesNotThrow(() => compileScript('obv()'));
});

test('scriptIndicator: vwap() is registerable under a name', () => {
  const def = scriptIndicator('vwap()');
  const bars = [mk(10, 12, 8, 10, 100), mk(10, 12, 8, 10, 100)];
  const res = def.compute(bars);
  assert.equal(res.lines.length, 1);
  assert.ok(near(res.lines[0].values[1], 10));
});

/* ---------------- docs stay in sync ---------------- */

test('docs and README list the new indicators', () => {
  const docs = readFileSync('docs.html', 'utf8');
  const readme = readFileSync('README.md', 'utf8');
  for (const name of ['supertrend', 'donchian', 'keltner', 'stoch', 'atr', 'obv', 'cci', 'wr']) {
    assert.ok(docs.includes(`<code>${name}</code>`), `docs.html missing ${name}`);
    assert.ok(readme.includes(`\`${name}\``), `README missing ${name}`);
  }
  assert.ok(docs.includes('crossup(close, vwap())'));
  assert.ok(readme.includes('`vwap()`'));
});
