# WickChart

**`<wick-chart>` — a modern, simpler, more useful charting web component.**

A TradingView-style financial chart as a single framework-agnostic Web Component.
One file, zero dependencies, one HTML tag. Canvas-rendered, fast, themeable, and
streaming-ready.

## Install

```bash
npm install wickchart
```

```js
// any bundler / framework — TypeScript types included
import 'wickchart';                       // registers <wick-chart>
import WickChart from 'wickchart';         // for WickChart.registerIndicator(...)
import { encodeStateQuery } from 'wickchart/core';  // pure helpers
import { WickChart } from 'wickchart/react';        // React bindings (optional)
```

Or straight from a CDN — no install, no build:

```html
<script type="module" src="https://unpkg.com/wickchart"></script>

<wick-chart label="BTC · 1h" type="candles" indicators="sma:20 volume"></wick-chart>

<script type="module">
  const chart = document.querySelector('wick-chart');
  chart.setData(bars);   // [{ time, open, high, low, close, volume }]
  chart.update(bar);     // stream live updates
</script>
```

Works in plain HTML, React, Vue, Svelte, Angular — anywhere a `<div>` works.
TypeScript declarations ship inside the package (generated at pack time from
the JSDoc-annotated source — the repo itself stays 100% dependency-free JS).

## Declarative live charts with `<wick-feed>`

One more script tag and your chart is fully live — data, backfill, streaming —
with **zero JavaScript written**:

```html
<script type="module" src="https://unpkg.com/wickchart/feed"></script>

<wick-feed for="chart" binance="BTCUSDT" tf="1h"></wick-feed>
<wick-chart id="chart" indicators="sma:20 volume" profile></wick-chart>
```

| Attribute   | Meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `for`       | target `<wick-chart>` id (auto-pairs with the first chart when omitted)   |
| `binance`   | Binance symbol (`BTCUSDT`) — REST load + WebSocket live + backfill       |
| `demo`      | deterministic offline synthetic feed (`demo="ETH"` picks a base price)   |
| `url`       | generic REST endpoint returning a JSON array of bars (+ `poll="10"` sec) |
| `tf`        | timeframe: `1m 3m 5m 15m 30m 1h 2h 4h 6h 12h 1d 3d 1w`                  |
| `limit`     | initial bars (default 500)                                               |
| `live`      | `live="false"` loads history without streaming                           |

The element reflects its state in the `status` attribute (`loading`, `live`,
`polling`, `fallback`, `loaded`, `waiting`, `idle`) and emits
`wick-feed:status` / `wick-feed:fallback` events. When Binance is unreachable
(geo-blocked, offline), it degrades gracefully: WebSocket → REST polling → a
synthetic stream bridged from the last real price, so the chart never goes
blank. It also wires `chart.onloadmore` for infinite backfill automatically.

---

## Why another chart library?

TradingView's charting library is powerful but heavy and enterprise-licensed;
most wrappers add build steps and framework lock-in. WickChart takes the opposite
bet:

- **Zero dependencies, single file** (~40 KB unminified, no build step required)
- **One tag, sane defaults** — drop it in and it renders; everything optional
- **Built-in usefulness** — crosshair + OHLC legend, last-price line, wheel zoom,
  drag pan, pinch, keyboard navigation, live streaming, PNG export
- **Themeable with CSS variables** — two built-in themes, full control from
  outside the component (Shadow DOM friendly)
- **Accessible** — focusable, arrow-key crosshair, ARIA summary of the data

## Try it online

The demo site is deployed to GitHub Pages:
**https://benyblack.github.io/wickchart/** — a landing page with a live hero
chart, the full interactive demo, the zero-JavaScript declarative page, and a
[React demo](./demo/react.html) driven entirely by React state.

**Full documentation lives at
[benyblack.github.io/wickchart/docs.html](./docs.html)** — every attribute,
method, event, the WickScript reference, overlays (with a live JSON
playground), feeds, theming and framework bindings, each with runnable
examples. This README covers the same ground in plain markdown.

## Run the demo locally

```bash
npm run dev        # serves on http://localhost:5173
# or: npx serve . -l 5173
# or: python -m http.server 5173
```

Then open **http://localhost:5173/demo/**.

The demo ships with an offline synthetic feed (random walk with volatility
regimes + live ticking), and optionally loads **real Binance data** (REST +
WebSocket) for BTC/ETH/SOL when the API is reachable from your network —
with graceful fallback to synthetic data if it isn't.

---

## Frameworks

`<wick-chart>` is framework-agnostic — attributes, one `data` property,
standard DOM events. The one opinionated wrapper ships as `wickchart/react`,
which turns that contract into idiomatic React with proper event
subscription/cleanup. `react` is an **optional** peer dependency: nothing
changes if you never import `wickchart/react`.

### React

```bash
npm install wickchart react
```

```jsx
import { WickChart, useWickChart } from 'wickchart/react';

// drop-in component — props map 1:1 onto the element
export function PriceChart({ bars, onRange }) {
  return (
    <WickChart
      type="candles"
      indicators="sma:20 ema:50 volume"
      volshading
      label="BTC · 1h"
      data={bars}                 // bars are assigned as a property
      onRange={onRange}           // subscribes to wick:range
      onAlert={(e) => toast(`crossed ${e.detail.price}`)}
      style={{ height: 420 }}
    />
  );
}

// or the hook, when you need the imperative API
function PracticeChart({ bars }) {
  const { ref, chart } = useWickChart({ data: bars, indicators: 'sma:20' });
  // chart.getDataWindow(), chart.addAlert(...), chart.getState() … after mount
  return <wick-chart ref={ref} style={{ height: 420 }} />;
}
```

Rules of thumb:

- **Pass a fresh array** to `data` when the bars change — the binding compares
  by reference, and reassignment is what triggers a redraw (don't mutate).
  The same rule applies to `overlays` (see
  [Server-side overlays](#server-side-overlays-zones--levels)).
- **String/number/boolean props become attributes** (`type`, `indicators`,
  `volshading`, …); `className`/`style`/`id` reach React as usual.
- **`onXxx` subscribes to `wick:xxx`** with cleanup on unmount; an
  `events={{ range: fn }}` object works too.
- Works the same on React 16.8 → 19 — no custom-element event caveats.

No build step? The [React demo](./demo/react.html) runs straight off a CDN
import map — `react` and `react-dom` from esm.sh, the bindings from the
package source.

### Vue 3

```vue
<script setup>
import { ref, onMounted } from 'vue';
import 'wickchart';
const chart = ref(null);
const bars = ref([]);
onMounted(async () => {
  bars.value = await loadBars();
  chart.value.data = bars.value;
  chart.value.addEventListener('wick:range', (e) => console.log(e.detail));
});
</script>

<template>
  <wick-chart ref="chart" type="candles" indicators="sma:20"
              style="height: 420px"></wick-chart>
</template>
```

### Svelte

```svelte
<script>
  import 'wickchart';
  let el;
  let bars = [];
  $: if (el && bars.length) el.data = bars;
</script>

<wick-chart bind:this={el} type="candles" indicators="sma:20"
            on:wick:alert={(e) => console.log(e.detail)}
            style="height: 420px"></wick-chart>
```

---

## Data format

Bars are plain objects; `time` accepts **milliseconds or seconds** (auto-detected).
For line-style data you can pass `{ time, value }` instead of full OHLCV.

```js
chart.setData([
  { time: 1694000000000, open: 100.5, high: 101.2, low: 99.8, close: 100.9, volume: 1200 },
  // ...
]);
```

## Attributes

| Attribute     | Default    | Description                                                        |
| ------------- | ---------- | ------------------------------------------------------------------ |
| `theme`       | `dark`     | `dark` or `light`                                                   |
| `type`        | `candles`  | `candles`, `line`, `area`, `bars` (OHLC), `hollow` (hollow up-candles), `heikin` (Heikin-Ashi) |
| `indicators`  | `volume`*  | Space/comma-separated: `sma:20`, `ema:50`, `bb:20`, `rsi:14`, `macd:12/26/9`, `volume`, or any registered indicator |
| `label`       | –          | Text shown in the legend (e.g. `"BTC · 1h"`)                        |
| `log`         | off        | Logarithmic price scale                                             |
| `auto`        | on         | Keep the right edge pinned to the latest bar while streaming        |
| `precision`   | auto       | Forced decimal places for prices (auto-detected from magnitude)    |
| `stats`       | off        | Live statistics chip for the visible range          |
| `profile`     | off        | Volume profile overlay (POC + 70% value area)       |
| `annotations` | off        | Smart annotations (volume spikes, gaps, pivots, RSI divergences) |
| `volshading`  | off        | Volatility-regime background shading (see below)    |
| `overlays`    | –          | JSON array of server-side zones & levels (see below) |

\* `indicators=""` disables everything, including volume. Token syntax:
`name[:param[/param…]][@color]` — e.g. `sma:20@#ff0000`, `macd:12/26/9`.

### Built-in indicators

| Name | Kind | Params | Notes |
|---|---|---|---|
| `sma` | overlay | `period` (20) | |
| `ema` | overlay | `period` (50) | |
| `bb` | overlay | `period`, `mult` (20, 2) | Bollinger bands (3 lines) |
| `rsi` | pane | `period` (14) | fixed 0–100 scale, 30/70 guides |
| `macd` | pane | `fast/slow/signal` (12/26/9) | 2 lines + histogram |
| `volume` | overlay | – | histogram at the bottom of the price pane |

### Custom indicators

Register your own — anything from a one-liner moving average to a multi-line
pane:

```js
WickChart.registerIndicator('vwap', {
  kind: 'overlay',               // or 'pane'
  params: { period: 20 },        // defaults; set via indicators="vwap:30"
  compute(bars, params) {        // bars: normalized {time,open,high,low,close,volume}
    const out = new Array(bars.length).fill(null);
    let pv = 0, vv = 0;
    for (let i = 0; i < bars.length; i++) {
      pv += bars[i].close * bars[i].volume;
      vv += bars[i].volume;
      out[i] = vv ? pv / vv : null;
    }
    return out;                  // single series — or { lines:[{name,values}], histogram }
  },
  // pane-only extras: guides:[30,70], range:[0,100], fmt:'price'|'fixed1'
});
chart.indicators = 'vwap:20';
```

`import WickChart from 'wickchart'` gives you the class for
`WickChart.registerIndicator(...)` (the element is registered as a side effect
of importing the package).

### WickScript — custom indicators as expressions

No build step, no JS: write an indicator inline in the attribute. `expr:{…}`
draws on the price chart; `pexpr:{…}` gets its own pane. Add an optional
`@color`, mix freely with named indicators, and it all round-trips through
shareable URLs.

```html
<wick-chart indicators="sma:20 expr:{(close - sma(close,20)) / sma(close,20) * 100}@ff6a00"></wick-chart>

<!-- oscillator in its own pane -->
<wick-chart indicators="pexpr:{rsi(close,14)} pexpr:{change(close) / close * 100}"></wick-chart>
```

| Series variables | |
|---|---|
| `open` `high` `low` `close` `volume` | raw bar fields |
| `hl2` `hlc3` `ohlc4` | classic derived prices |

| Functions | |
|---|---|
| `sma(x,n)` `ema(x,n)` `wma(x,n)` `stddev(x,n)` | moving stats (window `n` must be a whole number ≥ 1) |
| `rsi(x,n)` | RSI of any series |
| `hh(x,n)` `ll(x,n)` | rolling highest / lowest |
| `prev(x[,k])` `change(x)` | shifted series / bar-to-bar delta |
| `abs(x)` `sqrt(x)` `log(x)` `min(a,b)` `max(a,b)` | element-wise math |
| `crossup(a,b)` `crossdown(a,b)` | 1 on a strict cross, else 0 |

Operators are `+ - * / %` with usual precedence, unary `-`, and parentheses.
Values before a window fills are `NaN` (not drawn), division by zero yields
`NaN`, and identifiers are case-insensitive.

The expression is compiled by a hand-written tokenizer + recursive-descent
parser in `wickchart/core` — **no `eval`, no `new Function`** — with caps on
length (512), tokens (128) and nesting (24). Invalid scripts are reported via
the parse result's `unknown` list and simply not drawn; they can never execute
anything.

Programmatically, compile once and reuse, or register it under a name for the
attribute syntax:

```js
import { scriptIndicator } from 'wickchart/core';

WickChart.registerIndicator('spread', scriptIndicator('close - ema(close,21)'));
chart.indicators = 'spread';   // now usable like any built-in
```

The demo has a live input for it (type an expression, optionally tick *pane*,
press **+ Expr** — invalid expressions show the compiler's error inline).

### Volatility-regime shading

`<wick-chart volshading>` tints the price pane background by realized
volatility — the rolling stddev of log returns (20 bars by default),
classified against its own full-history percentiles: **calm** (≤ 30th
percentile, subtle blue), **normal** (untinted), **hot** (≥ 70th percentile,
subtle red). Market state at a glance: quiet ranges and violent expansions
read instantly, and the legend shows the hovered bar's regime and
percentile (`VOL 30/70 · hot · 94%ile`).

```html
<wick-chart volshading></wick-chart>                 <!-- defaults 30/70, 20 bars -->
<wick-chart volshading="20/85"></wick-chart>         <!-- custom cutoffs -->
<wick-chart volshading="20/85/50"></wick-chart>      <!-- + 50-bar vol window -->
```

Cutoffs are clamped so the low percentile always stays at least 2 points
below the high one; the toggle and custom cutoffs round-trip through
shareable URLs (`vsh=1` / `vsh=20/85`). A degenerate history (flat series)
classifies everything as normal. The pieces are exported from
`wickchart/core` (`calcRealizedVol`, `volRegimeBands`, `percentileOfSorted`)
if you want to build on them.

### Server-side overlays (zones & levels)

Draw analysis from your own API straight onto the chart: supply/demand
**zones** (time × price rectangles) and horizontal **levels**, rendered
behind the candles. Zones without a `to` extend into future space past the
last bar, like TradingView drawings.

```js
const res = await fetch('https://api.example.com/analysis?symbol=BTC');
chart.setOverlays(await res.json());
```

```js
[
  // zone: from/to are timestamps (ms or s); null → chart edge
  { type: 'zone', from: 1753920000000, priceFrom: 33000, priceTo: 35600,
    color: '#ef5350', alpha: 0.25, label: 'demand' },
  { type: 'zone', from: 1753920000000,                    // no `to` → extends
    priceFrom: 37700, priceTo: 40900, color: '#26a69a' }, // to the right edge
  // level: horizontal price line, full width by default
  { type: 'level', price: 28700, color: '#3f51b5', label: 'S1' },
  { type: 'level', price: 22800, color: '#3f51b5', dash: true },
]
```

- `addOverlay(o)` upserts one (by `id`), `removeOverlay(id)`,
  `clearOverlays()`, and `chart.overlays` reads them back.
- Colors accept hex / `rgb()` / CSS names plus the palette keys
  `up` | `down` | `accent`; `alpha` clamps to 0.02–0.8 (default 0.22).
- Timestamps snap to bars (before the first bar clamps left, after the last
  clamps right); invalid entries are dropped, never thrown — it's API data.
- Fully declarative, too — the same JSON as an attribute:

```html
<wick-chart overlays='[{"type":"level","price":28700,"color":"#3f51b5","label":"S1"}]'></wick-chart>
```

The React binding takes `overlays` as a prop (fresh array → re-apply), and
`normalizeOverlays` / `barIndexForTime` / `resolveOverlayColor` are exported
from `wickchart/core`.

### AI-ready data window — `getDataWindow()`

One call turns whatever is on screen into a compact, LLM-pasteable summary.
Everything is computed locally from the visible bars — trend (least-squares
drift + fit), realized-vol percentile, SMA/RSI snapshot, up/down bar mix,
volume profile notes, and the same pattern detection that powers smart
annotations (gaps, spikes, pivots, divergences). Nothing leaves the page
until you copy it somewhere.

```js
const s = chart.getDataWindow();
s.text;      // markdown — ready to paste into any AI chat
s.trend;     // { label: 'strong uptrend', slopePctPerBar: 0.77, r2: 0.94 }
s.volPctile; // 84 → hot regime relative to the window itself
s.patterns;  // [{ time, note }] — most recent first
```

`text` renders like:

```
CHART SUMMARY — BTC · 1h · 214 bars · 2026-08-21 → 2026-09-07
- Close 97.03 (−1.20% over window). High 104.20 on 2026-08-28, low 91.40 on 2026-09-01. Max drawdown 8.1%.
- Trend: downtrend (drift −0.061%/bar, fit r² 0.58). Price below SMA20 (99.10). RSI(14) 41.3.
- Volatility: annualized 48%; latest realized vol at the 84th percentile of the window (hot regime).
- Bars: 96 up / 117 down. Volume avg 1.2K/bar, peak 8.9K on 2026-09-01.
- Notable: Gapped down −1.42% (2026-09-01); Volume 4.1× average (2026-09-03).
```

The demo's **Explain** button shows this in a panel with a one-click copy.
The pure function behind it (`windowSummary(bars, i0, i1, opts)`) is exported
from `wickchart/core` for server-side use.

### Sonification — the chart by ear

`<wick-chart sonify>` maps price to pitch (180–880 Hz across the visible
scale, log-aware): moving the crosshair with the mouse or **arrow keys** plays
a short tone per bar, so trend and shape are audible — a rare accessibility
win for screen-reader users. `chart.playRange()` sweeps the whole visible
range as a ~4-second pitch sequence, riding the crosshair along for sighted
users. Audio starts lazily within the enabling user gesture (autoplay-policy
safe).

### Cross-tab co-view

Tag charts with the same channel and they share pointers — across browser
tabs, or between multiple charts on one page:

```html
<wick-chart co-view="btc-room"></wick-chart>
```

Hovering in one tab draws a ghost crosshair (accent, dotted, with the time
pill) in every peer. Positions are synced by bar **time**, so peers with
different history depths still line up. Ghosts fade ~2.5 s after the peer
stops moving. Same-origin only (BroadcastChannel); the connection follows the
`co-view` attribute and closes with the element.

### Smart annotations

`<wick-chart annotations>` marks notable events on the visible range — volume
spikes (>3× average), price gaps, 41-bar pivot highs/lows, and RSI
divergences — with lettered badges (V/G/H/L/D). Hover a badged bar and the
legend shows a one-line insight ("Volume 4.2× average", "Bearish RSI
divergence"). The current set is emitted on every recompute via the
`wick:annotations` event, so hosts can build their own UI from it. Badges are
hidden at extreme zoom-out, where bars collapse into columns.

### Example: VWAP via the registry

VWAP ships in the demo but *not* as a builtin — it's the reference for writing
your own (session-anchored, resets each trading day):

```js
import WickChart from 'wickchart';

WickChart.registerIndicator('vwap', {
  kind: 'overlay',
  params: {},
  compute(bars) {
    const out = new Array(bars.length).fill(null);
    let pv = 0, vv = 0, day = -1;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const d = new Date(b.time).setHours(0, 0, 0, 0);
      if (d !== day) { day = d; pv = 0; vv = 0; }
      const tp = (b.high + b.low + b.close) / 3;
      pv += tp * b.volume;
      vv += b.volume;
      out[i] = vv ? pv / vv : null;
    }
    return out;
  },
});
chart.indicators = 'vwap';
```

## Methods

| Method                          | Description                                      |
| ------------------------------- | ------------------------------------------------ |
| `setData(bars)`                 | Replace the dataset (sorted automatically)        |
| `update(bar)`                   | Stream: replaces last bar or appends a new one    |
| `clearData()`                   | Empty the chart                                   |
| `fit()`                         | Reset zoom to the default view (~150 bars)        |
| `getVisibleRange()`             | → `{ from, to }` (ms timestamps)                  |
| `setVisibleRange({from, to})`   | Jump to a time window                             |
| `exportPNG()`                   | → PNG data URL of the current canvas              |
| `getDataWindow()`               | → AI-ready summary of the visible window (see below) |
| `getState()`                    | → serializable snapshot (type, indicators, view, positions, alerts) |
| `setState(state)`               | Apply a snapshot; a pending view applies after the next `setData()` |

### Infinite history (`loadMore`)

Assign a callback and the chart fetches older bars whenever the user scrolls
toward the left edge — the view stays anchored while data is prepended:

```js
chart.onloadmore = async (fromTime) => {
  const res = await fetch(`/api/bars?before=${fromTime}&limit=500`);
  return res.json(); // [{ time, open, high, low, close, volume }, …]
};
```

Return an empty array (or throw) when history is exhausted and the chart stops
asking. Data gaps (weekends, session breaks) are marked with subtle dashed
dividers on the time axis.

### Positions & alerts

Visualize trades directly on the chart — entry/stop/target zones, a live P&L
chip, and price alerts that fire during streaming updates:

```js
chart.addPosition({ side: 'long', entry: 64200, stop: 62900, target: 66800, qty: 0.5 });
chart.addPosition({ id: 'x1', side: 'short', entry: 66000, qty: 1 });
chart.removePosition('x1');

chart.addAlert({ price: 65000, direction: 'above' }); // 'above' | 'below' | 'cross'
chart.addEventListener('wick:alert', (e) => {
  console.log('crossed!', e.detail.id, e.detail.price);
});

// scripted alerts — any WickScript predicate, fired on its false→true edge
chart.addAlert({ when: 'crossup(rsi(close,14), 30)' });
chart.addAlert({ when: 'volume > sma(volume,20) * 3', once: false }); // re-arms
```

The P&L chip recalculates on every streamed bar. Alerts are edge-triggered
(fire once per crossing) and one-shot by default (`once: false` to re-arm).
Scripted alerts are evaluated locally on every streamed bar — the event
carries the triggering close as `price` plus the `when` source; an invalid
predicate is rejected (`addAlert` returns `null`), never thrown.

### Stats & measure

`<wick-chart stats>` shows live statistics of the visible range — return %,
max drawdown, annualized volatility, up/down bar counts, average volume —
recalculated as you pan and zoom.

Hold **Shift and drag** across the chart to measure a move: an overlay shows
Δprice, Δ%, bar count and elapsed time, and a `wick:measure` event fires on
release (`detail.from` / `detail.to` carry index, time and price). Click or
press `Esc` to clear.

### Shareable URLs

`getState()` / `setState()` serialize everything about the chart, and
`encodeStateQuery` / `decodeStateQuery` (exported from `src/core.js`) turn a
state into a compact query string — the demo maps it to the page hash, so any
chart configuration is one link away:

```js
import { encodeStateQuery, decodeStateQuery } from 'wickchart/core';

const link = `${location.origin}#${encodeStateQuery(chart.getState())}`;
history.replaceState(null, '', link);
// later, on load:
chart.setState(decodeStateQuery(location.hash.slice(1)));
```

Reflected properties (`chart.type = 'line'`) work for `theme`, `type`, `label`,
`indicators`.

## Events

| Event           | Detail                                                     |
| --------------- | ---------------------------------------------------------- |
| `wick:crosshair` | `{ index, bar, x, y, price }` on hover / arrows, `null` on leave |
| `wick:range`     | `{ from, to }` after zoom / pan / jump                      |
| `wick:select`    | `{ index, bar, price }` on click/tap (e.g. open an order form at that price) |

## Theming

All colors are CSS custom properties settable on the element (they pierce the
Shadow DOM):

```css
wick-chart {
  --wick-bg: #0d1117;          /* transparent works too */
  --wick-up: #16c784;
  --wick-down: #ea3943;
  --wick-accent: #4c8dff;      /* line & area color */
  --wick-text: #8b949e;        /* axis text */
  --wick-text-strong: #e6edf3; /* legend values */
  --wick-grid: rgba(230,237,243,.05);
  --wick-border: rgba(230,237,243,.09);
  --wick-crosshair: rgba(230,237,243,.42);
  --wick-rsi: #a78bfa;
  --wick-overlay-0: #f0b429;   /* SMA color, …-1, -2, … for more overlays */
}
```

## Interactions

| Gesture                    | Action                              |
| -------------------------- | ----------------------------------- |
| Mouse wheel / trackpad ⌘+scroll | Zoom, anchored at the cursor    |
| Trackpad horizontal scroll | Pan                                 |
| Drag                       | Pan (auto-follow re-arms at the right edge) |
| Pinch (touch)              | Zoom                                |
| Double-click               | Reset view                          |
| `←` `→` (`+Shift` ×10)     | Move crosshair                      |
| `+` / `−`                  | Zoom in / out                       |
| `Home` / `End`             | Jump to oldest / newest             |
| `Esc`                      | Clear crosshair                     |

## Performance

Canvas 2D with a rAF-batched, visible-range-only render pipeline. Measured on a
desktop (Chromium, 1100×760, all indicators on: SMA + EMA + RSI + volume):

| Scenario                                  | Per full render |
| ----------------------------------------- | --------------- |
| 600–50,000 bars, default view (~150 visible) | **~0.2 ms**  |
| 5,000 bars, max zoom-out (~2,900 visible)  | ~6 ms           |
| 50,000 bars, max zoom-out (~3,100 visible) | ~16 ms          |
| Streaming tick (update + full re-render)   | 0.5–19 ms       |

A 60 fps frame budget is 16.7 ms, so the default view uses ~1% of a frame.
Hot paths are deliberately allocation-light: date labels are built lazily only
for actual axis ticks (with cached `Intl.DateTimeFormat`s), and candles/volume
are drawn in two batched passes by direction instead of one draw call per bar.

**Deep zoom-outs are columnar**: when more bars are visible than ~1.5× the
pixel width, bars aggregate into per-pixel min/max columns (first open / max
high / min low / last close / summed volume), so rendering any history at any
zoom costs O(screen width), not O(bars). The minimum zoom level adapts to the
dataset — every chart can be zoomed out until the entire history fits.

If you ever push past this (100k+ simultaneously visible bars, dozens of
series, high-frequency ticks), the scaling levers are: incremental indicator
updates (SMA/EMA/RSI are O(1) online), min/max columnar downsampling per pixel
column, and an offscreen layer so hover only repaints the crosshair.

## Architecture notes

- Single ES module, Custom Element + Shadow DOM, Canvas 2D with
  devicePixelRatio scaling and rAF-batched invalidation
- Only visible bars are drawn; indicator series are computed lazily and cached
  per data version (prefix-sum SMA, Wilder RSI)
- Time axis picks tick steps from bar interval (minutes → months) and labels
  day/month boundaries like a pro terminal
- No dependencies, no build step required — but it bundles/tree-shakes fine

## Roadmap ideas

- More overlays (Bollinger, VWAP), MACD pane, drawing tools
- Data callbacks (`loadMore` for infinite history)
- Incremental (O(1)) indicator updates for high-frequency streaming
- Min/max downsampling and/or an offscreen hover layer if profiling ever demands

## Migrating from 0.x (HabView)

1.0 renames the public surface to the WickChart brand. The 0.x names keep
working as **deprecated aliases** (removed in 2.0), so upgrading is safe to
do lazily:

| 0.x (deprecated alias) | 1.0 canonical |
|---|---|
| `<hab-chart>` / `<hab-feed>` | `<wick-chart>` / `<wick-feed>` |
| `hab:range`, `hab:select`, `hab:alert`, `hab:crosshair`, `hab:measure`, `hab:annotations` | `wick:*` of the same name (both fire during 1.x) |
| `hab-feed:status` / `hab-feed:fallback` | `wick-feed:status` / `wick-feed:fallback` (both fire during 1.x) |
| `--hab-bg`, `--hab-up`, … | `--wick-*` of the same name (`--wick-*` wins; `--hab-*` is the fallback) |
| `HabChart` / `HabFeed` classes | `WickChart` / `WickFeed` (also as named exports) |
| HabScript (the `expr:{…}` language) | WickScript — syntax unchanged |
| `import … from 'wickchart/src/hab-chart.js'` | use the package entry points (`wickchart`, `wickchart/core`, `wickchart/feed`) — module files are renamed |

Two behavioral notes: custom indicators registered via
`WickChart.registerIndicator()` are shared with the legacy `<hab-chart>`
alias (one registry), and cross-tab co-view channels are now prefixed
`wick-co-view:` (a 0.x tab and a 1.x tab won't pair — refresh both).

## License

MIT
