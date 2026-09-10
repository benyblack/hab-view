/**
 * wickchart-signals — pure pattern detection: candlestick signals as plain
 * data. No DOM, no canvas; everything is unit-testable data in / data out.
 *
 * Detected kinds (v1): bullish/bearish engulfing, bullish/bearish pin bar
 * (hammer / shooting star), inside bar. Each signal: { i, kind, dir } —
 * `dir` is 'bull' | 'bear' | null (inside bars are neutral).
 */

export const KINDS = ['engulfing', 'pinbar', 'inside'];

export const KIND_INFO = {
  engulfing: { letter: 'E', name: 'engulfing' },
  pinbar: { letter: 'P', name: 'pin bar' },
  inside: { letter: 'IB', name: 'inside bar' },
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Candle anatomy: { bull, body, range, upper, lower } (null when invalid). */
export function anatomy(b) {
  if (!b || !isNum(b.open) || !isNum(b.close) || !isNum(b.high) || !isNum(b.low)) return null;
  const body = Math.abs(b.close - b.open);
  const range = b.high - b.low;
  if (range <= 0) return null;
  return {
    bull: b.close >= b.open,
    body,
    range,
    upper: b.high - Math.max(b.open, b.close),
    lower: Math.min(b.open, b.close) - b.low,
    top: Math.max(b.open, b.close),
    bottom: Math.min(b.open, b.close),
  };
}

function engulfing(prev, cur) {
  if (cur.bull === prev.bull) return null; // engulfing needs opposite colors
  if (cur.body <= prev.body) return null; // the current body must be strictly bigger
  if (cur.top >= prev.top && cur.bottom <= prev.bottom) return cur.bull ? 'bull' : 'bear';
  return null;
}

function pinbar(a) {
  if (a.body <= 0) return null;
  if (a.lower >= 2 * a.body && a.upper <= a.body) return 'bull'; // hammer
  if (a.upper >= 2 * a.body && a.lower <= a.body) return 'bear'; // shooting star
  return null;
}

/**
 * Detect signals over a full bar array. O(n); cache the result per dataset.
 * @param {Array<{time,open,high,low,close}>} bars
 * @param {string[]} [kinds] subset of KINDS to detect (default: all; [] = none)
 * @returns {Array<{i: number, kind: string, dir: 'bull'|'bear'|null}>}
 */
export function detectSignals(bars, kinds) {
  if (!Array.isArray(bars) || bars.length < 2) return [];
  const want = Array.isArray(kinds) ? new Set(kinds.filter((k) => KINDS.includes(k))) : new Set(KINDS);
  const out = [];
  for (let i = 1; i < bars.length; i++) {
    const cur = anatomy(bars[i]);
    const prev = anatomy(bars[i - 1]);
    if (!cur || !prev) continue;
    if (want.has('engulfing')) {
      const dir = engulfing(prev, cur);
      if (dir) out.push({ i, kind: 'engulfing', dir });
    }
    if (want.has('pinbar')) {
      const dir = pinbar(cur);
      if (dir) out.push({ i, kind: 'pinbar', dir });
    }
    if (want.has('inside')) {
      if (bars[i].high <= bars[i - 1].high && bars[i].low >= bars[i - 1].low) {
        out.push({ i, kind: 'inside', dir: null });
      }
    }
  }
  return out;
}
