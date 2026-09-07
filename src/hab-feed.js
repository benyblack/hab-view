/* ==========================================================================
 * <hab-feed> — declarative data feeds for <hab-chart>.
 *
 *   <script type="module" src="https://unpkg.com/hab-view/feed"></script>
 *
 *   <hab-feed for="chart" binance="BTCUSDT" tf="1h"></hab-feed>
 *   <hab-chart id="chart" indicators="sma:20 volume"></hab-chart>
 *
 * A fully live chart with zero JavaScript written. Sources:
 *   binance="SYMBOL"  live via WebSocket (REST klines + backfill; falls back
 *                     to REST polling, then to a synthetic stream when the
 *                     network/region blocks Binance)
 *   demo="KEY"        deterministic offline synthetic feed (BTC/ETH/SOL/DEMO
 *                     base prices; any other key seeds a fresh series)
 *   url="ENDPOINT"    generic REST JSON array of bars; optional poll="SECONDS"
 *
 * Attributes: for (chart id; auto-pairs with the first chart otherwise),
 *   tf (1m…1w), limit (initial bars, default 500), live="false" to disable
 *   streaming. Status is reflected in the `status` attribute and via
 *   `hab-feed:status` events (loading / live / polling / fallback / loaded /
 *   waiting / idle). `hab-feed:fallback` fires when a live source degrades.
 * ========================================================================== */

import './hab-chart.js';
import {
  genSynthetic,
  makeSynthStream,
  fetchBinanceKlines,
  openBinanceSocket,
  tfToSeconds,
  BASE_PRICES,
} from './feeds.js';

const LIVE_TICK_MS = 650;

class HabFeed extends HTMLElement {
  static get observedAttributes() {
    return ['for', 'binance', 'demo', 'url', 'tf', 'limit', 'poll', 'live'];
  }

  constructor() {
    super();
    this._gen = 0; // generation token: stale async callbacks no-op
    this._closers = [];
    this._timer = 0;
    this._observer = null;
  }

  connectedCallback() {
    this._scheduleRestart();
  }

  disconnectedCallback() {
    this._teardown();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal !== newVal) this._scheduleRestart();
  }

  _scheduleRestart() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = 0;
      if (this.isConnected) this._restart();
    }, 0);
  }

  _teardown() {
    this._gen++;
    clearTimeout(this._timer);
    this._timer = 0;
    for (const close of this._closers.splice(0)) {
      try {
        close();
      } catch (_) {}
    }
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  }

  _setStatus(status, detail) {
    if (!this.isConnected) return;
    this.setAttribute('status', status);
    this.dispatchEvent(new CustomEvent('hab-feed:status', { detail: { status, ...detail } }));
  }

  /** Resolve the target chart (by `for` id, else the first <hab-chart>). */
  _resolveChart() {
    const id = this.getAttribute('for');
    if (id) {
      const el = document.getElementById(id);
      return el && el.tagName === 'HAB-CHART' ? el : null;
    }
    return document.querySelector('hab-chart');
  }

  _restart() {
    this._teardown();
    let chart = this._resolveChart();
    if (!chart || typeof chart.setData !== 'function') {
      // chart not in the DOM yet (or not upgraded) — watch for it
      this._setStatus('waiting');
      customElements.whenDefined('hab-chart').then(() => {
        if (!this.isConnected) return;
        this._observer = this._observer || new MutationObserver(() => {
          const c = this._resolveChart();
          if (c && typeof c.setData === 'function') {
            this._observer.disconnect();
            this._observer = null;
            this._scheduleRestart();
          }
        });
        this._observer.observe(document.documentElement, { childList: true, subtree: true });
      });
      return;
    }
    if (!chart.hasAttribute('label')) {
      const sym = this.getAttribute('binance') || this.getAttribute('demo');
      if (sym) chart.setAttribute('label', `${String(sym).toUpperCase()} · ${this.getAttribute('tf') || '1h'}`);
    }

    const gen = this._gen;
    const live = this.getAttribute('live') !== 'false';
    const tfId = (this.getAttribute('tf') || '1h').toLowerCase();
    const limit = Math.max(10, Math.min(5000, parseInt(this.getAttribute('limit') || '500', 10) || 500));
    const sym = this.getAttribute('binance');
    const url = this.getAttribute('url');
    const demo = this.getAttribute('demo');

    if (sym) this._binance(gen, chart, String(sym).toUpperCase(), tfId, limit, live);
    else if (url) this._rest(gen, chart, url, limit, live);
    else if (demo != null) {
      this._synthetic(gen, chart, demo === '' ? 'DEMO' : demo, tfId, limit, live);
    } else this._setStatus('idle');
  }

  /* ---------------- synthetic source ---------------- */

  _synthetic(gen, chart, key, tfId, limit, live, status = 'live') {
    const sec = tfToSeconds(tfId);
    const base = BASE_PRICES[key.toUpperCase()] || 100;
    const histLen = Math.max(limit * 5, 3000);
    const hist = genSynthetic(`${key}:${tfId}`, sec, histLen, base);
    chart.onloadmore = (fromTime) => hist.filter((b) => b.time < fromTime).slice(-limit);
    chart.setData(hist.slice(-limit));
    this._setStatus(status);
    if (!live) return;
    const d = chart.data;
    const next = makeSynthStream(sec, d.length ? d[d.length - 1].close : base);
    const timer = setInterval(() => {
      if (this._gen !== gen || !this.isConnected) return;
      chart.update(next());
    }, LIVE_TICK_MS);
    this._closers.push(() => clearInterval(timer));
  }

  /* ---------------- Binance source ---------------- */

  async _binance(gen, chart, sym, tfId, limit, live) {
    this._setStatus('loading');
    try {
      const bars = await fetchBinanceKlines(sym, tfId, limit);
      if (this._gen !== gen || !this.isConnected) return;
      chart.setData(bars);
      chart.onloadmore = (fromTime) => fetchBinanceKlines(sym, tfId, limit, fromTime);
      if (!live) {
        this._setStatus('loaded');
        return;
      }
      const ws = openBinanceSocket(
        sym,
        tfId,
        (bar) => {
          if (this._gen !== gen || !this.isConnected) return;
          this._setStatus('live');
          chart.update(bar);
        },
        () => {
          if (this._gen !== gen || !this.isConnected) return;
          this._pollBinance(gen, chart, sym, tfId);
        }
      );
      this._closers.push(() => ws.close());
    } catch (err) {
      if (this._gen !== gen || !this.isConnected) return;
      this._degrade(gen, chart, sym, tfId, limit, live, err);
    }
  }

  _pollBinance(gen, chart, sym, tfId) {
    this._setStatus('polling');
    const timer = setInterval(async () => {
      if (this._gen !== gen || !this.isConnected) return;
      try {
        const bars = await fetchBinanceKlines(sym, tfId, 2);
        for (const b of bars) chart.update(b);
      } catch (_) {
        clearInterval(timer);
        this._degrade(gen, chart, sym, tfId, 500, true, new Error('poll failed'));
      }
    }, 10000);
    this._closers.push(() => clearInterval(timer));
  }

  _degrade(gen, chart, sym, tfId, limit, live, err) {
    this.dispatchEvent(
      new CustomEvent('hab-feed:fallback', { detail: { reason: err && err.message } })
    );
    this._synthetic(gen, chart, sym, tfId, limit, live, 'fallback');
  }

  /* ---------------- generic REST source ---------------- */

  async _rest(gen, chart, url, limit, live) {
    this._setStatus('loading');
    const pull = async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      return Array.isArray(body) ? body : body.bars;
    };
    try {
      const bars = await pull();
      if (this._gen !== gen || !this.isConnected) return;
      chart.setData(bars.slice(-limit));
      this._setStatus(live ? 'loaded' : 'loaded');
      if (!live) return;
      const pollSec = Math.max(1, parseInt(this.getAttribute('poll') || '0', 10) || 0);
      if (!pollSec) return;
      const timer = setInterval(async () => {
        if (this._gen !== gen || !this.isConnected) return;
        try {
          const fresh = await pull();
          for (const b of fresh.slice(-3)) chart.update(b);
          this._setStatus('polling');
        } catch (_) {}
      }, pollSec * 1000);
      this._closers.push(() => clearInterval(timer));
    } catch (err) {
      if (this._gen !== gen || !this.isConnected) return;
      this._setStatus('error', { message: err && err.message });
    }
  }
}

if (!customElements.get('hab-feed')) {
  customElements.define('hab-feed', HabFeed);
}

export default HabFeed;
