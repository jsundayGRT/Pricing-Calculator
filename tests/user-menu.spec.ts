import { expect, test } from './fixtures';
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
  await expect(page.getByRole('menuitemcheckbox', { name: /By email/ })).toBeVisible(); // notification choices loaded
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemcheckbox', { name: /By email/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemcheckbox', { name: /In Slack/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Help & feedback' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Manage roles' })).toBeFocused(); // admins only
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(appearance).toBeFocused();

  // light by default; the switch (checked = dark) turns dark on and off
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(appearance).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');
  await expect(appearance).toHaveAttribute('aria-checked', 'true');
  await appearance.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('on a phone every top link fits without scrolling', async ({ page, context }) => {
  await signIn(context);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const nav = page.locator('nav.nav');
    // short label on screen, full name for screen readers
    expect((await nav.getByRole('link', { name: 'Executive Dashboard' }).innerText()).trim()).toBe('Executive');
    expect(await nav.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  expect((await page.locator('nav.nav').getByRole('link', { name: 'Executive Dashboard' }).innerText()).trim()).toBe('Executive Dashboard');
});
