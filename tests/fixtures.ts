import { test as base, expect } from '@playwright/test';

// Every browser test cleans up after itself: the quotes it locks (from the page or the calculator
// frame) are deleted when it ends, so runs leave nothing behind in data/.
export const test = base.extend<{ cleanUpQuotes: void }>({
  cleanUpQuotes: [async ({ context }, use) => {
    // tracked from when the save is sent, so one still in flight when the test ends is waited for
    const pending: Promise<string | null>[] = [];
    context.on('request', (req) => {
      if (req.method() !== 'POST' || !req.url().endsWith('/api/quotes')) return;
      pending.push(req.response()
        .then((res) => (res && res.ok() ? res.json() : null))
        .then((data) => data?.quote?.id ?? null)
        .catch(() => null));
    });
    await use();
    for (const id of await Promise.all(pending)) {
      if (id) await context.request.delete(`/api/quotes/${id}`).catch(() => {});
    }
  }, { auto: true }],
});

export { expect };
