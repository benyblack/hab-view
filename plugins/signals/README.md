# wickchart-signals

[![npm](https://img.shields.io/npm/v/wickchart-signals)](https://www.npmjs.com/package/wickchart-signals)

Candlestick pattern badges for [wickchart](https://github.com/benyblack/wickchart),
as an opt-in plugin layer — the core stays pattern-free. Zero dependencies.

Detected patterns (v1):

- **Engulfing** (`E`) — bullish / bearish: the body swallows the opposite-colored
  previous body and is strictly bigger.
- **Pin bar** (`P`) — bullish (hammer) / bearish (shooting star): wick ≥ 2× body,
  opposite wick ≤ body.
- **Inside bar** (`IB`) — neutral: high and low inside the previous bar's range.

Badges are letter chips above/below the bar (direction-colored: green up,
red down, gray neutral) with a **crosshair hover explanation** — hover a
badged bar and the plugin draws what it is ("Bullish engulfing") and fires
`wick:signals`, so you can surface it in your own UI. The hover bridge
listens to the chart's own crosshair events: badges never claim a pointer
gesture, pan/zoom/measure stay untouched.

```js
npm install wickchart wickchart-signals   // the plugin is a separate package

import 'wickchart';                        // the chart itself
import { attachSignals } from 'wickchart-signals';

const chart = document.querySelector('wick-chart');
const signals = attachSignals(chart);

signals.setKinds(['engulfing', 'pinbar']); // subset (default: all three; [] = off)
signals.setLabels(false);                  // hover explanations off
signals.count;                             // signals in the current dataset
signals.detach();

chart.addEventListener('wick:signals', (e) => {
  status.textContent = e.detail ? e.detail.label : '';
});
```

Detection is O(n), cached per dataset and kind subset, so panning and
zooming are pure repaints.

Peer dependency: wickchart ≥ 1.4.0 (the plugin layer API).
