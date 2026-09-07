import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowSummary, tfLabelOf } from '../src/core.js';
assert.equal(typeof windowSummary, 'function');

const H = 3600e3;
const day = (d) => `2026-0${Math.floor(d / 24) + 1}-${String((d % 24) + 1).padStart(2, '0')}T00:00:00.000Z`;

/** Deterministic bar generator: index i → 2026-01-(i%28) style times are messy,
 *  so use plain sequential hours and compare dates via toISOString slices. */
function makeBars(n, closeFn, volFn) {
  const t0 = Date.UTC(2026, 0, 1);
  return Array.from({ length: n }, (_, i) => {
    const close = closeFn(i);
    return {
      time: t0 + i * H,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: volFn ? volFn(i) : 100,
    };
  });
}

test('windowSummary: structure + OHLC aggregation on a rising window', () => {
  const bars = makeBars(60, (i) => 100 + i, () => 100);
  const s = windowSummary(bars, 10, 59, { dtMs: H, label: 'DEMO · 1h' });
  assert.equal(s.bars, 50);
  assert.equal(s.open, bars[10].close);
  assert.equal(s.close, bars[59].close);
  assert.equal(s.high, bars[59].high);
  assert.equal(s.low, bars[10].low);
  assert.equal(s.highTime, bars[59].time);
  assert.equal(s.lowTime, bars[10].time);
  assert.equal(s.timeframe, '1h');
  assert.equal(s.label, 'DEMO · 1h');
  assert.ok(s.changePct > 0);
  // computeStats counts comparisons: first window bar has no predecessor
  assert.equal(s.upBars + s.downBars, 49);
  assert.ok(s.upBars >= 49); // strictly rising closes → almost all up bars
  assert.ok(s.maxVolume === 100);
});

test('windowSummary: trend classification — uptrend, downtrend, range', () => {
  const up = windowSummary(makeBars(60, (i) => 100 + i * 2), 0, 59, { dtMs: H });
  assert.equal(up.trend.label, 'strong uptrend');
  assert.ok(up.trend.slopePctPerBar > 0.15);
  assert.ok(up.trend.r2 > 0.9);

  const dn = windowSummary(makeBars(60, (i) => 200 - i * 2), 0, 59, { dtMs: H });
  assert.equal(dn.trend.label, 'strong downtrend');
  assert.ok(dn.trend.slopePctPerBar < -0.15);

  // oscillating series → poor linear fit → range-bound
  const rng = windowSummary(makeBars(80, (i) => 100 + (i % 2 ? 5 : -5)), 0, 79, { dtMs: H });
  assert.equal(rng.trend.label, 'range-bound');
  assert.ok(rng.trend.r2 < 0.25);
});

test('windowSummary: sma20 relation and rsi14 present when window is long enough', () => {
  const bars = makeBars(60, (i) => 100 + Math.sin(i / 4) * 10);
  const s = windowSummary(bars, 0, 59, { dtMs: H });
  assert.ok(s.sma20 && isFinite(s.sma20.value));
  assert.equal(typeof s.sma20.priceAbove, 'boolean');
  assert.ok(s.rsi14 !== null && s.rsi14 > 0 && s.rsi14 < 100);
  // too-short window omits them instead of guessing
  const short = windowSummary(bars, 0, 10, { dtMs: H });
  assert.equal(short.sma20, null);
  assert.equal(short.rsi14, null);
});

test('windowSummary: vol percentile is high when the wildest bars are last', () => {
  // quiet for 40 bars, violent for the last 10
  const bars = makeBars(50, (i) => (i < 40 ? 100 + Math.sin(i) * 0.01 : 100 + (i % 2 ? 8 : -8)));
  const s = windowSummary(bars, 0, 49, { dtMs: H });
  assert.ok(s.volPctile >= 90, `expected >= 90, got ${s.volPctile}`);
  // and low when the window ends calm
  const bars2 = makeBars(50, (i) => (i < 10 ? 100 + (i % 2 ? 8 : -8) : 100 + Math.sin(i) * 0.01));
  const s2 = windowSummary(bars2, 0, 49, { dtMs: H });
  assert.ok(s2.volPctile <= 30, `expected <= 30, got ${s2.volPctile}`);
});

test('windowSummary: flags a volume spike and orders patterns recent-first', () => {
  const bars = makeBars(60, (i) => 100 + Math.sin(i / 3), (i) => (i === 50 ? 5000 : 100));
  const s = windowSummary(bars, 0, 59, { dtMs: H });
  const spike = s.patterns.find((p) => p.note.startsWith('Volume'));
  assert.ok(spike, 'volume spike flagged');
  assert.equal(spike.time, bars[50].time);
  // sorted most recent first
  for (let i = 1; i < s.patterns.length; i++) {
    assert.ok(s.patterns[i - 1].time >= s.patterns[i].time);
  }
  assert.ok(s.patterns.length <= 8);
});

test('windowSummary: text rendering contains the key lines', () => {
  const bars = makeBars(60, (i) => 100 + i, (i) => (i === 30 ? 900 : 100));
  const s = windowSummary(bars, 0, 59, { dtMs: H, label: 'BTC · 1h' });
  assert.ok(s.text.startsWith('CHART SUMMARY — BTC · 1h · 60 bars ·'));
  assert.match(s.text, /- Close \d/);
  assert.match(s.text, /- Trend: /);
  assert.match(s.text, /- Volatility: annualized \d+%/, );
  assert.match(s.text, /- Bars: \d+ up \/ \d+ down/);
  assert.match(s.text, /- Notable: /);
  assert.match(s.text, /Volume \d+\.\d× average/);
});

test('windowSummary: returns null on empty or out-of-range windows', () => {
  assert.equal(windowSummary([], 0, 10), null);
  assert.equal(windowSummary(makeBars(5, (i) => i), 0, 10), null);
  assert.equal(windowSummary(makeBars(5, (i) => i), 3, 2), null);
  assert.equal(windowSummary(makeBars(5, (i) => i), -1, 3), null);
});

test('windowSummary: flat series is range-bound and vol percentile degenerates safely', () => {
  const bars = makeBars(40, () => 100);
  const s = windowSummary(bars, 0, 39, { dtMs: H });
  assert.ok(s); // no crash
  assert.equal(s.changePct, 0);
  assert.ok(['range-bound', 'mild drift up', 'mild drift down'].includes(s.trend.label));
});

test('tfLabelOf renders human timeframes', () => {
  assert.equal(tfLabelOf(60e3), '1m');
  assert.equal(tfLabelOf(15 * 60e3), '15m');
  assert.equal(tfLabelOf(H), '1h');
  assert.equal(tfLabelOf(4 * H), '4h');
  assert.equal(tfLabelOf(24 * H), '1d');
  assert.equal(tfLabelOf(7 * 24 * H), '1w');
  assert.equal(tfLabelOf(0), '');
});
