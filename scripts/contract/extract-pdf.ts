import fs from "node:fs";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Reads a redline PDF with its colours kept: the plain text loses the strike-through, so deleted 2015 words and new
 * 2026 words run together. The agreement's legend on page 2 gives the colours (red deletion, blue insertion, green
 * moved); black is unchanged, and header/footer ink has its own grey.
 */

export type Ink = "same" | "added" | "deleted" | "moved-from" | "moved-to" | "furniture";

export interface Run {
  text: string;
  ink: Ink;
  x: number;
  endX: number;
  y: number;
  size: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface PdfPage {
  pageNumber: number;
  runs: Run[];
  rects: Rect[];
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function colorKey(args: unknown): string {
  const raw = args as ArrayLike<number> & { 0?: unknown };
  const values = typeof raw[0] === "string" ? [raw[0]] : Array.from(raw as ArrayLike<number>);
  return values.join(",");
}

const INKS: Record<string, Ink> = {
  "0,0,0": "same",
  "0,0,255": "added",
  "255,0,0": "deleted",
  "238,0,0": "deleted", // the deleted rate tables on pp. 19–20 of the PDF
  "0,192,0": "moved-from", // settled by its line decoration below: moved-from is struck through, moved-to underlined
};

interface GlyphLike {
  unicode?: string;
  width?: number;
  isSpace?: boolean;
}

export async function readPdf(path: string): Promise<PdfPage[]> {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(path)), verbosity: 0, useSystemFonts: true }).promise;
  const pages: PdfPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const list = await page.getOperatorList();
    const runs: Run[] = [];
    const rects: Rect[] = [];
    let ctm: Matrix = IDENTITY;
    const stack: { ctm: Matrix; fill: string }[] = [];
    let fill = "0,0,0";
    let tm: Matrix = IDENTITY;
    let tlm: Matrix = IDENTITY;
    let fontSize = 12;
    let leading = 0;
    let charSpace = 0;
    let wordSpace = 0;
    let hScale = 1;

    list.fnArray.forEach((fn, i) => {
      const a = list.argsArray[i] as unknown[];
      if (fn === OPS.save) stack.push({ ctm, fill });
      else if (fn === OPS.restore) {
        const top = stack.pop();
        if (top) ({ ctm, fill } = top);
      } else if (fn === OPS.transform) ctm = multiply(ctm, a as unknown as Matrix);
      else if (fn === OPS.setFillRGBColor || fn === OPS.setFillColor || fn === OPS.setFillColorN) fill = colorKey(a.length === 1 ? a[0] : a);
      else if (fn === OPS.setFillGray) fill = `${a[0]},${a[0]},${a[0]}`;
      else if (fn === OPS.beginText) tm = tlm = IDENTITY;
      else if (fn === OPS.setFont) fontSize = a[1] as number;
      else if (fn === OPS.setCharSpacing) charSpace = a[0] as number;
      else if (fn === OPS.setWordSpacing) wordSpace = a[0] as number;
      else if (fn === OPS.setHScale) hScale = (a[0] as number) / 100;
      else if (fn === OPS.setLeading) leading = a[0] as number;
      else if (fn === OPS.setTextMatrix) tm = tlm = (a.length === 1 ? Array.from(a[0] as ArrayLike<number>) : a) as Matrix;
      else if (fn === OPS.moveText || fn === OPS.setLeadingMoveText) {
        if (fn === OPS.setLeadingMoveText) leading = -(a[1] as number);
        tm = tlm = multiply(tlm, [1, 0, 0, 1, a[0] as number, a[1] as number]);
      } else if (fn === OPS.nextLine) tm = tlm = multiply(tlm, [1, 0, 0, 1, 0, -leading]);
      else if (fn === OPS.showText) {
        let advance = 0;
        let text = "";
        for (const g of a[0] as (GlyphLike | number | null)[]) {
          if (typeof g === "number") {
            // A TJ adjustment wide enough to read as a space, which some runs use instead of a space glyph.
            if (g < -200) text += " ";
            advance += (-g / 1000) * fontSize * hScale;
          } else if (g) {
            text += g.unicode ?? "";
            advance += (((g.width ?? 0) / 1000) * fontSize + charSpace + (g.isSpace ? wordSpace : 0)) * hScale;
          }
        }
        const full = multiply(ctm, tm);
        const [x, y] = apply(full, 0, 0);
        const [endX] = apply(full, advance, 0);
        const ink: Ink = INKS[fill] ?? "furniture";
        if (text) runs.push({ text, ink, x, endX, y, size: Math.abs(fontSize * full[3]) });
        tm = multiply(tm, [1, 0, 0, 1, advance, 0]);
      } else if (fn === OPS.constructPath) {
        const pathOps = a[0] as number[];
        const coords = a[1] as number[];
        let at = 0;
        for (const op of pathOps) {
          if (op === OPS.rectangle) {
            const [rx, ry] = apply(ctm, coords[at], coords[at + 1]);
            const [rx2, ry2] = apply(ctm, coords[at] + coords[at + 2], coords[at + 1] + coords[at + 3]);
            rects.push({ x: Math.min(rx, rx2), y: Math.min(ry, ry2), w: Math.abs(rx2 - rx), h: Math.abs(ry2 - ry), color: fill });
            at += 4;
          } else if (op === OPS.moveTo || op === OPS.lineTo) at += 2;
          else if (op === OPS.curveTo) at += 6;
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) at += 4;
        }
      }
    });

    // Green is both moved-from and moved-to: the struck-through kind has a rule through the middle of its glyphs.
    for (const run of runs) {
      if (run.ink !== "moved-from") continue;
      const over = rects.filter((r) => r.color === "0,192,0" && r.x < run.endX && r.x + r.w > run.x && Math.abs(r.y - run.y) < run.size);
      const struck = over.some((r) => r.y > run.y + run.size * 0.1);
      run.ink = struck ? "moved-from" : "moved-to";
    }
    pages.push({ pageNumber: p, runs, rects });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}
