import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

/**
 * Text extraction helpers for born-digital bid pack PDFs.
 *
 * pdfjs-dist returns each text item's transform matrix in the page's
 * original (unrotated) coordinate space. Bid pack line-grid pages are
 * typically rotated 90 degrees (landscape content on a portrait page), so
 * we always map through the page's viewport transform before grouping text
 * into rows — otherwise rotated pages come out as scrambled nonsense.
 *
 * pdfjs normally loads its worker via a relative dynamic import
 * (`./pdf.worker.mjs`) resolved next to its own file on disk. Turbopack's
 * server bundling rewrites that path into its chunk output directory, where
 * the file doesn't exist, so the "fake worker" (pdfjs's own in-thread
 * fallback for Node) fails to load. Registering the worker module on
 * `globalThis.pdfjsWorker` short-circuits that lookup — pdfjs checks for it
 * before attempting the dynamic import — and since this is a normal static
 * import, the bundler resolves and includes it correctly either way.
 */
(globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

export interface PositionedItem {
  str: string;
  x: number;
  y: number;
}

export interface ExtractedPage {
  pageNumber: number;
  rotate: number;
  width: number;
  height: number;
  items: PositionedItem[];
}

export async function loadPdf(data: Uint8Array) {
  return pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
}

export async function extractPage(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number
): Promise<ExtractedPage> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();

  const items: PositionedItem[] = content.items.map((it) => {
    // TextItem also includes TextMarkedContent in the type union; only
    // TextItem has `transform`/`str`, which is all real content has here.
    const textItem = it as { str: string; transform: number[] };
    const [x, y] = pdfjsLib.Util.applyTransform(
      [textItem.transform[4], textItem.transform[5]],
      viewport.transform
    );
    return { str: textItem.str, x, y };
  });

  return {
    pageNumber,
    rotate: page.rotate,
    width: viewport.width,
    height: viewport.height,
    items,
  };
}

/** Groups positioned items into visual text rows, top to bottom, left to right. */
export function groupIntoRows(
  items: PositionedItem[],
  rowTolerance = 2
): string[] {
  const buckets = new Map<number, PositionedItem[]>();
  for (const it of items) {
    if (!it.str.trim()) continue;
    const key = Math.round(it.y / rowTolerance) * rowTolerance;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(it);
  }
  const sortedYs = Array.from(buckets.keys()).sort((a, b) => a - b);
  return sortedYs.map((y) =>
    buckets
      .get(y)!
      .sort((a, b) => a.x - b.x)
      .map((i) => i.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Splits a page's items into left/right halves and returns each as row text — pairing pages print two side-by-side columns. */
export function extractTwoColumnRows(page: ExtractedPage): {
  left: string[];
  right: string[];
} {
  const midX = page.width / 2;
  return {
    left: groupIntoRows(page.items.filter((i) => i.x < midX)),
    right: groupIntoRows(page.items.filter((i) => i.x >= midX)),
  };
}

/** Heuristic check for garbled/empty extraction, suggesting a scanned (image-only) PDF. */
export function looksGarbled(rows: string[]): boolean {
  const text = rows.join(" ");
  if (text.trim().length < 20) return true;
  const alnum = (text.match(/[a-zA-Z0-9]/g) || []).length;
  return alnum / Math.max(1, text.length) < 0.2;
}
