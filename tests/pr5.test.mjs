import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeStateQuery, decodeStateQuery } from '../src/core.js';

test('encode/decode round-trips a full state', () => {
  const state = {
    type: 'area',
    theme: 'light',
    log: true,
    stats: true,
    indicators: 'sma:20 rsi:14 volume',
    view: { from: 1700000000000, to: 1700086400000 },
  };
  const q = encodeStateQuery(state);
  const back = decodeStateQuery(q);
  assert.equal(back.type, 'area');
  assert.equal(back.theme, 'light');
  assert.equal(back.log, true);
  assert.equal(back.stats, true);
  assert.equal(back.indicators, 'sma:20 rsi:14 volume');
  // times round-trip via whole seconds
  assert.equal(back.view.from, 1700000000000 - (1700000000000 % 1000));
  assert.equal(back.view.to, 1700086400000);
});

test('encode skips empty/optional fields', () => {
  assert.equal(encodeStateQuery(null), '');
  assert.equal(encodeStateQuery({}), '');
  const q = encodeStateQuery({ type: 'candles', indicators: '' });
  assert.equal(q, 'type=candles');
});

test('decode tolerates junk and missing keys', () => {
  const s = decodeStateQuery('nonsense=1&type=line');
  assert.equal(s.type, 'line');
  assert.equal(s.view, undefined);
  assert.deepEqual(decodeStateQuery(''), {});
  const partial = decodeStateQuery('from=abc');
  assert.ok(!(partial.view.from >= 0)); // NaN-ish guarded
  assert.equal(partial.view.to, undefined);
});

test('indicators list encodes with commas and decodes back to spaces', () => {
  const q = encodeStateQuery({ indicators: 'sma:20@#ff0000 macd:12/26/9' });
  assert.equal(q, 'ind=' + encodeURIComponent('sma:20@#ff0000,macd:12/26/9'));
  const back = decodeStateQuery(q);
  assert.equal(back.indicators, 'sma:20@#ff0000 macd:12/26/9');
});
