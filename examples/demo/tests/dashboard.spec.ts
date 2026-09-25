import { test, expect } from '@playwright/test';

// Environment/resource flake: the first request hits a cold cache and exceeds
// the test timeout; the retry finds it warm.
test('dashboard loads', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard')).toHaveText('Dashboard ready');
});
