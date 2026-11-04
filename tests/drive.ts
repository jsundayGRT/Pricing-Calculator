import type { FrameLocator, Page } from '@playwright/test';
import type { Scenario } from './scenarios';

export async function openCalculator(page: Page) {
  await page.goto('/calculator', { waitUntil: 'networkidle' });
  const frame = page.frameLocator('iframe.calc-frame');
  await frame.locator('#band').waitFor({ state: 'visible' });
  await frame.locator('#band option[value="SMB"]').waitFor({ state: 'attached' });
  return frame;
}

async function setSwitch(frame: FrameLocator, id: string, on: boolean) {
  const button = frame.locator(`#${id}`);
  const checked = (await button.getAttribute('aria-checked')) === 'true';
  if (checked !== on) await button.click();
}

export async function applyScenario(frame: FrameLocator, scenario: Scenario) {
  await setSwitch(frame, 'pilotOn', scenario.pilot);
  await frame.locator('#band').selectOption(scenario.band);
  await frame.locator('#location').selectOption(scenario.location);
  if (scenario.band === 'Enterprise' && scenario.seats) {
    await frame.locator('#seats').fill(String(scenario.seats));
  }
  if (scenario.employees != null && scenario.band !== 'Enterprise') {
    await frame.locator('#empcount').fill(String(scenario.employees));
  }
  for (const key of scenario.modules) {
    const chip = frame.locator(`#modules .chip[data-k="${key}"]`);
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
  }
  await frame.locator(`#term button[data-v="${scenario.term}"]`).click();
  await setSwitch(frame, 'earlyPay', scenario.earlyPay);
  await setSwitch(frame, 'commandCenter', scenario.commandCenter);
  await setSwitch(frame, 'onPrem', scenario.onPrem);
  if (scenario.onPrem && scenario.scoped != null) {
    await frame.locator('#scoped').fill(String(scenario.scoped));
  }
  await frame.locator('#disc-range').evaluate((el, value) => {
    const input = el as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, scenario.discount);
  const amount = frame.locator('#out .hero .amount');
  await amount.waitFor({ state: 'visible' });
  await amount.page().waitForTimeout(450);
}

export async function readTotals(frame: FrameLocator) {
  const kpis = frame.locator('#out .hero .kpis b');
  return {
    finalPrice: (await frame.locator('#out .hero .amount').innerText()).trim(),
    dueAtSigning: (await kpis.nth(0).innerText()).replace(/\s+/g, ' ').trim(),
    recurring: (await kpis.nth(1).innerText()).trim(),
    totalDiscount: (await kpis.nth(2).innerText()).replace(/\s+/g, ' ').trim(),
    lockLabel: (await frame.locator('#lockbtn').innerText()).trim(),
  };
}

export async function fitFrame(page: Page) {
  await page.evaluate(() => {
    const frame = document.querySelector('iframe.calc-frame') as HTMLIFrameElement | null;
    const doc = frame?.contentDocument;
    if (!frame || !doc) return;
    frame.style.height = `${doc.documentElement.scrollHeight}px`;
  });
}
