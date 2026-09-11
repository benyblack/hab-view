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

/**
 * Dispatch a raw multi-touch sequence — Playwright's touchscreen only taps.
 * A frame is [type, points, holdMs]: `holdMs` waits after dispatching, which
 * is how a long press is expressed.
 */
async function touchSequence(page, context, frames) {
  const cdp = await cdpFor(page, context);
  for (const [type, points, holdMs] of frames) {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1 })),
    });
    if (holdMs) await page.waitForTimeout(holdMs);
  }
}

/**
 * One CDP session per page, kept open. Detaching resets the browser's touch
 * state, so a gesture split across calls — press, then move, then lift —
 * would fail with "Must send a TouchStart first".
 */
const cdpSessions = new WeakMap();
async function cdpFor(page, context) {
  let session = cdpSessions.get(page);
  if (!session) {
    session = await context.newCDPSession(page);
    cdpSessions.set(page, session);
  }
  return session;
}

/** Long enough to pass the press threshold with room to spare. */
const PRESS = 500;

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

test.describe('page scrolling', () => {
  /** The fixture in a tall, scrollable document — a chart embedded in a page. */
  async function openInTallPage(page) {
    await openFixture(page, '?fill');
    await page.evaluate(() => (document.body.style.paddingBottom = '3000px'));
    return canvasBox(page);
  }

  test('a vertical swipe over the chart scrolls the page', async ({ page, context }) => {
    const box = await openInTallPage(page);
    const x = box.x + box.width / 2;

    await touchSequence(page, context, [
      ['touchStart', [{ x, y: box.y + box.height * 0.75 }]],
      ['touchMove', [{ x, y: box.y + box.height * 0.5 }]],
      ['touchMove', [{ x, y: box.y + box.height * 0.2 }]],
      ['touchEnd', []],
    ]);

    // A chart that swallows vertical swipes is a dead zone in a phone page:
    // the reader cannot scroll past it.
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
  });

  test('a horizontal swipe pans the chart and does not scroll the page', async ({ page, context }) => {
    const box = await openInTallPage(page);
    await page.evaluate(async () => {
      const d = window.chart.data;
      window.chart.setVisibleRange({ from: d[100].time, to: d[160].time });
      await window.settle();
    });
    const before = await visibleRange(page);
    const y = box.y + box.height / 2;

    await touchSequence(page, context, [
      ['touchStart', [{ x: box.x + box.width * 0.8, y }]],
      ['touchMove', [{ x: box.x + box.width * 0.6, y }]],
      ['touchMove', [{ x: box.x + box.width * 0.35, y }]],
      ['touchEnd', []],
    ]);

    expect((await visibleRange(page)).from).toBeGreaterThan(before.from);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('a pinch still zooms rather than scrolling the page', async ({ page, context }) => {
    const box = await openInTallPage(page);
    await page.evaluate(async () => {
      const d = window.chart.data;
      window.chart.setVisibleRange({ from: d[100].time, to: d[160].time });
      await window.settle();
    });
    const before = await visibleRange(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await touchSequence(page, context, [
      ['touchStart', [{ x: cx - 30, y: cy - 40 }, { x: cx + 30, y: cy + 40 }]],
      ['touchMove', [{ x: cx - 70, y: cy - 90 }, { x: cx + 70, y: cy + 90 }]],
      ['touchMove', [{ x: cx - 120, y: cy - 140 }, { x: cx + 120, y: cy + 140 }]],
      ['touchEnd', []],
    ]);

    // Deliberately diagonal: the vertical component must not hand the
    // gesture to the page scroller mid-pinch.
    expect(span(await visibleRange(page))).toBeLessThan(span(before));
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

test.describe('long-press scrub', () => {
  test('a long press opens the crosshair on the pressed bar', async ({ page, context }) => {
    await openFixture(page, '?fill');
    const box = await canvasBox(page);

    await touchSequence(page, context, [
      ['touchStart', [{ x: box.x + box.width * 0.45, y: box.y + box.height * 0.5 }], PRESS],
    ]);
    await page.evaluate(() => window.settle());

    const detail = await page.evaluate(() => window.events.crosshair.at(-1));
    expect(detail, 'a long press should open the crosshair').toBeTruthy();
    expect(typeof detail.bar.close).toBe('number');

    await touchSequence(page, context, [['touchEnd', []]]);
  });

  test('moving after a long press scrubs instead of panning', async ({ page, context }) => {
    await openFixture(page, '?fill');
    const box = await canvasBox(page);
    const y = box.y + box.height / 2;
    await page.evaluate(async () => {
      const d = window.chart.data;
      window.chart.setVisibleRange({ from: d[100].time, to: d[160].time });
      await window.settle();
    });
    const before = await visibleRange(page);

    await touchSequence(page, context, [
      ['touchStart', [{ x: box.x + box.width * 0.7, y }], PRESS],
      ['touchMove', [{ x: box.x + box.width * 0.5, y }]],
      ['touchMove', [{ x: box.x + box.width * 0.3, y }]],
    ]);
    await page.evaluate(() => window.settle());

    const scrubbed = await page.evaluate(() => window.events.crosshair.at(-1));
    expect(scrubbed).toBeTruthy();
    // The window must not have moved — this is a read gesture, not a pan.
    expect(await visibleRange(page)).toEqual(before);

    await touchSequence(page, context, [['touchEnd', []]]);
  });

  test('scrubbing walks the crosshair across bars', async ({ page, context }) => {
    await openFixture(page, '?fill');
    const box = await canvasBox(page);
    const y = box.y + box.height / 2;

    await touchSequence(page, context, [
      ['touchStart', [{ x: box.x + box.width * 0.7, y }], PRESS],
    ]);
    const first = await page.evaluate(() => window.events.crosshair.at(-1).bar.time);
    await touchSequence(page, context, [['touchMove', [{ x: box.x + box.width * 0.35, y }]]]);
    await page.evaluate(() => window.settle());
    const second = await page.evaluate(() => window.events.crosshair.at(-1).bar.time);

    expect(second).toBeLessThan(first);

    await touchSequence(page, context, [['touchEnd', []]]);
  });

  test('lifting the finger clears the crosshair', async ({ page, context }) => {
    await openFixture(page, '?fill');
    const box = await canvasBox(page);

    await touchSequence(page, context, [
      ['touchStart', [{ x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 }], PRESS],
      ['touchEnd', []],
    ]);
    await page.evaluate(() => window.settle());

    expect(await page.evaluate(() => window.events.crosshair.at(-1))).toBeNull();
  });

  test('a quick tap still selects and leaves no crosshair', async ({ page, context }) => {
    await openFixture(page, '?fill');
    await page.evaluate(() => {
      window.events.select = [];
      window.chart.addEventListener('wick:select', (e) => window.events.select.push(e.detail));
    });
    const box = await canvasBox(page);

    await touchSequence(page, context, [
      ['touchStart', [{ x: box.x + box.width * 0.4, y: box.y + box.height * 0.5 }]],
      ['touchEnd', []],
    ]);
    await page.evaluate(() => window.settle());

    expect(await page.evaluate(() => window.events.select.length)).toBe(1);
    const last = await page.evaluate(() => window.events.crosshair.at(-1));
    expect(last == null, 'a tap should not leave a crosshair behind').toBe(true);
  });

  test('a press that moves immediately pans, not scrubs', async ({ page, context }) => {
    await openFixture(page, '?fill');
    const box = await canvasBox(page);
    const y = box.y + box.height / 2;
    await page.evaluate(async () => {
      const d = window.chart.data;
      window.chart.setVisibleRange({ from: d[100].time, to: d[160].time });
      await window.settle();
    });
    const before = await visibleRange(page);

    await touchSequence(page, context, [
      ['touchStart', [{ x: box.x + box.width * 0.8, y }]],
      ['touchMove', [{ x: box.x + box.width * 0.6, y }]],
      ['touchMove', [{ x: box.x + box.width * 0.4, y }]],
      ['touchEnd', []],
    ]);

    expect((await visibleRange(page)).from).toBeGreaterThan(before.from);
  });
});
