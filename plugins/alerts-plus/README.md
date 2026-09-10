# wickchart-alerts-plus

[![npm](https://img.shields.io/npm/v/wickchart-alerts-plus)](https://www.npmjs.com/package/wickchart-alerts-plus)

The "pro" alert tier for [wickchart](https://github.com/benyblack/wickchart),
as an opt-in plugin — core alerts are runtime-only by design, so persistence,
desktop notifications and webhooks live here instead. Zero dependencies.

- **Persistence**: the chart's alert list is mirrored into `localStorage`
  at save points (adds/removes, fires, `sync()`, `detach()`) and re-armed on
  the next page load. Once-fired alerts drop out of storage automatically;
  alerts added directly on the chart are picked up too.
- **Hidden-tab surfacing**: while the tab is hidden, a fired alert raises a
  desktop notification (with the user's permission) and a short two-tone
  WebAudio beep — no audio files, no dependencies.
- **Webhook**: an optional URL receives `POST { id, price, when, time, bar,
  key }` on every fire, regardless of tab visibility. Fire-and-forget;
  rejections are swallowed.

```js
npm install wickchart wickchart-alerts-plus   // the plugin is a separate package

import 'wickchart';                              // the chart itself
import { attachAlertsPlus } from 'wickchart-alerts-plus';

const chart = document.querySelector('wick-chart');
const ap = attachAlertsPlus(chart, {
  key: 'BTC:1h',              // storage key — one per symbol+timeframe
  notify: true,               // desktop notification while hidden
  sound: true,                // beep while hidden
  webhook: 'https://example.com/hook', // optional
});
await ap.requestNotify();     // ask for the notification permission once

ap.add({ price: 100, direction: 'above' });   // persisted, re-armed on reload
ap.add({ when: 'rsi(close,14) < 30' });       // scripted alerts persist too
ap.list();                                    // → serializable snapshots
ap.remove(id); ap.clear(); ap.sync(); ap.detach();
```

Notes:

- `storage` and `fetch` are injectable (tests, SSR, custom backends);
  without storage the plugin is memory-only and never throws — private
  mode / quota failures are silently best-effort.
- Restored alerts re-arm (`fired` resets): a non-`once` alert that fired
  before a reload can fire again after it.
- Everything on the chart keeps working: `addAlert` / `removeAlert` /
  `clearAlerts` / `getState`, `wick:alert` events, `once` semantics.

Peer dependency: wickchart ≥ 1.4.0.
