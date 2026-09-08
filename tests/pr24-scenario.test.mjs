// PR #24 — scenario mode: ghost paths + volatility cones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const core = await import('../src/core.js');
const { calcVolCone, normalizeScenario } = core;

/* ------------------------- calcVolCone ------------------------- */

test('cone anchors at bar 0 and widens monotonically with √h', () => {
  const c = calcVolCone(100, 0.02, 10, [1, 2]);
  assert.equal(c.horizon, 10);
  assert.deepEqual(c.levels, [1, 2]);
  for (const z of c.levels) {
    const b = c.bands[z];
    assert.equal(b.up[0], 100, `z=${z} anchors at the last close`);
    assert.equal(b.down[0], 100);
    for (let h = 1; h <= 10; h++) {
      assert.ok(b.up[h] > b.up[h - 1], `up widens at h=${h}`);
      assert.ok(b.down[h] < b.down[h - 1], `down widens at h=${h}`);
    }
  }
  // z=2 band strictly wider than z=1
  assert.ok(c.bands[2].up[10] > c.bands[1].up[10]);
  assert.ok(c.bands[2].down[10] < c.bands[1].down[10]);
});

test('cone scales with √h (GBM): band at h=4 is the square of the band at h=1', () => {
  const c = calcVolCone(100, 0.02, 4, [1]);
  const k1 = c.bands[1].up[1] / 100;
  const k4 = c.bands[1].up[4] / 100;
  assert.ok(Math.abs(k4 - k1 * k1) < 1e-9, `k4=${k4} ≈ k1²=${k1 * k1}`);
});

test('cone handles degenerate input: zero vol → flat, invalid → clamped', () => {
  const flat = calcVolCone(100, 0, 5, [1]);
  assert.ok(flat.bands[1].up.every((v) => v === 100), 'zero vol is a flat band');
  const bad = calcVolCone(100, NaN, 5, [1]);
  assert.ok(bad.bands[1].up.every((v) => v === 100), 'NaN vol degrades to flat');
  const clampedZ = calcVolCone(100, 0.02, 5, [9, 0, -1, 1.5]);
  assert.deepEqual(clampedZ.levels, [1.5], 'levels clamp to (0, 5]');
  assert.equal(calcVolCone(100, 0.02, 9999).horizon, 500, 'horizon clamps to 500');
  assert.equal(calcVolCone(100, 0.02).horizon, 48, 'default horizon 48');
  assert.deepEqual(calcVolCone(100, 0.02, 5).levels, [1, 2], 'default levels [1,2]');
});

/* ------------------------- normalizeScenario ------------------------- */

test('normalizeScenario accepts plain prices and {price} objects, dropping junk', () => {
  const s = normalizeScenario({ path: [100, { price: 110 }, 'junk', -5, { price: 120 }] });
  assert.deepEqual(s.path, [
    { h: 1, price: 100 },
    { h: 2, price: 110 },
    { h: 3, price: 120 },
  ]);
  assert.equal(s.horizon, 3, 'horizon defaults to the path length');
});

test('normalizeScenario defaults: cone on, levels [1,2], color/label sanitized', () => {
  const s = normalizeScenario({ horizon: 48 });
  assert.equal(s.cone, true);
  assert.deepEqual(s.levels, [1, 2]);
  assert.equal(s.color, null);
  assert.equal(s.label, '');
  assert.equal(s.path.length, 0, 'cone-only scenario (no path) is valid');

  const t = normalizeScenario({ horizon: 24, color: 'javascript:alert(1)', label: 'x'.repeat(60), levels: [2, 0.5] });
  assert.equal(t.color, null, 'unsafe colors are dropped (accent at draw time)');
  assert.equal(t.label.length, 40);
  assert.deepEqual(t.levels, [0.5, 2], 'levels sorted ascending');
  assert.equal(normalizeScenario({ horizon: 10, cone: false, color: 'up' }).color, 'up', 'palette keys survive');
});

test('normalizeScenario caps and rejects: 250-point path, no path+no horizon → null', () => {
  const big = normalizeScenario({ path: Array.from({ length: 400 }, (_, i) => 100 + i) });
  assert.equal(big.path.length, 250);
  assert.equal(big.horizon, 250);
  assert.equal(normalizeScenario(null), null);
  assert.equal(normalizeScenario('bull'), null);
  assert.equal(normalizeScenario({ path: [] }), null, 'empty path and no horizon is invalid');
  assert.equal(normalizeScenario({ path: [-1, 0] }), null, 'all-invalid path is invalid');
});

/* ------------------------- component contract ------------------------- */

test('component exposes the scenario API and reserves future space', () => {
  const src = read('src/wick-chart.js');
  assert.match(src, /setScenario\(spec\)/);
  assert.match(src, /clearScenario\(\)/);
  assert.match(src, /get scenario\(\)/);
  assert.match(src, /_scenario \? Math\.max\(base, this\._scenario\.horizon \+ 3\) : base/, 'right margin extends by the scenario horizon');
  assert.match(src, /_scenarioConeCache\(\)/, 'cone cached per data version');
  assert.match(src, /calcVolCone\(/, 'cone built from the core math');
  assert.match(src, /ctx\.clip\(\)/, 'scenario drawing is clipped to the plot area');
  assert.match(src, /normalizeScenario\(spec\)/, 'specs are validated through core');
});

test('scenario drawing uses resolved palette colors, never raw input', () => {
  const src = read('src/wick-chart.js');
  const block = src.slice(src.indexOf('scenario projection: ghost path'), src.indexOf('position zones (under series)'));
  assert.match(block, /resolveOverlayColor\(sc\.color, pal\)/);
  assert.doesNotMatch(block, /javascript:/);
});
