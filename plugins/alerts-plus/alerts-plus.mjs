/**
 * wickchart-alerts-plus — the "pro" alert tier as a wickchart plugin:
 * core alerts are runtime-only by design, so this adds persistence
 * (localStorage), desktop notifications + a beep while the tab is hidden,
 * and an optional webhook — without the core growing any of it.
 *
 *   import { attachAlertsPlus } from 'wickchart-alerts-plus';
 *   const ap = attachAlertsPlus(chart, {
 *     key: 'BTC:1h',        // storage key (default 'wickchart-alerts')
 *     notify: true,         // desktop notification when the tab is hidden
 *     sound: true,          // short beep when the tab is hidden
 *     webhook: 'https://…', // POST { id, price, when, bar, time } on fire
 *   });
 *   ap.add({ price: 100, direction: 'above' });   // → persisted, re-armed
 *   ap.add({ when: 'rsi(close,14) < 30' });       // scripted alerts too
 *   ap.remove(id); ap.clear(); ap.list(); ap.sync(); ap.detach();
 *   ap.requestNotify();     // ask for the desktop-notification permission
 *
 * Everything the chart already does still works: addAlert/removeAlert/
 * clearAlerts/getState, wick:alert events, once-semantics. The plugin
 * mirrors the chart's live alert list into storage at save points (plugin
 * ops, fires, detach, sync()) — so alerts added directly on the chart get
 * persisted too, and once-fired ones drop out of storage automatically.
 * Storage is injectable and optional: without it the plugin is in-memory.
 */

const MAX_PERSISTED = 50;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Serializable snapshot of one chart alert (drops compiled/fired). */
function snapshot(a) {
  const out = { id: String(a.id), once: a.once !== false };
  if (a.when != null) out.when = String(a.when);
  if (isNum(a.price)) {
    out.price = a.price;
    out.direction = a.direction || 'cross';
  }
  return out;
}

export function attachAlertsPlus(chart, opts = {}) {
  return new AlertsPlus(chart, opts);
}

export class AlertsPlus {
  constructor(chart, opts = {}) {
    if (!chart || typeof chart.addAlert !== 'function' || typeof chart.addEventListener !== 'function') {
      throw new TypeError('attachAlertsPlus(chart): the chart element is required');
    }
    this._chart = chart;
    this._storage = opts.storage != null ? opts.storage : globalThis.localStorage;
    this._key = typeof opts.key === 'string' && opts.key ? opts.key : 'wickchart-alerts';
    this._notify = opts.notify !== false;
    this._sound = opts.sound !== false;
    this._webhook = typeof opts.webhook === 'string' && opts.webhook ? opts.webhook : null;
    this._fetch = typeof opts.fetch === 'function' ? opts.fetch : null;
    this._audio = null;
    this._onAlert = (e) => this._fire(e.detail);
    chart.addEventListener('wick:alert', this._onAlert);
    this._restore();
  }

  /* ---------------- public API ---------------- */

  /** Add an alert through the chart and persist it. Returns the id or null. */
  add(alert) {
    const id = this._chart.addAlert(alert);
    if (id != null) this.sync();
    return id;
  }

  remove(id) {
    this._chart.removeAlert(id);
    this.sync();
  }

  clear() {
    this._chart.clearAlerts();
    this.sync();
  }

  /** Live alert list from the chart (read-only view). */
  list() {
    const st = this._chart.getState();
    return (st && Array.isArray(st.alerts) ? st.alerts : []).map((a) => snapshot(a));
  }

  /** Snapshot the chart's current alerts into storage (all of them). */
  sync() {
    this._save(this.list());
    return this;
  }

  /** Ask the user for the desktop-notification permission (no-op elsewhere). */
  async requestNotify() {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        return await Notification.requestPermission();
      }
      return typeof Notification !== 'undefined' ? Notification.permission : 'denied';
    } catch (_) {
      return 'denied';
    }
  }

  detach() {
    this._chart.removeEventListener('wick:alert', this._onAlert);
    this.sync(); // flush whatever the session changed
    this._chart = null;
  }

  /* ---------------- internals ---------------- */

  _read() {
    if (!this._storage) return [];
    try {
      const raw = this._storage.getItem(this._key);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((a) => a && a.id != null).slice(0, MAX_PERSISTED) : [];
    } catch (_) {
      return [];
    }
  }

  _save(list) {
    if (!this._storage) return;
    try {
      this._storage.setItem(this._key, JSON.stringify(list.slice(0, MAX_PERSISTED)));
    } catch (_) {
      /* private mode / quota — persistence is best-effort */
    }
  }

  /** Re-arm every persisted alert on the chart (invalid entries dropped). */
  _restore() {
    for (const a of this._read()) {
      this._chart.addAlert(a);
    }
  }

  /**
   * A chart alert fired: persist (once-fired alerts drop out via the chart),
   * and — while the tab is hidden — raise a desktop notification and a beep.
   * The webhook fires regardless of visibility.
   */
  _fire(detail) {
    if (!this._chart) return;
    const hidden = typeof document !== 'undefined' && document.hidden === true;
    if (hidden && this._notify) this._notifyUser(detail);
    if (hidden && this._sound) this._beep();
    if (this._webhook) this._post(detail);
    // the core removes once-fired alerts right after dispatching this event;
    // save on a microtask so storage reflects the post-fire state
    queueMicrotask(() => {
      if (this._chart) this.sync();
    });
  }

  _notifyUser(detail) {
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const label =
        detail && detail.when != null
          ? detail.when
          : `price ${detail && isNum(detail.price) ? detail.price : '?'}`;
      new Notification('WickChart alert', { body: `Alert fired: ${label}`, tag: detail && detail.id });
    } catch (_) {}
  }

  /** Short two-tone beep via WebAudio (created lazily; never throws). */
  _beep() {
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      if (!this._audio) this._audio = new AC();
      const t = this._audio.currentTime;
      const gain = this._audio.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      gain.connect(this._audio.destination);
      for (const [f, dt] of [[880, 0], [660, 0.12]]) {
        const osc = this._audio.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t + dt);
        osc.connect(gain);
        osc.start(t + dt);
        osc.stop(t + dt + 0.12);
      }
    } catch (_) {}
  }

  /** Fire-and-forget webhook POST; rejection is swallowed. */
  _post(detail) {
    const doFetch = this._fetch || globalThis.fetch;
    if (typeof doFetch !== 'function') return;
    try {
      doFetch(this._webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: detail && detail.id,
          price: detail && detail.price,
          when: detail && detail.when,
          time: detail && detail.bar ? detail.bar.time : null,
          bar: detail && detail.bar,
          key: this._key,
        }),
      }).catch(() => {});
    } catch (_) {}
  }
}
