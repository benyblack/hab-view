// wickchart-compare — the layer: attach/detach, rebase switching, line and
// legend rendering through a fake chart + recording canvas context.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachCompare } from '../compare.mjs';

const T0 = Date.UTC(2026, 2, 4);
const H = 3_600_000;
const N = 100;
const PX = 5; // px per bar
const mainBars = Array.from({ length: N }, (_, i) => ({
  time: T0 + i * H, open: 1, high: 2, low: 0.5, close: 1, volume: 1,
}));
const ethBars = Array.from({ length: N }, (_, i) => ({ time: T0 + i * H, close: 100 + i }));
const lateBars = Array.from({ length: N - 50 }, (_, i) => ({ time: T0 + (50 + i) * H, close: 100 + 50 + i }));
const valBars = Array.from({ length: N }, (_, i) => ({ time: T0 + i * H, value: 200 + 2 * i }));

class FakeChart extends EventTarget {
  constructor() {
    super();
    this._d = mainBars.slice(); // own copy — tests may replace it
    this.layers = [];
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
  timeToX(t) {
    return ((t - T0) / H) * PX;
  }
  xToTime(x) {
    return T0 + (x / PX) * H;
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

const apiFor = (c, rc, pan = 0, width = N * PX) => ({
  ctx: rc.ctx,
  layout: { plotRight: width, main: { y0: 0, h: 300 } },
  palette: PAL,
  data: c.data,
  view: {},
  timeToX: (t) => c.timeToX(t) - pan * PX,
  xToTime: (x) => c.xToTime(x + pan * PX),
  priceToY: () => 0,
  yToPrice: () => 0,
});

function fresh(opts = {}) {
  const c = new FakeChart();
  const cmp = attachCompare(c, opts);
  const rc = recordCtx();
  return { c, cmp, rc, api: apiFor(c, rc) };
}

const texts = (rc) => rc.ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
const strokes = (rc) => rc.ops.filter((o) => o[0] === 'lineTo').length;

/* ------------------------- attach / config ------------------------- */

test('attachCompare registers one wick-compare layer; guards; detach cleans up', () => {
  const { c, cmp } = fresh();
  assert.throws(() => attachCompare(null), /chart element is required/);
  assert.equal(c.layers.length, 1);
  assert.equal(c.layers[0].id, 'wick-compare');
  cmp.setSeries([{ label: 'ETH', data: ethBars }]);
  assert.equal(cmp.count, 1);
  cmp.clear();
  assert.equal(cmp.count, 0);
  assert.equal(cmp.rebase, 'first', 'default rebase');
  cmp.setRebase('bogus');
  assert.equal(cmp.rebase, 'first', 'junk rebase ignored');
  cmp.setRebase('visible');
  assert.equal(cmp.rebase, 'visible');
  cmp.detach();
  assert.equal(c.layers.length, 0);
});

/* ------------------------- render ------------------------- */

test('render: one stroke path per series, sampled onto the main bars', () => {
  const { cmp, rc, api } = fresh();
  cmp.setSeries([
    { label: 'ETH', data: ethBars, color: '#f0b90b' },
    { label: 'R', op: 'ratio', a: ethBars, b: valBars },
  ]);
  cmp._render(api);
  assert.equal(rc.ops.filter((o) => o[0] === 'moveTo').length, 2, 'one path start per series');
  assert.equal(strokes(rc), 2 * (N - 1), 'each line spans all 100 bars');
  assert.deepEqual(texts(rc), ['ETH +99.00%', 'R 0.5000'], 'legend shows pct + raw ratio');
});

test('render: late-starting series draws a shorter line and gaps break strokes', () => {
  const { cmp, rc, api } = fresh();
  cmp.setSeries([{ label: 'LATE', data: lateBars }]);
  cmp._render(api);
  assert.equal(rc.ops.filter((o) => o[0] === 'moveTo').length, 1);
  assert.equal(strokes(rc), N - 1 - 50, 'only the sampled range is drawn');
  assert.deepEqual(texts(rc), ['LATE +32.67%'], 'chip: last sampled value (199) vs its own first sample (150)');
});

test('render: panned window + visible rebase re-anchors at the window edge', () => {
  const c = new FakeChart();
  const cmp = attachCompare(c);
  cmp.setSeries([{ label: 'ETH', data: ethBars }]);
  const rc = recordCtx();
  // view panned 20 bars in: window covers bars 20..70
  cmp._render(apiFor(c, rc, 20, 50 * PX));
  assert.deepEqual(texts(rc), ['ETH +70.00%'], 'first mode: pct is still relative to the dataset start');
  const rc2 = recordCtx();
  cmp.setRebase('visible');
  cmp._render(apiFor(c, rc2, 20, 50 * PX));
  assert.deepEqual(texts(rc2), ['ETH +41.67%'], 'visible mode anchors at bar 20 (170/120 − 1)');
});

test('render: semantic colors resolve; uncolored series cycle default tints', () => {
  const { cmp, rc, api } = fresh();
  cmp.setSeries([
    { label: 'A', data: ethBars, color: 'up' },
    { label: 'B', data: ethBars },
  ]);
  cmp._render(api);
  const styles = rc.ops.filter((o) => o[0] === 'set:strokeStyle').map((o) => o[1]);
  assert.equal(styles[0], PAL.up);
  assert.equal(styles[1], '#a78bfa', 'uncolored series take tints by their position in the list');
});

test('render: nothing to draw — empty data, no series, or all series outside the window', () => {
  const { c, cmp, rc } = fresh();
  cmp._render(apiFor(c, rc));
  assert.equal(rc.ops.length, 0, 'no series configured');
  cmp.setSeries([{ label: 'X', data: [{ time: T0 + 500 * H, close: 1 }, { time: T0 + 501 * H, close: 2 }] }]);
  cmp._render(apiFor(c, rc));
  assert.equal(rc.ops.length, 0, 'series entirely outside the visible window');
  cmp.setSeries([{ label: 'ETH', data: ethBars }]);
  c._d = [];
  cmp._render(apiFor(c, rc));
  assert.equal(rc.ops.length, 0, 'empty chart data');
});
