/* ==========================================================================
 * HabView feeds — data-source helpers shared by <hab-feed> and the demo app.
 * Browser module (uses fetch/WebSocket inside functions); importable in Node
 * for unit-testing the pure generators.
 * MIT License.
 * ========================================================================== */

export const TF_SECONDS = {
  '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200,
  '1d': 86400, '3d': 259200, '1w': 604800,
};

/** Seconds for a timeframe id ('15m', '1h', '1D'…); defaults to 1h. */
export function tfToSeconds(tf) {
  return TF_SECONDS[String(tf).toLowerCase()] || 3600;
}

export const BASE_PRICES = { BTC: 64250, ETH: 3120, SOL: 148, DEMO: 100 };

/* ---------------- deterministic synthetic data ---------------- */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rnd) {
  let u = 0;
  let v = 0;
  while (!u) u = rnd();
  while (!v) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function hashStr(s) {
  let h = 2166136261;
  for (const c of String(s)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic synthetic OHLCV history (random walk with volatility regimes
 * and mild mean reversion). Same key → same series.
 * @param {string} key seed key (symbol, symbol+tf, …)
 * @param {number} sec timeframe in seconds
 * @param {number} n bar count
 * @param {number} [base=100] starting/base price
 */
export function genSynthetic(key, sec, n, base = 100) {
  const rnd = mulberry32(hashStr(key) ^ 0x9e3779b9);
  const tfMs = sec * 1000;
  const t0 = Math.floor(Date.now() / tfMs) * tfMs - (n - 1) * tfMs;
  let price = base;
  let drift = 0.0002;
  let vol = 0.011;
  let regimeLeft = 0;
  const bars = [];
  for (let i = 0; i < n; i++) {
    if (regimeLeft <= 0) {
      regimeLeft = (40 + rnd() * 140) | 0;
      drift = (rnd() - 0.48) * 0.0016;
      vol = 0.005 + rnd() * 0.02;
    }
    regimeLeft--;
    const open = price;
    const revert = -0.004 * Math.log(price / base);
    const ret = drift + revert + vol * gauss(rnd);
    const close = open * Math.exp(ret);
    const high = Math.max(open, close) * (1 + Math.abs(gauss(rnd)) * vol * 0.6);
    const low = Math.min(open, close) * (1 - Math.abs(gauss(rnd)) * vol * 0.6);
    const volume = Math.max(1, Math.round(420 * (1 + (Math.abs(ret) / vol) * 2 + rnd() * 0.6)));
    bars.push({ time: t0 + i * tfMs, open, high, low, close, volume });
    price = close;
  }
  return bars;
}

/**
 * Stateful synthetic live stream: mutates the current bar each tick and
 * rolls over on timeframe boundaries. Bridges from `startPrice` when given.
 * @param {number} sec timeframe in seconds
 * @param {number} [startPrice] bridge continuity from the last known price
 */
export function makeSynthStream(sec, startPrice) {
  const tfMs = sec * 1000;
  const rnd = mulberry32((Math.random() * 1e9) >>> 0);
  let cur = null;
  return () => {
    const t = Math.floor(Date.now() / tfMs) * tfMs;
    if (!cur || cur.time !== t) {
      const open = cur ? cur.close : (startPrice || 100) * (1 + gauss(rnd) * 0.002);
      cur = { time: t, open, high: open, low: open, close: open, volume: 0 };
    } else {
      const vol = 0.004;
      cur.close = Math.max(1e-8, cur.close * Math.exp(vol * gauss(rnd) * 0.35));
      cur.high = Math.max(cur.high, cur.close);
      cur.low = Math.min(cur.low, cur.close);
      cur.volume += Math.round(20 + rnd() * 60);
    }
    return { ...cur };
  };
}

/* ---------------- Binance public API ---------------- */

/**
 * Fetch klines from Binance's public REST API.
 * @param {string} symbol e.g. 'BTCUSDT'
 * @param {string} tfId interval id ('15m','1h','1d'…)
 * @param {number} [limit=500]
 * @param {number} [endTime] fetch bars older than this (ms) — for backfill
 */
export async function fetchBinanceKlines(symbol, tfId, limit = 500, endTime) {
  let url =
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(tfId)}&limit=${limit}`;
  if (endTime) url += `&endTime=${endTime - 1}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  const rows = await res.json();
  return rows.map((k) => ({
    time: k[0],
    open: +k[1],
    high: +k[2],
    low: +k[3],
    close: +k[4],
    volume: +k[5],
  }));
}

/**
 * Open a Binance kline WebSocket. `onDown(err)` fires on error/close/timeout
 * (after which the socket is dead and the caller should fall back).
 * @returns {{close(): void}}
 */
export function openBinanceSocket(symbol, tfId, onBar, onDown, timeoutMs = 8000) {
  let ws;
  try {
    ws = new WebSocket(
      `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${tfId}`
    );
  } catch (err) {
    onDown(err);
    return { close() {} };
  }
  let dead = false;
  const failTimer = setTimeout(() => {
    if (!dead && ws.readyState !== WebSocket.OPEN) {
      dead = true;
      try {
        ws.close();
      } catch (_) {}
      onDown(new Error('timeout'));
    }
  }, timeoutMs);
  ws.onopen = () => clearTimeout(failTimer);
  ws.onmessage = (ev) => {
    try {
      const k = JSON.parse(ev.data).k;
      if (!k) return;
      onBar({ time: k.t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
    } catch (_) {}
  };
  ws.onclose = () => {
    if (dead) return;
    dead = true;
    clearTimeout(failTimer);
    onDown(new Error('closed'));
  };
  ws.onerror = () => {};
  return {
    close() {
      dead = true;
      ws.onclose = null;
      ws.onerror = null;
      clearTimeout(failTimer);
      try {
        ws.close();
      } catch (_) {}
    },
  };
}
