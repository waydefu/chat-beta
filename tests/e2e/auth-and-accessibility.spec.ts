import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('signed-out landing page is keyboard-ready and has no serious axe violations', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const login = page.getByRole('button', { name: /Google 登入/u });
  await expect(login).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(login).toBeFocused();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
});
