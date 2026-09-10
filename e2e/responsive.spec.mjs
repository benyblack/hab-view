/* ==========================================================================
 * Layout, resize and devicePixelRatio.
 *
 * A canvas chart has two sizes — the CSS box and the backing store — and
 * only a browser has both. Everything here is invisible to the Node suite.
 * ========================================================================== */
import { test, expect } from '@playwright/test';
import {
  openFixture,
  visibleRange,
  snapshotSettledCanvas,
  expectCanvasChanged,
} from './helpers.mjs';

/** CSS size, backing-store size and the ratio the element resolved. */
const metrics = (page) =>
  page.evaluate(() => {
    const cv = window.chart.shadowRoot.querySelector('canvas');
    const r = cv.getBoundingClientRect();
    return {
      css: { w: Math.round(r.width), h: Math.round(r.height) },
      buffer: { w: cv.width, h: cv.height },
      dpr: window.devicePixelRatio,
    };
  });

/** Resize the fixture's container and let the ResizeObserver land. */
const resizeBox = (page, w, h) =>
  page.evaluate(
    async ([w, h]) => {
      const box = document.getElementById('box');
      box.style.width = w + 'px';
      box.style.height = h + 'px';
      await window.settle();
      await window.settle();
    },
    [w, h]
  );

test.describe('resize', () => {
  test('the backing store follows the container', async ({ page }) => {
    await openFixture(page);
    const before = await metrics(page);
    expect(before.buffer.w).toBe(before.css.w * before.dpr);

    await resizeBox(page, 620, 300);

    const after = await metrics(page);
    expect(after.css).toEqual({ w: 620, h: 300 });
    expect(after.buffer).toEqual({ w: 620 * after.dpr, h: 300 * after.dpr });
  });

  test('a resize repaints and holds the right edge', async ({ page }) => {
    await openFixture(page);
    // Zoom in so the window is not just "all the data".
    await page.evaluate(async () => {
      const d = window.chart.data;
      window.chart.setVisibleRange({ from: d[100].time, to: d[180].time });
      await window.settle();
    });
    const before = await visibleRange(page);
    await snapshotSettledCanvas(page);

    await resizeBox(page, 620, 420);

    await expectCanvasChanged(page);
    const after = await visibleRange(page);
    // Resizing anchors the right edge and holds bar spacing, so a narrower
    // box shows proportionally fewer bars rather than squeezing the same
    // window into less room. What must not happen is a refit to all data.
    expect(after.to).toBe(before.to);
    const shrink = (after.to - after.from) / (before.to - before.from);
    expect(shrink).toBeGreaterThan(620 / 900 - 0.1);
    expect(shrink).toBeLessThan(620 / 900 + 0.1);
  });

  test('a collapsed container does not throw or corrupt state', async ({ page }) => {
    await openFixture(page);
    const range = await visibleRange(page);
    await resizeBox(page, 0, 0);
    await resizeBox(page, 900, 460);
    expect(await visibleRange(page)).toEqual(range);
    expect(await page.evaluate(() => window.chart.data.length)).toBe(300);
  });
});

test.describe('devicePixelRatio', () => {
  test('a retina context gets a 2x backing store', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await openFixture(page);
    const m = await metrics(page);
    expect(m.dpr).toBe(2);
    expect(m.buffer.w).toBe(m.css.w * 2);
    await context.close();
  });

  test('the ratio is clamped so an absurd DPR cannot blow up memory', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 4,
    });
    const page = await context.newPage();
    await openFixture(page);
    const m = await metrics(page);
    expect(m.dpr).toBe(4);
    expect(m.buffer.w).toBe(Math.round(m.css.w * 2.5));
    await context.close();
  });

  test('a DPR change alone re-renders at the new resolution', async ({ page, context }) => {
    await openFixture(page);
    const before = await metrics(page);
    expect(before.dpr).toBe(1);

    // Dragging the window to a monitor with a different ratio: the ratio
    // changes while the CSS box keeps its exact size, so no ResizeObserver
    // fires. The element watches a `resolution` media query for it.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await page.waitForFunction(() => window.devicePixelRatio === 2);

    // Part one: the query the element watches really does stop matching —
    // the trigger exists and tracks devicePixelRatio.
    expect(await page.evaluate(() => matchMedia('(resolution: 1dppx)').matches)).toBe(false);

    // Part two: when that change is delivered, the chart re-renders at the
    // new resolution. Chromium does not dispatch the media-query change
    // under Emulation.setDeviceMetricsOverride (only `matches` flips), so
    // the event is delivered directly to the list the element is watching.
    const rearmed = await page.evaluate(async () => {
      const el = window.chart;
      el._dprMq.dispatchEvent(new Event('change'));
      await window.settle();
      await window.settle();
      return el._dprMq.media;
    });

    const after = await metrics(page);
    expect(after.css).toEqual(before.css);
    // Without the watcher the chart keeps the old backing store and renders soft.
    expect(after.buffer).toEqual({ w: after.css.w * 2, h: after.css.h * 2 });
    // And it re-arms on the new ratio, so the next change is caught too.
    expect(rearmed).toBe('(resolution: 2dppx)');
  });
});
