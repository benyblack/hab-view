// Bundle-size budget — keeps "zero-dependency and small" an enforced invariant
// instead of an intention. Covers the main entry only (core.js + wick-chart.js):
// feeds/react entries are separate opt-in imports with their own profile.
//
// If this fails because of an intentional addition, raise BUDGET_GZ in its own
// commit and say why in the message — the diff IS the budget conversation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// 64→68 KB: the indicators batch (vwap/atr/stoch/obv/supertrend/donchian/
// keltner/cci/wr) landed at 64.3 KB gz — still zero-dependency, still small.
const BUDGET_GZ = 68 * 1024; // 68 KB gzipped for the whole main entry
const FILES = ['src/core.js', 'src/wick-chart.js'];

// the drawing toolkit is opt-in bytes; it earns its own, smaller budget
const DRAW_BUDGET_GZ = 12 * 1024;
const DRAW_FILES = ['plugins/draw/core.mjs', 'plugins/draw/draw.mjs'];

// session shading is even smaller opt-in bytes (its own budget, same rule):
// landed at 6.3 KB gz — timezone math (DST-exact presets), bands, labels and
// the crosshair hover bridge included.
const SESSIONS_BUDGET_GZ = 7 * 1024;
const SESSIONS_FILES = ['plugins/sessions/core.mjs', 'plugins/sessions/sessions.mjs'];

// bar replay is a single-file plugin (state machine + badge layer), same rule
const REPLAY_BUDGET_GZ = 5 * 1024;
const REPLAY_FILES = ['plugins/replay/replay.mjs'];

// compare overlays: normalization + alignment math + the drawing layer
const COMPARE_BUDGET_GZ = 6 * 1024;
const COMPARE_FILES = ['plugins/compare/core.mjs', 'plugins/compare/compare.mjs'];

// navigator: profile downsampling + window drag math + the docked layer
const NAVIGATOR_BUDGET_GZ = 5 * 1024;
const NAVIGATOR_FILES = ['plugins/navigator/core.mjs', 'plugins/navigator/navigator.mjs'];

// alerts-plus: persistence + notification/webhook side channels, single file
const ALERTS_PLUS_BUDGET_GZ = 4 * 1024;
const ALERTS_PLUS_FILES = ['plugins/alerts-plus/alerts-plus.mjs'];

// layouts: named workspace persistence, single file
const LAYOUTS_BUDGET_GZ = 4 * 1024;
const LAYOUTS_FILES = ['plugins/layouts/layouts.mjs'];

// signals: pattern math + the badge layer
const SIGNALS_BUDGET_GZ = 5 * 1024;
const SIGNALS_FILES = ['plugins/signals/core.mjs', 'plugins/signals/signals.mjs'];

// tape: print normalization + tick rule + trades→bars + the docked strip
// (landed at 4.6 KB gz — display-only layer, no pointer machinery)
const TAPE_BUDGET_GZ = 6 * 1024;
const TAPE_FILES = ['plugins/tape/core.mjs', 'plugins/tape/tape.mjs'];

const gz = (f) => gzipSync(readFileSync(f)).length;

test('main entry stays under the gzip budget', () => {
  let total = 0;
  const parts = [];
  for (const f of FILES) {
    const n = gz(f);
    total += n;
    parts.push(`${f}: ${(n / 1024).toFixed(1)} KB gz`);
  }
  assert.ok(
    total <= BUDGET_GZ,
    `main entry is ${(total / 1024).toFixed(1)} KB gz, budget is ${BUDGET_GZ / 1024} KB\n  ${parts.join('\n  ')}\n` +
      'If this growth is intentional, raise BUDGET_GZ in tests/size-budget.test.mjs in a dedicated commit explaining why.'
  );
});

test('wickchart-draw plugin stays under its (smaller) gzip budget', () => {
  let total = 0;
  const parts = [];
  for (const f of DRAW_FILES) {
    const n = gz(f);
    total += n;
    parts.push(`${f}: ${(n / 1024).toFixed(1)} KB gz`);
  }
  assert.ok(
    total <= DRAW_BUDGET_GZ,
    `wickchart-draw is ${(total / 1024).toFixed(1)} KB gz, budget is ${DRAW_BUDGET_GZ / 1024} KB\n  ${parts.join('\n  ')}`
  );
});

test('wickchart-sessions plugin stays under its (smaller) gzip budget', () => {
  let total = 0;
  const parts = [];
  for (const f of SESSIONS_FILES) {
    const n = gz(f);
    total += n;
    parts.push(`${f}: ${(n / 1024).toFixed(1)} KB gz`);
  }
  assert.ok(
    total <= SESSIONS_BUDGET_GZ,
    `wickchart-sessions is ${(total / 1024).toFixed(1)} KB gz, budget is ${SESSIONS_BUDGET_GZ / 1024} KB\n  ${parts.join('\n  ')}`
  );
});

test('wickchart-replay plugin stays under its (smaller) gzip budget', () => {
  let total = 0;
  const parts = [];
  for (const f of REPLAY_FILES) {
    const n = gz(f);
    total += n;
    parts.push(`${f}: ${(n / 1024).toFixed(1)} KB gz`);
  }
  assert.ok(
    total <= REPLAY_BUDGET_GZ,
    `wickchart-replay is ${(total / 1024).toFixed(1)} KB gz, budget is ${REPLAY_BUDGET_GZ / 1024} KB\n  ${parts.join('\n  ')}`
  );
});

test('wickchart-compare plugin stays under its (smaller) gzip budget', () => {
  let total = 0;
  const parts = [];
  for (const f of COMPARE_FILES) {
    const n = gz(f);
    total += n;
    parts.push(`${f}: ${(n / 1024).toFixed(1)} KB gz`);
  }
  assert.ok(
    total <= COMPARE_BUDGET_GZ,
    `wickchart-compare is ${(total / 1024).toFixed(1)} KB gz, budget is ${COMPARE_BUDGET_GZ / 1024} KB\n  ${parts.join('\n  ')}`
  );
});

test('wickchart-navigator plugin stays under its (smaller) gzip budget', () => {
  let total = 0;
  const parts = [];
  for (const f of NAVIGATOR_FILES) {
    const n = gz(f);
    total += n;
    parts.push(`${f}: ${(n / 1024).toFixed(1)} KB gz`);
  }
  assert.ok(
    total <= NAVIGATOR_BUDGET_GZ,
    `wickchart-navigator is ${(total / 1024).toFixed(1)} KB gz, budget is ${NAVIGATOR_BUDGET_GZ / 1024} KB\n  ${parts.join('\n  ')}`
  );
});

test('wickchart-alerts-plus plugin stays under its (smaller) gzip budget', () => {
  let total = 0;
  const parts = [];
  for (const f of ALERTS_PLUS_FILES) {
    const n = gz(f);
    total += n;
    parts.push(`${f}: ${(n / 1024).toFixed(1)} KB gz`);
  }
  assert.ok(
    total <= ALERTS_PLUS_BUDGET_GZ,
    `wickchart-alerts-plus is ${(total / 1024).toFixed(1)} KB gz, budget is ${ALERTS_PLUS_BUDGET_GZ / 1024} KB\n  ${parts.join('\n  ')}`
  );
});

test('wickchart-layouts plugin stays under its (smaller) gzip budget', () => {
  let total = 0;
  const parts = [];
  for (const f of LAYOUTS_FILES) {
    const n = gz(f);
    total += n;
    parts.push(`${f}: ${(n / 1024).toFixed(1)} KB gz`);
  }
  assert.ok(
    total <= LAYOUTS_BUDGET_GZ,
    `wickchart-layouts is ${(total / 1024).toFixed(1)} KB gz, budget is ${LAYOUTS_BUDGET_GZ / 1024} KB\n  ${parts.join('\n  ')}`
  );
});

test('wickchart-signals plugin stays under its (smaller) gzip budget', () => {
  let total = 0;
  const parts = [];
  for (const f of SIGNALS_FILES) {
    const n = gz(f);
    total += n;
    parts.push(`${f}: ${(n / 1024).toFixed(1)} KB gz`);
  }
  assert.ok(
    total <= SIGNALS_BUDGET_GZ,
    `wickchart-signals is ${(total / 1024).toFixed(1)} KB gz, budget is ${SIGNALS_BUDGET_GZ / 1024} KB\n  ${parts.join('\n  ')}`
  );
});

test('wickchart-tape plugin stays under its (smaller) gzip budget', () => {
  let total = 0;
  const parts = [];
  for (const f of TAPE_FILES) {
    const n = gz(f);
    total += n;
    parts.push(`${f}: ${(n / 1024).toFixed(1)} KB gz`);
  }
  assert.ok(
    total <= TAPE_BUDGET_GZ,
    `wickchart-tape is ${(total / 1024).toFixed(1)} KB gz, budget is ${TAPE_BUDGET_GZ / 1024} KB\n  ${parts.join('\n  ')}`
  );
});
