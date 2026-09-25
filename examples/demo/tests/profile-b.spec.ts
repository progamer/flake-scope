import { test, expect } from '@playwright/test';

// Deliberately racy: profile-a and profile-b share alice's account and run on
// different workers at the same time. Whichever saves last wins; the other
// fails its first attempt and passes on retry once it runs alone.
test('renames the profile to Alice B', async ({ page }) => {
  test.info().annotations.push({ type: 'flakescope:resource', description: 'account:alice' });

  await page.goto('/profile');
  await page.getByLabel('Display name').fill('Alice B');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('display-name')).toHaveText('Alice B');

  // Stand-in for the rest of a real flow (upload avatar, change settings, …).
  await page.waitForTimeout(1_500);

  await page.reload();
  await expect(page.getByTestId('display-name')).toHaveText('Alice B');
});
