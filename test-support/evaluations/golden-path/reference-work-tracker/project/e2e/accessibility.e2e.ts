import { expect, test } from '@playwright/test';

test('the board flow keeps accessible names and keyboard operability', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Reference work tracker' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Boards' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Work items' })).toBeVisible();
  const start = page.getByRole('button', { name: 'Start' }).first();
  await start.focus();
  await expect(start).toBeFocused();
  await expect(start).toBeEnabled();
});
