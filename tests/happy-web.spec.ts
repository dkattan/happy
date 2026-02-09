import { test, expect } from './fixtures';

test('home loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Happy/i);
});
