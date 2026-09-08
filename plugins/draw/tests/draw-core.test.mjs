// wickchart-draw — pure core: normalization, geometry, snapping.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDrawings,
  fibPrices,
  distToSegment,
  extendSegment,
  nearestBarIndex,
  ohlcOf,
  snapAnchor,
  resolveColor,
} from '../core.mjs';

/* ------------------------- normalizeDrawings ------------------------- */

test('normalizeDrawings: keeps valid, drops junk, enforces point counts', () => {
  const out = normalizeDrawings([
    null,
    { type: 'nope', points: [{ t: 1, p: 2 }] },
    { type: 'trendline', points: [{ t: 1, p: 2 }] }, // needs 2
    { type: 'trendline', points: [{ t: 1, p: 2 }, { t: 3, p: 4 }] },
    { type: 'hline', points: [{ t: 1, p: 2 }, { t: 3, p: 4 }] }, // needs 1
    { type: 'rect', points: [{ t: 1, p: 2 }, { t: null, p: 4 }] }, // null t
    { type: 'text', points: [{ t: 1, p: 2 }] }, // no text → dropped
    { type: 'text', text: '  ', points: [{ t: 1, p: 2 }] }, // blank text
    { type: 'text', text: 'buy the dip', points: [{ t: 1, p: 2 }] },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].type, 'trendline');
  assert.equal(out[1].type, 'text');
  assert.equal(out[1].text, 'buy the dip');
  assert.equal(normalizeDrawings('junk').length, 0);
  assert.equal(normalizeDrawings(null).length, 0);
});

test('normalizeDrawings: seconds → ms, id/color/width/extend clamps, flags', () => {
  const [d] = normalizeDrawings([
    {
      id: 'custom',
      type: 'trendline',
      points: [{ t: 1700000000, p: 100 }, { t: 1700003600, p: 110 }],
      color: '#AbC123',
      width: 99,
      extend: 'both',
    },
  ]);
  assert.equal(d.id, 'custom');
  assert.equal(d.points[0].t, 1700000000000, 'seconds scaled to ms');
  assert.equal(d.points[1].t, 1700003600000);
  assert.equal(d.color, '#AbC123');
  assert.equal(d.width, 4, 'width clamped to 1..4');
  assert.equal(d.extend, 'both');
  assert.equal(d.locked, false);
  assert.equal(d.visible, true);
  const [bad] = normalizeDrawings([
    { type: 'trendline', points: [{ t: 1, p: 2 }, { t: 3, p: 4 }], color: 'javascript:', extend: 'diag' },
  ]);
  assert.equal(bad.color, null);
  assert.equal(bad.extend, 'none');
  assert.ok(/^d-/.test(bad.id), 'auto id when missing');
});

test('normalizeDrawings: caps at 100 drawings', () => {
  const list = Array.from({ length: 130 }, (_, i) => ({
    type: 'hline',
    points: [{ t: i, p: i }],
  }));
  assert.equal(normalizeDrawings(list).length, 100);
});

test('normalizeDrawings: duplicate ids are deduped (first wins)', () => {
  const out = normalizeDrawings([
    { id: 'x', type: 'hline', points: [{ t: 1, p: 2 }] },
    { id: 'x', type: 'hline', points: [{ t: 3, p: 4 }] }, // dropped — same id
    { id: 'y', type: 'text', text: 'hi', points: [{ t: 5, p: 6 }] },
  ]);
  assert.deepEqual(out.map((d) => d.id), ['x', 'y']);
  assert.equal(out[0].points[0].p, 2);
});

/* ------------------------- fibPrices ------------------------- */

test('fibPrices: 0 at the second anchor, 1 at the first, 0.5 midway', () => {
  const lv = fibPrices(200, 100);
  assert.equal(lv.length, 7);
  assert.equal(lv[0].k, 0);
  assert.equal(lv[0].price, 100);
  assert.equal(lv.at(-1).k, 1);
  assert.equal(lv.at(-1).price, 200);
  const mid = lv.find((l) => l.k === 0.5);
  assert.equal(mid.price, 150);
  // inverted anchors invert the ladder
  assert.equal(fibPrices(100, 200)[0].price, 200);
});

/* ------------------------- geometry ------------------------- */

test('distToSegment: on-line, perpendicular, endpoints', () => {
  assert.equal(distToSegment(5, 0, 0, 0, 10, 0), 0);
  assert.equal(distToSegment(5, 3, 0, 0, 10, 0), 3);
  assert.equal(distToSegment(5, 4, 0, 0, 10, 0), 4);
  // beyond the ends clamps to the nearest endpoint
  assert.equal(distToSegment(-3, 4, 0, 0, 10, 0), 5);
  assert.equal(distToSegment(15, 8, 0, 0, 10, 0), Math.hypot(5, 8));
});

test('extendSegment: clips to the box and reports t ranges', () => {
  // diagonal (0,0)→(10,10) clipped to a 5×5 box
  const a = extendSegment(0, 0, 10, 10, 0, 0, 5, 5);
  assert.deepEqual(a.from, [0, 0]);
  assert.deepEqual(a.to, [5, 5]);
  assert.equal(a.t0, 0);
  assert.ok(Math.abs(a.t1 - 0.5) < 1e-12);
  // a segment fully outside a parallel box misses
  assert.equal(extendSegment(0, -5, 10, -5, 0, 0, 10, 10), null);
  // pointing away from the box: the infinite line still clips through it,
  // but entirely at t < 0 (callers use the t range to pick sides)
  const away = extendSegment(20, 20, 30, 30, 0, 0, 10, 10);
  assert.equal(away.t0, -2);
  assert.equal(away.t1, -1);
  assert.deepEqual(away.from, [0, 0]);
  // degenerate A === B inside the box collapses to the point
  const d = extendSegment(3, 3, 3, 3, 0, 0, 10, 10);
  assert.deepEqual(d.from, [3, 3]);
  assert.deepEqual(d.to, [3, 3]);
});

/* ------------------------- snapping ------------------------- */

test('nearestBarIndex: exact, between, before-first, after-last', () => {
  const bars = [10, 20, 30, 40].map((t) => ({ time: t, close: t }));
  assert.equal(nearestBarIndex(bars, 20), 1);
  assert.equal(nearestBarIndex(bars, 24), 1, '24 is nearer to 20 than 30');
  assert.equal(nearestBarIndex(bars, 26), 2);
  assert.equal(nearestBarIndex(bars, -5), 0);
  assert.equal(nearestBarIndex(bars, 99), 3);
  assert.deepEqual(ohlcOf({ open: 1, high: 2, low: 0.5, close: 1.5 }), [1, 2, 0.5, 1.5]);
});

test('snapAnchor: pins to bar time + nearest OHLC within px; else raw', () => {
  const bars = [
    { time: 1000, open: 110, high: 130, low: 90, close: 105 },
    { time: 2000, open: 120, high: 140, low: 95, close: 115 },
  ];
  const toY = (p) => 200 - p; // 1px = 1 unit
  const hit = snapAnchor(bars, 1600, 112, toY, 10);
  assert.equal(hit.t, 2000, 'time snaps to the nearest bar');
  assert.equal(hit.p, 115, 'price snaps to the nearest OHLC (close of bar 2, 3 away)');
  assert.equal(hit.snapped, true);
  const miss = snapAnchor(bars, 1600, 160, toY, 10);
  assert.equal(miss.p, 160, 'nothing within 10px → raw price');
  assert.equal(miss.t, 2000, 'time still snaps to the bar');
  assert.deepEqual(snapAnchor([], 5, 5, toY), { t: 5, p: 5, snapped: false });
});

/* ------------------------- colors ------------------------- */

test('resolveColor: semantic names map to the palette, hex passes, junk → accent', () => {
  const pal = { up: '#16c784', down: '#ea3943', accent: '#4c8dff' };
  assert.equal(resolveColor('up', pal), '#16c784');
  assert.equal(resolveColor(null, pal), '#4c8dff');
  assert.equal(resolveColor('#abc', pal), '#abc');
  assert.equal(resolveColor('javascript:alert(1)', pal), '#4c8dff');
});
