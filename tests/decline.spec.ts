import { expect, test } from './fixtures';
import { openCalculator } from './drive';
import { signIn } from './session';

test('an executive can decline a deal review, with a reason', async ({ page, context }) => {
  await signIn(context);
  const requestId = `GRT-DECLINE-${Date.now()}`;
  const customer = `Decline Co ${Date.now()}`;
  const created = await page.request.post('http://127.0.0.1:3000/api/quotes', {
    data: {
      snapshot: {
        requestId,
        version: 1,
        customerName: customer,
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
    await page.getByText(customer, { exact: true }).click();
    // Approve is green and Decline red, like the Slack message
    const approve = page.getByRole('button', { name: 'Approve', exact: true });
    const decline = page.getByRole('button', { name: 'Decline', exact: true });
    await expect(approve).toBeVisible();
    expect(await approve.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 122, 90)');
    expect(await decline.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(224, 30, 90)');

    await expect(page.locator('tr', { hasText: customer }).locator('.pill.review', { hasText: 'Deal Review' })).toBeVisible();

    // Decline asks for the reason, and can't be sent without one
    await decline.click();
    const reason = page.locator('#decline-reason');
    await expect(reason).toBeVisible();
    const send = page.locator('form.log-form').getByRole('button', { name: 'Decline', exact: true });
    await expect(send).toBeDisabled();
    await reason.fill('Asked for a smaller discount');
    await send.click();

    await expect(page.getByText('Not approved by Jared Sunday: Asked for a smaller discount')).toBeVisible();
    await expect(page.locator('.pill.declined', { hasText: 'Not approved' }).first()).toBeVisible();
    // a decision is final: no Approve or Decline once decided
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Decline', exact: true })).toHaveCount(0);
  } finally {
    await page.request.delete(`http://127.0.0.1:3000/api/quotes/${id}`);
  }
});

test('the calculator has no upload button for revising', async ({ page, context }) => {
  await signIn(context);
  const frame = await openCalculator(page);
  // revising starts from the dashboard's Open / revise instead
  await expect(frame.getByText('Revise a locked request')).toHaveCount(0);
});
