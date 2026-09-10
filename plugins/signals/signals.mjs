/**
 * wickchart-signals — candlestick pattern badges as a wickchart plugin
 * layer: bullish/bearish engulfing, pin bars and inside bars drawn as small
 * letter chips above/below the bar, with a crosshair hover explanation —
 * same passive-hover pattern as wickchart-sessions (the layer never claims
 * a pointer gesture). Detection lives in core.mjs and is cached per dataset.
 *
 *   import { attachSignals } from 'wickchart-signals';
 *   const signals = attachSignals(chart);
 *   signals.setKinds(['engulfing', 'pinbar']);  // subset (default: all)
 *   signals.setLabels(false);                   // hover explanations off
 *   signals.detach();
 *
 * Events on the chart element:
 *   wick:signals { detail: { index, time, signals, label } } — the pattern
 *   under the crosshair changed (null when the crosshair left a signal)
 */

import { detectSignals, KINDS, KIND_INFO } from './core.mjs';

const FONT = '600 9px ui-sans-serif, system-ui, sans-serif';
const OFFSET = 14; // px between the bar extreme and the chip center

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const normKinds = (k) =>
  Array.isArray(k) && k.length ? k.filter((x) => KINDS.includes(x)) : KINDS.slice();

export function attachSignals(chart, opts = {}) {
  return new SignalsLayer(chart, opts);
}

export class SignalsLayer {
  constructor(chart, opts = {}) {
    if (!chart || typeof chart.addLayer !== 'function') {
      throw new TypeError('attachSignals(chart): the chart element is required');
    }
    this._chart = chart;
    this._kinds = normKinds(opts.kinds);
    this._labels = opts.labels !== false;
    this._signals = [];
    this._datasetLen = 0;
    this._cacheKey = null;
    this._hover = null; // { index, label }
    this._layer = { id: 'wick-signals', draw: (api) => this._render(api) };
    chart.addLayer(this._layer);
    this._onCross = (e) => this._cross(e.detail);
    chart.addEventListener('wick:crosshair', this._onCross);
  }

  /* ---------------- public API ---------------- */

  setKinds(kinds) {
    this._kinds = normKinds(kinds);
    this._cacheKey = null; // re-detect with the new subset
    this._redraw();
    return this;
  }

  get kinds() {
    return this._kinds.slice();
  }

  /** Hover explanation chips near the badges (default on). */
  setLabels(on) {
    this._labels = on !== false;
    this._redraw();
    return this;
  }

  get labels() {
    return this._labels;
  }

  /** Signal count of the last detection pass. */
  get count() {
    return this._signals.length;
  }

  detach() {
    this._chart.removeEventListener('wick:crosshair', this._onCross);
    try {
      this._chart.removeLayer('wick-signals');
    } catch (_) {}
    this._chart = null;
  }

  /* ---------------- internals ---------------- */

  _redraw() {
    if (this._chart && typeof this._chart.requestDraw === 'function') this._chart.requestDraw();
  }

  _cross(detail) {
    if (!this._chart) return;
    let index = detail && isNum(detail.index) ? detail.index : null;
    if (index != null && (index < 0 || index >= this._datasetLen)) index = null;
    let hit = null;
    if (index != null) {
      const onBar = this._signals.filter((s) => s.i === index);
      if (onBar.length) {
        hit = {
          index,
          label: onBar.map((s) => this._name(s)).join(' · '),
        };
      }
    }
    const changed = (hit && hit.index) !== (this._hover && this._hover.index);
    this._hover = hit;
    if (changed) {
      this._redraw();
      this._chart.dispatchEvent(
        new CustomEvent('wick:signals', {
          detail: hit
            ? {
                index: hit.index,
                time: this._chart.data[hit.index] ? this._chart.data[hit.index].time : null,
                signals: this._signals.filter((s) => s.i === hit.index),
                label: hit.label,
              }
            : null,
        })
      );
    }
  }

  _name(s) {
    const info = KIND_INFO[s.kind] || { name: s.kind };
    return s.dir ? `${s.dir === 'bull' ? 'Bullish' : 'Bearish'} ${info.name}` : info.name;
  }
  /* ---------------- render ---------------- */

  _render(api) {
    const { ctx, layout: ly, palette: pal, data } = api;
    if (!data.length) {
      this._signals = [];
      this._datasetLen = 0;
      return;
    }
    // O(n) detection once per (dataset, kinds) — cached otherwise
    const key = data.length + ':' + data[data.length - 1].time + ':' + this._kinds.join(',');
    if (this._cacheKey !== key) {
      this._cacheKey = key;
      this._signals = detectSignals(data, this._kinds);
      this._datasetLen = data.length;
    }

    const t0 = api.xToTime(0);
    const t1 = api.xToTime(ly.plotRight);
    if (!isNum(t0) || !isNum(t1) || t1 <= t0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, ly.main.y0, ly.plotRight + 1, ly.main.h);
    ctx.clip();
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let lastBarSignals = null;
    for (const s of this._signals) {
      const bar = data[s.i];
      if (!bar || bar.time < t0 || bar.time > t1) continue;
      const x = api.timeToX(bar.time);
      const y =
        s.dir === 'bear'
          ? api.priceToY(bar.high) - OFFSET
          : s.dir === 'bull'
            ? api.priceToY(bar.low) + OFFSET
            : api.priceToY(bar.high) - OFFSET; // neutral (inside bar) sits above
      if (!isNum(x) || !isNum(y)) continue;
      const color = s.dir === 'bull' ? pal.up : s.dir === 'bear' ? pal.down : pal.text;
      this._chip(ctx, x, y, KIND_INFO[s.kind] ? KIND_INFO[s.kind].letter : '?', color, pal.bg);
      if (this._hover && this._hover.index === s.i) {
        if (!lastBarSignals) lastBarSignals = { x, y, texts: [] };
        lastBarSignals.texts.push(this._name(s));
      }
    }

    if (this._labels && lastBarSignals) {
      this._tooltip(ctx, lastBarSignals, pal);
    }
    ctx.restore();
  }

  /** Letter chip: small filled disc with a 1-color halo of the direction. */
  _chip(ctx, x, y, letter, color, bg) {
    const r = letter.length > 1 ? 7 : 5.5;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = bg;
    ctx.stroke();
    ctx.fillStyle = bg;
    ctx.fillText(letter, x, y + 0.5);
    ctx.globalAlpha = 1;
  }

  /** Hover explanation near the badges (bg-haloed text, stacked lines). */
  _tooltip(ctx, box, pal) {
    ctx.font = FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let y = box.y - (box.texts.length - 1) * 11;
    for (const text of box.texts) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = pal.bg;
      ctx.lineWidth = 3;
      ctx.strokeText(text, box.x + 10, y);
      ctx.fillStyle = pal.text;
      ctx.fillText(text, box.x + 10, y);
      y += 11;
    }
  }
}
