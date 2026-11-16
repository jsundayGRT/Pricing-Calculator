import { readFileSync } from 'node:fs';
import { readZip, writeZip } from '../src/lib/zip';
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
  await expect(again.locator('#printbtn')).toHaveAccessibleName('Download proposal PDF');
  const pdf = page.waitForEvent('download');
  await again.locator('#printbtn').click();
  expect((await pdf).suggestedFilename()).toMatch(/^Guardrail Proposal - Northwind - GRT-.*\.pdf$/);
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
  // and its PDF, in the template's design
  const pdf = await admin.request.get(`/api/quotes/${quote.id}/proposal?format=pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  expect((await admin.request.post(`/api/admin/quotes/${quote.id}`, { data: { action: 'approve' } })).ok()).toBe(true);
  await admin.close();

  expect((await page.request.get(`/api/quotes/${quote.id}/proposal`)).status()).toBe(200);
  expect((await page.request.get(`/api/quotes/${quote.id}/proposal?format=pdf`)).status()).toBe(200);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', `/api/quotes/${quote.id}/proposal?format=pdf`);
  await expect(page.getByRole('link', { name: 'Proposal (Word)' })).toHaveAttribute('href', `/api/quotes/${quote.id}/proposal`);
});

test('a rep previews the draft, attaches their edit, and the approved proposal is their version', async ({ page, context, browser }) => {
  const rep = { name: 'Edit Rep', email: 'edit.rep@guardrail.tech', oid: 'edit-rep' };
  await signIn(context, rep);
  const frame = await openCalculator(page);
  await applyScenario(frame, scenarios[0]);
  await frame.locator('#cname').fill('Contoso');

  // preview opens the draft proposal in a new tab
  const tab = context.waitForEvent('page');
  await frame.locator('#previewbtn').click();
  const preview = await tab;
  await expect(preview.locator('body')).toContainText('DRAFT ESTIMATE');
  await expect(preview.locator('body')).toContainText('Contoso');
  await preview.close();

  // the rep downloads the draft and edits it in Word
  const dl = page.waitForEvent('download');
  await frame.locator('#sampledocx').click();
  const zip = readZip(readFileSync(await (await dl).path()));
  const doc = zip.find((e) => e.name === 'word/document.xml')!;
  doc.data = Buffer.from(doc.data.toString('utf8').replace('Guardrail builds AI control', 'Edited by the rep. Guardrail builds AI control'), 'utf8');
  await frame.locator('#proposalfile').setInputFiles({ name: 'Contoso edited.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: writeZip(zip) });
  await expect(frame.locator('#attach-name')).toHaveText('Contoso edited.docx');

  const saved = page.waitForResponse((r) => r.url().endsWith('/api/quotes') && r.request().method() === 'POST');
  await frame.locator('#lockbtn').click();
  const quote = (await (await saved).json()).quote as { id: string; proposalUpload: { name: string } };
  expect(quote.proposalUpload.name).toBe('Contoso edited.docx');
  await expect(frame.locator('#attached')).toBeHidden(); // cleared for the next request

  // the rep can preview it in review, not download it
  const html = await (await page.request.get(`/api/quotes/${quote.id}/proposal?format=html`)).text();
  expect(html).toContain('Edited by the rep.');
  expect(html).toContain('Edited by Edit Rep');
  expect((await page.request.get(`/api/quotes/${quote.id}/proposal`)).status()).toBe(403);

  // the reviewer sees it is the rep's edit, then approves
  const admin = await browser.newContext();
  await signIn(admin);
  const detail = await (await admin.request.get(`/api/admin/quotes/${quote.id}`)).json();
  expect(detail.summary.proposalUpload.name).toBe('Contoso edited.docx');
  expect((await admin.request.post(`/api/admin/quotes/${quote.id}`, { data: { action: 'approve' } })).ok()).toBe(true);
  await admin.close();

  // approved: the rep's version, without the draft line; it can no longer be changed
  const res = await page.request.get(`/api/quotes/${quote.id}/proposal`);
  expect(res.status()).toBe(200);
  const final = readZip(await res.body()).find((e) => e.name === 'word/document.xml')!.data.toString('utf8');
  expect(final).toContain('Edited by the rep.');
  expect(final).not.toContain('DRAFT ESTIMATE');
  expect((await page.request.delete(`/api/quotes/${quote.id}/proposal`)).status()).toBe(409);
  // an edited proposal's PDF comes from Word, not from here
  expect((await page.request.get(`/api/quotes/${quote.id}/proposal?format=pdf`)).status()).toBe(409);
});

test('on the dashboard a rep attaches an edited proposal to a request in review, or goes back to the template', async ({ page, context }) => {
  const rep = { name: 'Attach Rep', email: 'attach.rep@guardrail.tech', oid: 'attach-rep' };
  await signIn(context, rep);
  const frame = await openCalculator(page);
  await applyScenario(frame, scenarios[0]);
  await frame.locator('#cname').fill('Fabrikam');
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/quotes') && r.request().method() === 'POST');
  await frame.locator('#lockbtn').click();
  const quote = (await (await saved).json()).quote as { id: string };

  // not a Word file
  expect((await page.request.put(`/api/quotes/${quote.id}/proposal`, { data: Buffer.from('hello') })).status()).toBe(400);

  await page.goto('/');
  const card = page.locator('.quote-card', { hasText: 'Fabrikam' });
  await expect(card.getByRole('link', { name: 'Preview proposal' })).toHaveAttribute('href', `/api/quotes/${quote.id}/proposal?format=html`);
  const template = readFileSync('content/proposal-template.docx');
  await card.locator('input[type=file]').setInputFiles({ name: 'Fabrikam v2.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: template });
  await expect(card).toContainText('Your edited proposal: Fabrikam v2.docx');
  await card.getByRole('button', { name: 'Use template' }).click();
  await expect(card).not.toContainText('Your edited proposal');
  await expect(card.getByRole('button', { name: 'Attach edited proposal' })).toBeVisible();
});
