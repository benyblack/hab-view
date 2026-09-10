/* ==========================================================================
 * Alerts firing from a live element — PR #56 (closed-candle evaluation, and
 * never firing off a historical insert).
 * ========================================================================== */
import { test, expect } from '@playwright/test';
import { openFixture } from './helpers.mjs';

/** Stream a flat candle. `closed` finalizes it. */
const push = (page, time, close, closed) =>
  page.evaluate(
    ([time, close, closed]) =>
      window.chart.update({ time, open: close, high: close, low: close, close, volume: 1, closed }),
    [time, close, closed]
  );

const fired = (page) => page.evaluate(() => window.events.alert);

/** A flat, closed history at `close`, one bar a minute from a fixed epoch. */
async function seedFlat(page, close = 100, n = 30) {
  return page.evaluate(
    ([close, n]) => {
      const t0 = Date.UTC(2024, 0, 2);
      const bars = [];
      for (let i = 0; i < n; i++) {
        bars.push({ time: t0 + i * 60_000, open: close, high: close, low: close, close, volume: 1, closed: true });
      }
      window.chart.setData(bars);
      window.events.alert.length = 0;
      return t0 + (n - 1) * 60_000;
    },
    [close, n]
  );
}

test.describe('alerts', () => {
  test('a price alert fires wick:alert on a live crossing', async ({ page }) => {
    await openFixture(page, '?empty');
    const last = await seedFlat(page);
    await page.evaluate(() => window.chart.addAlert({ id: 'a1', price: 105, direction: 'above' }));

    await push(page, last + 60_000, 110, false);

    const events = await fired(page);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('a1');
    expect(events[0].price).toBe(105);
    expect(events[0].bar.close).toBe(110);
  });

  test('a once alert fires exactly once', async ({ page }) => {
    await openFixture(page, '?empty');
    const last = await seedFlat(page);
    await page.evaluate(() => window.chart.addAlert({ id: 'a1', price: 105, direction: 'above' }));

    await push(page, last + 60_000, 110, true);
    await push(page, last + 120_000, 100, true);
    await push(page, last + 180_000, 120, true);

    expect(await fired(page)).toHaveLength(1);
  });

  test('close mode ignores a wick that pokes through and comes back', async ({ page }) => {
    await openFixture(page, '?empty');
    const last = await seedFlat(page);
    await page.evaluate(() =>
      window.chart.addAlert({ id: 'a1', price: 105, direction: 'above', evaluate: 'close' })
    );

    const t = last + 60_000;
    await push(page, t, 101, false); // candle opens below
    await push(page, t, 110, false); // ticks through the level
    await push(page, t, 102, false); // and comes back
    await push(page, t, 102, true); // closes below — no signal
    expect(await fired(page)).toHaveLength(0);

    // The next candle actually closes above: that is the signal.
    await push(page, t + 60_000, 110, true);
    const events = await fired(page);
    expect(events).toHaveLength(1);
    expect(events[0].bar.close).toBe(110);
  });

  test('live mode does fire on that same wick', async ({ page }) => {
    await openFixture(page, '?empty');
    const last = await seedFlat(page);
    await page.evaluate(() =>
      window.chart.addAlert({ id: 'a1', price: 105, direction: 'above', evaluate: 'live' })
    );

    const t = last + 60_000;
    await push(page, t, 101, false);
    await push(page, t, 110, false);
    expect(await fired(page)).toHaveLength(1);
  });

  test('the alert-evaluate attribute sets the chart-wide default', async ({ page }) => {
    await openFixture(page, '?empty');
    await page.evaluate(() => window.chart.setAttribute('alert-evaluate', 'close'));
    const last = await seedFlat(page);
    await page.evaluate(() => window.chart.addAlert({ id: 'a1', price: 105, direction: 'above' }));

    const t = last + 60_000;
    await push(page, t, 110, false); // forming — the default is now close mode
    expect(await fired(page)).toHaveLength(0);
    await push(page, t, 110, true);
    expect(await fired(page)).toHaveLength(1);
  });

  test('a scripted alert evaluates against the bar that just arrived', async ({ page }) => {
    await openFixture(page, '?empty');
    const last = await seedFlat(page);
    await page.evaluate(() => window.chart.addAlert({ id: 's1', when: 'close > 105' }));

    await push(page, last + 60_000, 101, true);
    expect(await fired(page)).toHaveLength(0);

    await push(page, last + 120_000, 110, true);
    const events = await fired(page);
    expect(events).toHaveLength(1);
    expect(events[0].when).toBe('close > 105');
    // The event must carry the new bar, not the previous version's value.
    expect(events[0].price).toBe(110);
  });

  test('a backfilled candle never fires an alert', async ({ page }) => {
    await openFixture(page, '?empty');
    const last = await seedFlat(page);
    await page.evaluate(() => window.chart.addAlert({ id: 'a1', price: 105, direction: 'above' }));

    // A correction to old history that is far above the level: it is not a
    // live signal and must not be compared against the latest price.
    await page.evaluate(
      (t) => window.chart.update({ time: t, open: 500, high: 500, low: 500, close: 500, volume: 1, closed: true }),
      Date.UTC(2024, 0, 2) + 5 * 60_000
    );
    expect(await fired(page)).toHaveLength(0);

    // The front of the series still works afterwards.
    await push(page, last + 60_000, 110, true);
    expect(await fired(page)).toHaveLength(1);
  });
});
