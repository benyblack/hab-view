import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVolumeProfile, encodeStateQuery, decodeStateQuery } from '../src/core.js';

const b = (low, high, volume, close = high, open = low) => ({
  time: low, open, high, low, close, volume,
});

test('computeVolumeProfile distributes volume across spanned price rows', () => {
  // price range 0..100, 10 rows (rowH=10). One bar spanning rows 0-1 with vol 20.
  const p = computeVolumeProfile([b(0, 20, 20)], 0, 0, { rows: 10 });
  assert.ok(p);
  assert.equal(p.priceMin, 0);
  assert.equal(p.priceMax, 20);
  // with a single bar the range is its own low..high → 10 rows of 2 each
  // volume splits evenly across the 10 rows: 2 per row
  assert.equal(p.rows.length, 10);
  assert.equal(p.rows[0].v, 2);
  assert.equal(p.maxV, 2);
  assert.equal(p.total, 20);
});

test('computeVolumeProfile finds POC and greedy value area', () => {
  // three price clusters: heavy at 10-20, medium at 40-50, light at 80-90
  const bars = [
    ...Array.from({ length: 6 }, () => b(10, 20, 100)), // 600 vol
    ...Array.from({ length: 3 }, () => b(40, 50, 100)), // 300 vol
    b(80, 90, 100), // 100 vol
  ];
  const p = computeVolumeProfile(bars, 0, bars.length - 1, { rows: 10, valueAreaPct: 0.7 });
  assert.ok(p);
  // rows: 0-1 → 10-20 cluster, 3-4 → 40-50, 7-8 → 80-90 (price range 10..90, rowH 8)
  const sorted = [...p.rows].map((r) => r.v);
  const pocRow = sorted.indexOf(Math.max(...sorted));
  assert.equal(p.pocIndex, pocRow);
  // POC price inside 10..20
  assert.ok(p.poc >= 10 && p.poc <= 20);
  // 70% of 1000 = 700: POC row alone holds 300 (two rows share 600 → 300 each);
  // greedy expands into the neighbor row (600) reaching 900 ≥ 700 → VA = rows 0-1
  assert.equal(p.vahIndex - p.valIndex + 1 >= 2, true);
  // value area total
  let vaVol = 0;
  for (let r = p.valIndex; r <= p.vahIndex; r++) vaVol += p.rows[r].v;
  assert.ok(vaVol >= p.total * 0.7 - 1e-9);
  assert.ok(p.vah >= p.val);
});

test('computeVolumeProfile colors rows by bar direction', () => {
  const up = b(0, 50, 10, 45, 5); // close > open → up
  const dn = b(0, 50, 10, 5, 45); // close < open → down
  const p = computeVolumeProfile([up, dn], 0, 1, { rows: 5 });
  assert.ok(p);
  for (const r of p.rows) {
    if (r.v > 0) assert.ok(r.up > 0 || r.dn > 0);
  }
  assert.equal(p.total, 20);
});

test('computeVolumeProfile degenerate inputs return null', () => {
  assert.equal(computeVolumeProfile([], 0, 0), null);
  // flat single price → hi === lo → null
  const flat = { time: 0, open: 5, high: 5, low: 5, close: 5, volume: 10 };
  assert.equal(computeVolumeProfile([flat], 0, 0, { rows: 10 }), null);
  // no volume anywhere
  const noVol = b(0, 10, 0);
  assert.equal(computeVolumeProfile([noVol], 0, 0, { rows: 10 }), null);
});

test('profile flag round-trips through the URL codec', () => {
  const q = encodeStateQuery({ type: 'candles', profile: true });
  assert.equal(q, 'type=candles&profile=1');
  assert.equal(decodeStateQuery(q).profile, true);
  assert.equal(decodeStateQuery('type=candles').profile, undefined);
});
