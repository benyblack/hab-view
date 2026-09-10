# wickchart-tape

[![npm](https://img.shields.io/npm/v/wickchart-tape)](https://www.npmjs.com/package/wickchart-tape)

Time & sales for [wickchart](https://github.com/benyblack/wickchart), as an
opt-in plugin layer — a live trade-print strip docked at the bottom of the
canvas. Zero dependencies, zero core changes: the strip docks through the
public `insetBottom` hook (the same one wickchart-navigator uses, so attach
one or the other) and never claims a pointer gesture.

Each row is `time · price · size` for the newest prints, colored by side with
a proportional size bar; the biggest prints in view highlight their row.
Rows: 3–8 (default 7).

```js
npm install wickchart wickchart-tape   // the plugin is a separate package

import 'wickchart';                       // the chart itself
import { attachTape } from 'wickchart-tape';

const tape = attachTape(chart, { rows: 7, bigSize: 50 });

socket.onmessage = (msg) => tape.push(msg.trades); // single or batch
tape.set(backfill);         // replace (history backfill resets the tick rule)
tape.trades;                // → normalized prints, newest last (cap 500)
tape.setRows(4);            // resize the strip live
tape.hide(); tape.show();   // hiding also frees the docked space
tape.clear();
tape.detach();

tape.toBars(60000);         // prints → OHLCV bars, chart-ready
chart.setData(tape.toBars(60000)); // a raw trade stream *is* a chart feed
```

Trades are `{ time, price, size, side? }` — times in ms or s (auto-scaled),
`side` `'buy' | 'sell'` (`'b'`/`'s'` accepted) and optional: prints without a
side get the classic **tick rule** (uptick → buy, downtick → sell, flat →
previous side), carried continuously across `push()` calls. Events on the
chart element: `wick:tape` — `{ detail: { action, added?, total } }` for
`push | set | clear`.

Requires wickchart ≥ 1.6.0 (the `insetBottom` dock hook). The core pure model
(normalization, tick rule, aggregation, formatting) is a separate import:
`import { tradesToBars } from 'wickchart-tape/core'`.
