import { expect, test } from '@playwright/test';
import { signIn } from './session';

const rep = { name: 'Playwright Rep', email: 'playwright.rep@guardrail.tech', oid: 'playwright-rep' };

test('admins manage who is an admin or a rep from the user menu', async ({ browser }) => {
  const adminCtx = await browser.newContext();
  await signIn(adminCtx);
  const admin = await adminCtx.newPage();

  // add the rep from the Manage roles page, reached from the user menu
  await admin.goto('/');
  await admin.getByRole('button', { name: 'Jared Sunday' }).click();
  await admin.getByRole('menuitem', { name: 'Manage roles' }).click();
  await expect(admin.getByRole('heading', { name: 'Manage roles' })).toBeVisible();
  await expect(admin.getByText(/\d+ people · \d+ admins?/)).toBeVisible(); // the list has loaded
  await admin.getByLabel('Email').fill(rep.email);
  await admin.getByLabel(/^Name/).fill(rep.name);
  await admin.getByRole('button', { name: 'Add person' }).click();
  await expect(admin.getByRole('status')).toHaveText('Playwright Rep is now a rep.');
  // admins can't change their own role
  await expect(admin.getByLabel('Role for Jared Sunday')).toBeDisabled();

  // as a rep: no menu item, no page, no API
  const repCtx = await browser.newContext();
  await signIn(repCtx, rep);
  const r = await repCtx.newPage();
  await r.goto('/');
  // opening the app counts as activity, even without a fresh sign-in
  await admin.reload();
  await expect(admin.getByRole('row', { name: /Playwright Rep/ }).getByRole('cell').nth(1)).not.toHaveText('Not yet');
  await r.getByRole('button', { name: rep.name }).click();
  await expect(r.getByRole('menuitem', { name: 'Manage roles' })).toHaveCount(0);
  await r.goto('/admin/roles');
  await expect(r.getByText('Only admins can manage roles.')).toBeVisible();
  expect((await r.request.get('/api/admin/roles')).status()).toBe(403);
  expect((await r.request.post('/api/admin/roles', { data: { email: rep.email, role: 'admin' } })).status()).toBe(403);

  // made an admin: the rep now gets the Executive Dashboard
  await admin.getByLabel('Role for Playwright Rep').selectOption('admin');
  await expect(admin.getByRole('status')).toHaveText('Playwright Rep is now an admin.');
  await r.goto('/');
  await expect(r.getByRole('link', { name: 'Executive Dashboard' })).toBeVisible();

  // and back to a rep
  await admin.getByLabel('Role for Playwright Rep').selectOption('rep');
  await expect(admin.getByRole('status')).toHaveText('Playwright Rep is now a rep.');
  await r.goto('/');
  await expect(r.getByRole('link', { name: 'Executive Dashboard' })).toHaveCount(0);

  await adminCtx.close();
  await repCtx.close();
});
