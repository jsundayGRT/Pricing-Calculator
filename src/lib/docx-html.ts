// A preview of a Word document as a web page, without any library: paragraphs, runs (bold,
// italic, colour, size), tables with shading and borders, lists, images, and the header and
// footer. Close to how Word lays it out, not exact: the Word file is the real thing.

import { readZip } from './zip';

type El = { tag: string; attrs: Record<string, string>; kids: Node[] };
type Node = El | string;

const unescapeXml = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e: string) => {
  const k = e.toLowerCase();
  if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'amp') return '&'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
  const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
  return Number.isFinite(n) ? String.fromCodePoint(n) : m;
});
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function parseXml(xml: string): El {
  const root: El = { tag: '#root', attrs: {}, kids: [] };
  const stack: El[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] != null) top.kids.push(m[1]);
    else if (m[2]) { if (stack.length > 1 && top.tag === m[2]) stack.pop(); else { const i = stack.map((e) => e.tag).lastIndexOf(m[2]); if (i > 0) stack.length = i; } }
    else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of m[4].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescapeXml(a[2] ?? a[3] ?? '');
      const el: El = { tag: m[3], attrs, kids: [] };
      top.kids.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] != null) top.kids.push(unescapeXml(m[6]));
  }
  return root;
}

const els = (e: El | undefined) => (e ? (e.kids.filter((k) => typeof k !== 'string') as El[]) : []);
const kid = (e: El | undefined, tag: string) => els(e).find((k) => k.tag === tag);
const find = (e: El | undefined, tag: string): El | undefined => {
  for (const k of els(e)) { if (k.tag === tag) return k; const f = find(k, tag); if (f) return f; }
  return undefined;
};
const val = (e: El | undefined, tag: string, attr = 'w:val') => kid(e, tag)?.attrs[attr];
const on = (e: El | undefined, tag: string) => { const k = kid(e, tag); return !!k && !['0', 'false', 'none'].includes(k.attrs['w:val'] ?? ''); };
const twipPt = (v?: string) => (v && /^-?\d+$/.test(v) ? Number(v) / 20 : null);
const hex = (v?: string) => (v && /^[0-9a-f]{6}$/i.test(v) ? `#${v}` : null);

type RunStyle = { b?: boolean; i?: boolean; u?: boolean; caps?: boolean; color?: string | null; size?: number | null; font?: string | null; spacing?: number | null };
type ParaStyle = { jc?: string; before?: number | null; after?: number | null; line?: number | null; run: RunStyle };

function runStyle(rPr: El | undefined, base: RunStyle = {}): RunStyle {
  if (!rPr) return { ...base };
  const s = { ...base };
  if (kid(rPr, 'w:b')) s.b = on(rPr, 'w:b');
  if (kid(rPr, 'w:i')) s.i = on(rPr, 'w:i');
  if (kid(rPr, 'w:u')) s.u = val(rPr, 'w:u') !== 'none';
  if (kid(rPr, 'w:caps')) s.caps = on(rPr, 'w:caps');
  const color = val(rPr, 'w:color'); if (color) s.color = hex(color);
  const sz = val(rPr, 'w:sz'); if (sz && /^\d+$/.test(sz)) s.size = Number(sz) / 2;
  const font = kid(rPr, 'w:rFonts')?.attrs['w:ascii']; if (font) s.font = font;
  const spacing = twipPt(val(rPr, 'w:spacing')); if (spacing != null) s.spacing = spacing;
  return s;
}

function readStyles(xml: string | undefined) {
  const out = new Map<string, ParaStyle>();
  let defaults: ParaStyle = { run: { size: 11, font: 'Calibri' }, after: 8 };
  if (!xml) return { styles: out, defaults };
  const root = parseXml(xml);
  const st = find(root, 'w:styles');
  const dd = kid(st, 'w:docDefaults');
  const dRun = runStyle(kid(kid(dd, 'w:rPrDefault'), 'w:rPr'), defaults.run);
  const dPPr = kid(kid(dd, 'w:pPrDefault'), 'w:pPr');
  const dSp = kid(dPPr, 'w:spacing');
  defaults = { run: dRun, after: twipPt(dSp?.attrs['w:after']) ?? 0, before: twipPt(dSp?.attrs['w:before']) ?? 0, line: dSp?.attrs['w:line'] && dSp.attrs['w:lineRule'] !== 'exact' && dSp.attrs['w:lineRule'] !== 'atLeast' ? Number(dSp.attrs['w:line']) / 240 : null };
  const raw = new Map<string, El>();
  for (const s of els(st)) if (s.tag === 'w:style' && s.attrs['w:styleId']) raw.set(s.attrs['w:styleId'], s);
  const resolve = (id: string, depth = 0): ParaStyle => {
    if (out.has(id)) return out.get(id)!;
    const s = raw.get(id);
    if (!s || depth > 10) return defaults;
    const based = val(s, 'w:basedOn');
    const base = based ? resolve(based, depth + 1) : defaults;
    const pPr = kid(s, 'w:pPr');
    const sp = kid(pPr, 'w:spacing');
    const r: ParaStyle = {
      jc: val(pPr, 'w:jc') ?? base.jc,
      before: twipPt(sp?.attrs['w:before']) ?? base.before,
      after: twipPt(sp?.attrs['w:after']) ?? base.after,
      line: sp?.attrs['w:line'] && !sp.attrs['w:lineRule']?.match(/exact|atLeast/) ? Number(sp.attrs['w:line']) / 240 : base.line,
      run: runStyle(kid(s, 'w:rPr'), base.run),
    };
    out.set(id, r);
    return r;
  };
  for (const id of raw.keys()) resolve(id);
  const normal = [...raw.values()].find((s) => s.attrs['w:type'] === 'paragraph' && s.attrs['w:default'] === '1');
  if (normal) defaults = resolve(normal.attrs['w:styleId']);
  return { styles: out, defaults };
}

function rels(xml: string | undefined) {
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const r of els(find(parseXml(xml), 'Relationships'))) if (r.attrs.Id) map.set(r.attrs.Id, r.attrs.Target);
  return map;
}

// markers between spans while a part is laid out
const PAGE_BREAK = '\u0001', SECTION_BREAK = '\u0002', TAB = '\u0003';

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' };

export function docxToHtml(docx: Uint8Array, opts: { title?: string; note?: string } = {}) {
  const files = new Map(readZip(docx).map((e) => [e.name, e.data]));
  const text = (name: string) => files.get(name)?.toString('utf8');
  const doc = text('word/document.xml');
  if (!doc) throw new Error('not a Word document');
  const { styles, defaults } = readStyles(text('word/styles.xml'));
  // list formats: a numbered list counts, anything else is a bullet
  const numbering = parseXml(text('word/numbering.xml') ?? '');
  const abstractFmt = new Map(els(find(numbering, 'w:numbering')).filter((k) => k.tag === 'w:abstractNum')
    .map((a) => [a.attrs['w:abstractNumId'], new Map(els(a).filter((l) => l.tag === 'w:lvl').map((l) => [l.attrs['w:ilvl'], val(l, 'w:numFmt') ?? 'bullet']))]));
  const numFmt = (numId?: string, ilvl = '0') => {
    const num = els(find(numbering, 'w:numbering')).find((k) => k.tag === 'w:num' && k.attrs['w:numId'] === numId);
    return abstractFmt.get(val(num, 'w:abstractNumId') ?? '')?.get(ilvl) ?? 'bullet';
  };

  // pageNo fills in PAGE fields (the page number in a footer)
  const renderPart = (xml: string, relsName: string, pageNo = 1) => {
    const r = rels(text(relsName));
    const image = (blip: El | undefined, cx?: string) => {
      const target = blip && r.get(blip.attrs['r:embed']);
      if (!target) return '';
      const file = files.get(target.startsWith('/') ? target.slice(1) : `word/${target}`);
      const ext = target.split('.').pop()!.toLowerCase();
      if (!file || !MIME[ext]) return '';
      const w = cx && /^\d+$/.test(cx) ? Math.round(Number(cx) / 9525) : null;
      return `<img alt="" src="data:${MIME[ext]};base64,${file.toString('base64')}"${w ? ` style="width:${w}px;max-width:100%"` : ''}>`;
    };
    const runCss = (s: RunStyle) => [
      s.b ? 'font-weight:700' : '', s.i ? 'font-style:italic' : '', s.u ? 'text-decoration:underline' : '', s.caps ? 'text-transform:uppercase' : '',
      s.color ? `color:${s.color}` : '', s.size ? `font-size:${s.size}pt` : '', s.spacing ? `letter-spacing:${s.spacing}pt` : '',
    ].filter(Boolean).join(';');

    // Runs as spans. A page break or a tab ends the span it is in, so a paragraph can be split
    // there (PAGE_BREAK, TAB are markers between spans).
    let field: { code: string; result: boolean } | null = null;
    const runs = (p: El, base: RunStyle): string => els(p).map((k) => {
      if (k.tag === 'w:hyperlink' || k.tag === 'w:ins' || k.tag === 'w:smartTag' || k.tag === 'w:customXml') return runs(k, base);
      if (k.tag === 'w:fldSimple') {
        if (/\bPAGE\b/.test(k.attrs['w:instr'] ?? '')) return `<span style="${runCss(runStyle(kid(find(k, 'w:r'), 'w:rPr'), base))}">${pageNo}</span>`;
        return runs(k, base);
      }
      if (k.tag === 'w:sdt') return runs(kid(k, 'w:sdtContent') ?? k, base);
      if (k.tag !== 'w:r') return '';
      const s = runStyle(kid(k, 'w:rPr'), base);
      const css = runCss(s);
      let out = '', h = '';
      const flush = () => { if (h) out += css ? `<span style="${css}">${h}</span>` : `<span>${h}</span>`; h = ''; };
      for (const c of els(k)) {
        if (c.tag === 'w:fldChar') {
          const t = c.attrs['w:fldCharType'];
          if (t === 'begin') field = { code: '', result: false };
          else if (t === 'separate' && field) field.result = true;
          else if (t === 'end') field = null;
        } else if (c.tag === 'w:instrText') { if (field) field.code += c.kids.join(''); }
        else if (c.tag === 'w:t') {
          if (field?.result && /\bPAGE\b/.test(field.code)) { h += String(pageNo); field.code = ''; continue; }
          if (field && !field.result) continue;
          h += esc(c.kids.filter((x) => typeof x === 'string').join(''));
        }
        else if (c.tag === 'w:tab') { flush(); out += TAB; }
        else if (c.tag === 'w:br' || c.tag === 'w:cr') { if (c.attrs['w:type'] === 'page') { flush(); out += PAGE_BREAK; } else h += '<br>'; }
        else if (c.tag === 'w:drawing') { const ext = find(c, 'wp:extent'); h += image(find(c, 'a:blip'), ext?.attrs.cx); }
        else if (c.tag === 'mc:AlternateContent') { const ch = find(c, 'w:drawing'); if (ch) h += image(find(ch, 'a:blip'), find(ch, 'wp:extent')?.attrs.cx); }
      }
      flush();
      return out;
    }).join('');

    // like Word, paragraphs in a row with the same borders share them: a line above the first and
    // below the last only
    const para = (p: El, joinPrev = false, joinNext = false): string => {
      const pPr = kid(p, 'w:pPr');
      const st = styles.get(val(pPr, 'w:pStyle') ?? '') ?? defaults;
      const base = st.run; // the paragraph mark's own formatting doesn't apply to its text
      const sp = kid(pPr, 'w:spacing');
      const before = twipPt(sp?.attrs['w:before']) ?? st.before ?? 0;
      const after = twipPt(sp?.attrs['w:after']) ?? st.after ?? 0;
      const lineAttr = sp?.attrs['w:line'];
      const rule = sp?.attrs['w:lineRule'];
      const line = lineAttr && /^\d+$/.test(lineAttr)
        ? (rule === 'exact' || rule === 'atLeast' ? `${Number(lineAttr) / 20}pt` : (Number(lineAttr) / 240 * 1.15).toFixed(2))
        : st.line ? (st.line * 1.15).toFixed(2) : null;
      const jc = val(pPr, 'w:jc') ?? st.jc;
      const align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : '';
      const fill = hex(kid(pPr, 'w:shd')?.attrs['w:fill']);
      const ind = kid(pPr, 'w:ind');
      const left = twipPt(ind?.attrs['w:left'] ?? ind?.attrs['w:start']);
      const hanging = twipPt(ind?.attrs['w:hanging']);
      const bottom = kid(kid(pPr, 'w:pBdr'), 'w:bottom');
      const topB = kid(kid(pPr, 'w:pBdr'), 'w:top');
      const border = (b?: El) => (b && b.attrs['w:val'] && !['nil', 'none'].includes(b.attrs['w:val']) ? `${Math.max(1, Math.round((Number(b.attrs['w:sz']) || 4) / 6))}px solid ${hex(b.attrs['w:color']) ?? '#000'}` : '');
      const list = kid(pPr, 'w:numPr');
      if (list) listNo++; else listNo = 0;
      const rightTab = els(kid(pPr, 'w:tabs')).some((t) => t.attrs['w:val'] === 'right' || t.attrs['w:val'] === 'end');
      const css = [
        `margin:${before}pt 0 ${after}pt ${list ? Math.max(left ?? 0, 18) : left ?? 0}pt`, align ? `text-align:${align}` : '',
        line ? `line-height:${line}` : '', fill ? `background:${fill};padding:2pt 4pt` : '',
        border(bottom) && !joinNext ? `border-bottom:${border(bottom)};padding-bottom:${twipPt(bottom?.attrs['w:space']) ?? 3}pt` : '',
        border(topB) && !joinPrev ? `border-top:${border(topB)};padding-top:${twipPt(topB?.attrs['w:space']) ?? 3}pt` : '',
        runCss(st.run),
        // the line is as tall as the paragraph's largest text (or its mark, when it is empty), as in Word
        `font-size:${paraSize(p, st.run)}pt`,
      ].filter(Boolean).join(';');
      const fmt = list ? numFmt(val(list, 'w:numId'), val(list, 'w:ilvl') ?? '0') : '';
      const marker = fmt === 'decimal' ? `${listNo}.` : fmt === 'lowerLetter' ? `${String.fromCharCode(96 + Math.min(listNo, 26))}.` : fmt === 'upperLetter' ? `${String.fromCharCode(64 + Math.min(listNo, 26))}.` : '•';
      const bullet = list ? `<span class="bullet" style="width:${hanging ?? 18}pt;margin-left:-${hanging ?? 18}pt">${marker}</span>` : '';
      // a page break splits the paragraph; a right tab stop puts what follows the tab on the right
      const pieces = runs(p, base).split(PAGE_BREAK).map((body, i) => {
        const tabbed = body.split(TAB);
        const inner = rightTab && tabbed.length > 1
          ? `<span>${tabbed.slice(0, -1).join(' ')}</span><span>${tabbed[tabbed.length - 1]}</span>`
          : tabbed.join('<span class="tab"></span>');
        return `<p style="${css}${rightTab && tabbed.length > 1 ? ';display:flex;justify-content:space-between;gap:8pt' : ''}">${i === 0 ? bullet : ''}${inner || '&#8203;'}</p>`;
      });
      const pageBefore = on(pPr, 'w:pageBreakBefore') ? PAGE_BREAK : '';
      // a paragraph holding section properties ends that section: what follows starts a new page
      const sectionEnd = kid(pPr, 'w:sectPr') ? SECTION_BREAK : '';
      return pageBefore + pieces.join(PAGE_BREAK) + sectionEnd;
    };
    let listNo = 0;
    const paraSize = (p: El, base: RunStyle) => {
      const sizes: number[] = [];
      const walk = (e: El) => { for (const k of els(e)) { if (k.tag === 'w:r') { if (els(k).some((c) => c.tag === 'w:t' || c.tag === 'w:drawing')) sizes.push(runStyle(kid(k, 'w:rPr'), base).size ?? 11); } else if (k.tag !== 'w:pPr') walk(k); } };
      walk(p);
      return sizes.length ? Math.max(...sizes) : runStyle(kid(kid(p, 'w:pPr'), 'w:rPr'), base).size ?? base.size ?? 11;
    };

    const borderCss = (b?: El) => {
      if (!b) return null;
      const v = b.attrs['w:val'];
      if (!v || v === 'nil' || v === 'none') return 'none';
      const w = Math.max(1, Math.round((Number(b.attrs['w:sz']) || 4) / 6));
      return `${w}px solid ${hex(b.attrs['w:color']) ?? '#000'}`;
    };
    const table = (t: El): string => {
      const tPr = kid(t, 'w:tblPr');
      const tb = kid(tPr, 'w:tblBorders');
      const grid = els(kid(t, 'w:tblGrid')).map((g) => twipPt(g.attrs['w:w']) ?? 0);
      const rows = els(t).filter((k) => k.tag === 'w:tr');
      const width = twipPt(kid(tPr, 'w:tblW')?.attrs['w:w']);
      const wType = kid(tPr, 'w:tblW')?.attrs['w:type'];
      const tableJc = val(tPr, 'w:jc');
      const defMar = kid(tPr, 'w:tblCellMar');
      let h = `<table style="${wType === 'pct' ? 'width:100%' : width ? `width:${width}pt` : ''}${tableJc === 'center' ? ';margin-left:auto;margin-right:auto' : ''}">`;
      if (grid.length) h += `<colgroup>${grid.map((w) => `<col style="width:${w}pt">`).join('')}</colgroup>`;
      rows.forEach((tr, ri) => {
        const trH = kid(kid(tr, 'w:trPr'), 'w:trHeight');
        const height = twipPt(trH?.attrs['w:val']);
        h += height ? `<tr style="height:${height}pt">` : '<tr>';
        const cells = els(tr).filter((k) => k.tag === 'w:tc');
        cells.forEach((tc, ci) => {
          const pr = kid(tc, 'w:tcPr');
          const vm = kid(pr, 'w:vMerge');
          if (vm && vm.attrs['w:val'] !== 'restart') return; // continues the cell above
          let rowspan = 1;
          if (vm) {
            for (let r = ri + 1; r < rows.length; r++) {
              const below = els(rows[r]).filter((k) => k.tag === 'w:tc')[ci];
              const bvm = kid(kid(below, 'w:tcPr'), 'w:vMerge');
              if (bvm && bvm.attrs['w:val'] !== 'restart') rowspan++; else break;
            }
          }
          const span = Number(val(pr, 'w:gridSpan')) || 1;
          const cb = kid(pr, 'w:tcBorders');
          const side = (name: string, inner: string, first: boolean) => borderCss(kid(cb, name)) ?? borderCss(kid(tb, first ? name : inner)) ?? 'none';
          const pad = (name: string, fallback: number) => twipPt(kid(kid(pr, 'w:tcMar'), name)?.attrs['w:w'] ?? kid(defMar, name)?.attrs['w:w']) ?? fallback;
          const fill = hex(kid(pr, 'w:shd')?.attrs['w:fill']);
          const va = val(pr, 'w:vAlign');
          const css = [
            `border-top:${side('w:top', 'w:insideH', ri === 0)}`, `border-bottom:${side('w:bottom', 'w:insideH', ri === rows.length - 1)}`,
            `border-left:${side('w:left', 'w:insideV', ci === 0)}`, `border-right:${side('w:right', 'w:insideV', ci === cells.length - 1)}`,
            `padding:${pad('w:top', 0)}pt ${pad('w:right', 5.4)}pt ${pad('w:bottom', 0)}pt ${pad('w:left', 5.4)}pt`,
            fill ? `background:${fill}` : '', va === 'center' ? 'vertical-align:middle' : va === 'bottom' ? 'vertical-align:bottom' : 'vertical-align:top',
          ].filter(Boolean).join(';');
          h += `<td style="${css}"${span > 1 ? ` colspan="${span}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}>${block(tc).split(PAGE_BREAK).join('').split(SECTION_BREAK).join('')}</td>`;
        });
        h += '</tr>';
      });
      return `${h}</table>`;
    };
    const borders = (k?: El) => (k?.tag === 'w:p' ? JSON.stringify(els(kid(kid(k, 'w:pPr'), 'w:pBdr')).map((b) => [b.tag, b.attrs])) : null);
    const block = (e: El): string => els(e).map((k, i, all) => {
      if (k.tag === 'w:p') {
        const mine = borders(k), has = mine && mine !== '[]';
        return para(k, !!has && borders(all[i - 1]) === mine, !!has && borders(all[i + 1]) === mine);
      }
      if (k.tag === 'w:tbl') return table(k);
      if (k.tag === 'w:sdt') return block(kid(k, 'w:sdtContent') ?? k);
      if (k.tag === 'w:customXml') return block(k);
      return '';
    }).join('');
    const tree = parseXml(xml);
    return block(find(tree, 'w:body') ?? find(tree, 'w:hdr') ?? find(tree, 'w:ftr') ?? tree);
  };

  // ---- pages: the body split at page and section breaks; each section has its own margins,
  // header and footer (a section without them uses the previous section's)
  const root = parseXml(doc);
  const body = find(root, 'w:body');
  const sections: El[] = [];
  const collect = (e: El) => { for (const k of els(e)) { if (k.tag === 'w:p') { const sp = kid(kid(k, 'w:pPr'), 'w:sectPr'); if (sp) sections.push(sp); } else if (k.tag === 'w:sdt') collect(kid(k, 'w:sdtContent') ?? k); } };
  collect(body!);
  const last = kid(body, 'w:sectPr');
  if (last) sections.push(last);
  if (!sections.length) sections.push({ tag: 'w:sectPr', attrs: {}, kids: [] });
  const docRels = rels(text('word/_rels/document.xml.rels'));
  const partOf = (si: number, kind: 'w:headerReference' | 'w:footerReference', first: boolean) => {
    for (let k = si; k >= 0; k--) {
      const refs = els(sections[k]).filter((x) => x.tag === kind);
      if (!refs.length) continue;
      const want = first && kid(sections[si], 'w:titlePg') ? 'first' : 'default';
      const ref = refs.find((x) => (x.attrs['w:type'] ?? 'default') === want);
      if (!ref) return null;
      const target = docRels.get(ref.attrs['r:id']);
      return target ? { xml: text(`word/${target}`), rels: `word/_rels/${target}.rels` } : null;
    }
    return null;
  };

  const html = renderPart(doc, 'word/_rels/document.xml.rels');
  const pages: { si: number; html: string }[] = [{ si: 0, html: '' }];
  for (const piece of html.split(/(\u0001|\u0002)/)) {
    if (piece === PAGE_BREAK) pages.push({ si: pages[pages.length - 1].si, html: '' });
    else if (piece === SECTION_BREAK) pages.push({ si: Math.min(pages[pages.length - 1].si + 1, sections.length - 1), html: '' });
    else pages[pages.length - 1].html += piece;
  }
  const blank = (h: string) => !/<img|<table/.test(h) && !h.replace(/<[^>]+>/g, '').replace(/&#8203;|\s/g, '');
  const shown = pages.filter((pg) => !blank(pg.html));
  const font = defaults.run.font || 'Calibri';
  const title = opts.title ? esc(opts.title) : 'Proposal preview';
  const sheets = shown.map((pg, i) => {
    const sect = sections[pg.si];
    const pgW = twipPt(kid(sect, 'w:pgSz')?.attrs['w:w']) ?? 612, pgH = twipPt(kid(sect, 'w:pgSz')?.attrs['w:h']) ?? 792;
    const mar = kid(sect, 'w:pgMar');
    const m = (k: string, d: number) => twipPt(mar?.attrs[k]) ?? d;
    const firstOfSection = i === 0 || shown[i - 1].si !== pg.si;
    const hdr = partOf(pg.si, 'w:headerReference', firstOfSection), ftr = partOf(pg.si, 'w:footerReference', firstOfSection);
    const side = `left:${m('w:left', 72)}pt;right:${m('w:right', 72)}pt`;
    return `<section class="page" style="width:${pgW}pt;min-height:${pgH}pt;padding:${m('w:top', 72)}pt ${m('w:right', 72)}pt ${m('w:bottom', 72)}pt ${m('w:left', 72)}pt">`
      + (hdr?.xml ? `<div class="hdr" style="top:${m('w:header', 36)}pt;${side}">${renderPart(hdr.xml, hdr.rels, i + 1)}</div>` : '')
      + pg.html
      + (ftr?.xml ? `<div class="ftr" style="bottom:${m('w:footer', 36)}pt;${side}">${renderPart(ftr.xml, ftr.rels, i + 1)}</div>` : '')
      + '</section>';
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${title}</title><style>
:root{color-scheme:light}
body{margin:0;background:#eef0f4;font-family:'${font.replace(/[^\w .-]/g, '')}',Arial,Helvetica,sans-serif;color:#111;font-size:${defaults.run.size ?? 11}pt}
.bar{position:sticky;top:0;z-index:2;background:#1f2a44;color:#fff;font:13px/1.4 -apple-system,system-ui,sans-serif;padding:10px 16px}
.bar b{font-weight:600}
.page{position:relative;background:#fff;box-sizing:border-box;margin:24px auto;box-shadow:0 1px 4px rgba(0,0,0,.15);overflow:hidden}
.hdr,.ftr{position:absolute}
.hdr p,.ftr p{margin:0}
p{white-space:pre-wrap}
table{border-collapse:collapse;table-layout:fixed;max-width:100%}td p{overflow-wrap:anywhere}
.tab{display:inline-block;width:24pt}.bullet{display:inline-block;font-weight:700}
img{height:auto;vertical-align:middle}
/* a phone: the page shrinks to fit, without the paper look */
@media (max-width:700px){.page{width:auto!important;min-height:0!important;margin:12px;padding:20px 16px!important}.hdr,.ftr{position:static;margin:0 0 12px}table{width:100%!important}}
/* Print or "Save as PDF": one sheet per page, as in Word */
@page{size:letter;margin:0}
@media print{body{background:#fff}.bar{display:none}.page{margin:0;box-shadow:none;break-after:page;height:auto}}
</style></head><body>
<div class="bar"><b>${title}</b>${opts.note ? ` · ${esc(opts.note)}` : ''} · Close to the Word file's layout, not exact. To keep a copy, print this page or save it as a PDF.</div>
${sheets}
</body></html>`;
}
