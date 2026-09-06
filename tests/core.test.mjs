import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, isNum, autoPrecision, niceStep, hexToRgba,
  calcSMA, calcEMA, calcEMASparse, calcRSI, calcStdDev, calcBollinger, calcMACD,
} from '../src/core.js';

/* ---------------- utilities ---------------- */

test('clamp', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test('isNum', () => {
  assert.equal(isNum(1.5), true);
  assert.equal(isNum(NaN), false);
  assert.equal(isNum(Infinity), false);
  assert.equal(isNum('3'), false);
});

test('autoPrecision scales with magnitude', () => {
  assert.equal(autoPrecision(50000), 2);
  assert.equal(autoPrecision(42.25), 2);
  assert.equal(autoPrecision(1.5), 3);
  assert.equal(autoPrecision(0.05), 5);
  assert.equal(autoPrecision(0.005), 8);
});

test('niceStep returns 1/2/5 decades', () => {
  assert.equal(niceStep(10, 5), 2);
  assert.equal(niceStep(100, 5), 20);
  assert.equal(niceStep(0.5, 5), 0.1);
  assert.equal(niceStep(0, 5), 1); // degenerate
});

test('hexToRgba', () => {
  assert.equal(hexToRgba('#ff0000', 0.5), 'rgba(255,0,0,0.5)');
  assert.equal(hexToRgba('#abc', 1), 'rgba(170,187,204,1)');
  assert.equal(hexToRgba('rgb(1,2,3)', 0.5), 'rgba(1,2,3,0.5)');
  assert.equal(hexToRgba('nope', 0.5), 'nope'); // pass-through
});

/* ---------------- indicators ---------------- */

test('calcSMA warmup and values', () => {
  const v = [1, 2, 3, 4, 5];
  const s = calcSMA(v, 3);
  assert.deepEqual(s, [null, null, 2, 3, 4]);
  assert.deepEqual(calcSMA(v, 0), [null, null, null, null, null]);
});

test('calcEMA seeds with SMA and converges', () => {
  const v = [10, 10, 10, 10, 10, 20];
  const e = calcEMA(v, 3);
  assert.equal(e[0], null);
  assert.equal(e[1], null);
  assert.equal(e[2], 10); // SMA seed
  assert.ok(e[5] > 10 && e[5] < 20); // moves toward new price
  // EMA of constant series is constant after warmup
  const c = calcEMA([5, 5, 5, 5, 5], 2);
  assert.equal(c[4], 5);
});

test('calcEMASparse handles leading nulls', () => {
  const v = [null, null, 10, 10, 10, 10, 12];
  const e = calcEMASparse(v, 3);
  assert.equal(e[0], null);
  assert.equal(e[3], null); // first full window is 2..4 → seed lands at 4
  assert.equal(e[4], 10);
  assert.ok(e[6] > 10);
});

test('calcRSI extremes: all-up = 100, all-down = 0', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  assert.equal(calcRSI(up, 14)[20], 100);
  const dn = Array.from({ length: 30 }, (_, i) => 100 - i);
  assert.equal(calcRSI(dn, 14)[20], 0);
});

test('calcStdDev known window', () => {
  // windows of 3 over [1,2,3,...]: population stddev of {1,2,3} = sqrt(2/3)
  const s = calcStdDev([1, 2, 3, 4, 5], 3);
  assert.equal(s[0], null);
  assert.equal(s[1], null);
  assert.ok(Math.abs(s[2] - Math.sqrt(2 / 3)) < 1e-12);
  assert.ok(Math.abs(s[4] - Math.sqrt(2 / 3)) < 1e-12); // {3,4,5} same spread
});

test('calcBollinger bands around SMA', () => {
  const closes = [10, 12, 11, 13, 15, 14, 16, 18, 17, 19];
  const bb = calcBollinger(closes, 5, 2);
  const midAt = (i) => closes.slice(i - 4, i + 1).reduce((a, b) => a + b) / 5;
  assert.equal(bb.mid[3], null);
  assert.ok(Math.abs(bb.mid[4] - midAt(4)) < 1e-12);
  assert.ok(bb.upper[4] > bb.mid[4]);
  assert.ok(bb.lower[4] < bb.mid[4]);
  assert.ok(Math.abs((bb.upper[4] - bb.mid[4]) - (bb.mid[4] - bb.lower[4])) < 1e-12);
});

test('calcMACD shape and warmup', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.1);
  const { macd, signal, hist } = calcMACD(closes, 12, 26, 9);
  // macd defined from index 25 (slow EMA warmup)
  assert.equal(macd[24], null);
  assert.ok(typeof macd[25] === 'number');
  // signal: macd values 25..33 seed the 9-period EMA → defined from index 33
  assert.equal(signal[32], null);
  assert.ok(typeof signal[33] === 'number');
  // hist = macd - signal where both defined
  for (const i of [33, 40, 59]) {
    assert.ok(Math.abs(hist[i] - (macd[i] - signal[i])) < 1e-12);
  }
});
