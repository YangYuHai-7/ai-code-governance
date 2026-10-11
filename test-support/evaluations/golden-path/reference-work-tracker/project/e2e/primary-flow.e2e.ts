import { expect, test } from '@playwright/test';

test('a member moves a work item through the primary flow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Boards' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Boards' })).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).first().click();
  await expect(page.getByText('in-progress')).toBeVisible();
});
