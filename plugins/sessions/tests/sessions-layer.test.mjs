// wickchart-sessions — the interaction layer: attach/detach, presets,
// rendering (via a recording canvas context) and the crosshair hover bridge,
// driven through a fake chart (EventTarget + linear transforms).
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachSessions } from '../sessions.mjs';
import { WEEKEND_COLOR } from '../core.mjs';

const T0 = Date.UTC(2026, 2, 4); // Wed 2026-03-04 00:00 UTC
const DT = 3_600_000; // 1h bars
const N = 96; // → the window ends Sun 00:00 UTC
const bars = Array.from({ length: N }, (_, i) => ({
  time: T0 + i * DT,
  open: 100, high: 110, low: 90, close: 105, volume: 1,
}));

class FakeChart extends EventTarget {
  constructor() {
    super();
    this.data = bars.slice(); // own copy — tests may empty it in place
    this.layers = [];
    this.events = [];
  }
  addLayer(l) {
    this.layers.push(l);
    return l;
  }
  removeLayer(id) {
    const n = this.layers.length;
    this.layers = this.layers.filter((l) => l.id !== id);
    return this.layers.length < n;
  }
  requestDraw() {
    /* count not needed — the layer redraws through the chart */
  }
  dispatchEvent(e) {
    this.events.push({ type: e.type, detail: e.detail });
    return super.dispatchEvent(e);
  }
  // linear space: 10px per hour
  timeToX(t) {
    return ((t - T0) / DT) * 10;
  }
  xToTime(x) {
    return T0 + (x / 10) * DT;
  }
  priceToY(p) {
    return 200 - p;
  }
  yToPrice(y) {
    return 200 - y;
  }
}

const PAL = { accent: '#4c8dff', up: '#16c784', down: '#ea3943', text: '#8b949e', bg: '#11141c' };

/** Recording canvas context: every method call and property set is logged. */
function recordCtx() {
  const ops = [];
  return {
    ops,
    ctx: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'measureText') return (s) => ({ width: String(s).length * 6 });
          return (...args) => ops.push([String(prop), ...args]);
        },
        set: (_t, prop, v) => {
          ops.push(['set:' + String(prop), v]);
          return true;
        },
      }
    ),
  };
}

const apiFor = (c, rc) => ({
  ctx: rc.ctx,
  layout: { plotRight: N * 10, main: { y0: 0, y1: 300, h: 300 } },
  palette: PAL,
  data: c.data,
  view: { rightIndex: N - 1, spacing: 10 },
  timeToX: (t) => c.timeToX(t),
  xToTime: (x) => c.xToTime(x),
  priceToY: (p) => c.priceToY(p),
  yToPrice: (y) => c.yToPrice(y),
});

function fresh(opts = {}) {
  const c = new FakeChart();
  const s = attachSessions(c, opts);
  const rc = recordCtx();
  return { c, s, rc, api: apiFor(c, rc) };
}

const fills = (rc) => rc.ops.filter((o) => o[0] === 'fillRect');
const strokes = (rc) => rc.ops.filter((o) => o[0] === 'strokeText');

/* ------------------------- attach / detach ------------------------- */

test('attachSessions registers one wick-sessions layer; detach removes it and the hover bridge', () => {
  const { c, s } = fresh();
  assert.throws(() => attachSessions(null), /chart element is required/);
  assert.equal(c.layers.length, 1);
  assert.equal(c.layers[0].id, 'wick-sessions');
  assert.equal(c.layers[0].onPointer, undefined, 'shading never claims pointers');
  s.detach();
  assert.equal(c.layers.length, 0);
  const before = c.events.filter((e) => e.type === 'wick:sessions').length;
  c.dispatchEvent(new CustomEvent('wick:crosshair', { detail: { bar: { time: T0 + 10 * DT } } }));
  assert.equal(c.events.filter((e) => e.type === 'wick:sessions').length, before, 'no hover events after detach');
});

/* ------------------------- presets / config ------------------------- */

test('setPreset applies defs + weekend defaults; unknown presets are ignored', () => {
  const { s } = fresh();
  s.setPreset('crypto');
  assert.equal(s.preset, 'crypto');
  assert.equal(s.getSessions().length, 3);
  assert.equal(s.weekends, false, 'crypto trades weekends');
  s.setPreset('nyse');
  assert.equal(s.weekends, true, 'closed-market presets shade weekends');
  s.setPreset('bogus');
  assert.equal(s.preset, 'nyse', 'unknown name keeps the current preset');
  assert.equal(s.getSessions().length, 1);
  s.setPreset(null);
  assert.equal(s.preset, null);
  assert.equal(s.getSessions().length, 0);
});

test('setSessions replaces the preset; defs survive a JSON round-trip', () => {
  const { s } = fresh({ preset: 'crypto' });
  s.setSessions([{ name: 'RTH', start: '09:30', end: '16:00', tz: 'America/New_York' }, { junk: true }]);
  assert.equal(s.preset, null, 'custom defs clear the preset');
  assert.equal(s.getSessions().length, 1);
  const round = JSON.parse(JSON.stringify(s.getSessions()));
  s.setSessions(round);
  assert.deepEqual(s.getSessions(), round);
});

test('constructor opts: preset, sessions (wins over preset), weekends and labels', () => {
  const a = fresh({ preset: 'crypto', weekends: true });
  assert.equal(a.s.weekends, true, 'opts.weekends overrides the preset default');
  const b = fresh({ preset: 'crypto', sessions: [{ name: 'X', start: '01:00', end: '02:00' }] });
  assert.equal(b.s.preset, null);
  assert.equal(b.s.getSessions().length, 1);
  const d = fresh({ labels: false });
  assert.equal(d.s.labels, false);
});

/* ------------------------- render ------------------------- */

test('render: crypto preset paints 9 labeled bands across Wed→Sun', () => {
  const { s, rc, api } = fresh({ preset: 'crypto' });
  s._render(api);
  assert.equal(fills(rc).length, 12, '4 days (Wed..Sat) × 3 sessions — the window ends Sun 00:00');
  assert.equal(s._bands.length, 12);
  assert.equal(strokes(rc).length, 12, 'a label per band (all bands ≥ 28px here)');
  assert.ok(rc.ops.some((o) => o[0] === 'set:globalAlpha' && o[1] === 0.08), 'default opacity');
  const first = fills(rc)[0];
  assert.deepEqual([first[1], first[3]], [0, 80], 'Asia band starts at x0, 8h = 80px wide');
});

test('render: nyse adds weekend shading under the sessions; labels skip the weekend band', () => {
  const { s, rc, api } = fresh({ preset: 'nyse' });
  s._render(api);
  assert.equal(fills(rc).length, 4, '3 weekdays + 1 weekend band');
  const styles = [];
  for (let k = 0; k < rc.ops.length; k++) {
    if (rc.ops[k][0] === 'set:fillStyle') styles.push(rc.ops[k][1]);
  }
  assert.equal(styles[0], WEEKEND_COLOR, 'gray weekend paint goes first');
  assert.equal(strokes(rc).length, 3, 'the weekend band has no name → no label');
  s.setWeekends(false);
  rc.ops.length = 0;
  s._render(api);
  assert.equal(fills(rc).length, 3);
});

test('render: weekend shading works standalone (no sessions)', () => {
  const { s, rc, api } = fresh({ weekends: true });
  s._render(api);
  assert.equal(fills(rc).length, 1, 'one Sat→Mon band in the window');
  assert.equal(strokes(rc).length, 0);
});

test('render: empty data or nothing to draw paints nothing', () => {
  const { c, s, rc, api } = fresh({ preset: 'crypto' });
  c.data.length = 0; // in place — the api holds the same array reference
  s._render(api);
  assert.equal(fills(rc).length, 0);
  assert.equal(s._bands.length, 0);
  const e = fresh();
  e.s._render(e.api); // no preset, no weekends
  assert.equal(fills(e.rc).length, 0);
});

test('render: custom defs, midnight crossing and per-def alpha', () => {
  const { s, rc, api } = fresh();
  s.setSessions([
    { name: 'Overnight', start: '21:00', end: '06:00', alpha: 0.5 },
  ]);
  s._render(api);
  assert.equal(fills(rc).length, 5, 'Tue spill + Wed/Thu/Fri + Sat clipped at Sun 00:00');
  assert.ok(rc.ops.some((o) => o[0] === 'set:globalAlpha' && o[1] === 0.5), 'per-def alpha wins');
  assert.equal(strokes(rc).length, 5);
});

test('render: labels truncate with an ellipsis when the band is too narrow', () => {
  // 120px-wide plot holding 12 one-hour bars: a 9h band (90px) cannot fit a
  // 24-char name (~144px at 6px/char in the fake measureText)
  const c = new FakeChart();
  c.data = bars.slice(0, 12);
  const s = attachSessions(c, { sessions: [{ name: 'A very long session name', start: '00:00', end: '09:00' }] });
  const rc = recordCtx();
  const api = apiFor(c, rc);
  s._render({ ...api, layout: { plotRight: 120, main: { y0: 0, y1: 300, h: 300 } } });
  const labels = strokes(rc).map((o) => o[1]);
  assert.equal(labels.length, 1, 'one band in the window (Tue/Thu 00:00–09:00 fall outside it)');
  assert.ok(labels[0].includes('…'), `truncated label, got: ${labels[0]}`);
  assert.ok(labels[0].length < 'A very long session name'.length);
});

test('render: semantic colors resolve from the palette; uncolored defs cycle tints', () => {
  const { s, rc, api } = fresh();
  s.setSessions([{ name: 'A', start: '00:00', end: '01:00', color: 'up' }]);
  s._render(api);
  let upFill = null;
  for (let k = 0; k < rc.ops.length; k++) {
    if (rc.ops[k][0] === 'set:fillStyle') upFill = rc.ops[k][1];
  }
  assert.equal(upFill, PAL.up);
  const b = fresh();
  b.s.setSessions([
    { name: 'A', start: '00:00', end: '01:00' },
    { name: 'B', start: '06:00', end: '07:00' },
    { name: 'C', start: '12:00', end: '13:00' },
    { name: 'D', start: '18:00', end: '19:00' },
    { name: 'E', start: '21:00', end: '22:00' },
  ]);
  b.s._render(b.api);
  const tints = [];
  for (const o of b.rc.ops) if (o[0] === 'set:fillStyle') tints.push(o[1]);
  assert.equal(new Set(tints).size, 4, 'tints cycle with a repeat by the 5th session');
  assert.ok(tints[4] === tints[0], '5th session wraps to the first tint');
});

/* ------------------------- hover bridge ------------------------- */

test('crosshair hover reports the session under the bar; dedupes and clears in gaps', () => {
  const { c, s, api } = fresh({ preset: 'crypto' });
  s._render(api);
  const hoverEvents = () => c.events.filter((e) => e.type === 'wick:sessions');

  c.dispatchEvent(new CustomEvent('wick:crosshair', { detail: { bar: { time: T0 + 10 * DT } } })); // Wed 10:00 → London
  assert.deepEqual(hoverEvents().pop().detail, { hover: 'London' });
  c.dispatchEvent(new CustomEvent('wick:crosshair', { detail: { bar: { time: T0 + 11 * DT } } })); // still London
  assert.equal(hoverEvents().length, 1, 'same session → no repeat event');
  c.dispatchEvent(new CustomEvent('wick:crosshair', { detail: { bar: { time: T0 + 23 * DT } } })); // Wed 23:00 → gap
  assert.deepEqual(hoverEvents().pop().detail, { hover: null });
  c.dispatchEvent(new CustomEvent('wick:crosshair', { detail: { bar: { time: (T0 + 2 * DT) / 1000 } } })); // seconds → Asia
  assert.deepEqual(hoverEvents().pop().detail, { hover: 'Asia' });
  c.dispatchEvent(new CustomEvent('wick:crosshair', { detail: null })); // crosshair left
  assert.deepEqual(hoverEvents().pop().detail, { hover: null });
});

test('hover with no render yet (or outside any band) reports null without firing', () => {
  const { c, s } = fresh({ preset: 'crypto' });
  c.dispatchEvent(new CustomEvent('wick:crosshair', { detail: { bar: { time: T0 + 10 * DT } } }));
  assert.equal(c.events.filter((e) => e.type === 'wick:sessions').length, 0, 'no bands yet → no change');
  const rc = recordCtx();
  s._render(apiFor(c, rc));
  c.dispatchEvent(new CustomEvent('wick:crosshair', { detail: { bar: { time: T0 + 23 * DT } } }));
  assert.equal(c.events.filter((e) => e.type === 'wick:sessions').length, 0, 'gap stays null, no event');
});
