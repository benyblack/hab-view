/**
 * wickchart-draw — TradingView-style drawing tools as a wickchart plugin
 * layer: trendline / ray, horizontal level, rectangle, fibonacci retracement
 * and text. Drawings are plain {time, price} data, so they survive data
 * reloads and ride along with zoom & pan; the whole toolkit builds on the
 * public layer API (addLayer + pointer claims + coordinate transforms) and
 * adds zero tools to the core.
 *
 *   import { attachDrawings } from 'wickchart-draw';
 *   const draw = attachDrawings(chart);
 *   draw.setTool('trendline');   // arm a tool — drags draw instead of pan
 *   draw.setTool(null);          // select mode: click to select, drag to move
 *   draw.getDrawings();          // JSON-serializable array
 *   draw.setDrawings(saved);
 *   draw.undo(); draw.clear();
 *   draw.setShare(true);         // share drawings across tabs (co-view room)
 *
 * Events on the chart element:
 *   wick:drawings  { detail: { drawings, action } }  after every change
 *   wick:drawselect { detail: { id } }               selection changed
 */
import {
  normalizeDrawings,
  distToSegment,
  extendSegment,
  fibPrices,
  resolveColor,
  snapAnchor,
} from './core.mjs';

const HANDLE = 4.5; // half-size of an anchor handle square (px)
const HIT_LINE = 6; // hit tolerance for lines/edges (px)
const HIT_BOX = 9; // hit tolerance for handles (px)
const MIN_DRAG = 5; // px of travel before a 2-point creation commits
const UNDO_MAX = 50;

const TOOLS = new Set(['trendline', 'ray', 'hline', 'rect', 'fib', 'text']);

const fmtP = (v) => {
  const n = Math.abs(v) >= 1000 ? Number(v.toFixed(0)) : Number(v.toFixed(2));
  return n.toLocaleString('en-US');
};

export function attachDrawings(chart, opts = {}) {
  return new DrawLayer(chart, opts);
}

export class DrawLayer {
  constructor(chart, opts = {}) {
    if (!chart || typeof chart.addLayer !== 'function') {
      throw new TypeError('attachDrawings(chart): the chart element is required');
    }
    this._chart = chart;
    this._magnet = opts.magnet !== false;
    this._base = { color: opts.color || null, width: opts.width || null };
    this._drawings = normalizeDrawings(opts.drawings || []);
    this._tool = null;
    this._sel = null;
    this._mode = 'idle'; // idle | create | move | anchor
    this._draft = null;
    this._drag = null;
    this._undo = [];
    this._hits = []; // hit targets cached by the last render pass
    this._editing = null; // { id, input } while a text note is being edited
    this._shareRoom = null; // BroadcastChannel room name, or null = local only
    this._shareWanted = null; // last requested share target (survives teardown)
    this._shareCh = null;
    this._localSeq = 0; // drawing id counter (namespaced by _peer)
    this._peer =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this._layer = {
      id: 'wick-draw',
      draw: (api) => this._render(api),
      onPointer: (ev) => this._onPointer(ev),
    };
    chart.addLayer(this._layer);
    this._onKey = (e) => this._keydown(e);
    if (typeof document !== 'undefined') document.addEventListener('keydown', this._onKey);
    this._onHide = () => this._onPageHide();
    this._onShow = () => this._onPageShow();
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this._onHide);
      window.addEventListener('pageshow', this._onShow);
    }
    if (opts.share) this.setShare(opts.share);
  }

  /* ---------------- public API ---------------- */

  /** Arm a tool ('trendline'|'ray'|'hline'|'rect'|'fib'|'text') or null = select mode. */
  setTool(tool) {
    if (tool !== null && !TOOLS.has(tool)) return this;
    this._tool = tool;
    this._abort();
    return this;
  }

  get tool() {
    return this._tool;
  }

  /** Magnet snap anchors to bar time + OHLC prices (default on). */
  setMagnet(on) {
    this._magnet = on !== false;
    return this;
  }

  get magnet() {
    return this._magnet;
  }

  /**
   * Share drawings across tabs/windows over a BroadcastChannel room.
   * `true` reuses the chart's `co-view` room; a string names an explicit
   * room; `null`/`false` stops sharing. Every local change broadcasts the
   * full list (last writer wins); remote updates apply without touching
   * the local undo stack and fire `wick:drawings` with action `'remote'`.
   * @param {boolean|string|null} share
   */
  setShare(share) {
    this._teardownShare();
    let room = null;
    if (share === true) {
      const attr = this._chart && this._chart.getAttribute ? this._chart.getAttribute('co-view') : null;
      room = attr && attr !== 'false' ? attr : null;
    } else if (typeof share === 'string' && share) {
      room = share;
    }
    this._shareWanted = room ? share : null;
    if (!room || typeof BroadcastChannel === 'undefined') return this;
    this._shareRoom = room;
    try {
      const ch = new BroadcastChannel('wick-draw:' + room);
      ch.onmessage = (e) => this._onShareMsg(e.data);
      this._shareCh = ch;
      // announce so peers with existing drawings send us their list
      ch.postMessage({ v: 1, type: 'draw-hello', src: this._peer });
    } catch (_) {
      this._shareCh = null;
      this._shareRoom = null;
    }
    return this;
  }

  /**
   * A page parked in back/forward cache keeps its channel open and would
   * answer hellos with stale drawings — close on hide, rejoin on show.
   */
  _onPageHide() {
    if (this._shareCh) {
      try {
        this._shareCh.close();
      } catch (_) {}
      this._shareCh = null;
    }
  }

  _onPageShow() {
    if (!this._shareCh && this._shareWanted != null && this._shareWanted !== false) {
      this.setShare(this._shareWanted);
    }
  }

  /** Active share room name, or null when drawings are local-only. */
  get share() {
    return this._shareRoom;
  }

  _teardownShare() {
    if (this._shareCh) {
      try {
        this._shareCh.close();
      } catch (_) {}
    }
    this._shareCh = null;
    this._shareRoom = null;
  }

  _onShareMsg(m) {
    if (!m || m.v !== 1 || m.src === this._peer) return;
    if (m.type === 'draw-hello') {
      if (this._shareCh && this._drawings.length) {
        this._shareCh.postMessage({ v: 1, type: 'draw-sync', src: this._peer, drawings: this.getDrawings() });
      }
      return;
    }
    if (m.type === 'draw-sync' && Array.isArray(m.drawings)) {
      this._drawings = normalizeDrawings(m.drawings);
      if (this._sel && !this._drawings.some((d) => d.id === this._sel)) this._select(null);
      this._chart.requestDraw();
      this._chart.dispatchEvent(
        new CustomEvent('wick:drawings', { detail: { drawings: this.getDrawings(), action: 'remote' } })
      );
    }
  }

  get selectedId() {
    return this._sel;
  }

  /** Deep copy of the drawing list — JSON-serializable. */
  getDrawings() {
    return this._drawings.map((d) => ({
      ...d,
      points: d.points.map((p) => ({ ...p })),
    }));
  }

  /** Replace the whole list (invalid entries are dropped, not thrown). */
  setDrawings(list) {
    this._pushUndo();
    this._drawings = normalizeDrawings(list);
    if (this._sel && !this._drawings.some((d) => d.id === this._sel)) this._select(null);
    this._changed('set');
    return this;
  }

  undo() {
    const snap = this._undo.pop();
    if (snap == null) return false;
    this._drawings = JSON.parse(snap);
    if (this._sel && !this._drawings.some((d) => d.id === this._sel)) this._select(null);
    this._changed('undo');
    return true;
  }

  clear() {
    if (!this._drawings.length) return this;
    this._pushUndo();
    this._drawings = [];
    this._select(null);
    this._changed('clear');
    return this;
  }

  deleteSelected() {
    if (!this._sel) return false;
    this._pushUndo();
    this._drawings = this._drawings.filter((d) => d.id !== this._sel);
    this._select(null);
    this._changed('delete');
    return true;
  }

  detach() {
    this._closeEditor();
    this._teardownShare();
    this._shareWanted = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this._onHide);
      window.removeEventListener('pageshow', this._onShow);
    }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', this._onKey);
    try {
      this._chart.removeLayer('wick-draw');
    } catch (_) {}
    this._chart = null;
  }

  /* ---------------- events ---------------- */

  _changed(action) {
    this._chart.requestDraw();
    this._chart.dispatchEvent(
      new CustomEvent('wick:drawings', { detail: { drawings: this.getDrawings(), action } })
    );
    if (this._shareCh) {
      this._shareCh.postMessage({ v: 1, type: 'draw-sync', src: this._peer, drawings: this.getDrawings() });
    }
  }

  _select(id) {
    if (this._sel === id) return;
    this._sel = id;
    this._chart.requestDraw();
    this._chart.dispatchEvent(new CustomEvent('wick:drawselect', { detail: { id } }));
  }

  _keydown(e) {
    if (!this._sel || this._mode !== 'idle') return;
    const el = e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteSelected();
    }
  }

  /* ---------------- undo ---------------- */

  _pushUndo() {
    this._undo.push(JSON.stringify(this._drawings));
    if (this._undo.length > UNDO_MAX) this._undo.shift();
  }

  /* ---------------- pointer ---------------- */

  _pt(ev) {
    const c = this._chart;
    return { t: c.xToTime(ev.x), p: c.yToPrice(ev.y) };
  }

  /** Anchor under the pointer, magnet-snapped when enabled. */
  _anchor(ev) {
    const c = this._chart;
    const raw = this._pt(ev);
    if (raw.t == null || raw.p == null) return null;
    if (!this._magnet) return raw;
    return snapAnchor(c.data || [], raw.t, raw.p, (p) => c.priceToY(p));
  }

  _onPointer(ev) {
    if (ev.type === 'down') return this._down(ev);
    if (ev.type === 'move') return this._move(ev);
    if (ev.type === 'up') return this._up(ev);
    if (ev.type === 'cancel') return this._cancel(ev);
    return this._mode !== 'idle';
  }

  _down(ev) {
    if (this._editing) {
      // a click while the note editor is open commits it; this one gesture
      // only closes the editor (the next click moves the note)
      this._commitEditor();
      return false;
    }
    const anchor = this._anchor(ev);
    if (!anchor) return false; // no data / outside the plot → chart handles it

    // an armed tool always wins: users expect to draw, never to grab an
    // existing object by accident (select mode handles moving)
    if (this._tool) {
      const a = { t: anchor.t, p: anchor.p };
      this._draft = this._newDrawing(a);
      if (!this._draft) return false;
      this._mode = 'create';
      this._drag = { x0: ev.x, y0: ev.y, moved: false };
      this._select(null);
      this._chart.requestDraw();
      return true;
    }

    // a handle of the selected drawing?
    if (this._sel) {
      const h = this._hits.find(
        (x) => x.id === this._sel && x.kind === 'handle' && Math.hypot(x.x - ev.x, x.y - ev.y) <= HIT_BOX
      );
      if (h) {
        const d = this._drawing(this._sel);
        if (d && !d.locked) {
          this._mode = 'anchor';
          this._drag = { idx: h.anchor, before: this.getDrawings(), moved: false };
          return true;
        }
      }
    }

    // a drawing body? (topmost first — render order is bottom-first, so scan back)
    const body = [...this._hits].reverse().find(
      (x) => x.kind !== 'handle' && x.minX - HIT_LINE <= ev.x && ev.x <= x.maxX + HIT_LINE && x.minY - HIT_LINE <= ev.y && ev.y <= x.maxY + HIT_LINE &&
        this._hitDetail(x, ev.x, ev.y)
    );
    if (body) {
      const d = this._drawing(body.id);
      if (d) {
        // clicking an already-selected text note edits it (select → click again)
        if (d.type === 'text' && d.id === this._sel) {
          this._openTextEditor(d);
          return true;
        }
        this._select(d.id);
        if (!d.locked) {
          this._mode = 'move';
          const a = this._pt(ev);
          this._drag = { t0: a.t, p0: a.p, before: this.getDrawings(), moved: false };
        }
        return true; // claim even when locked, so a click doesn't pan away
      }
    }

    this._select(null);
    return false; // nothing ours — let the chart pan / click
  }

  _move(ev) {
    if (this._mode === 'create') {
      const d = this._draft;
      if (d.points.length > 1) {
        const a = this._anchor(ev);
        if (a) {
          d.points[1] = { t: a.t, p: a.p };
          if (Math.hypot(ev.x - this._drag.x0, ev.y - this._drag.y0) >= MIN_DRAG) this._drag.moved = true;
        }
      }
      this._chart.requestDraw();
      return true;
    }
    if (this._mode === 'move') {
      const d = this._drawing(this._sel);
      const a = this._pt(ev);
      if (!d || !a) return true;
      const dt = a.t - this._drag.t0;
      const dp = a.p - this._drag.p0;
      this._drag.before
        .find((b) => b.id === d.id)
        .points.forEach((pt, i) => {
          d.points[i] = { t: pt.t + dt, p: pt.p + dp };
        });
      this._drag.moved = true;
      this._chart.requestDraw();
      return true;
    }
    if (this._mode === 'anchor') {
      const d = this._drawing(this._sel);
      const a = this._anchor(ev);
      if (d && a) {
        d.points[this._drag.idx] = { t: a.t, p: a.p };
        this._drag.moved = true;
        this._chart.requestDraw();
      }
      return true;
    }
    return false;
  }

  _up(ev) {
    if (this._mode === 'create') {
      const d = this._draft;
      this._mode = 'idle';
      this._draft = null;
      const onePoint = d.points.length === 1;
      if ((onePoint || this._drag.moved) && !(d.type === 'text' && !d.text)) {
        this._pushUndo();
        this._drawings.push(d);
        this._select(d.id);
        this._changed('add');
        if (d.type === 'text') this._openTextEditor(d); // type right after placing
      } else {
        this._chart.requestDraw();
      }
      return true;
    }
    if (this._mode === 'move' || this._mode === 'anchor') {
      const mode = this._mode;
      const changed = this._drag.moved;
      const before = this._drag.before;
      this._mode = 'idle';
      this._drag = null;
      if (changed) {
        this._pushUndoBefore(before);
        this._changed(mode === 'anchor' ? 'edit' : 'move');
      }
      return true;
    }
    return false;
  }

  /* ---------------- text editor ---------------- */

  /**
   * Open an inline editor over a text note. In non-DOM environments (tests)
   * only the editing state is set — commit/cancel logic stays testable.
   */
  _openTextEditor(d) {
    this._closeEditor(false);
    this._editing = { id: d.id, input: null };
    if (typeof document === 'undefined') return;
    const c = this._chart;
    const x = c.timeToX(d.points[0].t);
    const y = c.priceToY(d.points[0].p);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return void (this._editing = null);
    const rect = c.getBoundingClientRect();
    const cs = getComputedStyle(c);
    const accent = cs.getPropertyValue('--wick-accent').trim() || '#4c8dff';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = d.text;
    input.setAttribute('aria-label', 'Edit note');
    Object.assign(input.style, {
      position: 'fixed',
      zIndex: 1000,
      left: Math.max(4, Math.min(rect.left + x, rect.right - 150)) + 'px',
      top: Math.max(4, rect.top + y - 12) + 'px',
      width: '142px',
      font: '600 11.5px ui-sans-serif, system-ui, sans-serif',
      padding: '3px 7px',
      borderRadius: '5px',
      border: '1px solid ' + accent,
      outline: 'none',
      background: 'rgba(17, 20, 28, 0.96)',
      color: cs.getPropertyValue('--wick-text-strong').trim() || '#e6edf3',
      boxShadow: '0 2px 10px rgba(0,0,0,.4)',
    });
    const commit = (e) => {
      e && e.stopPropagation();
      this._commitEditor();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this._commitEditor();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._closeEditor(false);
      }
    });
    input.addEventListener('blur', () => this._commitEditor());
    document.body.appendChild(input);
    this._editing = { id: d.id, input };
    // focus a tick later: the opening click's default mousedown would blur
    // the input immediately (non-focusable canvas), committing the editor
    // before the user ever typed
    setTimeout(() => {
      if (this._editing && this._editing.input === input && input.isConnected) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  /** Commit the open editor: apply the text (empty → delete the note). */
  _commitEditor() {
    const ed = this._editing;
    if (!ed) return;
    const d = this._drawing(ed.id);
    this._closeEditor(false);
    // without a DOM input (tests) there is nothing new to apply — drive
    // _setText directly there
    if (d && ed.input && ed.input.value !== d.text) {
      this._setText(d, ed.input.value);
    }
  }

  /** Remove the editor input without touching the drawing. */
  _closeEditor() {
    const ed = this._editing;
    this._editing = null;
    // the blur handler checks _editing, so tearing down after nulling it
    // cannot re-enter
    if (ed && ed.input && ed.input.isConnected) ed.input.remove();
  }

  _setText(d, value) {
    // resolve the live object — callers may hold a getDrawings() copy
    const live = this._drawing(d && d.id) || null;
    if (!live) return;
    const text = String(value ?? '').slice(0, 160).trim();
    this._pushUndo();
    if (!text) {
      this._drawings = this._drawings.filter((x) => x.id !== live.id);
      if (this._sel === live.id) this._select(null);
      this._changed('delete');
      return;
    }
    live.text = text;
    this._changed('edit');
  }

  _pushUndoBefore(before) {
    this._undo.push(JSON.stringify(before));
    if (this._undo.length > UNDO_MAX) this._undo.shift();
  }

  _cancel() {
    // Escape / pointercancel mid-gesture: revert to the pre-drag snapshot
    if (this._mode === 'move' || this._mode === 'anchor') {
      const before = this._drag && this._drag.before;
      if (before) this._drawings = before;
    }
    this._abort();
    this._chart.requestDraw();
    return true;
  }

  _abort() {
    this._mode = 'idle';
    this._draft = null;
    this._drag = null;
  }

  /* ---------------- model helpers ---------------- */

  _drawing(id) {
    return this._drawings.find((d) => d.id === id) || null;
  }

  _newDrawing(a) {
    const t = this._tool;
    const two = ['trendline', 'ray', 'rect', 'fib'].includes(t);
    // peer-prefixed ids: two tabs drafting at the same moment must never mint
    // the same id — a collision would silently merge drawings once synced
    const id = this._peer + '-' + ++this._localSeq;
    return normalizeDrawings([
      {
        id,
        type: t === 'ray' ? 'trendline' : t,
        points: two ? [a, { ...a }] : [a],
        extend: t === 'ray' ? 'right' : 'none',
        text: t === 'text' ? 'Note' : undefined,
        color: this._base.color || undefined,
        width: this._base.width || undefined,
      },
    ])[0] || null;
  }

  /* ---------------- hit testing ---------------- */

  _hitDetail(x, px, py) {
    if (x.kind === 'box') {
      // same slack as lines: magnet can place the anchor ~10px from where
      // the user aimed, so an 18px text box needs breathing room
      return (
        px >= x.minX - HIT_LINE && px <= x.maxX + HIT_LINE &&
        py >= x.minY - HIT_LINE && py <= x.maxY + HIT_LINE
      );
    }
    if (x.kind === 'seg') {
      return distToSegment(px, py, x.ax, x.ay, x.bx, x.by) <= HIT_LINE;
    }
    return false;
  }

  /* ---------------- render ---------------- */

  _render(api) {
    const { ctx, layout, palette: pal, data } = api;
    this._hits = [];
    if (!data.length) return;
    const main = layout.main;
    const xOf = (t) => api.timeToX(t);
    const yOf = (p) => api.priceToY(p);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, main.y0, layout.plotRight + 1, main.h);
    ctx.clip();

    const pushSeg = (id, ax, ay, bx, by) => {
      if (![ax, ay, bx, by].every(Number.isFinite)) return;
      this._hits.push({
        id,
        kind: 'seg',
        ax, ay, bx, by,
        minX: Math.min(ax, bx), maxX: Math.max(ax, bx),
        minY: Math.min(ay, by), maxY: Math.max(ay, by),
      });
    };

    for (const d of this._drawings) {
      if (!d.visible) continue;
      this._renderOne(ctx, api, d, pal, xOf, yOf, pushSeg, false);
    }
    if (this._draft) this._renderOne(ctx, api, this._draft, pal, xOf, yOf, pushSeg, true);

    // selection handles on top
    const sel = this._draft || this._drawing(this._sel);
    if (sel && sel.visible !== false && !sel.locked) {
      for (let i = 0; i < sel.points.length; i++) {
        const x = xOf(sel.points[i].t);
        const y = yOf(sel.points[i].p);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        ctx.fillStyle = pal.accent;
        ctx.strokeStyle = pal.bg;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(Math.round(x) - HANDLE, Math.round(y) - HANDLE, HANDLE * 2, HANDLE * 2);
        ctx.fill();
        ctx.stroke();
        this._hits.push({ id: sel.id, kind: 'handle', anchor: i, x, y });
      }
    }
    ctx.restore();
  }

  _renderOne(ctx, api, d, pal, xOf, yOf, pushSeg, isDraft) {
    const main = api.layout.main;
    const col = resolveColor(d.color, pal);
    const alpha = isDraft ? 0.75 : 1;
    const id = d.id;
    ctx.globalAlpha = alpha;

    const px = d.points.map((pt) => [xOf(pt.t), yOf(pt.p)]);

    if (d.type === 'trendline') {
      const [a, b] = px;
      if (!a || !b || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return void (ctx.globalAlpha = 1);
      let seg = [a, b];
      if (d.extend !== 'none') {
        const ext = extendSegment(a[0], a[1], b[0], b[1], 0, main.y0, api.layout.plotRight, main.y0 + main.h);
        if (ext) {
          seg =
            d.extend === 'right'
              ? [
                  [b[0], b[1]],
                  ext.t1 >= 1 ? ext.to : b,
                ]
              : [ext.from, ext.to];
        }
      }
      drawSeg(ctx, seg[0], seg[1], col, d.width || 1.5);
      pushSeg(id, seg[0][0], seg[0][1], seg[1][0], seg[1][1]);
    } else if (d.type === 'hline') {
      const y = px[0][1];
      if (!Number.isFinite(y)) return void (ctx.globalAlpha = 1);
      drawSeg(ctx, [0, y], [api.layout.plotRight, y], col, d.width || 1);
      pushSeg(id, 0, y, api.layout.plotRight, y);
      // price label on the right edge
      const label = fmtP(d.points[0].p);
      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
      const w = ctx.measureText(label).width + 10;
      const bx = api.layout.plotRight - w - 4;
      ctx.globalAlpha = alpha * 0.95;
      ctx.fillStyle = col;
      ctx.fillRect(bx, y - 8, w, 16);
      ctx.fillStyle = pal.bg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + w / 2, y + 0.5);
    } else if (d.type === 'rect') {
      const [a, b] = px;
      if (!a || !b) return void (ctx.globalAlpha = 1);
      const x = Math.min(a[0], b[0]);
      const y = Math.min(a[1], b[1]);
      const w = Math.abs(b[0] - a[0]);
      const h = Math.abs(b[1] - a[1]);
      if (![x, y, w, h].every(Number.isFinite)) return void (ctx.globalAlpha = 1);
      ctx.fillStyle = col;
      ctx.globalAlpha = alpha * 0.1;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = col;
      ctx.lineWidth = d.width || 1;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
      for (const s of [
        [x, y, x + w, y],
        [x + w, y, x + w, y + h],
        [x + w, y + h, x, y + h],
        [x, y + h, x, y],
      ]) {
        pushSeg(id, s[0], s[1], s[2], s[3]);
      }
    } else if (d.type === 'fib') {
      const [a, b] = px;
      if (!a || !b || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return void (ctx.globalAlpha = 1);
      const x0 = Math.min(a[0], b[0]);
      const x1 = Math.max(a[0], b[0]);
      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const { k, price } of fibPrices(d.points[0].p, d.points[1].p)) {
        const y = yOf(price);
        if (!Number.isFinite(y) || y < main.y0 - 2 || y > main.y0 + main.h + 2) continue;
        const strong = k === 0 || k === 1 || k === 0.5;
        drawSeg(ctx, [x0, y], [Math.max(x1, x0 + 24), y], col, strong ? d.width || 1.2 : 1, strong ? [] : [4, 4]);
        pushSeg(id, x0, y, Math.max(x1, x0 + 24), y);
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillStyle = pal.text;
        ctx.fillText(`${(k * 100).toFixed(1)}%  ${fmtP(price)}`, Math.max(x1, x0 + 24) + 6, y);
        ctx.globalAlpha = alpha;
      }
    } else if (d.type === 'text') {
      const [a] = px;
      if (!a || !a.every(Number.isFinite)) return void (ctx.globalAlpha = 1);
      ctx.font = '600 11.5px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(d.text).width;
      // subtle halo so the note reads on any background
      ctx.strokeStyle = pal.bg;
      ctx.lineWidth = 3;
      ctx.strokeText(d.text, a[0] + 2, a[1]);
      ctx.fillStyle = d.color ? col : pal.text;
      ctx.fillText(d.text, a[0] + 2, a[1]);
      this._hits.push({
        id,
        kind: 'box',
        minX: a[0], maxX: a[0] + w + 4, minY: a[1] - 9, maxY: a[1] + 9,
      });
    }
    ctx.globalAlpha = 1;
  }
}

function drawSeg(ctx, a, b, col, width, dash) {
  ctx.strokeStyle = col;
  ctx.lineWidth = width;
  ctx.setLineDash(dash || []);
  ctx.beginPath();
  ctx.moveTo(Math.round(a[0]) + 0.5, Math.round(a[1]) + 0.5);
  ctx.lineTo(Math.round(b[0]) + 0.5, Math.round(b[1]) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
}
