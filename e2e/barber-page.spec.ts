import { expect, test } from '@playwright/test';

test('the public barber ticket preserves the barber/ShapeUp split and starts the selfie flow', async ({ page }) => {
  await page.goto('/b/playwright-preview');

  const barber = page.locator('.bc-side');
  const experience = page.locator('.bc-exp');
  await expect(barber.getByRole('heading', { level: 1, name: 'Marcus Rivera' })).toBeVisible();
  await expect(barber).toContainText('Fade Theory');
  await expect(barber).toContainText('Oakland, CA');
  await expect(barber).toContainText('Signature cut');
  await expect(barber.getByRole('link', { name: /Book with Marcus/ })).toBeVisible();
  await expect(barber).not.toContainText('What are we doing today?');

  await expect(experience).toContainText('What are we doing today?');
  await expect(experience.getByRole('button', { name: 'Just doing a trim.' })).toBeVisible();
  await expect(experience.getByRole('button', { name: 'Show me my best hairstyles' })).toBeVisible();
  await expect(experience).not.toContainText('Marcus Rivera');
  await expect(experience.locator('video')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('FREE — NO APP');
  await expect(page.locator('body')).not.toContainText('Shop your next cut on your own head.');
  expect(await page.content()).not.toContain('landing_face2');

  await experience.getByRole('button', { name: 'Show me my best hairstyles' }).click();
  await expect(experience.locator('.bc-orbit')).toBeVisible();
  await expect(experience.getByText('Let’s see how it looks on you!')).toBeVisible();
  await expect(experience.locator('[data-testid="signup-widget-stub"]')).toHaveCount(0);
  await expect(experience).toContainText(/sign|account|continue/i, { timeout: 10_000 });
});

test('the public ticket uses the required vertical order on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/b/playwright-preview');

  const positions = await page.evaluate(() => {
    const who = document.querySelector('.bc-who')?.getBoundingClientRect();
    const experience = document.querySelector('.bc-exp')?.getBoundingClientRect();
    const details = document.querySelector('.bc-details')?.getBoundingClientRect();
    return {
      whoTop: who?.top ?? -1,
      experienceTop: experience?.top ?? -1,
      detailsTop: details?.top ?? -1,
      layoutDirection: getComputedStyle(document.querySelector('.bc-layout')!).flexDirection,
    };
  });

  expect(positions.layoutDirection).toBe('column');
  expect(positions.whoTop).toBeGreaterThanOrEqual(0);
  expect(positions.experienceTop).toBeGreaterThan(positions.whoTop);
  expect(positions.detailsTop).toBeGreaterThan(positions.experienceTop);
  await expect(page.locator('body')).toHaveCSS('overflow-x', 'hidden');
});

test('the desktop ticket renders the diagonal split', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/b/playwright-preview');
  await expect(page.locator('.bc-seam')).toHaveCSS('display', 'block');
  await expect(page.locator('.bc-layout')).toHaveCSS('grid-template-columns', /.+ .+/);
});

test('the for-barbers pitch page routes into the builder without crashing', async ({ page }) => {
  await page.goto('/for-barbers');
  await expect(page.locator('body')).not.toContainText(/application error|runtime error|unhandled/i);
  await expect(page.locator('a[href="/barber"]').first()).toBeVisible();
});

test('an unknown barber ticket 404s cleanly', async ({ page }) => {
  const response = await page.goto('/b/definitely-not-a-real-barber-slug');
  expect(response?.status()).toBe(404);
  await expect(page.locator('body')).not.toContainText(/application error|runtime error|unhandled/i);
});

test('the builder is reachable and gates editing behind sign-in', async ({ page }) => {
  await page.goto('/barber');
  await expect(page.locator('body')).not.toContainText(/application error|runtime error|unhandled/i);
  await expect(page.locator('body')).toContainText(/sign in|build your barber card/i);
  await expect(page.locator('.barber-builder-form')).toHaveCount(0);
});
