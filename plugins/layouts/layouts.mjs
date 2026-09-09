/**
 * wickchart-layouts — named workspace persistence as a wickchart plugin:
 * save/restore whole chart setups — type, theme, scale, toggles,
 * indicators, view range, positions, alerts (all via the core's public
 * getState/setState) plus the drawing list when wickchart-draw is attached.
 *
 *   import { attachLayouts } from 'wickchart-layouts';
 *   const layouts = attachLayouts(chart, {
 *     key: 'my-trading-desk',     // storage key (default 'wickchart-layouts')
 *     drawings: drawPlugin,       // optional wickchart-draw DrawLayer
 *   });
 *   layouts.save('swing');    // capture the current setup under a name
 *   layouts.load('swing');    // apply it back
 *   layouts.list();           // → [{ name, at, drawingCount }] newest first
 *   layouts.delete('swing');
 *   layouts.rename('swing', 'swing-v2');
 *   layouts.export();         // → JSON string (share it, store it anywhere)
 *   layouts.import(json);     // → number of layouts merged in
 *   layouts.detach();
 *
 * Every mutation fires `wick:layouts` on the chart with
 * { action, name } — e.g. pair it with wickchart-alerts-plus's sync() to
 * keep persisted alerts in step after a layout load.
 */

const MAX_LAYOUTS = 20;
const MAX_NAME = 40;

const normName = (n) => (typeof n === 'string' ? n.trim().slice(0, MAX_NAME) : '');

export function attachLayouts(chart, opts = {}) {
  return new Layouts(chart, opts);
}

export class Layouts {
  constructor(chart, opts = {}) {
    if (!chart || typeof chart.getState !== 'function' || typeof chart.setState !== 'function') {
      throw new TypeError('attachLayouts(chart): the chart element is required');
    }
    this._chart = chart;
    this._drawings = opts.drawings || null; // a wickchart-draw DrawLayer, or null
    this._storage = opts.storage != null ? opts.storage : globalThis.localStorage;
    this._key = typeof opts.key === 'string' && opts.key ? opts.key : 'wickchart-layouts';
    this._cap = Number.isInteger(opts.cap) && opts.cap > 0 ? Math.min(100, opts.cap) : MAX_LAYOUTS;
    this._mem = null; // in-memory fallback when storage is unavailable
    this._seq = 0; // tiebreaker for same-millisecond saves (persisted)
  }

  /* ---------------- public API ---------------- */

  /** Capture the current setup under `name`. Replaces an existing entry. */
  save(name) {
    const n = normName(name);
    if (!n || !this._chart) return false;
    const entry = { name: n, at: Date.now(), seq: ++this._seq, state: this._chart.getState() };
    if (this._drawings && typeof this._drawings.getDrawings === 'function') {
      entry.drawings = this._drawings.getDrawings();
    }
    const list = this._read().filter((e) => e.name !== n);
    list.push(entry);
    this._write(this._evict(list));
    this._fire('save', n);
    return true;
  }

  /** Apply a saved setup to the chart. False when the name is unknown. */
  load(name) {
    const n = normName(name);
    const entry = n ? this._read().find((e) => e.name === n) : null;
    if (!entry || !this._chart) return false;
    this._chart.setState(entry.state);
    if (this._drawings && typeof this._drawings.setDrawings === 'function' && entry.drawings) {
      this._drawings.setDrawings(entry.drawings);
    }
    this._fire('load', n);
    return true;
  }

  /** Saved layouts, newest first: [{ name, at, drawingCount }]. */
  list() {
    return this._read()
      .slice()
      .sort((a, b) => b.at - a.at || (b.seq || 0) - (a.seq || 0))
      .map((e) => ({
        name: e.name,
        at: e.at,
        drawingCount: Array.isArray(e.drawings) ? e.drawings.length : null,
      }));
  }

  delete(name) {
    const n = normName(name);
    const list = this._read();
    const next = list.filter((e) => e.name !== n);
    if (next.length === list.length) return false;
    this._write(next);
    this._fire('delete', n);
    return true;
  }

  rename(from, to) {
    const f = normName(from);
    const t = normName(to);
    if (!f || !t) return false;
    const list = this._read();
    const entry = list.find((e) => e.name === f);
    if (!entry || list.some((e) => e.name === t)) return false;
    entry.name = t;
    this._write(list);
    this._fire('rename', t);
    return true;
  }

  /** Serialize every saved layout: a portable JSON string. */
  export() {
    return JSON.stringify({ v: 1, layouts: this._read() });
  }

  /**
   * Merge layouts from a string produced by export() (or an array of
   * entries). Same-name entries are replaced. Returns the count merged.
   */
  import(json) {
    let raw;
    try {
      raw = typeof json === 'string' ? JSON.parse(json) : json;
    } catch (_) {
      return 0;
    }
    const incoming = Array.isArray(raw) ? raw : raw && Array.isArray(raw.layouts) ? raw.layouts : [];
    const merged = this._read();
    let count = 0;
    for (const e of incoming) {
      if (!e || typeof e !== 'object' || !normName(e.name) || !e.state || typeof e.state !== 'object') continue;
      const entry = { name: normName(e.name), at: Number.isFinite(e.at) ? e.at : Date.now(), seq: ++this._seq, state: e.state };
      if (Array.isArray(e.drawings)) entry.drawings = e.drawings;
      const at = merged.findIndex((x) => x.name === entry.name);
      if (at >= 0) merged[at] = entry;
      else merged.push(entry);
      count++;
    }
    if (count) {
      this._write(this._evict(merged));
      this._fire('import', String(count));
    }
    return count;
  }

  /** Nothing to unbind — layouts are pull-based. Clears the chart handle. */
  detach() {
    this._chart = null;
  }

  /* ---------------- internals ---------------- */

  _read() {
    if (!this._storage) return this._mem || [];
    try {
      const raw = this._storage.getItem(this._key);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list)
        ? list.filter((e) => e && typeof e === 'object' && typeof e.name === 'string' && e.state)
        : [];
    } catch (_) {
      return this._mem || [];
    }
  }

  _write(list) {
    this._mem = list; // always mirrored, so storage loss keeps the session alive
    if (!this._storage) return;
    try {
      this._storage.setItem(this._key, JSON.stringify(list.slice(0, this._cap)));
    } catch (_) {
      /* private mode / quota — best-effort */
    }
  }

  /** Newest kept beyond the cap is a user decision — oldest are dropped. */
  _evict(list) {
    if (list.length <= this._cap) return list;
    return list
      .slice()
      .sort((a, b) => a.at - b.at || (a.seq || 0) - (b.seq || 0))
      .slice(list.length - this._cap);
  }

  _fire(action, name) {
    if (!this._chart || typeof this._chart.dispatchEvent !== 'function') return;
    try {
      this._chart.dispatchEvent(new CustomEvent('wick:layouts', { detail: { action, name } }));
    } catch (_) {}
  }
}
