/* ==========================================================================
 * Display timezone and the VWAP session anchor — PR #58.
 *
 * The axis labels only exist as pixels, so the assertions are regional: a
 * timezone change must redraw the time axis and leave the plot alone, while
 * a VWAP anchor change must do the opposite. That separation is the whole
 * point of the feature — "how times are shown" is not "where the session
 * starts" — and it is not observable from Node.
 * ========================================================================== */
import { test, expect } from '@playwright/test';
import {
  openFixture,
  visibleRange,
  snapshotSettledCanvas,
  canvasDiff,
  expectCanvasUnchanged,
  expectCanvasChanged,
} from './helpers.mjs';

/** Multi-day history, so the axis carries date labels a zone shift can move. */
const seedDays = (page) =>
  page.evaluate(async () => {
    window.chart.setData(window.makeBars(300, Date.UTC(2024, 0, 2), 3_600_000));
    await window.settle();
  });

/** The time-axis strip, in CSS pixels. */
async function axisBand(page) {
  const ly = await page.evaluate(() => window.layout());
  expect(ly, 'layout should be available after a paint').not.toBeNull();
  return { y0: ly.plotBottom, y1: ly.plotBottom + ly.timeH };
}

/**
 * The VWAP value at the right edge, read off the public data-window summary.
 * Pixels cannot separate "the VWAP line moved" from "a time gridline moved",
 * and time gridlines are drawn inside the plot — so the anchor question is
 * settled numerically instead.
 */
async function vwapValue(page) {
  const text = await page.evaluate(async () => {
    await window.settle();
    return window.chart.getDataWindow().text;
  });
  const m = /vwap[^=]*=\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  expect(m, `the data window should report a vwap value, got:
${text}`).not.toBeNull();
  return Number(m[1].replace(/,/g, ''));
}

test.use({ timezoneId: 'UTC' });

test.describe('timezone', () => {
  test('an IANA zone redraws the time axis', async ({ page }) => {
    await openFixture(page, '?empty');
    await seedDays(page);
    const axis = await axisBand(page);
    await snapshotSettledCanvas(page);

    await page.evaluate(async () => {
      window.chart.setAttribute('timezone', 'Asia/Tokyo');
      await window.settle();
    });

    // +9h moves every date boundary and most hour labels.
    await expectCanvasChanged(page, 'base', 0.005, axis);
  });

  test('it does not touch the data or the viewport', async ({ page }) => {
    await openFixture(page, '?empty');
    await seedDays(page);
    const range = await visibleRange(page);
    const closes = await page.evaluate(() => window.chart.data.map((b) => b.close));

    await page.evaluate(async () => {
      window.chart.setAttribute('timezone', 'Asia/Tokyo');
      await window.settle();
    });

    // A display zone is presentation: same window, same bars.
    expect(await visibleRange(page)).toEqual(range);
    expect(await page.evaluate(() => window.chart.data.map((b) => b.close))).toEqual(closes);
  });

  test('zones with the same offset render the same axis', async ({ page }) => {
    await openFixture(page, '?empty');
    await seedDays(page);
    await page.evaluate(async () => {
      window.chart.setAttribute('timezone', 'utc');
      await window.settle();
    });
    await snapshotSettledCanvas(page);

    // Reykjavik is UTC+0 all year — same labels, different string.
    await page.evaluate(async () => {
      window.chart.setAttribute('timezone', 'Atlantic/Reykjavik');
      await window.settle();
    });
    await expectCanvasUnchanged(page);
  });

  test('removing the attribute falls back to the local zone', async ({ page }) => {
    await openFixture(page, '?empty');
    await seedDays(page);
    const axis = await axisBand(page);
    await page.evaluate(async () => {
      window.chart.setAttribute('timezone', 'Asia/Tokyo');
      await window.settle();
    });
    await snapshotSettledCanvas(page);

    await page.evaluate(async () => {
      window.chart.removeAttribute('timezone');
      await window.settle();
    });
    // The page runs in UTC (test.use above), so local ≠ Tokyo.
    await expectCanvasChanged(page, 'base', 0.005, axis);
  });
});

test.describe('vwap anchor', () => {
  /** VWAP on, session anchored to UTC, a multi-day history loaded. */
  async function seedVwap(page) {
    await openFixture(page, '?empty');
    await page.evaluate(async () => {
      window.chart.setAttribute('indicators', 'vwap');
      window.chart.setAttribute('vwap-anchor', 'utc');
      await window.settle();
    });
    await seedDays(page);
  }

  test('re-anchoring the session moves the VWAP line', async ({ page }) => {
    await seedVwap(page);
    const utcAnchored = await vwapValue(page);
    const axis = await axisBand(page);
    await snapshotSettledCanvas(page);

    await page.evaluate(async () => {
      window.chart.setAttribute('vwap-anchor', 'Asia/Tokyo');
      await window.settle();
    });

    // A different session start is a different average...
    expect(await vwapValue(page)).not.toBe(utcAnchored);
    // ...and it is a plot-level change: the time axis is untouched by it.
    await expectCanvasUnchanged(page, 'base', 0.001, axis);
  });

  test('the display zone alone never moves the VWAP line', async ({ page }) => {
    await seedVwap(page);
    const before = await vwapValue(page);

    await page.evaluate(async () => {
      window.chart.setAttribute('timezone', 'Asia/Tokyo');
      await window.settle();
    });

    // The regression PR #58 was written to avoid: showing Tokyo times must
    // not silently re-cut the trading session.
    expect(await vwapValue(page)).toBe(before);
  });
});
