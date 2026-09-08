// PR #19 — horizontal wheel/touchpad pan direction fix.
// Wheel deltas are viewport-relative: deltaX>0 = "scroll right" = reveal newer
// bars. The old code did `rightIndex -= deltaX`, inverting the pan relative to
// the scrollbar convention and to pointer dragging on natural-scroll trackpads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WickChart } from '../src/wick-chart.js';

function makeChart() {
  return {
    _ly: { plotRight: 800 },
    _data: Array.from({ length: 200 }, (_, i) => i),
    _view: { spacing: 10, rightIndex: 100 },
    _auto: false,
    _atRight() { return false; },
    _minSpacing() { return 1; },
    _clampView() {},
    _invalidate() {},
    _emitRange() {},
    _localPoint() { return { x: 400, y: 200 }; },
    _indexForX() { return 40; },
    _stopPlayback() {},
  };
}

const wheel = (fake, props) =>
  WickChart.prototype._wheel.call(fake, {
    preventDefault() {},
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    ...props,
  });

test('horizontal wheel pans right: deltaX>0 increases rightIndex (newer bars revealed)', () => {
  const fake = makeChart();
  wheel(fake, { deltaX: 120 });
  assert.ok(fake._view.rightIndex > 100, `expected rightIndex > 100, got ${fake._view.rightIndex}`);
});

test('horizontal wheel pans left: deltaX<0 decreases rightIndex (older bars revealed)', () => {
  const fake = makeChart();
  wheel(fake, { deltaX: -120 });
  assert.ok(fake._view.rightIndex < 100, `expected rightIndex < 100, got ${fake._view.rightIndex}`);
});

test('a natural-scroll two-finger swipe pans the content along the fingers, same as drag', () => {
  // On natural-scrolling trackpads a rightward swipe emits deltaX<0, while a
  // pointer drag right gives pointerDx>0. Both must move the view the same way.
  const viaSwipe = makeChart();
  wheel(viaSwipe, { deltaX: -100 });
  const viaDrag = makeChart();
  viaDrag._view.rightIndex = viaDrag._view.rightIndex - 100 / viaDrag._view.spacing; // drag formula
  assert.equal(viaSwipe._view.rightIndex, viaDrag._view.rightIndex);
});

test('vertical wheel still zooms instead of panning', () => {
  const fake = makeChart();
  wheel(fake, { deltaX: 0, deltaY: 120 });
  assert.notEqual(fake._view.spacing, 10, 'deltaY must change the spacing (zoom)');
});

test('ctrl+wheel zooms even with a dominant horizontal component', () => {
  const fake = makeChart();
  wheel(fake, { deltaX: 500, deltaY: 10, ctrlKey: true });
  assert.notEqual(fake._view.spacing, 10, 'ctrl+horizontal must zoom, not pan');
});
