/**
 * wickchart-tape — time & sales as a wickchart plugin layer: a live trade
 * print strip docked at the bottom of the canvas (price, size, time, colored
 * by side). Builds on the public layer API plus the `insetBottom` dock hook.
 * Display-only — it never claims a pointer gesture, so pan/zoom stay native.
 *
 *   import { attachTape } from 'wickchart-tape';
 *   const tape = attachTape(chart);
 *   tape.push(wsTrades);              // { time, price, size, side? } prints
 *   chart.setData(tape.toBars(60000)); // …or derive bars from the same stream
 *   tape.detach();
 *
 * Sides are optional — prints without one get the classic tick rule
 * (uptick → buy, downtick → sell) carried across pushes.
 */

import { normalizeTrades, inferSides, tradesToBars, decimalsFor, fmtSize, MAX_TRADES } from './core.mjs';

const ROW_H = 18;
const MIN_ROWS = 3;
const MAX_ROWS = 8; // 8 * 18 + 2 stays under the core's 160px dock clamp
const FONT = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const TIME_MIN_W = 300; // below this width the time column is dropped

export function attachTape(chart, opts = {}) {
  return new Tape(chart, opts);
}

export class Tape {
  constructor(chart, opts = {}) {
    if (!chart || typeof chart.addLayer !== 'function') {
      throw new TypeError('attachTape(chart): the chart element is required');
    }
    this._chart = chart;
    this._rows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.round(opts.rows || 7)));
    this._bigSize = typeof opts.bigSize === 'number' && Number.isFinite(opts.bigSize) && opts.bigSize > 0 ? opts.bigSize : null;
    this._trades = []; // normalized, time-sorted, capped at MAX_TRADES
    this._prev = null; // tick-rule carry { price, side } across pushes
    this._visible = true;
    this._layer = {
      id: 'wick-tape',
      insetBottom: this._rows * ROW_H + 2,
      draw: (api) => this._render(api),
    };
    if (opts.trades) this.set(opts.trades);
    chart.addLayer(this._layer);
  }

  /** Snapshot of the kept prints (newest last). */
  get trades() {
    return this._trades.slice();
  }

  get rows() {
    return this._rows;
  }

  get visible() {
    return this._visible;
  }

  /**
   * Append prints (an array or a single object). New prints are normalized,
   * the tick rule fills missing sides (carrying state across calls), the
   * oldest are dropped past MAX_TRADES. Fires `wick:tape` and repaints.
   * @returns {number} how many prints were accepted
   */
  push(list) {
    if (!this._chart || list == null) return 0;
    const batch = normalizeTrades(Array.isArray(list) ? list : [list]);
    if (!batch.length) return 0;
    const { trades: sided, prev } = inferSides(batch, this._prev);
    this._prev = prev;
    const merged = this._trades.concat(sided).sort((a, b) => a.time - b.time);
    this._trades = merged.length > MAX_TRADES ? merged.slice(merged.length - MAX_TRADES) : merged;
    this._emit({ action: 'push', added: sided.length, total: this._trades.length });
    this._chart.requestDraw();
    return sided.length;
  }

  /** Replace the whole tape (used for history backfill). Resets the tick rule. */
  set(list) {
    if (!this._chart) return;
    const raw = Array.isArray(list) ? list.slice(-MAX_TRADES) : list ? [list] : [];
    const { trades, prev } = inferSides(normalizeTrades(raw), null);
    this._trades = trades;
    this._prev = prev;
    this._emit({ action: 'set', total: trades.length });
    this._chart.requestDraw();
  }

  clear() {
    if (!this._chart) return;
    this._trades = [];
    this._prev = null;
    this._emit({ action: 'clear', total: 0 });
    this._chart.requestDraw();
  }

  /** Visible row count (3..8) — resizes the docked strip live. */
  setRows(n) {
    const rows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.round(n)));
    if (rows === this._rows || !this._chart) return;
    this._rows = rows;
    if (this._visible) this._layer.insetBottom = rows * ROW_H + 2;
    this._chart.requestDraw();
  }

  show() {
    this._setVisible(true);
  }

  hide() {
    this._setVisible(false);
  }

  _setVisible(v) {
    if (v === this._visible || !this._chart) return;
    this._visible = v;
    this._layer.insetBottom = v ? this._rows * ROW_H + 2 : 0; // hiding frees the dock
    this._chart.requestDraw();
  }

  /** Bars from the kept prints — `chart.setData(tape.toBars(60000))`. */
  toBars(ms) {
    return tradesToBars(this._trades, ms);
  }

  detach() {
    try {
      this._chart.removeLayer('wick-tape');
    } catch (_) {}
    this._chart = null;
  }

  _emit(detail) {
    try {
      this._chart.dispatchEvent(new CustomEvent('wick:tape', { detail }));
    } catch (_) {}
  }

  /* ---------------- render ---------------- */

  _render(api) {
    if (!this._visible) return;
    const { ctx, palette: pal } = api;
    const ly = api.layout;
    const dock = ly && ly.dock;
    const trades = this._trades;
    if (!dock || !trades.length) return;
    const W = ly.W;
    const n = Math.min(this._rows, trades.length);
    const view = trades.slice(trades.length - n);
    const big = this._bigSize;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, dock.y0, W, dock.h);
    ctx.clip();

    // opaque backing — the strip owns its pixels (crosshair et al. stay out)
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, dock.y0, W, dock.h);
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(dock.y0) + 0.5);
    ctx.lineTo(W, Math.round(dock.y0) + 0.5);
    ctx.stroke();

    const max = view.reduce((m, t) => Math.max(m, t.size), 0);
    const dec = decimalsFor(view.map((t) => t.price));
    ctx.font = FONT;
    const showTime = W >= TIME_MIN_W;

    for (let k = 0; k < n; k++) {
      const t = view[view.length - 1 - k]; // newest at the bottom
      const top = dock.y0 + dock.h - (k + 1) * ROW_H;
      if (top < dock.y0) break;
      const color = t.side === 'buy' ? pal.up : t.side === 'sell' ? pal.down : pal.text;

      if (big != null && t.size >= big) {
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = color;
        ctx.fillRect(0, top, W, ROW_H);
      }

      // size bar grows leftward behind the size column
      const barW = Math.round((t.size / (max || 1)) * 90);
      if (barW > 0) {
        ctx.globalAlpha = 0.13;
        ctx.fillStyle = color;
        ctx.fillRect(W - 8 - barW, top + 3, barW, ROW_H - 6);
      }

      ctx.globalAlpha = big != null && t.size >= big ? 1 : 0.85;
      ctx.fillStyle = pal.text;
      ctx.textAlign = 'left';
      if (showTime) {
        const d = new Date(t.time);
        ctx.fillText(pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()), 8, top + 13);
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = color;
      ctx.fillText(t.price.toFixed(dec), W - 84, top + 13);
      ctx.fillStyle = pal.text;
      ctx.fillText(fmtSize(t.size), W - 8, top + 13);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}

const pad = (v) => (v < 10 ? '0' + v : '' + v);
