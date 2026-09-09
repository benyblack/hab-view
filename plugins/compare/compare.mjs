/**
 * wickchart-compare — normalized multi-asset overlays as a wickchart plugin
 * layer: percent-rebased close series (compare="ETH"-style lines) and
 * derived ratio / diff lines (formula="BTC/ETH"-style), drawn over the main
 * pane against their own invisible scale so the price axis is untouched.
 * Everything builds on the public layer API (addLayer) — zero core changes.
 *
 *   import { attachCompare } from 'wickchart-compare';
 *   const cmp = attachCompare(chart);
 *   cmp.setSeries([
 *     { label: 'ETH', data: ethBars },                    // % line (closes)
 *     { label: 'BTC/ETH', op: 'ratio', a: btcBars, b: ethBars },
 *     { label: 'BTC−ETH', op: 'diff', a: btcBars, b: ethBars },
 *   ]);
 *   cmp.setRebase('visible');   // 0% at the window's left edge (TV-style);
 *                               // 'first' (dataset start) or an epoch ms
 *   cmp.clear();  cmp.detach();
 *
 * A legend row under the core legend shows every series with its live value
 * (+3.2% for percent lines, the raw ratio/diff for derived ones). Series are
 * time-aligned onto the main chart's bars, so any timeframes can mix.
 */

import { normalizeSeries, computeLine, timeWindow, DEFAULT_COLORS } from './core.mjs';

const FONT = '600 10px ui-sans-serif, system-ui, sans-serif';
const PAD_FRAC = 0.08; // keep rebased lines off the pane's top/bottom edges

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Compact value formatting for legend chips (ratio/diff raw values). */
function fmtV(v) {
  const a = Math.abs(v);
  return a >= 1000 ? v.toFixed(0) : a >= 100 ? v.toFixed(1) : a >= 1 ? v.toFixed(3) : v.toFixed(4);
}

const normRebase = (r) => (r === 'visible' || r === 'first' || isNum(r) ? r : 'first');

export function attachCompare(chart, opts = {}) {
  return new CompareLayer(chart, opts);
}

export class CompareLayer {
  constructor(chart, opts = {}) {
    if (!chart || typeof chart.addLayer !== 'function') {
      throw new TypeError('attachCompare(chart): the chart element is required');
    }
    this._chart = chart;
    this._defs = normalizeSeries(opts.series);
    this._rebase = normRebase(opts.rebase);
    this._layer = { id: 'wick-compare', draw: (api) => this._render(api) };
    chart.addLayer(this._layer);
  }

  /* ---------------- public API ---------------- */

  /** Replace the compare entries (validated; invalid entries are dropped). */
  setSeries(list) {
    this._defs = normalizeSeries(list);
    this._redraw();
    return this;
  }

  /** Rebase mode: 'visible' | 'first' | epoch-ms number. */
  setRebase(r) {
    this._rebase = normRebase(r);
    this._redraw();
    return this;
  }

  get rebase() {
    return this._rebase;
  }

  get count() {
    return this._defs.length;
  }

  clear() {
    this._defs = [];
    this._redraw();
    return this;
  }

  detach() {
    try {
      this._chart.removeLayer('wick-compare');
    } catch (_) {}
    this._chart = null;
  }

  /* ---------------- render ---------------- */

  _redraw() {
    if (this._chart && typeof this._chart.requestDraw === 'function') this._chart.requestDraw();
  }

  _colorOf(def, pal, i) {
    if (def.color === 'up' || def.color === 'down' || def.color === 'accent') return pal[def.color];
    if (def.color) return def.color;
    return DEFAULT_COLORS[i % DEFAULT_COLORS.length];
  }

  _render(api) {
    const { ctx, layout, palette: pal, data } = api;
    if (!data.length || !this._defs.length) return;
    const main = layout.main;
    const t0 = api.xToTime(0);
    const t1 = api.xToTime(layout.plotRight);
    if (!isNum(t0) || !isNum(t1) || t1 <= t0) return;
    const win = timeWindow(data, t0, t1);
    if (!win) return;

    // one rebased line per entry, aligned onto the main chart's bar times
    const times = [];
    for (let i = win[0]; i <= win[1]; i++) times.push(data[i].time);
    const lines = this._defs.map((def) => computeLine(def, times, this._rebase));

    // shared invisible scale: the union of all rebased values in view
    let min = Infinity;
    let max = -Infinity;
    for (const line of lines) {
      for (const p of line) {
        if (p && isNum(p.pct)) {
          if (p.pct < min) min = p.pct;
          if (p.pct > max) max = p.pct;
        }
      }
    }
    if (!isNum(min) || !isNum(max)) return;
    const pad = main.h * PAD_FRAC;
    const span = max - min || 1;
    const yOf = (pct) => main.y0 + pad + ((max - pct) / span) * (main.h - 2 * pad);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, main.y0, layout.plotRight + 1, main.h);
    ctx.clip();
    ctx.globalAlpha = 0.9;

    lines.forEach((line, si) => {
      const color = this._colorOf(this._defs[si], pal, si);
      ctx.strokeStyle = color;
      ctx.lineWidth = this._defs[si].width || 1.5;
      ctx.beginPath();
      let started = false;
      for (const p of line) {
        if (!p || !isNum(p.pct)) {
          started = false; // gap in the series — break the stroke
          continue;
        }
        const x = api.timeToX(p.t);
        const y = yOf(p.pct);
        if (!isNum(x) || !isNum(y)) continue;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    });
    ctx.restore();
    ctx.globalAlpha = 1;

    this._legend(ctx, api, lines, pal);
  }

  /** One chip per series: color square + label + live value. */
  _legend(ctx, api, lines, pal) {
    ctx.save();
    ctx.font = FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const xMax = api.layout.plotRight - 40;
    let x = 10;
    const y = api.layout.main.y0 + 28;
    for (let si = 0; si < this._defs.length; si++) {
      const def = this._defs[si];
      const last = [...lines[si]].reverse().find((p) => p && isNum(p.pct));
      if (!last) continue;
      if (x > xMax) break; // out of room — later chips are skipped this frame
      const color = this._colorOf(def, pal, si);
      const value = def.op === 'percent'
        ? `${last.pct >= 0 ? '+' : ''}${last.pct.toFixed(2)}%`
        : fmtV(last.raw);
      const text = `${def.label} ${value}`;
      ctx.fillStyle = color;
      ctx.fillRect(x, y - 2, 6, 6);
      ctx.strokeStyle = pal.bg;
      ctx.lineWidth = 3;
      ctx.strokeText(text, x + 10, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x + 10, y);
      x += 16 + ctx.measureText(text).width;
    }
    ctx.restore();
  }
}
