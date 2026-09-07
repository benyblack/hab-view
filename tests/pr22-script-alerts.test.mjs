// PR #22 — scripted alerts: WickScript predicates via addAlert({ when }).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const mkBars = (closes, volumes) =>
  closes.map((c, i) => ({
    time: 1_700_000_000_000 + i * 3600e3,
    open: c, high: c * 1.01, low: c * 0.99, close: c,
    volume: volumes ? volumes[i] : 100,
  }));

/* ------------------------- predicateTrueSeries ------------------------- */

test('predicateTrueSeries maps a comparison expression to booleans', async () => {
  const { predicateTrueSeries } = await import('../src/core.js');
  const bars = mkBars([10, 10, 10, 10, 10], [100, 100, 100, 500, 100]);
  const t = predicateTrueSeries('volume > sma(volume,3) * 2', bars);
  // only bar 3 (volume 500 vs sma(100,100,500)≈233 ×2 = 466) is true
  assert.equal(t.filter(Boolean).length, 1);
  assert.equal(t[3], true);
});

test('predicateTrueSeries treats NaN (warm-up) and zero as false', async () => {
  const { predicateTrueSeries } = await import('../src/core.js');
  const bars = mkBars([5, 5, 5, 5, 5]);
  const t = predicateTrueSeries('sma(close,3) > 0', bars); // first 2 values are NaN
  assert.equal(t[0], false);
  assert.equal(t[1], false);
  assert.equal(t[2], true);
  const z = predicateTrueSeries('close - close', bars); // identically zero → false
  assert.ok(z.every((v) => v === false));
});

test('predicateTrueSeries works with crossup()', async () => {
  const { predicateTrueSeries } = await import('../src/core.js');
  // price crosses above a high SMA at the end
  const bars = mkBars([100, 100, 100, 100, 90, 90, 90, 90, 130]);
  const t = predicateTrueSeries('crossup(close, 100)', bars);
  assert.equal(t[8], true, 'final bar crosses above 100');
  assert.ok(!t.slice(0, 8).includes(true));
});

/* ------------------------- scriptAlertStep ------------------------- */

test('scriptAlertStep fires once per rising edge and re-arms on falling', async () => {
  const { scriptAlertStep } = await import('../src/core.js');
  let st = { fire: false, armed: true }; // armed start
  const seq = [false, true, true, true, false, false, true, false, true];
  const fires = [];
  for (const cur of seq) {
    st = scriptAlertStep(st.armed, cur);
    fires.push(st.fire);
  }
  // edges: rises at index 1 (fire), falls at 4 (re-arm), rises at 6 (fire), falls 7, rises 8 (fire)
  assert.deepEqual(fires, [false, true, false, false, false, false, true, false, true]);
});

test('scriptAlertStep holds through constant-true stretches', async () => {
  const { scriptAlertStep } = await import('../src/core.js');
  let st = { fire: false, armed: true };
  st = scriptAlertStep(st.armed, true);
  assert.equal(st.fire, true, 'first true fires');
  for (let i = 0; i < 5; i++) {
    st = scriptAlertStep(st.armed, true);
    assert.equal(st.fire, false, 'no refire while still true');
  }
});

/* ------------------------- WickScript comparisons ------------------------- */

test('WickScript comparison operators yield 1/0 with correct precedence', async () => {
  const { evalScript } = await import('../src/core.js');
  const bars = mkBars([10, 12, 9, 20, 8]);
  const t = evalScript('close > 10', bars);
  assert.deepEqual(t, [0, 1, 0, 1, 0]);
  // arithmetic binds tighter: (close - 9) > 1
  const p = evalScript('close - 9 > 1', bars);
  assert.deepEqual(p, [0, 1, 0, 1, 0]);
});

test('WickScript: >=, <=, ==, != and two-char tokenization', async () => {
  const { evalScript } = await import('../src/core.js');
  const bars = mkBars([10, 12, 9, 10, 8]);
  assert.deepEqual(evalScript('close >= 10', bars), [1, 1, 0, 1, 0]);
  assert.deepEqual(evalScript('close <= 9', bars), [0, 0, 1, 0, 1]);
  assert.deepEqual(evalScript('close == 10', bars), [1, 0, 0, 1, 0]);
  assert.deepEqual(evalScript('close != 10', bars), [0, 1, 1, 0, 1]);
});

test('WickScript comparisons propagate NaN as gaps (warm-up) and work in parens/args', async () => {
  const { evalScript, compileScript } = await import('../src/core.js');
  const bars = mkBars([5, 5, 5, 5, 5]);
  const t = evalScript('sma(close,3) > 1', bars);
  assert.ok(Number.isNaN(t[0]) && Number.isNaN(t[1]), 'warm-up stays NaN (gap, not 0)');
  assert.equal(t[2], 1);
  // inside parens
  const par = evalScript('(close > 1) * 100', bars);
  assert.deepEqual(par, [100, 100, 100, 100, 100]);
  // a stray "=" is still invalid
  assert.throws(() => compileScript('close = 5'), /unexpected character/);
  assert.throws(() => compileScript('close ! 5'), /unexpected character/);
});

/* ------------------------- component contract ------------------------- */

test('addAlert compiles `when` predicates and rejects invalid ones', async () => {
  const src = read('src/wick-chart.js');
  assert.match(src, /compileScript\(alert\.when\)/, 'when predicates are compiled (no eval)');
  assert.match(src, /predicateTrueSeries\(alert\.compiled/, 'evaluation goes through the truth series');
  assert.match(src, /scriptAlertStep\(a\.armed/, 'edge state machine drives firing');
  assert.match(src, /price: bar\.close, when: a\.when/, 'scripted events carry a price + the source');
  assert.match(src, /a\.fired \|\| !isNum\(a\.price\)/, 'scripted alerts draw no price line');
  // once:false re-fires: the armed flag must reset (re-arm) and not be removed
  assert.match(src, /a\.armed = step\.armed/);
});

test('scripted alerts round-trip through getState/setState as plain objects', async () => {
  const src = read('src/wick-chart.js');
  assert.match(src, /a\.when != null\s*\?\s*\{ id: a\.id, when: a\.when, once: a\.once \}/, 'getState serializes the when source (never the AST)');
  assert.match(src, /isNum\(a\.price\) \|\| typeof a\.when === 'string'/, 'setState accepts both alert kinds');
  assert.match(src, /compiled: compileScript\(a\.when\)/, 'setState recompiles on restore');
});
