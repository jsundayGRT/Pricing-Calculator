import { expect, test } from '@playwright/test';
import { openCalculator } from './drive';
import { signIn } from './session';

test('locked requests stay on the dashboard and required shows on hover', async ({ page, context }) => {
  await signIn(context);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Locked requests' })).toBeVisible();

  const frame = await openCalculator(page);
  await expect(frame.locator('#history-card')).toHaveCount(0);
  await expect(frame.getByText('Your locked requests')).toHaveCount(0);

  const required = frame.locator('label[for="band"] .req');
  await expect(required).toBeHidden();
  await frame.locator('#band').hover();
  await expect(required).toBeVisible();
  await expect(required).toHaveText('Required');
});
