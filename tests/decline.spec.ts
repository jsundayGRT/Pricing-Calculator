import { expect, test } from '@playwright/test';
import { openCalculator } from './drive';
import { signIn } from './session';

test('an executive can choose not to approve a deal review', async ({ page, context }) => {
  await signIn(context);
  const requestId = `GRT-DECLINE-${Date.now()}`;
  const created = await page.request.post('http://127.0.0.1:3000/api/quotes', {
    data: {
      snapshot: {
        requestId,
        version: 1,
        customerName: 'Decline Co',
        status: 'DEAL REVIEW',
        lockedAt: new Date().toISOString(),
        rep: 'Jared Sunday',
        customer: { finalPrice: 1000, fx: { currency: 'USD' } },
      },
    },
  });
  expect(created.ok()).toBeTruthy();
  const body = await created.json();
  const id = body.quote.id as string;

  try {
    await page.goto('/executive');
    await page.getByText('Decline Co', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
    const approve = page.getByRole('button', { name: 'Approve', exact: true });
    const decline = page.getByRole('button', { name: 'Do not approve' });
    const approveColor = await approve.evaluate((el) => getComputedStyle(el).backgroundColor);
    const declineColor = await decline.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(declineColor).toBe(approveColor);

    const waiting = page.locator('.pill.review', { hasText: 'Deal Review' });
    await expect(waiting).toBeVisible();
    expect(await waiting.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(252, 243, 227)');

    await decline.click();
    await expect(page.getByText('Not approved by Jared Sunday')).toBeVisible();
    const pill = page.locator('.pill.declined', { hasText: 'Not approved' });
    await expect(pill).toBeVisible();
    expect(await pill.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(155, 44, 40)');

    await page.locator('#log-note').fill('Asked for a smaller discount');
    await page.getByRole('button', { name: 'Add update' }).click();
    await expect(page.getByText('Asked for a smaller discount')).toBeVisible();
  } finally {
    await page.request.delete(`http://127.0.0.1:3000/api/quotes/${id}`);
  }
});

test('revise a locked request is a solid button', async ({ page, context }) => {
  await signIn(context);
  const frame = await openCalculator(page);
  const button = frame.locator('label.revise-btn');
  await expect(button).toHaveText('Revise a locked request');
  expect(await button.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(23, 60, 91)');
});
