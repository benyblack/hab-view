/**
 * wickchart-draw — pure drawing model: normalization, geometry, hit math.
 * No DOM, no canvas; mirrors the host library's core discipline. Everything
 * here is unit-testable plain data in / data out.
 */

export const DRAWING_TYPES = ['trendline', 'hline', 'rect', 'fib', 'text'];

/** Required anchor-point count per drawing type. */
export const POINT_COUNT = {
  trendline: 2,
  hline: 1,
  rect: 2,
  fib: 2,
  text: 1,
};

/** Standard retracement grid (level k: price = p1 + (p0 - p1) * k). */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Fibonacci level prices for two anchor prices (0.0 at the second point). */
export function fibPrices(p0, p1) {
  return FIB_LEVELS.map((k) => ({ k, price: p1 + (p0 - p1) * k }));
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Resolve a drawing color against a palette: the semantic names map to theme
 * colors, hex passes through, everything else falls back to the accent.
 */
export function resolveColor(raw, pal) {
  if (raw === 'up' || raw === 'down' || raw === 'accent') return pal[raw];
  return typeof raw === 'string' && HEX.test(raw) ? raw : pal.accent;
}

let seq = 0;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate + clamp a list of raw drawing objects into plain, serializable
 * data. Invalid entries are dropped (never throw) — same contract as
 * normalizeOverlays / normalizeRiskPlan in the host core.
 *
 * Drawing shape: { id, type, points: [{ t, p }], color?, width?, extend?,
 *                 text?, locked?, visible? } — times in ms (or s, auto-scaled).
 */
export function normalizeDrawings(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    if (out.length >= 100) break;
    const type = DRAWING_TYPES.includes(raw.type) ? raw.type : null;
    if (!type) continue;
    const need = POINT_COUNT[type];
    if (!Array.isArray(raw.points) || raw.points.length !== need) continue;
    const points = [];
    let ok = true;
    for (const pt of raw.points) {
      if (!pt || typeof pt !== 'object' || pt.t == null || pt.p == null) { ok = false; break; }
      let t = Number(pt.t);
      const p = Number(pt.p);
      if (!isNum(t) || !isNum(p)) { ok = false; break; }
      if (t < 1e11) t *= 1000; // seconds → ms, same heuristic as the chart's toMs()
      points.push({ t, p });
    }
    if (!ok) continue;

    let text = '';
    if (type === 'text') {
      text = String(raw.text ?? '').slice(0, 160).trim();
      if (!text) continue; // a text drawing without text is nothing
    }

    const id = raw.id != null && String(raw.id).slice(0, 64) ? String(raw.id).slice(0, 64) : 'd-' + ++seq;
    if (seen.has(id)) continue; // duplicate ids (e.g. colliding peers) — first wins
    seen.add(id);

    out.push({
      id,
      type,
      points,
      color:
        typeof raw.color === 'string' && (['up', 'down', 'accent'].includes(raw.color) || HEX.test(raw.color))
          ? raw.color
          : null,
      width: isNum(raw.width) ? Math.min(4, Math.max(1, raw.width)) : null,
      extend: type === 'trendline' && ['none', 'right', 'both'].includes(raw.extend) ? raw.extend : 'none',
      text,
      locked: raw.locked === true,
      visible: raw.visible !== false,
    });
  }
  return out;
}

/**
 * Distance from point P to segment AB (all pixel space).
 */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Extend the line through A→B and clip it to the box [x0, y0, x1, y1].
 * Returns { from: [x, y], to: [x, y], t0, t1 } where t is the position along
 * A→B (t=0 at A, t=1 at B), or null if the line misses the box. Callers use
 * the t range to draw rays (t ≥ 1) or infinite lines (full range).
 */
export function extendSegment(ax, ay, bx, by, x0, y0, x1, y1) {
  const dx = bx - ax;
  const dy = by - ay;
  let tMin = -Infinity;
  let tMax = Infinity;
  const clip = (pos, dir, lo, hi) => {
    if (Math.abs(dir) < 1e-12) return pos >= lo && pos <= hi; // parallel: must be inside
    let ta = (lo - pos) / dir;
    let tb = (hi - pos) / dir;
    if (ta > tb) [ta, tb] = [tb, ta];
    tMin = Math.max(tMin, ta);
    tMax = Math.min(tMax, tb);
    return true;
  };
  if (!clip(ax, dx, x0, x1)) return null;
  if (!clip(ay, dy, y0, y1)) return null;
  if (tMin > tMax) return null;
  if (tMin === -Infinity && tMax === Infinity) {
    // degenerate A === B (magnet can pin both anchors to one point)
    tMin = 0;
    tMax = 1;
  }
  return {
    from: [ax + tMin * dx, ay + tMin * dy],
    to: [ax + tMax * dx, ay + tMax * dy],
    t0: tMin,
    t1: tMax,
  };
}

/** Index of the bar whose time is nearest-at-or-after `time` (binary search). */
export function nearestBarIndex(bars, time) {
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  // lo is the first bar at/after time; check if the previous bar is nearer
  if (lo > 0 && Math.abs(bars[lo - 1].time - time) <= Math.abs(bars[lo].time - time)) return lo - 1;
  return lo;
}

/** OHLC price candidates of a bar for magnet snapping. */
export function ohlcOf(bar) {
  return [bar.open, bar.high, bar.low, bar.close];
}

/**
 * Magnet snap: pin an anchor to the nearest bar time and the nearest OHLC
 * price of that bar. `toY` maps price → pixel for distance comparisons.
 * Returns the raw {t, p} untouched when nothing is within `px` pixels.
 */
export function snapAnchor(bars, time, price, toY, px = 10) {
  if (!bars.length) return { t: time, p: price, snapped: false };
  const i = nearestBarIndex(bars, time);
  const bar = bars[i];
  let p = price;
  let best = px;
  for (const c of ohlcOf(bar)) {
    const d = Math.abs(toY(c) - toY(price));
    if (d <= best) {
      best = d;
      p = c;
    }
  }
  return { t: bar.time, p, snapped: p !== price };
}
