import { readFileSync } from 'node:fs';
import type { FrameLocator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openCalculator } from './drive';
import { signIn } from './session';
import { readZip } from '../src/lib/zip';

type Saved = { id: string; requestId: string; version: number; customerName: string };

async function savedQuotes(page: Page): Promise<Saved[]> {
  const res = await page.request.get('/api/quotes');
  return (await res.json()).quotes;
}

async function lock(page: Page, frame: FrameLocator) {
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/quotes') && r.request().method() === 'POST');
  await frame.locator('#lockbtn').click();
  return (await (await saved).json()).quote as Saved;
}

async function pickShadow(frame: FrameLocator) {
  await frame.locator('#location').selectOption('US');
  await frame.locator('#modules .chip[data-k="shadow"]').click();
  await frame.locator('#out .hero .amount').waitFor({ state: 'visible' });
}

test('the employee count picks the band that covers it', async ({ page, context }) => {
  await signIn(context);
  const frame = await openCalculator(page);
  const band = frame.locator('#band'), count = frame.locator('#empcount');

  await count.fill('15');
  await expect(band).toHaveValue('Micro');
  await count.fill('21');
  await expect(band).toHaveValue('SMB');
  await count.fill('25');
  await expect(band).toHaveValue('SMB');
  await expect(frame.locator('#empcount-hint')).toContainText('SMB band (21–100 employees)');
  await expect(frame.locator('#band option[value="SMB"]')).toHaveText('SMB (21–100 employees)');

  // the price moves when the count crosses into the next band
  await pickShadow(frame);
  const smb = await frame.locator('#out .hero .amount').innerText();
  await count.fill('150');
  await expect(band).toHaveValue('Mid-Market');
  await expect(frame.locator('#out .hero .amount')).not.toHaveText(smb);

  // a band too small for the count clears it
  await band.selectOption('Micro');
  await expect(count).toHaveValue('');
  await expect(frame.locator('#empcount-hint')).toContainText('count of 150 was cleared');

  // above the largest band the count becomes the Enterprise seat count
  await count.fill('1500');
  await expect(band).toHaveValue('Enterprise');
  await expect(frame.locator('#seats')).toHaveValue('1500');
  await expect(frame.locator('#empcount-field')).toBeHidden();
});

test('AI Command Center is off by default and a product is needed for a price', async ({ page, context }) => {
  await signIn(context);
  const frame = await openCalculator(page);
  await expect(frame.locator('#commandCenter')).toHaveAttribute('aria-checked', 'false');
  await frame.locator('#band').selectOption('SMB');
  await frame.locator('#location').selectOption('US');
  await expect(frame.locator('#empty-msg')).toHaveText('Choose a Traffic Light module or AI Command Center to see pricing.');
  await expect(frame.locator('#out')).toBeHidden();
  await frame.locator('#commandCenter').click();
  await expect(frame.locator('#out .hero .amount')).toBeVisible();
});

test('Edit in Word downloads the draft proposal without saving anything; the estimate PDF is still there by API', async ({ page, context }) => {
  await signIn(context);
  const frame = await openCalculator(page);
  await frame.locator('#empcount').fill('40');
  await pickShadow(frame);
  await frame.locator('#cname').fill('Bank of the Rockies');
  await expect(frame.locator('#stage')).toHaveCount(0); // no Stage field
  await expect(frame.locator('#hubspot')).toHaveCount(0); // no HubSpot deal to pick
  await expect(frame.locator('#samplepdf')).toHaveCount(0); // no separate estimate row

  let posts = 0;
  page.on('request', (r) => { if (r.url().endsWith('/api/quotes') && r.method() === 'POST') posts += 1; });

  const docxDl = page.waitForEvent('download');
  await frame.locator('#sampledocx').click();
  const docx = await docxDl;
  // the draft proposal: Guardrail's template, marked as a draft
  expect(docx.suggestedFilename()).toMatch(/^Guardrail Draft Proposal - Bank of the Rockies - \d{4}-\d{2}-\d{2}\.docx$/);
  const entries = readZip(readFileSync(await docx.path()));
  const xml = entries.find((e) => e.name === 'word/document.xml')!.data.toString('utf8');
  expect(xml).toContain('Bank of the Rockies');
  expect(xml).toContain('DRAFT ESTIMATE');
  expect(xml).toContain('Traffic Light: Shadow');

  await page.waitForTimeout(500);
  expect(posts).toBe(0);
});

test('pricing that needs Deal Review still offers the preview and the draft proposal', async ({ page, context }) => {
  await signIn(context);
  const frame = await openCalculator(page);
  await frame.locator('#empcount').fill('40');
  await pickShadow(frame);
  await frame.locator('#pilot .chip[data-k="content"]').click(); // a non-standard pilot needs approval
  await expect(frame.locator('#out .status-row.review')).toBeVisible();
  await expect(frame.locator('#sampledocx')).toBeVisible();
  await expect(frame.locator('#previewbtn')).toBeVisible();
  await expect(frame.locator('#attachbtn')).toBeVisible();
});

test('revising an older version saves the next version instead of overwriting', async ({ page, context }) => {
  await signIn(context);
  const frame = await openCalculator(page);
  await frame.locator('#empcount').fill('60');
  await pickShadow(frame);
  await frame.locator('#repname').fill('Avery Rep');
  await frame.locator('#cname').fill('Revision Test');
  const v1 = await lock(page, frame);
  await frame.locator('#earlyPay').click();
  const v2 = await lock(page, frame);
  expect(v2.version).toBe(2);

  // reopen version 1 from the dashboard and lock it again
  await page.goto(`/calculator?revise=${encodeURIComponent(v1.id)}`);
  const again = page.frameLocator('iframe.calc-frame');
  await expect(again.locator('#revise-banner')).toContainText('from version 1 (latest is version 2). Locking saves version 3');
  await expect(again.locator('#repname')).toHaveValue('Avery Rep');
  await again.locator('#term button[data-v="2-Year"]').click(); // a change, so it can lock
  const v3 = await lock(page, again);
  expect(v3.version).toBe(3);

  const versions = (await savedQuotes(page)).filter((q) => q.requestId === v1.requestId);
  expect(versions.map((q) => q.version).sort()).toEqual([1, 2, 3]);
  for (const q of versions) await page.request.delete(`/api/quotes/${q.id}`);
});

test('picking Drift turns on AI Command Center, which stays on while Drift is picked', async ({ page, context }) => {
  await signIn(context);
  const frame = await openCalculator(page);
  await frame.locator('#empcount').fill('40');
  await frame.locator('#location').selectOption('US');
  const cc = frame.locator('#commandCenter');
  await expect(cc).toHaveAttribute('aria-checked', 'false');

  await frame.locator('#modules .chip[data-k="drift"]').click();
  await expect(cc).toHaveAttribute('aria-checked', 'true');
  await expect(cc).toHaveAttribute('aria-disabled', 'true');
  await expect(frame.locator('#cc-hint')).toHaveText('Included with Drift.');
  await expect(frame.locator('#out')).toContainText('AI Command Center');

  await expect(cc).toBeDisabled();
  await cc.dispatchEvent('click'); // a click still can't turn it off while Drift is picked
  await expect(cc).toHaveAttribute('aria-checked', 'true');

  // without Drift it is a choice again
  await frame.locator('#modules .chip[data-k="drift"]').click();
  await expect(cc).toHaveAttribute('aria-disabled', 'false');
  await expect(frame.locator('#cc-hint')).toBeHidden();
  await cc.click();
  await expect(cc).toHaveAttribute('aria-checked', 'false');
});
