import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcHeikinAshi, SERIES_TYPES } from '../src/core.js';

const bar = (time, open, high, low, close, volume = 10) =>
  ({ time, open, high, low, close, volume });

test('SERIES_TYPES covers all supported type attribute values', () => {
  assert.deepEqual(SERIES_TYPES, ['candles', 'line', 'area', 'bars', 'hollow', 'heikin']);
});

test('calcHeikinAshi first bar seeds open as (o+c)/2', () => {
  const [ha] = calcHeikinAshi([bar(0, 10, 20, 5, 15)]);
  assert.equal(ha.close, (10 + 20 + 5 + 15) / 4); // 12.5
  assert.equal(ha.open, (10 + 15) / 2); // 12.5
  assert.equal(ha.high, Math.max(20, ha.open, ha.close)); // 20
  assert.equal(ha.low, Math.min(5, ha.open, ha.close)); // 5
  assert.equal(ha.volume, 10); // passes through
});

test('calcHeikinAshi chains open from previous ha open/close', () => {
  const [a, b] = calcHeikinAshi([
    bar(0, 10, 20, 5, 15),
    bar(1, 12, 30, 4, 22),
  ]);
  // second open = midpoint of first ha open/close
  assert.equal(b.open, (a.open + a.close) / 2);
  assert.equal(b.close, (12 + 30 + 4 + 22) / 4); // 17
  // high/low envelope includes ha open/close even beyond raw range
  assert.equal(b.high, Math.max(30, b.open, b.close));
  assert.equal(b.low, Math.min(4, b.open, b.close));
});

test('calcHeikinAshi envelope includes smoothed values beyond raw high/low', () => {
  // construct a case where ha open exceeds the raw high
  const bars = [
    bar(0, 100, 110, 90, 105), // ha open 102.5, close 101.25
    bar(1, 100, 103, 99, 101), // ha open 101.875, close 100.75
  ];
  const ha = calcHeikinAshi(bars);
  for (let i = 0; i < bars.length; i++) {
    assert.ok(ha[i].high >= Math.max(ha[i].open, ha[i].close));
    assert.ok(ha[i].low <= Math.min(ha[i].open, ha[i].close));
    assert.equal(ha[i].time, bars[i].time);
  }
});

test('calcHeikinAshi preserves order and length', () => {
  const bars = Array.from({ length: 30 }, (_, i) => bar(i, 10 + Math.sin(i), 12 + i * 0.1, 8, 10 + i * 0.05));
  const ha = calcHeikinAshi(bars);
  assert.equal(ha.length, 30);
  assert.deepEqual(ha.map((b) => b.time), bars.map((b) => b.time));
});
