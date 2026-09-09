/**
 * wickchart-replay — bar replay as a wickchart plugin: play history forward
 * bar-by-bar (or at speed) while the future stays hidden, driven entirely
 * through the public data API (setData + update — no core changes). A small
 * layer draws the replay badge so the mode is always visible on the chart.
 *
 *   import { attachReplay } from 'wickchart-replay';
 *   const replay = attachReplay(chart);
 *   replay.start();                 // head defaults to ~70% of the data
 *   replay.start(1700000000000);    // …or a time (ms / s / date string)
 *   replay.start(42);               // …or a bar index (integer < data length)
 *   replay.step();                  // reveal one bar
 *   replay.play(4);                 // 4 bars/sec (default 4, 0.5..60)
 *   replay.pause(); replay.play();  // resume at the same speed
 *   replay.seek('2026-03-06');      // jump the head (activates when idle)
 *   replay.stop();                  // exit, restore the full dataset
 *   replay.detach();
 *
 * Events on the chart element:
 *   wick:replay { detail: { active, playing, loop, index, total, time,
 *                           remaining, speed } }          after every change
 *
 * Pause live feeds while replaying: an external update/setData during replay
 * is treated as the data moving under the plugin and aborts replay without
 * restoring (the data no longer matches the stash).
 */

const DEF_SPEED = 4; // bars per second
const SPEED_MIN = 0.5;
const SPEED_MAX = 60;
const START_FRAC = 0.7; // default head position when no anchor is given
/** Numbers >= this are timestamps (ms or s), smaller ones are bar indices. */
const TIME_MIN = 1e9;

const clampSpeed = (v) => Math.max(SPEED_MIN, Math.min(SPEED_MAX, Number(v) || DEF_SPEED));

export function attachReplay(chart, opts = {}) {
  return new Replay(chart, opts);
}

export class Replay {
  constructor(chart, opts = {}) {
    if (!chart || typeof chart.setData !== 'function' || typeof chart.addLayer !== 'function') {
      throw new TypeError('attachReplay(chart): the chart element is required');
    }
    this._chart = chart;
    this._full = null; // full dataset stashed while replaying
    this._head = -1; // index into _full of the last visible bar
    this._anchor = 0; // head position at start() — loop returns here
    this._playing = false;
    this._loop = opts.loop === true;
    this._speed = clampSpeed(opts.speed);
    this._timer = null;
    this._layer = { id: 'wick-replay', draw: (api) => this._render(api) };
    chart.addLayer(this._layer);
  }

  /* ---------------- public API ---------------- */

  /**
   * Enter replay: hide every bar after the anchor. `when` is a time
   * (ms / seconds / date string), a bar index (integer < data length), or
   * null for the default (~70% of the data). Unresolvable anchors fall back
   * to the default. Re-anchors while already replaying.
   */
  start(when) {
    const d = this._chart.data;
    if (!d || d.length < 2) return this;
    this._full = this.active ? this._full : d.slice();
    const head = this._resolve(when, this._full);
    this._head = head;
    this._anchor = head;
    this._chart.setData(this._full.slice(0, head + 1));
    this._fire();
    return this;
  }

  get active() {
    return this._full != null;
  }

  /** Reveal the next `n` bars (clamped at the end). False when not replaying. */
  step(n = 1) {
    if (!this.active || !this._synced()) return false;
    const from = this._head;
    this._head = Math.min(this._full.length - 1, this._head + Math.max(1, Math.floor(Number(n) || 1)));
    if (this._head === from) return true; // already at the end — nothing to reveal
    for (let i = from + 1; i <= this._head; i++) this._chart.update(this._full[i]);
    if (this._head >= this._full.length - 1 && !this._loop) this._halt(); // end reached — stop ticking
    this._fire();
    return true;
  }

  /** Jump the head; activates replay when idle. Same anchor types as start. */
  seek(when) {
    if (!this.active) return this.start(when);
    const head = this._resolve(when, this._full);
    this._head = head;
    this._anchor = Math.min(this._anchor, head);
    this._chart.setData(this._full.slice(0, head + 1));
    this._fire();
    return this;
  }

  /** Play at `speed` bars/sec (default: current speed). Starts replay if idle. */
  play(speed) {
    if (!this.active) this.start();
    if (speed != null) this._speed = clampSpeed(speed);
    clearInterval(this._timer);
    this._playing = true;
    this._timer = setInterval(() => this._tick(), 1000 / this._speed);
    this._fire();
    return this;
  }

  pause() {
    if (!this._playing) return this;
    this._halt();
    this._fire();
    return this;
  }

  get playing() {
    return this._playing;
  }

  /** Exit replay and restore the full dataset. */
  stop() {
    if (!this.active) return this;
    this._halt();
    this._chart.setData(this._full);
    this._full = null;
    this._head = -1;
    this._fire();
    return this;
  }

  /** Loop back to the anchor when the end is reached while playing. */
  setLoop(on) {
    this._loop = on === true;
    this._fire();
    return this;
  }

  get loop() {
    return this._loop;
  }

  /** Playback rate in bars per second (0.5..60; default 4). */
  setSpeed(v) {
    if (this._playing) return this.play(v); // play() restarts the timer
    this._speed = clampSpeed(v);
    this._fire();
    return this;
  }

  get speed() {
    return this._speed;
  }

  /** Index of the last visible bar (-1 when idle). */
  get index() {
    return this._head;
  }

  /** Full dataset length (0 when idle). */
  get total() {
    return this._full ? this._full.length : 0;
  }

  /** Bars still hidden after the head (0 when idle). */
  get remaining() {
    return this.active ? this._full.length - 1 - this._head : 0;
  }

  /** Time of the last visible bar (null when idle). */
  get time() {
    return this.active && this._head >= 0 ? this._full[this._head].time : null;
  }

  detach() {
    if (this.active) this.stop();
    try {
      this._chart.removeLayer('wick-replay');
    } catch (_) {}
    this._chart = null;
  }

  /* ---------------- internals ---------------- */

  /** One playback tick: advance one bar, pause/loop at the end. */
  _tick() {
    if (!this._playing || !this.active) return this._halt();
    if (!this._synced()) return;
    const len = this._full.length;
    if (this._head >= len - 1) {
      if (this._loop) {
        this._head = this._anchor;
        this._chart.setData(this._full.slice(0, this._head + 1));
        this._fire();
      } else {
        this.pause();
      }
      return;
    }
    this.step(1);
  }

  /** Stop the timer (pause + end-of-data), keeping replay active. */
  _halt() {
    this._playing = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * The chart data must be exactly the stash prefix we last wrote — anything
   * else means an external update/setData moved the data under us; abort
   * without restoring (the stash no longer matches reality).
   */
  _synced() {
    const d = this._chart.data;
    if (!this.active || !d || d.length !== this._head + 1) {
      this._halt();
      this._full = null;
      this._head = -1;
      this._fire();
      return false;
    }
    return true;
  }

  /** Resolve a start/seek anchor to a head index (never throws). */
  _resolve(when, d) {
    const last = d.length - 1;
    const def = Math.max(0, Math.floor(d.length * START_FRAC) - 1);
    if (when == null) return def;
    if (typeof when === 'string') {
      const t = Date.parse(when);
      if (!Number.isFinite(t)) return def;
      return this._headForTime(t, d);
    }
    const n = Number(when);
    if (!Number.isFinite(n)) return def;
    if (Math.abs(n) >= TIME_MIN) return this._headForTime(n < 1e12 ? n * 1000 : n, d);
    if (Number.isInteger(n) && n >= 0) return Math.min(last, n);
    return def;
  }

  /** Last bar whose time <= t (0 when t precedes the data). */
  _headForTime(t, d) {
    let lo = 0;
    let hi = d.length - 1;
    if (t < d[0].time) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (d[mid].time <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  _fire() {
    if (!this._chart) return;
    this._chart.dispatchEvent(
      new CustomEvent('wick:replay', {
        detail: {
          active: this.active,
          playing: this._playing,
          loop: this._loop,
          index: this._head,
          total: this.total,
          time: this.time,
          remaining: this.active ? this._full.length - 1 - this._head : 0,
          speed: this._speed,
        },
      })
    );
  }

  /* ---------------- badge layer ---------------- */

  _render(api) {
    if (!this.active) return;
    const { ctx, layout, palette: pal } = api;
    const main = layout.main;
    const label = (this._playing ? '▶ ' : '⏸ ') + 'REPLAY ' + (this._head + 1) + '/' + this._full.length;
    ctx.save();
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    const w = ctx.measureText(label).width + 14;
    const x = layout.plotRight - w - 8; // top-right: clear of the core legend
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = pal.accent;
    ctx.fillRect(x, main.y0 + 8, w, 18);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.bg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 7, main.y0 + 17.5);
    ctx.restore();
  }
}
