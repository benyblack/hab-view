// wickchart-signals — pure detection: each pattern type, direction, and
// non-patterns. The mixed fixture below was verified to produce exactly the
// listed signals (fillers use drift so consecutive bars never read as
// inside bars; pattern bars reset the drift).
import test from 'node:test';
import assert from 'node:assert/strict';
import { anatomy, detectSignals, KINDS } from '../core.mjs';

const B = (o, h, l, c) => ({ open: o, high: h, low: l, close: c });

test('anatomy: candle parts and invalid bars', () => {
  const a = anatomy(B(100, 105, 95, 102));
  assert.deepEqual(
    { bull: a.bull, body: a.body, range: a.range, upper: a.upper, lower: a.lower, top: a.top, bottom: a.bottom },
    { bull: true, body: 2, range: 10, upper: 3, lower: 5, top: 102, bottom: 100 }
  );
  assert.equal(anatomy(B(5, 5, 5, 5)), null, 'zero range');
  assert.equal(anatomy({ open: 1 }), null);
});

test('detectSignals: dedicated two-bar shapes, kinds subset, tiny inputs', () => {
  // float-exact prices (n / 0.5) so the ≥/≤ comparisons have no drift
  const bearThenBull = [B(1050, 1060, 980, 990), B(985, 1070, 970, 1060)];
  assert.deepEqual(detectSignals(bearThenBull), [{ i: 1, kind: 'engulfing', dir: 'bull' }]);
  const bullThenBear = [B(1000, 1010, 990, 1040), B(1050, 1060, 980, 990)];
  assert.deepEqual(detectSignals(bullThenBear), [{ i: 1, kind: 'engulfing', dir: 'bear' }]);
  // shooting star: small bull body at the low end, huge upper wick. The
  // star's body does NOT reach below the previous body, so only the pin fires.
  const star = [B(1000, 1005, 994, 1002), B(1001, 1050, 1000.5, 1006)];
  assert.deepEqual(detectSignals(star), [{ i: 1, kind: 'pinbar', dir: 'bear' }]);
  const hammer = [B(1000, 1005, 994, 1002), B(999.5, 1001, 987.5, 1000.5)];
  assert.deepEqual(detectSignals(hammer), [{ i: 1, kind: 'pinbar', dir: 'bull' }]);
  assert.deepEqual(detectSignals(bearThenBull, ['pinbar']), [], 'subset filters kinds');
  assert.deepEqual(detectSignals(bearThenBull, ['bogus']), []);
  assert.deepEqual(detectSignals(bearThenBull, []), [], 'empty kinds = off, not "all"');
  assert.deepEqual(detectSignals(bearThenBull[0]), [], 'a single bar has no context');
  assert.deepEqual(detectSignals([]), []);
  assert.equal(KINDS.join(','), 'engulfing,pinbar,inside');
});

test('detectSignals: a mixed series detects every planted pattern', () => {
  const B2 = (o, h, l, c) => ({ open: o, high: h, low: l, close: c });
  let lastH = 100.5;
  // filler: bearish tiny body; the high drifts so consecutive fillers are
  // never inside bars; `l` keeps each filler outside its predecessor
  const filler = (l = 99.7) => {
    lastH = Math.max(100.5, lastH) + 0.1;
    return B2(100.3, lastH, l, 100);
  };
  const fixture = [
    filler(), // 0
    filler(), // 1
    B2(99.95, 101.5, 99.9, 101.5), // 2 — bull engulfing of filler 1
    filler(), // 3
    B2(100.4, 100.6, 99.2, 100.5), // 4 — hammer (bull pin)
    filler(), // 5
    filler(99.5), // 6
    B2(100.4, 108, 96, 104), // 7 — mother bar
    B2(102, 106, 98, 103), // 8 — inside bar of 7
    filler(97.5), // 9
    B2(99.5, 105, 99, 104), // 10 — bull bar, engulfs filler 9
    B2(105, 106, 98, 99), // 11 — bear engulfing of bar 10
    filler(97.5), // 12
    B2(100.1, 105, 100.05, 100.6), // 13 — shooting star (bear pin)
    (() => { lastH = 100.5; return filler(); })(), // 14
  ];
  assert.deepEqual(detectSignals(fixture), [
    { i: 2, kind: 'engulfing', dir: 'bull' },
    { i: 4, kind: 'pinbar', dir: 'bull' },
    { i: 8, kind: 'inside', dir: null },
    { i: 10, kind: 'engulfing', dir: 'bull' },
    { i: 11, kind: 'engulfing', dir: 'bear' },
    { i: 13, kind: 'pinbar', dir: 'bear' },
  ]);
});
