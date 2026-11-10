import { test as base, expect } from '@playwright/test';

// Every browser test cleans up after itself: the quotes it locks (from the page or the calculator
// frame) are deleted when it ends, so runs leave nothing behind in data/.
export const test = base.extend<{ cleanUpQuotes: void }>({
  cleanUpQuotes: [async ({ context }, use) => {
    const pending: Promise<string | null>[] = [];
    context.on('response', (res) => {
      if (res.request().method() !== 'POST' || !res.url().endsWith('/api/quotes') || !res.ok()) return;
      pending.push(res.json().then((data) => data?.quote?.id ?? null).catch(() => null));
    });
    await use();
    for (const id of await Promise.all(pending)) {
      if (id) await context.request.delete(`/api/quotes/${id}`).catch(() => {});
    }
  }, { auto: true }],
});

export { expect };
