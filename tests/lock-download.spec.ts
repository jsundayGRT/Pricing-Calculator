import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { applyScenario, openCalculator } from './drive';
import { scenarios } from './scenarios';
import { signIn } from './session';

test('every request goes to review, and its PDF and proposal come once it is approved', async ({ page, context }) => {
  await signIn(context);
  const frame = await openCalculator(page);
  await applyScenario(frame, scenarios[0]); // standard pricing: still reviewed
  await expect(frame.locator('#lockbtn')).toHaveText('Send for review');
  await frame.locator('#repname').fill('Avery Rep');
  await frame.locator('#cname').fill('Northwind');

  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/quotes') && r.request().method() === 'POST');
  await frame.locator('#lockbtn').click();
  const quote = (await (await saved).json()).quote as { id: string; status: string };
  expect(quote.status).toBe('DEAL REVIEW');
  await expect(frame.locator('.toast')).toContainText('once it\'s approved');
  await expect(frame.locator('#printbtn')).toBeHidden();
  await expect(frame.locator('#docxbtn')).toBeHidden();
  await page.waitForTimeout(400);
  expect(downloads).toBe(0);

  // an admin approves it
  expect((await page.request.post(`/api/admin/quotes/${quote.id}`, { data: { action: 'approve' } })).ok()).toBe(true);

  // opened again, it offers the quote PDF and the proposal
  await page.goto(`/calculator?revise=${encodeURIComponent(quote.id)}`);
  const again = page.frameLocator('iframe.calc-frame');
  // an icon-only button: the label is its hover text and accessible name
  await expect(again.locator('#printbtn')).toHaveAccessibleName('Download quote PDF');
  const pdf = page.waitForEvent('download');
  await again.locator('#printbtn').click();
  expect((await pdf).suggestedFilename()).toMatch(/\.pdf$/);
  const proposal = page.waitForEvent('download');
  await again.locator('#docxbtn').click();
  const file = await proposal;
  expect(file.suggestedFilename()).toMatch(/^Guardrail Proposal - Northwind - GRT-.*\.docx$/);
  expect(readFileSync(await file.path()).subarray(0, 2).toString()).toBe('PK');
});

test('pricing beyond the standard limits is flagged on the price card', async ({ page, context }) => {
  await signIn(context);
  const frame = await openCalculator(page);
  await applyScenario(frame, scenarios[0]);
  // a non-standard pilot module needs approval
  const content = frame.locator('#pilot .chip[data-k="content"]');
  if ((await content.getAttribute('aria-pressed')) !== 'true') await content.click();
  await expect(frame.locator('#out .status-row.review')).toBeVisible();
  await expect(frame.locator('#lockbtn')).toHaveText('Send for review');
});

test('a rep gets the proposal only once it is approved; reviewers can read it before', async ({ page, context, browser }) => {
  const rep = { name: 'Proposal Rep', email: 'proposal.rep@guardrail.tech', oid: 'proposal-rep' };
  await signIn(context, rep);
  const frame = await openCalculator(page);
  await applyScenario(frame, scenarios[0]);
  await frame.locator('#cname').fill('Acme');
  await expect(frame.locator('#repname')).toHaveValue('Proposal Rep');
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/quotes') && r.request().method() === 'POST');
  await frame.locator('#lockbtn').click();
  const quote = (await (await saved).json()).quote as { id: string };
  expect((await page.request.get(`/api/quotes/${quote.id}/proposal`)).status()).toBe(403);

  const admin = await browser.newContext();
  await signIn(admin);
  const res = await admin.request.get(`/api/quotes/${quote.id}/proposal`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('wordprocessingml');
  expect((await admin.request.post(`/api/admin/quotes/${quote.id}`, { data: { action: 'approve' } })).ok()).toBe(true);
  await admin.close();

  expect((await page.request.get(`/api/quotes/${quote.id}/proposal`)).status()).toBe(200);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Proposal (Word)' })).toHaveAttribute('href', `/api/quotes/${quote.id}/proposal`);
});
