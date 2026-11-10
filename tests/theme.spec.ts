import { expect, test } from './fixtures';
import { openCalculator } from './drive';
import { signIn } from './session';

test('a new browser starts in light mode, and a switch to dark sticks', async ({ page, context }) => {
  await signIn(context);
  await openCalculator(page);
  const html = page.locator('html'), frameHtml = page.frameLocator('iframe.calc-frame').locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(frameHtml).toHaveClass(/\blight\b/);

  await page.locator('.theme-btn').first().click();
  await expect(html).not.toHaveAttribute('data-theme', 'light');
  await expect(frameHtml).not.toHaveClass(/\blight\b/);

  await page.reload();
  await page.frameLocator('iframe.calc-frame').locator('#band').waitFor();
  await expect(html).not.toHaveAttribute('data-theme', 'light');
  await expect(frameHtml).not.toHaveClass(/\blight\b/);
});
