// PR #18 — wickchart/react: useWickChart hook + WickChart component.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

/* ------------------------- pure helpers ------------------------- */

test('toWickEventName maps shorthands and passes wick:* through', async () => {
  const { toWickEventName } = await import('../src/react-core.js');
  assert.equal(toWickEventName('range'), 'wick:range');
  assert.equal(toWickEventName('alert'), 'wick:alert');
  assert.equal(toWickEventName('wick:range'), 'wick:range');
});

test('toAttrName converts camelCase to kebab-case', async () => {
  const { toAttrName } = await import('../src/react-core.js');
  assert.equal(toAttrName('indicators'), 'indicators');
  assert.equal(toAttrName('volShading'), 'vol-shading');
});

test('splitChartProps separates attrs / events / dom / data', async () => {
  const { splitChartProps } = await import('../src/react-core.js');
  const onRange = () => {};
  const onSelect = () => {};
  const viaEvents = () => {};
  const style = { height: 420 };
  const split = splitChartProps({
    data: [1, 2],
    overlays: [{ type: 'level', price: 9 }],
    indicators: 'sma:20',
    volShading: true,
    onRange,
    onSelect,
    events: { alert: viaEvents },
    className: 'cx',
    style,
    id: 'chart',
    'aria-label': 'chart',
    'data-testid': 'wick',
  });
  assert.deepEqual(split.attrs, { indicators: 'sma:20', volShading: true });
  assert.equal(split.events.range, onRange);
  assert.equal(split.events.select, onSelect);
  assert.equal(split.events.alert, viaEvents);
  assert.deepEqual(Object.keys(split.dom).sort(), ['aria-label', 'className', 'data-testid', 'id', 'style']);
  assert.equal(split.dom.style, style);
  assert.equal(split.data[0], 1);
  assert.equal(split.overlays.length, 1, 'overlays prop is extracted (not sent to attrs/dom)');
});

class FakeEl {
  constructor() {
    this.map = new Map();
    this.setCalls = 0;
    this.data = null;
  }
  setAttribute(k, v) { this.setCalls++; this.map.set(k, String(v)); }
  getAttribute(k) { return this.map.has(k) ? this.map.get(k) : null; }
  hasAttribute(k) { return this.map.has(k); }
  removeAttribute(k) { this.map.delete(k); }
}

test('applyChartProps writes attributes with true→empty-string normalization', async () => {
  const { applyChartProps } = await import('../src/react-core.js');
  const el = new FakeEl();
  applyChartProps(el, { attrs: { indicators: 'sma:20', volShading: true, theme: 'dark' }, data: null });
  assert.equal(el.getAttribute('indicators'), 'sma:20');
  assert.equal(el.getAttribute('vol-shading'), '');
  assert.equal(el.getAttribute('theme'), 'dark');
});

test('applyChartProps is a no-op for identical values (guarded writes)', async () => {
  const { applyChartProps } = await import('../src/react-core.js');
  const el = new FakeEl();
  applyChartProps(el, { attrs: { indicators: 'sma:20' } });
  const before = el.setCalls;
  applyChartProps(el, { attrs: { indicators: 'sma:20' } });
  assert.equal(el.setCalls, before, 'identical value must not re-set the attribute');
});

test('applyChartProps removes attributes for false/null and assigns data by identity', async () => {
  const { applyChartProps } = await import('../src/react-core.js');
  const el = new FakeEl();
  applyChartProps(el, { attrs: { volShading: true }, data: ['a'] });
  assert.ok(el.hasAttribute('vol-shading'));
  assert.deepEqual(el.data, ['a']);
  applyChartProps(el, { attrs: { volShading: false }, data: ['a'] });
  assert.ok(!el.hasAttribute('vol-shading'), 'false removes the attribute');
  const calls = el.setCalls;
  applyChartProps(el, { attrs: {}, data: ['a'] });
  assert.equal(el.setCalls, calls, 'same array reference must not reassign el.data');
  applyChartProps(el, { attrs: {}, data: ['a', 'b'] });
  assert.deepEqual(el.data, ['a', 'b'], 'a fresh array triggers the update');
});

/* ------------------------- entry contract ------------------------- */

test('wickchart/react entry defines the element and re-exports the bindings', async () => {
  const src = read('src/react.js');
  assert.match(src, /import\s+'.\/wick-chart\.js'/, 'must import wick-chart.js for its side effect');
  assert.match(src, /export\s+{[^}]*WickChart[^}]*}/, 'must re-export WickChart');
  assert.match(src, /export\s+{[^}]*useWickChart[^}]*}/, 'must re-export useWickChart');

  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.exports['./react'].default, './src/react.js');
  assert.equal(pkg.exports['./react'].types, './types/react.d.ts');
  assert.equal(pkg.peerDependencies.react, '>=16.8');
  assert.equal(pkg.peerDependenciesMeta.react.optional, true, 'react must be an optional peer');
  assert.ok(pkg.sideEffects.includes('src/react.js'), 'react entry must be marked side-effectful');
});

test('wickchart/react imports SSR-clean in bare node', async () => {
  const mod = await import('../src/react.js');
  const React = await import('react');
  assert.equal(typeof mod.useWickChart, 'function');
  // forwardRef components are objects, not functions — the contract is "valid component type"
  assert.ok(React.isValidElement(React.createElement(mod.WickChart)), 'WickChart is a valid component type');
  assert.equal(mod.default, mod.WickChart);
});

/* ------------------------- jsdom mount ------------------------- */

test('WickChart component: mount, attrs, data, events, cleanup', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'https://wickchart.test/',
  });
  const g = globalThis;
  // Node 22 exposes `navigator` (and friends) as getter-only built-ins — capture
  // descriptors and reinstall with defineProperty.
  const GLOBAL_KEYS = [
    'window', 'document', 'navigator', 'HTMLElement', 'customElements', 'CustomEvent',
    'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT',
  ];
  const savedDescs = GLOBAL_KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(g, k)]);
  const setGlobal = (k, v) => Object.defineProperty(g, k, { value: v, writable: true, configurable: true });
  setGlobal('window', dom.window);
  setGlobal('document', dom.window.document);
  setGlobal('navigator', dom.window.navigator);
  setGlobal('HTMLElement', dom.window.HTMLElement);
  setGlobal('customElements', dom.window.customElements);
  setGlobal('CustomEvent', dom.window.CustomEvent);
  setGlobal('MutationObserver', dom.window.MutationObserver);
  setGlobal('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window));
  setGlobal('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window));
  setGlobal('IS_REACT_ACT_ENVIRONMENT', true);

  try {
    // Minimal stand-in for <wick-chart> modeling the REAL element contract:
    // `data` is a getter-only accessor; bars go in through setData() — the
    // binding must not try to assign el.data directly. Overlays arrive via
    // setOverlays().
    class FakeChart extends dom.window.HTMLElement {
      setData(bars) { this._data = bars; }
      get data() { return this._data ?? null; }
      setOverlays(list) { this._overlays = list; this.overlayCalls = (this.overlayCalls || 0) + 1; }
    }
    dom.window.customElements.define('wick-chart', FakeChart);

    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { WickChart } = await import('../src/react-core.js');
    const h = React.createElement;
    const dispatch = (type, detail) =>
      el.dispatchEvent(new dom.window.CustomEvent(type, { detail }));

    const bars = [
      { time: 1, open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      { time: 2, open: 10.5, high: 11.5, low: 10, close: 11, volume: 110 },
    ];
    const seen = [];
    const onRange = (e) => seen.push(['range', e.detail]);
    const onAlert = (e) => seen.push(['alert', e.detail]);

    const container = dom.window.document.getElementById('root');
    const root = createRoot(container);

    await React.act(async () => {
      root.render(h(WickChart, {
        data: bars, indicators: 'sma:20 volume', volshading: true,
        className: 'cx', onRange, onAlert,
      }));
    });
    const el = container.querySelector('wick-chart');
    assert.ok(el, 'renders a <wick-chart> element');
    assert.equal(el.getAttribute('indicators'), 'sma:20 volume');
    assert.ok(el.hasAttribute('volshading'), 'boolean true renders as an empty attribute');
    assert.equal(el.className, 'cx');
    assert.equal(el.data, bars, 'data prop assigns the bar array as a property');

    await React.act(async () => { dispatch('wick:range', { i0: 2, i1: 9 }); });
    assert.deepEqual(seen.at(-1), ['range', { i0: 2, i1: 9 }], 'onRange receives wick:range');
    await React.act(async () => { dispatch('wick:alert', { price: 12.5 }); });
    assert.deepEqual(seen.at(-1), ['alert', { price: 12.5 }], 'onAlert receives wick:alert');

    // Fresh data array → property reassigned
    const bars2 = [...bars, { time: 3, open: 11, high: 12, low: 10.5, close: 11.8, volume: 90 }];
    await React.act(async () => {
      root.render(h(WickChart, {
        data: bars2, indicators: 'sma:20 volume', volshading: true,
        className: 'cx', onRange, onAlert,
      }));
    });
    assert.equal(el.data, bars2, 'new array reference updates el.data');

    // Boolean prop flips false → attribute removed
    await React.act(async () => {
      root.render(h(WickChart, {
        data: bars2, indicators: 'sma:20 volume', volshading: false,
        className: 'cx', onRange, onAlert,
      }));
    });
    assert.ok(!el.hasAttribute('volshading'), 'false removes the attribute');

    // overlays prop → setOverlays(), guarded by array identity
    const zones = [{ type: 'level', price: 11 }, { type: 'zone', priceFrom: 10, priceTo: 12 }];
    await React.act(async () => {
      root.render(h(WickChart, { data: bars2, overlays: zones, onAlert }));
    });
    assert.equal(el.overlayCalls, 1, 'overlays prop calls setOverlays once');
    await React.act(async () => {
      root.render(h(WickChart, { data: bars2, overlays: zones, onAlert }));
    });
    assert.equal(el.overlayCalls, 1, 'same array reference does not re-apply overlays');
    await React.act(async () => {
      root.render(h(WickChart, { data: bars2, overlays: [...zones, { type: 'level', price: 9 }], onAlert }));
    });
    assert.equal(el.overlayCalls, 2, 'a fresh array re-applies overlays');

    // Dropping an on* prop unsubscribes just that event
    await React.act(async () => {
      root.render(h(WickChart, { data: bars2, indicators: 'sma:20', onAlert }));
    });
    const seenBefore = seen.length;
    await React.act(async () => { dispatch('wick:range', { i0: 0 }); });
    assert.equal(seen.length, seenBefore, 'removed onRange no longer fires');

    // Unmount removes every subscription
    await React.act(async () => { root.unmount(); });
    await React.act(async () => { dispatch('wick:alert', { price: 99 }); });
    assert.equal(seen.length, seenBefore, 'no events fire after unmount');
    assert.equal(container.querySelector('wick-chart'), null, 'element removed from the DOM');
  } finally {
    for (const [k, desc] of savedDescs) {
      if (desc) Object.defineProperty(g, k, desc);
      else delete g[k];
    }
  }
});
