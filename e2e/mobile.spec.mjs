/* ==========================================================================
 * Phone-sized, touch-driven runs. Pointer events from a real touchscreen
 * are a different code path from a mouse — multi-touch above all, which the
 * Node suite cannot produce at all.
 *
 * Runs under the `mobile` project (see playwright.config.mjs).
 * ========================================================================== */
import { test, expect } from '@playwright/test';
import { openFixture, canvasBox, inkedPixels, visibleRange } from './helpers.mjs';

const span = (r) => r.to - r.from;

/** Dispatch a raw multi-touch sequence — Playwright's touchscreen only taps. */
async function touchSequence(page, context, frames) {
  const cdp = await context.newCDPSession(page);
  for (const [type, points] of frames) {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1 })),
    });
  }
  await cdp.detach();
}

test.describe('touch', () => {
  test('renders at phone width', async ({ page }) => {
    await openFixture(page, '?fill');
    const box = await canvasBox(page);
    expect(box.width).toBeLessThan(500);
    expect(box.width).toBeGreaterThan(300);
    expect(await inkedPixels(page)).toBeGreaterThan(100);
  });

  test('a one-finger drag pans', async ({ page, context }) => {
    await openFixture(page, '?fill');
    const box = await canvasBox(page);
    const y = box.y + box.height / 2;
    // Zoom in first — a fitted chart has nowhere to pan.
    await page.evaluate(async () => {
      const d = window.chart.data;
      window.chart.setVisibleRange({ from: d[100].time, to: d[160].time });
      await window.settle();
    });
    const before = await visibleRange(page);

    await touchSequence(page, context, [
      ['touchStart', [{ x: box.x + box.width * 0.8, y }]],
      ['touchMove', [{ x: box.x + box.width * 0.6, y }]],
      ['touchMove', [{ x: box.x + box.width * 0.35, y }]],
      ['touchEnd', []],
    ]);

    const after = await visibleRange(page);
    expect(after.from).toBeGreaterThan(before.from);
  });

  test('a two-finger pinch zooms out', async ({ page, context }) => {
    await openFixture(page, '?fill');
    await page.evaluate(async () => {
      const d = window.chart.data;
      window.chart.setVisibleRange({ from: d[100].time, to: d[160].time });
      await window.settle();
    });
    const box = await canvasBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const before = await visibleRange(page);

    // Fingers start apart and come together: pinch in = zoom out.
    await touchSequence(page, context, [
      ['touchStart', [{ x: cx - 120, y: cy }, { x: cx + 120, y: cy }]],
      ['touchMove', [{ x: cx - 80, y: cy }, { x: cx + 80, y: cy }]],
      ['touchMove', [{ x: cx - 30, y: cy }, { x: cx + 30, y: cy }]],
      ['touchEnd', []],
    ]);

    const after = await visibleRange(page);
    expect(span(after)).toBeGreaterThan(span(before));
  });

  test('a two-finger spread zooms in', async ({ page, context }) => {
    await openFixture(page, '?fill');
    const box = await canvasBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const before = await visibleRange(page);

    await touchSequence(page, context, [
      ['touchStart', [{ x: cx - 40, y: cy }, { x: cx + 40, y: cy }]],
      ['touchMove', [{ x: cx - 90, y: cy }, { x: cx + 90, y: cy }]],
      ['touchMove', [{ x: cx - 150, y: cy }, { x: cx + 150, y: cy }]],
      ['touchEnd', []],
    ]);

    const after = await visibleRange(page);
    expect(span(after)).toBeLessThan(span(before));
  });

  test('streaming keeps working on a phone', async ({ page }) => {
    await openFixture(page, '?fill');
    const count = await page.evaluate(() => window.chart.data.length);
    await page.evaluate(async () => {
      const last = window.chart.data.at(-1);
      window.chart.update({ ...last, time: last.time + 60_000 });
      await window.settle();
    });
    expect(await page.evaluate(() => window.chart.data.length)).toBe(count + 1);
  });
});
