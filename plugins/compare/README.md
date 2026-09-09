# wickchart-compare

Normalized multi-asset overlays for [wickchart](https://github.com/benyblack/wickchart),
as an opt-in plugin layer — the core stays compare-free. Zero dependencies,
zero core changes: the lines draw through the public layer API against their
own invisible scale, so the price axis is never distorted.

Two kinds of entries:

- **Percent lines** — a close series rebased to 0% (TradingView-style
  compare overlay), drawn as a colored line over the main pane.
- **Derived lines** — `ratio` (a/b) or `diff` (a−b) of two series,
  the `formula="BTC/ETH"` use case, rebased the same way; the legend chip
  shows the raw ratio/diff value.

```js
npm install wickchart wickchart-compare   // the plugin is a separate package

import 'wickchart';                          // the chart itself
import { attachCompare } from 'wickchart-compare';

const chart = document.querySelector('wick-chart');
const cmp = attachCompare(chart);

cmp.setSeries([
  { label: 'ETH', data: ethBars },                              // OHLC or {time, value}
  { label: 'SOL', data: solBars, color: '#22d3ee', width: 2 },
  { label: 'BTC/ETH', op: 'ratio', a: btcBars, b: ethBars },    // derived
  { label: 'BTC−ETH', op: 'diff', a: btcBars, b: ethBars },
]);
cmp.setRebase('visible');  // 0% at the window's left edge, re-normalized as
                           // you pan (TV-style); 'first' = dataset start;
                           // or an epoch-ms anchor
cmp.clear();               // remove all lines
cmp.detach();
```

- **Time alignment**: every series is sampled onto the main chart's bar
  times (last known value at-or-before each bar), so timeframes can mix and
  gaps break the line instead of bridging.
- **Legend**: a chip row under the core legend shows each series with its
  live value (`ETH +3.24%`, `BTC/ETH 1543.2`), recomputed every frame.
- **Scale**: rebased values share one invisible scale inset 8% from the
  pane's top/bottom edges; the main chart's price scale is untouched.
- Series are validated and capped at 6; invalid entries are dropped, never
  thrown.

Peer dependency: wickchart ≥ 1.4.0 (the plugin layer API).
