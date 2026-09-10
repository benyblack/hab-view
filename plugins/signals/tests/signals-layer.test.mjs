// wickchart-signals — the layer: attach/detach, chip rendering, kinds
// subset, and the crosshair hover bridge, via a fake chart + recording ctx.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachSignals } from '../signals.mjs';

const T0 = Date.UTC(2026, 2, 4);
const H = 3_600_000;
const PX = 5;
// the verified mixed fixture from the core tests: exactly 6 signals
// (engulf@2 bull, hammer@4, inside@8, engulf@10 bull, engulf@11 bear, star@13)
let lastH = 100.5;
const filler = (l = 99.7) => {
  lastH = Math.max(100.5, lastH) + 0.1;
  return { open: 100.3, high: lastH, low: l, close: 100 };
};
const raw = [
  filler(), // 0
  filler(), // 1
  { open: 99.95, high: 101.5, low: 99.9, close: 101.5 }, // 2 bull engulfing
  filler(), // 3
  { open: 100.4, high: 100.6, low: 99.2, close: 100.5 }, // 4 hammer
  filler(), // 5
  filler(99.5), // 6
  { open: 100.4, high: 108, low: 96, close: 104 }, // 7 mother
  { open: 102, high: 106, low: 98, close: 103 }, // 8 inside
  filler(97.5), // 9
  { open: 99.5, high: 105, low: 99, close: 104 }, // 10 bull engulf of 9
  { open: 105, high: 106, low: 98, close: 99 }, // 11 bear engulf of 10
  filler(97.5), // 12
  { open: 100.1, high: 105, low: 100.05, close: 100.6 }, // 13 shooting star
  (() => { lastH = 100.5; return filler(); })(), // 14
];
const N = raw.length;
const bars = raw.map((b, i) => ({ ...b, time: T0 + i * H }));
const W = N * PX;

class FakeChart extends EventTarget {
  constructor() {
    super();
    this._d = bars.map((b) => ({ ...b }));
    this.layers = [];
    this.events = [];
    this.draws = 0;
  }
  get data() {
    return this._d;
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
    this.draws++;
  }
  dispatchEvent(e) {
    this.events.push({ type: e.type, detail: e.detail });
    return super.dispatchEvent(e);
  }
  timeToX(t) {
    return ((t - T0) / H) * PX;
  }
  xToTime(x) {
    return T0 + (x / PX) * H;
  }
  priceToY(p) {
    return 200 - p;
  }
}

function recordCtx() {
  const ops = [];
  return {
    ops,
    ctx: new Proxy(
      {},
      {
        get: (_t, p) => (p === 'measureText' ? (s) => ({ width: String(s).length * 6 }) : (...a) => ops.push([String(p), ...a.map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))])),
        set: (_t, p, v) => {
          ops.push(['set:' + String(p), v]);
          return true;
        },
      }
    ),
  };
}

const PAL = { accent: '#4c8dff', up: '#16c784', down: '#ea3943', text: '#8b949e', bg: '#11141c' };

const apiFor = (c, rc) => ({
  ctx: rc.ctx,
  layout: { plotRight: W, main: { y0: 0, h: 300 } },
  palette: PAL,
  data: c.data,
  view: {},
  timeToX: (t) => c.timeToX(t),
  xToTime: (x) => c.xToTime(x),
  priceToY: (p) => c.priceToY(p),
  yToPrice: (y) => c.yToPrice(y),
});

function fresh(opts = {}) {
  const c = new FakeChart();
  const s = attachSignals(c, opts);
  const rc = recordCtx();
  return { c, s, rc, api: apiFor(c, rc) };
}

/* ------------------------- attach / detach ------------------------- */

test('attachSignals registers one wick-signals layer; guards; detach', () => {
  const { c, s } = fresh();
  assert.throws(() => attachSignals(null), /chart element is required/);
  assert.equal(c.layers.length, 1);
  assert.equal(c.layers[0].id, 'wick-signals');
  assert.equal(c.layers[0].onPointer, undefined, 'badges never claim pointers');
  assert.equal(s.count, 0, 'nothing detected before the first render');
  s.detach();
  assert.equal(c.layers.length, 0);
  const before = c.events.filter((e) => e.type === 'wick:signals').length;
  c.dispatchEvent(new CustomEvent('wick:crosshair', { detail: { index: 2 } }));
  assert.equal(c.events.filter((e) => e.type === 'wick:signals').length, before, 'no hover events after detach');
});

/* ------------------------- render ------------------------- */

test('render: one chip per detected pattern, colored by direction', () => {
  const { s, rc, api } = fresh();
  s._render(api);
  assert.equal(s.count, 6, 'the fixture yields exactly six signals');
  const arcs = rc.ops.filter((o) => o[0] === 'arc').length;
  assert.equal(arcs, 6, 'one chip per signal');
  const letters = rc.ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
  assert.deepEqual(letters.sort(), ['E', 'E', 'E', 'IB', 'P', 'P']);
  const fills = rc.ops.filter((o) => o[0] === 'set:fillStyle').map((o) => o[1]);
  assert.ok(fills.includes(PAL.up) && fills.includes(PAL.down) && fills.includes(PAL.text), 'bull/bear/neutral colors');
});

test('render: setKinds subsets the detection; junk kinds are ignored', () => {
  const { s, rc, api } = fresh();
  s.setKinds(['pinbar', 'bogus']);
  assert.deepEqual(s.kinds, ['pinbar']);
  s._render(api);
  assert.equal(s.count, 2, 'hammer + shooting star');
  assert.deepEqual(rc.ops.filter((o) => o[0] === 'fillText').map((o) => o[1]).sort(), ['P', 'P']);
  s.setKinds([]);
  assert.deepEqual(s.kinds, ['engulfing', 'pinbar', 'inside'], 'empty → all kinds');
});

test('render: empty data paints nothing', () => {
  const { c, s, rc } = fresh();
  c._d = [];
  s._render(apiFor(c, rc));
  assert.equal(rc.ops.length, 0);
  assert.equal(s.count, 0);
});

/* ------------------------- hover bridge ------------------------- */

test('crosshair hover on a badged bar fires wick:signals with the explanation', () => {
  const { c, s, api } = fresh();
  s._render(api);
  const hoverEvents = () => c.events.filter((e) => e.type === 'wick:signals');

  c.dispatchEvent(new CustomEvent('wick:crosshair', { detail: { index: 2, bar: bars[2] } }));
  assert.deepEqual(hoverEvents().pop().detail, {
    index: 2,
    time: bars[2].time,
    signals: [{ i: 2, kind: 'engulfing', dir: 'bull' }],
    label: 'Bullish engulfing',
  });
  c.dispatchEvent(new CustomEvent('wick:crosshair', { detail: { index: 2, bar: bars[2] } }));
  assert.equal(hoverEvents().length, 1, 'same bar → no repeat');
  c.dispatchEvent(new CustomEvent('wick:crosshair', { detail: { index: 4, bar: bars[4] } }));
  assert.equal(hoverEvents().pop().detail.label, 'Bullish pin bar');
  c.dispatchEvent(new CustomEvent('wick:crosshair', { detail: { index: 0, bar: bars[0] } }));
  assert.equal(hoverEvents().pop().detail, null, 'leaving a signal fires null');
  c.dispatchEvent(new CustomEvent('wick:crosshair', { detail: { index: 999 } }));
  assert.equal(hoverEvents().length, 3, 'out-of-range index is a no-op');
});

test('hover redraws the layer with a tooltip next to the chip; labels can be off', () => {
  const { s, rc, api } = fresh();
  s._render(api);
  s._cross({ index: 2 });
  rc.ops.length = 0;
  s._render(api);
  const tooltip = rc.ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
  assert.ok(tooltip.includes('Bullish engulfing'), 'explanation drawn next to the chips');
  s.setLabels(false);
  rc.ops.length = 0;
  s._render(api);
  const noTooltip = rc.ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
  assert.ok(!noTooltip.includes('Bullish engulfing'), 'labels off → explanation suppressed');
  assert.equal(noTooltip.length, s.count, 'chips still render');
});
