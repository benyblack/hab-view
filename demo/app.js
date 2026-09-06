/* HabView demo — data feeds & UI wiring around <hab-chart>. */
import '../src/hab-chart.js';

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

const SYMBOLS = [
  { id: 'DEMO', label: 'Demo' },
  { id: 'BTC', label: 'BTC' },
  { id: 'ETH', label: 'ETH' },
  { id: 'SOL', label: 'SOL' },
];

const TFS = [
  { id: '15m', sec: 15 * 60, label: '15m' },
  { id: '1h', sec: 3600, label: '1h' },
  { id: '4h', sec: 4 * 3600, label: '4h' },
  { id: '1D', sec: 24 * 3600, label: '1D' },
];

const BINANCE = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT' };
const BASE_PRICES = { DEMO: 64250, BTC: 64250, ETH: 3120, SOL: 148 };

const INDICATORS = [
  { id: 'sma:20', label: 'SMA 20', color: '#f0b429' },
  { id: 'ema:50', label: 'EMA 50', color: '#38bdf8' },
  { id: 'rsi:14', label: 'RSI 14', color: '#a78bfa' },
  { id: 'volume', label: 'Volume', color: '#7c8598' },
];

const state = {
  symbol: 'DEMO',
  tf: '1h',
  type: 'candles',
  live: true,
  theme: 'dark',
  indicators: new Set(['volume']),
};

const chart = document.getElementById('chart');

/* ------------------------------------------------------------------ *
 * Synthetic data (works fully offline)
 * ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rnd) {
  let u = 0;
  let v = 0;
  while (!u) u = rnd();
  while (!v) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function hashStr(s) {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function genSynthetic(symbol, tfSec, n = 600) {
  const rnd = mulberry32(hashStr(symbol + ':' + tfSec) ^ 0x9e3779b9);
  const tfMs = tfSec * 1000;
  const t0 = Math.floor(Date.now() / tfMs) * tfMs - (n - 1) * tfMs;
  let price = BASE_PRICES[symbol] || 100;
  const base = price;
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
    // mild mean reversion keeps the demo walk in a plausible band
    const revert = -0.004 * Math.log(price / base);
    const ret = drift + revert + vol * gauss(rnd);
    const close = open * Math.exp(ret);
    const high = Math.max(open, close) * (1 + Math.abs(gauss(rnd)) * vol * 0.6);
    const low = Math.min(open, close) * (1 - Math.abs(gauss(rnd)) * vol * 0.6);
    const volume = Math.round(
      420 * (1 + (Math.abs(ret) / vol) * 2 + rnd() * 0.6) * (symbol === 'ETH' ? 6 : symbol === 'SOL' ? 30 : 1)
    );
    bars.push({ time: t0 + i * tfMs, open, high, low, close, volume });
    price = close;
  }
  return bars;
}

/** Stateful synthetic live stream: mutates the current bar, rolls on boundary. */
function makeSynthStream(symbol, tfSec, startPrice) {
  const tfMs = tfSec * 1000;
  const rnd = mulberry32((Math.random() * 1e9) >>> 0);
  let cur = null;
  return () => {
    const t = Math.floor(Date.now() / tfMs) * tfMs;
    if (!cur || cur.time !== t) {
      const base = startPrice ?? BASE_PRICES[symbol] ?? 100;
      const open = cur ? cur.close : base * (1 + gauss(rnd) * 0.002);
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

/* ------------------------------------------------------------------ *
 * Binance feed (real data, graceful fallback)
 * ------------------------------------------------------------------ */

async function fetchKlines(symbol, tfId, limit = 600) {
  const pair = BINANCE[symbol];
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${tfId}&limit=${limit}`
  );
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

function openBinanceSocket(symbol, tfId, onBar, onDown) {
  const pair = BINANCE[symbol];
  let ws;
  try {
    ws = new WebSocket(`wss://stream.binance.com:9443/ws/${pair.toLowerCase()}@kline_${tfId}`);
  } catch (err) {
    onDown(err);
    return { close() {} };
  }
  const failTimer = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      try { ws.close(); } catch (_) {}
      onDown(new Error('timeout'));
    }
  }, 8000);
  ws.onopen = () => clearTimeout(failTimer);
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      const k = msg.k;
      if (!k) return;
      onBar({ time: k.t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
    } catch (_) {}
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    clearTimeout(failTimer);
    onDown(new Error('closed'));
  };
  return {
    close() {
      ws.onclose = null;
      ws.onerror = null;
      clearTimeout(failTimer);
      try { ws.close(); } catch (_) {}
    },
  };
}

/* ------------------------------------------------------------------ *
 * Feed controller
 * ------------------------------------------------------------------ */

let feed = null;

const lastChartClose = () => {
  const d = chart.data;
  return d.length ? d[d.length - 1].close : undefined;
};

function stopFeed() {
  if (feed) {
    feed.stop();
    feed = null;
  }
}

function startFeed({ syntheticFallbackToast = false } = {}) {
  stopFeed();
  const { symbol, tf, live } = state;
  if (!live) return;

  if (symbol === 'DEMO' || !BINANCE[symbol]) {
    const sec = TFS.find((t) => t.id === tf).sec;
    const next = makeSynthStream(symbol, sec, lastChartClose());
    const timer = setInterval(() => chart.update(next()), 650);
    setStatus('ok', 'live · synthetic feed');
    feed = { stop: () => clearInterval(timer) };
    return;
  }

  setStatus('warn', 'connecting to Binance…');
  let pollTimer = null;
  let ws = null;
  let dead = false;

  const startPolling = () => {
    if (dead || pollTimer) return;
    setStatus('warn', 'live · polling Binance');
    pollTimer = setInterval(async () => {
      try {
        const bars = await fetchKlines(symbol, tf, 2);
        for (const b of bars) chart.update(b);
      } catch (_) {
        clearInterval(pollTimer);
        pollTimer = null;
        useSynthetic('Live connection lost — switched to synthetic data.');
      }
    }, 10000);
  };

  const useSynthetic = (msg) => {
    if (dead) return;
    if (syntheticFallbackToast || msg) toast(msg || 'Binance unreachable — showing synthetic data.');
    const sec = TFS.find((t) => t.id === tf).sec;
    const next = makeSynthStream(symbol, sec, lastChartClose());
    const timer = setInterval(() => chart.update(next()), 650);
    setStatus('warn', 'live · synthetic (Binance unreachable)');
    feed = { stop: () => clearInterval(timer) };
    if (ws) { ws.close(); ws = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  };

  ws = openBinanceSocket(
    symbol,
    tf,
    (bar) => {
      if (dead) return;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      setStatus('ok', `live · Binance ${BINANCE[symbol]}`);
      chart.update(bar);
    },
    () => {
      if (dead) return;
      startPolling();
    }
  );

  feed = {
    stop() {
      dead = true;
      if (ws) ws.close();
      if (pollTimer) clearInterval(pollTimer);
    },
  };
}

async function loadSymbol() {
  const { symbol, tf } = state;
  const tfCfg = TFS.find((t) => t.id === tf);
  chart.setAttribute('label', `${symbol} · ${tf}`);

  if (symbol === 'DEMO' || !BINANCE[symbol]) {
    chart.setData(genSynthetic(symbol, tfCfg.sec));
    startFeed();
    return;
  }

  setStatus('warn', `loading ${BINANCE[symbol]} ${tf}…`);
  try {
    const bars = await fetchKlines(symbol, tf);
    chart.setData(bars);
    startFeed({ syntheticFallbackToast: true });
  } catch (err) {
    toast(`Couldn't reach Binance (${err.message}) — showing synthetic data.`);
    chart.setData(genSynthetic(symbol, tfCfg.sec));
    startFeed();
  }
}

/* ------------------------------------------------------------------ *
 * UI helpers
 * ------------------------------------------------------------------ */

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const rangeText = document.getElementById('range-text');

function setStatus(kind, text) {
  statusDot.className = 'dot ' + kind;
  statusText.textContent = text;
}

const fmtDate = (t) =>
  new Date(t).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

chart.addEventListener('hab:range', (e) => {
  rangeText.textContent = `${fmtDate(e.detail.from)} → ${fmtDate(e.detail.to)}`;
});

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 300ms';
    setTimeout(() => el.remove(), 350);
  }, 4200);
}

function buildSeg(container, items, getActive, onSelect) {
  container.innerHTML = '';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.label ?? item.id;
    btn.dataset.id = item.id;
    btn.setAttribute('aria-pressed', String(getActive() === item.id));
    btn.classList.toggle('active', getActive() === item.id);
    btn.addEventListener('click', () => {
      onSelect(item.id);
      for (const b of container.children) {
        const on = b.dataset.id === item.id;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      }
    });
    container.appendChild(btn);
  }
}

function applyIndicators() {
  chart.setAttribute('indicators', [...state.indicators].join(' '));
}

/* ---------------- build controls ---------------- */

buildSeg(document.getElementById('seg-symbol'), SYMBOLS, () => state.symbol, (id) => {
  state.symbol = id;
  loadSymbol();
});

buildSeg(document.getElementById('seg-tf'), TFS, () => state.tf, (id) => {
  state.tf = id;
  loadSymbol();
});

const segType = document.getElementById('seg-type');
segType.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-type]');
  if (!btn) return;
  state.type = btn.dataset.type;
  chart.setAttribute('type', state.type);
  for (const b of segType.children) {
    const on = b.dataset.type === state.type;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
});

const chips = document.getElementById('chips');
for (const ind of INDICATORS) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.innerHTML = `<i style="background:${ind.color}"></i>${ind.label}`;
  btn.setAttribute('aria-pressed', String(state.indicators.has(ind.id)));
  btn.classList.toggle('on', state.indicators.has(ind.id));
  btn.addEventListener('click', () => {
    if (state.indicators.has(ind.id)) state.indicators.delete(ind.id);
    else state.indicators.add(ind.id);
    btn.classList.toggle('on', state.indicators.has(ind.id));
    btn.setAttribute('aria-pressed', String(state.indicators.has(ind.id)));
    applyIndicators();
  });
  chips.appendChild(btn);
}

document.getElementById('btn-live').addEventListener('click', (e) => {
  state.live = !state.live;
  e.currentTarget.setAttribute('aria-pressed', String(state.live));
  document.getElementById('live-label').textContent = state.live ? 'Live' : 'Paused';
  if (state.live) startFeed();
  else {
    stopFeed();
    setStatus('off', 'paused');
  }
});

document.getElementById('btn-theme').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme;
  chart.setAttribute('theme', state.theme);
  document.getElementById('ico-moon').style.display = state.theme === 'dark' ? '' : 'none';
  document.getElementById('ico-sun').style.display = state.theme === 'light' ? '' : 'none';
});

chart.addEventListener('hab:select', (e) => {
  console.log('hab:select', e.detail.bar.time, '@', e.detail.price?.toFixed(2));
});

/* ---------------- boot ---------------- */

loadSymbol();
