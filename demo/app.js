/* HabView demo — data feeds & UI wiring around <hab-chart>. */
import HabChart from '../src/hab-chart.js';
import { encodeStateQuery, decodeStateQuery } from '../src/core.js';
import {
  genSynthetic,
  makeSynthStream,
  fetchBinanceKlines,
  openBinanceSocket,
  BASE_PRICES,
} from '../src/feeds.js';

/* ------------------------------------------------------------------ *
 * VWAP — a reference custom indicator built entirely through the
 * public registry API (same code as the README example).
 * ------------------------------------------------------------------ */
HabChart.registerIndicator('vwap', {
  kind: 'overlay',
  params: {},
  compute(bars) {
    const out = new Array(bars.length).fill(null);
    let pv = 0;
    let vv = 0;
    let day = -1;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const d = new Date(b.time).setHours(0, 0, 0, 0);
      if (d !== day) {
        day = d;
        pv = 0;
        vv = 0;
      }
      const tp = (b.high + b.low + b.close) / 3;
      pv += tp * b.volume;
      vv += b.volume;
      out[i] = vv ? pv / vv : null;
    }
    return out;
  },
});

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

const INDICATORS = [
  { id: 'sma:20', label: 'SMA 20', color: '#f0b429' },
  { id: 'ema:50', label: 'EMA 50', color: '#38bdf8' },
  { id: 'bb:20', label: 'BB 20', color: '#e64980' },
  { id: 'vwap', label: 'VWAP', color: '#22d3ee' },
  { id: 'rsi:14', label: 'RSI 14', color: '#a78bfa' },
  { id: 'macd:12/26/9', label: 'MACD', color: '#34d399' },
  { id: 'volume', label: 'Volume', color: '#7c8598' },
];

const state = {
  symbol: 'DEMO',
  tf: '1h',
  type: 'candles',
  live: true,
  theme: 'dark',
  stats: false,
  profile: false,
  annotations: false,
  indicators: new Set(['volume']),
};

const chart = document.getElementById('chart');

/* ------------------------------------------------------------------ *
 * Synthetic data (works fully offline)
 * ------------------------------------------------------------------ */

const HIST_LEN = 2600; // long synthetic history; the chart loads it in chunks
const CHUNK = 500; // initial slice handed to the chart
const histCache = new Map();

function historyKey(symbol, tfId) {
  return symbol + ':' + tfId;
}

/** Long synthetic history for a symbol+timeframe (generated once). */
function getHistory(symbol, tfId) {
  const key = historyKey(symbol, tfId);
  let hist = histCache.get(key);
  if (!hist) {
    const tfSec = TFS.find((t) => t.id === tfId).sec;
    hist = genSynthetic(symbol, tfSec, HIST_LEN, BASE_PRICES[symbol] || 100);
    histCache.set(key, hist);
  }
  return hist;
}

/** Older synthetic bars preceding `fromTime` (for chart.onloadmore). */
function olderSynthetic(symbol, tfId, fromTime, limit = CHUNK) {
  const hist = getHistory(symbol, tfId);
  const older = hist.filter((b) => b.time < fromTime);
  return older.slice(-limit);
}

/* ------------------------------------------------------------------ *
 * Binance feed (real data, graceful fallback)
 * ------------------------------------------------------------------ */

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
    const next = makeSynthStream(sec, lastChartClose());
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
        const bars = await fetchBinanceKlines(BINANCE[symbol], tf, 2);
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
    const next = makeSynthStream(sec, lastChartClose());
    const timer = setInterval(() => chart.update(next()), 650);
    setStatus('warn', 'live · synthetic (Binance unreachable)');
    feed = { stop: () => clearInterval(timer) };
    if (ws) { ws.close(); ws = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  };

  ws = openBinanceSocket(
    BINANCE[symbol],
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
  chart.setAttribute('label', `${symbol} · ${tf}`);

  if (symbol === 'DEMO' || !BINANCE[symbol]) {
    chart.onloadmore = (fromTime) => olderSynthetic(symbol, tf, fromTime);
    chart.setData(getHistory(symbol, tf).slice(-CHUNK));
    startFeed();
    return;
  }

  setStatus('warn', `loading ${BINANCE[symbol]} ${tf}…`);
  try {
    const bars = await fetchBinanceKlines(BINANCE[symbol], tf);
    chart.onloadmore = (fromTime) => fetchBinanceKlines(BINANCE[symbol], tf, CHUNK, fromTime);
    chart.setData(bars);
    startFeed({ syntheticFallbackToast: true });
  } catch (err) {
    toast(`Couldn't reach Binance (${err.message}) — showing synthetic data.`);
    chart.onloadmore = (fromTime) => olderSynthetic(symbol, tf, fromTime);
    chart.setData(getHistory(symbol, tf).slice(-CHUNK));
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

/* ---------------- URL sharing ---------------- */

let hashTimer = 0;

function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const chartState = chart.getState();
    const q = new URLSearchParams(
      encodeStateQuery({ ...chartState, indicators: [...state.indicators].join(' ') })
    );
    q.set('sym', state.symbol);
    q.set('tf', state.tf);
    history.replaceState(null, '', '#' + q.toString());
  }, 250);
}

function readHash() {
  if (!location.hash || location.hash.length < 2) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  const sym = p.get('sym');
  if (sym && SYMBOLS.some((s) => s.id === sym)) state.symbol = sym;
  const tf = p.get('tf');
  if (tf && TFS.some((t) => t.id === tf)) state.tf = tf;
  const s = decodeStateQuery(location.hash.slice(1));
  if (s.type && ['candles', 'line', 'area', 'bars', 'hollow', 'heikin'].includes(s.type)) state.type = s.type;
  if (s.theme === 'light' || s.theme === 'dark') state.theme = s.theme;
  if (typeof s.stats === 'boolean') state.stats = s.stats;
  if (typeof s.profile === 'boolean') state.profile = s.profile;
  if (typeof s.annotations === 'boolean') state.annotations = s.annotations;
  if (s.indicators) {
    state.indicators = new Set(
      s.indicators.split(/\s+/).filter((id) => INDICATORS.some((i) => i.id === id))
    );
  }
  return s;
}

chart.addEventListener('hab:range', writeHash);

/* ---------------- build controls ---------------- */

const hashState = readHash();

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  chart.setAttribute('theme', state.theme);
  document.getElementById('ico-moon').style.display = state.theme === 'dark' ? '' : 'none';
  document.getElementById('ico-sun').style.display = state.theme === 'light' ? '' : 'none';
}

if (hashState) {
  chart.setState(hashState); // may stash a pending view until data loads
}
applyTheme();

buildSeg(document.getElementById('seg-symbol'), SYMBOLS, () => state.symbol, (id) => {
  state.symbol = id;
  loadSymbol();
  writeHash();
});

buildSeg(document.getElementById('seg-tf'), TFS, () => state.tf, (id) => {
  state.tf = id;
  loadSymbol();
  writeHash();
});

const segType = document.getElementById('seg-type');
for (const b of segType.children) {
  const on = b.dataset.type === state.type;
  b.classList.toggle('active', on);
  b.setAttribute('aria-pressed', String(on));
}
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
  writeHash();
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
    writeHash();
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

document.getElementById('btn-sonify').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  document.getElementById('chart').setAttribute('sonify', String(on));
  toast(
    on
      ? 'Sound on — hover or use arrow keys to hear the price as pitch.'
      : 'Sound off.'
  );
});

document.getElementById('btn-play').addEventListener('click', () => {
  document.getElementById('chart').playRange();
});

document.getElementById('btn-coview').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  const chartEl = document.getElementById('chart');
  if (on) chartEl.setAttribute('co-view', 'habview-demo');
  else chartEl.removeAttribute('co-view');
  toast(
    on
      ? 'Co-view on — open this page in a second tab and hover the chart.'
      : 'Co-view off.'
  );
});

document.getElementById('btn-annotations').setAttribute('aria-pressed', String(state.annotations));
if (state.annotations) chart.setAttribute('annotations', 'true');
document.getElementById('btn-annotations').addEventListener('click', (e) => {
  state.annotations = !state.annotations;
  chart.setAttribute('annotations', String(state.annotations));
  e.currentTarget.setAttribute('aria-pressed', String(state.annotations));
  writeHash();
});

document.getElementById('btn-profile').setAttribute('aria-pressed', String(state.profile));
if (state.profile) chart.setAttribute('profile', 'true');
document.getElementById('btn-profile').addEventListener('click', (e) => {
  state.profile = !state.profile;
  chart.setAttribute('profile', String(state.profile));
  e.currentTarget.setAttribute('aria-pressed', String(state.profile));
  writeHash();
});

document.getElementById('btn-stats').setAttribute('aria-pressed', String(state.stats));
if (state.stats) chart.setAttribute('stats', 'true');
document.getElementById('btn-stats').addEventListener('click', (e) => {
  state.stats = !state.stats;
  chart.setAttribute('stats', String(state.stats));
  e.currentTarget.setAttribute('aria-pressed', String(state.stats));
  writeHash();
});

document.getElementById('btn-theme').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  writeHash();
});

chart.addEventListener('hab:select', (e) => {
  console.log('hab:select', e.detail.bar.time, '@', e.detail.price?.toFixed(2));
});

/* ---------------- trade demo: positions & alerts ---------------- */

let demoPosCount = 0;
let demoAlertCount = 0;

document.getElementById('btn-long').addEventListener('click', () => {
  const d = chart.data;
  if (!d.length) return;
  const entry = d[d.length - 1].close;
  demoPosCount += 1;
  chart.addPosition({
    id: 'demo-' + demoPosCount,
    side: 'long',
    entry,
    stop: entry * 0.98,
    target: entry * 1.04,
    qty: 0.5,
  });
});

document.getElementById('btn-alert').addEventListener('click', () => {
  const d = chart.data;
  if (!d.length) return;
  const price = d[d.length - 1].close * 1.01;
  demoAlertCount += 1;
  const id = chart.addAlert({ id: 'demo-' + demoAlertCount, price, direction: 'above' });
  toast(`Alert set at ${price.toFixed(2)} — fires when price crosses above.`);
  void id;
});

document.getElementById('btn-clear-trade').addEventListener('click', () => {
  chart.clearPositions();
  chart.clearAlerts();
});

chart.addEventListener('hab:alert', (e) => {
  toast(`Alert ${e.detail.id}: price crossed ${e.detail.price.toFixed(2)}`);
});

/* ---------------- boot ---------------- */

loadSymbol();
