/**
 * wickchart-compare — pure compare model: normalization, time alignment and
 * rebasing math. No DOM, no canvas; everything is unit-testable plain data
 * in / data out.
 */

export const MAX_SERIES = 6;

/** Fill/stroke tints cycled per series — read on dark and light themes. */
export const DEFAULT_COLORS = ['#f0b90b', '#a78bfa', '#16c784', '#22d3ee', '#ea3943', '#4c8dff'];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const OPS = new Set(['ratio', 'diff']);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const toMs = (t) => (t < 1e12 ? t * 1000 : t);

/**
 * Close/value pairs [[ms, v], …] sorted by time; null when nothing valid.
 * Accepts OHLC bars ({ time, close }) and plain series ({ time, value }).
 */
function closes(bars) {
  if (!Array.isArray(bars) || !bars.length) return null;
  const out = [];
  for (const b of bars) {
    if (!b || typeof b !== 'object') continue;
    const t = Number(b.time);
    const v = Number(b.close != null ? b.close : b.value);
    if (!isNum(t) || !isNum(v)) continue;
    out.push([toMs(t), v]);
  }
  if (!out.length) return null;
  out.sort((x, y) => x[0] - y[0]);
  return out;
}

/** Last sample at or before t (binary search); null when t precedes the first. */
export function sampleAt(samples, t) {
  let lo = 0;
  let hi = samples.length - 1;
  if (t < samples[0][0]) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  return samples[lo][1];
}

/** Align b onto a's timestamps: ratio (a/b) or diff (a−b) per shared time. */
function mergeOp(a, b, op) {
  const out = [];
  for (const [t, va] of a) {
    const vb = sampleAt(b, t);
    if (vb == null || vb === 0) continue; // no denominator before b starts
    out.push([t, op === 'ratio' ? va / vb : va - vb]);
  }
  return out;
}

/**
 * Validate + clamp a list of raw compare entries. Invalid entries are
 * dropped (never throw) — same contract as normalizeDrawings /
 * normalizeSessions in the other plugins.
 *
 * Entry shape:
 *   { label, data, color?, width? }            → percent line (close series)
 *   { label, a, b, op: 'ratio'|'diff', … }     → derived line
 * color: hex or 'up'/'down'/'accent' (resolved against the palette at draw).
 * An invalid `op` falls through to the percent path.
 */
export function normalizeSeries(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    if (out.length >= MAX_SERIES) break;
    const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 24) : '';
    if (!label) continue;
    const op = OPS.has(raw.op) ? raw.op : null;
    let samples = null;
    if (op) samples = mergeOp(closes(raw.a), closes(raw.b), op);
    else samples = closes(raw.data);
    if (!samples || !samples.length) continue;
    const color = typeof raw.color === 'string' && (['up', 'down', 'accent'].includes(raw.color) || HEX.test(raw.color))
      ? raw.color
      : null;
    const width = isNum(raw.width) ? Math.min(4, Math.max(1, raw.width)) : null;
    out.push({ label, op: op || 'percent', samples, color, width });
  }
  return out;
}

/** [firstIndex, lastIndex] of data (sorted by time) inside [t0, t1]. */
export function timeWindow(data, t0, t1) {
  const n = data.length;
  if (!n || t1 < data[0].time || t0 > data[n - 1].time) return null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid].time < t0) lo = mid + 1;
    else hi = mid;
  }
  const i0 = lo;
  if (data[i0].time > t1) return null; // window falls inside a data gap
  hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (data[mid].time <= t1) lo = mid;
    else hi = mid - 1;
  }
  return [i0, lo];
}

/**
 * Rebased points for one entry over the main chart's bar times.
 * rebase: 'visible' → 0% at the first sampled time in the window;
 *         'first'   → 0% at the entry's own first sample;
 *         number    → 0% sampled at that epoch (falls back to first sample).
 * Returns [{ t, pct, raw } | null] — null where the series has no sample yet.
 */
export function computeLine(entry, times, rebase) {
  const { samples } = entry;
  const raws = [];
  for (const t of times) {
    const v = sampleAt(samples, t);
    raws.push(v == null ? null : { t, raw: v });
  }
  let anchor;
  if (typeof rebase === 'number' && isNum(rebase)) {
    const at = sampleAt(samples, rebase);
    anchor = at == null ? samples[0][1] : at;
  } else if (rebase === 'visible') {
    const first = raws.find((r) => r);
    anchor = first ? first.raw : samples[0][1];
  } else {
    anchor = samples[0][1];
  }
  return raws.map((r) => (r && anchor !== 0 ? { t: r.t, pct: (r.raw / anchor - 1) * 100, raw: r.raw } : null));
}
