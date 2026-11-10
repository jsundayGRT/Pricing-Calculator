import { expect, test } from './fixtures';
import { applyScenario, openCalculator } from './drive';
import { scenarios } from './scenarios';
import { signIn } from './session';

test('locking a request does not download the quote until asked', async ({ page, context }) => {
  await signIn(context);
  const frame = await openCalculator(page);
  await applyScenario(frame, scenarios[0]);
  await frame.locator('#repname').fill('Avery Rep');
  await frame.locator('#cname').fill('Northwind');

  let downloads = 0;
  page.on('download', () => { downloads += 1; });

  await frame.locator('#lockbtn').click();
  // an icon-only button: the label is its hover text and accessible name
  await expect(frame.locator('#printbtn')).toBeVisible();
  await expect(frame.locator('#printbtn')).toHaveAccessibleName('Download quote PDF');
  await expect(frame.locator('#printbtn')).toHaveAttribute('title', 'Download quote PDF');
  await page.waitForTimeout(600);
  expect(downloads).toBe(0);

  const download = page.waitForEvent('download');
  await frame.locator('#printbtn').click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  expect(downloads).toBe(1);
});

test('a Deal Review has no quote PDF until it is approved', async ({ page, context }) => {
  await signIn(context);
  const frame = await openCalculator(page);
  await applyScenario(frame, scenarios[0]);
  // a non-standard pilot module sends the request to Deal Review
  const content = frame.locator('#pilot .chip[data-k="content"]');
  if ((await content.getAttribute('aria-pressed')) !== 'true') await content.click();
  await expect(frame.locator('#lockbtn')).toHaveText('Lock for Deal Review');
  await frame.locator('#repname').fill('Avery Rep');
  await frame.locator('#cname').fill('Review Co');
  await frame.locator('#lockbtn').click();
  await expect(frame.locator('.toast')).toContainText('available once it');
  await expect(frame.locator('#printbtn')).toBeHidden();
});
