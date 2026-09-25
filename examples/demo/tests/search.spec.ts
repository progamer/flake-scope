import { test, expect } from '@playwright/test';

// Intermittent with no correlating signal: the first search response comes
// back unsorted. Nothing else in the run touches search.
test('search results are sorted', async ({ page }) => {
  await page.goto('/search');
  await expect(page.getByTestId('results').locator('li')).toHaveText(['apple', 'banana', 'cherry']);
});
