# HabView

**`<hab-chart>` — a modern, simpler, more useful charting web component.**

A TradingView-style financial chart as a single framework-agnostic Web Component.
One file, zero dependencies, one HTML tag. Canvas-rendered, fast, themeable, and
streaming-ready.

```html
<script type="module" src="https://unpkg.com/hab-view/src/hab-chart.js"></script>

<hab-chart label="BTC · 1h" type="candles" indicators="sma:20 volume"></hab-chart>

<script type="module">
  const chart = document.querySelector('hab-chart');
  chart.setData(bars);   // [{ time, open, high, low, close, volume }]
  chart.update(bar);     // stream live updates
</script>
```

Works in plain HTML, React, Vue, Svelte, Angular — anywhere a `<div>` works.

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
| `type`        | `candles`  | `candles`, `line`, or `area`                                        |
| `indicators`  | `volume`*  | Space/comma-separated: `sma:20`, `ema:50`, `rsi:14`, `volume`      |
| `label`       | –          | Text shown in the legend (e.g. `"BTC · 1h"`)                        |
| `log`         | off        | Logarithmic price scale                                             |
| `auto`        | on         | Keep the right edge pinned to the latest bar while streaming        |
| `precision`   | auto       | Forced decimal places for prices (auto-detected from magnitude)    |

\* `indicators=""` disables everything, including volume.

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
