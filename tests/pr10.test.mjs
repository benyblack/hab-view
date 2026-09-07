import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genSynthetic, makeSynthStream, tfToSeconds, BASE_PRICES, TF_SECONDS } from '../src/feeds.js';

test('tfToSeconds maps ids case-insensitively with a 1h default', () => {
  assert.equal(tfToSeconds('15m'), 900);
  assert.equal(tfToSeconds('1h'), 3600);
  assert.equal(tfToSeconds('1D'), 86400);
  assert.equal(tfToSeconds('nonsense'), 3600);
  assert.equal(TF_SECONDS['1w'], 604800);
});

test('genSynthetic is deterministic per key', () => {
  const a = genSynthetic('BTC:1h', 3600, 100, 64250);
  const b = genSynthetic('BTC:1h', 3600, 100, 64250);
  const c = genSynthetic('ETH:1h', 3600, 100, 3120);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('genSynthetic produces sane OHLCV bars on a timeframe grid', () => {
  const sec = 3600;
  const bars = genSynthetic('TEST', sec, 50, 100);
  assert.equal(bars.length, 50);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    assert.ok(b.high >= Math.max(b.open, b.close) - 1e-9);
    assert.ok(b.low <= Math.min(b.open, b.close) + 1e-9);
    assert.ok(b.close > 0);
    assert.ok(b.volume > 0);
    if (i > 0) assert.equal(b.time - bars[i - 1].time, sec * 1000);
  }
  // consecutive opens chain from previous closes
  for (let i = 1; i < bars.length; i++) {
    assert.ok(Math.abs(bars[i].open - bars[i - 1].close) < 1e-9);
  }
  // stays in a sane band around base (mean reversion)
  const closes = bars.map((b) => b.close);
  assert.ok(Math.min(...closes) > 20 && Math.max(...closes) < 400);
});

test('makeSynthStream bridges from startPrice and ticks the current bar', () => {
  const sec = 3600;
  const next = makeSynthStream(sec, 50000);
  const t0 = Math.floor(Date.now() / (sec * 1000)) * sec * 1000;
  const a = next();
  assert.equal(a.time, t0);
  assert.ok(Math.abs(a.open - 50000) / 50000 < 0.01); // bridges near start price
  const b = next();
  assert.equal(b.time, a.time); // same bar while the window is open
  assert.ok(b.volume >= a.volume);
  assert.ok(b.high >= b.close - 1e-9 && b.low <= b.close + 1e-9);
});

test('BASE_PRICES exposes demo anchors', () => {
  assert.equal(BASE_PRICES.BTC, 64250);
  assert.equal(BASE_PRICES.DEMO, 100);
});
