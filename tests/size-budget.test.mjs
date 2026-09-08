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

const BUDGET_GZ = 64 * 1024; // 64 KB gzipped for the whole main entry
const FILES = ['src/core.js', 'src/wick-chart.js'];

test('main entry stays under the gzip budget', () => {
  let total = 0;
  const parts = [];
  for (const f of FILES) {
    const gz = gzipSync(readFileSync(f)).length;
    total += gz;
    parts.push(`${f}: ${(gz / 1024).toFixed(1)} KB gz`);
  }
  assert.ok(
    total <= BUDGET_GZ,
    `main entry is ${(total / 1024).toFixed(1)} KB gz, budget is ${BUDGET_GZ / 1024} KB\n  ${parts.join('\n  ')}\n` +
      'If this growth is intentional, raise BUDGET_GZ in tests/size-budget.test.mjs in a dedicated commit explaining why.'
  );
});
