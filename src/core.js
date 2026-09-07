/* ==========================================================================
 * HabView core — pure, DOM-free functions shared by <hab-chart> and tests.
 * Importable in the browser (ESM) and in Node (`node --test`).
 * MIT License.
 * ========================================================================== */

/* ------------------------------------------------------------------ *
 * Public types (JSDoc — the source of truth for the generated .d.ts)
 * ------------------------------------------------------------------ */

/**
 * A single OHLCV bar. `time` is milliseconds (second-based input is
 * auto-detected and converted).
 * @typedef {object} Bar
 * @property {number} time
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} [volume]
 */

/**
 * One plotted line of an indicator result.
 * @typedef {object} IndicatorLine
 * @property {string} [name]
 * @property {Array<number|null>} values
 * @property {string} [color] #hex / rgb() / CSS name / palette key
 */

/**
 * An indicator definition for {@link registerIndicator}.
 * @typedef {object} IndicatorDef
 * @property {'overlay'|'pane'} [kind] overlay on the price pane, or a stacked sub-pane
 * @property {Record<string, number>} [params] defaults; set via `name:p1/p2` tokens
 * @property {(bars: Bar[], params: Record<string, number>) => (Array<number|null>|{lines?: IndicatorLine[], histogram?: Array<number|null>})} compute
 * @property {number[]} [guides] pane only: dashed horizontal levels
 * @property {[number, number]} [range] pane only: fixed scale (else autoscale)
 * @property {'price'|'fixed1'} [fmt] legend/axis number format
 * @property {string} [color]
 */

/**
 * A position/order visualization.
 * @typedef {object} Position
 * @property {string} id
 * @property {'long'|'short'} side
 * @property {number} entry
 * @property {number|null} stop
 * @property {number|null} target
 * @property {number|null} qty
 */

/**
 * A price alert (edge-triggered on streamed crossings).
 * @typedef {object} Alert
 * @property {string} id
 * @property {number} price
 * @property {'above'|'below'|'cross'} direction
 * @property {boolean} once
 */

/**
 * Serializable chart snapshot (see `getState()` / `setState()`).
 * @typedef {object} ChartState
 * @property {'candles'|'line'|'area'|'bars'|'hollow'|'heikin'} [type]
 * @property {'dark'|'light'} [theme]
 * @property {boolean} [log]
 * @property {boolean} [stats]
 * @property {string} [label]
 * @property {string} [indicators]
 * @property {{from: number, to: number}} [view] visible time window (ms)
 * @property {Array<Position & {id?: string, stop?: number, target?: number, qty?: number}>} [positions] partial positions to add
 * @property {Array<Alert & {id?: string, once?: boolean}>} [alerts] partial alerts to add
 */

/**
 * A parsed indicator entry (internal token → def binding).
 * @typedef {object} IndicatorEntry
 * @property {string} name
 * @property {IndicatorDef} def
 * @property {Record<string, number>} params
 * @property {string|null} color
 * @property {string} key
 */

/* ------------------------------------------------------------------ *
 * Small utilities
 * ------------------------------------------------------------------ */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

const nfCache = new Map();
export function numberFmt(p) {
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
export function fmtCompact(v) {
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

export function autoPrecision(v) {
  const a = Math.abs(v);
  if (a >= 1000) return 2;
  if (a >= 10) return 2;
  if (a >= 1) return 3;
  if (a >= 0.01) return 5;
  return 8;
}

/** Nice round step (1, 2, 5 × 10^n) covering `range` in ~`target` steps. */
export function niceStep(range, target) {
  if (!(range > 0) || !isNum(range)) return 1;
  const raw = range / Math.max(1, target);
  const exp = Math.floor(Math.log10(raw));
  const f = raw / Math.pow(10, exp);
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * Math.pow(10, exp);
}

export function hexToRgba(color, alpha) {
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

/**
 * Strict CSS color validator — accepts #hex, rgb()/rgba(), and CSS named
 * colors only. Anything else (breakout attempts, URLs, quotes) → null.
 * Use before interpolating untrusted colors into HTML or canvas styles.
 */
const SAFE_COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0?\.\d+|1|0)\s*)?\)|[a-zA-Z]{3,20})$/;
export function safeColor(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return SAFE_COLOR_RE.test(t) ? t : null;
}

export const FONT_STACK =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const axisFont = (w = 500) => `${w} 11px ${FONT_STACK}`;
export const pillFont = () => `600 11px ${FONT_STACK}`;

export function roundRectPath(ctx, x, y, w, h, r) {
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
 * Time axis helpers
 * ------------------------------------------------------------------ */

export const SEC = 1000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

// Sub-day / day-aligned steps (ms), plus month/year handled separately.
export const TIME_STEPS = [
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

export const hhmm = (t) => {
  const d = new Date(t);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
};
export const fmtDay = (t) => dtf(DAY_FMT).format(t);
export const fmtMonth = (t, withYear) => dtf(withYear ? MON_Y_FMT : MON_FMT).format(t);
export const fmtYear = (t) => dtf(YR_FMT).format(t);
export const fmtFull = (t) => {
  const d = new Date(t);
  return dtf(DAY_FMT).format(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
};

/* ------------------------------------------------------------------ *
 * Themes (every key overridable via --hab-* CSS custom properties)
 * ------------------------------------------------------------------ */

export const THEMES = {
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

/**
 * @param {number[]} values
 * @param {number} period
 * @returns {Array<number|null>}
 */
export function calcSMA(values, period) {
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

/**
 * @param {number[]} values
 * @param {number} period
 * @returns {Array<number|null>}
 */
export function calcEMA(values, period) {
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

/** EMA over a series that may contain leading nulls (e.g. MACD line).
 * @param {Array<number|null>} values
 * @param {number} period
 * @returns {Array<number|null>}
 */
export function calcEMASparse(values, period) {
  const out = new Array(values.length).fill(null);
  let start = 0;
  while (start < values.length && !isNum(values[start])) start++;
  if (start + period > values.length) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = start; i < start + period; i++) seed += values[i];
  let prev = seed / period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * @param {number[]} closes
 * @param {number} period
 * @returns {Array<number|null>}
 */
export function calcRSI(closes, period) {
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

/** Rolling standard deviation (population) over `period`, aligned like SMA. */
export function calcStdDev(values, period) {
  const out = new Array(values.length).fill(null);
  if (period < 2 || values.length < period) return out;
  // Welford-style rolling via sums for O(n)
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    sumSq += values[i] * values[i];
    if (i >= period) {
      const old = values[i - period];
      sum -= old;
      sumSq -= old * old;
    }
    if (i >= period - 1) {
      const n = period;
      const varr = Math.max(0, sumSq / n - (sum / n) * (sum / n));
      out[i] = Math.sqrt(varr);
    }
  }
  return out;
}

/**
 * Bollinger Bands.
 * @param {number[]} closes
 * @param {number} period
 * @param {number} [mult]
 * @returns {{mid:Array<number|null>, upper:Array<number|null>, lower:Array<number|null>}}
 */
export function calcBollinger(closes, period, mult = 2) {
  const mid = calcSMA(closes, period);
  const sd = calcStdDev(closes, period);
  const upper = mid.map((m, i) => (isNum(m) && isNum(sd[i]) ? m + mult * sd[i] : null));
  const lower = mid.map((m, i) => (isNum(m) && isNum(sd[i]) ? m - mult * sd[i] : null));
  return { mid, upper, lower };
}

/**
 * MACD.
 * @param {number[]} closes
 * @param {number} [fast]
 * @param {number} [slow]
 * @param {number} [signal]
 * @returns {{macd:Array<number|null>, signal:Array<number|null>, hist:Array<number|null>}}
 */
export function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaF = calcEMA(closes, fast);
  const emaS = calcEMA(closes, slow);
  const macd = closes.map((_, i) =>
    isNum(emaF[i]) && isNum(emaS[i]) ? emaF[i] - emaS[i] : null
  );
  const sig = calcEMASparse(macd, signal);
  const hist = macd.map((m, i) => (isNum(m) && isNum(sig[i]) ? m - sig[i] : null));
  return { macd, signal: sig, hist };
}

/* ------------------------------------------------------------------ *
 * Data merging & gaps
 * ------------------------------------------------------------------ */

/**
 * Merge older (backfilled) bars in front of `existing`.
 * Dedupes by time (existing bars win); only strictly older bars are prepended.
 * @param {Bar[]} existing
 * @param {Bar[]} older
 * @returns {{bars: Bar[], added: number}} merged array and count prepended.
 */
export function mergeOlderData(existing, older) {
  if (!Array.isArray(older) || !older.length) return { bars: existing, added: 0 };
  const first = existing.length ? existing[0].time : Infinity;
  const seen = new Set(existing.map((b) => b.time));
  const prepend = [];
  for (const b of older) {
    if (!b || !isNum(b.time)) continue;
    if (existing.length && b.time >= first) continue;
    if (seen.has(b.time)) continue;
    seen.add(b.time);
    prepend.push(b);
  }
  if (!prepend.length) return { bars: existing, added: 0 };
  prepend.sort((a, b) => a.time - b.time);
  return { bars: prepend.concat(existing), added: prepend.length };
}

/**
 * Indices of visible bars whose time jump from the previous bar exceeds
 * `threshold × dt` (sessions breaks, weekends, missing data).
 * @param {Bar[]} bars
 * @param {number} i0
 * @param {number} i1
 * @param {number} dtMs
 * @param {number} [threshold]
 * @returns {number[]}
 */
export function detectGaps(bars, i0, i1, dtMs, threshold = 3) {
  const gaps = [];
  const th = (dtMs > 0 ? dtMs : HOUR) * threshold;
  for (let i = Math.max(1, i0); i <= i1; i++) {
    if (bars[i].time - bars[i - 1].time > th) gaps.push(i);
  }
  return gaps;
}

/**
 * Aggregate a visible bar range into ~1px-wide columns for deep zoom-outs.
 * `xOf(i)` must be non-decreasing in i (index-space x mapping guarantees it).
 * Each column keeps first open / max high / min low / last close / volume sum.
 * @param {Bar[]} bars
 * @param {number} i0
 * @param {number} i1
 * @param {(i: number) => number} xOf
 * @param {number} plotRight plot width in px (column count)
 * @returns {Array<{x: number, i0: number, i1: number, open: number, high: number, low: number, close: number, volume: number}>}
 */
export function buildColumns(bars, i0, i1, xOf, plotRight) {
  const byIndex = [];
  for (let i = i0; i <= i1; i++) {
    const b = bars[i];
    const x = Math.floor(xOf(i));
    const k = x < 0 ? 0 : x >= plotRight ? plotRight - 1 : x;
    let c = byIndex[k];
    if (!c) {
      byIndex[k] = {
        x: k,
        i0: i,
        i1: i,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume || 0,
      };
    } else {
      c.i1 = i;
      if (b.high > c.high) c.high = b.high;
      if (b.low < c.low) c.low = b.low;
      c.close = b.close;
      c.volume += b.volume || 0;
    }
  }
  const cols = [];
  for (let k = 0; k < byIndex.length; k++) if (byIndex[k]) cols.push(byIndex[k]);
  return cols;
}

/** Supported values for the `type` attribute. */
export const SERIES_TYPES = ['candles', 'line', 'area', 'bars', 'hollow', 'heikin'];

/**
 * Heikin-Ashi transform (smoothed candles; time/volume pass through).
 * @param {Bar[]} bars
 * @returns {Bar[]}
 */
export function calcHeikinAshi(bars) {
  const out = new Array(bars.length);
  let po = null;
  let pc = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = po == null ? (b.open + b.close) / 2 : (po + pc) / 2;
    out[i] = {
      time: b.time,
      open,
      close,
      high: Math.max(b.high, open, close),
      low: Math.min(b.low, open, close),
      volume: b.volume,
    };
    po = open;
    pc = close;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Indicator registry
 * ------------------------------------------------------------------ */

/**
 * Normalize an indicator compute() result to
 * `{ lines: [{name, values, color?}], histogram: number[] | null }`.
 */
export function normalizeIndicatorResult(res) {
  if (!res) return { lines: [], histogram: null };
  if (Array.isArray(res)) return { lines: [{ name: '', values: res }], histogram: null };
  return {
    lines: Array.isArray(res.lines) ? res.lines : [],
    histogram: Array.isArray(res.histogram) ? res.histogram : null,
  };
}

const closesOf = (bars) => bars.map((b) => b.close);

/** Built-in indicator definitions (name → def). */
export const BUILTIN_INDICATORS = new Map(
  Object.entries({
    sma: {
      kind: 'overlay',
      params: { period: 20 },
      compute: (bars, p) => calcSMA(closesOf(bars), p.period),
    },
    ema: {
      kind: 'overlay',
      params: { period: 50 },
      compute: (bars, p) => calcEMA(closesOf(bars), p.period),
    },
    bb: {
      kind: 'overlay',
      params: { period: 20, mult: 2 },
      compute: (bars, p) => {
        const { mid, upper, lower } = calcBollinger(closesOf(bars), p.period, p.mult);
        return {
          lines: [
            { name: 'upper', values: upper },
            { name: 'mid', values: mid },
            { name: 'lower', values: lower },
          ],
        };
      },
    },
    rsi: {
      kind: 'pane',
      params: { period: 14 },
      guides: [30, 70],
      range: [0, 100],
      fmt: 'fixed1',
      color: 'rsi',
      compute: (bars, p) => calcRSI(closesOf(bars), p.period),
    },
    macd: {
      kind: 'pane',
      params: { fast: 12, slow: 26, signal: 9 },
      guides: [0],
      fmt: 'price',
      compute: (bars, p) => {
        const r = calcMACD(closesOf(bars), p.fast, p.slow, p.signal);
        return {
          lines: [
            { name: 'macd', values: r.macd },
            { name: 'signal', values: r.signal },
          ],
          histogram: r.hist,
        };
      },
    },
  })
);

/**
 * Parse an `indicators` attribute string against a registry.
 * Token: `name[:param[/param…]][@color]`, plus the `volume` keyword.
 * @param {string|null|undefined} str
 * @param {Map<string, IndicatorDef>} registry
 * @returns {{overlays: IndicatorEntry[], panes: IndicatorEntry[], volume: boolean, unknown: string[]}}
 */
export function parseIndicators(str, registry) {
  const out = { overlays: [], panes: [], volume: false, unknown: [] };
  if (str == null || str === '') return out;
  const seen = new Set();
  for (const raw of String(str).split(/[\s,;]+/)) {
    if (!raw) continue;
    const m = raw.match(/^([A-Za-z][A-Za-z0-9_]*)(?::([^@]*))?(@.+)?$/);
    if (!m) continue;
    const [, name, paramStr, colorStr] = m;
    if (name === 'volume') {
      out.volume = true;
      continue;
    }
    const key = name.toLowerCase();
    const def = registry.get(key);
    if (!def) {
      out.unknown.push(name);
      continue;
    }
    const dedupe = key + ':' + (paramStr || '');
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const defaults = def.params || {};
    const params = {};
    const parts = paramStr ? paramStr.split('/').map((s) => parseFloat(s)) : [];
    Object.keys(defaults).forEach((k, i) => {
      params[k] = isNum(parts[i]) ? parts[i] : defaults[k];
    });

    const entry = {
      name: key,
      def,
      params,
      color: colorStr ? colorStr.slice(1) : null,
      key: dedupe,
    };
    if (def.kind === 'pane') out.panes.push(entry);
    else out.overlays.push(entry);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Trading overlays
 * ------------------------------------------------------------------ */

/**
 * Unrealized P&L of a position at `price`.
 * @param {{side?: 'long'|'short', entry: number, qty?: number}} pos
 * @param {number} price
 * @returns {number}
 */
export function positionPnl(pos, price) {
  if (!pos || !isNum(pos.entry) || !isNum(price)) return 0;
  const dir = pos.side === 'short' ? -1 : 1;
  const qty = isNum(pos.qty) ? pos.qty : 1;
  return (price - pos.entry) * dir * qty;
}

/**
 * Edge-triggered alert crossing test between two consecutive prices.
 * @param {{price: number, direction?: 'above'|'below'|'cross'}} alert
 * @param {number} prevPrice
 * @param {number} price
 * @returns {boolean}
 */
export function checkAlertCross(alert, prevPrice, price) {
  if (!alert || !isNum(alert.price) || !isNum(prevPrice) || !isNum(price)) return false;
  const p = alert.price;
  const dir = alert.direction || 'cross';
  if (dir === 'above') return prevPrice <= p && price > p;
  if (dir === 'below') return prevPrice >= p && price < p;
  return (prevPrice <= p && price > p) || (prevPrice >= p && price < p);
}

/* ------------------------------------------------------------------ *
 * Visible-range statistics
 * ------------------------------------------------------------------ */

/**
 * Statistics over a visible slice of bars.
 * @param {Bar[]} bars
 * @param {number} i0
 * @param {number} i1
 * @param {number} dtMs
 * @returns {null|{n:number, changePct:number, min:number, max:number, maxDDPct:number, annVolPct:number, up:number, dn:number, avgVolume:number}}
 */
export function computeStats(bars, i0, i1, dtMs) {
  const n = i1 - i0 + 1;
  if (!bars.length || n < 2 || i0 < 0 || i1 >= bars.length) return null;
  const first = bars[i0].close;
  const last = bars[i1].close;
  let min = Infinity;
  let max = -Infinity;
  let peak = -Infinity;
  let maxDD = 0;
  let up = 0;
  let dn = 0;
  let volSum = 0;
  let volBars = 0;
  let lrSum = 0;
  let lrSumSq = 0;
  let lrN = 0;
  let prev = first;
  for (let i = i0; i <= i1; i++) {
    const b = bars[i];
    if (b.close < min) min = b.close;
    if (b.close > max) max = b.close;
    if (b.close > peak) peak = b.close;
    const dd = peak > 0 ? (peak - b.close) / peak : 0;
    if (dd > maxDD) maxDD = dd;
    if (i > i0) {
      if (b.close >= prev) up++;
      else dn++;
      if (prev > 0 && b.close > 0) {
        const lr = Math.log(b.close / prev);
        lrSum += lr;
        lrSumSq += lr * lr;
        lrN++;
      }
    }
    if (isNum(b.volume) && b.volume > 0) {
      volSum += b.volume;
      volBars++;
    }
    prev = b.close;
  }
  const variance = lrN > 1 ? Math.max(0, lrSumSq / lrN - (lrSum / lrN) * (lrSum / lrN)) : 0;
  const sd = Math.sqrt(variance);
  const periodsPerYear = dtMs > 0 ? (365 * 24 * 3600e3) / dtMs : 252;
  return {
    n,
    changePct: first ? ((last - first) / first) * 100 : 0,
    min,
    max,
    maxDDPct: maxDD * 100,
    annVolPct: sd * Math.sqrt(periodsPerYear) * 100,
    up,
    dn,
    avgVolume: volBars ? volSum / volBars : 0,
  };
}

/* ------------------------------------------------------------------ *
 * State serialization (shareable URLs)
 * ------------------------------------------------------------------ */

/**
 * Encode a chart state (from getState()) as a compact query string.
 * View times are encoded in whole seconds.
 * @param {ChartState|null} state
 * @returns {string}
 */
export function encodeStateQuery(state) {
  if (!state || typeof state !== 'object') return '';
  const p = new URLSearchParams();
  if (state.type) p.set('type', state.type);
  if (state.theme) p.set('theme', state.theme);
  if (state.log) p.set('log', '1');
  if (state.stats) p.set('stats', '1');
  if (state.indicators) p.set('ind', state.indicators.trim().replace(/\s+/g, ','));
  if (state.view) {
    if (isNum(state.view.from)) p.set('from', String(Math.floor(state.view.from / 1000)));
    if (isNum(state.view.to)) p.set('to', String(Math.floor(state.view.to / 1000)));
  }
  return p.toString();
}

/**
 * Decode a query string (from encodeStateQuery) back into a partial state.
 * @param {string} str
 * @returns {ChartState}
 */
export function decodeStateQuery(str) {
  const p = new URLSearchParams(typeof str === 'string' ? str : '');
  const state = {};
  const type = p.get('type');
  if (type) state.type = type;
  const theme = p.get('theme');
  if (theme) state.theme = theme;
  if (p.get('log') === '1') state.log = true;
  if (p.get('stats') === '1') state.stats = true;
  const ind = p.get('ind');
  if (ind) state.indicators = ind.split(',').map((s) => s.trim()).filter(Boolean).join(' ');
  const from = p.get('from');
  const to = p.get('to');
  if (from != null || to != null) {
    state.view = {
      from: from != null && isNum(+from) ? +from * 1000 : undefined,
      to: to != null && isNum(+to) ? +to * 1000 : undefined,
    };
  }
  return state;
}
