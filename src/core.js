/* ==========================================================================
 * HabView core — pure, DOM-free functions shared by <hab-chart> and tests.
 * Importable in the browser (ESM) and in Node (`node --test`).
 * MIT License.
 * ========================================================================== */

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

/** EMA over a series that may contain leading nulls (e.g. MACD line). */
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
 * @returns {{mid:number[]|null[], upper:number[]|null[], lower:number[]|null[]}}
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
 * @returns {{macd, signal, hist}} sparse arrays (nulls before warmup)
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
 * @returns {{bars: Array, added: number}} merged array and count prepended.
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
 */
export function detectGaps(bars, i0, i1, dtMs, threshold = 3) {
  const gaps = [];
  const th = (dtMs > 0 ? dtMs : HOUR) * threshold;
  for (let i = Math.max(1, i0); i <= i1; i++) {
    if (bars[i].time - bars[i - 1].time > th) gaps.push(i);
  }
  return gaps;
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
 * @returns {{overlays: Array, panes: Array, volume: boolean, unknown: string[]}}
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
