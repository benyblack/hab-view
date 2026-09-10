/* ==========================================================================
 * The React binding against a live element — PR #56's identity bug.
 *
 * `setData()` normalizes into a fresh array, so `el.data` never matches the
 * array React passed in. Comparing against it re-ingested on every render,
 * and re-ingesting sets `_needsFit` — so any parent re-render silently threw
 * away the user's zoom. Nothing about that is visible without React, a real
 * element and a real viewport, which is why it shipped.
 * ========================================================================== */
import { test, expect } from '@playwright/test';
import { visibleRange } from './helpers.mjs';

async function openReactFixture(page) {
  await page.goto('/e2e/fixtures/react.html');
  // React is fetched from a CDN here, as it is in the shipped demo.
  await page.waitForFunction(() => window.ready === true, null, { timeout: 30_000 });
}

/** Re-render the parent without changing any chart prop. */
async function rerender(page) {
  const before = await page.evaluate(() => window.renders);
  await page.evaluate(() => window.bump());
  await page.waitForFunction((n) => window.renders > n, before);
  await page.evaluate(() => window.settle());
}

test.describe('react binding', () => {
  test('mounts the element and applies props as attributes', async ({ page }) => {
    await openReactFixture(page);
    expect(await page.evaluate(() => window.chart.getAttribute('type'))).toBe('candles');
    expect(await page.evaluate(() => window.chart.data.length)).toBe(300);
    expect(await page.locator('#chart canvas').first().isVisible()).toBe(true);
  });

  test('a parent re-render does not reset the zoom', async ({ page }) => {
    await openReactFixture(page);
    await page.evaluate(async () => {
      const d = window.chart.data;
      window.chart.setVisibleRange({ from: d[120].time, to: d[180].time });
      await window.settle();
    });
    const zoomed = await visibleRange(page);

    await rerender(page);
    await rerender(page);

    expect(await visibleRange(page)).toEqual(zoomed);
  });

  test('a re-render with the same array does not re-ingest the data', async ({ page }) => {
    await openReactFixture(page);
    // A version bump is the element's own "the dataset changed" counter.
    const version = await page.evaluate(() => window.chart._version);
    await rerender(page);
    expect(await page.evaluate(() => window.chart._version)).toBe(version);
  });

  test('a new array with the same contents still updates the chart', async ({ page }) => {
    await openReactFixture(page);
    const before = await page.evaluate(() => window.chart.data.length);

    await page.evaluate(async () => {
      const next = window.chart.data.slice();
      const last = next.at(-1);
      next.push({ ...last, time: last.time + 60_000 });
      window.setBars(next); // fresh identity — this must reach the element
      await window.settle();
      await window.settle();
    });

    expect(await page.evaluate(() => window.chart.data.length)).toBe(before + 1);
  });

  test('event handlers stay subscribed across re-renders', async ({ page }) => {
    await openReactFixture(page);
    await rerender(page);
    await page.evaluate(() => (window.events.range.length = 0));

    await page.evaluate(async () => {
      const d = window.chart.data;
      window.chart.setVisibleRange({ from: d[50].time, to: d[100].time });
      await window.settle();
    });

    // One live subscription — not zero (unsubscribed) and not one per render.
    expect(await page.evaluate(() => window.events.range.length)).toBe(1);
  });
});
