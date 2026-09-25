import { test as setup, expect } from '@playwright/test';

setup('sign in as alice', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('User').fill('alice');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('display-name')).toBeVisible();
  await page.context().storageState({ path: '.auth/alice.json' });
});
