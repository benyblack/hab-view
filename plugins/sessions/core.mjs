/**
 * wickchart-sessions — pure session model: presets, normalization, timezone
 * math and band computation. No DOM, no canvas; mirrors the host library's
 * core discipline. Everything here is unit-testable plain data in / data out.
 */

export const PRESETS = {
  // crypto runs 24/7; session times are the common UTC convention
  crypto: [
    { name: 'Asia', start: '00:00', end: '08:00' },
    { name: 'London', start: '07:00', end: '16:00' },
    { name: 'New York', start: '12:00', end: '21:00' },
  ],
  forex: [
    { name: 'Sydney', start: '21:00', end: '06:00' },
    { name: 'Tokyo', start: '00:00', end: '09:00' },
    { name: 'London', start: '07:00', end: '16:00' },
    { name: 'New York', start: '12:00', end: '21:00' },
  ],
  // equities/futures: DST-exact wall-clock times, weekdays only
  nyse: [{ name: 'NYSE', start: '09:30', end: '16:00', tz: 'America/New_York', days: [1, 2, 3, 4, 5] }],
  cme: [{ name: 'RTH', start: '08:30', end: '15:00', tz: 'America/Chicago', days: [1, 2, 3, 4, 5] }],
};

/** Presets that default to weekend shading (the market is actually closed). */
export const WEEKEND_PRESETS = new Set(['nyse', 'cme']);

/** Fill tints cycled per session — picked to read on both dark and light themes. */
export const DEFAULT_COLORS = ['#4c8dff', '#f0b90b', '#16c784', '#a78bfa'];

export const WEEKEND_COLOR = '#8b949e';

const MAX_SESSIONS = 12;
const MAX_NAME = 24;
const DAY = 86_400_000;
/** Session shading stops making visual sense far out; cap the day scan. */
export const MAX_DAYS = 750;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const HM = /^([01]?\d|2[0-4]):([0-5]\d)$/;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** '09:30' → 570 minutes since midnight; '24:00' → 1440; else NaN. */
export function parseHM(str) {
  const m = typeof str === 'string' && HM.exec(str.trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  if (h === 24 && Number(m[2]) !== 0) return NaN; // '24:00' is midnight, '24:01' is nothing
  return h * 60 + Number(m[2]);
}

function validTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 40) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Validate + clamp a list of raw session defs into plain, serializable data.
 * Invalid entries are dropped (never throw) — same contract as
 * normalizeDrawings / normalizeOverlays in the host core.
 *
 * Session shape: { name, start: 'HH:MM', end: 'HH:MM', tz?: IANA name,
 *   utcOffset?: minutes east of UTC, days?: [0..6] (0=Sun, in session tz),
 *   color?: '#hex'|'up'|'down'|'accent', alpha?: 0..1 }.
 * `end <= start` crosses midnight into the next day; neither tz nor
 * utcOffset means UTC.
 */
export function normalizeSessions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    if (out.length >= MAX_SESSIONS) break;
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_NAME) : '';
    if (!name) continue;
    // accepts raw defs ('09:30' strings) AND already-normalized defs (minute
    // numbers), so the output of getSessions() is a valid setSessions() input
    const startMin = isNum(raw.startMin) ? Math.round(raw.startMin) : parseHM(raw.start);
    let endMin = isNum(raw.endMin) ? Math.round(raw.endMin) : parseHM(raw.end);
    if (!isNum(startMin) || !isNum(endMin) || startMin < 0 || startMin > 1439 || endMin < 0 || endMin > 1440) continue;
    if (endMin === 0) endMin = 1440; // end '00:00' = midnight, same as '24:00'
    const tz = validTz(raw.tz) ? raw.tz : null;
    const utcOffset = isNum(raw.utcOffset) ? Math.max(-720, Math.min(840, Math.round(raw.utcOffset))) : null;
    let days = null;
    if (Array.isArray(raw.days)) {
      days = [...new Set(raw.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
      if (!days.length) days = null;
    }
    const color = typeof raw.color === 'string' && (['up', 'down', 'accent'].includes(raw.color) || HEX.test(raw.color))
      ? raw.color
      : null;
    const alpha = isNum(raw.alpha) ? Math.max(0, Math.min(1, raw.alpha)) : null;
    out.push({ name, startMin, endMin, tz, utcOffset, days, color, alpha });
  }
  return out;
}

/* ------------------------ timezone math ------------------------ */

const dtfCache = new Map();

function dtfFor(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts {y, mo, d, hh, mm} of an epoch-ms instant in a tz. */
function wallParts(at, tz) {
  const parts = dtfFor(tz).formatToParts(new Date(at));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get('year'), mo: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
}

/** Offset east of UTC in minutes at instant `at` (DST-aware via Intl). */
function tzOffsetMin(at, tz) {
  const p = wallParts(at, tz);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.hh, p.mm) - at) / 60000);
}

const zonedCache = new Map();

/**
 * Epoch ms of "wall time `minutes` past midnight of UTC-date (y, mo, d) in
 * tz". Guess-and-correct handles DST; per-(tz, date, minute) memoization
 * keeps panning cheap (offsets repeat across days, Intl is the slow part).
 */
export function zonedToUtc(y, mo, d, minutes, tz) {
  if (!tz) return Date.UTC(y, mo - 1, d, 0, minutes); // UTC (no Intl needed)
  const key = tz + '|' + y + '-' + mo + '-' + d + '|' + minutes;
  const hit = zonedCache.get(key);
  if (hit != null) return hit;
  const wall = Date.UTC(y, mo - 1, d, 0, minutes);
  let g = wall;
  for (let i = 0; i < 2; i++) {
    g = wall - tzOffsetMin(g, tz) * 60000;
  }
  if (zonedCache.size > 8192) zonedCache.clear();
  zonedCache.set(key, g);
  return g;
}

/** 0=Sun..6=Sat of an instant's wall-clock date in a tz (UTC when no tz). */
export function weekdayInTz(at, tz) {
  if (!tz) return new Date(at).getUTCDay();
  const p = wallParts(at, tz);
  return new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
}

/** utcOffset (minutes) form → same shape as tz form, minus the Intl work. */
function fixedOffsetToUtc(y, mo, d, minutes, off) {
  return Date.UTC(y, mo - 1, d, 0, minutes) - off * 60000;
}

/** Resolve a def's epoch start/end on one calendar date (UTC-anchored). */
function defBoundsOn(def, y, mo, d) {
  if (def.utcOffset != null) {
    const endMin = def.endMin > def.startMin ? def.endMin : def.endMin + 1440;
    return {
      s: fixedOffsetToUtc(y, mo, d, def.startMin, def.utcOffset),
      e: fixedOffsetToUtc(y, mo, d, endMin, def.utcOffset),
      weekday: new Date(fixedOffsetToUtc(y, mo, d, 0, def.utcOffset)).getUTCDay(),
    };
  }
  const s = zonedToUtc(y, mo, d, def.startMin, def.tz);
  const e = zonedToUtc(y, mo, d, def.endMin > def.startMin ? def.endMin : def.endMin + 1440, def.tz);
  return { s, e, weekday: weekdayInTz(s, def.tz) };
}

/**
 * Session bands overlapping the window [t0, t1] (epoch ms): one entry per
 * (def, day), clipped to the window. `end <= start` defs roll into the next
 * day; `days` filters on the band's start weekday in the session timezone.
 */
export function bandsFor(defs, t0, t1) {
  if (!Array.isArray(defs) || !defs.length || !isNum(t0) || !isNum(t1) || t1 <= t0) return [];
  const out = [];
  const startDay = Math.floor(t0 / DAY) - 2;
  const endDay = Math.floor(t1 / DAY) + 2;
  for (let day = startDay; day <= endDay && day - startDay < MAX_DAYS; day++) {
    const base = new Date(day * DAY);
    const y = base.getUTCFullYear();
    const mo = base.getUTCMonth() + 1;
    const d = base.getUTCDate();
    for (const def of defs) {
      const b = defBoundsOn(def, y, mo, d);
      if (b.e <= b.s) continue;
      if (def.days && !def.days.includes(b.weekday)) continue;
      if (b.e > t0 && b.s < t1) out.push({ def, start: Math.max(b.s, t0), end: Math.min(b.e, t1) });
    }
  }
  return out;
}

/**
 * Weekend shading bands (Sat + Sun midnight-to-midnight in `tz`, merged
 * into one band each): epoch ms entries clipped to [t0, t1].
 */
export function weekendBands(t0, t1, tz) {
  if (!isNum(t0) || !isNum(t1) || t1 <= t0) return [];
  const out = [];
  const startDay = Math.floor(t0 / DAY) - 2;
  const endDay = Math.floor(t1 / DAY) + 2;
  for (let day = startDay; day <= endDay && day - startDay < MAX_DAYS; day++) {
    const base = new Date(day * DAY);
    const y = base.getUTCFullYear();
    const mo = base.getUTCMonth() + 1;
    const d = base.getUTCDate();
    const zoned = tz ? zonedToUtc(y, mo, d, 0, tz) : day * DAY;
    if (weekdayInTz(zoned, tz) !== 6) continue; // Saturdays only — each carries its own Sunday
    const s = zoned;
    const e = tz ? zonedToUtc(y, mo, d + 2, 0, tz) : s + 2 * DAY;
    if (e > t0 && s < t1) out.push({ start: Math.max(s, t0), end: Math.min(e, t1) });
  }
  return out;
}
