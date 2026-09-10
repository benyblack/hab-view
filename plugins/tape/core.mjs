/**
 * wickchart-tape — pure tape model: print normalization, tick-rule side
 * inference, trades→bars aggregation, display formatting. No DOM, no canvas;
 * mirrors the host library's core discipline. Everything here is
 * unit-testable plain data in / data out.
 */

/** The plugin keeps at most this many recent prints (oldest dropped). */
export const MAX_TRADES = 500;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate raw trade prints into plain `{ time, price, size, side }` data
 * (times in ms, side 'buy' | 'sell' | null). Invalid entries are dropped,
 * never thrown — same contract as normalizeDrawings / normalizeSessions.
 * `side` accepts 'buy' | 'b' | 'sell' | 's'; anything else → null (the
 * tick rule fills it in later). Output is sorted by time.
 */
export function normalizeTrades(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    if (out.length >= MAX_TRADES) break;
    let time = Number(raw.time);
    const price = Number(raw.price);
    const size = Number(raw.size);
    if (!isNum(time) || !isNum(price) || price <= 0) continue;
    if (!isNum(size) || size <= 0) continue;
    if (time < 1e11) time *= 1000; // seconds → ms, same heuristic as the chart's toMs()
    let side = raw.side;
    if (side === 'b') side = 'buy';
    else if (side === 's') side = 'sell';
    if (side !== 'buy' && side !== 'sell') side = null;
    out.push({ time: Math.round(time), price, size, side });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/**
 * Tick rule: fill in missing sides from price movement vs the previous
 * print — uptick → buy, downtick → sell, flat → same side as before; the
 * first print with no history stays sideless. Explicit sides pass through
 * and update the carried state. Returns `{ trades, prev }` where `prev`
 * (`{ price, side }` or null) feeds the next batch so inference is
 * continuous across `push()` calls.
 */
export function inferSides(trades, prev = null) {
  let lastPrice = prev && isNum(prev.price) ? prev.price : null;
  let lastSide = prev ? (prev.side === 'sell' ? 'sell' : prev.side === 'buy' ? 'buy' : null) : null;
  const out = trades.map((t) => {
    if (t.side) {
      lastPrice = t.price;
      lastSide = t.side;
      return t;
    }
    let side = lastSide;
    if (lastPrice != null) {
      if (t.price > lastPrice) side = 'buy';
      else if (t.price < lastPrice) side = 'sell';
    }
    lastPrice = t.price;
    lastSide = side;
    return side ? { ...t, side } : t;
  });
  return { trades: out, prev: lastPrice == null ? null : { price: lastPrice, side: lastSide } };
}

/**
 * Aggregate prints into OHLCV bars of `ms` width (floor-aligned buckets).
 * Expects normalized (ms-time) prints; unsorted input is handled. Returns
 * bars sorted by time in the chart's data shape — `chart.setData(
 * tradesToBars(tape.trades, 60000))` turns a raw trade stream into a chart.
 * Bad interval or no prints → [].
 */
export function tradesToBars(trades, ms = 60000) {
  if (!isNum(ms) || ms <= 0 || !Array.isArray(trades) || !trades.length) return [];
  let list = trades;
  for (let i = 1; i < list.length; i++) {
    if (list[i].time < list[i - 1].time) {
      list = list.slice().sort((a, b) => a.time - b.time);
      break;
    }
  }
  const buckets = new Map();
  for (const t of list) {
    if (!t || !isNum(t.time) || !isNum(t.price)) continue;
    const b = Math.floor(t.time / ms) * ms;
    let bar = buckets.get(b);
    if (!bar) {
      bar = { time: b, open: t.price, high: t.price, low: t.price, close: t.price, volume: 0 };
      buckets.set(b, bar);
    } else {
      if (t.price > bar.high) bar.high = t.price;
      if (t.price < bar.low) bar.low = t.price;
      bar.close = t.price;
    }
    bar.volume += isNum(t.size) ? t.size : 0;
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

/**
 * Decimals to display for a set of prices: the longest seen fraction,
 * clamped to 2..8 (a plain 43250 gets "43250.00", 0.35271 gets 5).
 */
export function decimalsFor(prices) {
  let d = 2;
  if (Array.isArray(prices)) {
    for (const p of prices) {
      if (!isNum(p)) continue;
      const s = String(p);
      const dot = s.indexOf('.');
      if (dot >= 0) d = Math.max(d, Math.min(8, s.length - dot - 1));
    }
  }
  return d;
}

/** Compact size text: 1.2K / 3.4M above 1000, else up to 4 decimals trimmed. */
export function fmtSize(size) {
  if (!isNum(size)) return '';
  if (size >= 1e6) return (size / 1e6).toFixed(1) + 'M';
  if (size >= 1000) return (size / 1000).toFixed(1) + 'K';
  const s = size.toFixed(4);
  return s.replace(/\.?0+$/, '') || '0';
}
