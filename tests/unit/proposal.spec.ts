import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { docxToHtml } from '../../src/lib/docx-html';
import { buildProposal, DRAFT_NOTE, isWordFile, leftoverPlaceholders, proposalFileName, withoutDraftNote } from '../../src/lib/proposal';
import { approveQuote, getQuoteById, upsertQuote } from '../../src/lib/quotes';
import { readZip, writeZip } from '../../src/lib/zip';

// The proposal: Guardrail's Word template filled in from a locked request, priced by the real engine.

const html = readFileSync(path.join(__dirname, '..', '..', 'content', 'calculator.html'), 'utf8');
const engineSrc = html.slice(html.indexOf('const Engine = (function'), html.indexOf('const Schema = (function'));
const Engine = new Function(`${engineSrc}; return Engine;`)() as {
  calculate: (raw: Record<string, unknown>, cfg: unknown) => { inputs: unknown; customer: Record<string, unknown>; internal: Record<string, unknown> };
};
const CONFIG = JSON.parse(html.match(/<script type="application\/json" id="grt-config">([\s\S]*?)<\/script>/)![1]).config;

let dir = '';
test.beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'grt-proposal-')); process.env.DATA_DIR = dir; });
test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function locked(input: Record<string, unknown>, fx = { currency: 'USD', rate: 1 }) {
  const r = Engine.calculate({ location: 'US', pilotCredit: 'Y', ...input }, CONFIG);
  return upsertQuote({
    ownerId: 'u1', ownerEmail: 'avery.rep@guardrail.tech', ownerName: 'Avery Rep',
    snapshot: {
      requestId: 'GRT-PROP1', version: 1, customerName: 'Bank of the Rockies', rep: 'Avery Rep', status: 'DEAL REVIEW',
      lockedAt: '2026-11-16T15:00:00.000Z', inputs: r.inputs, customer: { ...r.customer, fx, validUntil: '2026-12-16' }, internal: r.internal,
    },
  });
}
const text = (docx: Uint8Array) => {
  const x = readZip(docx).find((e) => e.name === 'word/document.xml')!.data.toString('utf8');
  return [...x.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(' ').replace(/&amp;/g, '&');
};

test('a 3-year request with a pilot fills every placeholder', async () => {
  const q = await locked({ band: 'SMB', modules: { shadow: 'Y', drift: 'Y' }, commandCenter: 'Y', pilot: { shadow: 'Y' }, term: '3+ Year' });
  const docx = buildProposal(q);
  writeFileSync(path.join(dir, 'p.docx'), docx);
  expect(leftoverPlaceholders(docx)).toEqual([]);
  const t = text(docx);
  const c = (q.snapshot.customer as { finalPrice: number; schedule: { totalContractValue: number }; pilot: { total: number } });
  for (const want of ['Bank of the Rockies', 'Avery Rep', 'avery.rep@guardrail.tech', 'November 16, 2026', 'December 16, 2026', '3 years',
    `$${Math.round(c.finalPrice).toLocaleString('en-US')}`, `$${Math.round(c.schedule.totalContractValue).toLocaleString('en-US')}`,
    `$${Math.round(c.pilot.total).toLocaleString('en-US')}`, '100 machines', 'Traffic Light: Shadow', 'Traffic Light: Drift', 'AI Command Center']) {
    expect(t, want).toContain(want);
  }
  expect(readZip(docx).find((e) => e.name === 'word/document.xml')!.data.toString('utf8')).not.toContain('w:highlight'); // fill-in marks removed
  expect(proposalFileName(q)).toBe('Guardrail Proposal - Bank of the Rockies - GRT-PROP1.docx');
  // still a Word file Word can open: every part present
  expect(readZip(docx).map((e) => e.name)).toEqual(readZip(readFileSync(path.join(__dirname, '..', '..', 'content', 'proposal-template.docx'))).map((e) => e.name));
});

test('a 1-year request without a pilot drops the diagnostic and later years', async () => {
  const q = await locked({ band: 'Mid-Market', modules: { codeAi: 'Y', content: 'Y' }, commandCenter: 'N', term: '1-Year' });
  const docx = buildProposal(q);
  expect(leftoverPlaceholders(docx)).toEqual([]);
  const t = text(docx);
  expect(t).toContain('Traffic Light: Code + AI');
  expect(t).toContain('Traffic Light: Content');
  expect(t).not.toContain('Traffic Light: Shadow');
  expect(t).not.toContain('Start the diagnostic');
  expect(t).not.toContain('Runs before Year 1 starts');
  expect(t).toContain('1 year');
  expect(t).toContain('Not in term');
  expect(t).not.toContain('Your policy, every record, ROI and AI incident response on one screen.'); // no Command Center row
});

test('another currency shows its code and name', async () => {
  const q = await locked({ band: 'SMB', location: 'AUS', modules: { shadow: 'Y' }, term: '1-Year' }, { currency: 'AUD', rate: 1.5 });
  const t = text(buildProposal(q));
  const aud = Math.round((q.snapshot.customer as { finalPrice: number }).finalPrice * 1.5).toLocaleString('en-US');
  expect(t).toContain(`AUD ${aud}`);
  expect(t).toContain('Australian dollars');
});

test('an approved request uses its approved valid-until date', async () => {
  const q = await locked({ band: 'SMB', modules: { shadow: 'Y' }, term: '1-Year' });
  await approveQuote(q.id, { name: 'Dena', email: 'dena.lumbang@guardrail.tech' });
  expect(text(buildProposal((await getQuoteById(q.id))!))).toContain('December 16, 2026');
});

test('a draft is marked so it is not sent before review', async () => {
  const q = await locked({ band: 'SMB', modules: { shadow: 'Y' }, term: '1-Year' });
  const draft = buildProposal(q, { draft: true });
  expect(leftoverPlaceholders(draft)).toEqual([]);
  expect(text(draft)).toContain(DRAFT_NOTE);
  expect(text(buildProposal(q))).not.toContain('DRAFT ESTIMATE');
});

test('the draft line comes out once approved', async () => {
  const q = await locked({ band: 'SMB', modules: { shadow: 'Y' }, term: '1-Year' });
  const draft = buildProposal(q, { draft: true });
  expect(isWordFile(draft)).toBe(true);
  expect(isWordFile(Buffer.from('PK not really a zip'))).toBe(false);
  const clean = withoutDraftNote(draft);
  expect(text(clean)).not.toContain('DRAFT ESTIMATE');
  expect(text(clean)).toContain('Bank of the Rockies');
});

test('a proposal previews as a page: text, tables, pictures, and nothing from the file runs', async () => {
  const q = await locked({ band: 'SMB', modules: { shadow: 'Y' }, term: '3+ Year', customerName: 'x' });
  const zip = readZip(buildProposal(q, { draft: true }));
  const doc = zip.find((e) => e.name === 'word/document.xml')!;
  doc.data = Buffer.from(doc.data.toString('utf8').replace('Guardrail builds AI control', '&lt;script&gt;alert(1)&lt;/script&gt; Guardrail builds AI control'), 'utf8');
  const html = docxToHtml(writeZip(zip), { title: 'Bank of the Rockies' });
  expect(html).toContain('DRAFT ESTIMATE');
  expect(html).toContain('Bank of the Rockies');
  expect(html).toContain('<table');
  expect(html).toContain('data:image/');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain("default-src 'none'");
});
