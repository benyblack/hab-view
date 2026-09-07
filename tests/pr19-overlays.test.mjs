// PR #19 — server-side overlays: zones & levels via setOverlays()/attr.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const bars = Array.from({ length: 100 }, (_, i) => ({
  time: 1_700_000_000_000 + i * 3600e3, // hourly bars, ms
  open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10,
}));

/* ------------------------- barIndexForTime ------------------------- */

test('barIndexForTime snaps to the bar at or before the timestamp', async () => {
  const { barIndexForTime } = await import('../src/core.js');
  assert.equal(barIndexForTime(bars, bars[40].time), 40, 'exact hit');
  assert.equal(barIndexForTime(bars, bars[40].time + 1800e3), 40, 'between bars floors to the earlier one');
  assert.equal(barIndexForTime(bars, bars[0].time - 1e6), 0, 'before the first bar clamps to 0');
  assert.equal(barIndexForTime(bars, bars[99].time + 1e9), 99, 'after the last bar clamps to n-1');
});

test('barIndexForTime auto-detects seconds and handles degenerate input', async () => {
  const { barIndexForTime } = await import('../src/core.js');
  const secBars = bars.map((b) => ({ ...b, time: Math.round(b.time / 1000) }));
  assert.equal(barIndexForTime(secBars, bars[40].time), 40, 'ms query against s bars still resolves');
  assert.equal(barIndexForTime(bars, bars[40].time / 1000), 40, 's query against ms bars');
  assert.equal(barIndexForTime([], 123), null, 'empty bars → null');
  assert.equal(barIndexForTime(bars, 'x'), null, 'non-numeric time → null');
});

/* ------------------------- normalizeOverlays ------------------------- */

test('normalizeOverlays validates zones: price swap, defaults, ids', async () => {
  const { normalizeOverlays } = await import('../src/core.js');
  const [z] = normalizeOverlays([
    { type: 'zone', priceFrom: 35600, priceTo: 33000, from: bars[10].time, color: '#26a69a' },
  ]);
  assert.equal(z.priceFrom, 33000, 'priceFrom/priceTo are swapped into order');
  assert.equal(z.priceTo, 35600);
  assert.equal(z.to, null, 'no `to` → null (extends to the right edge / future)');
  assert.equal(z.from, bars[10].time);
  assert.equal(z.color, '#26a69a');
  assert.equal(z.alpha, 0.22, 'default fill alpha');
  assert.equal(z.border, true, 'border on by default');
  assert.equal(z.label, '');
  assert.match(z.id, /^ov-1$/);
});

test('normalizeOverlays validates levels: defaults and custom width/dash', async () => {
  const { normalizeOverlays } = await import('../src/core.js');
  const [l1, l2] = normalizeOverlays([
    { type: 'level', price: 28700 },
    { type: 'level', price: 22800, color: '#3f51b5', width: 9, dash: true, label: 'S2', id: 'lvl-x' },
  ]);
  assert.equal(l1.width, 1, 'default width');
  assert.equal(l1.dash, false, 'levels are solid by default');
  assert.equal(l1.from, null);
  assert.equal(l1.to, null);
  assert.equal(l2.width, 4, 'width clamps to 4');
  assert.equal(l2.dash, true);
  assert.equal(l2.label, 'S2');
  assert.equal(l2.id, 'lvl-x', 'provided ids are preserved');
});

test('normalizeOverlays drops invalid entries instead of throwing', async () => {
  const { normalizeOverlays } = await import('../src/core.js');
  const out = normalizeOverlays([
    null,
    'zone',
    { type: 'zone', priceFrom: 1 }, // missing priceTo
    { type: 'level' }, // missing price
    { type: 'rectangle', price: 5 }, // unknown type
    { type: 'level', price: 5 }, // valid — survives
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].price, 5);
  assert.deepEqual(normalizeOverlays('nope'), [], 'non-array input → []');
});

test('normalizeOverlays sanitizes colors, alpha and labels', async () => {
  const { normalizeOverlays } = await import('../src/core.js');
  const [z1, z2, z3] = normalizeOverlays([
    { type: 'zone', priceFrom: 1, priceTo: 2, color: 'javascript:alert(1)', alpha: 5, label: 'x'.repeat(80) },
    { type: 'zone', priceFrom: 1, priceTo: 2, color: 'rgb(38, 166, 154)', alpha: 0.001 },
    { type: 'zone', priceFrom: 1, priceTo: 2, color: 'up' },
  ]);
  assert.equal(z1.color, null, 'unsafe color → null (falls back to accent at draw time)');
  assert.equal(z1.alpha, 0.8, 'alpha clamps to 0.8');
  assert.equal(z1.label.length, 40, 'labels truncate to 40 chars');
  assert.equal(z2.color, 'rgb(38, 166, 154)', 'rgb() colors pass through');
  assert.equal(z2.alpha, 0.02, 'alpha clamps up to 0.02');
  assert.equal(z3.color, 'up', 'palette keys survive validation for later resolution');
});

/* ------------------------- resolveOverlayColor ------------------------- */

test('resolveOverlayColor maps palette keys, validated colors, and fallbacks', async () => {
  const { resolveOverlayColor } = await import('../src/core.js');
  const pal = { up: '#16c784', down: '#ea3943', accent: '#4c8dff' };
  assert.equal(resolveOverlayColor('up', pal), '#16c784');
  assert.equal(resolveOverlayColor('DOWN', pal), '#ea3943', 'palette keys are case-insensitive');
  assert.equal(resolveOverlayColor('#26a69a', pal), '#26a69a');
  assert.equal(resolveOverlayColor('not a color', pal), '#4c8dff', 'garbage falls back to accent');
  assert.equal(resolveOverlayColor(null, pal), '#4c8dff', 'missing color falls back to accent');
});

/* ------------------------- component contract ------------------------- */

test('wick-chart exposes the overlays API, attribute, and a guarded draw path', async () => {
  const src = read('src/wick-chart.js');
  assert.match(src, /'overlays'/, 'overlays is an observed attribute');
  assert.match(src, /setOverlays\(list\)/);
  assert.match(src, /addOverlay\(ov\)/);
  assert.match(src, /removeOverlay\(id\)/);
  assert.match(src, /clearOverlays\(\)/);
  assert.match(src, /get overlays\(\)/);
  // the attribute must parse JSON defensively — an unparseable value renders no overlays, no throw
  assert.match(src, /case 'overlays':[\s\S]*?try\s*\{[\s\S]*?normalizeOverlays\(JSON\.parse\(val\)\)/);
  // zones draw with globalAlpha over a resolved/validated color (no raw interpolation)
  assert.match(src, /resolveOverlayColor\(ov\.color, pal\)/);
  assert.match(src, /ctx\.globalAlpha = ov\.alpha/);
});

test('react binding routes the overlays prop through setOverlays', async () => {
  const src = read('src/react-core.js');
  assert.match(src, /key === 'overlays'/, 'overlays extracted in splitChartProps');
  assert.match(src, /el\.setOverlays\(split\.overlays\)/, 'applied via the element method');
  assert.match(src, /__wickOverlaysRef !== split\.overlays/, 'guarded by array identity');
});
