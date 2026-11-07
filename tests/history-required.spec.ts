import { expect, test } from '@playwright/test';
import { openCalculator } from './drive';
import { signIn } from './session';

test('locked requests stay on the dashboard and fields have no required marker', async ({ page, context }) => {
  await signIn(context);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Locked requests' })).toBeVisible();
  await expect(page.locator('.welcome')).toContainText('Welcome back, Jared Sunday');

  const frame = await openCalculator(page);
  await expect(frame.locator('#history-card')).toHaveCount(0);
  await expect(frame.getByText('Your locked requests')).toHaveCount(0);
  await expect(frame.locator('.req')).toHaveCount(0);
  await expect(frame.getByText('Required', { exact: true })).toHaveCount(0);
});
