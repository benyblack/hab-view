// wickchart-tape — the layer: attach/detach, push/set/clear lifecycle, the
// tick-rule carry, dock sizing and rendering, through a fake chart + ctx.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachTape } from '../tape.mjs';
import { MAX_TRADES } from '../core.mjs';

const T0 = Date.UTC(2026, 8, 10, 12, 0, 0);
const W = 500;
const DOCK = { y0: 300, h: 128 };
const PAL = {
  accent: '#4c8dff', text: '#8b949e', bg: '#11141c', grid: '#22273a',
  up: '#26a69a', down: '#ef5350',
};

class FakeChart extends EventTarget {
  constructor() {
    super();
    this.layers = [];
    this.draws = 0;
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
}

function recordCtx() {
  const ops = [];
  return {
    ops,
    ctx: new Proxy(
      {},
      {
        get: (_t, p) => (...a) => ops.push([String(p), ...a.map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))]),
        set: (_t, p, v) => {
          ops.push(['set:' + String(p), v]);
          return true;
        },
      }
    ),
  };
}

const apiFor = (rc, dock = DOCK) => ({
  ctx: rc.ctx,
  layout: { W, plotRight: W, main: { y0: 0, h: 300 }, dock },
  palette: PAL,
  data: [],
  view: {},
  timeToX: () => 0,
  xToTime: () => 0,
  priceToY: () => 0,
  yToPrice: () => 0,
});

/* ------------------------- attach / detach ------------------------- */

test('attachTape registers a docked wick-tape layer; guards; detach', () => {
  const c = new FakeChart();
  assert.throws(() => attachTape(null), /chart element is required/);
  assert.throws(() => attachTape({}), /chart element is required/);
  const tape = attachTape(c);
  assert.equal(c.layers.length, 1);
  assert.equal(c.layers[0].id, 'wick-tape');
  assert.equal(c.layers[0].insetBottom, 7 * 18 + 2, 'default 7 rows');
  assert.equal(tape.rows, 7);
  tape.detach();
  assert.equal(c.layers.length, 0);
});

test('rows clamp 3..8 at construction and via setRows (dock stays under 160px)', () => {
  const c = new FakeChart();
  assert.equal(attachTape(c, { rows: 1 }).rows, 3);
  assert.equal(attachTape(c, { rows: 99 }).rows, 8);
  const c2 = new FakeChart();
  const tape = attachTape(c2);
  tape.setRows(4);
  assert.equal(tape.rows, 4);
  assert.equal(c2.layers[0].insetBottom, 4 * 18 + 2);
  tape.setRows(999);
  assert.equal(tape.rows, 8);
});

test('constructor accepts an initial backfill via opts.trades', () => {
  const c = new FakeChart();
  const tape = attachTape(c, { trades: [{ time: T0, price: 5, size: 1 }] });
  assert.equal(tape.trades.length, 1);
  tape.detach();
});

/* ------------------------- push / set / clear ------------------------- */

test('push: accepts single or batch, normalizes, fires wick:tape, repaints', () => {
  const c = new FakeChart();
  const tape = attachTape(c);
  const events = [];
  c.addEventListener('wick:tape', (e) => events.push(e.detail));
  const n = tape.push({ time: T0, price: 100.5, size: 2, side: 'b' });
  assert.equal(n, 1);
  assert.deepEqual(tape.trades[0], { time: T0, price: 100.5, size: 2, side: 'buy' });
  tape.push([
    { time: T0 + 1000, price: 101, size: 1 },
    { time: 'nope', price: 1, size: 1 }, // dropped
  ]);
  assert.equal(tape.trades.length, 2);
  assert.deepEqual(events, [
    { action: 'push', added: 1, total: 1 },
    { action: 'push', added: 1, total: 2 },
  ]);
  assert.ok(c.draws > 0);
  assert.equal(tape.push(null), 0);
  assert.equal(tape.push([]), 0);
});

test('push: the tick rule carries across calls', () => {
  const c = new FakeChart();
  const tape = attachTape(c);
  tape.push({ time: T0, price: 100, size: 1 });
  tape.push({ time: T0 + 1, price: 101, size: 1 });
  tape.push({ time: T0 + 2, price: 100.5, size: 1 });
  assert.deepEqual(tape.trades.map((t) => t.side), [null, 'buy', 'sell']);
});

test('push caps at MAX_TRADES keeping the newest prints', () => {
  const c = new FakeChart();
  const tape = attachTape(c);
  tape.set(Array.from({ length: MAX_TRADES - 10 }, (_, i) => ({ time: T0 + i, price: 1, size: 1 })));
  tape.push(Array.from({ length: 30 }, (_, i) => ({ time: T0 + 10000 + i, price: 2, size: 1 })));
  assert.equal(tape.trades.length, MAX_TRADES);
  assert.equal(tape.trades[0].time, T0 + 20, 'oldest dropped');
  assert.equal(tape.trades[tape.trades.length - 1].time, T0 + 10029, 'newest kept');
});

test('set replaces and resets the tick rule; set keeps the newest when over cap', () => {
  const c = new FakeChart();
  const tape = attachTape(c);
  tape.push({ time: T0, price: 100, size: 1 });
  tape.push({ time: T0 + 1, price: 101, size: 1 });
  tape.set([{ time: T0 + 100, price: 50, size: 1 }, { time: T0 + 101, price: 49, size: 1 }]);
  assert.deepEqual(tape.trades.map((t) => t.side), [null, 'sell'], 'inference restarts within the set');
  const many = Array.from({ length: MAX_TRADES + 5 }, (_, i) => ({ time: T0 + i, price: 1, size: 1 }));
  tape.set(many);
  assert.equal(tape.trades.length, MAX_TRADES);
  assert.equal(tape.trades[0].time, T0 + 5, 'newest 500 kept, not the oldest');
});

test('clear empties the tape and fires', () => {
  const c = new FakeChart();
  const tape = attachTape(c);
  const events = [];
  c.addEventListener('wick:tape', (e) => events.push(e.detail));
  tape.push({ time: T0, price: 1, size: 1 });
  tape.clear();
  assert.equal(tape.trades.length, 0);
  assert.deepEqual(events[1], { action: 'clear', total: 0 });
});

/* ------------------------- visibility / dock ------------------------- */

test('hide frees the dock, show restores it; hidden render paints nothing', () => {
  const c = new FakeChart();
  const tape = attachTape(c);
  tape.push({ time: T0, price: 100, size: 1 });
  tape.hide();
  assert.equal(tape.visible, false);
  assert.equal(c.layers[0].insetBottom, 0, 'dock released');
  const rc = recordCtx();
  tape._render(apiFor(rc));
  assert.equal(rc.ops.length, 0, 'hidden → silent');
  tape.show();
  assert.equal(c.layers[0].insetBottom, 7 * 18 + 2);
});

/* ------------------------- render ------------------------- */

function fresh(nPrints = 3, opts = {}) {
  const c = new FakeChart();
  const tape = attachTape(c, opts);
  for (let i = 0; i < nPrints; i++) {
    tape.push({ time: T0 + i * 500, price: 100 + i * 0.5, size: i === nPrints - 1 ? 25 : 2 });
  }
  const rc = recordCtx();
  tape._render(apiFor(rc));
  return { tape, rc };
}

test('render: opaque backing, separator, time+price+size text, size bar', () => {
  const { rc } = fresh();
  assert.ok(rc.ops.length > 0);
  assert.deepEqual(rc.ops.find((o) => o[0] === 'fillRect')?.slice(1), [0, DOCK.y0, W, DOCK.h], 'own pixels first');
  const texts = rc.ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
  assert.equal(texts.length, 9, '3 rows × time+price+size (wide chart)');
  assert.ok(texts.includes('100.00'), 'price with inferred decimals');
  assert.ok(texts.includes('25'), 'size column');
  assert.ok(rc.ops.some((o) => o[0] === 'fillRect' && o[3] <= 90 && o[4] === 12), 'proportional size bar');
});

test('render: sides color the price text (up/down palette)', () => {
  const c = new FakeChart();
  const tape = attachTape(c);
  tape.push({ time: T0, price: 100, size: 1 }); // first → null side
  tape.push({ time: T0 + 1, price: 101, size: 1 }); // buy
  tape.push({ time: T0 + 2, price: 100, size: 1 }); // sell
  const rc = recordCtx();
  tape._render(apiFor(rc));
  const styles = rc.ops.filter((o) => o[0] === 'set:fillStyle').map((o) => o[1]);
  assert.ok(styles.includes(PAL.up), 'buy row uses pal.up');
  assert.ok(styles.includes(PAL.down), 'sell row uses pal.down');
});

test('render: bigSize highlights the row with a tint; narrow chart drops the time column', () => {
  const { rc } = fresh(3, { bigSize: 10 });
  const rowTint = rc.ops.filter((o) => o[0] === 'fillRect' && o[3] === W && o[4] === 18);
  assert.equal(rowTint.length, 1, 'one oversized print → one row tint');

  const c = new FakeChart();
  const tape = attachTape(c);
  tape.push({ time: T0, price: 100, size: 1 });
  const rcSlim = recordCtx();
  tape._render({ ...apiFor(rcSlim), layout: { W: 240, plotRight: 240, main: { y0: 0, h: 300 }, dock: { y0: 300, h: 128 } } });
  const slimTexts = rcSlim.ops.filter((o) => o[0] === 'fillText');
  assert.equal(slimTexts.length, 2, 'price+size only below the time-column width');
});

test('render: no dock (old core) or no prints → paints nothing', () => {
  const c = new FakeChart();
  const tape = attachTape(c);
  const rc = recordCtx();
  tape._render({ ...apiFor(rc), layout: { W, plotRight: W, main: { y0: 0, h: 300 }, dock: null } });
  assert.equal(rc.ops.length, 0);
  const rc2 = recordCtx();
  tape._render(apiFor(rc2));
  assert.equal(rc2.ops.length, 0);
  tape.push({ time: T0, price: 1, size: 1 });
  const rc3 = recordCtx();
  tape._render(apiFor(rc3));
  assert.ok(rc3.ops.length > 0);
});

/* ------------------------- toBars / detach ------------------------- */

test('toBars aggregates the kept prints', () => {
  const c = new FakeChart();
  const tape = attachTape(c);
  tape.push([
    { time: T0, price: 100, size: 1 },
    { time: T0 + 500, price: 101, size: 1 },
    { time: T0 + 61000, price: 102, size: 1 },
  ]);
  const bars = tape.toBars(60000);
  assert.equal(bars.length, 2);
  assert.deepEqual(bars[0], { time: T0, open: 100, high: 101, low: 100, close: 101, volume: 2 });
});

test('detach: layer removed; pushes after detach are no-ops', () => {
  const c = new FakeChart();
  const tape = attachTape(c);
  tape.detach();
  assert.equal(c.layers.length, 0);
  assert.equal(tape.push({ time: T0, price: 1, size: 1 }), 0);
  assert.doesNotThrow(() => tape.clear());
});
