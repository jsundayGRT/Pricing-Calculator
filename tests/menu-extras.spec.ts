import { expect, test } from '@playwright/test';
import { openCalculator } from './drive';
import { signIn } from './session';

test('the lock form already has the signed-in rep\'s name', async ({ page, context }) => {
  await signIn(context);
  const frame = await openCalculator(page);
  await expect(frame.locator('#repname')).toHaveValue('Jared Sunday');
});

test('Help & feedback opens from the menu with a feedback email link', async ({ page, context }) => {
  await signIn(context);
  await page.goto('/');
  await page.getByRole('button', { name: 'Jared Sunday' }).click();
  await page.getByRole('menuitem', { name: 'Help & feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Help & feedback' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Send feedback' }).first()).toHaveAttribute('href', /^mailto:.+\?subject=Pricing%20Calculator%20feedback$/);
});

test('reps choose how they hear about Deal Review decisions', async ({ page, context }) => {
  const rep = { name: 'Notify Rep', email: 'notify.rep@guardrail.tech', oid: 'notify-rep' };
  await signIn(context, rep);
  await page.goto('/');
  // the menu shows each way, and which are not set up on this server
  const { available } = await (await page.request.get('/api/me/notifications')).json();
  await page.getByRole('button', { name: rep.name }).click();
  const email = page.getByRole('menuitemcheckbox', { name: /By email/ });
  await expect(email).toBeVisible();
  await expect(page.getByRole('menuitemcheckbox', { name: /In Slack/ })).toBeVisible();
  if (!available.email) await expect(email).toContainText('Not set up');

  // the choice is saved per person
  let res = await page.request.post('/api/me/notifications', { data: { slack: false } });
  expect((await res.json()).prefs).toEqual({ email: true, slack: false });
  res = await page.request.get('/api/me/notifications');
  expect((await res.json()).prefs).toEqual({ email: true, slack: false });
  await page.request.post('/api/me/notifications', { data: { slack: true } });
});
