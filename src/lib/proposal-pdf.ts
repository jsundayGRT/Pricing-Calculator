// The proposal as a PDF, drawn in the design of Guardrail's Word template
// (content/proposal-template.docx): the navy cover, Who we are, Your price year by year, Next
// steps and the notes. The numbers and sentences come from proposalFacts, the same ones the Word
// file uses; the fixed wording is the template's. Pictures are taken from the template itself.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pdf, readPng, textWidth, wrap, type Font } from './pdf-kit';
import { MODULE_TEXT, proposalFacts } from './proposal';
import type { QuoteRecord } from './quotes';
import { readZip } from './zip';

// the template's colours
const NAVY = '#00053F', INK = '#2A3050', MUTED = '#5A607A', BLUE = '#3B5E9A', PALE = '#A9C3EE', SOFT = '#D4DCEE',
  FAINT = '#A9B4D0', RULE = '#E1E5EF', TILE = '#F3F5FA', DIVIDE = '#4A5080', ACCENT = '#507ABC', WHITE = '#FFFFFF', RED = '#B42318', REDSOFT = '#FDECEC';

const L = 72, R = 540, W = R - L;

let pictures: { cover: Buffer; header: Buffer; diagram: Buffer } | null = null;
function templatePictures(template?: Uint8Array) {
  if (pictures && !template) return pictures;
  const zip = readZip(template ?? readFileSync(path.join(process.cwd(), 'content', 'proposal-template.docx')));
  const file = (name: string) => zip.find((e) => e.name === name)?.data;
  const rels = (name: string) => new Map([...(file(name)?.toString('utf8') ?? '').matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const embeds = (xml: string) => [...xml.matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1]);
  const doc = file('word/document.xml')!.toString('utf8'), docRels = rels('word/_rels/document.xml.rels');
  const [cover, diagram] = embeds(doc).map((id) => file(`word/${docRels.get(id)}`)!);
  const hdrRels = rels('word/_rels/header1.xml.rels');
  const header = file(`word/${hdrRels.get(embeds(file('word/header1.xml')!.toString('utf8'))[0])}`)!;
  const out = { cover, header, diagram };
  if (!template) pictures = out;
  return out;
}

export function buildProposalPdf(record: QuoteRecord, opts: { note?: string | null; now?: Date; template?: Uint8Array } = {}) {
  const f = proposalFacts(record, opts.now);
  const pdf = new Pdf();
  const pics = templatePictures(opts.template);
  const coverLogo = readPng(pics.cover), headerLogo = readPng(pics.header), diagram = readPng(pics.diagram);
  const im = { cover: pdf.addPicture(coverLogo), header: pdf.addPicture(headerLogo), diagram: pdf.addPicture(diagram) };

  type TF = Font & { color: string; align?: 'left' | 'right' | 'center' };
  const t = (s: string, x: number, y: number, font: TF) => pdf.text(s, x, y, font);
  const caps = (s: string, x: number, y: number, size: number, color: string, spacing: number, align?: TF['align']) =>
    t(s.toUpperCase(), x, y, { size, bold: true, color, spacing, align });
  // a wrapped paragraph; returns the baseline after the last line
  const para = (s: string, x: number, y: number, width: number, font: TF, lead: number) => {
    const lines = wrap(s, width, font);
    lines.forEach((ln, i) => t(ln, x, y + i * lead, font));
    return y + (lines.length - 1) * lead;
  };

  // ---- pages after the cover: logo and "Proposal for …" at the top, company and page at the bottom
  let y = 0;
  const pageTop = () => {
    pdf.newPage();
    const h = 24, w = (h * headerLogo.w) / headerLogo.h;
    pdf.picture(im.header, L, 27, w, h);
    t(`Proposal for ${f.customerName} · ${f.dated}`, R, 50, { size: 7.5, color: MUTED, align: 'right' });
    pdf.line(L - 1, 62, R + 1, 62, RULE, 0.75);
    pdf.line(L - 1, 753, R + 1, 753, RULE, 0.75);
    t('Guardrail Technologies Inc.', L, 766, { size: 7.5, bold: true, color: NAVY });
    const after = L + textWidth('Guardrail Technologies Inc.', { size: 7.5, bold: true });
    if (opts.note) t(' · Draft estimate, not for the customer', after, 766, { size: 7.5, bold: true, color: RED });
    else t(' · Confidential', after, 766, { size: 7.5, color: MUTED });
    t(`Page ${pdf.pageCount}`, R, 766, { size: 7.5, color: MUTED, align: 'right' });
    y = 74;
  };
  const room = (h: number) => { if (y + h > 740) pageTop(); };
  const label = (s: string) => { caps(s, L, y, 8, BLUE, 2); };
  const heading = (s: string) => { t(s, L, y, { size: 22, bold: true, color: NAVY }); };

  // ================= cover
  pdf.rect(54, 12, 504, 753, NAVY);
  if (opts.note) {
    pdf.rect(90, 24, 432, 18, REDSOFT);
    t(opts.note, 98, 36, { size: 7.5, bold: true, color: RED });
  }
  { const h = 40, w = (h * coverLogo.w) / coverLogo.h; pdf.picture(im.cover, 90, 47, w, h); }
  caps('Proposal', 90, 108, 9, PALE, 3);
  t(`PREPARED FOR ${f.customerName}`, 90, 264, { size: 9, bold: true, color: PALE, spacing: 2.5 });
  t('AI under your control,', 90, 319, { size: 40, bold: true, color: WHITE });
  t('everywhere it runs.', 90, 364, { size: 40, bold: true, color: WHITE });
  pdf.line(89, 389, 526, 389, ACCENT, 2.25);
  const meta: [string, string][] = [['Prepared by', f.rep], ['Term', f.termText], ['Date', f.dated], ['Valid until', f.validOn]];
  const metaX = [90, 184, 323, 428], metaEnd = [176, 314.5, 420, 524];
  pdf.line(90, 516, 524, 516, DIVIDE, 0.75);
  meta.forEach(([k, v], i) => {
    if (i) pdf.line(metaX[i] - 8, 516, metaX[i] - 8, 551, DIVIDE, 0.75);
    caps(k, metaX[i], 529, 7.5, PALE, 1.5);
    const fitted = wrap(v, metaEnd[i] - metaX[i] - 6, { size: 9.5, bold: true });
    t(fitted[0] ?? '', metaX[i], 544, { size: 9.5, bold: true, color: WHITE });
  });
  t('Guardrail Technologies Inc. · guardrail.tech', 90, 590, { size: 8, color: FAINT });
  t('Confidential', 267, 590, { size: 8, color: FAINT });

  // ================= who we are
  pageTop();
  label('Who we are'); y += 28;
  heading('Guardrail Technologies'); y += 23;
  y = para('Guardrail builds AI control and security software. It shows each kind of AI in use, stops just the risky part, and keeps a record that your policy held. Guardrail is led by CEO T.J. Marlin, former Global Forensics leader at EY.',
    L, y, W, { size: 10.5, color: INK }, 16.5);
  y += 20;
  {
    const quote = wrap('“AI puts one question in front of every company: Did AI touch our data, and can we prove it? Guardrail lets you answer before you need to.”', W - 32, { size: 11.5 });
    const h = 74 + (quote.length - 1) * 17.5;
    pdf.rect(L, y, W, h, NAVY);
    caps('From our CEO', L + 16, y + 19, 7.5, PALE, 2);
    quote.forEach((ln, i) => t(ln, L + 16, y + 37 + i * 17.5, { size: 11.5, color: WHITE }));
    t('T.J. Marlin, CEO', L + 16, y + 58 + (quote.length - 1) * 17.5, { size: 9, color: SOFT });
    y += h + 23;
  }
  label('How Guardrail works'); y += 15;
  t('One platform, built on top of the AI you already use.', L, y, { size: 9.5, color: MUTED }); y += 10;
  { const h = (W * diagram.h) / diagram.w; pdf.picture(im.diagram, L, y, W, h); y += h + 12; }
  pdf.line(L, y, R, y, NAVY, 2); y += 1;
  const products: [string, string][] = [
    ['AI Command Center', 'One screen for your policy, every record, ROI and AI incident response.'],
    ['Traffic Light engine', 'Checks each AI use against your policy: STOP, SLOW or GO.'],
    ['Shadow', 'Sees and controls AI in the browser: the tools people use, approved or not, and when each first showed up.'],
    ['Code + AI', 'Checks code, packages and MCP connections from AI coding tools.'],
    ['Drift', 'Watches each command, file and connection an AI agent makes on laptops and servers. Stops the ones that break policy.'],
    ['Content', 'Checks AI output and its sources.'],
    ['Privacy', 'Masks sensitive data while keeping its context.'],
    ['Mobile', 'Sees AI use on work phones.'],
  ];
  for (const [name, desc] of products) {
    const lines = wrap(desc, R - 195, { size: 9 });
    const h = 7 + lines.length * 11.5;
    room(h);
    const mid = y + h / 2;
    t(name, L, mid + 3.2, { size: 9, bold: true, color: NAVY });
    lines.forEach((ln, i) => t(ln, 195, mid + 3.2 - ((lines.length - 1) * 11.5) / 2 + i * 11.5, { size: 9, color: INK }));
    y += h;
    pdf.line(L, y, R, y, RULE, 0.75);
  }
  y += 11;
  t('Other company and product names are trademarks of their owners. No endorsement is implied.', L, y, { size: 7, color: MUTED });

  // ================= your price, year by year
  pageTop();
  label('Your investment'); y += 28;
  heading('Your price, year by year.'); y += 22;
  y = para(f.sentences.investment, L, y, W, { size: 9, color: MUTED }, 12);
  y += 16;
  {
    const gap = 2, tw = (W - gap * 4) / 5, th = 60;
    const none = { value: '—', sub: 'Not in term' };
    const tiles = [
      { k: 'Diagnostic', value: f.pilot ? f.$(f.pilot) : '—', sub: f.pilot ? 'Paid at signature' : 'No diagnostic' },
      { k: 'Year 1 balance', value: f.$(f.balance), sub: `${f.machines.toLocaleString('en-US')} machines` },
      ...[2, 3].map((yr) => (f.inTerm(yr) ? { k: `Year ${yr}`, value: f.$(f.yearAmount(yr) ?? 0), sub: `${f.machines.toLocaleString('en-US')} machines` } : { k: `Year ${yr}`, ...none })),
      { k: 'Total', value: f.$(f.total), sub: f.termText },
    ];
    tiles.forEach((tile, i) => {
      const x = L + i * (tw + gap), last = i === tiles.length - 1;
      pdf.rect(x, y, tw, th, last ? NAVY : TILE);
      caps(tile.k, x + 9, y + 15, 6.5, last ? PALE : BLUE, 1);
      let size = 15;
      while (size > 9 && textWidth(tile.value, { size, bold: true }) > tw - 16) size -= 0.5;
      t(tile.value, x + 9, y + 35, { size, bold: true, color: last ? WHITE : NAVY });
      t(tile.sub, x + 9, y + 48, { size: 7.5, color: last ? SOFT : MUTED });
    });
    y += th + 30;
  }
  // the ramp table
  const colR = [343, 408.4, 473.7, R - 5];
  const head = (first: string, cols: string[]) => {
    caps(first, L, y, 7, MUTED, 1);
    cols.forEach((c, i) => caps(c, colR[i], y, 7, MUTED, 1, 'right'));
    y += 7; pdf.line(L, y, R, y, NAVY, 2);
  };
  room(110);
  head('Ramp', ['Year 1', 'Year 2', 'Year 3', 'Total']);
  const yearCells = (fn: (yr: number) => string) => [1, 2, 3].map((yr) => (f.inTerm(yr) ? fn(yr) : '—'));
  {
    y += 12;
    t('Machines covered', L, y, { size: 9, bold: true, color: NAVY });
    yearCells(() => f.machines.toLocaleString('en-US')).forEach((v, i) => t(v, colR[i], y, { size: 9, color: NAVY, align: 'right' }));
    y += 8; pdf.line(L, y, R, y, RULE, 0.75);
    y += 11;
    t('Price per machine, per month', L, y, { size: 9, bold: true, color: NAVY });
    t('Yearly price ÷ machines ÷ 12', L, y + 10, { size: 7.5, color: MUTED });
    const pm = (usd: number | null) => { const v = f.perMonth(usd); return v == null ? '—' : f.$(v); };
    [...yearCells((yr) => pm(f.yearAmount(yr))), f.machines ? `${f.$(f.total / f.years / f.machines / 12)} avg` : '—']
      .forEach((v, i) => t(v, colR[i], y + 5, { size: 9, color: NAVY, align: 'right' }));
    y += 17;
    const bh = 28;
    pdf.rect(L, y, W, bh, NAVY);
    [281, 346.6, 412, 477].forEach((x) => pdf.line(x, y, x, y + bh, DIVIDE, 0.5));
    t('Your price', L + 7, y + 12, { size: 9, bold: true, color: WHITE });
    t('All discounts included', L + 7, y + 22, { size: 7.5, color: SOFT });
    [...yearCells((yr) => f.$(f.yearAmount(yr) ?? 0)), f.$(f.total)].forEach((v, i) => t(v, colR[i], y + 17, { size: 9, bold: true, color: WHITE, align: 'right' }));
    y += bh + 16;
  }
  y = para(f.sentences.year1, L, y, W, { size: 8.5, color: INK }, 11.5);
  y += 37;
  // what's included
  const included: [string, string, number][] = [
    ...f.picked.map((k): [string, string, number] => [`Traffic Light: ${f.names[k] || k}`, MODULE_TEXT[k] || '', f.years]),
    ...(f.commandCenter ? [['AI Command Center', 'Your policy, every record, ROI and AI incident response on one screen.', f.years] as [string, string, number]] : []),
    ['Inference & infrastructure', 'Hosting and computing to run your Guardrail service.', f.years],
    ...(f.pilot ? [['Diagnostic', f.sentences.diagnosticRow, 1] as [string, string, number]] : []),
    ...(f.impl ? [['Implementation', 'One-time setup in Year 1.', 1] as [string, string, number]] : []),
  ];
  room(40 + included.length * 30);
  head("What's included", ['Year 1', 'Year 2', 'Year 3']);
  for (const [name, desc, years] of included) {
    const lines = wrap(desc, 200, { size: 7.5 });
    const h = 9 + 10 + lines.length * 9 + 6;
    room(h);
    t(name, L, y + 13, { size: 9, bold: true, color: NAVY });
    lines.forEach((ln, i) => t(ln, L, y + 23 + i * 9, { size: 7.5, color: MUTED }));
    for (let yr = 1; yr <= years; yr++) pdf.check(colR[yr - 1] - 4, y + h / 2 + 3, 9, NAVY);
    y += h;
    pdf.line(L, y, R, y, RULE, 0.75);
  }

  // ================= next steps, notes, questions
  pageTop();
  label('Next steps'); y += 15;
  const steps = [f.sentences.reviewStep, f.sentences.diagnosticStep, f.sentences.signStep, f.sentences.setupStep].filter((s): s is string => !!s);
  steps.forEach((s, i) => {
    t(`${i + 1}.`, L, y, { size: 10.5, bold: true, color: INK });
    y = para(s, L + 20.4, y, W - 20.4, { size: 10.5, color: INK }, 13.4) + 19.4;
  });
  y += 11;
  label('Notes and disclaimers'); y += 12;
  pdf.line(L - 1, y, R + 3, y, NAVY, 2); y += 17;
  const notes: [string, string][] = [
    ['Not a contract.', "This proposal is for planning only. It is not an offer or a contract. You subscribe only when both parties sign Guardrail's contract and order form."],
    ['Price valid.', 'Prices hold until the valid-until date on the cover. After that, they may change.'],
    ['Taxes.', `Prices are in ${f.currency === 'USD' ? 'US dollars' : f.currencyName} and do not include taxes. Any taxes are added to the invoice.`],
    ['Scope.', 'Prices are based on the products, quantities and term in this proposal. A change in scope may change the price.'],
    ['Discounts.', 'Multi-year discounts apply only for the full term.'],
    ...(f.pilot ? [['Diagnostic.', 'The diagnostic runs under its own short agreement. Its fee is non-refundable. It is credited toward Year 1 only if the contract and order form are signed by the valid-until date on the cover.'] as [string, string]] : []),
    ['Payment and renewal.', 'Payment terms, invoicing and renewal are set in the contract and order form.'],
    ['No service levels.', 'Dates, timelines, numbers and product descriptions in this proposal are estimates. They are not service levels or guarantees. Any service levels are set in the contract.'],
    ['Confidential.', 'This proposal and its pricing are confidential. Share them only with the people in your organization who need them.'],
  ];
  notes.forEach(([k, v], i) => {
    // the bold label, then the text running on after it
    const kf = { size: 9.5, bold: true }, vf = { size: 9.5 };
    const first = wrap(v, W - textWidth(`${k} `, kf), vf)[0] ?? '';
    const rest = v.slice(first.length).trim();
    room(14 + (rest ? wrap(rest, W, vf).length * 13.5 : 0));
    t(k, L, y, { ...kf, color: NAVY });
    t(first, L + textWidth(`${k} `, kf), y, { ...vf, color: INK });
    if (rest) y = para(rest, L, y + 13.5, W, { ...vf, color: INK }, 13.5);
    if (i === 0) { y += 11; pdf.line(L - 1, y, R + 3, y, RULE, 0.75); y += 16; }
    else y += 22;
  });
  y -= 13; pdf.line(L - 1, y, R + 3, y, RULE, 0.75); y += 32;
  room(60);
  pdf.rect(L, y, W, 56, NAVY);
  caps('Questions?', L + 16.5, y + 20, 7.5, PALE, 2);
  t(`Contact ${f.rep || 'us'} with any questions.`, L + 16.5, y + 36.5, { size: 11, bold: true, color: WHITE });
  t(f.rep, R - 16, y + 23, { size: 9.5, bold: true, color: WHITE, align: 'right' });
  if (f.email) {
    t(f.email, R - 16, y + 37, { size: 9, color: SOFT, align: 'right' });
    const w = textWidth(f.email, { size: 9 });
    pdf.link(R - 16 - w, y + 28, w, 12, `mailto:${f.email}`);
  }

  return pdf.build({ title: `Guardrail proposal - ${f.customerName}`, author: f.rep, subject: `${record.requestId}${record.version > 1 ? ` version ${record.version}` : ''}` });
}

export function proposalPdfFileName(record: Pick<QuoteRecord, 'customerName' | 'requestId' | 'version'>) {
  const name = record.customerName.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60);
  return `Guardrail Proposal - ${name} - ${record.requestId}${record.version > 1 ? `-v${record.version}` : ''}.pdf`;
}
