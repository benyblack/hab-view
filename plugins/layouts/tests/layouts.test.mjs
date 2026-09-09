// wickchart-layouts — save/load/delete/rename/export/import through a fake
// chart + Map storage stub; drawings included via a fake DrawLayer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachLayouts } from '../layouts.mjs';

class FakeChart extends EventTarget {
  constructor() {
    super();
    this._state = {
      type: 'candles', theme: 'dark', indicators: 'volume', log: false,
      stats: false, profile: false, annotations: false, volshading: false,
      view: { from: 100, to: 200 }, positions: [], alerts: [],
    };
    this.applied = null;
  }
  getState() {
    return JSON.parse(JSON.stringify(this._state));
  }
  setState(s) {
    this.applied = s;
  }
}

class FakeDraw {
  constructor() {
    this.drawings = [];
    this.setCalls = 0;
  }
  getDrawings() {
    return JSON.parse(JSON.stringify(this.drawings));
  }
  setDrawings(list) {
    this.drawings = list;
    this.setCalls++;
  }
}

function storageStub() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

function fresh(opts = {}, chart = new FakeChart()) {
  const storage = storageStub();
  const layouts = attachLayouts(chart, { storage, ...opts });
  return { chart, layouts, storage };
}

const events = (c) => c.events || [];

function watch(chart) {
  chart.events = [];
  chart.addEventListener('wick:layouts', (e) => chart.events.push({ type: e.type, ...e.detail }));
  return chart;
}

/* ------------------------- attach / guard ------------------------- */

test('attachLayouts guards its input', () => {
  assert.throws(() => attachLayouts(null), /chart element is required/);
  assert.throws(() => attachLayouts({ setState() {} }), /chart element is required/);
});

/* ------------------------- save / load ------------------------- */

test('save + load round-trip state and drawings; same name replaces', () => {
  const chart = watch(new FakeChart());
  const draw = new FakeDraw();
  const { layouts, storage } = fresh({ drawings: draw, key: 'desk' }, chart);
  draw.drawings = [{ type: 'hline', points: [{ t: 1, p: 2 }] }];
  assert.equal(layouts.save('swing'), true);
  assert.equal(layouts.save('swing'), true, 'same name replaces, not duplicates');

  chart._state.type = 'line';
  assert.equal(layouts.load('swing'), true);
  assert.equal(chart.applied.type, 'candles', 'the saved state came back');
  assert.equal(chart.applied.view.to, 200);
  assert.equal(draw.setCalls, 1);
  assert.deepEqual(draw.drawings, [{ type: 'hline', points: [{ t: 1, p: 2 }] }]);

  const list = layouts.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'swing');
  assert.equal(list[0].drawingCount, 1);
  assert.ok(JSON.stringify(storage.dump()).includes('swing'));
  const ev = events(chart).pop();
  assert.deepEqual({ ...ev, type: ev.type }, { type: 'wick:layouts', action: 'load', name: 'swing' });
});

test('list() is newest first; delete/load-missing/name rules', () => {
  const { layouts } = fresh();
  layouts.save('first');
  layouts.save('second');
  assert.deepEqual(layouts.list().map((l) => l.name), ['second', 'first']);
  assert.equal(layouts.delete('first'), true);
  assert.equal(layouts.delete('first'), false);
  assert.equal(layouts.load('first'), false, 'unknown name → false');
  assert.equal(layouts.save('   '), false, 'blank name rejected');
  assert.equal(layouts.save('x'.repeat(99)).constructor, Boolean);
  assert.equal(layouts.list()[0].name.length, 40, 'names are capped at 40 chars');
});

test('cap evicts the oldest layouts', () => {
  const { layouts } = fresh({ cap: 3 });
  layouts.save('a');
  layouts.save('b');
  layouts.save('c');
  layouts.save('d');
  assert.deepEqual(layouts.list().map((l) => l.name), ['d', 'c', 'b'], 'a (oldest) evicted');
});

test('rename: moves an entry, refuses collisions and unknowns', () => {
  const { layouts } = fresh();
  layouts.save('a');
  layouts.save('b');
  assert.equal(layouts.rename('a', 'b'), false, 'target name taken');
  assert.equal(layouts.rename('nope', 'c'), false);
  assert.equal(layouts.rename('a', 'a2'), true);
  assert.deepEqual(layouts.list().map((l) => l.name), ['b', 'a2']);
});

/* ------------------------- export / import ------------------------- */

test('export/import round-trips and merges with replacement', () => {
  const { layouts } = fresh();
  layouts.save('a');
  layouts.save('b');
  const json = layouts.export();
  const other = fresh();
  assert.equal(other.layouts.import(json), 2);
  assert.deepEqual(other.layouts.list().map((l) => l.name).sort(), ['a', 'b']);
  // same-name entries are replaced on import
  other.layouts.save('a'); // a local 'a' with fresh state
  const again = other.layouts.import(layouts.export());
  assert.equal(again, 2, 'both merged; the local "a" was replaced');
  // junk payloads merge nothing
  assert.equal(layouts.import('not json'), 0);
  assert.equal(layouts.import({ nope: 1 }), 0);
  assert.equal(layouts.import([{ name: 'x' }]), 0, 'entry without state rejected');
});

/* ------------------------- storage degradation + detach ------------------------- */

test('storage failures degrade to in-memory for the session; detach stops ops', () => {
  const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() {} };
  const chart = new FakeChart();
  const layouts = attachLayouts(chart, { storage: broken });
  assert.equal(layouts.save('mem'), true);
  assert.deepEqual(layouts.list().map((l) => l.name), ['mem'], 'in-memory store keeps the session');
  const junk = storageStub();
  junk.setItem('wickchart-layouts', '{broken');
  const l2 = attachLayouts(new FakeChart(), { storage: junk });
  assert.equal(l2.save('x'), true);
  assert.deepEqual(l2.list().map((l) => l.name), ['x']);
  layouts.detach();
  assert.equal(layouts.save('after'), false, 'no chart handle → save refuses');
});

/* ------------------------- events ------------------------- */

test('every mutation fires wick:layouts with action + name', () => {
  const chart = watch(new FakeChart());
  const { layouts } = fresh({}, chart);
  layouts.save('a');
  layouts.rename('a', 'b');
  layouts.delete('b');
  assert.deepEqual(
    events(chart).map((e) => e.action),
    ['save', 'rename', 'delete']
  );
  assert.equal(events(chart)[0].name, 'a');
});
