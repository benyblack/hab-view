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

import {
  clamp, isNum, numberFmt, fmtCompact, autoPrecision, niceStep, hexToRgba,
  FONT_STACK, axisFont, pillFont, roundRectPath,
  TIME_STEPS, HOUR, DAY, hhmm, fmtDay, fmtMonth, fmtYear, fmtFull,
  THEMES, mergeOlderData, detectGaps,
  parseIndicators, normalizeIndicatorResult, BUILTIN_INDICATORS,
  positionPnl, checkAlertCross, computeStats, safeColor,
  SERIES_TYPES, calcHeikinAshi, buildColumns, computeVolumeProfile,
  calcRSI, detectAnnotations, priceToFreq,
} from './core.js';

/* ------------------------------------------------------------------ *
 * <hab-chart>
 * ------------------------------------------------------------------ */

  /* SSR safety: importing this module under Node (Next.js/Nuxt server render)
 * must not throw — the element simply registers only in browsers. */
const HTMLElementBase = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

class HabChart extends HTMLElementBase {
    static get observedAttributes() {
      return ['theme', 'type', 'log', 'auto', 'indicators', 'precision', 'label', 'stats', 'profile', 'annotations', 'co-view', 'sonify'];
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
          .legend .insight {
            color: var(--hab-accent, #4c8dff);
            background: var(--hab-chip, rgba(127, 137, 153, 0.12));
            border-radius: 6px;
            padding: 1px 8px;
            font-size: 11.5px;
            font-weight: 600;
          }
          .nodata {
            position: absolute; inset: 0;
            display: flex; align-items: center; justify-content: center;
            color: var(--hab-text, #8b949e);
            font: 500 13px ${FONT_STACK};
            pointer-events: none;
          }
          .nodata[hidden] { display: none; }
          .hud {
            position: absolute; right: 10px; top: 8px; z-index: 2;
            display: flex; flex-direction: column; gap: 4px; align-items: flex-end;
            pointer-events: none;
            font: 600 11.5px/1.4 ${FONT_STACK};
          }
          .hud .pos {
            display: inline-flex; gap: 9px; align-items: baseline; white-space: nowrap;
            background: var(--hab-chip, rgba(127, 137, 153, 0.12));
            border: 1px solid var(--hab-border, rgba(148, 163, 184, 0.2));
            border-radius: 7px;
            padding: 3px 9px;
          }
          .hud .statsrow {
            display: inline-flex; gap: 12px; white-space: nowrap;
            background: var(--hab-chip, rgba(127, 137, 153, 0.12));
            border: 1px solid var(--hab-border, rgba(148, 163, 184, 0.2));
            border-radius: 7px;
            padding: 3px 10px;
            color: var(--hab-text, #8b949e);
            font-variant-numeric: tabular-nums;
          }
          .hud .statsrow b { color: var(--hab-text-strong, #e6edf3); font-weight: 600; }
          .hud .k { color: var(--hab-text, #8b949e); font-weight: 500; }
          .hud .v { color: var(--hab-text-strong, #e6edf3); font-variant-numeric: tabular-nums; }
          .hud .up { color: var(--hab-up, #16c784); }
          .hud .dn { color: var(--hab-down, #ea3943); }
        </style>
        <div class="wrap" part="wrap">
          <canvas part="canvas" role="img"></canvas>
          <div class="legend" part="legend" aria-hidden="true"></div>
          <div class="hud" part="hud" aria-hidden="true">
            <div class="poss"></div>
            <div class="statsrow"></div>
          </div>
          <div class="nodata" hidden>No data</div>
        </div>`;

      this._canvas = root.querySelector('canvas');
      this._ctx = this._canvas.getContext('2d');
      this._legend = root.querySelector('.legend');
      this._hud = root.querySelector('.hud');
      this._poss = root.querySelector('.poss');
      this._statsRow = root.querySelector('.statsrow');
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
      this._stats = false;
      this._statsKey = '';
      this._profile = false;
      this._profileKey = '';
      this._profileRes = null;
      this._annotations = false;
      this._annoKey = '';
      this._annoList = null;

      // cross-tab co-view state
      this._coviewName = null;
      this._coviewCh = null;
      this._coviewPeer = '';
      this._coviewLast = 0;
      this._ghost = null;
      this._ghostTimer = 0;

      // sonification state
      this._sonify = false;
      this._actx = null;
      this._lastToneIdx = -1;
      this._playToken = 0;
      this._measure = null; // { iA, pA, iB, pB, done }
      this._measuring = false;
      this._ind = { overlays: [], panes: [], volume: true };

      this._pointers = new Map();
      this._pan = null;
      this._pinch = null;

      // history backfill state (onloadmore declared as a class field above)
      this._loadingMore = false;
      this._noMore = false;

      // trading overlays
      this._positions = [];
      this._alerts = [];
      this._seq = 0;

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
      if (this._coviewName) this._setupCoView();
      this._invalidate();
    }

    disconnectedCallback() {
      this._connected = false;
      if (this._coviewCh) {
        try {
          this._coviewCh.close();
        } catch (_) {}
        this._coviewCh = null;
      }
      clearTimeout(this._ghostTimer);
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
          this._type = SERIES_TYPES.includes(val) ? val : 'candles';
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
          this._ind = parseIndicators(val, HabChart._registry());
          break;
        case 'stats':
          this._stats = val != null && val !== 'false';
          this._statsKey = '';
          break;
        case 'profile':
          this._profile = val != null && val !== 'false';
          this._profileKey = '';
          break;
        case 'annotations':
          this._annotations = val != null && val !== 'false';
          this._annoKey = '';
          break;
        case 'co-view':
          this._coviewName = val || null;
          this._setupCoView();
          break;
        case 'sonify':
          this._sonify = val != null && val !== 'false';
          this._lastToneIdx = -1;
          break;
      }
      this._invalidate();
    }

    /* ------------------------------------------------------------ *
     * Indicator registry
     * ------------------------------------------------------------ */

    static _registryMap = null;

    /** Lazily-built registry, seeded with the built-in indicators. */
    static _registry() {
      if (!HabChart._registryMap) {
        HabChart._registryMap = new Map(BUILTIN_INDICATORS);
      }
      return HabChart._registryMap;
    }

    /**
     * Register a custom indicator.
     *
     *   HabChart.registerIndicator('vwap', {
     *     kind: 'overlay',                    // or 'pane'
     *     params: { period: 20 },             // defaults; settable via name:period
     *     compute(bars, params) {             // bars: normalized {time,o,h,l,c,v}
     *       return smaOfCloses;               // single series…
     *       // …or { lines: [{name, values}], histogram } for multi-line/panes
     *     },
     *     guides: [30, 70],                   // pane only: dashed guide levels
     *     range: [0, 100],                    // pane only: fixed scale
     *     fmt: 'price' | 'fixed1',            // legend/axis number format
     *   });
     *   chart.indicators = 'vwap:20';
     */
    /** @param {import('./core.js').IndicatorDef} def */
    static registerIndicator(name, def) {
      if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
        throw new Error('registerIndicator: invalid name');
      }
      if (!def || typeof def.compute !== 'function') {
        throw new Error('registerIndicator: def.compute must be a function');
      }
      HabChart._registry().set(name.toLowerCase(), {
        kind: def.kind === 'pane' ? 'pane' : 'overlay',
        ...def,
      });
    }

    /** The custom element class (also exported implicitly for users). */
    static get elementName() {
      return 'hab-chart';
    }

    /* ------------------------------------------------------------ *
     * Public API
     * ------------------------------------------------------------ */

    get data() {
      return this._data;
    }

    /**
     * Replace the dataset.
     * @param {Array<import('./core.js').Bar>} bars
     */
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
      // skip the O(n log n) sort when already ascending (typical for feeds)
      let sorted = true;
      for (let i = 1; i < norm.length; i++) {
        if (norm[i].time < norm[i - 1].time) {
          sorted = false;
          break;
        }
      }
      if (!sorted) norm.sort((a, b) => a.time - b.time);
      this._data = norm;
      this._version++;
      this._computeDt();
      this._needsFit = true;
      this._auto = this._autoAttr();
      this._hover = null;
      this._noMore = false;
      this._updateAria();
      this._invalidate();
    }

    /**
     * Stream a bar: replaces the last bar when `time` matches, appends when
     * newer, inserts/backfills when older.
     * @param {import('./core.js').Bar} bar
     */
    update(bar) {
      const b = HabChart._normBar(bar);
      if (!b) return;
      const d = this._data;
      const last = d[d.length - 1];
      this._checkAlerts(last ? last.close : NaN, b);
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
      this._noMore = false;
      this._updateAria();
      this._invalidate();
    }

    /**
     * Fetch older history when the view approaches the left edge.
     * The host app assigns `chart.onloadmore = async (fromTime) => bars`.
     * Bars strictly older than the current first bar are prepended and the
     * view stays anchored. Return [] / null to signal "no more data".
     * @type {null|((fromTime: number) => Promise<Array<import('./core.js').Bar>>|Array<import('./core.js').Bar>)}
     */
    onloadmore = null;

    _maybeLoadMore(iLeft) {
      if (this._loadingMore || this._noMore) return;
      if (typeof this.onloadmore !== 'function' || !this._data.length || !this._ly) return;
      const threshold = Math.max(2, (this._ly.plotRight / this._view.spacing) * 0.08);
      if (iLeft > threshold) return;
      const fromTime = this._data[0].time;
      this._loadingMore = true;
      Promise.resolve(this.onloadmore(fromTime))
        .then((bars) => {
          this._loadingMore = false;
          if (!this._connected) return;
          if (!Array.isArray(bars) || !bars.length) {
            this._noMore = true;
            return;
          }
          const older = [];
          for (const b of bars) {
            const nb = HabChart._normBar(b);
            if (nb) older.push(nb);
          }
          const { bars: merged, added } = mergeOlderData(this._data, older);
          if (!added) {
            this._noMore = true;
            return;
          }
          this._data = merged;
          this._version++;
          this._computeDt();
          // keep the exact same bars on screen: every index shifts by `added`
          this._view.rightIndex += added;
          if (this._hover) this._hover.index = Math.min(this._hover.index + added, this._data.length - 1);
          this._clampView();
          this._invalidate();
        })
        .catch(() => {
          this._loadingMore = false;
          this._noMore = true;
        });
    }

    /** Reset zoom to the default view (last ~150 bars). */
    fit() {
      this._needsFit = true;
      this._auto = true;
      this._invalidate();
      this._emitRange();
    }

    /** Visible time window. @returns {{from:number,to:number}|null} */
    /** @returns {{from: number, to: number}|null} visible time window (ms) */
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
    /** @param {{from: number, to: number}} range times in ms */
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
      this._view.spacing = clamp(plotRight / (i1 - i0), this._minSpacing(), HabChart._MAX_SP);
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

    /* ------------------------------------------------------------ *
     * State serialization
     * ------------------------------------------------------------ */

    /**
     * Serializable snapshot of the chart's configuration and view.
     * Feed it to setState() (or encodeStateQuery for shareable URLs).
     */
    /** @returns {import('./core.js').ChartState} */
    getState() {
      const range = this.getVisibleRange();
      const ind = [];
      if (this._ind.volume) ind.push('volume');
      for (const o of this._ind.overlays) ind.push(o.key);
      for (const p of this._ind.panes) ind.push(p.key);
      return {
        type: this._type,
        theme: this._theme,
        log: this._log,
        stats: this._stats,
        profile: this._profile,
        annotations: this._annotations,
        indicators: ind.join(' '),
        view: range ? { from: range.from, to: range.to } : null,
        positions: this._positions.map((p) => ({
          id: p.id, side: p.side, entry: p.entry, stop: p.stop, target: p.target, qty: p.qty,
        })),
        alerts: this._alerts
          .filter((a) => !a.fired)
          .map((a) => ({ id: a.id, price: a.price, direction: a.direction, once: a.once })),
      };
    }

    /**
     * Apply a state snapshot (from getState()). If a view range is included
     * and data is not loaded yet, it is applied after the next setData().
     * @param {import('./core.js').ChartState} state
     */
    setState(state) {
      if (!state || typeof state !== 'object') return;
      if (state.type) this.setAttribute('type', state.type);
      if (state.theme) this.setAttribute('theme', state.theme);
      if (typeof state.log === 'boolean') this.toggleAttribute('log', state.log);
      if (typeof state.stats === 'boolean') this.setAttribute('stats', String(state.stats));
      if (typeof state.profile === 'boolean') this.setAttribute('profile', String(state.profile));
      if (typeof state.annotations === 'boolean') this.setAttribute('annotations', String(state.annotations));
      if (typeof state.label === 'string') this.setAttribute('label', state.label);
      if (typeof state.indicators === 'string') {
        this.setAttribute('indicators', state.indicators);
      }
      if (Array.isArray(state.positions)) {
        this._positions = state.positions
          .filter((p) => p && isNum(p.entry))
          .map((p) => ({
            id: p.id != null ? String(p.id) : 'pos-' + ++this._seq,
            side: p.side === 'short' ? 'short' : 'long',
            entry: p.entry,
            stop: isNum(p.stop) ? p.stop : null,
            target: isNum(p.target) ? p.target : null,
            qty: isNum(p.qty) ? p.qty : null,
          }));
        this._posVersion = (this._posVersion || 0) + 1;
      }
      if (Array.isArray(state.alerts)) {
        this._alerts = state.alerts
          .filter((a) => a && isNum(a.price))
          .map((a) => ({
            id: a.id != null ? String(a.id) : 'alert-' + ++this._seq,
            price: a.price,
            direction: a.direction || 'cross',
            once: a.once !== false,
            fired: false,
          }));
      }
      if (state.view && state.view.from != null && state.view.to != null) {
        if (this._ly && this._data.length > 1) {
          this.setVisibleRange(state.view);
        } else {
          this._pendingRange = state.view;
        }
      }
      this._invalidate();
    }

    /* ------------------------------------------------------------ *
     * Positions & alerts
     * ------------------------------------------------------------ */

    /**
     * Visualize a position / order.
     * @param {{id?: string, side?: 'long'|'short', entry: number,
     *          stop?: number, target?: number, qty?: number}} pos
     * @returns {string|null} the position id
     */
    addPosition(pos) {
      if (!pos || !isNum(pos.entry)) return null;
      const p = {
        id: pos.id != null ? String(pos.id) : 'pos-' + ++this._seq,
        side: pos.side === 'short' ? 'short' : 'long',
        entry: pos.entry,
        stop: isNum(pos.stop) ? pos.stop : null,
        target: isNum(pos.target) ? pos.target : null,
        qty: isNum(pos.qty) ? pos.qty : null,
      };
      const i = this._positions.findIndex((x) => x.id === p.id);
      if (i >= 0) this._positions[i] = p;
      else this._positions.push(p);
      this._posVersion = (this._posVersion || 0) + 1;
      this._invalidate();
      return p.id;
    }

    removePosition(id) {
      this._positions = this._positions.filter((p) => p.id !== String(id));
      this._posVersion = (this._posVersion || 0) + 1;
      this._invalidate();
    }

    clearPositions() {
      this._positions = [];
      this._posVersion = (this._posVersion || 0) + 1;
      this._invalidate();
    }

    /**
     * Price alert. Fires `hab:alert` ({id, price, bar}) on an edge crossing
     * during streaming updates.
     * @param {{id?: string, price: number, direction?: 'above'|'below'|'cross',
     *          once?: boolean}} alert
     * @returns {string|null} the alert id
     */
    addAlert(alert) {
      if (!alert || !isNum(alert.price)) return null;
      const a = {
        id: alert.id != null ? String(alert.id) : 'alert-' + ++this._seq,
        price: alert.price,
        direction: alert.direction || 'cross',
        once: alert.once !== false,
        fired: false,
      };
      const i = this._alerts.findIndex((x) => x.id === a.id);
      if (i >= 0) this._alerts[i] = a;
      else this._alerts.push(a);
      this._invalidate();
      return a.id;
    }

    removeAlert(id) {
      this._alerts = this._alerts.filter((a) => a.id !== String(id));
      this._invalidate();
    }

    clearAlerts() {
      this._alerts = [];
      this._invalidate();
    }

    /** Check alerts against an incoming bar (prev close → new close). */
    _checkAlerts(prevClose, bar) {
      if (!this._alerts.length || !isNum(prevClose)) return;
      for (const a of [...this._alerts]) {
        if (a.fired) continue;
        if (checkAlertCross(a, prevClose, bar.close)) {
          a.fired = true;
          this.dispatchEvent(
            new CustomEvent('hab:alert', { detail: { id: a.id, price: a.price, bar } })
          );
          if (a.once) this._alerts = this._alerts.filter((x) => x !== a);
        }
      }
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

    static _MAX_SP = 90;

    /**
     * Lowest allowed px/bar: either 0.35, or whatever fits the entire
     * dataset on screen — so any history can be zoomed out fully.
     */
    _minSpacing() {
      const ly = this._ly;
      const w = ly ? ly.plotRight : 600;
      return Math.min(0.35, w / Math.max(60, this._data.length));
    }

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

    /**
     * Bars used for drawing/reading OHLC: raw data, or the Heikin-Ashi
     * transform for `type="heikin"` (cached per data version).
     */
    _renderBars() {
      if (this._type !== 'heikin') return this._data;
      if (this._cache.v !== this._version || !this._cache.map.__heikin) {
        if (this._cache.v !== this._version) this._cache = { v: this._version, map: {} };
        this._cache.map.__heikin = calcHeikinAshi(this._data);
      }
      return this._cache.map.__heikin;
    }

    /** RSI(14) over raw closes, cached per data version (annotation input). */
    _cachedRSI14() {
      if (this._cache.v !== this._version) {
        this._cache = { v: this._version, map: {} };
      }
      if (!this._cache.map.__rsi14) {
        this._cache.map.__rsi14 = calcRSI(this._data.map((b) => b.close), 14);
      }
      return this._cache.map.__rsi14;
    }

    /** Compute (and cache per data version) an indicator entry's series. */
    _indicatorSeries(entry) {
      if (this._cache.v !== this._version) {
        this._cache = { v: this._version, map: {} };
      }
      const k = 'ind:' + entry.key;
      if (!this._cache.map[k]) {
        let res;
        try {
          res = entry.def.compute(this._data, entry.params);
        } catch (err) {
          res = null;
        }
        this._cache.map[k] = normalizeIndicatorResult(res);
      }
      return this._cache.map[k];
    }

    /** Resolve a line color: #hex / rgb() / CSS name / palette key ('rsi', 'up', …) / cycle.
     *  Untrusted values (URL/attribute-sourced) are validated — never interpolated raw. */
    _lineColor(entry, line, pal, cycleIdx) {
      const raw =
        (line && line.color) ||
        (entry && entry.color) ||
        (entry && entry.def && entry.def.color) ||
        null;
      const fallback = pal.overlay[cycleIdx % pal.overlay.length];
      if (!raw) return fallback;
      const c = safeColor(raw);
      if (!c) return fallback; // injection attempt or garbage → safe default
      return pal[c] || c;
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
      this._view.spacing = clamp(plotRight / target, this._minSpacing(), HabChart._MAX_SP);
      this._view.rightIndex = d.length - 1 + this._rightMargin();
    }

    _clampView() {
      const d = this._data;
      const ly = this._ly;
      if (!d.length || !ly) return;
      const v = this._view;
      v.spacing = clamp(v.spacing, this._minSpacing(), HabChart._MAX_SP);
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

    _mainScale(i0, i1, cols) {
      const d = this._renderBars();
      const candles = this._type === 'candles' || this._type === 'hollow' || this._type === 'bars' || this._type === 'heikin';
      let lo = Infinity;
      let hi = -Infinity;
      if (cols) {
        for (const c of cols) {
          const h = candles ? c.high : c.close;
          const l = candles ? c.low : c.close;
          if (l < lo) lo = l;
          if (h > hi) hi = h;
        }
      } else {
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
      }
      for (const ov of this._ind.overlays) {
        const res = this._indicatorSeries(ov);
        for (const ln of res.lines) {
          const s = ln.values;
          if (cols) {
            for (const c of cols) {
              const val = s[c.i1];
              if (isNum(val)) {
                if (val < lo) lo = val;
                if (val > hi) hi = val;
              }
            }
          } else {
            for (let i = i0; i <= i1; i++) {
              const v = s[i];
              if (isNum(v)) {
                if (v < lo) lo = v;
                if (v > hi) hi = v;
              }
            }
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

    /**
     * Time-axis ticks. `sampleIdx` (optional, ascending indices) restricts
     * the walk to those bars — used at deep zoom where bars are aggregated
     * into pixel columns (keeps this O(screen) instead of O(visible bars)).
     */
    _timeTicks(i0, i1, sampleIdx) {
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
      const visit = (i) => {
        if (i < 0 || i >= d.length) return;
        const t = d[i].time;
        let key;
        let label = null;
        if (stepMs != null) {
          key = Math.floor((t + tz(t)) / stepMs);
          if (prevKey !== null && key !== prevKey) {
            if (stepLabel === 'time') {
              const prevT = d[i - 1] ? d[i - 1].time : t;
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
      };
      if (sampleIdx) {
        for (const i of sampleIdx) visit(i);
      } else {
        for (let i = Math.max(0, i0 - 1); i <= i1; i++) visit(i);
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
      const d = this._renderBars();
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
      const paneList = this._ind.panes;
      const paneArea = paneList.length
        ? Math.min(
            Math.round(plotBottom * 0.55),
            paneList.length * clamp(Math.round(plotBottom * 0.26), 60, 190)
          )
        : 0;
      const eachPaneH = paneList.length ? Math.floor(paneArea / paneList.length) : 0;
      const mainH = plotBottom - (paneList.length ? paneList.length * (eachPaneH + 1) : 0);
      const panes = paneList.map((entry, k) => {
        const y0 = mainH + 1 + k * (eachPaneH + 1);
        return { entry, y0, y1: y0 + eachPaneH - 1, h: eachPaneH - 1 };
      });
      const ly = (this._ly = {
        W,
        H,
        priceW,
        timeH,
        plotRight,
        plotBottom,
        main: { y0: 0, y1: mainH, h: mainH },
        panes,
      });

      /* background */
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, W, H);
      this._nodata.hidden = d.length > 0;
      if (!d.length) {
        this._legend.innerHTML = '';
        this._poss.innerHTML = '';
        this._statsRow.innerHTML = '';
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
      if (this._pendingRange) {
        const pr = this._pendingRange;
        this._pendingRange = null;
        this.setVisibleRange(pr);
      }

      const v = this._view;
      const sp = v.spacing;
      const count = plotRight / sp;
      const iLeft = v.rightIndex - count;
      const i0 = Math.max(0, Math.floor(iLeft) - 1);
      const i1 = Math.min(d.length - 1, Math.ceil(v.rightIndex) + 1);
      this._maybeLoadMore(iLeft);

      // deep zoom-out: aggregate bars into ~1px columns so render cost is
      // bounded by screen width, not history length
      const needCols = sp < 0.7 && i1 - i0 + 1 > plotRight * 1.5;
      const cols = needCols
        ? buildColumns(d, i0, i1, (i) => this._xFor(i), plotRight)
        : null;

      const scale = this._mainScale(i0, i1, cols);
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
      const tticks = this._timeTicks(
        i0,
        i1,
        cols ? cols.map((c) => c.i1) : null
      );

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

      /* position zones (under series) */
      for (const pos of this._positions) {
        const yE = clamp(yOf(pos.entry), main.y0, main.y1);
        if (isNum(pos.target)) {
          const yT = clamp(yOf(pos.target), main.y0, main.y1);
          ctx.fillStyle = hexToRgba(pal.up, 0.07);
          ctx.fillRect(0, Math.min(yE, yT), plotRight, Math.abs(yT - yE));
        }
        if (isNum(pos.stop)) {
          const yS = clamp(yOf(pos.stop), main.y0, main.y1);
          ctx.fillStyle = hexToRgba(pal.down, 0.07);
          ctx.fillRect(0, Math.min(yE, yS), plotRight, Math.abs(yS - yE));
        }
      }

      /* volume profile (behind the series) */
      if (this._profile) {
        const pkey = `${i0}:${i1}:${this._version}`;
        if (this._profileKey !== pkey) {
          this._profileRes = computeVolumeProfile(d, i0, i1);
          this._profileKey = pkey;
        }
        const pr = this._profileRes;
        if (pr) {
          const fp = numberFmt(this._prec(scale.rawHi || 1));
          const maxW = plotRight * 0.18;
          for (let r = 0; r < pr.rows.length; r++) {
            const row = pr.rows[r];
            if (!row.v) continue;
            const yTop = yOf(pr.priceMin + (r + 1) * pr.rowH);
            const yBot = yOf(pr.priceMin + r * pr.rowH);
            const w = (row.v / pr.maxV) * maxW;
            const inVA = r >= pr.valIndex && r <= pr.vahIndex;
            ctx.globalAlpha = inVA ? 0.38 : 0.2;
            ctx.fillStyle = row.up >= row.dn ? pal.up : pal.down;
            ctx.fillRect(plotRight - w, yBot, w, Math.max(1, yTop - yBot - 0.5));
          }
          ctx.globalAlpha = 1;
          // POC
          ctx.strokeStyle = pal.accent;
          ctx.setLineDash([6, 4]);
          const yPoc = Math.round(yOf(pr.poc)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(0, yPoc);
          ctx.lineTo(plotRight, yPoc);
          ctx.stroke();
          // value area edges
          ctx.strokeStyle = pal.guide;
          ctx.beginPath();
          for (const [lv, y] of [
            [pr.vah, Math.round(yOf(pr.vah)) + 0.5],
            [pr.val, Math.round(yOf(pr.val)) + 0.5],
          ]) {
            void lv;
            ctx.moveTo(0, y);
            ctx.lineTo(plotRight, y);
          }
          ctx.stroke();
          ctx.setLineDash([]);
          // right-axis labels
          ctx.font = axisFont(600);
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = pal.accent;
          ctx.fillText(`POC ${fp.format(pr.poc)}`, W - 6, yPoc);
          ctx.fillStyle = pal.text;
          ctx.font = axisFont(500);
          ctx.fillText(`VAH ${fp.format(pr.vah)}`, W - 6, yOf(pr.vah));
          ctx.fillText(`VAL ${fp.format(pr.val)}`, W - 6, yOf(pr.val));
        }
      }

      /* smart annotations (skipped at deep zoom where bars collapse into columns) */
      if (this._annotations && !cols) {
        const akey = `${i0}:${i1}:${this._version}`;
        if (this._annoKey !== akey) {
          this._annoList = detectAnnotations(this._data, i0, i1, this._cachedRSI14());
          this._annoKey = akey;
          this._legendKey = ''; // legend may now show insights at the hovered bar
          this.dispatchEvent(
            new CustomEvent('hab:annotations', { detail: { annotations: this._annoList } })
          );
        }
        const A = this._annoList;
        if (A.length) {
          const BADGE_BG = {
            volspike: '#f0b429',
            gap: '#22d3ee',
            pivothigh: '#8b949e',
            pivotlow: '#8b949e',
            divbear: '#ea3943',
            divbull: '#16c784',
          };
          const BADGE_TXT = { volspike: 'V', gap: 'G', pivothigh: 'H', pivotlow: 'L', divbear: 'D', divbull: 'D' };
          for (const a of A) {
            const x = this._xFor(a.i);
            if (x < 10 || x > plotRight - 10) continue;
            const b = d[a.i];
            if (!b) continue;
            const y = a.side === 'high' ? yOf(b.high) - 9 : yOf(b.low) + 9;
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fillStyle = BADGE_BG[a.type] || '#8b949e';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = pal.bg && pal.bg !== 'transparent' ? pal.bg : '#0d1117';
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.font = `700 7.5px ${FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(BADGE_TXT[a.type] || '?', x, y + 0.5);
          }
          ctx.lineWidth = 1;
        }
      }

      /* volume overlay */
      if (this._ind.volume) {
        let vmax = 0;
        if (cols) {
          for (const c of cols) if (c.volume > vmax) vmax = c.volume;
        } else {
          for (let i = i0; i <= i1; i++) if (d[i].volume > vmax) vmax = d[i].volume;
        }
        if (vmax > 0) {
          const bodyW = Math.max(1, Math.floor(sp * 0.7));
          const areaH = main.h * 0.2;
          ctx.globalAlpha = pal.volAlpha;
          if (cols) {
            for (const c of cols) {
              const h = (c.volume / vmax) * areaH;
              if (h <= 0) continue;
              ctx.fillStyle = c.close >= c.open ? pal.up : pal.down;
              ctx.fillRect(c.x, main.y1 - 1 - h, 1, h);
            }
          } else {
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
          }
          ctx.globalAlpha = 1;
        }
      }

      /* series */
      const tStyle = this._type;
      if (tStyle === 'candles' || tStyle === 'hollow' || tStyle === 'bars' || tStyle === 'heikin') {
        if (cols) {
          // deep zoom: one hi-lo line per pixel column, colored by column direction
          for (let pass = 0; pass < 2; pass++) {
            ctx.strokeStyle = pass === 0 ? pal.up : pal.down;
            ctx.beginPath();
            for (const c of cols) {
              if ((c.close >= c.open) !== (pass === 0)) continue;
              const x = c.x + 0.5;
              ctx.moveTo(x, yOf(c.high));
              ctx.lineTo(x, yOf(c.low));
            }
            ctx.stroke();
          }
        } else {
        const bodyW = Math.max(1, Math.floor(sp * 0.7));
        const hollow = tStyle === 'hollow';
        const barsStyle = tStyle === 'bars';
        const tickLen = barsStyle ? Math.max(2, Math.floor(sp * 0.35)) : 0;
        // two passes (up/down): one wick path + one body batch per direction
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
            if (barsStyle && bodyW >= 3) {
              // OHLC ticks: open to the left, close to the right
              ctx.moveTo(x - tickLen, yOf(b.open));
              ctx.lineTo(x, yOf(b.open));
              ctx.moveTo(x, yOf(b.close));
              ctx.lineTo(x + tickLen, yOf(b.close));
            }
          }
          ctx.stroke();
          if (bodyW > 2 && !barsStyle) {
            const hollowPass = hollow && pass === 0; // up candles are outlined only
            for (let i = i0; i <= i1; i++) {
              const b = d[i];
              if ((b.close >= b.open) !== (pass === 0)) continue;
              const x = this._xFor(i);
              const yTop = yOf(Math.max(b.open, b.close));
              const yBot = yOf(Math.min(b.open, b.close));
              const h = Math.max(1, yBot - yTop);
              const bx = Math.round(x - bodyW / 2);
              if (hollowPass) {
                ctx.strokeRect(bx + 0.5, yTop + 0.5, Math.max(1, bodyW - 1), Math.max(1, h - 1));
              } else {
                ctx.fillRect(bx, yTop, bodyW, h);
              }
            }
          }
        }
        }
      } else {
        // line / area (column-sampled at deep zoom)
        const accent = pal.accent;
        const pts = [];
        if (cols) {
          for (const c of cols) pts.push([c.x, yOf(c.close)]);
        } else {
          for (let i = i0; i <= i1; i++) pts.push([this._xFor(i), yOf(d[i].close)]);
        }
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
          ctx.moveTo(pts.length ? pts[0][0] : 0, pts.length ? pts[0][1] : main.y1);
          for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
          if (pts.length) {
            ctx.lineTo(pts[pts.length - 1][0], main.y1);
            ctx.lineTo(pts[0][0], main.y1);
          }
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        for (let k = 0; k < pts.length; k++) {
          if (k === 0) ctx.moveTo(pts[k][0], pts[k][1]);
          else ctx.lineTo(pts[k][0], pts[k][1]);
        }
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.lineWidth = 1;
        // last point dot
        if (pts.length) {
          const [lx, lyv] = pts[pts.length - 1];
          if (lx >= -4 && lx <= plotRight + 4) {
            ctx.fillStyle = accent;
            ctx.beginPath();
            ctx.arc(clamp(lx, 0, plotRight), clamp(lyv, main.y0, main.y1), 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      /* overlay indicators */
      this._ind.overlays.forEach((entry, idx) => {
        const res = this._indicatorSeries(entry);
        res.lines.forEach((ln, li) => {
          const s = ln.values;
          if (!s) return;
          const color = this._lineColor(entry, ln, pal, idx + li);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.lineJoin = 'round';
          ctx.beginPath();
          let started = false;
          if (cols) {
            for (const c of cols) {
              const val = s[c.i1];
              if (!isNum(val)) {
                started = false;
                continue;
              }
              if (!started) {
                ctx.moveTo(c.x, yOf(val));
                started = true;
              } else ctx.lineTo(c.x, yOf(val));
            }
          } else {
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
          }
          ctx.stroke();
        });
        ctx.lineWidth = 1;
      });

      /* session / data-gap dividers */
      {
        const gaps = detectGaps(d, i0, i1, this._dt, 3);
        if (gaps.length) {
          ctx.save();
          ctx.strokeStyle = pal.crosshair;
          ctx.globalAlpha = 0.55;
          ctx.setLineDash([2, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (const gi of gaps) {
            const x =
              Math.round((this._xFor(gi - 1) + this._xFor(gi)) / 2) + 0.5;
            if (x < 0 || x > plotRight) continue;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, plotBottom);
          }
          ctx.stroke();
          ctx.restore();
        }
      }

      /* position lines, tags & price alerts */
      if (this._positions.length || this._alerts.length) {
        const fP = numberFmt(this._prec(scale.rawHi || 1));

        // alerts: dashed lines + diamond marker at the right edge
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = pal.overlay[0];
        for (const a of this._alerts) {
          if (a.fired) continue;
          const y = yOf(a.price);
          if (y < main.y0 || y > main.y1) continue;
          ctx.globalAlpha = 0.8;
          ctx.beginPath();
          ctx.moveTo(0, Math.round(y) + 0.5);
          ctx.lineTo(plotRight, Math.round(y) + 0.5);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = pal.overlay[0];
          const mx = plotRight - 7;
          ctx.beginPath();
          ctx.moveTo(mx, y - 4);
          ctx.lineTo(mx + 4, y);
          ctx.lineTo(mx, y + 4);
          ctx.lineTo(mx - 4, y);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();

        for (const pos of this._positions) {
          const yE = clamp(yOf(pos.entry), main.y0, main.y1);
          ctx.strokeStyle = pal.accent;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, Math.round(yE) + 0.5);
          ctx.lineTo(plotRight, Math.round(yE) + 0.5);
          ctx.stroke();
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          for (const [lv, col] of [
            [pos.stop, pal.down],
            [pos.target, pal.up],
          ]) {
            if (!isNum(lv)) continue;
            const y = clamp(yOf(lv), main.y0, main.y1);
            ctx.strokeStyle = col;
            ctx.beginPath();
            ctx.moveTo(0, Math.round(y) + 0.5);
            ctx.lineTo(plotRight, Math.round(y) + 0.5);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          const tag = `${pos.side === 'short' ? 'S' : 'L'} ${fP.format(pos.entry)}`;
          ctx.font = pillFont();
          const tw = ctx.measureText(tag).width + 10;
          this._pill(plotRight - tw - 8, yE, tag, pal.accent, pal.pillText, 'left', tw);
        }
      }

      /* indicator panes */
      for (const pr of ly.panes) {
        const entry = pr.entry;
        const res = this._indicatorSeries(entry);
        if (!res.lines.length && !res.histogram) continue;
        const fmtV = (v) =>
          entry.def.fmt === 'fixed1'
            ? numberFmt(1).format(v)
            : numberFmt(this._prec(scale.rawHi || 1)).format(v);

        // pane scale (fixed range or autoscaled from visible values)
        let pmin = Infinity;
        let pmax = -Infinity;
        if (Array.isArray(entry.def.range) && entry.def.range.length === 2) {
          pmin = entry.def.range[0];
          pmax = entry.def.range[1];
        } else {
          const scan = (arr) => {
            for (let i = i0; i <= i1; i++) {
              const v = arr[i];
              if (isNum(v)) {
                if (v < pmin) pmin = v;
                if (v > pmax) pmax = v;
              }
            }
          };
          for (const ln of res.lines) scan(ln.values);
          if (res.histogram) scan(res.histogram);
          if (!isFinite(pmin) || !isFinite(pmax)) {
            pmin = 0;
            pmax = 1;
          }
          if (pmax === pmin) {
            const e = Math.abs(pmax) * 0.05 || 1;
            pmax += e;
            pmin -= e;
          }
          const pad = (pmax - pmin) * 0.08;
          pmin -= pad;
          pmax += pad;
        }
        const pyOf = (v) => pr.y0 + 5 + ((pmax - v) / (pmax - pmin)) * (pr.h - 10);
        const invPy = (y) => pmax - ((y - pr.y0 - 5) / (pr.h - 10)) * (pmax - pmin);
        pr.pyOf = pyOf;
        pr.invPy = invPy;

        ctx.save();
        // guides
        ctx.strokeStyle = pal.guide;
        ctx.setLineDash([3, 4]);
        for (const g of entry.def.guides || []) {
          const y = Math.round(pyOf(g)) + 0.5;
          if (y < pr.y0 || y > pr.y1) continue;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(plotRight, y);
          ctx.stroke();
        }
        ctx.setLineDash([]);

        // histogram (e.g. MACD)
        if (res.histogram) {
          const bodyW = Math.max(1, Math.floor(sp * 0.55));
          const y0 = clamp(pyOf(0), pr.y0, pr.y1);
          ctx.globalAlpha = 0.55;
          if (cols) {
            for (const c of cols) {
              const val = res.histogram[c.i1];
              if (!isNum(val)) continue;
              ctx.fillStyle = val >= 0 ? pal.up : pal.down;
              const y = pyOf(val);
              ctx.fillRect(c.x, Math.min(y, y0), 1, Math.max(1, Math.abs(y - y0)));
            }
          } else {
          for (let pass = 0; pass < 2; pass++) {
            ctx.fillStyle = pass === 0 ? pal.up : pal.down;
            for (let i = i0; i <= i1; i++) {
              const v = res.histogram[i];
              if (!isNum(v)) continue;
              if ((v >= 0) !== (pass === 0)) continue;
              const y = pyOf(v);
              const x = this._xFor(i);
              ctx.fillRect(
                Math.round(x - bodyW / 2),
                Math.min(y, y0),
                bodyW,
                Math.max(1, Math.abs(y - y0))
              );
            }
          }
          }
          ctx.globalAlpha = 1;
        }

        // lines
        res.lines.forEach((ln, li) => {
          const color = this._lineColor(entry, ln, pal, li);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.lineJoin = 'round';
          ctx.beginPath();
          let started = false;
          const plot = (x, val) => {
            if (!started) {
              ctx.moveTo(x, pyOf(val));
              started = true;
            } else ctx.lineTo(x, pyOf(val));
          };
          if (cols) {
            for (const c of cols) {
              const val = ln.values[c.i1];
              if (!isNum(val)) {
                started = false;
                continue;
              }
              plot(c.x, val);
            }
          } else {
            for (let i = i0; i <= i1; i++) {
              const val = ln.values[i];
              if (!isNum(val)) {
                started = false;
                continue;
              }
              plot(this._xFor(i), val);
            }
          }
          ctx.stroke();
        });
        ctx.lineWidth = 1;
        ctx.restore();

        // right-axis labels for guide levels
        ctx.font = axisFont(400);
        ctx.fillStyle = pal.text;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (const g of entry.def.guides || []) {
          ctx.fillText(fmtV(g), W - 6, pyOf(g));
        }

        // pane label + live values (script panes show their expression label)
        const hi = this._hover ? clamp(this._hover.index, 0, d.length - 1) : d.length - 1;
        const vals = res.lines
          .map((ln) => (isNum(ln.values[hi]) ? fmtV(ln.values[hi]) : '—'))
          .join('  ');
        const paneLabel =
          (entry.name === 'expr' || entry.name === 'pexpr') && res.lines[0] && res.lines[0].name
            ? res.lines[0].name
            : `${entry.name.toUpperCase()} ${Object.values(entry.params).join(' ')}`;
        ctx.font = axisFont(600);
        ctx.fillStyle = pal.text;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.globalAlpha = 0.9;
        ctx.fillText(`${paneLabel}${vals ? '   ' + vals : ''}`, 8, pr.y0 + 5);
        ctx.globalAlpha = 1;
      }

      /* pane separators & axis borders */
      ctx.strokeStyle = pal.border;
      ctx.beginPath();
      for (const pr of ly.panes) {
        const y = Math.round(pr.y0) - 0.5;
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
        const paneUnder = inMain
          ? null
          : ly.panes.find((p) => h.y >= p.y0 && h.y <= p.y1);
        if (inMain || paneUnder) {
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
        } else if (paneUnder) {
          const fmtV =
            paneUnder.entry.def.fmt === 'fixed1'
              ? (v) => v.toFixed(1)
              : (v) => f.format(v);
          this._pill(
            plotRight + 2,
            h.y,
            fmtV(paneUnder.invPy(h.y)),
            pal.crosshairBg,
            pal.crosshairText,
            'left'
          );
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

      /* co-view ghost crosshair (peer pointer from another tab/chart) */
      if (this._ghost) {
        const g = this._ghost;
        const gx = this._xFor(g.index);
        const gxVisible = gx >= 0 && gx <= plotRight;
        ctx.save();
        ctx.strokeStyle = pal.accent;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        if (gxVisible) {
          const cx = Math.round(gx) + 0.5;
          ctx.moveTo(cx, 0);
          ctx.lineTo(cx, plotBottom);
        }
        if (g.yFrac != null) {
          const gy = Math.round(main.y0 + g.yFrac * main.h) + 0.5;
          ctx.moveTo(0, gy);
          ctx.lineTo(plotRight, gy);
          if (gxVisible) {
            ctx.fillStyle = pal.accent;
            ctx.beginPath();
            ctx.arc(gx, main.y0 + g.yFrac * main.h, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.stroke();
        ctx.restore();
        if (gxVisible && this._data[g.index]) {
          const tLabel = fmtFull(this._data[g.index].time);
          ctx.font = pillFont();
          const tw = ctx.measureText(tLabel).width + 12;
          this._pill(
            clamp(gx - tw / 2, 2, plotRight - tw - 2),
            plotBottom + 2,
            tLabel,
            pal.accent,
            pal.pillText,
            'left',
            tw
          );
        }
      }

      /* measure tool overlay */
      if (this._measure && this._measure.pA != null && this._measure.pB != null) {
        const m = this._measure;
        const xa = this._xFor(m.iA);
        const xb = this._xFor(m.iB);
        const ya = clamp(yOf(m.pA), main.y0, main.y1);
        const yb = clamp(yOf(m.pB), main.y0, main.y1);
        const rx0 = Math.min(xa, xb);
        const rx1 = Math.max(xa, xb);
        const ry0 = Math.min(ya, yb);
        const ry1 = Math.max(ya, yb);
        if (rx1 - rx0 > 2 && ry1 - ry0 > 2) {
          ctx.save();
          ctx.fillStyle = hexToRgba(pal.accent, 0.06);
          ctx.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
          ctx.strokeStyle = pal.crosshair;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(Math.round(rx0) + 0.5, Math.round(ry0) + 0.5, rx1 - rx0, ry1 - ry0);
          ctx.restore();
        }
        const barsN = Math.abs(m.iB - m.iA);
        const ms = Math.abs((d[m.iB] ? d[m.iB].time : 0) - (d[m.iA] ? d[m.iA].time : 0));
        const hrs = Math.floor(ms / 3600e3);
        const dP = m.pB - m.pA;
        const dPct = m.pA ? (dP / m.pA) * 100 : 0;
        const label =
          `${dP >= 0 ? '+' : ''}${f.format(dP)} (${dPct >= 0 ? '+' : ''}${dPct.toFixed(2)}%)` +
          ` · ${barsN} bars` +
          ` · ${hrs >= 24 ? Math.floor(hrs / 24) + 'd ' + (hrs % 24) + 'h' : hrs + 'h'}`;
        ctx.font = pillFont();
        const tw = ctx.measureText(label).width + 14;
        this._pill(
          clamp((rx0 + rx1) / 2 - tw / 2, 2, plotRight - tw - 2),
          clamp((ry0 + ry1) / 2, 10, plotBottom - 10),
          label,
          pal.crosshairBg,
          pal.crosshairText,
          'left',
          tw
        );
      }

      /* visible-range stats chip */
      if (this._stats) {
        const st = computeStats(d, i0, i1, this._dt);
        const skey = st ? `${i0}:${i1}:${this._version}` : 'none';
        if (skey !== this._statsKey) {
          this._statsKey = skey;
          if (st) {
            const pct = (v, dgt = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(dgt)}%`;
            this._statsRow.innerHTML =
              `<span><b>${pct(st.changePct)}</b></span>` +
              `<span>maxDD ${st.maxDDPct.toFixed(1)}%</span>` +
              `<span>ann.vol ${st.annVolPct.toFixed(0)}%</span>` +
              `<span>up ${st.up} / dn ${st.dn}</span>` +
              `<span>vol ${fmtCompact(st.avgVolume)}</span>`;
          } else {
            this._statsRow.innerHTML = '';
          }
        }
      } else if (this._statsRow.innerHTML) {
        this._statsRow.innerHTML = '';
        this._statsKey = '';
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
      const d = this._renderBars();
      if (!d.length) {
        this._legend.innerHTML = '';
        return;
      }
      const hoverIdx = this._hover ? this._hover.index : d.length - 1;
      const idx = clamp(hoverIdx, 0, d.length - 1);
      const key = [
        idx, this._version, this._type, this._label, this._theme,
        this.getAttribute('indicators'), this._positions.length, this._posVersion || 0,
      ].join('|');
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

      const palNow = this._palette();
      this._ind.overlays.forEach((entry, i) => {
        const res = this._indicatorSeries(entry);
        if (!res.lines.length) return;
        const dotColor = this._lineColor(entry, res.lines[0], palNow, i);
        const vals = res.lines
          .map((ln) => (isNum(ln.values[idx]) ? f.format(ln.values[idx]) : '—'))
          .join('  ');
        // script indicators carry their expression in the line name; built-ins show name+params
        const label =
          (entry.name === 'expr' || entry.name === 'pexpr') && res.lines[0].name
            ? esc(res.lines[0].name)
            : `${entry.name.toUpperCase()} ${Object.values(entry.params).join(' ')}`;
        html += `<div class="row"><span class="ind"><i style="background:${dotColor}"></i>${label}</span><span class="v">${vals}</span></div>`;
      });

      if (this._annotations && this._annoList) {
        const notes = this._annoList.filter((a) => a.i === idx).map((a) => a.note);
        if (notes.length) {
          html += `<div class="row"><span class="insight">${notes.map(esc).join(' · ')}</span></div>`;
        }
      }

      this._legend.innerHTML = html;
      this._updateHud();
    }

    /** Position P&L chips (top-right HTML overlay). */
    _updateHud() {
      const poss = this._poss;
      if (!this._positions.length) {
        if (poss.innerHTML) poss.innerHTML = '';
        return;
      }
      const d = this._data;
      const price = d.length ? d[d.length - 1].close : NaN;
      const f = numberFmt(this._prec(price || 1));
      const esc = (s) =>
        String(s).replace(/[&<>"']/g, (c) =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
        );
      let html = '';
      for (const p of this._positions) {
        const pnl = positionPnl(p, price);
        const pct = p.entry ? (pnl / p.entry) * 100 : 0;
        const cls = pnl >= 0 ? 'up' : 'dn';
        const qtyStr = p.qty != null ? ' ' + p.qty : '';
        html +=
          `<div class="pos">` +
          `<span class="k">${esc(p.side === 'short' ? 'SHORT' : 'LONG')}${esc(qtyStr)} @ ${f.format(p.entry)}</span>` +
          `<span class="v ${cls}">${pnl >= 0 ? '+' : ''}${f.format(pnl)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)</span>` +
          `</div>`;
      }
      poss.innerHTML = html;
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
        this._measuring = false;
      } else if (e.shiftKey && this._data.length) {
        // shift+drag → measure tool
        this._measuring = true;
        const idx = clamp(Math.round(this._indexForX(pt.x)), 0, this._data.length - 1);
        this._measure = {
          iA: idx,
          pA: this._yToPrice(pt.y),
          iB: idx,
          pB: this._yToPrice(pt.y),
          done: false,
        };
        this._pan = null;
        this._invalidate();
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
          this._minSpacing(),
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

      if (this._measuring && this._pointers.has(e.pointerId)) {
        const idx = clamp(Math.round(this._indexForX(pt.x)), 0, this._data.length - 1);
        this._measure.iB = idx;
        this._measure.pB = this._yToPrice(pt.y);
        this._invalidate();
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
      this._maybeSonify(idx);
      this._emitCrosshair(this._hover);
      this._invalidate();
    }

    _pointerUp(e) {
      const had = this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._pinch = null;
      if (this._pointers.size === 0) {
        this._canvas.classList.remove('grabbing');
        if (this._measuring) {
          this._measuring = false;
          if (this._measure) {
            this._measure.done = true;
            const m = this._measure;
            const d = this._data;
            const barA = d[clamp(m.iA, 0, d.length - 1)];
            const barB = d[clamp(m.iB, 0, d.length - 1)];
            this.dispatchEvent(
              new CustomEvent('hab:measure', {
                detail: {
                  from: { index: m.iA, time: barA.time, price: m.pA },
                  to: { index: m.iB, time: barB.time, price: m.pB },
                  bars: Math.abs(m.iB - m.iA),
                },
              })
            );
          }
        } else if (this._pan && had && !this._pan.moved && this._data.length) {
          if (this._measure) {
            // a plain click clears a finished measurement
            this._measure = null;
            this._invalidate();
          } else {
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
      const newSp = clamp(oldSp * factor, this._minSpacing(), HabChart._MAX_SP);
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
        this._maybeSonify(idx);
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
        this._view.spacing = clamp(this._view.spacing * 1.25, this._minSpacing(), HabChart._MAX_SP);
        this._clampView();
        this._invalidate();
        this._emitRange();
      } else if (key === '-' || key === '_') {
        this._view.spacing = clamp(this._view.spacing / 1.25, this._minSpacing(), HabChart._MAX_SP);
        this._clampView();
        this._invalidate();
        this._emitRange();
      } else if (key === 'Escape') {
        this._hover = null;
        this._measure = null;
        this._measuring = false;
        this._emitCrosshair(null);
        this._invalidate();
      } else if (key === 'Enter' || key === ' ') {
        this.fit();
      } else {
        handled = false;
      }
      if (handled) e.preventDefault();
    }

    /* ------------------------------------------------------------ *
     * Sonification — the chart by ear (a11y)
     * ------------------------------------------------------------ */

    /** Lazily-created shared AudioContext (enable within a user gesture). */
    _audio() {
      if (this._actx) return this._actx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        this._actx = new AC();
      } catch (_) {
        this._actx = null;
      }
      return this._actx;
    }

    /** Short sine blip; `when` schedules against AudioContext time. */
    _tone(freq, dur = 0.14, when = 0) {
      const ctx = this._audio();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const t0 = when || ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    /** One tone for a bar's close, pitched by its position on the y-scale. */
    _sonifyBar(i) {
      if (!this._sonify || !this._data.length || !this._lastScale) return;
      const d = this._renderBars();
      const b = d[clamp(i, 0, d.length - 1)];
      if (!b) return;
      this._tone(priceToFreq(b.close, this._lastScale));
    }

    /** One tone per crosshair bar change (dedupes y-only moves). */
    _maybeSonify(idx) {
      if (!this._sonify) return;
      if (this._lastToneIdx === idx) return;
      this._lastToneIdx = idx;
      this._sonifyBar(idx);
    }

    /**
     * Play the visible range as a pitch sweep (~4s), riding the crosshair —
     * the audible equivalent of running your eye along the price line.
     */
    playRange() {
      if (!this._data.length || !this._ly) return;
      const ctx = this._audio();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const d = this._renderBars();
      const count = Math.max(2, Math.round(this._ly.plotRight / this._view.spacing));
      const i0 = clamp(Math.floor(this._view.rightIndex - count) - 1, 0, d.length - 1);
      const i1 = clamp(Math.ceil(this._view.rightIndex), 0, d.length - 1);
      if (i1 - i0 < 2) return;
      const N = Math.min(120, i1 - i0 + 1);
      const stepMs = Math.min(70, Math.max(24, 4000 / N));
      const t0 = ctx.currentTime + 0.05;
      for (let k = 0; k < N; k++) {
        const i = Math.round(i0 + ((i1 - i0) * k) / (N - 1));
        const b = d[i];
        if (!b) continue;
        this._tone(priceToFreq(b.close, this._lastScale), stepMs / 1000 * 0.9, t0 + (k * stepMs) / 1000);
      }
      // ride the crosshair along the sweep for sighted users
      this._playToken++;
      const token = this._playToken;
      let k = 0;
      const timer = setInterval(() => {
        if (token !== this._playToken || !this._connected) {
          clearInterval(timer);
          return;
        }
        if (k >= N) {
          clearInterval(timer);
          this._hover = null;
          this._emitCrosshair(null);
          this._invalidate();
          return;
        }
        const i = Math.round(i0 + ((i1 - i0) * k) / (N - 1));
        this._hover = { index: i, x: this._xFor(i), y: this._ly ? this._ly.main.h * 0.5 : 0 };
        this._invalidate();
        k++;
      }, stepMs);
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

      // co-view: share the pointer with peer charts (leave events bypass throttle)
      if (this._coviewCh) {
        if (!detail) {
          this._coviewSend({ type: 'cross', time: null, yFrac: null });
        } else {
          const now = performance.now();
          if (now - this._coviewLast > 40) {
            this._coviewLast = now;
            const ly = this._ly;
            this._coviewSend({
              type: 'cross',
              time: detail.bar.time,
              yFrac: ly && isNum(detail.y) ? clamp(detail.y / ly.main.h, 0, 1) : null,
            });
          }
        }
      }
    }

    /* ------------------------------------------------------------ *
     * Cross-tab co-view (BroadcastChannel)
     * ------------------------------------------------------------ */

    /** Join/leave the co-view channel named by the `co-view` attribute. */
    _setupCoView() {
      if (this._coviewCh) {
        try {
          this._coviewCh.close();
        } catch (_) {}
        this._coviewCh = null;
      }
      clearTimeout(this._ghostTimer);
      if (this._ghost) {
        this._ghost = null;
        this._invalidate();
      }
      const name = this._coviewName;
      if (!name || !this._connected || typeof BroadcastChannel === 'undefined') return;
      if (!this._coviewPeer) this._coviewPeer = 'p' + Math.random().toString(36).slice(2, 8);
      try {
        const ch = new BroadcastChannel('hab-co-view:' + name);
        ch.onmessage = (ev) => this._onCoMessage(ev.data);
        this._coviewCh = ch;
      } catch (_) {}
    }

    _coviewSend(msg) {
      if (!this._coviewCh) return;
      try {
        this._coviewCh.postMessage({ v: 1, peer: this._coviewPeer, ...msg });
      } catch (_) {}
    }

    _onCoMessage(m) {
      if (!m || m.v !== 1 || m.peer === this._coviewPeer || m.type !== 'cross') return;
      if (m.time == null) {
        if (this._ghost) {
          this._ghost = null;
          clearTimeout(this._ghostTimer);
          this._invalidate();
        }
        return;
      }
      if (!isNum(m.time) || !this._data.length) return;
      this._ghost = {
        index: HabChart._indexForTime(this._data, m.time),
        yFrac: isNum(m.yFrac) ? clamp(m.yFrac, 0, 1) : null,
        at: Date.now(),
      };
      clearTimeout(this._ghostTimer);
      this._ghostTimer = setTimeout(() => {
        this._ghost = null;
        this._invalidate();
      }, 2500);
      this._invalidate();
    }

    _emitRange() {
      const r = this.getVisibleRange();
      if (!r) return;
      this.dispatchEvent(new CustomEvent('hab:range', { detail: r }));
    }
  }

if (typeof customElements !== 'undefined' && !customElements.get('hab-chart')) {
  customElements.define('hab-chart', HabChart);
}

export default HabChart;
