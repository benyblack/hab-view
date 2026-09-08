# wickchart-draw

Drawing tools for [wickchart](https://github.com/benyblack/wickchart), as an
opt-in plugin layer — the core stays drawing-free. Zero dependencies.

Tools: **trendline / ray / infinite line**, **horizontal level**, **rectangle**,
**fibonacci retracement** (0–1 grid), **text note**. Drawings are plain
`{ time, price }` data: they ride zoom & pan, survive data reloads, and
serialize to JSON. Anchors magnet-snap to bar times and OHLC prices.

```js
import 'wickchart';                       // the chart itself
import { attachDrawings } from 'wickchart-draw';

const chart = document.querySelector('wick-chart');
const draw = attachDrawings(chart);

draw.setTool('trendline');  // arm a tool — dragging draws instead of panning
draw.setTool(null);         // select mode: click a drawing to select it,
                            // drag to move, drag handles to re-anchor
draw.undo();
draw.getDrawings();         // → JSON-serializable array (save it!)
draw.setDrawings(saved);
draw.deleteSelected();
draw.clear();
draw.detach();
```

Events on the chart element:

- `wick:drawings` — `{ detail: { drawings, action } }` after every change
  (`add | move | edit | delete | clear | set | undo`)
- `wick:drawselect` — `{ detail: { id } }` when the selection changes

Options: `attachDrawings(chart, { magnet: true, color: '#4c8dff', width: 1.5, drawings: [...] })`.
Delete/Backspace removes the selected drawing (ignored while typing in inputs).

Requires wickchart ≥ 1.4.0 (the plugin layer API). Full docs and a live
playground: the **Drawings** section of the wickchart documentation.
