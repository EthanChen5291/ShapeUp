import { expect, test } from '@playwright/test';

test('health endpoint is available without authentication', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  await expect(await res.json()).toMatchObject({ status: 'ok' });
});

test('public app shell renders without a client-side crash', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/application error|runtime error|unhandled/i);
  await expect(page.locator('body')).toContainText(/shapeup|unchopped|hair/i);
});
