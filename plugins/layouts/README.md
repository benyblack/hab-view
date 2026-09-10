# wickchart-layouts

[![npm](https://img.shields.io/npm/v/wickchart-layouts)](https://www.npmjs.com/package/wickchart-layouts)

Named workspace persistence for [wickchart](https://github.com/benyblack/wickchart),
as an opt-in plugin — save and restore whole chart setups by name. Zero
dependencies, zero core changes: everything rides the core's public
`getState()` / `setState()` plus the drawing list when wickchart-draw is
attached.

A layout captures **type, theme, log scale, toggles (stats/profile/
annotations/vol-shading), indicators, view range, positions and alerts** —
and drawings when a `drawings` handle is passed.

```js
npm install wickchart wickchart-layouts   // the plugin is a separate package

import 'wickchart';                          // the chart itself
import { attachDrawings } from 'wickchart-draw';
import { attachLayouts } from 'wickchart-layouts';

const chart = document.querySelector('wick-chart');
const draw = attachDrawings(chart);
const layouts = attachLayouts(chart, {
  key: 'my-desk',        // storage key (default 'wickchart-layouts')
  drawings: draw,        // optional — include drawings in saved layouts
  cap: 20,               // max stored layouts (oldest evicted, default 20)
});

layouts.save('swing');    // capture the current setup
layouts.load('swing');    // apply it back
layouts.list();           // → [{ name, at, drawingCount }] newest first
layouts.rename('swing', 'swing-v2');
layouts.delete('swing');
layouts.export();         // → JSON string — share it, store it anywhere
layouts.import(json);     // merge layouts from such a string (replaces
                          // same-name entries); returns the count

chart.addEventListener('wick:layouts', (e) => {
  console.log(e.detail.action, e.detail.name); // save|load|delete|rename|import
});
layouts.detach();
```

- `wick:layouts` fires on every mutation — pair a `load` with
  `wickchart-alerts-plus`'s `sync()` if you also persist alerts, since a
  layout load replaces the chart's alert list.
- `storage` is injectable; storage failures degrade to an in-memory store
  for the session and never throw. Entries are capped (oldest evicted).

Peer dependency: wickchart ≥ 1.4.0.
