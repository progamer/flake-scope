import { test, expect } from '@playwright/test';

// Real product regression when the server runs with DEMO_REGRESSION=1:
// fails on every attempt with the same error.
test('cart total includes every item', async ({ request }) => {
  const res = await request.get('/api/cart/total');
  expect(await res.json()).toEqual({ totalCents: 2749 });
});
