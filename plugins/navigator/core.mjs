/**
 * wickchart-navigator — pure navigator model: price-profile downsampling and
 * viewport-window math. No DOM, no canvas; plain data in / data out.
 */

/**
 * Downsample `data` (sorted bars) into `count` buckets of {lo, hi} over the
 * bar ranges — the silhouette behind the viewport window. Buckets without
 * bars are null. This is O(n) per call; callers cache by (len, lastTime).
 */
export function profile(data, count) {
  const n = data.length;
  const out = new Array(count > 0 ? Math.floor(count) : 0).fill(null);
  if (n < 2 || !out.length) return out;
  const t0 = data[0].time;
  const span = data[n - 1].time - t0 || 1;
  for (const b of data) {
    const bi = Math.min(out.length - 1, Math.floor(((b.time - t0) / span) * out.length));
    const cur = out[bi];
    if (!cur) out[bi] = { lo: b.low, hi: b.high };
    else {
      if (b.low < cur.lo) cur.lo = b.low;
      if (b.high > cur.hi) cur.hi = b.high;
    }
  }
  return out;
}

/**
 * Viewport window as fractions of the full data time span: [f0, f1] clamped
 * to [0, 1] (times outside the data edges — the future, or panned-off
 * history — collapse to the edges).
 */
export function windowFractions(tFirst, tLast, t0, t1) {
  const span = tLast - tFirst || 1;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const f0 = clamp01((t0 - tFirst) / span);
  const f1 = clamp01((t1 - tFirst) / span);
  return f1 > f0 ? [f0, f1] : null;
}

/**
 * Apply a drag to window fractions: `mode` 'move' shifts the window so the
 * grab offset stays under the pointer; 'l'/'r' move one edge. The result
 * keeps a minimum span (minFrac) and stays inside [0, 1].
 */
export function dragWindow(f0, f1, mode, f, grab, minFrac = 0.01) {
  const span = f1 - f0;
  if (mode === 'move') {
    const n0 = Math.max(0, Math.min(1 - span, f - grab));
    return [n0, n0 + span];
  }
  if (mode === 'l') return [Math.max(0, Math.min(f1 - minFrac, f)), f1];
  if (mode === 'r') return [f0, Math.min(1, Math.max(f0 + minFrac, f))];
  return [f0, f1];
}
