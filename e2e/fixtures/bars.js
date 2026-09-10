/** Deterministic PRNG — same bars on every run, on every machine. */
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/**
 * Synthetic OHLCV history. Starts at a fixed epoch so timezone-dependent
 * axis labels are reproducible: 2024-01-02T00:00:00Z, one bar a minute.
 */
export function makeBars(n = 300, startMs = Date.UTC(2024, 0, 2), stepMs = 60_000) {
  const rand = rng(42);
  const bars = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = open * (1 + (rand() - 0.5) * 0.02);
    const high = Math.max(open, close) * (1 + rand() * 0.006);
    const low = Math.min(open, close) * (1 - rand() * 0.006);
    bars.push({
      time: startMs + i * stepMs,
      open, high, low, close,
      volume: Math.round(1000 + rand() * 4000),
    });
    price = close;
  }
  return bars;
}

/** Resolve after two animation frames — the element renders on rAF. */
export const settle = () =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
