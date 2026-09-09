/**
 * wickchart-navigator — the range-slider strip as a wickchart plugin layer:
 * a silhouette of the full dataset docked at the bottom of the canvas with a
 * draggable viewport window (drag to pan, grab an edge to resize, click
 * outside the window to jump). Builds on the public layer API plus the
 * `insetBottom` dock hook — the core chart shrinks above the strip.
 *
 *   import { attachNavigator } from 'wickchart-navigator';
 *   const nav = attachNavigator(chart, { height: 46 });
 *   nav.detach();
 *
 * Nothing else to configure: panning/zooming the chart moves/resizes the
 * window, dragging the window pans the chart — both stay in sync live.
 */

import { profile, windowFractions, dragWindow } from './core.mjs';

const EDGE = 6; // px grab zone at each window edge
const MIN_SPAN_BARS = 5; // the window never collapses below this many bars

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function attachNavigator(chart, opts = {}) {
  return new Navigator(chart, opts);
}

export class Navigator {
  constructor(chart, opts = {}) {
    if (!chart || typeof chart.addLayer !== 'function' || typeof chart.setVisibleRange !== 'function') {
      throw new TypeError('attachNavigator(chart): the chart element is required');
    }
    this._chart = chart;
    this._height = Math.max(24, Math.min(120, Math.round(opts.height || 46)));
    this._drag = null; // { mode, grab }
    this._cache = { key: null, prof: null, t0: 0, t1: 1 }; // silhouette cache
    this._ly = null; // last render's layout (dock, W, plotRight)
    this._layer = {
      id: 'wick-navigator',
      insetBottom: this._height,
      draw: (api) => this._render(api),
      onPointer: (ev) => this._onPointer(ev),
    };
    chart.addLayer(this._layer);
  }

  get height() {
    return this._height;
  }

  detach() {
    try {
      this._chart.removeLayer('wick-navigator');
    } catch (_) {}
    this._chart = null;
  }

  /* ---------------- pointer ---------------- */

  _onPointer(ev) {
    if (!this._chart || ev.y == null) return false;
    const dock = this._ly && this._ly.dock;
    const W = this._ly && this._ly.W;
    if (!dock || !W || ev.y < dock.y0) return false; // above the strip → chart keeps it

    const f = Math.max(0, Math.min(1, ev.x / W));
    const [f0, f1] = this._currentFractions();

    if (ev.type === 'down') {
      const ex = ev.x;
      if (Math.abs(ex - f0 * W) <= EDGE) this._drag = { mode: 'l' };
      else if (Math.abs(ex - f1 * W) <= EDGE) this._drag = { mode: 'r' };
      else if (f > f0 && f < f1) this._drag = { mode: 'move', grab: f - f0 };
      else {
        // click outside the window: jump so it centers on the click
        const half = (f1 - f0) / 2;
        const [a, b] = dragWindow(f0, f1, 'move', f, half);
        this._drag = { mode: 'move', grab: half };
        this._apply(a, b);
        return true;
      }
      return true;
    }
    if (!this._drag) return false; // stray move/up outside a gesture
    if (ev.type === 'cancel') {
      this._drag = null;
      return true;
    }
    if (ev.type === 'move') {
      const [a, b] = dragWindow(f0, f1, this._drag.mode, f, this._drag.grab, this._minFrac());
      if (a !== f0 || b !== f1) this._apply(a, b);
      return true;
    }
    if (ev.type === 'up') {
      this._drag = null;
      return true;
    }
    return false;
  }

  _currentFractions() {
    const d = this._chart.data;
    const t1 = d.length ? d[d.length - 1].time : 1;
    const t0v = this._chart.xToTime(0);
    const t1v = this._chart.xToTime(this._ly ? this._ly.plotRight : 0);
    return windowFractions(d.length ? d[0].time : 0, t1, t0v, t1v) || [0, 1];
  }

  _minFrac() {
    const d = this._chart.data;
    return d.length ? Math.min(0.5, MIN_SPAN_BARS / d.length) : 0.01;
  }

  /** fractions → epoch window → the chart's public setVisibleRange. */
  _apply(f0, f1) {
    const d = this._chart.data;
    if (!d.length) return;
    const tFirst = d[0].time;
    const span = d[d.length - 1].time - tFirst || 1;
    this._chart.setVisibleRange({
      from: tFirst + f0 * span,
      to: tFirst + f1 * span,
    });
  }

  /* ---------------- render ---------------- */

  _render(api) {
    const { ctx, palette: pal, data } = api;
    const ly = api.layout;
    this._ly = ly;
    const dock = ly.dock;
    if (!dock || !data.length) return;
    const W = ly.W;
    const tFirst = data[0].time;
    const tLast = data[data.length - 1].time;

    // silhouette: O(n) once per (dataset, strip width) — cached otherwise
    const key = data.length + ':' + tLast + ':' + W;
    if (this._cache.key !== key) {
      this._cache = { key, prof: profile(data, W), t0: tFirst, t1: tLast };
    }
    const prof = this._cache.prof;

    let lo = Infinity;
    let hi = -Infinity;
    for (const b of prof) {
      if (b) {
        if (b.lo < lo) lo = b.lo;
        if (b.hi > hi) hi = b.hi;
      }
    }
    if (!isNum(lo) || !isNum(hi)) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, dock.y0, W, dock.h);
    ctx.clip();

    // opaque backing — the strip owns its pixels (crosshair et al. stay out)
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, dock.y0, W, dock.h);

    // price separator + silhouette
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(dock.y0) + 0.5);
    ctx.lineTo(W, Math.round(dock.y0) + 0.5);
    ctx.stroke();
    ctx.strokeStyle = pal.text;
    ctx.globalAlpha = 0.35;
    const pad = 4;
    const yOf = (p) => dock.y0 + pad + ((hi - p) / (hi - lo || 1)) * (dock.h - 2 * pad);
    ctx.beginPath();
    for (let i = 0; i < prof.length; i++) {
      const b = prof[i];
      if (!b) continue;
      ctx.moveTo(i + 0.5, Math.round(yOf(b.lo)) + 0.5);
      ctx.lineTo(i + 0.5, Math.round(yOf(b.hi)) + 0.5);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // viewport window
    const t0v = api.xToTime(0);
    const t1v = api.xToTime(ly.plotRight);
    const frac = windowFractions(tFirst, tLast, t0v, t1v);
    if (frac) {
      const x0 = frac[0] * W;
      const x1 = frac[1] * W;
      ctx.fillStyle = pal.accent;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(x0, dock.y0 + 1, x1 - x0, dock.h - 2);
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x0 - 1.5, dock.y0 + 1, 3, dock.h - 2);
      ctx.fillRect(x1 - 1.5, dock.y0 + 1, 3, dock.h - 2);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}
