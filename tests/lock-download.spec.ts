import { expect, test } from '@playwright/test';
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
  await expect(frame.locator('#printbtn')).toBeVisible();
  await expect(frame.locator('#printbtn')).toHaveText('Download quote PDF');
  await page.waitForTimeout(600);
  expect(downloads).toBe(0);

  const download = page.waitForEvent('download');
  await frame.locator('#printbtn').click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  expect(downloads).toBe(1);
});
