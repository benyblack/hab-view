/* ==========================================================================
 * Visual regression.
 *
 * Opt-in, and deliberately so: canvas output is not pixel-identical across
 * operating systems (font hinting, rasterizer, GPU path), so a baseline
 * committed from one machine red-lights everyone else's. The rest of the
 * suite therefore compares the chart against *itself* — see the canvas diff
 * helpers — which catches "this repaint changed something" without pinning
 * the rendering to one platform.
 *
 * To gate on real baselines, generate them on the platform CI runs:
 *
 *   WICK_E2E_VISUAL=1 npm run test:e2e -- --update-snapshots
 *
 * Snapshots are written per-platform (see snapshotPathTemplate), so a
 * Windows and a Linux baseline can live side by side.
 * ========================================================================== */
import { test, expect } from '@playwright/test';
import { openFixture, canvasOf, snapshotSettledCanvas } from './helpers.mjs';

test.skip(
  !process.env.WICK_E2E_VISUAL,
  'visual baselines are platform-specific — set WICK_E2E_VISUAL=1 (see the spec header)'
);

/** Configure the chart, load the fixed dataset, wait for a settled frame. */
async function paint(page, attrs = {}) {
  await openFixture(page, '?empty');
  await page.evaluate(async (attrs) => {
    for (const [k, v] of Object.entries(attrs)) window.chart.setAttribute(k, v);
    window.chart.setData(window.makeBars());
    await window.settle();
  }, attrs);
  await snapshotSettledCanvas(page);
}

test('candles', async ({ page }) => {
  await paint(page);
  await expect(canvasOf(page)).toHaveScreenshot('candles.png');
});

test('line', async ({ page }) => {
  await paint(page, { type: 'line' });
  await expect(canvasOf(page)).toHaveScreenshot('line.png');
});

test('candles with indicators', async ({ page }) => {
  await paint(page, { indicators: 'sma:20 volume rsi:14' });
  await expect(canvasOf(page)).toHaveScreenshot('indicators.png');
});

test('light theme', async ({ page }) => {
  await paint(page, { theme: 'light' });
  await expect(canvasOf(page)).toHaveScreenshot('light.png');
});
