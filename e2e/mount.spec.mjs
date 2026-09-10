/* ==========================================================================
 * Mounting and painting — the layer the Node suite cannot reach.
 * ========================================================================== */
import { test, expect } from '@playwright/test';
import {
  openFixture,
  canvasOf,
  inkedPixels,
  snapshotSettledCanvas,
  expectCanvasUnchanged,
} from './helpers.mjs';

test.describe('custom element', () => {
  test('upgrades and exposes the public API', async ({ page }) => {
    await openFixture(page);
    const api = await page.evaluate(() => {
      const el = window.chart;
      return {
        defined: !!customElements.get('wick-chart'),
        upgraded: el.constructor !== HTMLElement,
        tag: el.tagName.toLowerCase(),
        elementName: el.constructor.elementName,
        hasShadow: !!el.shadowRoot,
        methods: ['setData', 'update', 'getVisibleRange', 'setVisibleRange', 'addAlert', 'fit']
          .filter((m) => typeof el[m] === 'function'),
      };
    });
    expect(api.defined).toBe(true);
    expect(api.upgraded).toBe(true);
    expect(api.tag).toBe('wick-chart');
    // PR #56 fixed the rebrand residue that had this returning 'hab-chart'.
    expect(api.elementName).toBe('wick-chart');
    expect(api.hasShadow).toBe(true);
    expect(api.methods).toHaveLength(6);
  });

  test('paints candles onto a real canvas', async ({ page }) => {
    await openFixture(page);
    await expect(canvasOf(page)).toBeVisible();
    expect(await inkedPixels(page)).toBeGreaterThan(200);
  });

  test('an empty chart paints chrome but no series', async ({ page }) => {
    await openFixture(page, '?empty');
    const empty = await inkedPixels(page);
    await page.evaluate(async () => {
      window.chart.setData(window.makeBars());
      await window.settle();
    });
    expect(await inkedPixels(page)).toBeGreaterThan(empty + 100);
  });

  test('backing store follows devicePixelRatio', async ({ page }) => {
    await openFixture(page);
    const { cssWidth, bufWidth, dpr } = await page.evaluate(() => {
      const cv = window.chart.shadowRoot.querySelector('canvas');
      return {
        cssWidth: Math.round(cv.getBoundingClientRect().width),
        bufWidth: cv.width,
        dpr: window.devicePixelRatio,
      };
    });
    expect(bufWidth).toBe(Math.round(cssWidth * dpr));
  });

  test('repainting identical state produces an identical picture', async ({ page }) => {
    await openFixture(page);
    await snapshotSettledCanvas(page);
    await page.evaluate(async () => {
      window.chart.fit();
      await window.settle();
    });
    await expectCanvasUnchanged(page);
  });
});
