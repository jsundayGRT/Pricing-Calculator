import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { buildProposalPdf } from '../../src/lib/proposal-pdf';
import { buildProposal, leftoverPlaceholders } from '../../src/lib/proposal';
import { upsertQuote } from '../../src/lib/quotes';
import { readZip } from '../../src/lib/zip';

// Australian diagnostic (pilot) proposals: the regional rule sets the fee in AUD, and the fee is
// credited toward the first invoice (Year 1) when the rep leaves the credit on.

const html = readFileSync(path.join(__dirname, '..', '..', 'content', 'calculator.html'), 'utf8');
const engineSrc = html.slice(html.indexOf('const Engine = (function'), html.indexOf('const Schema = (function'));
type Customer = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const Engine = new Function(`${engineSrc}; return Engine;`)() as {
  calculate: (raw: Record<string, unknown>, cfg: unknown) => { inputs: unknown; customer: Customer; internal: Record<string, unknown> };
  applyPilotRules: (customer: Customer, cfg: unknown, fx: unknown) => Customer;
};
const CONFIG = JSON.parse(html.match(/<script type="application\/json" id="grt-config">([\s\S]*?)<\/script>/)![1]).config;
const FX = { currency: 'AUD', rate: 1.5, source: 'test rate' };

let dir = '';
test.beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'grt-aus-')); process.env.DATA_DIR = dir; });
test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

// The calculator's own steps at lock time: price, attach the rate, apply the regional pilot rule.
async function locked(input: Record<string, unknown>) {
  const r = Engine.calculate({ location: 'AUS', pilotCredit: 'Y', ...input }, CONFIG);
  r.customer.fx = FX;
  Engine.applyPilotRules(r.customer, CONFIG, FX);
  const q = await upsertQuote({
    ownerId: 'u1', ownerEmail: 'sam.rep@guardrail.tech', ownerName: 'Sam Rep',
    snapshot: {
      requestId: 'GRT-AUS1', version: 1, customerName: 'Harbour Bank', rep: 'Sam Rep', status: 'DEAL REVIEW',
      lockedAt: '2026-11-18T01:00:00.000Z', inputs: r.inputs, customer: { ...r.customer, validUntil: '2026-12-18' }, internal: r.internal,
    },
  });
  return { q, c: r.customer };
}
const text = (docx: Uint8Array) => {
  const x = readZip(docx).find((e) => e.name === 'word/document.xml')!.data.toString('utf8');
  return [...x.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(' ').replace(/&amp;/g, '&');
};
const aud = (usd: number) => `AUD ${Math.round(usd * FX.rate).toLocaleString('en-US')}`;

test('over AUD 75,000: a flat AUD 20,000 diagnostic, credited toward the first invoice', async () => {
  const { q, c } = await locked({ band: 'SMB', modules: { shadow: 'Y', drift: 'Y' }, commandCenter: 'Y', pilot: { shadow: 'Y', drift: 'Y' }, term: '3+ Year' });
  expect(c.pilot.rule.applied).toBe('flat');
  expect(Math.round(c.pilot.total * FX.rate)).toBe(20000);
  expect(c.pilot.creditApplied).toBeCloseTo(c.pilot.total, 6);
  expect(c.schedule.rows[0].due).toBeCloseTo(c.schedule.rows[0].amount - c.pilot.total, 6);
  expect(c.schedule.rows[1].pilotCredit).toBe(0); // later years are not credited

  const docx = buildProposal(q);
  expect(leftoverPlaceholders(docx)).toEqual([]);
  const t = text(docx);
  for (const want of ['Harbour Bank', 'Australian dollars', 'AUD 20,000', aud(c.finalPrice), aud(c.year1DueAtSigning),
    'credited toward Year 1 if you sign by December 18, 2026']) expect(t, want).toContain(want);
  expect(t).not.toMatch(/\$\d/); // no US-dollar amounts on an AUD proposal

  // the PDF's page streams are compressed: read the text back out
  const pdf = buildProposalPdf(q);
  const streams = [...pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)]
    .map((m) => { try { return inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return ''; } }).join('')
    .replace(/<([0-9a-f]+)> Tj/g, (_, h: string) => Buffer.from(h, 'hex').toString('latin1')); // text is written as hex strings
  expect(streams).toContain('AUD 20,000');
});

test('under AUD 75,000: the diagnostic is 20% of Year 1', async () => {
  const { q, c } = await locked({ band: 'Micro', modules: { shadow: 'Y' }, commandCenter: 'N', pilot: { shadow: 'Y' }, term: '1-Year' });
  expect(c.pilot.rule.applied).toBe('percent');
  expect(c.pilot.total).toBeCloseTo(c.finalPrice * 0.2, 6);
  const t = text(buildProposal(q));
  expect(t).toContain(aud(c.pilot.total));
  expect(t).toContain(aud(c.finalPrice - c.pilot.total));
});

test('credit off: the diagnostic is paid separately and Year 1 is not reduced', async () => {
  const { q, c } = await locked({ band: 'SMB', modules: { shadow: 'Y' }, commandCenter: 'Y', pilot: { shadow: 'Y' }, pilotCredit: 'N', term: '1-Year' });
  expect(c.pilot.creditApplied).toBe(0);
  expect(c.year1DueAtSigning).toBeCloseTo(c.finalPrice, 6);
  const t = text(buildProposal(q));
  expect(t).toContain('paid separately');
  expect(t).not.toContain('Year 1 balance after the diagnostic credit');
});
