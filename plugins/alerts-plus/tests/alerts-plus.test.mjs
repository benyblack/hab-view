// wickchart-alerts-plus — persistence, restore, fire-side effects (webhook,
// once-drop) and lifecycle, through a core-faithful fake chart + a Map
// storage stub. Notification/beep paths are visibility-gated and guarded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAlertsPlus } from '../alerts-plus.mjs';

const T0 = Date.UTC(2026, 2, 4);
const bar = { time: T0, open: 1, high: 2, low: 0.5, close: 1, volume: 1 };

/** Mirrors the core semantics the plugin relies on. */
class FakeChart extends EventTarget {
  constructor() {
    super();
    this._alerts = [];
    this._seq = 0;
    this.fired = []; // wick:alert details dispatched manually via fire()
  }
  addAlert(a) {
    if (!a) return null;
    let alert;
    if (typeof a.when === 'string' && a.when.trim()) {
      alert = { id: a.id != null ? String(a.id) : 'alert-' + ++this._seq, when: a.when.trim(), once: a.once !== false, fired: false };
    } else if (typeof a.price === 'number' && Number.isFinite(a.price)) {
      alert = { id: a.id != null ? String(a.id) : 'alert-' + ++this._seq, price: a.price, direction: a.direction || 'cross', once: a.once !== false, fired: false };
    } else {
      return null;
    }
    const i = this._alerts.findIndex((x) => x.id === alert.id);
    if (i >= 0) this._alerts[i] = alert;
    else this._alerts.push(alert);
    return alert.id;
  }
  removeAlert(id) {
    this._alerts = this._alerts.filter((a) => a.id !== String(id));
  }
  clearAlerts() {
    this._alerts = [];
  }
  getState() {
    return { alerts: this._alerts.map((a) => ({ ...a })) };
  }
  /** Core behavior on fire: wick:alert + once removal. */
  fire(id, detail = {}) {
    const a = this._alerts.find((x) => x.id === id);
    const d = { id, price: a && a.price != null ? a.price : 1, bar, ...detail };
    this.dispatchEvent(new CustomEvent('wick:alert', { detail: d }));
    if (a && a.once) this._alerts = this._alerts.filter((x) => x !== a);
    return d;
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
  const ap = attachAlertsPlus(chart, { storage, ...opts });
  return { chart, ap, storage };
}

const stored = (s, key = 'wickchart-alerts') => JSON.parse(s.dump()[key] || '[]');

/* ------------------------- attach / guard ------------------------- */

test('attachAlertsPlus guards its input', () => {
  assert.throws(() => attachAlertsPlus(null), /chart element is required/);
  assert.throws(() => attachAlertsPlus({ addEventListener() {} }), /chart element is required/);
});

/* ------------------------- persistence ------------------------- */

test('add persists a serializable snapshot; invalid adds are not persisted', () => {
  const { ap, storage } = fresh();
  const id = ap.add({ price: 100, direction: 'above', once: false });
  ap.add({ when: 'rsi(close,14) < 30' });
  assert.equal(ap.add({}), null, 'no price/when → chart rejects → null → not persisted');
  const list = stored(storage);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { id, once: false, price: 100, direction: 'above' });
  assert.equal(list[1].when, 'rsi(close,14) < 30');
  assert.equal(list[1].once, true, 'once defaults true, mirroring the core');
  assert.ok(!('fired' in list[0]) && !('compiled' in list[1]), 'snapshots stay serializable');
});

test('restore re-arms persisted alerts on a fresh chart', () => {
  const chart = new FakeChart();
  const { ap, storage } = fresh({ key: 'eth:1h' }, chart);
  ap.add({ id: 'a1', price: 100, direction: 'above' });
  ap.add({ id: 'a2', when: 'volume > sma(volume,20) * 2' });

  const chart2 = new FakeChart();
  attachAlertsPlus(chart2, { storage, key: 'eth:1h' });
  assert.deepEqual(chart2.getState().alerts.map((a) => a.id), ['a1', 'a2']);
  assert.equal(chart2.getState().alerts[0].price, 100);
  assert.equal(chart2.getState().alerts[0].fired, false, 'restored alerts re-arm');
  assert.equal(chart2.getState().alerts[1].once, true);
  // a different key stays isolated
  const other = new FakeChart();
  attachAlertsPlus(other, { storage, key: 'other' });
  assert.equal(other.getState().alerts.length, 0);
});

test('storage failures and junk payloads degrade to in-memory, never throw', () => {
  const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() {} };
  const { ap } = fresh({ storage: broken });
  assert.equal(ap.add({ price: 5 }), 'alert-1', 'add still works without storage');
  assert.deepEqual(ap.list().map((a) => a.price), [5]);
  const junk = storageStub();
  junk.setItem('wickchart-alerts', '{not json');
  const chart = new FakeChart();
  attachAlertsPlus(chart, { storage: junk });
  assert.equal(chart.getState().alerts.length, 0, 'junk storage → nothing restored');
  const notList = storageStub();
  notList.setItem('wickchart-alerts', '{"weird": true}');
  attachAlertsPlus(new FakeChart(), { storage: notList });
});

/* ------------------------- fire side effects ------------------------- */

test('a fired once-alert drops out of storage; non-once stays', async () => {
  const { chart, ap, storage } = fresh();
  const onceId = ap.add({ price: 100 });
  const keepId = ap.add({ price: 200, once: false });
  chart.fire(onceId, { price: 100 });
  await new Promise((r) => setTimeout(r, 0)); // the save is deferred past the core's once-removal
  assert.deepEqual(stored(storage).map((a) => a.id), [keepId], 'once-fired gone after the fire event');
  chart.fire(keepId, { price: 200 });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(stored(storage).map((a) => a.id), [keepId], 'non-once stays persisted');
});

test('webhook posts the fire payload; rejections are swallowed', async () => {
  const calls = [];
  const fetchStub = (url, init) => {
    calls.push({ url, init: JSON.parse(init.body) });
    return Promise.reject(new Error('offline')); // must not throw outward
  };
  const { chart } = fresh({ webhook: 'https://example.com/hook', fetch: fetchStub });
  const id = chart.addAlert({ price: 42, once: false });
  chart.fire(id);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.com/hook');
  assert.equal(calls[0].init.id, id);
  assert.equal(calls[0].init.price, 42);
  assert.equal(calls[0].init.bar.time, T0);
  assert.equal(calls[0].init.key, 'wickchart-alerts');
  // no webhook configured → nothing posted
  const quiet = fresh();
  const id2 = quiet.chart.addAlert({ price: 1, once: false });
  quiet.chart.fire(id2);
  await new Promise((r) => setTimeout(r, 5));
});

test('remove / clear / sync / detach keep storage in step; detached fires do nothing', () => {
  const { chart, ap, storage } = fresh();
  const a = ap.add({ price: 1, once: false });
  ap.add({ price: 2, once: false });
  ap.remove(a);
  assert.deepEqual(stored(storage).map((x) => x.price), [2]);
  // an alert added directly on the chart is captured by the next save point
  chart.addAlert({ price: 3, once: false });
  ap.sync();
  assert.deepEqual(stored(storage).map((x) => x.price), [2, 3]);
  ap.clear();
  assert.deepEqual(stored(storage), []);
  ap.add({ price: 9, once: false });
  ap.detach();
  const fire = () => chart.fire(chart.addAlert({ price: 10, once: false }));
  assert.doesNotThrow(fire, 'detached plugin ignores fires');
  assert.deepEqual(stored(storage).map((x) => x.price), [9], 'no writes after detach');
});

test('list() mirrors the live chart state; requestNotify degrades off-DOM', async () => {
  const { chart, ap } = fresh();
  ap.add({ price: 7, direction: 'below', once: false });
  assert.deepEqual(ap.list(), [{ id: ap.list()[0].id, once: false, price: 7, direction: 'below' }]);
  chart.removeAlert(ap.list()[0].id);
  assert.equal(ap.list().length, 0);
  const perm = await ap.requestNotify();
  assert.equal(typeof perm, 'string', 'off-DOM requestNotify resolves, never throws');
});
