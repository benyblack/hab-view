import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAnnotations } from '../src/core.js';

const mk = (n, fn) =>
  Array.from({ length: n }, (_, i) => {
    const b = fn(i);
    return {
      time: i * 3600e3,
      open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 100,
    };
  });

test('detects volume spikes beyond the multiple threshold', () => {
  const bars = mk(40, (i) => ({
    o: 100, h: 101, l: 99, c: 100,
    v: i === 30 ? 500 : 100, // 30 requires warmup-free sma? period = min(20, 20) = 20, sma≈100
  }));
  const annos = detectAnnotations(bars, 0, 39, null, { pivot: 5 });
  const spike = annos.find((a) => a.type === 'volspike');
  assert.ok(spike, 'spike detected');
  assert.equal(spike.i, 30);
  assert.ok(spike.note.includes('×'));
  // ordinary bars are not flagged
  assert.equal(annos.filter((a) => a.type === 'volspike').length, 1);
});

test('detects price gaps beyond the previous range', () => {
  const bars = mk(40, (i) => {
    if (i === 25) return { o: 130, h: 131, l: 129, c: 130, v: 100 }; // gap up over 99-101 range
    return { o: 100, h: 101, l: 99, c: 100, v: 100 };
  });
  const annos = detectAnnotations(bars, 0, 39, null, { pivot: 5 });
  const gap = annos.find((a) => a.type === 'gap');
  assert.ok(gap);
  assert.equal(gap.i, 25);
  assert.ok(gap.note.includes('up'));
});

test('detects pivot highs and lows', () => {
  // peak at 20, trough at 30 (falling in, rising out)
  const bars = mk(41, (i) => {
    let c;
    if (i <= 20) c = 100 + i;
    else if (i <= 30) c = 120 - (i - 20);
    else c = 110 + (i - 30);
    return { o: c, h: c + 1, l: c - 1, c, v: 100 };
  });
  const annos = detectAnnotations(bars, 5, 36, null, { pivot: 5 });
  const ph = annos.find((a) => a.type === 'pivothigh');
  const pl = annos.find((a) => a.type === 'pivotlow');
  assert.ok(ph && ph.i === 20, 'pivot high at 20');
  assert.ok(pl && pl.i === 30, 'pivot low at 30');
});

test('detects bearish RSI divergence (higher high, weaker RSI)', () => {
  // highs: 110 at i=8, 115 at i=28 (later, higher); RSI passed explicitly: 70 then 55
  const bars = mk(40, (i) => {
    const bump = (j, amp) => (Math.abs(i - j) <= 2 ? amp * (1 - Math.abs(i - j) * 0.3) : 0);
    const c = 100 + bump(8, 10) + bump(28, 15);
    return { o: c - 1, h: c + 2, l: c - 2, c, v: 100 };
  });
  const rsi = new Array(40).fill(50);
  rsi[8] = 70;
  rsi[28] = 55;
  const annos = detectAnnotations(bars, 0, 39, rsi, { pivot: 3 });
  const div = annos.find((a) => a.type === 'divbear');
  assert.ok(div);
  assert.equal(div.i, 28);
});

test('no divergence when RSI confirms the trend', () => {
  const bars = mk(40, (i) => {
    const bump = (j, amp) => (Math.abs(i - j) <= 2 ? amp * (1 - Math.abs(i - j) * 0.3) : 0);
    const c = 100 + bump(8, 10) + bump(28, 15);
    return { o: c - 1, h: c + 2, l: c - 2, c, v: 100 };
  });
  const rsi = new Array(40).fill(50);
  rsi[8] = 55;
  rsi[28] = 70; // RSI rises with price → confirmed, not divergent
  const annos = detectAnnotations(bars, 0, 39, rsi, { pivot: 3 });
  assert.equal(annos.find((a) => a.type === 'divbear'), undefined);
});

test('guards and caps', () => {
  assert.deepEqual(detectAnnotations([], 0, 0, null), []);
  assert.deepEqual(detectAnnotations(mk(5, () => ({ o: 1, h: 1, l: 1, c: 1 })), 3, 10, null), []);
});
