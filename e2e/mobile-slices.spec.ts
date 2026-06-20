import { test, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ROUTE = process.env.ROUTE ?? '/';
const OUT = path.join(process.cwd(), 'e2e', '__shots__', 'slices');
fs.mkdirSync(OUT, { recursive: true });

test('mobile vertical slices', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  await page.goto(ROUTE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const total = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  const vh = page.viewportSize()!.height;
  let i = 0;
  for (let y = 0; y < total; y += vh) {
    const at = await page.evaluate((yy) => {
      const se = document.scrollingElement || document.documentElement;
      se.scrollTop = yy;
      document.body.scrollTop = yy; // fallback when body is the scroller
      return se.scrollTop || document.body.scrollTop || window.scrollY;
    }, y);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `slice_${String(i).padStart(2, '0')}_y${Math.round(at)}.png`) });
    i++;
  }
  await ctx.close();
});
