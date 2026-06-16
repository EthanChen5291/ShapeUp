import { test, expect, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Mobile-support verification harness.
 *
 *   PHASE=before npx playwright test mobile-verify   # capture desktop baseline
 *   PHASE=after  npx playwright test mobile-verify   # capture desktop + mobile
 *
 * Desktop "before" vs "after" screenshots must be identical (proves desktop is
 * untouched). Mobile screenshots are inspected for horizontal overflow.
 *
 * ROUTES can be overridden via env, e.g. ROUTES="/,/pricing".
 */

const PHASE = process.env.PHASE ?? 'after';
const ROUTES = (process.env.ROUTES ?? '/').split(',').map((r) => r.trim()).filter(Boolean);
const OUT = path.join(process.cwd(), 'e2e', '__shots__');
fs.mkdirSync(OUT, { recursive: true });

const slug = (r: string) => (r === '/' ? 'home' : r.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, ''));

for (const route of ROUTES) {
  test(`desktop @1440 ${route} (${PHASE})`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `desktop_${slug(route)}_${PHASE}.png`), fullPage: true });
    await ctx.close();
  });

  if (PHASE === 'after') {
    test(`mobile iPhone13 ${route}`, async ({ browser }) => {
      const ctx = await browser.newContext({ ...devices['iPhone 13'] });
      const page = await ctx.newPage();
      await page.goto(route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, `mobile_${slug(route)}.png`), fullPage: true });

      // No horizontal overflow: scrollWidth must not exceed the viewport width.
      const overflow = await page.evaluate(() => {
        const de = document.documentElement;
        return { scrollW: de.scrollWidth, clientW: de.clientWidth };
      });
      expect(
        overflow.scrollW,
        `horizontal overflow on ${route}: scrollWidth ${overflow.scrollW} > clientWidth ${overflow.clientW}`,
      ).toBeLessThanOrEqual(overflow.clientW + 1);
      await ctx.close();
    });
  }
}
