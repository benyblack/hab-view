// wickchart-draw — the interaction layer: create/select/move/anchor/delete/
// undo flows driven through a fake chart (EventTarget + linear transforms).
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachDrawings } from '../draw.mjs';

const T0 = 1_700_000_000_000;
const DT = 3_600_000;
const P0 = 100; // price at y = 100…0 maps 200..100
const bars = Array.from({ length: 100 }, (_, i) => ({
  time: T0 + i * DT,
  open: 105 + i * 0.1,
  high: 130 + i * 0.1,
  low: 90 + i * 0.1,
  close: 108 + i * 0.1,
  volume: 100,
}));

class FakeChart extends EventTarget {
  constructor() {
    super();
    this.data = bars;
    this.layers = [];
    this.draws = 0;
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
    this.draws++;
  }
  dispatchEvent(e) {
    this.events.push({ type: e.type, detail: e.detail });
    return super.dispatchEvent(e);
  }
  // linear space: 10px per bar, 1px per price unit, price 200 at y=0
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

const ctx = new Proxy(
  {},
  {
    get: (_t, prop) => {
      if (prop === 'measureText') return (s) => ({ width: String(s).length * 6 });
      return () => {};
    },
    set: () => true,
  }
);

const apiFor = (c) => ({
  ctx,
  layout: { plotRight: 1000, main: { y0: 0, y1: 100, h: 100 } },
  palette: { accent: '#4c8dff', up: '#16c784', down: '#ea3943', text: '#8b949e', bg: '#11141c' },
  data: c.data,
  view: { rightIndex: 99, spacing: 10 },
  timeToX: (t) => c.timeToX(t),
  xToTime: (x) => c.xToTime(x),
  priceToY: (p) => c.priceToY(p),
  yToPrice: (y) => c.yToPrice(y),
});

const ev = (type, x, y, extra = {}) => ({
  type,
  x,
  y,
  pointerId: 1,
  button: 0,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...extra,
});

function fresh(opts = {}) {
  const c = new FakeChart();
  const d = attachDrawings(c, { magnet: false, ...opts });
  return { c, d, api: apiFor(c) };
}

/* ------------------------- attach / detach ------------------------- */

test('attachDrawings registers one wick-draw layer; setTool validates; detach cleans up', () => {
  const { c, d } = fresh();
  assert.equal(c.layers.length, 1);
  assert.equal(c.layers[0].id, 'wick-draw');
  d.setTool('bogus');
  assert.equal(d.tool, null);
  d.setTool('trendline');
  assert.equal(d.tool, 'trendline');
  d.detach();
  assert.equal(c.layers.length, 0);
  assert.throws(() => attachDrawings(null), /chart element is required/);
});

/* ------------------------- create flows ------------------------- */

test('trendline: drag creates a drawing with anchored points, fires add', () => {
  const { c, d } = fresh();
  d.setTool('trendline');
  assert.equal(d._layer.onPointer(ev('down', 100, 50)), true, 'armed tool claims the down');
  assert.equal(d._layer.onPointer(ev('move', 300, 30)), true);
  assert.equal(d._layer.onPointer(ev('up', 300, 30)), true);
  const all = d.getDrawings();
  assert.equal(all.length, 1);
  assert.equal(all[0].type, 'trendline');
  assert.deepEqual(all[0].points, [
    { t: T0 + 10 * DT, p: 150 },
    { t: T0 + 30 * DT, p: 170 },
  ]);
  const added = c.events.find((e) => e.type === 'wick:drawings');
  assert.equal(added.detail.action, 'add');
  assert.equal(added.detail.drawings.length, 1);
  const sel = c.events.findLast((e) => e.type === 'wick:drawselect');
  assert.equal(sel.detail.id, all[0].id, 'the new drawing gets selected');
});

test('a click without travel does not create a 2-point drawing', () => {
  const { d } = fresh();
  d.setTool('trendline');
  d._layer.onPointer(ev('down', 100, 50));
  assert.equal(d._layer.onPointer(ev('up', 103, 51)), true);
  assert.equal(d.getDrawings().length, 0);
});

test('ray tool maps to a right-extended trendline', () => {
  const { d } = fresh();
  d.setTool('ray');
  d._layer.onPointer(ev('down', 100, 50));
  d._layer.onPointer(ev('move', 300, 50));
  d._layer.onPointer(ev('up', 300, 50));
  assert.equal(d.getDrawings()[0].extend, 'right');
});

test('hline and text commit on a single click', () => {
  const { d } = fresh();
  d.setTool('hline');
  d._layer.onPointer(ev('down', 100, 50));
  d._layer.onPointer(ev('up', 100, 50));
  d.setTool('text');
  d._layer.onPointer(ev('down', 200, 60));
  d._layer.onPointer(ev('up', 200, 60));
  const all = d.getDrawings();
  assert.deepEqual(all.map((x) => x.type), ['hline', 'text']);
  assert.equal(all[1].text, 'Note');
  assert.deepEqual(all[1].points, [{ t: T0 + 20 * DT, p: 140 }]);
});

test('cancel mid-create discards the draft', () => {
  const { d } = fresh();
  d.setTool('rect');
  d._layer.onPointer(ev('down', 100, 50));
  d._layer.onPointer(ev('move', 400, 30));
  d._layer.onPointer(ev('cancel', 400, 30));
  assert.equal(d.getDrawings().length, 0);
  assert.equal(d._mode, 'idle');
});

/* ------------------------- magnet ------------------------- */

test('magnet snaps creation anchors to bar time + nearest OHLC', () => {
  const c = new FakeChart();
  const d = attachDrawings(c, { magnet: true }); // default is on, explicit here
  d.setTool('trendline');
  d._layer.onPointer(ev('down', 105, 60.6)); // between bars 10/11, price 139.4
  d._layer.onPointer(ev('move', 305, 50.4));
  d._layer.onPointer(ev('up', 305, 50.4));
  const [a, b] = d.getDrawings()[0].points;
  // x=105 → t between bars 10 and 11 → snaps to bar 10 or 11's exact time
  assert.ok(a.t === T0 + 10 * DT || a.t === T0 + 11 * DT);
  // price 139.4 snaps to the nearest OHLC of that bar (high ≈ 131, close ≈ 109)
  assert.ok([105, 130, 90, 108].map((v) => v + 1).includes(a.p), `snapped p: ${a.p}`);
  assert.equal(d.magnet, true);
});

/* ------------------------- select / move / anchors ------------------------- */

test('select mode: click selects, body-drag moves, empty click deselects and does not claim', () => {
  const { c, d, api } = fresh();
  d.setDrawings([
    { type: 'trendline', points: [{ t: T0 + 10 * DT, p: 150 }, { t: T0 + 30 * DT, p: 170 }] },
  ]);
  d._render(api); // build hit targets
  const id = d.getDrawings()[0].id;

  // down exactly on the line midpoint: (100,50)→(300,30), at x=200 the line is y=40
  assert.equal(d._layer.onPointer(ev('down', 200, 40)), true);
  assert.equal(d.selectedId, id);
  assert.equal(c.events.findLast((e) => e.type === 'wick:drawselect').detail.id, id);
  // drag: Δx=+100px = +10 bars, Δy=+10px = −10 price
  d._layer.onPointer(ev('move', 300, 50));
  d._layer.onPointer(ev('up', 300, 50));
  const moved = d.getDrawings()[0].points;
  assert.deepEqual(moved, [
    { t: T0 + 20 * DT, p: 140 },
    { t: T0 + 40 * DT, p: 160 },
  ]);
  assert.equal(c.events.findLast((e) => e.type === 'wick:drawings').detail.action, 'move');

  // empty-space click: deselects and returns false (chart keeps the gesture)
  d._render(api);
  assert.equal(d._layer.onPointer(ev('down', 500, 10)), false);
  assert.equal(d.selectedId, null);
});

test('handle drag re-anchors one point (edit)', () => {
  const { c, d, api } = fresh();
  d.setDrawings([
    { type: 'trendline', points: [{ t: T0 + 10 * DT, p: 150 }, { t: T0 + 30 * DT, p: 170 }] },
  ]);
  d._render(api);
  const id = d.getDrawings()[0].id;
  d._select(id);
  d._render(api); // handles are rendered only for the selection
  const handle = d._hits.find((h) => h.kind === 'handle' && h.anchor === 0);
  assert.ok(handle, 'handle hit target exists');
  assert.equal(d._layer.onPointer(ev('down', handle.x, handle.y)), true);
  d._layer.onPointer(ev('move', 400, 40)); // → bar 40, price 160
  d._layer.onPointer(ev('up', 400, 40));
  const pts = d.getDrawings()[0].points;
  assert.deepEqual(pts[0], { t: T0 + 40 * DT, p: 160 });
  assert.deepEqual(pts[1], { t: T0 + 30 * DT, p: 170 }, 'second anchor untouched');
  assert.equal(c.events.findLast((e) => e.type === 'wick:drawings').detail.action, 'edit');
});

test('an armed tool wins over hitting an existing drawing', () => {
  const { d, api } = fresh();
  d.setDrawings([
    { type: 'trendline', points: [{ t: T0 + 10 * DT, p: 150 }, { t: T0 + 30 * DT, p: 170 }] },
  ]);
  d._render(api);
  d.setTool('hline');
  // click dead-center on the existing line — must CREATE, not select/move
  assert.equal(d._layer.onPointer(ev('down', 200, 40)), true);
  assert.equal(d._mode, 'create');
  d._layer.onPointer(ev('up', 200, 40));
  const all = d.getDrawings();
  assert.equal(all.length, 2);
  assert.equal(all[1].type, 'hline');
});

test('locked drawings select but never move', () => {
  const { d, api } = fresh();
  d.setDrawings([
    { type: 'trendline', locked: true, points: [{ t: T0 + 10 * DT, p: 150 }, { t: T0 + 30 * DT, p: 170 }] },
  ]);
  d._render(api);
  assert.equal(d._layer.onPointer(ev('down', 200, 40)), true, 'still claims (no pan-away)');
  assert.equal(d._mode, 'idle', 'no move mode on a locked drawing');
  d._layer.onPointer(ev('up', 200, 60));
  assert.deepEqual(d.getDrawings()[0].points[0], { t: T0 + 10 * DT, p: 150 });
});

/* ------------------------- delete / undo / persistence ------------------------- */

test('Delete key removes the selection; ignored while typing in an input', () => {
  const { c, d, api } = fresh();
  d.setDrawings([{ type: 'hline', points: [{ t: T0, p: 150 }] }]);
  d._render(api);
  d._select(d.getDrawings()[0].id);
  d._keydown({ key: 'Delete', target: { tagName: 'INPUT', isContentEditable: false }, preventDefault() {} });
  assert.equal(d.getDrawings().length, 1, 'Delete while focused on an input does nothing');
  d._keydown({ key: 'Delete', target: { tagName: 'CANVAS', isContentEditable: false }, preventDefault() {} });
  assert.equal(d.getDrawings().length, 0);
  assert.equal(c.events.findLast((e) => e.type === 'wick:drawings').detail.action, 'delete');
});

test('undo walks back through add → move → delete', () => {
  const { d, api } = fresh();
  d.setTool('trendline');
  d._layer.onPointer(ev('down', 100, 50));
  d._layer.onPointer(ev('move', 300, 30));
  d._layer.onPointer(ev('up', 300, 30));
  d.setTool(null);
  d._render(api);
  const id = d.getDrawings()[0].id;
  // the line (100,50)→(300,30) passes through (200,40)
  d._layer.onPointer(ev('down', 200, 40));
  d._layer.onPointer(ev('move', 300, 50));
  d._layer.onPointer(ev('up', 300, 50));
  d._select(id);
  d.deleteSelected();
  assert.equal(d.getDrawings().length, 0);
  assert.equal(d.undo(), true); // restores the deleted drawing (post-move)
  assert.equal(d.getDrawings().length, 1);
  assert.equal(d.undo(), true); // restores the pre-move position
  assert.deepEqual(d.getDrawings()[0].points[0], { t: T0 + 10 * DT, p: 150 });
  assert.equal(d.undo(), true); // restores the pre-add (empty) state
  assert.equal(d.getDrawings().length, 0);
  assert.equal(d.undo(), false);
});

test('cancel mid-move restores the pre-drag snapshot', () => {
  const { d, api } = fresh();
  d.setDrawings([{ type: 'hline', points: [{ t: T0, p: 150 }] }]);
  d._render(api);
  d._layer.onPointer(ev('down', 10, 50)); // on the hline (y=50 → p=150)
  d._layer.onPointer(ev('move', 400, 30));
  d._layer.onPointer(ev('cancel', 400, 30));
  assert.deepEqual(d.getDrawings()[0].points, [{ t: T0, p: 150 }]);
});

test('getDrawings returns deep copies; setDrawings normalizes and caps', () => {
  const { d } = fresh();
  d.setDrawings([{ type: 'hline', points: [{ t: 1, p: 2 }], color: 'up' }]);
  const got = d.getDrawings();
  got[0].points[0].p = 999;
  assert.equal(d.getDrawings()[0].points[0].p, 2);
  const bad = d.setDrawings([{ type: 'nope' }, { type: 'text', text: 'x', points: [{ t: 5, p: 5 }] }]);
  assert.equal(bad, d, 'chainable');
  assert.equal(d.getDrawings().length, 1);
});

/* ------------------------- render / hit targets ------------------------- */

test('render builds hit targets per type and clips to the main pane', () => {
  const { d, api } = fresh();
  d.setDrawings([
    { type: 'trendline', points: [{ t: T0 + 10 * DT, p: 150 }, { t: T0 + 30 * DT, p: 170 }] },
    { type: 'hline', points: [{ t: T0, p: 120 }] },
    { type: 'rect', points: [{ t: T0 + 40 * DT, p: 150 }, { t: T0 + 60 * DT, p: 130 }] },
    { type: 'fib', points: [{ t: T0 + 10 * DT, p: 170 }, { t: T0 + 40 * DT, p: 130 }] },
    { type: 'text', text: 'hello', points: [{ t: T0 + 20 * DT, p: 150 }] },
    { type: 'hline', visible: false, points: [{ t: T0, p: 190 }] },
  ]);
  d._render(api);
  const by = (id) => d._hits.filter((h) => h.id === id);
  const all = d.getDrawings();
  assert.equal(by(all[0].id).length, 1, 'trendline: one segment');
  assert.equal(by(all[1].id).length, 1, 'hline: one full-width segment');
  assert.equal(by(all[2].id).length, 4, 'rect: four edges');
  assert.equal(by(all[3].id).length, 7, 'fib: seven level segments');
  const box = by(all[4].id)[0];
  assert.equal(box.kind, 'box');
  assert.equal(box.maxX - box.minX, 'hello'.length * 6 + 4);
  assert.equal(by(all[5].id).length, 0, 'invisible drawings paint no hit targets');
  // hline hit spans the full plot width at the right price
  const h = by(all[1].id)[0];
  assert.equal(h.bx - h.ax, 1000);
  assert.equal(h.ay, 80, 'price 120 → y 80');
});
