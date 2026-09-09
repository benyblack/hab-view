// wickchart-sessions — the pure model: normalization, DST-aware timezone
// math, band computation. Plain data in / data out, no chart involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS,
  parseHM,
  normalizeSessions,
  zonedToUtc,
  weekdayInTz,
  bandsFor,
  weekendBands,
} from '../core.mjs';

const H = 3_600_000;
const DAY = 86_400_000;
const wed = Date.UTC(2026, 2, 4); // 2026-03-04, a Wednesday
const sat = Date.UTC(2026, 2, 7);

/* ------------------------- parseHM / normalizeSessions ------------------------- */

test('parseHM accepts H:MM/HH:MM and 24:00, rejects everything else', () => {
  assert.equal(parseHM('09:30'), 570);
  assert.equal(parseHM('9:05'), 545);
  assert.equal(parseHM('00:00'), 0);
  assert.equal(parseHM('24:00'), 1440);
  assert.ok(Number.isNaN(parseHM('24:01')));
  assert.ok(Number.isNaN(parseHM('9:61')));
  assert.ok(Number.isNaN(parseHM('nope')));
  assert.ok(Number.isNaN(parseHM(90)));
});

test('normalizeSessions: valid def passes, junk is dropped (never throws)', () => {
  const out = normalizeSessions([
    { name: ' NY ', start: '09:30', end: '16:00', tz: 'America/New_York', days: [5, 1, 1, 9], color: '#0f0', alpha: 0.3 },
    null,
    {},
    { name: '', start: '09:30', end: '16:00' },
    { name: 'no start', end: '16:00' },
    { name: 'bad end', start: '09:30', end: '25:00' },
    { name: 'start 24', start: '24:00', end: '16:00' },
    { name: 'zero end', start: '09:30', end: '00:00' }, // end 00:00 = midnight, same as 24:00
    'junk',
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    name: 'NY', startMin: 570, endMin: 960,
    tz: 'America/New_York', utcOffset: null, days: [1, 5], color: '#0f0', alpha: 0.3,
  });
  assert.equal(out[1].name, 'zero end');
  assert.equal(out[1].endMin, 1440, "end '00:00' normalizes to midnight");
  assert.deepEqual(out[1].days, null);
});

test('normalizeSessions: tz validation, utcOffset clamping, caps and name limits', () => {
  const out = normalizeSessions([
    { name: 'bogus tz', start: '00:00', end: '01:00', tz: 'Not/AZone' },
    { name: 'offset', start: '00:00', end: '01:00', utcOffset: 2000 },
    { name: 'offset neg', start: '00:00', end: '01:00', utcOffset: -999 },
    { name: 'four-digit hex', start: '00:00', end: '01:00', color: '#0ff0' },
    { name: 'semantic', start: '00:00', end: '01:00', color: 'up' },
    { name: 'alpha 2', start: '00:00', end: '01:00', alpha: 2 },
    { name: 'x'.repeat(99), start: '00:00', end: '01:00' },
  ]);
  assert.equal(out[0].tz, null, 'invalid IANA name → UTC');
  assert.equal(out[1].utcOffset, 840, 'offset clamps to +14h');
  assert.equal(out[2].utcOffset, -720, 'offset clamps to -12h');
  assert.equal(out[3].color, null, '#0ff0 is not a valid hex');
  assert.equal(out[4].color, 'up');
  assert.equal(out[5].alpha, 1);
  assert.equal(out[6].name.length, 24);
  assert.equal(normalizeSessions(Array.from({ length: 20 }, (_, i) => ({ name: 's' + i, start: '00:00', end: '01:00' }))).length, 12);
  assert.deepEqual(normalizeSessions('nope'), []);
});

/* ------------------------- timezone math ------------------------- */

test('zonedToUtc is DST-exact: US and EU spring-forward 2026', () => {
  // US DST starts Sun 2026-03-08: Fri is EST (-5h), Mon is EDT (-4h)
  assert.equal(zonedToUtc(2026, 3, 6, 570, 'America/New_York'), Date.UTC(2026, 2, 6, 14, 30));
  assert.equal(zonedToUtc(2026, 3, 9, 570, 'America/New_York'), Date.UTC(2026, 2, 9, 13, 30));
  // EU DST starts Sun 2026-03-29: Fri is GMT, Mon is BST
  assert.equal(zonedToUtc(2026, 3, 27, 480, 'Europe/London'), Date.UTC(2026, 2, 27, 8, 0));
  assert.equal(zonedToUtc(2026, 3, 30, 480, 'Europe/London'), Date.UTC(2026, 2, 30, 7, 0));
  // minutes past 24:00 roll into the next day; null tz = plain UTC (months are 1-based)
  assert.equal(zonedToUtc(2026, 3, 4, 1440, 'UTC'), Date.UTC(2026, 2, 5, 0, 0));
  assert.equal(zonedToUtc(2026, 3, 4, 300, null), Date.UTC(2026, 2, 4, 5, 0));
  // memoization returns identical values on the second call
  assert.equal(zonedToUtc(2026, 3, 6, 570, 'America/New_York'), Date.UTC(2026, 2, 6, 14, 30));
});

test('weekdayInTz resolves the wall-clock weekday, not the UTC one', () => {
  assert.equal(weekdayInTz(sat + 10 * H, 'America/New_York'), 6, 'Sat 10:00Z = Sat 06:00 NY');
  assert.equal(weekdayInTz(sat + 3 * H, 'America/New_York'), 5, 'Sat 03:00Z = Fri 23:00 NY');
  assert.equal(weekdayInTz(sat + 3 * H, null), 6, 'no tz → UTC weekday');
});

/* ------------------------- bands ------------------------- */

const crypto = normalizeSessions(PRESETS.crypto);

test('bandsFor: three UTC sessions per day, clipped to the window', () => {
  const bands = bandsFor(crypto, wed, sat); // Wed 00:00 → Sun 00:00 UTC
  assert.equal(bands.length, 9, 'Wed/Thu/Fri × Asia/London/NY');
  const [asia, london, ny] = bands;
  assert.equal(asia.def.name, 'Asia');
  assert.deepEqual([asia.start, asia.end], [wed, wed + 8 * H]);
  assert.deepEqual([london.start, london.end], [wed + 7 * H, wed + 16 * H]);
  assert.deepEqual([ny.start, ny.end], [wed + 12 * H, wed + 21 * H]);
  assert.equal(bands[8].def.name, 'New York', 'Fri NY is the last band');
});

test('bandsFor: a session ending past midnight spans into the next day', () => {
  const [syd] = normalizeSessions([{ name: 'Sydney', start: '21:00', end: '06:00' }]);
  const bands = bandsFor([syd], wed, sat);
  assert.equal(bands.length, 4, "Tue's band spills into Wed; Fri's clips at the window");
  assert.deepEqual([bands[0].start, bands[0].end], [wed, wed + 6 * H], 'spillover from Tue 21:00');
  assert.deepEqual([bands[1].start, bands[1].end], [wed + 21 * H, wed + 30 * H]);
  assert.deepEqual([bands[3].start, bands[3].end], [sat - 3 * H, sat], 'Fri band clips to t1');
});

test('bandsFor: days filter runs in the session timezone (nyse is weekdays only)', () => {
  const [nyse] = normalizeSessions(PRESETS.nyse);
  const bands = bandsFor([nyse], wed, sat);
  assert.equal(bands.length, 3, 'Wed/Thu/Fri only');
  // Mar 4 is before the Mar 8 DST switch → EST (-5h): 09:30→14:30Z, 16:00→21:00Z
  assert.deepEqual([bands[0].start, bands[0].end], [Date.UTC(2026, 2, 4, 14, 30), Date.UTC(2026, 2, 4, 21, 0)]);
  // EST (-5h) in January: 09:30→14:30Z
  const jan = bandsFor([nyse], Date.UTC(2026, 0, 14), Date.UTC(2026, 0, 15));
  assert.deepEqual([jan[0].start, jan[0].end], [Date.UTC(2026, 0, 14, 14, 30), Date.UTC(2026, 0, 14, 21, 0)]);
});

test('bandsFor: fixed utcOffset defs and degenerate windows', () => {
  const [off] = normalizeSessions([{ name: 'X', start: '08:00', end: '10:00', utcOffset: -180 }]);
  const bands = bandsFor([off], wed, sat);
  assert.equal(bands.length, 3);
  assert.deepEqual([bands[0].start, bands[0].end], [wed + 11 * H, wed + 13 * H], 'UTC-3 → 08:00 local = 11:00Z');
  assert.deepEqual(bandsFor([], wed, sat), []);
  assert.deepEqual(bandsFor(crypto, sat, wed), [], 't1 <= t0');
});

test('weekendBands: Sat+Sun as one band, tz-aware, clipped', () => {
  const thu = Date.UTC(2026, 2, 5);
  const mon = Date.UTC(2026, 2, 9);
  assert.deepEqual(weekendBands(thu, mon, null), [{ start: sat, end: mon }], 'UTC weekend = Sat 00:00 → Mon 00:00');
  // NY weekend: Sat 05:00Z → Mon 04:00Z; window cuts it at Sun 12:00Z
  const cut = weekendBands(sat, sat + 36 * H, 'America/New_York');
  assert.deepEqual(cut, [{ start: sat + 5 * H, end: sat + 36 * H }]);
  assert.deepEqual(weekendBands(thu, sat, 'UTC'), [], 'window ends before the weekend');
  assert.deepEqual(weekendBands(sat, thu, null), []);
});
