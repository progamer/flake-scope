import { test, expect } from '@playwright/test';

test('home page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'FlakeScope demo app' })).toBeVisible();
});

test('links to the profile', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
});
