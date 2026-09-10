// PR #57 — dataset integrity: one bar per timestamp, and O(log n) placement
// of out-of-order bars instead of a backward scan.
//
// REST history and a websocket handover routinely overlap, so the same final
// candle arrives twice; mergeOlderData() already deduplicates on backfill,
// but the initial setData() only sorted.
import test from 'node:test';
import assert from 'node:assert/strict';

const { WickChart } = await import('../src/wick-chart.js');
const P = WickChart.prototype;

/** Duck-typed chart exposing the real setData()/update() code paths. */
function makeChart(bars = []) {
  const chart = {
    _data: bars,
    _version: 0,
    _alerts: [],
    _seq: 0,
    _cache: { v: -1, map: {} },
    _hover: null,
    _dt: 3600e3,
    _needsFit: false,
    _noMore: false,
    _auto: true,
    _brushSel: null,
    _brushDrag: null,
    _alertEval: 'live',
    _lastClosedIdx: -1,
    _autoAttr: () => true,
    clearBrush() {},
    _computeDt() {},
    _updateAria() {},
    _invalidate() {},
    _fire() {},
  };
  for (const m of [
    'setData', 'update', 'clearData', '_checkAlerts', '_predicateCache',
    '_fireAlert', '_lastClosedIndex', '_syncClosedIdx', '_evalMode',
  ]) {
    chart[m] = P[m].bind(chart);
  }
  return chart;
}

const T0 = 1_700_000_000_000;
const bar = (i, close, extra) => ({
  time: T0 + i * 3600e3, open: close, high: close, low: close, close, volume: 1, ...extra,
});

/* ----------------------------- deduplication ----------------------------- */

test('setData keeps one bar per timestamp, last value winning', () => {
  const chart = makeChart();
  // the shape a REST + websocket handover produces: the final candle twice,
  // the second copy carrying the corrected close
  chart.setData([bar(0, 10), bar(1, 11), bar(1, 11.5), bar(2, 12)]);

  assert.equal(chart._data.length, 3, 'the duplicate timestamp collapses');
  assert.deepEqual(chart._data.map((b) => b.time), [T0, T0 + 3600e3, T0 + 2 * 3600e3]);
  assert.equal(chart._data[1].close, 11.5, 'the later value wins');
});

test('setData deduplicates unsorted input too', () => {
  const chart = makeChart();
  chart.setData([bar(2, 12), bar(0, 10), bar(1, 11), bar(0, 10.5)]);

  assert.equal(chart._data.length, 3);
  assert.deepEqual(chart._data.map((b) => b.time), [T0, T0 + 3600e3, T0 + 2 * 3600e3]);
  assert.equal(chart._data[0].close, 10.5, 'last occurrence wins regardless of order');
});

test('setData leaves already-unique data untouched', () => {
  const chart = makeChart();
  const bars = [bar(0, 10), bar(1, 11), bar(2, 12)];
  chart.setData(bars);
  assert.deepEqual(chart._data.map((b) => b.close), [10, 11, 12]);
});

/* -------------------------- out-of-order placement ------------------------ */

test('an out-of-order bar lands in time order wherever it belongs', () => {
  for (const at of [0, 1, 3, 5]) {
    const chart = makeChart();
    chart.setData([bar(0, 10), bar(2, 12), bar(4, 14), bar(6, 16), bar(8, 18)]);
    const t = T0 + (at * 2 + 1) * 3600e3; // strictly between two existing bars
    chart.update({ time: t, open: 1, high: 1, low: 1, close: 99, volume: 1 });

    const times = chart._data.map((b) => b.time);
    assert.deepEqual([...times].sort((x, y) => x - y), times, `sorted after inserting at ${at}`);
    assert.equal(chart._data.filter((b) => b.time === t).length, 1, 'inserted exactly once');
  }
});

test('an out-of-order bar with an existing timestamp replaces that bar', () => {
  const chart = makeChart();
  chart.setData([bar(0, 10), bar(1, 11), bar(2, 12)]);
  chart.update({ time: T0 + 3600e3, open: 1, high: 1, low: 1, close: 99, volume: 1 });

  assert.equal(chart._data.length, 3, 'no bar is added');
  assert.equal(chart._data[1].close, 99, 'the correction replaces it in place');
});

test('a bar older than everything goes to the front', () => {
  const chart = makeChart();
  chart.setData([bar(1, 11), bar(2, 12)]);
  chart.update({ time: T0, open: 1, high: 1, low: 1, close: 9, volume: 1 });

  assert.equal(chart._data.length, 3);
  assert.equal(chart._data[0].close, 9);
});

test('placing an out-of-order bar does not scan the whole series', () => {
  const n = 300000;
  const chart = makeChart();
  chart.setData(Array.from({ length: n }, (_, i) => bar(i, 100)));

  const t0 = performance.now();
  for (let k = 0; k < 500; k++) {
    // the worst case for a backward scan: older than every existing bar
    chart.update({ time: chart._data[0].time - 3600e3, open: 1, high: 1, low: 1, close: 1, volume: 1 });
  }
  const ms = performance.now() - t0;

  // measured: ~345ms scanning backwards, ~19ms with a binary search
  assert.ok(ms < 100, `500 front-inserts into ${n} bars took ${ms.toFixed(0)}ms — expected a binary search`);
});
