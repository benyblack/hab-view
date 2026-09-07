import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcSMA,
  calcWMA,
  compileScript,
  evalScript,
  scriptIndicator,
  splitIndicatorTokens,
  parseIndicators,
  encodeStateQuery,
  decodeStateQuery,
  normalizeIndicatorResult,
  BUILTIN_INDICATORS,
} from '../src/core.js';

const bars = Array.from({ length: 30 }, (_, i) => {
  const close = 100 + Math.sin(i / 3) * 10 + i;
  return {
    time: 1700000000 + i * 3600,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1000 + (i % 5) * 100,
  };
});
const n = bars.length;

/* ---------------- splitIndicatorTokens ---------------- */

test('splitIndicatorTokens keeps expr blobs atomic', () => {
  assert.deepEqual(splitIndicatorTokens('sma:20 expr:{close - sma(close,20)}'), [
    'sma:20',
    'expr:{close - sma(close,20)}',
  ]);
  assert.deepEqual(splitIndicatorTokens('expr:{a,b(1,2)}@red,sma:20;pexpr:{x y}'), [
    'expr:{a,b(1,2)}@red',
    'sma:20',
    'pexpr:{x y}',
  ]);
  assert.deepEqual(splitIndicatorTokens('  volume  '), ['volume']);
  assert.deepEqual(splitIndicatorTokens(''), []);
});

test('splitIndicatorTokens handles unterminated expr without throwing', () => {
  const t = splitIndicatorTokens('sma:20 expr:{oops');
  assert.equal(t.length, 2);
  assert.equal(t[1], 'expr:{oops');
});

/* ---------------- compile: errors ---------------- */

test('compileScript rejects syntax errors with messages', () => {
  const cases = [
    ['close +', 'unexpected end'],
    ['foo', 'unknown identifier'],
    ['sma(close)', 'takes 2 arguments'],
    ['sma(close, 20+1)', 'whole number'],
    ['sma(close, 0)', 'whole number'],
    ['nosuch(close)', 'unknown function'],
    ['close)', 'trailing'],
    ['1 2', 'trailing'],
    ['close $ 1', 'unexpected character'],
    ['', 'empty'],
    ['(((close)', 'missing ")"'],
    ['('.repeat(60) + 'close' + ')'.repeat(60), 'too deeply nested'],
    ['close+' + '1+'.repeat(64) + '1', 'tokens'],
  ];
  for (const [src, want] of cases) {
    assert.throws(() => compileScript(src), /script:/, `should throw for ${JSON.stringify(src)}`);
    assert.throws(
      () => compileScript(src),
      new RegExp(want.replace(/[()"]/g, (c) => '\\' + c)),
      `message should match "${want}" for ${JSON.stringify(src)}`
    );
  }
});

test('compileScript caps expression length', () => {
  assert.throws(() => compileScript('close + ' + '1'.repeat(600)), /script:/);
});

/* ---------------- eval: arithmetic ---------------- */

test('evalScript evaluates variables and operators element-wise', () => {
  const spread = evalScript('close - open', bars);
  assert.equal(spread.length, n);
  for (let i = 0; i < n; i++) assert.equal(spread[i], bars[i].close - bars[i].open);

  const amp = evalScript('(high - low) * 2 + 1', bars);
  assert.equal(amp[5], (bars[5].high - bars[5].low) * 2 + 1);
});

test('evalScript applies operator precedence and unary minus', () => {
  const v = evalScript('1 + 2 * 3', bars);
  assert.equal(v[0], 7);
  const m = evalScript('-close + 0', bars);
  assert.equal(m[7], -bars[7].close);
  const p = evalScript('(1 + 2) * 3', bars);
  assert.equal(p[0], 9);
  const mod = evalScript('7 % 4', bars);
  assert.equal(mod[0], 3);
});

test('evalScript supports derived series variables', () => {
  const hl2 = evalScript('hl2', bars);
  assert.equal(hl2[4], (bars[4].high + bars[4].low) / 2);
  const ohlc4 = evalScript('ohlc4', bars);
  assert.equal(ohlc4[4], (bars[4].open + bars[4].high + bars[4].low + bars[4].close) / 4);
});

/* ---------------- eval: functions ---------------- */

test('script sma/ema/stddev/rsi match the core calc helpers', () => {
  const closes = bars.map((b) => b.close);
  assert.deepEqual(evalScript('sma(close, 5)', bars), calcSMA(closes, 5).map((x) => (x == null ? NaN : x)));
  // leading nulls come back as NaN
  assert.ok(Number.isNaN(evalScript('sma(close, 5)', bars)[3]));
  assert.ok(!Number.isNaN(evalScript('sma(close, 5)', bars)[4]));
  const sd = evalScript('stddev(close, 5)', bars);
  const rsi = evalScript('rsi(close, 14)', bars);
  assert.equal(sd.length, n);
  assert.ok(rsi[20] > 0 && rsi[20] < 100);
});

test('wma weights the most recent bar highest', () => {
  assert.equal(calcWMA([1, 2, 3], 3)[2], 14 / 6);
  assert.equal(calcWMA([1, 2, 3], 3)[0], null);
  const v = evalScript('wma(close, 4)', bars);
  assert.ok(Number.isNaN(v[2]));
  assert.ok(!Number.isNaN(v[3]));
});

test('prev/change shift series and NaN the head', () => {
  const ch = evalScript('change(close)', bars);
  assert.ok(Number.isNaN(ch[0]));
  assert.equal(ch[9], bars[9].close - bars[8].close);
  const p2 = evalScript('prev(close, 2)', bars);
  assert.ok(Number.isNaN(p2[1]));
  assert.equal(p2[5], bars[3].close);
});

test('hh/ll compute rolling extremes with full windows only', () => {
  const hh = evalScript('hh(close, 5)', bars);
  const ll = evalScript('ll(low, 5)', bars);
  assert.ok(Number.isNaN(hh[3]));
  let want = -Infinity;
  for (let i = 0; i < 5; i++) want = Math.max(want, bars[i].close);
  assert.equal(hh[4], want);
  let wlow = Infinity;
  for (let i = 2; i < 7; i++) wlow = Math.min(wlow, bars[i].low);
  assert.equal(ll[6], wlow);
});

test('min/max/abs/sqrt/log apply element-wise with NaN safety', () => {
  const mx = evalScript('max(close, 105)', bars);
  for (let i = 0; i < n; i++) assert.equal(mx[i], Math.max(bars[i].close, 105));
  assert.ok(Number.isNaN(evalScript('sqrt(close - 10000)', bars)[0]) || evalScript('sqrt(close - 10000)', bars)[0] > 0);
  assert.ok(Number.isNaN(evalScript('sqrt(0 - 4)', bars)[0])); // sqrt(-4) → NaN
  assert.ok(Number.isNaN(evalScript('log(0)', bars)[0])); // log(0) → NaN, not -Infinity
  assert.ok(Number.isNaN(evalScript('log(close - 10000)', bars)[0]));
});

test('crossup/crossdown detect strict crossings', () => {
  const crossBars = [
    { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    { time: 2, open: 1, high: 1, low: 1, close: 2, volume: 1 },
    { time: 3, open: 1, high: 1, low: 1, close: 0.5, volume: 1 },
    { time: 4, open: 1, high: 1, low: 1, close: 0.9, volume: 1 },
    { time: 5, open: 1, high: 1, low: 1, close: 1, volume: 1 },
  ];
  const up = evalScript('crossup(close, 1)', crossBars);
  assert.deepEqual(up, [0, 1, 0, 0, 0]);
  const down = evalScript('crossdown(close, 1)', crossBars);
  assert.deepEqual(down, [0, 0, 1, 0, 0]);
  // equal values are not a cross
  const eq = evalScript('crossup(close, close)', crossBars);
  assert.ok(eq.every((x) => x === 0));
});

test('division by zero yields NaN, never ±Infinity', () => {
  const v = evalScript('close / (close - close)', bars);
  assert.ok(v.every((x) => Number.isNaN(x)));
});

test('scalar periods may be shared across calls and nest with arithmetic', () => {
  const v = evalScript('abs(sma(close, 5) - sma(close, 10))', bars);
  assert.equal(v.length, n);
  assert.ok(Number.isNaN(v[8])); // sma10 head is null → NaN
  assert.ok(!Number.isNaN(v[9]));
});

/* ---------------- scriptIndicator + parseIndicators ---------------- */

test('scriptIndicator builds a compute def for both kinds', () => {
  const def = scriptIndicator('(close - sma(close,20)) / sma(close,20)');
  assert.equal(def.kind, 'overlay');
  // must produce the object form — normalizeIndicatorResult would wrap a bare
  // array as a single numeric series and every value would render as NaN
  const res = normalizeIndicatorResult(def.compute(bars, {}));
  assert.equal(res.lines.length, 1);
  assert.ok(res.lines[0].name.length > 0);
  assert.equal(typeof res.lines[0].values[10], 'number');
  assert.equal(res.lines[0].values.length, n);
  const paneDef = scriptIndicator('rsi(close, 14)', { pane: true });
  assert.equal(paneDef.kind, 'pane');
  assert.ok(normalizeIndicatorResult(paneDef.compute(bars, {})).lines[0].values[20] > 0);
});

test('scriptIndicator truncates long legend labels', () => {
  const long = scriptIndicator('close - sma(close, 20) + ema(close, 50) - open + 1');
  const label = long.compute(bars, {}).lines[0].name;
  assert.ok(label.length <= 25);
  assert.ok(label.endsWith('…'));
});

test('parseIndicators routes expr/pexpr tokens and reports invalid scripts', () => {
  const r = parseIndicators(
    'sma:20 expr:{close - sma(close,20)}@ff6a00 pexpr:{rsi(close,14)} expr:{bad +}',
    BUILTIN_INDICATORS
  );
  assert.equal(r.overlays.length, 2); // sma + expr
  assert.equal(r.panes.length, 1);
  assert.equal(r.unknown.length, 1);
  assert.equal(r.overlays[1].name, 'expr');
  assert.equal(r.overlays[1].color, 'ff6a00');
  assert.equal(r.panes[0].name, 'pexpr');
  const res = normalizeIndicatorResult(r.overlays[1].def.compute(bars, {}));
  assert.equal(res.lines[0].values.length, n);
  assert.ok(typeof res.lines[0].name === 'string' && res.lines[0].name.length > 0);
});

test('parseIndicators dedupes identical scripts case-insensitively', () => {
  const r = parseIndicators('expr:{sma(close,3)} EXPR:{SMA(close,3)}', BUILTIN_INDICATORS);
  assert.equal(r.overlays.length, 1);
});

test('parseIndicators rejects unterminated expr blobs safely', () => {
  // an unterminated `{` swallows the rest of the attribute — nothing after it parses
  const r = parseIndicators('expr:{close volume', BUILTIN_INDICATORS);
  assert.equal(r.overlays.length, 0);
  assert.equal(r.volume, false);
});

test('long flat operator chains are iterative, not depth-limited', () => {
  // 26 chained `+` operands — would exceed the depth cap if chains counted as nesting
  const src = 'close + ' + '1 + '.repeat(25) + '1';
  const v = evalScript(src, bars);
  assert.equal(v.length, n);
  assert.ok(v.every((x, i) => x === bars[i].close + 26));
});

test('expr tokens compose with colors and multiple blobs in one attribute', () => {
  const r = parseIndicators(
    'expr:{ema(close,9)}@00ff88 expr:{ema(close,21)}@ff8800 pexpr:{change(close)}',
    BUILTIN_INDICATORS
  );
  assert.equal(r.overlays.length, 2);
  assert.equal(r.overlays[0].color, '00ff88');
  assert.equal(r.overlays[1].color, 'ff8800');
  assert.equal(r.panes.length, 1);
});

/* ---------------- URL state round trip ---------------- */

test('encodeStateQuery/decodeStateQuery round-trip scripts with commas and spaces', () => {
  const inds = 'sma:20 expr:{sma(close,20) - close}@ff6a00 pexpr:{rsi(close,14)}';
  const q = encodeStateQuery({ indicators: inds });
  const back = decodeStateQuery(q);
  assert.equal(back.indicators, inds);
});

test('decodeStateQuery still parses legacy comma-joined params', () => {
  const back = decodeStateQuery('ind=sma:20,rsi:14,volume');
  assert.equal(back.indicators, 'sma:20 rsi:14 volume');
});
