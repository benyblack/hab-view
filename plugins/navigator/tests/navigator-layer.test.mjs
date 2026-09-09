// wickchart-navigator — the layer: attach/detach, silhouette + window
// rendering, and the drag interactions, through a fake chart + recording ctx.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachNavigator } from '../navigator.mjs';

const T0 = Date.UTC(2026, 2, 4);
const H = 3_600_000;
const N = 100;
const PX = 5;
const W = N * PX; // 500
const DOCK = { y0: 300, h: 46 };
const bars = Array.from({ length: N }, (_, i) => ({
  time: T0 + i * H, open: 1, high: 110, low: 90, close: 100, volume: 1,
}));

class FakeChart extends EventTarget {
  constructor() {
    super();
    this._d = bars.slice();
    this.layers = [];
    this.ranges = []; // setVisibleRange calls
    this.range = null;
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
  requestDraw() {}
  setVisibleRange(r) {
    this.ranges.push(r);
    this.range = r;
  }
  // linear view that FOLLOWS the applied range — like the real chart
  timeToX(t) {
    const { from, to } = this.range || { from: T0, to: T0 + (N - 1) * H };
    return ((t - from) / (to - from)) * W;
  }
  xToTime(x) {
    const { from, to } = this.range || { from: T0, to: T0 + (N - 1) * H };
    return from + (x / W) * (to - from);
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

const PAL = { accent: '#4c8dff', text: '#8b949e', bg: '#11141c', grid: '#22273a' };

const apiFor = (c, rc) => ({
  ctx: rc.ctx,
  layout: { W, plotRight: W, main: { y0: 0, h: 300 }, dock: DOCK },
  palette: PAL,
  data: c.data,
  view: {},
  timeToX: (t) => c.timeToX(t),
  xToTime: (x) => c.xToTime(x),
  priceToY: () => 0,
  yToPrice: () => 0,
});

function fresh(opts = {}) {
  const c = new FakeChart();
  const nav = attachNavigator(c, opts);
  const rc = recordCtx();
  const api = apiFor(c, rc);
  nav._render(api); // establish layout/dock before any pointer interaction
  return { c, nav, rc, api };
}

const ev = (type, x, y) => ({ type, x, y, pointerId: 1 });

/* ------------------------- attach / detach ------------------------- */

test('attachNavigator registers a docked wick-navigator layer; guards; detach', () => {
  const c = new FakeChart();
  assert.throws(() => attachNavigator(null), /chart element is required/);
  assert.throws(() => attachNavigator({ addLayer() {} }), /chart element is required/, 'setVisibleRange is required');
  const nav = attachNavigator(c, { height: 60 });
  assert.equal(c.layers.length, 1);
  assert.equal(c.layers[0].id, 'wick-navigator');
  assert.equal(c.layers[0].insetBottom, 60, 'the strip height is the dock declaration');
  assert.equal(nav.height, 60);
  nav.detach();
  assert.equal(c.layers.length, 0);
});

test('height clamps to 24..120; default 46', () => {
  const c = new FakeChart();
  assert.equal(attachNavigator(c, { height: 5 }).height, 24);
  assert.equal(attachNavigator(c, { height: 999 }).height, 120);
  assert.equal(attachNavigator(c).height, 46);
});

/* ------------------------- render ------------------------- */

test('render: opaque strip, silhouette ticks and a full-width window for a full view', () => {
  const { nav, rc, api } = fresh();
  assert.ok(rc.ops.length > 0);
  assert.deepEqual(rc.ops.find((o) => o[0] === 'fillRect')?.slice(1), [0, DOCK.y0, W, DOCK.h], 'opaque backing first');
  const lineTos = rc.ops.filter((o) => o[0] === 'lineTo').length;
  assert.ok(lineTos >= N, 'one silhouette tick per non-empty bucket');
  // window = whole view = whole strip: edges at x≈0 and x≈W
  const smallFills = rc.ops.filter((o) => o[0] === 'fillRect' && Math.abs(o[3] - 3) < 1);
  assert.equal(smallFills.length, 2, 'two 3px edge handles');
  assert.ok(Math.abs(smallFills[0][1]) < 2 && Math.abs(smallFills[1][1] - (W - 1.5)) < 2, 'handles at both ends');
  nav.detach();
});

test('render: no dock (old core) or no data → paints nothing', () => {
  const c = new FakeChart();
  const nav = attachNavigator(c);
  const rc = recordCtx();
  nav._render({
    ctx: rc.ctx,
    layout: { W, plotRight: W, main: { y0: 0, h: 300 }, dock: null },
    palette: PAL,
    data: c.data,
    view: {},
    timeToX: (t) => c.timeToX(t),
    xToTime: (x) => c.xToTime(x),
    priceToY: () => 0,
    yToPrice: () => 0,
  });
  assert.equal(rc.ops.length, 0, 'no dock → silent no-op');
  const rc2 = recordCtx();
  c._d = [];
  nav._render({
    ctx: rc2.ctx,
    layout: { W, plotRight: W, main: { y0: 0, h: 300 }, dock: DOCK },
    palette: PAL,
    data: c.data,
    view: {},
    timeToX: (t) => c.timeToX(t),
    xToTime: (x) => c.xToTime(x),
    priceToY: () => 0,
    yToPrice: () => 0,
  });
  assert.equal(rc2.ops.length, 0);
});

/* ------------------------- pointer interactions ------------------------- */

test('pointer: drag the window body pans; range clamps at the strip edges', () => {
  const { c, nav } = fresh();
  // a half-width window first (a full-width window cannot pan)
  nav._layer.onPointer(ev('down', W - 1, DOCK.y0 + 10));
  nav._layer.onPointer(ev('move', 250, DOCK.y0 + 10));
  nav._layer.onPointer(ev('up', 250, DOCK.y0 + 10));
  assert.equal(nav._layer.onPointer(ev('down', 125, DOCK.y0 + 20)), true, 'inside window + inside dock → claimed');
  nav._layer.onPointer(ev('move', 375, DOCK.y0 + 20)); // drag right by half the strip
  assert.equal(c.ranges.length, 2);
  // window [0, 0.5] panned right by 0.5 of the strip (fractions of the 99h span)
  assert.equal(c.range.from, T0 + 0.5 * 99 * H);
  assert.equal(c.range.to, T0 + 99 * H);
  nav._layer.onPointer(ev('up', 375, DOCK.y0 + 20));
  assert.equal(nav._layer.onPointer(ev('move', 100, DOCK.y0 + 20)), false, 'unclaimed after up');
});

test('pointer: edge grabs resize, right edge stays inside the data', () => {
  const { c, nav } = fresh();
  assert.equal(nav._layer.onPointer(ev('down', W - 1, DOCK.y0 + 10)), true, 'right edge grab zone');
  console.error('DEBUG drag:', JSON.stringify(nav._drag), 'frac:', JSON.stringify(nav._currentFractions()));
  nav._layer.onPointer(ev('move', 250, DOCK.y0 + 10)); // window shrinks to half
  console.error('DEBUG ranges:', c.ranges.length, JSON.stringify(c.range));
  assert.equal(c.range.from, T0);
  assert.equal(c.range.to, T0 + 0.5 * 99 * H);
  nav._layer.onPointer(ev('up', 250, DOCK.y0 + 10));

  assert.equal(nav._layer.onPointer(ev('down', 1, DOCK.y0 + 10)), true, 'left edge grab zone');
  console.error('DEBUG2 drag:', JSON.stringify(nav._drag), 'frac:', JSON.stringify(nav._currentFractions()));
  nav._layer.onPointer(ev('move', 100, DOCK.y0 + 10));
  console.error('DEBUG2 range:', JSON.stringify(c.range));
  assert.equal(c.range.from, T0 + 0.2 * 99 * H);
  assert.equal(c.range.to, T0 + 0.5 * 99 * H);
});

test('pointer: click outside the window recenters on the click', () => {
  const { c, nav } = fresh({ height: DOCK.h });
  // a half-width window first: resize the right edge to bar 50
  nav._layer.onPointer(ev('down', W - 1, DOCK.y0 + 10));
  nav._layer.onPointer(ev('move', 250, DOCK.y0 + 10));
  nav._layer.onPointer(ev('up', 250, DOCK.y0 + 10));
  // click at bar 75, right of the [0..50] window → the half-width window
  // centers there: [0.5, 1] of the strip
  nav._layer.onPointer(ev('down', 375, DOCK.y0 + 10));
  assert.equal(c.range.from, T0 + 0.5 * 99 * H);
  assert.equal(c.range.to, T0 + 99 * H);
});

test('pointer: min span holds; pointer above the strip is not claimed', () => {
  const { c, nav } = fresh();
  // shrink as far as the right edge allows → min span (5 bars) holds
  nav._layer.onPointer(ev('down', W - 1, DOCK.y0 + 10));
  nav._layer.onPointer(ev('move', 1, DOCK.y0 + 10));
  nav._layer.onPointer(ev('up', 1, DOCK.y0 + 10));
  assert.ok(c.range.to - c.range.from >= 4.9 * H, 'window never below the 5-bar min span');
  assert.equal(nav._onPointer(ev('down', 0, 150)), false, 'above the dock → chart keeps the gesture');
});
