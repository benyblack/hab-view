# wickchart-navigator

[![npm](https://img.shields.io/npm/v/wickchart-navigator)](https://www.npmjs.com/package/wickchart-navigator)

The range-slider strip for [wickchart](https://github.com/benyblack/wickchart),
as an opt-in plugin layer — the most-missed TradingView affordance. A
silhouette of the whole dataset docks at the bottom of the canvas with a
draggable viewport window: drag the window to pan, grab an edge to resize,
click outside it to jump. Panning/zooming the chart moves the window and
 vice versa — both stay in sync live.

Requires wickchart ≥ **1.6.0** with the `insetBottom` dock hook (added in
1.6.0, the same release as this plugin): the largest `insetBottom` declared
by any layer reserves a strip at the bottom of the canvas — panes and the
time axis shrink above it, and the strip is handed to layers as
`api.layout.dock`. On older charts the plugin degrades silently (the layer
renders nothing).

```js
npm install wickchart wickchart-navigator   // the plugin is a separate package

import 'wickchart';                            // the chart itself
import { attachNavigator } from 'wickchart-navigator';

const chart = document.querySelector('wick-chart');
const nav = attachNavigator(chart, { height: 46 }); // strip height, 24..120
nav.detach();                                   // remove the strip again
```

- **Window interactions**: drag the body to pan, the 6px edges to resize
  (min span: 5 bars), click outside the window to center it on the click.
- **Two-way sync**: the window follows chart pan/zoom every frame; drags
  apply through the chart's public `setVisibleRange`.
- **Performance**: the silhouette is O(n) once per (dataset, strip width)
  and cached; renders are pure repaints.

Peer dependency: wickchart ≥ 1.6.0 (the dock hook).
