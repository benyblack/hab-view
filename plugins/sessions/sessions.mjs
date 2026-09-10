/**
 * wickchart-sessions — session shading as a wickchart plugin layer: Asia /
 * London / New York and other market sessions drawn as translucent bands
 * behind nothing but time, plus optional weekend shading for closed-market
 * instruments. Sessions are plain config (preset or custom defs with IANA
 * timezones — DST-exact), so they ride zoom & pan and serialize to JSON.
 * The whole plugin builds on the public layer API (addLayer) and adds zero
 * features to the core.
 *
 *   import { attachSessions } from 'wickchart-sessions';
 *   const sessions = attachSessions(chart, { preset: 'crypto' });
 *   sessions.setPreset('nyse');       // crypto | forex | nyse | cme | null
 *   sessions.setSessions([...]);      // custom defs (see README) — wins over preset
 *   sessions.setWeekends(true);       // shade closed weekends
 *   sessions.setLabels(false);
 *   sessions.detach();
 *
 * Events on the chart element:
 *   wick:sessions { detail: { hover: name|null } } — the session under the
 *   crosshair changed (bridged from the chart's own crosshair events, so
 *   this layer never claims a pointer gesture)
 */
import {
  PRESETS,
  WEEKEND_PRESETS,
  DEFAULT_COLORS,
  WEEKEND_COLOR,
  normalizeSessions,
  bandsFor,
  weekendBands,
} from './core.mjs';

const FONT = '600 10px ui-sans-serif, system-ui, sans-serif';
const LABEL_MIN = 28; // px of band width below which labels are skipped

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function attachSessions(chart, opts = {}) {
  return new SessionsLayer(chart, opts);
}

export class SessionsLayer {
  constructor(chart, opts = {}) {
    if (!chart || typeof chart.addLayer !== 'function') {
      throw new TypeError('attachSessions(chart): the chart element is required');
    }
    this._chart = chart;
    this._labels = opts.labels !== false;
    this._alpha = isNum(opts.opacity) ? Math.max(0, Math.min(1, opts.opacity)) : 0.08;
    this._weekendTz = typeof opts.weekendTz === 'string' ? opts.weekendTz : null;
    this._preset = null;
    this._defs = [];
    this._weekends = false;
    this._bands = []; // bands from the last render, for hover lookup
    this._hover = null;
    this._layer = { id: 'wick-sessions', draw: (api) => this._render(api) };
    chart.addLayer(this._layer);
    this._onCross = (e) => this._cross(e.detail);
    chart.addEventListener('wick:crosshair', this._onCross);
    if (opts.preset) this.setPreset(opts.preset);
    if (opts.sessions) this.setSessions(opts.sessions);
    if (opts.weekends != null) this.setWeekends(opts.weekends);
  }

  /* ---------------- public API ---------------- */

  /**
   * Apply a preset: 'crypto' | 'forex' | 'nyse' | 'cme' | null (none).
   * nyse/cme default to weekend shading; pass `{ weekends: false }`… or
   * call setWeekends(false) after.
   */
  setPreset(name, presetOpts = {}) {
    if (name == null) {
      this._preset = null;
      this._defs = [];
      this._redraw();
      return this;
    }
    const defs = PRESETS[name];
    if (!defs) return this;
    this._preset = name;
    this._defs = normalizeSessions(defs);
    this._weekends = presetOpts.weekends != null ? presetOpts.weekends !== false : WEEKEND_PRESETS.has(name);
    this._redraw();
    return this;
  }

  get preset() {
    return this._preset;
  }

  /** Replace the session defs with a custom list (invalid entries dropped). */
  setSessions(list) {
    this._preset = null;
    this._defs = normalizeSessions(list);
    this._redraw();
    return this;
  }

  /** Deep copy of the active defs — JSON-serializable. */
  getSessions() {
    return this._defs.map((d) => ({ ...d, days: d.days ? [...d.days] : null }));
  }

  setLabels(on) {
    this._labels = on !== false;
    this._redraw();
    return this;
  }

  get labels() {
    return this._labels;
  }

  /** Shade closed weekends (Sat+Sun) in `tz` — defaults to the first session's tz. */
  setWeekends(on, tz) {
    this._weekends = on !== false;
    if (typeof tz === 'string') this._weekendTz = tz;
    this._redraw();
    return this;
  }

  get weekends() {
    return this._weekends;
  }

  /** Fill opacity for all bands (0..1; custom defs may override per-session). */
  setOpacity(a) {
    if (isNum(a)) this._alpha = Math.max(0, Math.min(1, a));
    this._redraw();
    return this;
  }

  detach() {
    this._chart.removeEventListener('wick:crosshair', this._onCross);
    try {
      this._chart.removeLayer('wick-sessions');
    } catch (_) {}
    this._chart = null;
  }

  /* ---------------- hover (crosshair bridge) ---------------- */

  _cross(detail) {
    if (!this._chart) return;
    let t = detail && detail.bar ? detail.bar.time : null;
    if (!isNum(t)) t = null;
    else if (t < 1e11) t *= 1000; // same heuristic as the chart's toMs()
    const name = t == null ? null : this._nameAt(t);
    if (name !== this._hover) {
      this._hover = name;
      this._chart.dispatchEvent(new CustomEvent('wick:sessions', { detail: { hover: name } }));
    }
  }

  _nameAt(t) {
    for (const b of this._bands) {
      if (b.def.name && t >= b.start && t < b.end) return b.def.name;
    }
    return null;
  }

  /* ---------------- render ---------------- */

  _redraw() {
    if (this._chart && typeof this._chart.requestDraw === 'function') this._chart.requestDraw();
  }

  _weekendTzResolved() {
    if (this._weekendTz) return this._weekendTz;
    return (this._defs[0] && this._defs[0].tz) || 'UTC';
  }

  _render(api) {
    const { ctx, layout, palette: pal, data } = api;
    this._bands = [];
    if (!data.length || (!this._defs.length && !this._weekends)) return;
    const main = layout.main;
    const t0 = api.xToTime(0);
    const t1 = api.xToTime(layout.plotRight);
    if (!isNum(t0) || !isNum(t1) || t1 <= t0) return;

    const bands = bandsFor(this._defs, t0, t1);
    if (this._weekends) {
      const wt = this._weekendTzResolved();
      for (const b of weekendBands(t0, t1, wt)) {
        bands.push({ def: { name: '', color: WEEKEND_COLOR, alpha: null }, start: b.start, end: b.end });
      }
    }
    // weekends under sessions: draw gray first, session tints on top
    bands.sort((a, b) => (a.def.name ? 1 : 0) - (b.def.name ? 1 : 0));
    // uncolored sessions cycle through the default tints, in def order
    const tint = new Map();
    this._defs.forEach((d, i) => {
      if (!d.color) tint.set(d, DEFAULT_COLORS[i % DEFAULT_COLORS.length]);
    });
    this._bands = bands;
    if (!bands.length) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, main.y0, layout.plotRight + 1, main.h);
    ctx.clip();
    ctx.font = FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (const b of bands) {
      const x1 = api.timeToX(b.start);
      const x2 = api.timeToX(b.end);
      if (!isNum(x1) || !isNum(x2)) continue;
      const ax = Math.round(x1);
      const bx = Math.round(x2);
      if (bx <= ax) continue;
      const color = this._colorOf(b.def, pal, tint);
      ctx.globalAlpha = b.def.alpha != null ? b.def.alpha : this._alpha;
      ctx.fillStyle = color;
      ctx.fillRect(ax, main.y0, bx - ax, main.h);
      if (this._labels && b.def.name && bx - ax >= LABEL_MIN) this._label(ctx, b.def.name, ax, main.y0, bx - ax, color, pal.bg);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  _colorOf(def, pal, tint) {
    if (def.color === 'up' || def.color === 'down' || def.color === 'accent') return pal[def.color];
    if (def.color) return def.color;
    return tint.get(def) || DEFAULT_COLORS[0];
  }

  _label(ctx, name, ax, y, w, color, bg) {
    const fit = (s) => (ctx.measureText(s).width <= w - 10 ? s : null);
    let text = fit(name);
    if (!text) {
      // binary-search the longest prefix that fits (names are ≤ 24 chars)
      let lo = 0;
      let hi = name.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (fit(name.slice(0, mid) + '…')) lo = mid;
        else hi = mid - 1;
      }
      text = lo > 0 ? name.slice(0, lo) + '…' : null;
    }
    if (!text) return;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = bg;
    ctx.lineWidth = 3;
    ctx.strokeText(text, ax + 5, y + 4);
    ctx.fillStyle = color;
    ctx.fillText(text, ax + 5, y + 4);
  }
}
