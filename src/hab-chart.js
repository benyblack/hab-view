/* ==========================================================================
 * <hab-chart> — a modern, dependency-free financial charting web component.
 *
 *   <hab-chart label="BTC · 1h" type="candles" indicators="sma:20 volume">
 *   </hab-chart>
 *   <script type="module">
 *     const chart = document.querySelector('hab-chart');
 *     chart.setData(bars);      // [{ time, open, high, low, close, volume }]
 *     chart.update(bar);        // streaming update / append
 *   </script>
 *
 * Zero dependencies. Canvas-rendered. Framework-agnostic (works in React,
 * Vue, Svelte, plain HTML). Themeable with --hab-* CSS custom properties.
 *
 * MIT License.
 * ========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Utilities
   * ------------------------------------------------------------------ */

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

  const nfCache = new Map();
  function numberFmt(p) {
    let nf = nfCache.get(p);
    if (!nf) {
      nf = new Intl.NumberFormat(undefined, {
        minimumFractionDigits: p,
        maximumFractionDigits: p,
      });
      nfCache.set(p, nf);
    }
    return nf;
  }

  let compactFmt = null;
  function fmtCompact(v) {
    if (!compactFmt) {
      try {
        compactFmt = new Intl.NumberFormat(undefined, {
          notation: 'compact',
          maximumFractionDigits: 1,
        });
      } catch (_) {
        compactFmt = numberFmt(0);
      }
    }
    return compactFmt.format(v);
  }

  function autoPrecision(v) {
    const a = Math.abs(v);
    if (a >= 1000) return 2;
    if (a >= 10) return 2;
    if (a >= 1) return 3;
    if (a >= 0.01) return 5;
    return 8;
  }

  /** Nice round step (1, 2, 5 × 10^n) covering `range` in ~`target` steps. */
  function niceStep(range, target) {
    if (!(range > 0) || !isNum(range)) return 1;
    const raw = range / Math.max(1, target);
    const exp = Math.floor(Math.log10(raw));
    const f = raw / Math.pow(10, exp);
    const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nice * Math.pow(10, exp);
  }

  function hexToRgba(color, alpha) {
    if (typeof color === 'string') {
      let c = color.trim();
      if (c[0] === '#') {
        let hex = c.slice(1);
        if (hex.length === 3) hex = hex.replace(/./g, '$&$&');
        if (hex.length === 6) {
          const n = parseInt(hex, 16);
          return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
        }
      }
      const m = c.match(/^rgba?\(([^)]+)\)$/);
      if (m) {
        const parts = m[1].split(/[,\s/]+/).filter(Boolean);
        if (parts.length >= 3) {
          const a = parts.length > 3 ? parseFloat(parts[3]) : 1;
          return `rgba(${parts[0]},${parts[1]},${parts[2]},${alpha * a})`;
        }
      }
    }
    return color;
  }

  const FONT_STACK =
    "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const axisFont = (w = 500) => `${w} 11px ${FONT_STACK}`;
  const pillFont = () => `600 11px ${FONT_STACK}`;

  function roundRectPath(ctx, x, y, w, h, r) {
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ------------------------------------------------------------------ *
   * Themes (every key overridable via --hab-* CSS custom properties)
   * ------------------------------------------------------------------ */

  const THEMES = {
    dark: {
      bg: '#0d1117',
      text: '#8b949e',
      textStrong: '#e6edf3',
      grid: 'rgba(230,237,243,0.05)',
      border: 'rgba(230,237,243,0.09)',
      up: '#16c784',
      down: '#ea3943',
      accent: '#4c8dff',
      crosshair: 'rgba(230,237,243,0.42)',
      crosshairBg: '#e6edf3',
      crosshairText: '#0d1117',
      pillText: '#ffffff',
      rsi: '#a78bfa',
      guide: 'rgba(230,237,243,0.16)',
      volAlpha: 0.33,
      overlay: ['#f0b429', '#38bdf8', '#e64980', '#34d399', '#a78bfa'],
    },
    light: {
      bg: '#ffffff',
      text: '#6b7280',
      textStrong: '#111827',
      grid: 'rgba(15,23,42,0.055)',
      border: 'rgba(15,23,42,0.12)',
      up: '#059669',
      down: '#dc2626',
      accent: '#2563eb',
      crosshair: 'rgba(15,23,42,0.45)',
      crosshairBg: '#111827',
      crosshairText: '#ffffff',
      pillText: '#ffffff',
      rsi: '#7c3aed',
      guide: 'rgba(15,23,42,0.18)',
      volAlpha: 0.35,
      overlay: ['#d97706', '#0284c7', '#db2777', '#059669', '#7c3aed'],
    },
  };

  /* ------------------------------------------------------------------ *
   * Indicators (pure functions over arrays)
   * ------------------------------------------------------------------ */

  function calcSMA(values, period) {
    const out = new Array(values.length).fill(null);
    if (period < 1) return out;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function calcEMA(values, period) {
    const out = new Array(values.length).fill(null);
    if (period < 1 || values.length < period) return out;
    const k = 2 / (period + 1);
    let seed = 0;
    for (let i = 0; i < period; i++) seed += values[i];
    let prev = seed / period;
    out[period - 1] = prev;
    for (let i = period; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  function calcRSI(closes, period) {
    const out = new Array(closes.length).fill(null);
    if (closes.length <= period) return out;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d;
      else loss -= d;
    }
    let avgG = gain / period;
    let avgL = loss / period;
    out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    for (let i = period + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      const g = d > 0 ? d : 0;
      const l = d < 0 ? -d : 0;
      avgG = (avgG * (period - 1) + g) / period;
      avgL = (avgL * (period - 1) + l) / period;
      out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Time axis helpers
   * ------------------------------------------------------------------ */

  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  // Sub-day / day-aligned steps (ms), plus month/year handled separately.
  const TIME_STEPS = [
    { ms: MIN, label: 'time' },
    { ms: 5 * MIN, label: 'time' },
    { ms: 15 * MIN, label: 'time' },
    { ms: 30 * MIN, label: 'time' },
    { ms: HOUR, label: 'time' },
    { ms: 2 * HOUR, label: 'time' },
    { ms: 3 * HOUR, label: 'time' },
    { ms: 4 * HOUR, label: 'time' },
    { ms: 6 * HOUR, label: 'time' },
    { ms: 12 * HOUR, label: 'time' },
    { ms: DAY, label: 'day' },
    { ms: 2 * DAY, label: 'day' },
    { ms: 7 * DAY, label: 'day' },
  ];

  // Cached DateTimeFormats — constructing one per call costs ~30µs, which is
  // disastrous in per-frame rendering paths.
  const dtfCache = new Map();
  function dtf(fmt) {
    let f = dtfCache.get(fmt);
    if (!f) {
      f = new Intl.DateTimeFormat(undefined, fmt);
      dtfCache.set(fmt, f);
    }
    return f;
  }
  const DAY_FMT = { month: 'short', day: 'numeric' };
  const MON_FMT = { month: 'short' };
  const MON_Y_FMT = { month: 'short', year: 'numeric' };
  const YR_FMT = { year: 'numeric' };

  const hhmm = (t) => {
    const d = new Date(t);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  };
  const fmtDay = (t) => dtf(DAY_FMT).format(t);
  const fmtMonth = (t, withYear) => dtf(withYear ? MON_Y_FMT : MON_FMT).format(t);
  const fmtYear = (t) => dtf(YR_FMT).format(t);
  const fmtFull = (t) => {
    const d = new Date(t);
    return dtf(DAY_FMT).format(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  };

  /* ------------------------------------------------------------------ *
   * <hab-chart>
   * ------------------------------------------------------------------ */

  class HabChart extends HTMLElement {
    static get observedAttributes() {
      return ['theme', 'type', 'log', 'auto', 'indicators', 'precision', 'label'];
    }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host {
            display: block;
            position: relative;
            width: 100%;
            height: 100%;
            min-height: 220px;
            contain: content;
          }
          :host(:focus-visible) {
            outline: 2px solid var(--hab-accent, #4c8dff);
            outline-offset: -2px;
          }
          .wrap { position: absolute; inset: 0; overflow: hidden; }
          canvas {
            position: absolute; inset: 0;
            width: 100%; height: 100%;
            display: block;
            touch-action: none;
            cursor: crosshair;
            user-select: none;
            -webkit-user-select: none;
          }
          canvas.grabbing { cursor: grabbing; }
          .legend {
            position: absolute; left: 10px; top: 8px; z-index: 2;
            pointer-events: none;
            font: 500 12px/1.7 ${FONT_STACK};
            letter-spacing: 0.01em;
            max-width: calc(100% - 24px);
          }
          .legend .row { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
          .legend .sym {
            color: var(--hab-text-strong, #e6edf3);
            font-weight: 700;
            font-size: 13px;
            letter-spacing: 0.02em;
          }
          .legend .kv { display: inline-flex; gap: 5px; align-items: baseline; white-space: nowrap; }
          .legend .k { color: var(--hab-text, #8b949e); font-size: 11px; }
          .legend .v { color: var(--hab-text-strong, #e6edf3); font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
          .legend .pct { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
          .legend .up { color: var(--hab-up, #16c784); }
          .legend .dn { color: var(--hab-down, #ea3943); }
          .legend .ind {
            display: inline-flex; align-items: center; gap: 6px;
            color: var(--hab-text, #8b949e); font-size: 11.5px; white-space: nowrap;
          }
          .legend .ind i { width: 8px; height: 2.5px; border-radius: 2px; display: inline-block; }
          .legend .ind .v { font-size: 12px; }
          .nodata {
            position: absolute; inset: 0;
            display: flex; align-items: center; justify-content: center;
            color: var(--hab-text, #8b949e);
            font: 500 13px ${FONT_STACK};
            pointer-events: none;
          }
          .nodata[hidden] { display: none; }
        </style>
        <div class="wrap" part="wrap">
          <canvas part="canvas" role="img"></canvas>
          <div class="legend" part="legend" aria-hidden="true"></div>
          <div class="nodata" hidden>No data</div>
        </div>`;

      this._canvas = root.querySelector('canvas');
      this._ctx = this._canvas.getContext('2d');
      this._legend = root.querySelector('.legend');
      this._nodata = root.querySelector('.nodata');

      this._data = [];
      this._version = 0;
      this._view = { rightIndex: 10, spacing: 8 };
      this._auto = true;
      this._needsFit = true;
      this._hover = null; // { index, x, y }
      this._dt = HOUR; // median bar interval (ms)
      this._ly = null; // last layout
      this._cache = { v: -1, map: {} };
      this._pal = null; // palette cache
      this._palKey = '';
      this._legendKey = '';
      this._raf = 0;
      this._connected = false;

      // defaults; attributes (if present) override via attributeChangedCallback
      this._theme = 'dark';
      this._type = 'candles';
      this._log = false;
      this._precision = null;
      this._label = '';
      this._ind = { overlays: [], rsi: null, volume: true };

      this._pointers = new Map();
      this._pan = null;
      this._pinch = null;

      this._onResize = () => this._invalidate();
      this._onPointerDown = (e) => this._pointerDown(e);
      this._onPointerMove = (e) => this._pointerMove(e);
      this._onPointerUp = (e) => this._pointerUp(e);
      this._onPointerLeave = () => {
        if (this._hover) {
          this._hover = null;
          this._emitCrosshair(null);
          this._invalidate();
        }
      };
      this._onWheel = (e) => this._wheel(e);
      this._onDbl = () => this.fit();
      this._onKey = (e) => this._keydown(e);
    }

    connectedCallback() {
      this._connected = true;
      if (this.tabIndex < 0) this.tabIndex = 0;
      this._ro =
        this._ro ||
        new ResizeObserver(() => {
          if (this._ly) this._invalidate();
          else this._needsFit = true, this._invalidate();
        });
      this._ro.observe(this);

      const cv = this._canvas;
      cv.addEventListener('pointerdown', this._onPointerDown);
      cv.addEventListener('pointermove', this._onPointerMove);
      cv.addEventListener('pointerup', this._onPointerUp);
      cv.addEventListener('pointercancel', this._onPointerUp);
      cv.addEventListener('pointerleave', this._onPointerLeave);
      cv.addEventListener('wheel', this._onWheel, { passive: false });
      cv.addEventListener('dblclick', this._onDbl);
      this.addEventListener('keydown', this._onKey);

      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => this._invalidate()).catch(() => {});
      }
      this._invalidate();
    }

    disconnectedCallback() {
      this._connected = false;
      if (this._ro) this._ro.disconnect();
      const cv = this._canvas;
      cv.removeEventListener('pointerdown', this._onPointerDown);
      cv.removeEventListener('pointermove', this._onPointerMove);
      cv.removeEventListener('pointerup', this._onPointerUp);
      cv.removeEventListener('pointercancel', this._onPointerUp);
      cv.removeEventListener('pointerleave', this._onPointerLeave);
      cv.removeEventListener('wheel', this._onWheel);
      cv.removeEventListener('dblclick', this._onDbl);
      this.removeEventListener('keydown', this._onKey);
      if (this._raf) cancelAnimationFrame(this._raf), (this._raf = 0);
    }

    attributeChangedCallback(name, _old, val) {
      switch (name) {
        case 'theme':
          this._theme = val === 'light' ? 'light' : 'dark';
          break;
        case 'type':
          this._type = ['candles', 'line', 'area'].includes(val) ? val : 'candles';
          break;
        case 'log':
          this._log = val != null && val !== 'false';
          break;
        case 'auto':
          this._auto = val == null || val !== 'false';
          break;
        case 'precision':
          this._precision = val != null && val !== '' ? clamp(parseInt(val, 10) || 0, 0, 12) : null;
          break;
        case 'label':
          this._label = val || '';
          break;
        case 'indicators':
          this._ind = HabChart._parseIndicators(val);
          break;
      }
      this._invalidate();
    }

    static _parseIndicators(str) {
      const ind = { overlays: [], rsi: null, volume: false };
      if (str == null || str === '') return ind; // empty string = nothing
      const seen = new Set();
      for (const tok of String(str).split(/[\s,;]+/)) {
        if (!tok) continue;
        const m = tok.toLowerCase().match(/^([a-z]+)(?::(\d+))?$/);
        if (!m) continue;
        const [, kind, pStr] = m;
        const p = pStr ? clamp(parseInt(pStr, 10), 1, 1000) : null;
        if (kind === 'volume') ind.volume = true;
        else if (kind === 'rsi') ind.rsi = { period: p || 14 };
        else if (kind === 'sma' || kind === 'ema') {
          const key = kind + ':' + (p || (kind === 'sma' ? 20 : 50));
          if (!seen.has(key)) {
            seen.add(key);
            ind.overlays.push({ kind, period: p || (kind === 'sma' ? 20 : 50) });
          }
        }
      }
      return ind;
    }

    /* ------------------------------------------------------------ *
     * Public API
     * ------------------------------------------------------------ */

    get data() {
      return this._data;
    }

    setData(bars) {
      if (!Array.isArray(bars) || !bars.length) {
        this.clearData();
        return;
      }
      const norm = [];
      for (const b of bars) {
        const nb = HabChart._normBar(b);
        if (nb) norm.push(nb);
      }
      norm.sort((a, b) => a.time - b.time);
      this._data = norm;
      this._version++;
      this._computeDt();
      this._needsFit = true;
      this._auto = this._autoAttr();
      this._hover = null;
      this._updateAria();
      this._invalidate();
    }

    update(bar) {
      const b = HabChart._normBar(bar);
      if (!b) return;
      const d = this._data;
      const last = d[d.length - 1];
      if (!last || b.time > last.time) {
        d.push(b);
        if (d.length > 1) this._computeDt();
      } else if (b.time === last.time) {
        d[d.length - 1] = b;
      } else {
        // out-of-order / backfill: replace matching or insert
        let i = d.length - 1;
        while (i >= 0 && d[i].time > b.time) i--;
        if (i >= 0 && d[i].time === b.time) d[i] = b;
        else d.splice(i + 1, 0, b);
        this._computeDt();
      }
      this._version++;
      if (this._hover && this._hover.index >= d.length) this._hover = null;
      this._updateAria();
      this._invalidate();
    }

    clearData() {
      this._data = [];
      this._version++;
      this._hover = null;
      this._needsFit = true;
      this._updateAria();
      this._invalidate();
    }

    /** Reset zoom to the default view (last ~150 bars). */
    fit() {
      this._needsFit = true;
      this._auto = true;
      this._invalidate();
      this._emitRange();
    }

    /** Visible time window. @returns {{from:number,to:number}|null} */
    getVisibleRange() {
      const d = this._data;
      if (!d.length || !this._ly) return null;
      const { plotRight } = this._ly;
      const { rightIndex, spacing } = this._view;
      const left = clamp(Math.round(rightIndex - plotRight / spacing), 0, d.length - 1);
      const right = clamp(Math.round(rightIndex), 0, d.length - 1);
      return { from: d[left].time, to: d[right].time };
    }

    /** Set visible time window ({from, to} in ms). */
    setVisibleRange(range) {
      const d = this._data;
      if (!d.length || !range || !this._ly) return;
      const from = HabChart._timeToMs(range.from);
      const to = HabChart._timeToMs(range.to);
      let i0 = HabChart._indexForTime(d, from);
      let i1 = HabChart._indexForTime(d, to);
      if (i0 > i1) [i0, i1] = [i1, i0];
      if (i1 - i0 < 2) return;
      const { plotRight } = this._ly;
      this._view.spacing = clamp(plotRight / (i1 - i0), HabChart._MIN_SP, HabChart._MAX_SP);
      this._view.rightIndex = i1;
      this._auto = false;
      this._clampView();
      this._invalidate();
      this._emitRange();
    }

    /** Current canvas as a PNG data URL. */
    exportPNG() {
      return this._canvas.toDataURL('image/png');
    }

    /* reflected properties */
    get theme() { return this._theme; }
    set theme(v) { this.setAttribute('theme', v); }
    get type() { return this._type; }
    set type(v) { this.setAttribute('type', v); }
    get label() { return this._label; }
    set label(v) { this.setAttribute('label', v); }
    get indicators() {
      return this.getAttribute('indicators');
    }
    set indicators(v) { this.setAttribute('indicators', v == null ? '' : v); }

    /* ------------------------------------------------------------ *
     * Normalization / internals
     * ------------------------------------------------------------ */

    static _MIN_SP = 0.35;
    static _MAX_SP = 90;

    static _timeToMs(t) {
      return isNum(t) ? (t < 1e12 ? t * 1000 : t) : Date.now();
    }

    static _normBar(b) {
      if (!b) return null;
      const t = b.time != null ? b.time : b.t;
      if (!isNum(t)) return null;
      const time = HabChart._timeToMs(t);
      const close = isNum(b.close) ? b.close : isNum(b.value) ? b.value : NaN;
      if (!isNum(close)) return null;
      const open = isNum(b.open) ? b.open : close;
      return {
        time,
        open,
        high: isNum(b.high) ? b.high : Math.max(open, close),
        low: isNum(b.low) ? b.low : Math.min(open, close),
        close,
        volume: isNum(b.volume) ? b.volume : isNum(b.v) ? b.v : 0,
      };
    }

    static _indexForTime(d, time) {
      let lo = 0;
      let hi = d.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (d[mid].time < time) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }

    _autoAttr() {
      const a = this.getAttribute('auto');
      return a == null || a !== 'false';
    }

    _computeDt() {
      const d = this._data;
      const n = d.length;
      if (n < 2) {
        this._dt = HOUR;
        return;
      }
      const diffs = [];
      const from = Math.max(1, n - 300);
      for (let i = from; i < n; i++) {
        const df = d[i].time - d[i - 1].time;
        if (df > 0) diffs.push(df);
      }
      if (!diffs.length) {
        this._dt = HOUR;
        return;
      }
      diffs.sort((a, b) => a - b);
      this._dt = diffs[diffs.length >> 1] || HOUR;
    }

    _updateAria() {
      const d = this._data;
      const last = d[d.length - 1];
      const prev = d[d.length - 2];
      if (!last) {
        this._canvas.setAttribute('aria-label', (this._label || 'Chart') + ': no data');
        return;
      }
      const pct = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
      this._canvas.setAttribute(
        'aria-label',
        `${this._label || 'Chart'}: last ${numberFmt(this._prec(last.close)).format(last.close)}, ${pct >= 0 ? '+' : ''}${pct.toFixed(2)} percent, ${d.length} bars`
      );
    }

    _invalidate() {
      if (!this._connected || this._raf) return;
      this._raf = requestAnimationFrame(() => this._render());
    }

    _prec(v) {
      return this._precision != null ? this._precision : autoPrecision(v);
    }

    _palette() {
      if (this._pal && this._palKey === this._theme) return this._pal;
      const base = THEMES[this._theme] || THEMES.dark;
      const cs = getComputedStyle(this);
      const get = (name, fallback) => {
        const v = cs.getPropertyValue('--hab-' + name).trim();
        return v || fallback;
      };
      const pal = {};
      for (const k of Object.keys(base)) {
        if (k === 'overlay') {
          const o = [];
          for (let i = 0; i < base.overlay.length; i++) {
            o.push(get('overlay-' + i, base.overlay[i]));
          }
          // allow single overlay color
          const single = cs.getPropertyValue('--hab-overlay').trim();
          pal.overlay = single ? base.overlay.map(() => single) : o;
        } else {
          pal[k] = get(k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), base[k]);
        }
      }
      pal.volAlpha = parseFloat(pal.volAlpha);
      if (!isNum(pal.volAlpha)) pal.volAlpha = 0.33;
      this._pal = pal;
      this._palKey = this._theme;
      return pal;
    }

    _series(kind, period) {
      if (this._cache.v !== this._version) {
        this._cache = { v: this._version, map: {} };
      }
      const key = kind + period;
      if (this._cache.map[key]) return this._cache.map[key];
      const closes = this._data.map((b) => b.close);
      let s;
      if (kind === 'sma') s = calcSMA(closes, period);
      else if (kind === 'ema') s = calcEMA(closes, period);
      else s = calcRSI(closes, period);
      this._cache.map[key] = s;
      return s;
    }

    /* ------------------------------------------------------------ *
     * Layout / view helpers
     * ------------------------------------------------------------ */

    _ensureCanvas() {
      const W = this.clientWidth;
      const H = this.clientHeight;
      if (!W || !H) return false;
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
      const bw = Math.round(W * dpr);
      const bh = Math.round(H * dpr);
      if (this._canvas.width !== bw || this._canvas.height !== bh) {
        this._canvas.width = bw;
        this._canvas.height = bh;
      }
      this._W = W;
      this._H = H;
      this._dpr = dpr;
      return true;
    }

    _rightMargin() {
      const ly = this._ly;
      const w = ly ? ly.plotRight : 600;
      return Math.max(3, (w / this._view.spacing) * 0.06);
    }

    _applyFit() {
      const d = this._data;
      if (!d.length || !this._ly) return;
      const { plotRight } = this._ly;
      const target = Math.min(d.length, 150);
      this._view.spacing = clamp(plotRight / target, HabChart._MIN_SP, HabChart._MAX_SP);
      this._view.rightIndex = d.length - 1 + this._rightMargin();
    }

    _clampView() {
      const d = this._data;
      const ly = this._ly;
      if (!d.length || !ly) return;
      const v = this._view;
      v.spacing = clamp(v.spacing, HabChart._MIN_SP, HabChart._MAX_SP);
      const visible = ly.plotRight / v.spacing;
      const maxRight = d.length - 1 + Math.max(6, visible * 0.5);
      const minRight = Math.min(2, d.length - 1);
      v.rightIndex = clamp(v.rightIndex, minRight, maxRight);
    }

    _atRight() {
      const d = this._data;
      if (!d.length) return true;
      const ri = this._view.rightIndex;
      const m = this._rightMargin();
      return ri >= d.length - 1 - 0.5 && ri <= d.length - 1 + m + 1;
    }

    _xFor(i) {
      const ly = this._ly;
      return ly ? ly.plotRight - (this._view.rightIndex - i) * this._view.spacing : 0;
    }

    _indexForX(x) {
      const ly = this._ly;
      if (!ly) return 0;
      return this._view.rightIndex - (ly.plotRight - x) / this._view.spacing;
    }

    /* ------------------------------------------------------------ *
     * Scales & ticks
     * ------------------------------------------------------------ */

    _mainScale(i0, i1) {
      const d = this._data;
      const candles = this._type === 'candles';
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = i0; i <= i1; i++) {
        const b = d[i];
        if (candles) {
          if (b.low < lo) lo = b.low;
          if (b.high > hi) hi = b.high;
        } else {
          if (b.close < lo) lo = b.close;
          if (b.close > hi) hi = b.close;
        }
      }
      for (const ov of this._ind.overlays) {
        const s = this._series(ov.kind, ov.period);
        for (let i = i0; i <= i1; i++) {
          const v = s[i];
          if (isNum(v)) {
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
      }
      if (!isFinite(lo) || !isFinite(hi)) {
        lo = 0;
        hi = 1;
      }
      if (hi === lo) {
        const e = Math.abs(hi) * 0.005 || 1;
        hi += e;
        lo -= e;
      }
      const pad = (hi - lo) * 0.08;
      let min = lo - pad;
      let max = hi + pad;
      const useLog = this._log && min > 0;
      if (useLog) {
        min = Math.log10(min);
        max = Math.log10(max);
        if (max - min < 1e-9) max = min + 1;
      }
      return { min, max, useLog, rawMin: lo, rawHi: hi };
    }

    _priceTicks(scale, height) {
      const target = clamp(Math.round(height / 60), 3, 9);
      const step = niceStep(scale.rawHi - scale.rawMin, target);
      const ticks = [];
      if (!(step > 0)) return ticks;
      const start = Math.ceil(scale.rawMin / step) * step;
      for (let v = start, guard = 0; v <= scale.rawHi && guard < 200; v += step, guard++) {
        ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
      }
      return ticks;
    }

    _timeTicks(i0, i1) {
      const d = this._data;
      const sp = this._view.spacing;
      const dt = this._dt || HOUR;
      const minPx = 88;

      // choose step: fixed steps first, then month/year steps
      let stepMs = null;
      let stepLabel = 'time';
      for (const s of TIME_STEPS) {
        if ((s.ms / dt) * sp >= minPx) {
          stepMs = s.ms;
          stepLabel = s.label;
          break;
        }
      }
      let monthStep = 0;
      let yearStep = 0;
      if (stepMs == null) {
        const monthsPx = (30 * DAY / dt) * sp;
        if (monthsPx >= minPx) {
          monthStep = monthsPx >= minPx * 6 ? 6 : monthsPx >= minPx * 3 ? 3 : 1;
        } else {
          yearStep = 1;
        }
      }

      const tz = (t) => -new Date(t).getTimezoneOffset() * 60000;
      const ticks = [];
      let prevKey = null;
      // Labels are built lazily — only for bars that actually start a new step.
      // Formatting every visible bar (toLocaleDateString) once cost ~30µs/bar.
      for (let i = Math.max(0, i0 - 1); i <= i1; i++) {
        const t = d[i].time;
        let key;
        let label = null;
        if (stepMs != null) {
          key = Math.floor((t + tz(t)) / stepMs);
          if (prevKey !== null && key !== prevKey) {
            if (stepLabel === 'time') {
              const prevT = d[i - 1].time;
              const dayKey = Math.floor((t + tz(t)) / DAY);
              const prevDay = Math.floor((prevT + tz(prevT)) / DAY);
              label = dayKey !== prevDay ? fmtDay(t) : hhmm(t);
            } else {
              const dt_ = new Date(t);
              label = dt_.getDate() === 1 ? fmtMonth(t, dt_.getMonth() === 0) : fmtDay(t);
            }
          }
        } else if (monthStep) {
          const dt_ = new Date(t);
          key = Math.floor((dt_.getFullYear() * 12 + dt_.getMonth()) / monthStep);
          if (prevKey !== null && key !== prevKey) {
            label = fmtMonth(t, dt_.getMonth() === 0 || monthStep > 1);
          }
        } else {
          key = new Date(t).getFullYear();
          if (prevKey !== null && key !== prevKey) label = fmtYear(t);
        }
        if (label !== null) ticks.push({ x: this._xFor(i), label });
        prevKey = key;
      }
      return ticks;
    }

    /* ------------------------------------------------------------ *
     * Render
     * ------------------------------------------------------------ */

    _render() {
      this._raf = 0;
      if (!this._connected) return;
      if (!this._ensureCanvas()) return;

      const ctx = this._ctx;
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      const pal = this._palette();
      const d = this._data;
      const W = this._W;
      const H = this._H;

      /* layout */
      ctx.font = axisFont();
      let priceW = 0;
      const measure = (v) => ctx.measureText(v).width;
      {
        const sample = d.length ? d[d.length - 1].close : 0;
        const p = this._prec(sample || 1);
        const f = numberFmt(p);
        priceW = Math.max(
          52,
          Math.ceil(
            Math.max(
              measure(f.format(sample || 1000)),
              measure(fmtCompact(1234567))
            )
          ) + 16
        );
      }
      const timeH = 26;
      const plotRight = Math.max(30, W - priceW);
      const plotBottom = H - timeH;
      const hasRsi = !!this._ind.rsi;
      const rsiH = hasRsi ? clamp(Math.round(plotBottom * 0.24), 60, 190) : 0;
      const mainH = plotBottom - (hasRsi ? rsiH + 1 : 0);
      const ly = (this._ly = {
        W,
        H,
        priceW,
        timeH,
        plotRight,
        plotBottom,
        main: { y0: 0, y1: mainH, h: mainH },
        rsi: hasRsi ? { y0: mainH + 1, y1: plotBottom, h: rsiH - 1 } : null,
      });

      /* background */
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, W, H);
      this._nodata.hidden = d.length > 0;
      if (!d.length) {
        this._legend.innerHTML = '';
        this._legendKey = 'empty';
        return;
      }

      /* view */
      if (this._needsFit) {
        this._applyFit();
        this._needsFit = false;
      }
      if (this._auto) this._view.rightIndex = d.length - 1 + this._rightMargin();
      this._clampView();

      const v = this._view;
      const sp = v.spacing;
      const count = plotRight / sp;
      const iLeft = v.rightIndex - count;
      const i0 = Math.max(0, Math.floor(iLeft) - 1);
      const i1 = Math.min(d.length - 1, Math.ceil(v.rightIndex) + 1);

      const scale = this._mainScale(i0, i1);
      this._lastScale = scale;
      const { min, max, useLog } = scale;
      const main = ly.main;
      const tf = (p) => (useLog ? Math.log10(Math.max(p, 1e-12)) : p);
      const yOf = (p) =>
        clamp(main.y0 + ((max - tf(p)) / (max - min)) * main.h, main.y0 - 40, main.y1 + 40);
      const invY = (y) => {
        const t = max - ((y - main.y0) / main.h) * (max - min);
        return useLog ? Math.pow(10, t) : t;
      };

      /* ticks */
      const pticks = this._priceTicks(scale, main.h);
      const tticks = this._timeTicks(i0, i1);

      /* grid */
      ctx.strokeStyle = pal.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const t of pticks) {
        const y = Math.round(yOf(t)) + 0.5;
        if (y < main.y0 || y > main.y1) continue;
        ctx.moveTo(0, y);
        ctx.lineTo(plotRight, y);
      }
      for (const t of tticks) {
        const x = Math.round(t.x) + 0.5;
        if (x < 0 || x > plotRight) continue;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, plotBottom);
      }
      ctx.stroke();

      /* volume overlay */
      if (this._ind.volume) {
        let vmax = 0;
        for (let i = i0; i <= i1; i++) if (d[i].volume > vmax) vmax = d[i].volume;
        if (vmax > 0) {
          const bodyW = Math.max(1, Math.floor(sp * 0.7));
          const areaH = main.h * 0.2;
          ctx.globalAlpha = pal.volAlpha;
          // two passes by direction: fillStyle set twice instead of per bar
          for (let pass = 0; pass < 2; pass++) {
            ctx.fillStyle = pass === 0 ? pal.up : pal.down;
            for (let i = i0; i <= i1; i++) {
              const b = d[i];
              if ((b.close >= b.open) !== (pass === 0)) continue;
              const h = (b.volume / vmax) * areaH;
              if (h <= 0) continue;
              const x = this._xFor(i);
              ctx.fillRect(Math.round(x - bodyW / 2), main.y1 - 1 - h, bodyW, h);
            }
          }
          ctx.globalAlpha = 1;
        }
      }

      /* series */
      if (this._type === 'candles') {
        const bodyW = Math.max(1, Math.floor(sp * 0.7));
        // two passes (up/down): one wick path + one body-fill batch per
        // direction instead of a stroke call per bar
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass === 0 ? pal.up : pal.down;
          ctx.fillStyle = ctx.strokeStyle;
          ctx.beginPath();
          for (let i = i0; i <= i1; i++) {
            const b = d[i];
            if ((b.close >= b.open) !== (pass === 0)) continue;
            const x = Math.round(this._xFor(i)) + 0.5;
            ctx.moveTo(x, yOf(b.high));
            ctx.lineTo(x, yOf(b.low));
          }
          ctx.stroke();
          if (bodyW > 2) {
            for (let i = i0; i <= i1; i++) {
              const b = d[i];
              if ((b.close >= b.open) !== (pass === 0)) continue;
              const x = this._xFor(i);
              const yTop = yOf(Math.max(b.open, b.close));
              const yBot = yOf(Math.min(b.open, b.close));
              ctx.fillRect(Math.round(x - bodyW / 2), yTop, bodyW, Math.max(1, yBot - yTop));
            }
          }
        }
      } else {
        // line / area
        const accent = pal.accent;
        if (this._type === 'area') {
          const grad = ctx.createLinearGradient(0, main.y0, 0, main.y1);
          const c0 = hexToRgba(accent, 0.25);
          const c1 = hexToRgba(accent, 0.02);
          if (c0 !== accent || c1 !== accent) {
            grad.addColorStop(0, c0);
            grad.addColorStop(1, c1);
          } else {
            grad.addColorStop(0, accent);
            grad.addColorStop(1, accent);
          }
          ctx.globalAlpha = c0 !== accent ? 1 : 0.12;
          ctx.beginPath();
          let started = false;
          let firstX = 0;
          let lastX = 0;
          for (let i = i0; i <= i1; i++) {
            const x = this._xFor(i);
            const y = yOf(d[i].close);
            if (!started) {
              ctx.moveTo(x, y);
              firstX = x;
              started = true;
            } else ctx.lineTo(x, y);
            lastX = x;
          }
          ctx.lineTo(lastX, main.y1);
          ctx.lineTo(Math.max(firstX, -1e3), main.y1);
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        let started = false;
        for (let i = i0; i <= i1; i++) {
          const x = this._xFor(i);
          const y = yOf(d[i].close);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.lineWidth = 1;
        // last point dot
        const lx = this._xFor(i1);
        const lyv = yOf(d[i1].close);
        if (lx >= -4 && lx <= plotRight + 4) {
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(clamp(lx, 0, plotRight), clamp(lyv, main.y0, main.y1), 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      /* overlay indicators */
      this._ind.overlays.forEach((ov, idx) => {
        const s = this._series(ov.kind, ov.period);
        const color = pal.overlay[idx % pal.overlay.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let started = false;
        for (let i = i0; i <= i1; i++) {
          const val = s[i];
          if (!isNum(val)) {
            started = false;
            continue;
          }
          const x = this._xFor(i);
          const y = yOf(val);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.lineWidth = 1;
      });

      /* RSI pane */
      if (ly.rsi) {
        const rp = ly.rsi;
        const ryOf = (val) => rp.y0 + 5 + ((100 - val) / 100) * (rp.h - 10);
        const rsiS = this._series('rsi', this._ind.rsi.period);

        ctx.save();
        ctx.strokeStyle = pal.guide;
        ctx.setLineDash([3, 4]);
        for (const lvl of [30, 50, 70]) {
          const y = Math.round(ryOf(lvl)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(plotRight, y);
          ctx.globalAlpha = lvl === 50 ? 0.5 : 1;
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        ctx.strokeStyle = pal.rsi;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        for (let i = i0; i <= i1; i++) {
          const val = rsiS[i];
          if (!isNum(val)) {
            started = false;
            continue;
          }
          const x = this._xFor(i);
          const y = ryOf(val);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        // pane label
        ctx.font = axisFont(600);
        ctx.fillStyle = pal.text;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.globalAlpha = 0.9;
        ctx.fillText(
          `RSI ${this._ind.rsi.period}`,
          8,
          rp.y0 + 5
        );
        ctx.globalAlpha = 1;

        // right axis labels for RSI
        ctx.font = axisFont(400);
        ctx.fillStyle = pal.text;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (const lvl of [30, 70]) {
          ctx.fillText(String(lvl), W - 6, ryOf(lvl));
        }
      }

      /* pane separators & axis borders */
      ctx.strokeStyle = pal.border;
      ctx.beginPath();
      if (ly.rsi) {
        const y = Math.round(ly.rsi.y0) + 0.5 - 1;
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.moveTo(Math.round(plotRight) + 0.5, 0);
      ctx.lineTo(Math.round(plotRight) + 0.5, plotBottom);
      ctx.moveTo(0, Math.round(plotBottom) + 0.5);
      ctx.lineTo(W, Math.round(plotBottom) + 0.5);
      ctx.stroke();

      /* axis labels */
      const f = numberFmt(this._prec(scale.rawHi || 1));
      ctx.font = axisFont();
      ctx.fillStyle = pal.text;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const t of pticks) {
        const y = yOf(t);
        if (y < main.y0 + 7 || y > main.y1 - 5) continue;
        ctx.fillText(f.format(t), W - 6, y);
      }
      ctx.textAlign = 'center';
      for (const t of tticks) {
        if (t.x < 10 || t.x > plotRight - 10) continue;
        ctx.fillText(t.label, t.x, plotBottom + 13);
      }

      /* last price line + pill */
      const lastBar = d[d.length - 1];
      const prevBar = d[d.length - 2] || lastBar;
      const lastY = clamp(yOf(lastBar.close), main.y0 + 9, main.y1 - 9);
      const lastUp = lastBar.close >= prevBar.close;
      if (lastY > main.y0 && lastY < main.y1) {
        ctx.save();
        ctx.strokeStyle = lastUp ? pal.up : pal.down;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([1, 3]);
        ctx.beginPath();
        ctx.moveTo(0, Math.round(lastY) + 0.5);
        ctx.lineTo(plotRight, Math.round(lastY) + 0.5);
        ctx.stroke();
        ctx.restore();
        this._pill(
          plotRight + 2,
          lastY,
          f.format(lastBar.close),
          lastUp ? pal.up : pal.down,
          pal.pillText,
          'left'
        );
      }

      /* crosshair */
      if (this._hover && this._hover.index < d.length) {
        const h = this._hover;
        const hx = this._xFor(h.index);
        ctx.save();
        ctx.strokeStyle = pal.crosshair;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        const cx = Math.round(hx) + 0.5;
        if (cx >= 0 && cx <= plotRight) {
          ctx.moveTo(cx, 0);
          ctx.lineTo(cx, plotBottom);
        }
        const inMain = h.y <= main.y1;
        const inRsi = !!ly.rsi && h.y > ly.rsi.y0 && h.y <= ly.rsi.y1;
        if (inMain || inRsi) {
          const hy = Math.round(h.y) + 0.5;
          ctx.moveTo(0, hy);
          ctx.lineTo(plotRight, hy);
        }
        ctx.stroke();
        ctx.restore();

        // price pill
        if (inMain) {
          this._pill(
            plotRight + 2,
            h.y,
            f.format(invY(h.y)),
            pal.crosshairBg,
            pal.crosshairText,
            'left'
          );
        } else if (inRsi) {
          const val = clamp(
            100 - ((h.y - ly.rsi.y0 - 5) / (ly.rsi.h - 10)) * 100,
            0,
            100
          );
          this._pill(plotRight + 2, h.y, val.toFixed(1), pal.crosshairBg, pal.crosshairText, 'left');
        }

        // time pill
        const tLabel = fmtFull(d[h.index].time);
        ctx.font = pillFont();
        const tw = ctx.measureText(tLabel).width + 12;
        this._pill(
          clamp(hx - tw / 2, 2, plotRight - tw - 2),
          plotBottom + 2,
          tLabel,
          pal.crosshairBg,
          pal.crosshairText,
          'left',
          tw
        );
      }

      this._updateLegend();
    }

    _pill(x, y, text, bg, fg, align = 'left', widthOverride) {
      const ctx = this._ctx;
      ctx.save();
      ctx.font = pillFont();
      const tw = widthOverride || ctx.measureText(text).width + 12;
      const th = 18;
      const yy = clamp(y - th / 2, 0, this._H - th);
      ctx.fillStyle = bg;
      roundRectPath(ctx, x, yy, tw, th, 4);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + tw / 2, yy + th / 2 + 0.5);
      ctx.restore();
    }

    _updateLegend() {
      const d = this._data;
      if (!d.length) {
        this._legend.innerHTML = '';
        return;
      }
      const hoverIdx = this._hover ? this._hover.index : d.length - 1;
      const idx = clamp(hoverIdx, 0, d.length - 1);
      const key = [idx, this._version, this._type, this._label, this._theme, this.getAttribute('indicators')].join('|');
      if (key === this._legendKey) return;
      this._legendKey = key;

      const b = d[idx];
      const p = this._prec(b.close);
      const f = numberFmt(p);
      const pct = b.open ? ((b.close - b.open) / b.open) * 100 : 0;
      const up = b.close >= b.open;
      const cls = up ? 'up' : 'dn';
      const sign = pct >= 0 ? '+' : '';

      const esc = (s) =>
        String(s).replace(/[&<>"']/g, (c) =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
        );

      let html = `<div class="row"><span class="sym">${esc(this._label || '')}</span>`;
      if (this._type === 'candles') {
        html +=
          `<span class="kv"><span class="k">O</span><span class="v">${f.format(b.open)}</span></span>` +
          `<span class="kv"><span class="k">H</span><span class="v">${f.format(b.high)}</span></span>` +
          `<span class="kv"><span class="k">L</span><span class="v">${f.format(b.low)}</span></span>`;
      }
      html += `<span class="kv"><span class="k">C</span><span class="v ${cls}">${f.format(b.close)}</span></span>`;
      html += `<span class="pct ${cls}">${sign}${pct.toFixed(2)}%</span>`;
      if (b.volume > 0 || this._ind.volume) {
        html += `<span class="kv"><span class="k">Vol</span><span class="v">${fmtCompact(b.volume)}</span></span>`;
      }
      html += `</div>`;

      this._ind.overlays.forEach((ov, i) => {
        const s = this._series(ov.kind, ov.period);
        const val = s[idx];
        const color = (this._pal && this._pal.overlay[i % this._pal.overlay.length]) || '#f0b429';
        html +=
          `<div class="row"><span class="ind">` +
          `<i style="background:${color}"></i>${ov.kind.toUpperCase()} ${ov.period}` +
          `</span><span class="v">${isNum(val) ? f.format(val) : '—'}</span></div>`;
      });

      this._legend.innerHTML = html;
    }

    /* ------------------------------------------------------------ *
     * Interaction
     * ------------------------------------------------------------ */

    _localPoint(e) {
      const r = this._canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    _pointerDown(e) {
      if (e.button !== 0) return;
      this._canvas.setPointerCapture(e.pointerId);
      const pt = this._localPoint(e);
      this._pointers.set(e.pointerId, pt);
      if (this._pointers.size === 2) {
        const [a, b] = [...this._pointers.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this._pinch = {
          dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          spacing: this._view.spacing,
          idxAtMid: this._indexForX(mid.x),
          midX: mid.x,
        };
        this._pan = null;
      } else {
        this._pan = { x: pt.x, rightIndex: this._view.rightIndex, moved: false };
        this._canvas.classList.add('grabbing');
      }
    }

    _pointerMove(e) {
      const pt = this._localPoint(e);
      if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, pt);
      const ly = this._ly;

      if (this._pinch && this._pointers.size >= 2 && ly) {
        const [a, b] = [...this._pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const s = clamp(
          (this._pinch.spacing * dist) / this._pinch.dist,
          HabChart._MIN_SP,
          HabChart._MAX_SP
        );
        this._view.spacing = s;
        this._view.rightIndex = this._pinch.idxAtMid + (ly.plotRight - mid.x) / s;
        this._auto = this._atRight();
        this._clampView();
        this._hover = null;
        this._invalidate();
        this._emitRange();
        return;
      }

      if (this._pan && this._pointers.has(e.pointerId) && ly) {
        const dx = pt.x - this._pan.x;
        if (Math.abs(dx) > 3) this._pan.moved = true;
        this._view.rightIndex = this._pan.rightIndex - dx / this._view.spacing;
        this._auto = this._atRight();
        this._clampView();
        this._invalidate();
        this._emitRange();
        return;
      }

      if (!ly) return;
      // hover / crosshair
      const idx = clamp(Math.round(this._indexForX(pt.x)), 0, this._data.length - 1);
      this._hover = { index: idx, x: this._xFor(idx), y: pt.y };
      this._emitCrosshair(this._hover);
      this._invalidate();
    }

    _pointerUp(e) {
      const had = this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._pinch = null;
      if (this._pointers.size === 0) {
        this._canvas.classList.remove('grabbing');
        if (this._pan && had && !this._pan.moved && this._data.length) {
          // tap / click select
          const pt = this._localPoint(e);
          const idx = clamp(Math.round(this._indexForX(pt.x)), 0, this._data.length - 1);
          const price = this._yToPrice(pt.y);
          this.dispatchEvent(
            new CustomEvent('hab:select', {
              detail: { index: idx, bar: this._data[idx], price },
            })
          );
        }
        this._pan = null;
      }
    }

    _yToPrice(y) {
      const ly = this._ly;
      if (!ly || !this._data.length) return null;
      const scale = this._lastScale;
      if (!scale) return null;
      const { min, max, useLog } = scale;
      const t = max - ((y - ly.main.y0) / ly.main.h) * (max - min);
      return useLog ? Math.pow(10, t) : t;
    }

    _wheel(e) {
      const ly = this._ly;
      if (!ly || !this._data.length) return;
      e.preventDefault();
      const pt = this._localPoint(e);
      const dx = e.deltaX;
      const dy = e.deltaY * (e.deltaMode === 1 ? 33 : 1);

      if (Math.abs(dx) > Math.abs(dy) && !e.ctrlKey) {
        // trackpad horizontal scroll → pan
        this._view.rightIndex -= dx / this._view.spacing;
        this._auto = this._atRight();
        this._clampView();
        this._invalidate();
        this._emitRange();
        return;
      }

      const factor = Math.exp(-dy * (e.ctrlKey ? 0.008 : 0.0016));
      const oldSp = this._view.spacing;
      const newSp = clamp(oldSp * factor, HabChart._MIN_SP, HabChart._MAX_SP);
      if (newSp === oldSp) return;
      const idxAtCursor = this._indexForX(pt.x);
      this._view.spacing = newSp;
      this._view.rightIndex = idxAtCursor + (ly.plotRight - pt.x) / newSp;
      this._auto = this._atRight();
      this._clampView();
      this._invalidate();
      this._emitRange();
    }

    _keydown(e) {
      const ly = this._ly;
      if (!ly || !this._data.length) return;
      const d = this._data;
      const key = e.key;
      const step = e.shiftKey ? 10 : 1;
      let handled = true;

      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const cur = this._hover ? this._hover.index : d.length - 1;
        const idx = clamp(cur + (key === 'ArrowRight' ? step : -step), 0, d.length - 1);
        this._hover = { index: idx, x: this._xFor(idx), y: this._hover ? this._hover.y : ly.main.y1 * 0.5 };
        this._emitCrosshair(this._hover);
        this._invalidate();
      } else if (key === 'Home') {
        this._view.rightIndex = Math.min(2 + ly.plotRight / this._view.spacing, d.length - 1);
        this._auto = this._atRight();
        this._invalidate();
        this._emitRange();
      } else if (key === 'End') {
        this._view.rightIndex = d.length - 1 + this._rightMargin();
        this._auto = true;
        this._invalidate();
        this._emitRange();
      } else if (key === '+' || key === '=') {
        this._view.spacing = clamp(this._view.spacing * 1.25, HabChart._MIN_SP, HabChart._MAX_SP);
        this._clampView();
        this._invalidate();
        this._emitRange();
      } else if (key === '-' || key === '_') {
        this._view.spacing = clamp(this._view.spacing / 1.25, HabChart._MIN_SP, HabChart._MAX_SP);
        this._clampView();
        this._invalidate();
        this._emitRange();
      } else if (key === 'Escape') {
        this._hover = null;
        this._emitCrosshair(null);
        this._invalidate();
      } else if (key === 'Enter' || key === ' ') {
        this.fit();
      } else {
        handled = false;
      }
      if (handled) e.preventDefault();
    }

    _emitCrosshair(hover) {
      let detail = null;
      if (hover && this._data[hover.index]) {
        detail = {
          index: hover.index,
          bar: this._data[hover.index],
          x: hover.x,
          y: hover.y,
          price: this._yToPrice(hover.y),
        };
      }
      this.dispatchEvent(new CustomEvent('hab:crosshair', { detail }));
    }

    _emitRange() {
      const r = this.getVisibleRange();
      if (!r) return;
      this.dispatchEvent(new CustomEvent('hab:range', { detail: r }));
    }
  }

  if (!customElements.get('hab-chart')) {
    customElements.define('hab-chart', HabChart);
  }
})();
