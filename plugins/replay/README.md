# wickchart-replay

[![npm](https://img.shields.io/npm/v/wickchart-replay)](https://www.npmjs.com/package/wickchart-replay)

Bar replay for [wickchart](https://github.com/benyblack/wickchart), as an
opt-in plugin — the core stays replay-free. Zero dependencies, zero core
changes: the whole engine runs on the public data API (`setData` + `update`).

Play history forward bar-by-bar or at speed while the future stays hidden.
A badge layer shows the mode and position at a glance.

```js
npm install wickchart wickchart-replay   // the plugin is a separate package

import 'wickchart';                        // the chart itself
import { attachReplay } from 'wickchart-replay';

const chart = document.querySelector('wick-chart');
const replay = attachReplay(chart);

replay.start();                 // head defaults to ~70% of the data
replay.start(1772604000000);    // …or a time (ms, seconds, or a date string)
replay.start(42);               // …or a bar index (integer < data length)
replay.step();                  // reveal one bar (step(5) reveals five)
replay.play();                  // 4 bars/sec (default), pause at the end
replay.play(15);                // faster; setSpeed(v) works while playing
replay.pause();
replay.seek('2026-03-06');      // jump the head — also activates when idle
replay.setLoop(true);           // wrap to the anchor instead of pausing
replay.stop();                  // exit — the full dataset is restored
replay.detach();                // …and stop() + remove the layer

// progress readout
chart.addEventListener('wick:replay', (e) => {
  const d = e.detail;
  status.textContent = d.active ? `${d.index + 1}/${d.total}` : '';
});
```

- **Anchors**: `start`/`seek` accept a bar index (integer < data length), a
  timestamp (ms or seconds — anything ≥ 1e9), or a date string; `null`
  defaults to ~70% of the data; unresolvable values fall back to the default.
- **State**: `active`, `playing`, `loop`, `index`, `total`, `time`, `speed`
  getters; every change fires `wick:replay` with the full snapshot.
- **Loop**: `setLoop(true)` wraps back to the anchor at the end of the data
  instead of pausing.
- **Live feeds**: pause them while replaying. An external `update()` or
  `setData()` during replay means the data moved under the plugin — replay
  aborts (without restoring) rather than corrupting the chart. The wickchart
  demo stops its feed automatically when you press Replay.
- Paper trading and an equity curve are the planned 0.2 follow-up; the
  replay engine (this package) is intentionally data-only.

Peer dependency: wickchart ≥ 1.4.0.
