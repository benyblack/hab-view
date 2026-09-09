# wickchart-sessions

Market session shading for [wickchart](https://github.com/benyblack/wickchart),
as an opt-in plugin layer — the core stays session-free. Zero dependencies.

Translucent session bands (Asia / London / New York, or your own definitions)
under the price action, optional closed-weekend shading, and labels at the top
of each band. Sessions are plain config: presets for crypto & forex use the
common UTC convention; equity/futures presets use IANA timezones, so 09:30 is
the real 09:30 across DST changes. Bands ride zoom & pan and hover events tell
you which session the crosshair is in.

```js
npm install wickchart wickchart-sessions   // the plugin is a separate package

import 'wickchart';                          // the chart itself
import { attachSessions } from 'wickchart-sessions';

const chart = document.querySelector('wick-chart');
const sessions = attachSessions(chart, { preset: 'crypto' });

sessions.setPreset('nyse');   // 'crypto' | 'forex' | 'nyse' | 'cme' | null
sessions.setSessions([...]);  // custom defs — replaces the preset
sessions.setWeekends(true);   // shade closed Sat+Sun (default for nyse/cme)
sessions.setLabels(false);    // band labels at the top (default on)
sessions.setOpacity(0.12);    // band fill alpha (default 0.08)
sessions.detach();

// which session is the crosshair in?
chart.addEventListener('wick:sessions', (e) => status.textContent = e.detail.hover || '');
```

Custom defs — `{ name, start, end, tz?, days?, color?, alpha? }`:

```js
sessions.setSessions([
  { name: 'NY RTH', start: '09:30', end: '16:00', tz: 'America/New_York',
    days: [1, 2, 3, 4, 5], color: '#4c8dff' },        // DST-exact, weekdays
  { name: 'Overnight', start: '18:00', end: '06:00', utcOffset: 0 }, // crosses midnight
]);
```

- `end <= start` crosses midnight into the next day. `end: '24:00'` (or
  `'00:00'`) ends at midnight.
- `tz` is any IANA name (DST-aware); `utcOffset` is fixed minutes east of
  UTC; neither means UTC.
- `days` filters on the band's start weekday in the session timezone
  (0 = Sunday).
- `color` is a hex, or `up` / `down` / `accent` for theme colors; uncolored
  sessions cycle through four default tints.
- Defs are normalized and validated — invalid entries are dropped, never
  thrown. `getSessions()` returns the active, JSON-serializable list.

Presets: **crypto** (Asia 00–08, London 07–16, New York 12–21 UTC), **forex**
(+ Sydney 21–06, Tokyo 00–09 UTC), **nyse** (09:30–16:00 America/New_York,
weekdays, weekends shaded), **cme** (08:30–15:00 America/Chicago, weekdays,
weekends shaded).

The hover bridge listens to the chart's own crosshair events, so shading never
claims a pointer gesture — pan/zoom/measure work untouched.

Peer dependency: wickchart ≥ 1.4.0 (the plugin layer API).
