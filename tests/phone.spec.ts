import { expect, test } from './fixtures';
import { signIn } from './session';

test.use({ viewport: { width: 390, height: 844 } });

const noSideways = (page: import('@playwright/test').Page) => page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth
  && [...document.querySelectorAll('.table-wrap')].every((t) => t.scrollWidth <= t.clientWidth));

test('the calculator fits the phone screen, with its price bar in view', async ({ page, context }) => {
  await signIn(context);
  await page.goto('/calculator');
  const frame = page.frameLocator('iframe.calc-frame');
  // the employee count comes first: it picks the band
  const first = await frame.locator('.card.step').first().locator('input, select').first().getAttribute('id');
  expect(first).toBe('empcount');
  await frame.locator('#empcount').fill('60');
  await frame.locator('#location').selectOption('US');
  await frame.locator('#modules .chip[data-k="shadow"]').click();
  await expect(frame.locator('#mbar')).toBeVisible();
  const fit = await page.evaluate(() => {
    const fr = document.querySelector('iframe.calc-frame') as HTMLIFrameElement;
    const bar = fr.contentDocument!.querySelector('#mbar')!.getBoundingClientRect();
    return { pageScrolls: document.documentElement.scrollHeight > innerHeight, barBottom: fr.getBoundingClientRect().top + bar.bottom, height: innerHeight };
  });
  expect(fit.pageScrolls).toBe(false);
  expect(fit.barBottom).toBeLessThanOrEqual(fit.height + 1);
});

test('the Executive Dashboard shows requests as cards, with filters folded away', async ({ page, context }) => {
  await signIn(context);
  await page.goto('/executive');
  await expect(page.getByLabel('Search')).toBeVisible();
  await expect(page.getByLabel('Status')).toBeHidden();
  await page.getByRole('button', { name: /More filters/ }).click();
  await expect(page.getByLabel('Status')).toBeVisible();
  await page.getByRole('button', { name: 'Fewer filters' }).click();
  await expect(page.getByLabel('Status')).toBeHidden();
  // each request's status shows on its card, not off to the right
  const pill = page.locator('table.exec tbody tr .pill').first();
  if (await pill.count()) {
    await pill.scrollIntoViewIfNeeded();
    const box = await pill.boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(390);
  }
  expect(await noSideways(page)).toBe(true);
});

test('the Dashboard stat boxes sit in one row', async ({ page, context }) => {
  await signIn(context);
  await page.goto('/');
  const tops = await page.locator('.stats .stat').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(tops.length).toBe(3);
  expect(new Set(tops).size).toBe(1);
  expect(await noSideways(page)).toBe(true);
});
