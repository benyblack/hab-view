// wickchart-tape — the pure model: print normalization, tick-rule inference,
// trades→bars aggregation and display formatting. Plain data in / data out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTrades, inferSides, tradesToBars, decimalsFor, fmtSize, MAX_TRADES } from '../core.mjs';

const T0 = Date.UTC(2026, 8, 10, 12, 0, 0); // ms

/* ------------------------- normalizeTrades ------------------------- */

test('normalizeTrades: validates, scales s→ms, aliases b/s sides, sorts by time', () => {
  const out = normalizeTrades([
    { time: T0 + 2000, price: 101, size: 1, side: 'b' },
    { time: T0 / 1000, price: 100.5, size: 2, side: 'sell' }, // seconds
    { time: T0 + 1000, price: 100, size: 0.5 }, // no side
  ]);
  assert.deepEqual(
    out.map((t) => [t.time, t.price, t.size, t.side]),
    [
      [T0, 100.5, 2, 'sell'],
      [T0 + 1000, 100, 0.5, null],
      [T0 + 2000, 101, 1, 'buy'],
    ]
  );
});

test('normalizeTrades: drops invalid entries, never throws', () => {
  const out = normalizeTrades([
    null,
    'trade',
    { time: T0, price: 0, size: 1 }, // price must be positive
    { time: T0, price: -5, size: 1 },
    { time: T0, price: 10, size: 0 },
    { time: T0, price: 10, size: -1 },
    { time: NaN, price: 10, size: 1 },
    { price: 10, size: 1 }, // no time
    { time: T0, price: 10, size: 1, side: 'x' }, // bad side → null, kept
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].side, null);
  assert.deepEqual(normalizeTrades(null), []);
  assert.deepEqual(normalizeTrades([]), []);
});

test('normalizeTrades: caps at MAX_TRADES keeping the first (push re-caps newest)', () => {
  const many = Array.from({ length: MAX_TRADES + 25 }, (_, i) => ({ time: T0 + i, price: 1, size: 1 }));
  const out = normalizeTrades(many);
  assert.equal(out.length, MAX_TRADES);
  assert.equal(out[0].time, T0);
});

/* ------------------------- inferSides ------------------------- */

test('inferSides: uptick buys, downtick sells, first sideless print stays null', () => {
  const { trades } = inferSides(
    normalizeTrades([
      { time: T0, price: 100, size: 1 },
      { time: T0 + 1, price: 101, size: 1 },
      { time: T0 + 2, price: 100.5, size: 1 },
      { time: T0 + 3, price: 101, size: 1 },
    ])
  );
  assert.deepEqual(trades.map((t) => t.side), [null, 'buy', 'sell', 'buy']);
});

test('inferSides: flat prints carry the previous side; explicit sides update it', () => {
  const a = inferSides(normalizeTrades([{ time: T0, price: 99, size: 1, side: 'sell' }]));
  assert.equal(a.trades[0].side, 'sell');
  const b = inferSides(
    normalizeTrades([
      { time: T0 + 1, price: 99, size: 1 },
      { time: T0 + 2, price: 99, size: 1 },
      { time: T0 + 3, price: 99.5, size: 1, side: 'buy' },
      { time: T0 + 4, price: 99.5, size: 1 },
    ]),
    a.prev
  );
  assert.deepEqual(b.trades.map((t) => t.side), ['sell', 'sell', 'buy', 'buy']);
  assert.deepEqual(b.prev, { price: 99.5, side: 'buy' });
});

test('inferSides: no history and no sides → side stays null, price still carries', () => {
  const r = inferSides(normalizeTrades([{ time: T0, price: 50, size: 1 }]));
  assert.equal(r.trades[0].side, null);
  assert.deepEqual(r.prev, { price: 50, side: null });
  // the carried price resolves the next print's direction even without a side
  const r2 = inferSides(normalizeTrades([{ time: T0 + 1, price: 51, size: 1 }]), r.prev);
  assert.equal(r2.trades[0].side, 'buy');
});

/* ------------------------- tradesToBars ------------------------- */

test('tradesToBars: one bucket aggregates OHLCV; buckets sort by time', () => {
  const trades = normalizeTrades([
    { time: T0 + 1000, price: 100, size: 2 },
    { time: T0 + 2000, price: 102, size: 1 },
    { time: T0 + 3000, price: 99, size: 3 },
    { time: T0 + 61000, price: 101, size: 4 },
  ]);
  const bars = tradesToBars(trades, 60000);
  assert.deepEqual(bars, [
    { time: T0, open: 100, high: 102, low: 99, close: 99, volume: 6 },
    { time: T0 + 60000, open: 101, high: 101, low: 101, close: 101, volume: 4 },
  ]);
});

test('tradesToBars: handles unsorted input, prints without size, bad interval', () => {
  const unsorted = [
    { time: T0 + 2000, price: 102, size: 1 },
    { time: T0 + 1000, price: 100, size: 2 },
  ];
  const [bar] = tradesToBars(unsorted, 60000);
  assert.equal(bar.open, 100, 'sorted before aggregating');
  assert.equal(bar.close, 102);
  const [noSize] = tradesToBars([{ time: T0, price: 50 }], 60000);
  assert.equal(noSize.volume, 0);
  assert.deepEqual(tradesToBars([{ time: T0, price: 50 }], 0), []);
  assert.deepEqual(tradesToBars([{ time: T0, price: 50 }], NaN), []);
  assert.deepEqual(tradesToBars([], 60000), []);
});

/* ------------------------- formatting ------------------------- */

test('decimalsFor: longest fraction seen, clamped 2..8', () => {
  assert.equal(decimalsFor([43250, 43251]), 2);
  assert.equal(decimalsFor([0.35271]), 5);
  assert.equal(decimalsFor([1.234567891]), 8);
  assert.equal(decimalsFor([]), 2);
  assert.equal(decimalsFor(null), 2);
});

test('fmtSize: compact above 1000, trimmed decimals below', () => {
  assert.equal(fmtSize(0.5), '0.5');
  assert.equal(fmtSize(12.3456), '12.3456');
  assert.equal(fmtSize(1500), '1.5K');
  assert.equal(fmtSize(2.4e6), '2.4M');
  assert.equal(fmtSize(NaN), '');
});
