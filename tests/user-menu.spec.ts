import { expect, test } from '@playwright/test';
import { signIn } from './session';

test('account details and sign out live in the user menu', async ({ page, context }) => {
  await signIn(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const menu = page.getByRole('button', { name: 'Jared Sunday' });
  await expect(menu).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toHaveCount(0);

  await menu.click();
  await expect(page.getByText('jared.sunday@guardrail.tech')).toBeVisible();
  // inside the menu (the header's Role chip also says Admin)
  await expect(page.getByRole('menu').getByText('Admin', { exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toHaveCount(0);
});
