// The customer proposal: Guardrail's Word template (content/proposal-template.docx) filled in
// from a locked request. The template keeps the approved wording and design; this only puts in
// the customer, rep, dates and prices, and drops the parts that don't apply (unpicked modules,
// no diagnostic, years past the term).
//
// The template prices by machines over a ramp with a diagnostic fee. Until the calculator has its
// own ramp, machines are the request's governed employees (the same every year) and the
// diagnostic is its pilot.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { quoteExpiry } from './expiry';
import type { QuoteRecord } from './quotes';
import { readZip, writeZip } from './zip';

type Snapshot = {
  customerName?: string;
  rep?: string;
  lockedAt?: string;
  approval?: { at?: string };
  inputs?: { modules?: Record<string, boolean>; commandCenter?: boolean };
  customer?: {
    fx?: { currency?: string; rate?: number };
    included?: { governedEmployees?: number };
    finalPrice?: number;
    implementation?: number;
    year1DueAtSigning?: number;
    lines?: { modules?: { key: string; name: string }[] };
    pilot?: { total?: number; credited?: boolean; creditApplied?: number };
    schedule?: { years?: number; rows?: { year: number; amount: number; implementation?: number }[]; totalContractValue?: number };
    quoteValidDays?: number;
    validUntil?: string;
  };
};

// What each Traffic Light module does, in the template's words where it has them.
const MODULE_TEXT: Record<string, string> = {
  shadow: 'See and control the AI people use in the browser.',
  drift: 'Watch what AI agents do on laptops and servers. Stop the ones that break policy.',
  codeAi: 'Check code, packages and MCP connections from AI coding tools.',
  content: 'Check AI output and its sources.',
};
const CURRENCY_NAMES: Record<string, string> = { USD: 'US dollars', AUD: 'Australian dollars', MXN: 'Mexican pesos' };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const textOf = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const longDate = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const listOf = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

// The paragraph holding a piece of text (Word may split a sentence over several runs, so this
// matches the paragraph's text, not its XML), or the table row around that paragraph.
function around(xml: string, needle: string, tag: 'w:p' | 'w:tr', from = 0) {
  const re = /<w:p(?=[ >])[\s\S]*?<\/w:p>/g;
  if (from < 0) return null;
  re.lastIndex = from;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (!textOf(m[0]).includes(needle)) continue;
    if (tag === 'w:p') return { start: m.index, end: m.index + m[0].length, xml: m[0] };
    let start = m.index;
    do { start = xml.lastIndexOf('<w:tr', start - 1); } while (start >= 0 && !/^<w:tr[ >]/.test(xml.slice(start, start + 6)));
    if (start < 0) return null;
    const end = xml.indexOf('</w:tr>', m.index) + '</w:tr>'.length;
    return { start, end, xml: xml.slice(start, end) };
  }
  return null;
}

// Replaces a paragraph's text, keeping its paragraph style and its first run's formatting;
// null removes the paragraph.
function setParagraph(xml: string, needle: string, text: string | null) {
  const p = around(xml, needle, 'w:p');
  if (!p) return xml;
  if (text === null) return xml.slice(0, p.start) + xml.slice(p.end);
  const open = p.xml.match(/^<w:p(?:\s[^>]*)?>/)![0];
  const pPr = p.xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] || '';
  const rPr = p.xml.match(/<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/)?.[1] || '';
  return xml.slice(0, p.start) + `${open}${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>` + xml.slice(p.end);
}

const replaceAll = (xml: string, from: string, to: string) => xml.split(from).join(esc(to));
// Replaces the next occurrences of a placeholder, one value each, in document order.
function replaceInOrder(xml: string, from: string, values: string[]) {
  let at = 0;
  for (const v of values) {
    const i = xml.indexOf(from, at);
    if (i < 0) break;
    xml = xml.slice(0, i) + esc(v) + xml.slice(i + from.length);
    at = i + esc(v).length;
  }
  return xml;
}

export function proposalFileName(record: Pick<QuoteRecord, 'customerName' | 'requestId' | 'version'>) {
  const name = record.customerName.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60);
  return `Guardrail Proposal - ${name} - ${record.requestId}${record.version > 1 ? `-v${record.version}` : ''}.docx`;
}

// A draft proposal is the rep's estimate in the template before review: marked so it isn't sent.
export const DRAFT_NOTE = 'DRAFT ESTIMATE: not reviewed. Do not send to the customer until it is approved.';
export function draftFileName(customerName: string, now = new Date()) {
  const name = customerName.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'Estimate';
  return `Guardrail Draft Proposal - ${name} - ${now.toISOString().slice(0, 10)}.docx`;
}

export function buildProposal(record: QuoteRecord, opts: { template?: Uint8Array; now?: Date; draft?: boolean } = {}) {
  const snap = record.snapshot as Snapshot;
  const c = snap.customer || {};
  const rate = c.fx?.rate && c.fx.rate > 0 ? c.fx.rate : 1;
  const currency = c.fx?.rate && c.fx.rate > 0 ? c.fx.currency || 'USD' : 'USD';
  // template amounts already carry a "$"; another currency replaces it with its code
  const amount = (usd: number) => Math.round(usd * rate).toLocaleString('en-US');
  const money = (usd: number) => (currency === 'USD' ? amount(usd) : `${currency} ${amount(usd)}`);
  const dollars = (xml: string, from: string, usd: number | null) => {
    if (usd == null) return replaceAll(xml, `$${from}`, '—');
    return replaceAll(xml, `$${from}`, currency === 'USD' ? `$${amount(usd)}` : money(usd));
  };
  const $ = (usd: number) => (currency === 'USD' ? `$${amount(usd)}` : money(usd));

  const sched = c.schedule || {};
  const years = Math.min(3, Math.max(1, sched.years || 1));
  const yearAmount = (y: number) => sched.rows?.find((r) => r.year === y)?.amount ?? (y === 1 ? c.finalPrice ?? 0 : null);
  const total = sched.totalContractValue ?? c.finalPrice ?? 0;
  const machines = c.included?.governedEmployees || 0;
  const pilot = c.pilot?.total || 0;
  const credited = !!(pilot && c.pilot?.credited);
  const y1 = yearAmount(1) ?? 0;
  const balance = credited ? c.year1DueAtSigning ?? y1 - pilot : y1;
  // implementation after discounts, as it is in Year 1
  const impl = sched.rows?.find((r) => r.year === 1)?.implementation ?? c.implementation ?? 0;
  const perMonth = (usd: number | null) => (usd == null || !machines ? null : usd / machines / 12);

  const lockedAt = new Date(snap.lockedAt || record.lockedAt || Date.now());
  const expiry = quoteExpiry(record)
    || (c.validUntil && /^\d{4}-\d{2}-\d{2}$/.test(c.validUntil) ? `${c.validUntil}T12:00:00Z` : null)
    || new Date((opts.now ?? new Date()).getTime() + (c.quoteValidDays || 30) * 86_400_000).toISOString();
  const validOn = longDate(new Date(expiry));
  const dated = longDate(lockedAt);
  const rep = snap.rep || record.ownerName || '';
  const termText = years === 1 ? '1 year' : `${years} years`;

  const names = Object.fromEntries((c.lines?.modules || []).map((m) => [m.key, m.name.replace('Traffic Light for ', '')]));
  const picked = Object.entries(snap.inputs?.modules || {}).filter(([, on]) => on).map(([k]) => k);
  const products = [...picked.map((k) => names[k] || k), ...(snap.inputs?.commandCenter ? ['AI Command Center'] : [])];

  const zip = readZip(opts.template ?? readFileSync(path.join(process.cwd(), 'content', 'proposal-template.docx')));
  const part = (name: string) => zip.find((e) => e.name === name)!;
  let x = part('word/document.xml').data.toString('utf8');

  // ---- sentences that hold several values: written whole
  x = setParagraph(x, 'ramping from [#] to [#] machines',
    `${listOf(products) || 'Guardrail'}, covering ${machines.toLocaleString('en-US')} machines over ${termText}. ${CURRENCY_NAMES[currency] || currency}, all discounts included.`);
  x = setParagraph(x, 'Year 1 is $[Y1 price] in all', pilot
    ? `Year 1 is ${$(y1)} in all${credited ? `: ${$(pilot)} for the diagnostic, paid at signature, plus a Year 1 balance of ${$(balance)}. The diagnostic fee is credited toward Year 1 if you sign by ${validOn}.` : `, plus ${$(pilot)} for the diagnostic, paid at signature.`}`
    : `Year 1 is ${$(y1)} in all${impl ? `, including ${$(impl)} for one-time implementation` : ''}.`);
  x = setParagraph(x, 'Start the diagnostic ($[Diagnostic]', pilot
    ? `Start the diagnostic (${$(pilot)}${credited ? `, credited toward Year 1 if you sign by ${validOn}` : ''}).` : null);
  x = setParagraph(x, 'Year 1 balance after the diagnostic credit',
    credited ? `Sign the contract and order form by ${validOn}. Year 1 balance after the diagnostic credit: ${$(balance)}.`
      : `Sign the contract and order form by ${validOn}. Year 1: ${$(y1)}.`);
  x = setParagraph(x, 'We set up your first [#] machines',
    `We set up your first ${machines.toLocaleString('en-US')} machines. We aim to finish setup within 3 months of signing.`);
  x = setParagraph(x, 'Its $[Diagnostic] fee is credited toward Year 1',
    credited ? `Runs before Year 1 starts. Its ${$(pilot)} fee is credited toward Year 1.` : `Runs before Year 1 starts. Its ${$(pilot)} fee is paid separately.`);
  // the cover shows the valid-until date, which isn't always two weeks out
  // (wording only, inside the note, so its bold label stays as it is)
  x = x.replace('Prices hold for two weeks, until the valid-until date', 'Prices hold until the valid-until date');
  if (currency !== 'USD') x = x.replace('Prices are in US dollars and do not include taxes', `Prices are in ${esc(CURRENCY_NAMES[currency] || currency)} and do not include taxes`);
  if (!pilot) x = setParagraph(x, 'The diagnostic runs under its own short agreement', null);

  // ---- "What's included": a row per chosen module, then Command Center, inference, diagnostic, implementation
  // (rows are looked for after its heading: the text above also names the products)
  const included = () => x.search(/WHAT(?:'|&apos;|’)S INCLUDED/);
  const shadowRow = around(x, 'Traffic Light: Shadow', 'w:tr', included());
  if (shadowRow) {
    const rowFor = (key: string) => setParagraph(setParagraph(shadowRow.xml, 'Traffic Light: Shadow', `Traffic Light: ${names[key] || key}`),
      MODULE_TEXT.shadow, MODULE_TEXT[key] || '');
    x = x.slice(0, shadowRow.start) + picked.map(rowFor).join('') + x.slice(shadowRow.end);
    const drift = around(x, 'Traffic Light: Drift', 'w:tr', shadowRow.start + picked.map(rowFor).join('').length);
    if (drift) x = x.slice(0, drift.start) + x.slice(drift.end);
  }
  const dropRow = (needle: string) => {
    const r = around(x, needle, 'w:tr', included());
    if (r) x = x.slice(0, r.start) + x.slice(r.end);
  };
  if (!snap.inputs?.commandCenter) dropRow('Your policy, every record, ROI and AI incident response on one screen.');
  if (!pilot) dropRow('Runs before Year 1 starts.');
  if (!impl) dropRow('One-time setup in Year 1.');
  // a ✓ only for the years in the term
  if (years < 3) {
    const start = included(), end = x.indexOf('NEXT STEPS');
    let table = x.slice(start, end);
    table = table.replace(/(<w:tr(?=[ >])[\s\S]*?<\/w:tr>)/g, (row) => {
      let n = 0;
      return row.replace(/✓/g, () => (++n > years ? '' : '✓'));
    });
    x = x.slice(0, start) + table + x.slice(end);
  }

  // ---- single values
  x = replaceAll(x, '[CLIENT NAME]', snap.customerName || record.customerName);
  x = replaceAll(x, '[Rep Name]', rep);
  x = replaceAll(x, '[rep]@guardrail.tech', record.ownerEmail || '');
  x = replaceAll(x, '[Month D, YYYY]', dated);
  x = replaceAll(x, '[Valid-until date]', validOn);
  x = replaceAll(x, '[N] years', termText);
  x = replaceAll(x, '$X,XXX', pilot ? $(pilot) : '—');
  x = replaceAll(x, 'Paid at signature', pilot ? 'Paid at signature' : 'No diagnostic');
  x = replaceAll(x, '$XX,XXX', $(balance));
  const inTerm = (y: number) => y <= years;
  // tiles (Year 1 balance, Year 2, Year 3), then the ramp table's three years
  for (const y of [1, 2, 3]) x = setParagraph(x, '[#] machines', inTerm(y) ? `${machines.toLocaleString('en-US')} machines` : 'Not in term');
  x = replaceInOrder(x, '[#]', [1, 2, 3].map((y) => (inTerm(y) ? machines.toLocaleString('en-US') : '—')));
  x = dollars(x, '[Y1 price]', y1);
  x = dollars(x, '[Y2 price]', inTerm(2) ? yearAmount(2) : null);
  x = dollars(x, '[Y3 price]', inTerm(3) ? yearAmount(3) : null);
  x = dollars(x, '[Total]', total);
  x = replaceAll(x, '$[Y1 / mo]', perMonth(y1) == null ? '—' : $(perMonth(y1)!));
  x = replaceAll(x, '$[Y2 / mo]', inTerm(2) && perMonth(yearAmount(2)) != null ? $(perMonth(yearAmount(2))!) : '—');
  x = replaceAll(x, '$[Y3 / mo]', inTerm(3) && perMonth(yearAmount(3)) != null ? $(perMonth(yearAmount(3))!) : '—');
  x = replaceAll(x, '$[Avg] avg', machines ? `${$(total / years / machines / 12)} avg` : '—');
  // the template marks what to fill in with yellow highlighting; filled in, it goes
  const unmark = (xml: string) => xml.replace(/<w:highlight w:val="yellow"\/>/g, '');
  if (opts.draft) {
    const note = `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="FDECEC"/><w:spacing w:after="160"/></w:pPr>`
      + `<w:r><w:rPr><w:b/><w:color w:val="B42318"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${esc(DRAFT_NOTE)}</w:t></w:r></w:p>`;
    x = x.replace(/<w:body>/, `<w:body>${note}`);
  }
  part('word/document.xml').data = Buffer.from(unmark(x), 'utf8');

  const header = part('word/header1.xml');
  if (header) {
    let h = header.data.toString('utf8');
    h = replaceAll(h, '[Client Name]', snap.customerName || record.customerName);
    h = replaceAll(h, '[Month D, YYYY]', dated);
    header.data = Buffer.from(unmark(h), 'utf8');
  }
  return writeZip(zip);
}

// Placeholders still in the filled document, for the tests.
export function leftoverPlaceholders(docx: Uint8Array) {
  const x = textOf(readZip(docx).find((e) => e.name === 'word/document.xml')!.data.toString('utf8'));
  return [...new Set(x.match(/\[[^\]]{1,30}\]|\$X[X,]+/g) || [])];
}
