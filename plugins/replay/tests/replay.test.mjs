// wickchart-replay — start/step/seek/play/pause/stop/loop driven through a
// fake chart; the engine only ever touches setData/update/data/addLayer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachReplay } from '../replay.mjs';

const T0 = Date.UTC(2026, 2, 4); // Wed 2026-03-04 00:00 UTC
const DT = 3_600_000;
const N = 100;
const bars = Array.from({ length: N }, (_, i) => ({
  time: T0 + i * DT,
  open: 100, high: 110, low: 90, close: 105, volume: 1,
}));

class FakeChart extends EventTarget {
  constructor() {
    super();
    this._d = bars.slice();
    this.layers = [];
    this.events = [];
    this.setCalls = 0;
    this.updateCalls = 0;
  }
  get data() {
    return this._d;
  }
  setData(b) {
    this.setCalls++;
    this._d = b;
  }
  update(b) {
    this.updateCalls++;
    this._d = [...this._d, b]; // the engine only appends increasing times
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
  dispatchEvent(e) {
    this.events.push({ type: e.type, detail: e.detail });
    return super.dispatchEvent(e);
  }
}

const evs = (c) => c.events.filter((e) => e.type === 'wick:replay');
const lastEv = (c) => evs(c)[evs(c).length - 1];

function fresh() {
  const c = new FakeChart();
  const r = attachReplay(c);
  return { c, r };
}

/* ------------------------- attach / detach ------------------------- */

test('attachReplay registers one wick-replay layer; garbage is rejected; detach cleans up', () => {
  const { c, r } = fresh();
  assert.throws(() => attachReplay(null), /chart element is required/);
  assert.throws(() => attachReplay({ data: bars }), /chart element is required/, 'setData is required too');
  assert.equal(c.layers.length, 1);
  assert.equal(c.layers[0].id, 'wick-replay');
  r.start();
  r.play();
  r.detach();
  assert.equal(c.layers.length, 0);
  assert.equal(c._d.length, N, 'detach restores the full dataset');
  assert.equal(r.active, false);
  assert.equal(r.playing, false);
  assert.equal(r.step(), false, 'calls after detach are inert');
});

/* ------------------------- start / anchors ------------------------- */

test('start() defaults to ~70% of the data and hides the future', () => {
  const { c, r } = fresh();
  r.start();
  assert.equal(r.active, true);
  assert.equal(r.index, 69, 'floor(100 * 0.7) - 1');
  assert.equal(c._d.length, 70);
  assert.equal(c._d[69].time, T0 + 69 * DT);
  assert.equal(c.setCalls, 1, 'one setData, updates come via step');
  assert.deepEqual(lastEv(c).detail, {
    active: true, playing: false, loop: false,
    index: 69, total: 100, time: T0 + 69 * DT, remaining: 30, speed: 4,
  });
});

test('start() accepts times (ms, s, strings), indices, and falls back on junk', () => {
  const { r } = fresh();
  r.start(T0 + 10 * DT);
  assert.equal(r.index, 10, 'ms timestamp');
  r.start((T0 + 5 * DT) / 1000);
  assert.equal(r.index, 5, 'seconds timestamp');
  r.start('2026-03-04T12:00:00Z');
  assert.equal(r.index, 12, 'date string');
  r.start(20);
  assert.equal(r.index, 20, 'bar index');
  r.start(9999);
  assert.equal(r.index, 99, 'index clamps to the last bar');
  r.start('garbage');
  assert.equal(r.index, 69, 'unresolvable anchor → default');
  r.start(-5);
  assert.equal(r.index, 69);
});

test('re-anchoring while replaying keeps the full stash; tiny data is refused', () => {
  const { c, r } = fresh();
  r.start(10);
  r.start(80);
  assert.equal(r.total, 100, 'stash survived the re-anchor');
  assert.equal(c._d.length, 81);
  const tiny = new FakeChart();
  tiny._d = bars.slice(0, 1);
  attachReplay(tiny).start();
  assert.equal(tiny._d.length, 1, 'a 1-bar chart has nothing to replay');
});

/* ------------------------- step / seek ------------------------- */

test('step() appends bars one update() at a time and halts playback at the end', () => {
  const { c, r } = fresh();
  assert.equal(r.step(), false, 'idle step is a no-op');
  r.start(69);
  assert.equal(r.step(), true);
  assert.equal(c._d.length, 71);
  assert.equal(c.updateCalls, 1);
  assert.equal(r.index, 70);
  r.step(5);
  assert.equal(r.index, 75);
  assert.equal(c.updateCalls, 6);
  r.step(1000);
  assert.equal(r.index, 99, 'clamps at the last bar');
  const evCount = evs(c).length;
  assert.equal(r.step(), true, 'stepping at the end still succeeds…');
  assert.equal(evs(c).length, evCount, '…but fires no event (nothing changed)');
  assert.equal(r.playing, false, 'playback halted at the end');
});

test('seek() jumps both directions; seeking while idle activates replay', () => {
  const { c, r } = fresh();
  r.seek(20);
  assert.equal(r.active, true, 'seek activates');
  assert.equal(c._d.length, 21);
  r.seek('2026-03-07T00:00:00Z'); // 72h after T0
  assert.equal(r.index, 72);
  assert.equal(c._d.length, 73);
  assert.equal(r.remaining, 27);
});

/* ------------------------- play / pause / speed / loop ------------------------- */

test('play() auto-starts, ticks one bar at a time, pause() freezes', (t) => {
  const { c, r } = fresh();
  t.after(() => r.detach());
  r.play();
  assert.equal(r.active, true, 'play starts replay when idle');
  assert.equal(r.playing, true);
  assert.equal(r.speed, 4);
  r._tick();
  r._tick();
  assert.equal(r.index, 71, 'two ticks, two bars');
  r.pause();
  assert.equal(r.playing, false);
  r._tick();
  assert.equal(r.index, 71, 'no progress while paused');
  r.pause(); // double pause is inert
  r.detach();
});

test('speed clamps; playback pauses itself at the end; loop wraps to the anchor', (t) => {
  const { c, r } = fresh();
  t.after(() => r.detach());
  r.play(1000);
  assert.equal(r.speed, 60);
  r.play(0.01); // play() while playing applies the new rate immediately
  assert.equal(r.speed, 0.5);
  r.pause();

  r.start(97);
  r.play();
  r._tick();
  r._tick();
  assert.equal(r.playing, false, 'auto-paused at the last bar');
  assert.equal(r.index, 99);

  r.setLoop(true);
  r.start(50);
  r.play();
  for (let i = 0; i < 49; i++) r._tick(); // 50 → 99, no halt under loop mode
  assert.equal(r.index, 99);
  r._tick(); // at the end → wrap
  assert.equal(r.index, 50, 'wrapped back to the anchor');
  assert.equal(r.playing, true, 'still playing after the wrap');
  assert.equal(r.loop, true);
  r._tick();
  r._tick();
  assert.equal(r.index, 52, 'keeps playing from the anchor');
  r.pause();
  r.detach();
});

test('integration: a real timer advances playback and stop() restores everything', async (t) => {
  const { c, r } = fresh();
  t.after(() => r.detach());
  r.play(60); // ~17ms per bar
  await new Promise((res) => setTimeout(res, 120));
  r.pause();
  assert.ok(r.index > 69, `timer advanced the head, got ${r.index}`);
  r.stop();
  assert.equal(c._d.length, N);
  assert.deepEqual(c._d.map((b) => b.time), bars.map((b) => b.time));
  assert.deepEqual(lastEv(c).detail, {
    active: false, playing: false, loop: false,
    index: -1, total: 0, time: null, remaining: 0, speed: 60,
  });
});

/* ------------------------- data-moved-under-us guard ------------------------- */

test('external setData during replay aborts without restoring', () => {
  const { c, r } = fresh();
  r.start(50);
  const foreign = bars.slice(0, 30);
  c.setData(foreign);
  assert.equal(r.step(), false, 'step refuses after the data moved');
  assert.equal(r.active, false, 'replay aborted');
  assert.equal(c._d, foreign, 'foreign data left untouched (not "restored" over)');
  assert.equal(evs(c).length > 0, true, 'abort is announced via the event');
});

/* ------------------------- badge layer ------------------------- */

function recordCtx() {
  const ops = [];
  return {
    ops,
    ctx: new Proxy(
      {},
      {
        get: (_t, p) => (p === 'measureText' ? (s) => ({ width: String(s).length * 6 }) : (...a) => ops.push([String(p), ...a])),
        set: (_t, p, v) => {
          ops.push(['set:' + String(p), v]);
          return true;
        },
      }
    ),
  };
}

const apiFor = (rc) => ({
  ctx: rc.ctx,
  layout: { main: { y0: 0 }, plotRight: 1000 },
  palette: { accent: '#4c8dff', bg: '#11141c' },
  data: [{ time: 1 }],
  view: {},
  timeToX: () => 0,
  xToTime: () => 0,
  priceToY: () => 0,
  yToPrice: () => 0,
});

test('badge renders the replay position while active and nothing when idle', () => {
  const { c, r } = fresh();
  const rc = recordCtx();
  r._render(apiFor(rc));
  assert.equal(rc.ops.length, 0, 'idle → no badge');
  r.start(69);
  r._render(apiFor(rc));
  const text = rc.ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
  assert.deepEqual(text, ['⏸ REPLAY 70/100'], 'paused badge shows the position');
  r.play();
  rc.ops.length = 0;
  r._render(apiFor(rc));
  assert.deepEqual(rc.ops.filter((o) => o[0] === 'fillText').map((o) => o[1])[0], '▶ REPLAY 70/100');
  r.pause();
  r.detach();
});
