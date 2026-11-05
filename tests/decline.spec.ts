import { expect, test } from '@playwright/test';
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
    await page.getByRole('button', { name: 'Do not approve' }).click();
    await expect(page.getByText('Not approved by Jared Sunday')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Do not approve' })).toHaveCount(0);
  } finally {
    await page.request.delete(`http://127.0.0.1:3000/api/quotes/${id}`);
  }
});
