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
  // the role shows only in the menu, not in the header
  await expect(page.getByRole('menu').getByText('Admin', { exact: true })).toBeVisible();
  await expect(page.getByText('Role', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toHaveAttribute('href', '/api/auth/logout');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toHaveCount(0);
  await expect(menu).toBeFocused();
});

test('the Appearance switch in the user menu changes the theme', async ({ page, context }) => {
  await signIn(context);
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('grt-theme'));
  await page.reload();

  await page.getByRole('button', { name: 'Jared Sunday' }).click();
  const appearance = page.getByRole('menuitemcheckbox', { name: /Appearance/ });
  // the first row has focus, and the arrow keys move between rows
  await expect(appearance).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(appearance).toBeFocused();

  await expect(appearance).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(appearance).toHaveAttribute('aria-checked', 'false');
  await appearance.click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');
});
