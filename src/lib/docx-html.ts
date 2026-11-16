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

type RunStyle = { b?: boolean; i?: boolean; u?: boolean; caps?: boolean; color?: string | null; size?: number | null; font?: string | null };
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

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' };

export function docxToHtml(docx: Uint8Array, opts: { title?: string; note?: string } = {}) {
  const files = new Map(readZip(docx).map((e) => [e.name, e.data]));
  const text = (name: string) => files.get(name)?.toString('utf8');
  const doc = text('word/document.xml');
  if (!doc) throw new Error('not a Word document');
  const { styles, defaults } = readStyles(text('word/styles.xml'));

  const renderPart = (xml: string, relsName: string) => {
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
      s.color ? `color:${s.color}` : '', s.size ? `font-size:${s.size}pt` : '',
    ].filter(Boolean).join(';');

    const runs = (p: El, base: RunStyle): string => els(p).map((k) => {
      if (k.tag === 'w:hyperlink' || k.tag === 'w:ins' || k.tag === 'w:smartTag' || k.tag === 'w:fldSimple' || k.tag === 'w:customXml') return runs(k, base);
      if (k.tag === 'w:sdt') return runs(kid(k, 'w:sdtContent') ?? k, base);
      if (k.tag !== 'w:r') return '';
      const s = runStyle(kid(k, 'w:rPr'), base);
      let h = '';
      for (const c of els(k)) {
        if (c.tag === 'w:t') h += esc(c.kids.filter((x) => typeof x === 'string').join(''));
        else if (c.tag === 'w:tab') h += '<span class="tab"></span>';
        else if (c.tag === 'w:br' || c.tag === 'w:cr') h += c.attrs['w:type'] === 'page' ? '</span><hr class="page"><span>' : '<br>';
        else if (c.tag === 'w:drawing') { const ext = find(c, 'wp:extent'); h += image(find(c, 'a:blip'), ext?.attrs.cx); }
        else if (c.tag === 'mc:AlternateContent') { const ch = find(c, 'w:drawing'); if (ch) h += image(find(ch, 'a:blip'), find(ch, 'wp:extent')?.attrs.cx); }
      }
      if (!h) return '';
      const css = runCss(s);
      return css ? `<span style="${css}">${h}</span>` : `<span>${h}</span>`;
    }).join('');

    const para = (p: El): string => {
      const pPr = kid(p, 'w:pPr');
      const st = styles.get(val(pPr, 'w:pStyle') ?? '') ?? defaults;
      const base = st.run; // the paragraph mark's own formatting doesn't apply to its text
      const sp = kid(pPr, 'w:spacing');
      const before = twipPt(sp?.attrs['w:before']) ?? st.before ?? 0;
      const after = twipPt(sp?.attrs['w:after']) ?? st.after ?? 0;
      const lineAttr = sp?.attrs['w:line'];
      const line = lineAttr && !sp?.attrs['w:lineRule']?.match(/exact|atLeast/) ? Number(lineAttr) / 240 : st.line;
      const jc = val(pPr, 'w:jc') ?? st.jc;
      const align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : '';
      const fill = hex(kid(pPr, 'w:shd')?.attrs['w:fill']);
      const ind = kid(pPr, 'w:ind');
      const left = twipPt(ind?.attrs['w:left'] ?? ind?.attrs['w:start']);
      const bottom = kid(kid(pPr, 'w:pBdr'), 'w:bottom');
      const topB = kid(kid(pPr, 'w:pBdr'), 'w:top');
      const border = (b?: El) => (b && b.attrs['w:val'] && !['nil', 'none'].includes(b.attrs['w:val']) ? `1px solid ${hex(b.attrs['w:color']) ?? '#000'}` : '');
      const list = kid(pPr, 'w:numPr');
      const css = [
        `margin:${before}pt 0 ${after}pt ${list ? Math.max(left ?? 0, 18) : left ?? 0}pt`, align ? `text-align:${align}` : '',
        line ? `line-height:${line.toFixed(2)}` : '', fill ? `background:${fill};padding:2pt 4pt` : '',
        border(bottom) ? `border-bottom:${border(bottom)};padding-bottom:3pt` : '', border(topB) ? `border-top:${border(topB)};padding-top:3pt` : '',
        runCss(st.run),
      ].filter(Boolean).join(';');
      const body = runs(p, base);
      return `<p style="${css}">${list ? '<span class="bullet">•</span>' : ''}${body || '&#8203;'}</p>`;
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
        h += '<tr>';
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
          h += `<td style="${css}"${span > 1 ? ` colspan="${span}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}>${block(tc)}</td>`;
        });
        h += '</tr>';
      });
      return `${h}</table>`;
    };
    const block = (e: El): string => els(e).map((k) => {
      if (k.tag === 'w:p') return para(k);
      if (k.tag === 'w:tbl') return table(k);
      if (k.tag === 'w:sdt') return block(kid(k, 'w:sdtContent') ?? k);
      if (k.tag === 'w:customXml') return block(k);
      return '';
    }).join('');
    const tree = parseXml(xml);
    return block(find(tree, 'w:body') ?? find(tree, 'w:hdr') ?? find(tree, 'w:ftr') ?? tree);
  };

  const root = parseXml(doc);
  const sect = find(find(root, 'w:body'), 'w:sectPr');
  const pgW = twipPt(kid(sect, 'w:pgSz')?.attrs['w:w']) ?? 612;
  const mar = kid(sect, 'w:pgMar');
  const m = (k: string, d: number) => twipPt(mar?.attrs[k]) ?? d;
  const docRels = rels(text('word/_rels/document.xml.rels'));
  const part = (kind: 'w:headerReference' | 'w:footerReference') => {
    const ref = els(sect).find((k) => k.tag === kind && (k.attrs['w:type'] ?? 'default') === 'default') ?? els(sect).find((k) => k.tag === kind);
    const target = ref && docRels.get(ref.attrs['r:id']);
    const xml = target && text(`word/${target}`);
    return xml ? renderPart(xml, `word/_rels/${target}.rels`) : '';
  };
  const font = defaults.run.font || 'Calibri';
  const title = opts.title ? esc(opts.title) : 'Proposal preview';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${title}</title><style>
:root{color-scheme:light}
body{margin:0;background:#eef0f4;font-family:'${font.replace(/[^\w .-]/g, '')}',Calibri,Carlito,Arial,sans-serif;color:#111;font-size:${defaults.run.size ?? 11}pt}
.bar{position:sticky;top:0;z-index:1;background:#1f2a44;color:#fff;font:13px/1.4 -apple-system,system-ui,sans-serif;padding:10px 16px}
.bar b{font-weight:600}
.page{background:#fff;box-sizing:border-box;width:min(100% - 32px,${pgW}pt);margin:24px auto;padding:${m('w:top', 72)}pt ${m('w:right', 72)}pt ${m('w:bottom', 72)}pt ${m('w:left', 72)}pt;box-shadow:0 1px 4px rgba(0,0,0,.15)}
@media (max-width:700px){.page{padding:20px 16px}}
.hdr,.ftr{color:#555}.hdr{margin-bottom:18pt}.ftr{margin-top:24pt}
table{border-collapse:collapse;table-layout:fixed;max-width:100%}td p{overflow-wrap:anywhere}
.tab{display:inline-block;width:24pt}.bullet{display:inline-block;width:14pt;margin-left:-14pt}
hr.page{border:0;border-top:1px dashed #bbb;margin:18pt 0}
img{height:auto;vertical-align:middle}
</style></head><body>
<div class="bar"><b>${title}</b>${opts.note ? ` · ${esc(opts.note)}` : ''} · Layout is close to Word's, not exact. Open the Word file for the final look.</div>
<div class="page"><div class="hdr">${part('w:headerReference')}</div>${renderPart(doc, 'word/_rels/document.xml.rels')}<div class="ftr">${part('w:footerReference')}</div></div>
</body></html>`;
}
