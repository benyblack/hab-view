// PR #56 — correctness hardening around the real-time trading edge cases:
// repeating alerts, alert evaluation order, backfill suppression, and the
// seconds-vs-milliseconds timestamp heuristic.
//
// These are behavioural tests: they drive the real prototype methods over a
// duck-typed chart (the idiom the layer/presence tests already use) rather
// than asserting on source text, because every bug fixed here passed the
// existing source-shape and pure-function tests while being broken at runtime.
import test from 'node:test';
import assert from 'node:assert/strict';

const { WickChart } = await import('../src/wick-chart.js');
const P = WickChart.prototype;

/** A minimal object satisfying the slice of the element contract alerts touch. */
function makeChart(bars = []) {
  const chart = {
    _alerts: [],
    _seq: 0,
    _cache: { v: -1, map: {} },
    _version: 0,
    _data: bars,
    _hover: null,
    _dt: 3600e3,
    fires: [],
    _invalidate() {},
    _computeDt() {},
    _updateAria() {},
    _fire(name, detail) { this.fires.push({ name, ...detail }); },
  };
  chart.addAlert = P.addAlert.bind(chart);
  chart._checkAlerts = P._checkAlerts.bind(chart);
  chart._predicateCache = P._predicateCache.bind(chart);
  chart.update = P.update.bind(chart);
  return chart;
}

const mkBars = (closes, t0 = 1_700_000_000_000) =>
  closes.map((c, i) => ({
    time: t0 + i * 3600e3,
    open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 100,
  }));

/* ------------------------- repeating price alerts ------------------------- */

test('a once:false price alert fires on every crossing, not just the first', () => {
  const chart = makeChart();
  chart.addAlert({ id: 'repeating', price: 100, direction: 'cross', once: false });

  // up through 100, back down through 100, up through 100 again
  for (const [prev, cur] of [[99, 101], [101, 99], [99, 101]]) {
    chart._checkAlerts(prev, { time: Date.now(), close: cur });
  }

  assert.equal(chart.fires.length, 3, 'three crossings produce three alerts');
  assert.ok(chart.fires.every((f) => f.id === 'repeating'));
  assert.equal(chart._alerts.length, 1, 'the alert stays registered');
});

test('a once:true price alert fires once and is removed', () => {
  const chart = makeChart();
  chart.addAlert({ id: 'single', price: 100, direction: 'cross', once: true });

  for (const [prev, cur] of [[99, 101], [101, 99], [99, 101]]) {
    chart._checkAlerts(prev, { time: Date.now(), close: cur });
  }

  assert.equal(chart.fires.length, 1, 'only the first crossing fires');
  assert.equal(chart._alerts.length, 0, 'a once-alert drops out of the list');
});

/* --------------------- WickScript window performance --------------------- */

test('hh/ll match a naive rolling window, including warm-up gaps', async () => {
  const { evalScript } = await import('../src/core.js');
  const closes = [5, 3, 9, 9, 1, 7, 4, 4, 8, 2, 6];
  const bars = mkBars(closes);
  const naive = (vals, p, pick) =>
    vals.map((_, i) => (i < p - 1 ? NaN : vals.slice(i - p + 1, i + 1).reduce(pick)));

  for (const p of [1, 2, 3, 5, closes.length, closes.length + 3]) {
    assert.deepEqual(
      evalScript(`hh(close,${p})`, bars),
      naive(closes, p, (a, b) => Math.max(a, b)),
      `hh window ${p}`
    );
    assert.deepEqual(
      evalScript(`ll(close,${p})`, bars),
      naive(closes, p, (a, b) => Math.min(a, b)),
      `ll window ${p}`
    );
  }
});

test('a window containing a warm-up gap stays NaN', async () => {
  const { evalScript } = await import('../src/core.js');
  const bars = mkBars([1, 2, 3, 4, 5, 6]);
  // sma(close,3) is NaN for the first two bars; hh over it must not report
  // a max computed from a partially-warm window
  const v = evalScript('hh(sma(close,3), 3)', bars);
  assert.ok(Number.isNaN(v[2]), 'window still overlaps the warm-up gap');
  assert.ok(Number.isNaN(v[3]), 'window still overlaps the warm-up gap');
  assert.equal(v[4], 4, 'first fully-warm window'); // sma over [2,3,4]=3, [3,4,5]=4 → max 4
});

test('a large rolling window stays linear, not quadratic', async () => {
  const { evalScript, compileScript } = await import('../src/core.js');
  const n = 100000;
  const bars = mkBars(Array.from({ length: n }, (_, i) => 100 + Math.sin(i) * 10));
  const compiled = compileScript(`hh(close,${n / 2})`);

  const t0 = performance.now();
  evalScript(compiled, bars);
  const ms = performance.now() - t0;

  // O(n*p) here is ~5e9 comparisons (~1.6s measured). O(n) is a couple of ms,
  // so 150ms sits an order of magnitude clear of both outcomes.
  assert.ok(ms < 150, `hh over a 50k window took ${ms.toFixed(0)}ms — expected linear time`);
});

/* ------------------------- position P&L percent ------------------------- */

test('percent return is independent of position size', async () => {
  const { positionPnlPct } = await import('../src/core.js');
  // entry 100 → price 110 is +10%, however many units you hold
  for (const qty of [1, 10, 0.25]) {
    assert.equal(positionPnlPct({ side: 'long', entry: 100, qty }, 110), 10, `qty ${qty}`);
  }
});

test('percent return is signed by side', async () => {
  const { positionPnlPct } = await import('../src/core.js');
  assert.equal(positionPnlPct({ side: 'short', entry: 100, qty: 3 }, 90), 10, 'short profits as price falls');
  assert.equal(positionPnlPct({ side: 'long', entry: 100, qty: 3 }, 90), -10, 'long loses as price falls');
});

test('percent return is 0 for an unusable entry', async () => {
  const { positionPnlPct } = await import('../src/core.js');
  assert.equal(positionPnlPct({ side: 'long', entry: 0 }, 110), 0);
  assert.equal(positionPnlPct(null, 110), 0);
});

test('the HUD chip shows monetary P&L and percent return separately', () => {
  const chart = makeChart(mkBars([100, 110]));
  chart._positions = [{ id: 'p1', side: 'long', entry: 100, qty: 10 }];
  chart._poss = { innerHTML: '' };
  chart._precision = 2;
  chart._prec = P._prec.bind(chart);
  P._updateHud.call(chart);

  const html = chart._poss.innerHTML;
  assert.match(html, /\+100\b/, 'monetary P&L scales with the 10 units held');
  assert.match(html, /\+10\.00%/, 'percent return does not');
});

/* --------------------- seconds vs milliseconds --------------------- */

test('a pre-2001 millisecond timestamp survives normalization', () => {
  const t = Date.UTC(1999, 11, 31); // 946598400000 — below the old 1e12 cutoff
  const b = WickChart._normBar({ time: t, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 });
  assert.equal(b.time, t, 'a 1999 ms timestamp is not mistaken for seconds');
  assert.equal(new Date(b.time).getUTCFullYear(), 1999);
});

test('a seconds timestamp is still upscaled to milliseconds', () => {
  const secs = Math.floor(Date.UTC(2021, 5, 1) / 1000); // 1622505600
  const b = WickChart._normBar({ time: secs, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 });
  assert.equal(b.time, secs * 1000);
  assert.equal(new Date(b.time).getUTCFullYear(), 2021);
});

test('a Date is accepted as an unambiguous timestamp', () => {
  const d = new Date(Date.UTC(1962, 0, 15)); // predates any numeric heuristic
  const b = WickChart._normBar({ time: d, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 });
  assert.equal(b.time, d.getTime());
  assert.equal(new Date(b.time).getUTCFullYear(), 1962);
});

test('core and the element agree on what a timestamp means', async () => {
  const { toMs } = await import('../src/core.js');
  for (const t of [Date.UTC(1999, 11, 31), Date.UTC(2024, 0, 1), 1622505600, 0]) {
    assert.equal(toMs(t), WickChart._timeToMs(t), `same reading of ${t}`);
  }
});

test('VWAP anchors pre-2001 bars to the right day', async () => {
  const { calcVWAP } = await import('../src/core.js');
  const day1 = Date.UTC(1999, 11, 30);
  // two bars on one day, one on the next: VWAP resets on the day change
  const bars = [
    { time: day1, high: 10, low: 10, close: 10, volume: 1 },
    { time: day1 + 3600e3, high: 20, low: 20, close: 20, volume: 1 },
    { time: day1 + 24 * 3600e3, high: 30, low: 30, close: 30, volume: 1 },
  ];
  const v = calcVWAP(bars);
  assert.equal(v[1], 15, 'second bar averages with the first');
  assert.equal(v[2], 30, 'the new day resets the anchor');
});

test('the plugins read timestamps the same way the chart does', async () => {
  const t = Date.UTC(1999, 11, 31); // a real ms timestamp below the old cutoff
  const { normalizeSeries } = await import('../plugins/compare/core.mjs');
  const { normalizeDrawings } = await import('../plugins/draw/core.mjs');
  const { normalizeTrades } = await import('../plugins/tape/core.mjs');

  const [series] = normalizeSeries([{ label: 'A', data: [{ time: t, close: 10 }] }]);
  assert.equal(series.samples[0][0], t, 'compare: 1999 bar time preserved');

  const [drawing] = normalizeDrawings([{ type: 'hline', points: [{ t, p: 100 }] }]);
  assert.equal(drawing.points[0].t, t, 'draw: 1999 anchor preserved');

  const [trade] = normalizeTrades([{ time: t, price: 10, size: 1, side: 'buy' }]);
  assert.equal(trade.time, t, 'tape: 1999 print preserved');
});

/* ------------------- alert evaluation order & backfill ------------------- */

test('a scripted alert sees the incoming bar on the update that delivers it', () => {
  const chart = makeChart(mkBars([90, 90]));
  chart.addAlert({ id: 'breakout', when: 'close > 100', once: false });

  chart.update({ time: 1_700_000_000_000 + 2 * 3600e3, open: 90, high: 111, low: 90, close: 110, volume: 1 });

  assert.equal(chart.fires.length, 1, 'fires on the update carrying the breakout, not the next one');
  assert.equal(chart.fires[0].id, 'breakout');
});

test('appending a bar still fires a price alert on a real crossing', () => {
  const chart = makeChart(mkBars([90, 90]));
  chart.addAlert({ id: 'cross100', price: 100, direction: 'cross', once: false });

  chart.update({ time: 1_700_000_000_000 + 2 * 3600e3, open: 90, high: 111, low: 90, close: 110, volume: 1 });

  assert.equal(chart.fires.length, 1, 'a genuine upward crossing fires');
});

test('a backfilled historical bar does not fire live price alerts', () => {
  const chart = makeChart(mkBars([100, 100, 100]));
  chart.addAlert({ id: 'cross95', price: 95, direction: 'cross', once: false });

  // a correction for a bar BEFORE the current front of the series
  chart.update({ time: 1_700_000_000_000 - 3600e3, open: 90, high: 91, low: 89, close: 90, volume: 1 });

  assert.equal(chart.fires.length, 0, 'historical corrections are not live signals');
  assert.equal(chart._data.length, 4, 'but the bar is still inserted');
  assert.equal(chart._data[0].close, 90, 'inserted in time order at the front');
});

test('replacing the still-forming last bar can fire a price alert', () => {
  const chart = makeChart(mkBars([90, 90]));
  chart.addAlert({ id: 'cross100', price: 100, direction: 'cross', once: false });
  const lastTime = chart._data[chart._data.length - 1].time;

  // same timestamp → the forming candle ticks up through 100
  chart.update({ time: lastTime, open: 90, high: 111, low: 89, close: 110, volume: 2 });

  assert.equal(chart.fires.length, 1, 'the forming candle crossing 100 is a live signal');
  assert.equal(chart._data.length, 2, 'the bar was replaced, not appended');
});

/* ------------------------- React data identity ------------------------- */

/**
 * Stand-in for <wick-chart> that reproduces the REAL setData() contract: the
 * element normalizes the incoming array into a fresh one, so `el.data` never
 * equals the array React passed in. (The existing pr18 fake stores the array
 * as-is, which is what let the re-ingest bug hide.)
 */
function makeElementStub() {
  return {
    setDataCalls: 0,
    _data: [],
    get data() { return this._data; },
    setData(bars) {
      this.setDataCalls++;
      this._data = bars.map((b) => ({ ...b })); // normalization → new identity
    },
    hasAttribute: () => false,
    getAttribute: () => null,
    setAttribute() {},
    removeAttribute() {},
  };
}

test('re-rendering with the same bars array does not re-ingest the data', async () => {
  const { applyChartProps } = await import('../src/react-core.js');
  const el = makeElementStub();
  const bars = mkBars([10, 11, 12]);

  for (let i = 0; i < 3; i++) applyChartProps(el, { attrs: {}, data: bars });

  assert.equal(el.setDataCalls, 1, 'identical array reference ingests exactly once');
});

test('re-rendering with a fresh bars array does re-ingest the data', async () => {
  const { applyChartProps } = await import('../src/react-core.js');
  const el = makeElementStub();

  applyChartProps(el, { attrs: {}, data: mkBars([10, 11, 12]) });
  applyChartProps(el, { attrs: {}, data: mkBars([10, 11, 12, 13]) });

  assert.equal(el.setDataCalls, 2, 'a new array reference is a real update');
  assert.equal(el.data.length, 4, 'the newest bars won');
});

test('a once:false scripted alert re-arms on a falling edge', () => {
  const chart = makeChart();
  chart.addAlert({ id: 'scripted', when: 'close > 100', once: false });

  // close walks above 100, back below, and above again — two rising edges
  const closes = [90, 110, 120, 90, 110];
  for (let i = 1; i <= closes.length; i++) {
    chart._data = mkBars(closes.slice(0, i));
    chart._version++;
    chart._checkAlerts(closes[i - 2], chart._data[i - 1]);
  }

  assert.equal(chart.fires.length, 2, 'two rising edges produce two alerts');
});
