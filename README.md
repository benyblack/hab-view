# HabView

**`<hab-chart>` — a modern, simpler, more useful charting web component.**

A TradingView-style financial chart as a single framework-agnostic Web Component.
One file, zero dependencies, one HTML tag. Canvas-rendered, fast, themeable, and
streaming-ready.

## Install

```bash
npm install wickchart
```

```js
// any bundler / framework — TypeScript types included
import 'wickchart';                       // registers <hab-chart>
import HabChart from 'wickchart';         // for HabChart.registerIndicator(...)
import { encodeStateQuery } from 'wickchart/core';  // pure helpers
```

Or straight from a CDN — no install, no build:

```html
<script type="module" src="https://unpkg.com/wickchart"></script>

<hab-chart label="BTC · 1h" type="candles" indicators="sma:20 volume"></hab-chart>

<script type="module">
  const chart = document.querySelector('hab-chart');
  chart.setData(bars);   // [{ time, open, high, low, close, volume }]
  chart.update(bar);     // stream live updates
</script>
```

Works in plain HTML, React, Vue, Svelte, Angular — anywhere a `<div>` works.
TypeScript declarations ship inside the package (generated at pack time from
the JSDoc-annotated source — the repo itself stays 100% dependency-free JS).

## Declarative live charts with `<hab-feed>`

One more script tag and your chart is fully live — data, backfill, streaming —
with **zero JavaScript written**:

```html
<script type="module" src="https://unpkg.com/wickchart/feed"></script>

<hab-feed for="chart" binance="BTCUSDT" tf="1h"></hab-feed>
<hab-chart id="chart" indicators="sma:20 volume" profile></hab-chart>
```

| Attribute   | Meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `for`       | target `<hab-chart>` id (auto-pairs with the first chart when omitted)   |
| `binance`   | Binance symbol (`BTCUSDT`) — REST load + WebSocket live + backfill       |
| `demo`      | deterministic offline synthetic feed (`demo="ETH"` picks a base price)   |
| `url`       | generic REST endpoint returning a JSON array of bars (+ `poll="10"` sec) |
| `tf`        | timeframe: `1m 3m 5m 15m 30m 1h 2h 4h 6h 12h 1d 3d 1w`                  |
| `limit`     | initial bars (default 500)                                               |
| `live`      | `live="false"` loads history without streaming                           |

The element reflects its state in the `status` attribute (`loading`, `live`,
`polling`, `fallback`, `loaded`, `waiting`, `idle`) and emits
`hab-feed:status` / `hab-feed:fallback` events. When Binance is unreachable
(geo-blocked, offline), it degrades gracefully: WebSocket → REST polling → a
synthetic stream bridged from the last real price, so the chart never goes
blank. It also wires `chart.onloadmore` for infinite backfill automatically.

---

## Why another chart library?

TradingView's charting library is powerful but heavy and enterprise-licensed;
most wrappers add build steps and framework lock-in. HabView takes the opposite
bet:

- **Zero dependencies, single file** (~40 KB unminified, no build step required)
- **One tag, sane defaults** — drop it in and it renders; everything optional
- **Built-in usefulness** — crosshair + OHLC legend, last-price line, wheel zoom,
  drag pan, pinch, keyboard navigation, live streaming, PNG export
- **Themeable with CSS variables** — two built-in themes, full control from
  outside the component (Shadow DOM friendly)
- **Accessible** — focusable, arrow-key crosshair, ARIA summary of the data

## Run the demo

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
HabChart.registerIndicator('vwap', {
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

`import HabChart from 'wickchart'` gives you the class for
`HabChart.registerIndicator(...)` (the element is registered as a side effect
of importing the package).

### HabScript — custom indicators as expressions

No build step, no JS: write an indicator inline in the attribute. `expr:{…}`
draws on the price chart; `pexpr:{…}` gets its own pane. Add an optional
`@color`, mix freely with named indicators, and it all round-trips through
shareable URLs.

```html
<hab-chart indicators="sma:20 expr:{(close - sma(close,20)) / sma(close,20) * 100}@ff6a00"></hab-chart>

<!-- oscillator in its own pane -->
<hab-chart indicators="pexpr:{rsi(close,14)} pexpr:{change(close) / close * 100}"></hab-chart>
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

HabChart.registerIndicator('spread', scriptIndicator('close - ema(close,21)'));
chart.indicators = 'spread';   // now usable like any built-in
```

The demo has a live input for it (type an expression, optionally tick *pane*,
press **+ Expr** — invalid expressions show the compiler's error inline).

### Volatility-regime shading

`<hab-chart volshading>` tints the price pane background by realized
volatility — the rolling stddev of log returns (20 bars by default),
classified against its own full-history percentiles: **calm** (≤ 30th
percentile, subtle blue), **normal** (untinted), **hot** (≥ 70th percentile,
subtle red). Market state at a glance: quiet ranges and violent expansions
read instantly, and the legend shows the hovered bar's regime and
percentile (`VOL 30/70 · hot · 94%ile`).

```html
<hab-chart volshading></hab-chart>                 <!-- defaults 30/70, 20 bars -->
<hab-chart volshading="20/85"></hab-chart>         <!-- custom cutoffs -->
<hab-chart volshading="20/85/50"></hab-chart>      <!-- + 50-bar vol window -->
```

Cutoffs are clamped so the low percentile always stays at least 2 points
below the high one; the toggle and custom cutoffs round-trip through
shareable URLs (`vsh=1` / `vsh=20/85`). A degenerate history (flat series)
classifies everything as normal. The pieces are exported from
`wickchart/core` (`calcRealizedVol`, `volRegimeBands`, `percentileOfSorted`)
if you want to build on them.

### Sonification — the chart by ear

`<hab-chart sonify>` maps price to pitch (180–880 Hz across the visible
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
<hab-chart co-view="btc-room"></hab-chart>
```

Hovering in one tab draws a ghost crosshair (accent, dotted, with the time
pill) in every peer. Positions are synced by bar **time**, so peers with
different history depths still line up. Ghosts fade ~2.5 s after the peer
stops moving. Same-origin only (BroadcastChannel); the connection follows the
`co-view` attribute and closes with the element.

### Smart annotations

`<hab-chart annotations>` marks notable events on the visible range — volume
spikes (>3× average), price gaps, 41-bar pivot highs/lows, and RSI
divergences — with lettered badges (V/G/H/L/D). Hover a badged bar and the
legend shows a one-line insight ("Volume 4.2× average", "Bearish RSI
divergence"). The current set is emitted on every recompute via the
`hab:annotations` event, so hosts can build their own UI from it. Badges are
hidden at extreme zoom-out, where bars collapse into columns.

### Example: VWAP via the registry

VWAP ships in the demo but *not* as a builtin — it's the reference for writing
your own (session-anchored, resets each trading day):

```js
import HabChart from 'wickchart';

HabChart.registerIndicator('vwap', {
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
chart.addEventListener('hab:alert', (e) => {
  console.log('crossed!', e.detail.id, e.detail.price);
});
```

The P&L chip recalculates on every streamed bar. Alerts are edge-triggered
(fire once per crossing) and one-shot by default (`once: false` to re-arm).

### Stats & measure

`<hab-chart stats>` shows live statistics of the visible range — return %,
max drawdown, annualized volatility, up/down bar counts, average volume —
recalculated as you pan and zoom.

Hold **Shift and drag** across the chart to measure a move: an overlay shows
Δprice, Δ%, bar count and elapsed time, and a `hab:measure` event fires on
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
| `hab:crosshair` | `{ index, bar, x, y, price }` on hover / arrows, `null` on leave |
| `hab:range`     | `{ from, to }` after zoom / pan / jump                      |
| `hab:select`    | `{ index, bar, price }` on click/tap (e.g. open an order form at that price) |

## Theming

All colors are CSS custom properties settable on the element (they pierce the
Shadow DOM):

```css
hab-chart {
  --hab-bg: #0d1117;          /* transparent works too */
  --hab-up: #16c784;
  --hab-down: #ea3943;
  --hab-accent: #4c8dff;      /* line & area color */
  --hab-text: #8b949e;        /* axis text */
  --hab-text-strong: #e6edf3; /* legend values */
  --hab-grid: rgba(230,237,243,.05);
  --hab-border: rgba(230,237,243,.09);
  --hab-crosshair: rgba(230,237,243,.42);
  --hab-rsi: #a78bfa;
  --hab-overlay-0: #f0b429;   /* SMA color, …-1, -2, … for more overlays */
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

## License

MIT
