// A small PDF writer (no libraries): pages of text in Helvetica (the PDF standard font with
// Arial's metrics), filled boxes, lines and PNG pictures. Used for the proposal PDF.

import { deflateSync, inflateSync } from 'node:zlib';

const WIDTHS: { r: number[]; b: number[] } = { r: [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,350,556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350,350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500], b: [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,350,556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350,350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556] }; // Helvetica / Helvetica-Bold widths, WinAnsi codes 32-255
const SPECIAL: Record<number, number> = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f, 0x2212: 0x96, 0x00a0: 0x20, 0x202f: 0x20, 0x2009: 0x20 };

function codes(str: string) {
  const out: number[] = [];
  for (const ch of String(str)) {
    const u = ch.codePointAt(0)!;
    if (u >= 32 && u < 127) out.push(u);
    else if (SPECIAL[u] != null) out.push(SPECIAL[u]);
    else if (u >= 0xa0 && u <= 0xff) out.push(u);
    else if (u === 10 || u === 9) out.push(32);
    else out.push(63);
  }
  return out;
}
const pdfString = (s: string) => '<' + codes(s).map((c) => c.toString(16).padStart(2, '0')).join('') + '>';

export type Font = { bold?: boolean; size: number; spacing?: number };
export function textWidth(str: string, f: Font) {
  const t = f.bold ? WIDTHS.b : WIDTHS.r;
  const c = codes(str);
  return (c.reduce((s, k) => s + (t[k - 32] || 556), 0) * f.size) / 1000 + (f.spacing || 0) * Math.max(0, c.length - 1);
}
export function wrap(str: string, maxW: number, f: Font) {
  const lines: string[] = [];
  let cur = '';
  for (const word of String(str).split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(next, f) > maxW) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
const n = (v: number) => (Math.round(v * 100) / 100).toString();

// A PNG as a PDF image (8-bit RGB or RGBA, not interlaced): RGB goes in as it is, RGBA is split
// into colour and a soft mask.
export type Picture = { w: number; h: number; rgb: Buffer; alpha: Buffer | null; predictor: boolean };
export function readPng(png: Buffer): Picture {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8, w = 0, h = 0, type = 0, depth = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at), kind = png.toString('latin1', at + 4, at + 8), data = png.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8 || interlace || (type !== 2 && type !== 6)) throw new Error('unsupported PNG');
  const packed = Buffer.concat(idat);
  if (type === 2) return { w, h, rgb: packed, alpha: null, predictor: true };
  // RGBA: undo the row filters, then split colour and alpha
  const raw = inflateSync(packed), bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp] : 0, b = y ? out[prev + x] : 0, c = x >= bpp && y ? out[prev + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[row + x] = v & 0xff;
    }
  }
  const col = Buffer.alloc(w * h * 3), alpha = Buffer.alloc(w * h);
  for (let p = 0; p < w * h; p++) { col[p * 3] = out[p * 4]; col[p * 3 + 1] = out[p * 4 + 1]; col[p * 3 + 2] = out[p * 4 + 2]; alpha[p] = out[p * 4 + 3]; }
  return { w, h, rgb: deflateSync(col), alpha: deflateSync(alpha), predictor: false };
}

// Coordinates are in points from the top left of a US Letter page.
export const PAGE_W = 612, PAGE_H = 792;
export class Pdf {
  private pages: string[] = [];
  private pictures: Picture[] = [];
  private cur = '';
  addPicture(p: Picture) { this.pictures.push(p); return this.pictures.length - 1; }
  newPage() { if (this.cur || this.pages.length) this.pages.push(this.cur); this.cur = ''; }
  get pageCount() { return this.pages.length + 1; }
  rect(x: number, y: number, w: number, h: number, fill: string) {
    this.cur += `${rgb(fill)} rg ${n(x)} ${n(PAGE_H - y - h)} ${n(w)} ${n(h)} re f\n`;
  }
  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 0.75) {
    this.cur += `${rgb(color)} RG ${n(width)} w ${n(x1)} ${n(PAGE_H - y1)} m ${n(x2)} ${n(PAGE_H - y2)} l S\n`;
  }
  // y is the baseline
  text(str: string, x: number, y: number, f: Font & { color: string; align?: 'left' | 'right' | 'center' }) {
    if (!str) return;
    const w = textWidth(str, f);
    const left = f.align === 'right' ? x - w : f.align === 'center' ? x - w / 2 : x;
    this.cur += `BT /${f.bold ? 'F2' : 'F1'} ${n(f.size)} Tf ${n(f.spacing || 0)} Tc ${rgb(f.color)} rg ${n(left)} ${n(PAGE_H - y)} Td ${pdfString(str)} Tj ET\n`;
  }
  // a check mark (ZapfDingbats)
  check(x: number, y: number, size: number, color: string) {
    this.cur += `BT /F3 ${n(size)} Tf 0 Tc ${rgb(color)} rg ${n(x - size * 0.39)} ${n(PAGE_H - y)} Td (3) Tj ET\n`;
  }
  picture(id: number, x: number, y: number, w: number, h: number) {
    this.cur += `q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(PAGE_H - y - h)} cm /Im${id} Do Q\n`;
  }
  // a link to an address over a box
  private links: { page: number; x: number; y: number; w: number; h: number; uri: string }[] = [];
  link(x: number, y: number, w: number, h: number, uri: string) { this.links.push({ page: this.pages.length, x, y, w, h, uri }); }

  build(info: { title: string; author?: string; subject?: string }) {
    const pages = [...this.pages, this.cur];
    const objs: Buffer[] = [];
    const add = (b: Buffer | string) => { objs.push(Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1')); return objs.length; };
    const stream = (dict: string, data: Buffer) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const f3 = add('<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>');
    const ims = this.pictures.map((p) => {
      const mask = p.alpha ? add(stream(`/Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, p.alpha)) : 0;
      const parms = p.predictor ? ` /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${p.w} >>` : '';
      return add(stream(`/Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${parms}${mask ? ` /SMask ${mask} 0 R` : ''}`, p.rgb));
    });
    const res = `<< /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R >> /XObject << ${ims.map((o, i) => `/Im${i} ${o} 0 R`).join(' ')} >> >>`;
    const pagesId = add('null'); // filled in once the pages are known
    const kids: number[] = [];
    pages.forEach((content, i) => {
      const c = add(stream('/Filter /FlateDecode', deflateSync(Buffer.from(content, 'latin1'))));
      const annots = this.links.filter((l) => l.page === i).map((l) =>
        add(`<< /Type /Annot /Subtype /Link /Rect [${n(l.x)} ${n(PAGE_H - l.y - l.h)} ${n(l.x + l.w)} ${n(PAGE_H - l.y)}] /Border [0 0 0] /A << /S /URI /URI ${pdfString(l.uri)} >> >>`));
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${res} /Contents ${c} 0 R${annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(' ')}]` : ''} >>`));
    });
    objs[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`, 'latin1');
    const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    const meta = add(`<< /Title ${pdfString(info.title)}${info.author ? ` /Author ${pdfString(info.author)}` : ''}${info.subject ? ` /Subject ${pdfString(info.subject)}` : ''} /Producer ${pdfString('Guardrail Pricing Calculator')} >>`);
    const parts: Buffer[] = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    const offsets: number[] = [];
    let len = parts[0].length;
    objs.forEach((o, i) => {
      offsets.push(len);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), o, Buffer.from('\nendobj\n', 'latin1')]);
      parts.push(b); len += b.length;
    });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${meta} 0 R >>\nstartxref\n${len}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(parts);
  }
}
