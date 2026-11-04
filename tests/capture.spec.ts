import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { fitFrame, openCalculator, applyScenario, readTotals } from './drive';
import { scenarios } from './scenarios';
import { signIn } from './session';

const phase = process.env.CAPTURE;
test.skip(!phase, 'Run with CAPTURE=before or CAPTURE=after');

test('screenshot calculator states and record totals', async ({ page, context }) => {
  test.setTimeout(120000);
  await signIn(context);
  const dir = `screenshots/${phase}`;
  mkdirSync(dir, { recursive: true });

  const shots: Array<{ name: string; prepare: () => Promise<void> }> = [
    {
      name: 'empty',
      prepare: async () => {},
    },
    {
      name: 'filled',
      prepare: async () => {
        const frame = page.frameLocator('iframe.calc-frame');
        await frame.locator('#band').selectOption('Enterprise');
        await frame.locator('#location').selectOption('US');
        await frame.locator('#modules .chip[data-k="shadow"]').click();
      },
    },
    {
      name: 'results',
      prepare: async () => {
        const frame = page.frameLocator('iframe.calc-frame');
        await applyScenario(frame, scenarios[1]);
      },
    },
    {
      name: 'validation',
      prepare: async () => {
        const frame = page.frameLocator('iframe.calc-frame');
        await applyScenario(frame, scenarios[0]);
        await frame.locator('#lockbtn').click();
        await frame.locator('#lockerr').waitFor({ state: 'visible' });
      },
    },
  ];

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const shot of shots) {
      await openCalculator(page);
      await shot.prepare();
      await fitFrame(page);
      await page.screenshot({ path: `${dir}/${width}-${shot.name}.png`, fullPage: true });
    }
  }

  if (phase === 'before') {
    const frame = page.frameLocator('iframe.calc-frame');
    const recorded = [];
    for (const scenario of scenarios) {
      await openCalculator(page);
      await applyScenario(frame, scenario);
      recorded.push({ id: scenario.id, inputs: scenario, totals: await readTotals(frame) });
    }
    writeFileSync('tests/baseline-totals.json', JSON.stringify(recorded, null, 2) + '\n');
  }
});
