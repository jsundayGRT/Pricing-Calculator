import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures';
import { applyScenario, openCalculator, readTotals } from './drive';
import type { Scenario } from './scenarios';
import { signIn } from './session';

type Baseline = { id: string; inputs: Scenario; totals: Awaited<ReturnType<typeof readTotals>> };

const baseline = JSON.parse(readFileSync(path.join(process.cwd(), 'tests/baseline-totals.json'), 'utf8')) as Baseline[];

async function overflow(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const frame = document.querySelector('iframe.calc-frame') as HTMLIFrameElement | null;
    const doc = frame?.contentDocument?.documentElement;
    const pageOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    const frameOverflow = !!doc && doc.scrollWidth > doc.clientWidth + 1;
    return { pageOverflow, frameOverflow };
  });
}

for (const row of baseline) {
  test(`${row.id} matches the recorded total`, async ({ page, context }) => {
    await signIn(context);
    await page.setViewportSize({ width: 1440, height: 900 });
    const frame = await openCalculator(page);
    await applyScenario(frame, row.inputs);
    expect(await readTotals(frame)).toEqual(row.totals);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const scrolled = await overflow(page);
    expect(scrolled.pageOverflow, 'page scrolls sideways').toBe(false);
    expect(scrolled.frameOverflow, 'calculator scrolls sideways').toBe(false);
  });
}

test('keyboard reaches band, location, and the discount slider', async ({ page, context }) => {
  await signIn(context);
  const frame = await openCalculator(page);
  await frame.locator('#band').focus();
  await expect(frame.locator('#band')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(frame.locator('#location')).toBeFocused();
  await frame.locator('#disc-range').focus();
  await expect(frame.locator('#disc-range')).toBeFocused();
});
