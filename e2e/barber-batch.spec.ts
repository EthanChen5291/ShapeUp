import { expect, test, type Page } from '@playwright/test';

const SNAPSHOT_KEY = 'shapeup:barber-batch:e2e';
const SNAPSHOT_EVENT = 'shapeup:barber-batch:e2e-update';

type ItemStatus = 'pending' | 'editing' | 'rendering' | 'done' | 'failed';

function batchItem(idx: number, status: ItemStatus) {
  return {
    _id: `e2e-item-${idx}`,
    idx,
    title: [
      'Soft Taper',
      'Textured Crop',
      'Clean Side Part',
      'Natural Quiff',
      'Low Burst Fade',
      'Short Pompadour',
      'Layered Fringe',
      'Classic Scissor Cut',
    ][idx],
    prompt: `Complete haircut prompt ${idx + 1}`,
    why: 'Balances your features and works with your growth pattern.',
    status,
    ...(status === 'done' ? {
      imageUrl: idx % 2 === 0
        ? '/hair-previews/blowout-taper.png'
        : '/hair-previews/burst-fade-textured-fringe.png',
      splatS3Key: `facelifts/e2e-job-${idx}/result.splat`,
      ...(idx === 1 ? { videoS3Key: `facelifts/e2e-job-${idx}/turntable.mp4` } : {}),
    } : {}),
  };
}

function batchSnapshot(status: 'generating' | 'ready') {
  return {
    _id: 'e2e-batch-1',
    status,
    hairProfile: {
      curlClass: '3B',
      lengthInches: { top: 4, sides: 1, back: 1.5 },
      density: 'high',
      hairline: { state: 'mature', notes: 'slight temple recession' },
      growthPatterns: ['crown cowlick'],
      faceShape: 'oval',
    },
    items: Array.from({ length: 8 }, (_, idx) => (
      status === 'ready' || idx === 0
        ? batchItem(idx, 'done')
        : batchItem(idx, idx < 4 ? 'rendering' : 'pending')
    )),
  };
}

async function publishSnapshot(page: Page, snapshot: ReturnType<typeof batchSnapshot>) {
  await page.evaluate(({ key, eventName, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event(eventName));
  }, { key: SNAPSHOT_KEY, eventName: SNAPSHOT_EVENT, value: snapshot });
}

test('batch grid fills, enlarges, and resumes after reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const runtimeErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('[global-error]')) {
      runtimeErrors.push(message.text());
    }
  });
  await page.addInitScript(({ key }) => {
    const initializedKey = `${key}:initialized`;
    if (window.sessionStorage.getItem(initializedKey)) return;
    window.localStorage.removeItem(key);
    window.sessionStorage.setItem(initializedKey, '1');
  }, { key: SNAPSHOT_KEY });

  await page.route('**/api/facelift/warmup', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/proxy-ply**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: '' });
  });
  await page.route('**/api/barber-batch/item', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/barber-batch', async (route) => {
    const requestBody = route.request().postDataJSON() as {
      barberSlug?: string;
      selfieStorageId?: string;
    };
    expect(requestBody).toMatchObject({
      barberSlug: 'playwright-preview',
      selfieStorageId: 'e2e-selfie-storage',
    });

    await publishSnapshot(page, batchSnapshot('generating'));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, batchId: 'e2e-batch-1', status: 'ready', items: [] }),
    });
    await publishSnapshot(page, batchSnapshot('ready'));
  });

  await page.goto('/b/playwright-preview?batchE2e=1');
  await page.waitForTimeout(500);
  expect(runtimeErrors).toEqual([]);
  const experience = page.locator('.bc-exp');
  await expect(experience.getByText('Here’s how it works.')).toBeVisible();
  await experience.getByRole('button', { name: "Let's go." }).click();
  await page.waitForTimeout(500);
  expect(runtimeErrors).toEqual([]);

  const fileInput = experience.locator('input[type="file"]');
  await fileInput.setInputFiles('public/hair-previews/blowout-taper.png');

  const grid = experience.locator('.bbf-grid');
  await expect(grid).toBeVisible({ timeout: 15_000 });
  await expect(grid.locator('.bbf-tile-shell')).toHaveCount(8);
  expect(await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
  await expect(experience.getByText(/Curly 3B · dense · slight temple recession/)).toBeVisible();
  await expect(experience.getByTestId('batch-image-fallback').first()).toBeVisible();

  await experience.getByRole('button', { name: 'Open Soft Taper in 3D' }).click();
  await expect(experience.getByRole('heading', { name: 'Soft Taper' })).toBeVisible();
  await expect(experience.getByTestId('batch-hair-scene')).toHaveCount(1);
  await expect(experience.getByPlaceholder('Final Touches')).toHaveValue('');

  await page.reload();
  await expect(experience.getByText('Your looks from earlier')).toBeVisible();
  await expect(experience.locator('.bbf-grid')).toBeVisible();
  await expect(experience.locator('.bbf-tile-shell')).toHaveCount(8);

  await page.setViewportSize({ width: 1200, height: 900 });
  expect(await experience.locator('.bbf-grid').evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
  )).toBe(4);
});
