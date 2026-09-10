// PR #28 — delta brush: drag-select bars with range statistics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const { brushStats } = await import('../src/core.js');
const { WickChart } = await import('../src/wick-chart.js');

const bars = Array.from({ length: 20 }, (_, i) => ({
  time: 1700000000000 + i * 3600e3,
  open: 100 + i,
  close: 100.5 + i,
  high: 101 + i,
  low: 99.5 + i,
  volume: 10 + i,
}));

/* ------------------------- brushStats ------------------------- */

test('brushStats: delta from first open to last close, extremes + Σvol', () => {
  const s = brushStats(bars, 2, 5); // opens 102..105, closes 102.5..105.5
  assert.equal(s.bars, 4);
  assert.deepEqual(s.from, { index: 2, time: bars[2].time });
  assert.deepEqual(s.to, { index: 5, time: bars[5].time });
  assert.equal(s.delta, 105.5 - 102);
  assert.ok(Math.abs(s.deltaPct - ((3.5 / 102) * 100)) < 1e-9);
  assert.equal(s.high, 106);
  assert.equal(s.low, 101.5);
  assert.equal(s.volume, 12 + 13 + 14 + 15);
  assert.equal(s.firstOpen, 102);
  assert.equal(s.lastClose, 105.5);
});

test('brushStats: single bar + degenerate ranges', () => {
  const one = brushStats(bars, 7, 7);
  assert.equal(one.bars, 1);
  assert.equal(one.delta, bars[7].close - bars[7].open);
  assert.equal(brushStats(bars, 5, 2), null);
  assert.equal(brushStats(bars, -1, 3), null);
  assert.equal(brushStats(bars, 0, 20), null);
  assert.equal(brushStats([], 0, 1), null);
});

/* ------------------------- commit + event ------------------------- */

function fakeChart() {
  const events = [];
  return {
    events,
    _data: bars,
    _brushSel: null,
    _brushDrag: null,
    _invalidate() { this.invalidations = (this.invalidations || 0) + 1; },
    _fire(name, detail) { events.push({ name, detail }); },
    clearBrush: WickChart.prototype.clearBrush,
    get brushSelection() {
      return Object.getOwnPropertyDescriptor(WickChart.prototype, 'brushSelection').get.call(this);
    },
  };
}

const call = (fake, m, ...a) => WickChart.prototype[m].call(fake, ...a);

test('_brushFinish commits the selection and fires wick:brush with stats', () => {
  const f = fakeChart();
  call(f, '_brushFinish', 3, 8);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].name, 'brush');
  assert.equal(f.events[0].detail.bars, 6);
  assert.equal(f._brushSel.i0, 3);
  assert.equal(f._brushSel.i1, 8);
  const sel = f.brushSelection;
  assert.deepEqual([sel.i0, sel.i1], [3, 8]);
  sel.stats.delta = 999; // getter hands out copies
  assert.notEqual(f.brushSelection.stats.delta, 999);

  call(f, '_brushFinish', -5, 2); // invalid range → cleared, no event
  assert.equal(f.events.length, 1);
  assert.equal(f._brushSel, null);
});

test('clearBrush is idempotent and resets both committed and live state', () => {
  const f = fakeChart();
  call(f, '_brushFinish', 0, 4);
  call(f, 'clearBrush');
  assert.equal(f._brushSel, null);
  call(f, 'clearBrush'); // no throw, no-op
  f._brushDrag = { i0: 1, i1: 2 };
  call(f, 'clearBrush');
  assert.equal(f._brushDrag, null);
});

/* ------------------------- component contract ------------------------- */

test('brush is wired into the chart: attribute, pointer flow, escape, draw', () => {
  const src = read('src/wick-chart.js');
  // read the real list rather than its literal spelling, so adding another
  // observed attribute cannot fail this test
  assert.ok(WickChart.observedAttributes.includes('brush'), 'brush is an observed attribute');
  const attr = src.slice(src.indexOf("case 'brush':"), src.indexOf("case 'brush':") + 200);
  assert.match(attr, /val !== 'false'/, 'brush="false" disables the mode');
  const pd = src.slice(src.indexOf('_pointerDown(e) {'), src.indexOf('_pointerDown(e) {') + 2200);
  assert.match(pd, /this\._brush && !e\.shiftKey/, 'plain drag brushes; shift still measures');
  assert.match(pd, /this\._brushDrag = \{ i0: idx, i1: idx \}/, 'drag starts a selection');
  assert.match(pd, /this\._brushDrag = null;/, 'pinch cancels a live brush');
  const pm = src.slice(src.indexOf('_pointerMove(e) {'), src.indexOf('_pointerUp(e) {'));
  assert.match(pm, /this\._brushDrag\.i1 = idx/, 'move extends the selection');
  const up = src.slice(src.indexOf('_pointerUp(e) {'), src.indexOf('_pointerUp(e) {') + 900);
  assert.match(up, /_brushFinish\(/, 'release commits via _brushFinish');
  const kd = src.slice(src.indexOf('_keydown(e) {'), src.indexOf('_keydown(e) {') + 400);
  assert.match(kd, /Escape/, 'Escape clears the selection');
  const draw = src.slice(src.indexOf('delta brush selection: band'), src.indexOf('visible-range stats chip'));
  assert.ok(draw.length > 400, 'draw block present');
  assert.match(draw, /pal\.accent/, 'band uses the accent color');
  assert.match(draw, /brushStats\(this\._data, bi0, bi1\)/, 'live stats while dragging');
  assert.match(draw, /deltaPct/, 'chip shows the delta %');
  const sd = src.slice(src.indexOf('setData(bars) {'), src.indexOf('setData(bars) {') + 300);
  assert.match(sd, /clearBrush\(\)/, 'setData clears stale selections');
});

test('docs cover the delta brush: attribute, event, getter, semantics', () => {
  const docs = read('docs.html');
  const sec = docs.slice(docs.indexOf('id="brush"'), docs.indexOf('id="ai"'));
  assert.ok(sec.length > 1200, 'brush section is substantive');
  for (const s of ['wick:brush', 'brushSelection', 'clearBrush', 'deltaPct', 'volume', 'Esc']) {
    assert.ok(sec.includes(s), `"${s}" missing from the docs section`);
  }
  assert.ok(docs.includes('href="#brush"'), 'TOC links the section');
  assert.ok(read('README.md').includes('Delta brush'), 'README documents the brush');
});
