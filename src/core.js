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
 * @property {boolean} [profile] volume profile overlay (POC + value area)
 * @property {boolean} [annotations] smart annotations (spikes/gaps/pivots/divergences)
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

/** Linear-weighted moving average (most recent bar weighs `period`), aligned like SMA.
 * @param {number[]} values
 * @param {number} period
 * @returns {Array<number|null>}
 */
export function calcWMA(values, period) {
  const out = new Array(values.length).fill(null);
  if (period < 1 || values.length < period) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - j] * (period - j);
    out[i] = sum / denom;
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

/**
 * Detect notable events over a visible bar window.
 * Volume spikes (> volMult × SMA(volume)), price gaps beyond the previous
 * bar's range (> gapMult × average range), pivot highs/lows (± pivot bars),
 * and RSI divergences (later higher high with weaker RSI, and symmetric lows).
 *
 * @param {Bar[]} bars full dataset (raw)
 * @param {number} i0 first visible index
 * @param {number} i1 last visible index
 * @param {Array<number|null>|null} rsi precomputed RSI series (or null to skip divergences)
 * @param {{pivot?: number, volMult?: number, gapMult?: number, divDist?: number}} [opts]
 * @returns {Array<{type: string, side: 'high'|'low', i: number, note: string}>}
 */
export function detectAnnotations(bars, i0, i1, rsi, opts = {}) {
  const N = opts.pivot ?? 20;
  const volK = opts.volMult ?? 3;
  const gapK = opts.gapMult ?? 0.5;
  const minDist = opts.divDist ?? 10;
  const out = [];
  if (!bars.length || i0 < 0 || i1 < i0 || i1 >= bars.length) return out;
  const n = bars.length;

  const period = Math.min(20, Math.max(2, Math.floor(n / 2)));
  const volSma = calcSMA(bars.map((b) => b.volume), period);
  const rngSma = calcSMA(bars.map((b) => b.high - b.low), period);

  for (let i = i0; i <= i1; i++) {
    const b = bars[i];
    const vs = volSma[i];
    if (isNum(vs) && vs > 0 && b.volume > volK * vs) {
      out.push({
        type: 'volspike',
        side: 'high',
        i,
        note: `Volume ${(b.volume / vs).toFixed(1)}× average`,
      });
      continue;
    }
    if (i > 0) {
      const prev = bars[i - 1];
      const rs = rngSma[i];
      if (isNum(rs) && rs > 0 && prev.close > 0) {
        const upGap = b.open - prev.high;
        const dnGap = prev.low - b.open;
        if (upGap > gapK * rs) {
          out.push({ type: 'gap', side: 'low', i, note: `Gapped up +${((upGap / prev.close) * 100).toFixed(2)}%` });
        } else if (dnGap > gapK * rs) {
          out.push({ type: 'gap', side: 'low', i, note: `Gapped down −${((dnGap / prev.close) * 100).toFixed(2)}%` });
        }
      }
    }
  }

  // pivot highs / lows (strict extremum over the ±N window)
  for (let i = Math.max(i0, N); i <= Math.min(i1, n - 1 - N); i++) {
    let isHigh = true;
    let isLow = true;
    const hi = bars[i].high;
    const lo = bars[i].low;
    for (let j = i - N; j <= i + N && (isHigh || isLow); j++) {
      if (j === i) continue;
      if (bars[j].high >= hi) isHigh = false;
      if (bars[j].low <= lo) isLow = false;
    }
    if (isHigh) out.push({ type: 'pivothigh', side: 'high', i, note: `${2 * N + 1}-bar high` });
    if (isLow) out.push({ type: 'pivotlow', side: 'low', i, note: `${2 * N + 1}-bar low` });
  }

  // RSI divergences between the two strongest extremes of the window
  if (rsi) {
    const top2 = (value) => {
      let e1 = -1;
      for (let i = i0; i <= i1; i++) if (e1 < 0 || value(i) > value(e1)) e1 = i;
      let e2 = -1;
      for (let i = i0; i <= i1; i++) {
        if (Math.abs(i - e1) < minDist) continue;
        if (e2 < 0 || value(i) > value(e2)) e2 = i;
      }
      return [e1, e2];
    };
    const [h1, h2] = top2((i) => bars[i].high);
    if (h1 >= 0 && h2 >= 0 && isNum(rsi[h1]) && isNum(rsi[h2])) {
      const later = Math.max(h1, h2);
      const earlier = Math.min(h1, h2);
      if (bars[later].high > bars[earlier].high && rsi[later] < rsi[earlier] - 2) {
        out.push({ type: 'divbear', side: 'high', i: later, note: 'Bearish RSI divergence' });
      }
    }
    const [l1, l2] = top2((i) => -bars[i].low);
    if (l1 >= 0 && l2 >= 0 && isNum(rsi[l1]) && isNum(rsi[l2])) {
      const later = Math.max(l1, l2);
      const earlier = Math.min(l1, l2);
      if (bars[later].low < bars[earlier].low && rsi[later] > rsi[earlier] + 2) {
        out.push({ type: 'divbull', side: 'low', i: later, note: 'Bullish RSI divergence' });
      }
    }
  }

  return out.length > 80 ? out.slice(0, 80) : out;
}

/**
 * Map a price to a sonification frequency over the visible scale.
 * Logarithmic scales map through log-space; result clamped to [lo, hi] Hz.
 * @param {number} price
 * @param {{min: number, max: number, useLog?: boolean}} scale
 * @param {number} [freqLo=180]
 * @param {number} [freqHi=880]
 * @returns {number} frequency in Hz
 */
export function priceToFreq(price, scale, freqLo = 180, freqHi = 880) {
  if (!scale || !(scale.max > scale.min)) return (freqLo + freqHi) / 2;
  let t;
  if (scale.useLog) {
    // scale.min/max are already log10-transformed in this mode
    t = (Math.log10(Math.max(price, 1e-12)) - scale.min) / (scale.max - scale.min || 1);
  } else {
    t = (price - scale.min) / (scale.max - scale.min);
  }
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return freqLo + t * (freqHi - freqLo);
}

/**
 * Volume profile over a visible bar range: volume distributed into price
 * rows, with POC and the value area (greedy expansion around the POC).
 * @param {Bar[]} bars
 * @param {number} i0
 * @param {number} i1
 * @param {{rows?: number, valueAreaPct?: number}} [opts]
 * @returns {null|{
 *   rows: Array<{v: number, up: number, dn: number}>, maxV: number, total: number,
 *   rowH: number, priceMin: number, priceMax: number,
 *   pocIndex: number, valIndex: number, vahIndex: number,
 *   poc: number, val: number, vah: number
 * }}
 */
export function computeVolumeProfile(bars, i0, i1, opts) {
  const rowCount = (opts && opts.rows) || 100;
  const vaPct = (opts && opts.valueAreaPct) || 0.7;
  if (!bars.length || i0 < 0 || i1 < i0 || i1 >= bars.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = i0; i <= i1; i++) {
    const b = bars[i];
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
  }
  if (!isFinite(lo) || !isFinite(hi) || !(hi > lo)) return null;
  const rowH = (hi - lo) / rowCount;
  const up = new Array(rowCount).fill(0);
  const dn = new Array(rowCount).fill(0);
  for (let i = i0; i <= i1; i++) {
    const b = bars[i];
    const v = isNum(b.volume) ? b.volume : 0;
    if (v <= 0) continue;
    let r0 = Math.floor((b.low - lo) / rowH);
    let r1 = Math.floor((b.high - lo) / rowH);
    r0 = clamp(r0, 0, rowCount - 1);
    r1 = clamp(r1, 0, rowCount - 1);
    const per = v / (r1 - r0 + 1);
    const target = b.close >= b.open ? up : dn;
    for (let r = r0; r <= r1; r++) target[r] += per;
  }
  const tot = new Array(rowCount);
  let maxV = 0;
  let total = 0;
  let pocIndex = 0;
  for (let r = 0; r < rowCount; r++) {
    tot[r] = up[r] + dn[r];
    total += tot[r];
    if (tot[r] > maxV) {
      maxV = tot[r];
      pocIndex = r;
    }
  }
  if (!maxV) return null;
  // value area: greedily expand around the POC until vaPct of volume is covered
  let loI = pocIndex;
  let hiI = pocIndex;
  let acc = tot[pocIndex];
  const goal = total * vaPct;
  while (acc < goal && (loI > 0 || hiI < rowCount - 1)) {
    const below = loI > 0 ? tot[loI - 1] : -1;
    const above = hiI < rowCount - 1 ? tot[hiI + 1] : -1;
    if (above >= below) {
      hiI++;
      acc += tot[hiI];
    } else {
      loI--;
      acc += tot[loI];
    }
  }
  const priceAt = (r) => lo + (r + 0.5) * rowH;
  return {
    rows: tot.map((v, r) => ({ v, up: up[r], dn: dn[r] })),
    maxV,
    total,
    rowH,
    priceMin: lo,
    priceMax: hi,
    pocIndex,
    valIndex: loI,
    vahIndex: hiI,
    poc: priceAt(pocIndex),
    val: priceAt(loI),
    vah: priceAt(hiI),
  };
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
 * Token: `name[:param[/param…]][@color]`, the `volume` keyword, and
 * HabScript blobs `expr:{…}` (overlay) / `pexpr:{…}` (separate pane).
 * @param {string|null|undefined} str
 * @param {Map<string, IndicatorDef>} registry
 * @returns {{overlays: IndicatorEntry[], panes: IndicatorEntry[], volume: boolean, unknown: string[]}}
 */
export function parseIndicators(str, registry) {
  const out = { overlays: [], panes: [], volume: false, unknown: [] };
  if (str == null || str === '') return out;
  const seen = new Set();
  for (const raw of splitIndicatorTokens(str)) {
    const em = raw.match(/^(p?expr):\{([^{}]*)\}(@\S*)?$/i);
    if (em) {
      const pane = em[1].toLowerCase() === 'pexpr';
      const src = em[2].trim();
      let def;
      try {
        def = scriptIndicator(src, { pane });
      } catch (err) {
        out.unknown.push(em[1] + ':{' + src + '}');
        continue;
      }
      const key = (pane ? 'pexpr' : 'expr') + ':{' + src.toLowerCase() + '}';
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = {
        name: pane ? 'pexpr' : 'expr',
        def,
        params: {},
        color: em[3] ? em[3].slice(1) : null,
        key,
      };
      if (pane) out.panes.push(entry);
      else out.overlays.push(entry);
      continue;
    }
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
 * HabScript — safe expression mini-language for custom indicators
 *
 * `expr:{(close - sma(close,20)) / sma(close,20)}` compiles through a
 * hand-written tokenizer + recursive-descent parser (no eval / Function)
 * and evaluates element-wise over the bar series.
 * ------------------------------------------------------------------ */

const SCRIPT_MAX_LEN = 512;
const SCRIPT_MAX_TOKENS = 128;
const SCRIPT_MAX_DEPTH = 24;

/** Series variables available inside expressions. */
const SCRIPT_VARS = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4'];

/**
 * Functions available inside expressions. `scalar` lists argument indexes
 * that must be plain whole-number literals (periods / shifts).
 */
const SCRIPT_FUNCS = {
  sma: { min: 2, max: 2, scalar: [1] },
  ema: { min: 2, max: 2, scalar: [1] },
  wma: { min: 2, max: 2, scalar: [1] },
  stddev: { min: 2, max: 2, scalar: [1] },
  rsi: { min: 2, max: 2, scalar: [1] },
  hh: { min: 2, max: 2, scalar: [1] },
  ll: { min: 2, max: 2, scalar: [1] },
  prev: { min: 1, max: 2, scalar: [1] },
  change: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
  sqrt: { min: 1, max: 1 },
  log: { min: 1, max: 1 },
  min: { min: 2, max: 2 },
  max: { min: 2, max: 2 },
  crossup: { min: 2, max: 2 },
  crossdown: { min: 2, max: 2 },
};

const scriptErr = (msg) => new Error('script: ' + msg);

/**
 * Split an indicators string into tokens, keeping `expr:{…}` / `pexpr:{…}`
 * blobs atomic — spaces and commas inside the braces are preserved, and an
 * optional `@color` suffix directly after `}` stays attached.
 * Separators are whitespace, `,` and `;`.
 * @param {string|null|undefined} str
 * @returns {string[]}
 */
export function splitIndicatorTokens(str) {
  const out = [];
  const s = String(str == null ? '' : str);
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,;]/.test(s[i])) i++;
    if (i >= s.length) break;
    let j = i;
    if (/^(p?expr):\{/i.test(s.slice(i))) {
      const end = s.indexOf('}', i);
      if (end === -1) {
        out.push(s.slice(i)); // unterminated → caller rejects the token
        break;
      }
      j = end + 1;
      if (s[j] === '@') {
        j++;
        while (j < s.length && !/[\s,;]/.test(s[j])) j++;
      }
    } else {
      while (j < s.length && !/[\s,;]/.test(s[j])) j++;
    }
    out.push(s.slice(i, j));
    i = j;
  }
  return out.filter(Boolean);
}

/** Tokenize an expression (numbers, identifiers, operators, `( ) ,`). */
function tokenizeScript(src) {
  if (typeof src !== 'string' || !src.trim()) throw scriptErr('empty expression');
  if (src.length > SCRIPT_MAX_LEN) throw scriptErr(`expression longer than ${SCRIPT_MAX_LEN} chars`);
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    const isDigit = c >= '0' && c <= '9';
    if (isDigit || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      const m = src.slice(i).match(/^\d*\.?\d+/);
      toks.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    const isAlpha = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
    if (isAlpha) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      toks.push({ t: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '%') {
      toks.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      toks.push({ t: c });
      i++;
      continue;
    }
    throw scriptErr(`unexpected character "${c}"`);
  }
  if (!toks.length) throw scriptErr('empty expression');
  if (toks.length > SCRIPT_MAX_TOKENS) throw scriptErr(`more than ${SCRIPT_MAX_TOKENS} tokens`);
  return toks;
}

/** Recursive-descent parse into a small AST; validates identifiers, calls and arities. */
function parseScript(src) {
  const toks = tokenizeScript(src);
  let p = 0;
  const peek = () => toks[p];

  function parseAdd(depth) {
    let l = parseMul(depth);
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = toks[p++].v;
      l = { type: 'bin', op, l, r: parseMul(depth) };
    }
    return l;
  }
  function parseMul(depth) {
    let l = parseUnary(depth);
    while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/' || peek().v === '%')) {
      const op = toks[p++].v;
      l = { type: 'bin', op, l, r: parseUnary(depth) };
    }
    return l;
  }
  function parseUnary(depth) {
    if (depth > SCRIPT_MAX_DEPTH) throw scriptErr('expression too deeply nested');
    const t = peek();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
      p++;
      const e = parseUnary(depth + 1);
      return t.v === '-' ? { type: 'neg', e } : e;
    }
    return parseAtom(depth + 1);
  }
  function parseAtom(depth) {
    if (depth > SCRIPT_MAX_DEPTH) throw scriptErr('expression too deeply nested');
    const t = toks[p++];
    if (!t) throw scriptErr('unexpected end of expression');
    if (t.t === 'num') return { type: 'num', v: t.v };
    if (t.t === 'id') {
      const name = t.v.toLowerCase();
      if (peek() && peek().t === '(') {
        p++;
        const args = [];
        if (peek() && peek().t !== ')') {
          args.push(parseAdd(depth));
          while (peek() && peek().t === ',') {
            p++;
            args.push(parseAdd(depth));
          }
        }
        const close = toks[p++];
        if (!close || close.t !== ')') throw scriptErr(`missing ")" after ${name}(`);
        return { type: 'call', name, args };
      }
      if (!SCRIPT_VARS.includes(name)) throw scriptErr(`unknown identifier "${t.v}"`);
      return { type: 'var', name };
    }
    if (t.t === '(') {
      const e = parseAdd(depth);
      const close = toks[p++];
      if (!close || close.t !== ')') throw scriptErr('missing ")"');
      return e;
    }
    throw scriptErr(`unexpected token "${t.t === 'op' ? t.v : t.t}"`);
  }

  const ast = parseAdd(0);
  if (p < toks.length) throw scriptErr('unexpected trailing input');
  validateScriptNode(ast);
  return ast;
}

function validateScriptNode(n) {
  if (!n || n.type === 'num' || n.type === 'var') return;
  if (n.type === 'neg') return validateScriptNode(n.e);
  if (n.type === 'bin') {
    validateScriptNode(n.l);
    validateScriptNode(n.r);
    return;
  }
  if (n.type === 'call') {
    const spec = SCRIPT_FUNCS[n.name];
    if (!spec) throw scriptErr(`unknown function "${n.name}"`);
    if (n.args.length < spec.min || n.args.length > spec.max) {
      const want = spec.min === spec.max ? String(spec.min) : `${spec.min}–${spec.max}`;
      throw scriptErr(`${n.name}() takes ${want} argument${spec.max === 1 ? '' : 's'} (got ${n.args.length})`);
    }
    n.args.forEach((a, i) => {
      if (spec.scalar && spec.scalar.includes(i)) {
        if (a.type !== 'num' || !Number.isInteger(a.v) || a.v < 1) {
          throw scriptErr(`${n.name}() argument ${i + 1} must be a whole number ≥ 1`);
        }
      }
      validateScriptNode(a);
    });
  }
}

/**
 * Compile a HabScript expression. Throws a descriptive error on any syntax
 * or semantic problem — never evaluates strings at runtime.
 * @param {string} src
 * @returns {{src: string, ast: object}}
 */
export function compileScript(src) {
  const s = String(src == null ? '' : src).trim();
  return { src: s, ast: parseScript(s) };
}

/** null → NaN so sparse calc helpers compose safely inside expressions. */
const scriptNum = (x) => (x == null || Number.isFinite(x) ? x : NaN);

function binOp(op, a, b) {
  if (a == null || b == null) return NaN;
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case '%': return a % b;
  }
  return NaN;
}

function evalScriptNode(node, vars, n) {
  switch (node.type) {
    case 'num':
      return node.v;
    case 'var':
      return vars[node.name];
    case 'neg': {
      const e = evalScriptNode(node.e, vars, n);
      if (!Array.isArray(e)) return -e;
      return e.map((x) => (x == null ? NaN : -x));
    }
    case 'bin': {
      const l = evalScriptNode(node.l, vars, n);
      const r = evalScriptNode(node.r, vars, n);
      if (!Array.isArray(l) && !Array.isArray(r)) return binOp(node.op, l, r);
      const a = Array.isArray(l) ? l : new Array(n).fill(l);
      const b = Array.isArray(r) ? r : new Array(n).fill(r);
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = binOp(node.op, a[i], b[i]);
      return out;
    }
    case 'call':
      return evalScriptCall(node, vars, n);
  }
  return NaN;
}

function evalScriptCall(node, vars, n) {
  const { name, args } = node;
  const s0 = evalScriptNode(args[0], vars, n);
  const a = Array.isArray(s0) ? s0 : new Array(n).fill(s0);
  // window functions must not read leading nulls as 0 — NaN them so results stay honest
  const clean = a.map((x) => (x == null ? NaN : x));
  const p = args.length > 1 && args[1].type === 'num' ? args[1].v : 1;

  switch (name) {
    case 'sma': return calcSMA(clean, p);
    case 'ema': return calcEMA(clean, p);
    case 'wma': return calcWMA(clean, p);
    case 'stddev': return calcStdDev(clean, p);
    case 'rsi': return calcRSI(clean, p);
    case 'hh':
    case 'll': {
      const out = new Array(n).fill(null);
      for (let i = p - 1; i < n; i++) {
        let v = clean[i];
        for (let j = i - p + 1; j <= i; j++) {
          v = name === 'hh' ? Math.max(v, clean[j]) : Math.min(v, clean[j]);
        }
        out[i] = v;
      }
      return out;
    }
    case 'prev': {
      const out = new Array(n).fill(null);
      for (let i = p; i < n; i++) out[i] = a[i - p];
      return out;
    }
    case 'change': {
      const out = new Array(n).fill(null);
      for (let i = 1; i < n; i++) out[i] = scriptNum(a[i]) - scriptNum(a[i - 1]);
      return out;
    }
    case 'abs': return clean.map((x) => Math.abs(x));
    case 'sqrt': return clean.map((x) => (x < 0 ? NaN : Math.sqrt(x)));
    case 'log': return clean.map((x) => (x <= 0 ? NaN : Math.log(x)));
    case 'min':
    case 'max': {
      const b0 = evalScriptNode(args[1], vars, n);
      const b = Array.isArray(b0) ? b0 : new Array(n).fill(b0);
      return a.map((x, i) => (name === 'min' ? Math.min(scriptNum(x), scriptNum(b[i])) : Math.max(scriptNum(x), scriptNum(b[i]))));
    }
    case 'crossup':
    case 'crossdown': {
      const b0 = evalScriptNode(args[1], vars, n);
      const b = Array.isArray(b0) ? b0 : new Array(n).fill(b0);
      const out = new Array(n).fill(0);
      for (let i = 1; i < n; i++) {
        const x0 = scriptNum(a[i - 1]);
        const x1 = scriptNum(a[i]);
        const y0 = scriptNum(b[i - 1]);
        const y1 = scriptNum(b[i]);
        if (Number.isNaN(x0) || Number.isNaN(x1) || Number.isNaN(y0) || Number.isNaN(y1)) continue;
        out[i] = name === 'crossup' ? (x0 <= y0 && x1 > y1 ? 1 : 0) : (x0 >= y0 && x1 < y1 ? 1 : 0);
      }
      return out;
    }
  }
  return new Array(n).fill(NaN);
}

/**
 * Evaluate a compiled script (or a raw expression string) over bars.
 * @param {{src:string, ast:object}|string} compiled
 * @param {Bar[]} bars
 * @returns {number[]} length `bars.length`; non-finite values become NaN
 */
export function evalScript(compiled, bars) {
  const c = typeof compiled === 'string' ? compileScript(compiled) : compiled;
  const n = bars.length;
  const out = new Array(n).fill(NaN);
  if (!n) return out;
  const vars = {
    open: bars.map((b) => b.open),
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: bars.map((b) => b.close),
    volume: bars.map((b) => b.volume),
    hl2: bars.map((b) => (b.high + b.low) / 2),
    hlc3: bars.map((b) => (b.high + b.low + b.close) / 3),
    ohlc4: bars.map((b) => (b.open + b.high + b.low + b.close) / 4),
  };
  const res = evalScriptNode(c.ast, vars, n);
  const arr = Array.isArray(res) ? res : new Array(n).fill(res);
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    out[i] = v != null && Number.isFinite(v) ? v : NaN;
  }
  return out;
}

/**
 * Build an indicator definition from a HabScript expression — used inline by
 * `indicators="expr:{…}"` / `pexpr:{…}"`, or register it under a name:
 * `HabChart.registerIndicator('myspread', scriptIndicator('close - ema(close,21)'))`.
 * @param {string} src
 * @param {{pane?: boolean}} [opts]
 * @returns {IndicatorDef}
 */
export function scriptIndicator(src, opts = {}) {
  const compiled = compileScript(src);
  const label = compiled.src.length > 24 ? compiled.src.slice(0, 23) + '…' : compiled.src;
  return {
    kind: opts.pane ? 'pane' : 'overlay',
    compute: (bars) => ({ lines: [{ name: label, values: evalScript(compiled, bars) }] }),
  };
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
 * Volatility-regime shading
 * ------------------------------------------------------------------ */

/**
 * Rolling realized volatility: population stddev of log returns over the
 * last `period` bars (per-bar value, aligned like SMA — null until the
 * window fills).
 * @param {number[]} closes
 * @param {number} [period=20]
 * @returns {Array<number|null>}
 */
export function calcRealizedVol(closes, period = 20) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (period < 2 || n < 2) return out;
  const rets = new Array(n).fill(0);
  let sum = 0;
  let sumSq = 0;
  let cnt = 0;
  for (let i = 1; i < n; i++) {
    const r = closes[i - 1] > 0 && closes[i] > 0 ? Math.log(closes[i] / closes[i - 1]) : NaN;
    rets[i] = r;
    if (Number.isFinite(r)) {
      sum += r;
      sumSq += r * r;
      cnt++;
    }
    const j = i - period; // return that falls out of the window
    if (j >= 1 && Number.isFinite(rets[j])) {
      sum -= rets[j];
      sumSq -= rets[j] * rets[j];
      cnt--;
    }
    if (i >= period && cnt === period) {
      const mean = sum / period;
      out[i] = Math.sqrt(Math.max(0, sumSq / period - mean * mean));
    }
  }
  return out;
}

/**
 * Classify a realized-vol series into regimes by empirical percentile over
 * the whole series: 0 = calm (≤ qLow), 1 = normal, 2 = hot (≥ qHigh),
 * -1 = unknown (null input). A degenerate spread (qHigh ≤ qLow, e.g. a
 * flat series) classifies everything as normal.
 * @param {Array<number|null>} vol
 * @param {number} [qLow=30]
 * @param {number} [qHigh=70]
 * @returns {{regimes:number[], sorted:number[], q1:number, q2:number}}
 */
export function volRegimeBands(vol, qLow = 30, qHigh = 70) {
  const n = vol.length;
  const regimes = new Array(n).fill(-1);
  const sorted = [];
  for (let i = 0; i < n; i++) if (isNum(vol[i])) sorted.push(vol[i]);
  sorted.sort((a, b) => a - b);
  const q = (p) => {
    if (!sorted.length) return NaN;
    const pos = clamp((p / 100) * (sorted.length - 1), 0, sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  const q1 = q(Math.min(qLow, qHigh));
  const q2 = q(Math.max(qLow, qHigh));
  const degenerate = !(q2 > q1);
  for (let i = 0; i < n; i++) {
    if (!isNum(vol[i])) continue;
    regimes[i] = degenerate ? 1 : vol[i] <= q1 ? 0 : vol[i] >= q2 ? 2 : 1;
  }
  return { regimes, sorted, q1, q2 };
}

/**
 * Percentile (0–100) of `v` within an ascending `sorted` array.
 * @param {number[]} sorted
 * @param {number} v
 * @returns {number}
 */
export function percentileOfSorted(sorted, v) {
  if (!sorted.length || !isNum(v)) return NaN;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  if (sorted.length === 1) return sorted[0] === v ? 50 : sorted[0] < v ? 100 : 0;
  return clamp((lo / (sorted.length - 1)) * 100, 0, 100);
}

/**
 * Parse a `volshading` attribute value: `""` / `"true"` → defaults (30/70,
 * period 20); `"30/70"` custom cutoffs; `"30/70/14"` cutoffs + period.
 * Inputs are clamped so qLow always stays at least 2 points below qHigh.
 * @param {string|null|undefined} val
 * @returns {{p1:number, p2:number, period:number}}
 */
export function parseVolShading(val) {
  const parts = String(val == null ? '' : val).split('/').map((s) => parseFloat(s));
  let p1 = isNum(parts[0]) ? clamp(parts[0], 0, 98) : 30;
  const p2 = isNum(parts[1]) ? clamp(parts[1], 2, 100) : 70;
  p1 = clamp(p1, 0, p2 - 2);
  const period = isNum(parts[2]) ? Math.round(clamp(parts[2], 2, 500)) : 20;
  return { p1, p2, period };
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
  if (state.profile) p.set('profile', '1');
  if (state.annotations) p.set('ann', '1');
  if (state.volshading === true) p.set('vsh', '1');
  else if (typeof state.volshading === 'string' && state.volshading) p.set('vsh', state.volshading);
  if (state.indicators) p.set('ind', splitIndicatorTokens(state.indicators).join(','));
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
  if (p.get('profile') === '1') state.profile = true;
  if (p.get('ann') === '1') state.annotations = true;
  const vsh = p.get('vsh');
  if (vsh === '1') state.volshading = true;
  else if (vsh) state.volshading = vsh;
  const ind = p.get('ind');
  if (ind) state.indicators = splitIndicatorTokens(ind).join(' ');
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
