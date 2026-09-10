/* ==========================================================================
 * Playwright — browser-level coverage for <wick-chart>.
 *
 * The Node suite (`npm test`) covers pure functions and, where it can, a
 * duck-typed element. What it cannot cover is the part that only exists in a
 * browser: custom-element upgrade, a real canvas, wheel/pointer/touch input,
 * devicePixelRatio, ResizeObserver and React re-renders against a live DOM
 * node. That is what lives in e2e/.
 *
 *   npm run test:e2e
 *
 * Browser binary: CI downloads Playwright's bundled Chromium. If that CDN is
 * unreachable on your machine, point the suite at a locally installed browser:
 *
 *   WICK_E2E_CHANNEL=chrome npm run test:e2e     # or msedge
 * ========================================================================== */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.WICK_E2E_PORT || 5174);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const channel = process.env.WICK_E2E_CHANNEL || undefined;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list']],
  // Rendering differs across platforms (font hinting, GPU path), so snapshots
  // are keyed by platform — a Windows baseline never gates a Linux CI run.
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' },
  },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      // mobile.spec is touch/phone-only — it runs under the mobile project.
      testIgnore: '**/mobile.spec.mjs',
      use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      testMatch: '**/mobile.spec.mjs',
      use: { ...devices['Pixel 7'], channel },
    },
  ],
  webServer: {
    command: `node e2e/server.mjs ${PORT}`,
    url: BASE_URL + '/index.html',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
