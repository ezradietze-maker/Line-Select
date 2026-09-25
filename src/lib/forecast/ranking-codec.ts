/**
 * A pilot's ranking of the pack is a list of line positions, best first. Stored
 * as fixed-width base-36 text (two characters a line, three past 1,296 lines)
 * it's about 570 bytes for a 283-line pack — small enough that every pilot
 * bidding a seat fits in one stored record.
 */
export function widthFor(lineCount: number): number {
  return lineCount <= 1296 ? 2 : 3;
}

export function encodeRanking(indices: number[], lineCount: number): string {
  const width = widthFor(lineCount);
  return indices.map((i) => Math.max(0, Math.floor(i)).toString(36).padStart(width, "0")).join("");
}

export function decodeRanking(text: string, lineCount: number): number[] {
  const width = widthFor(lineCount);
  const out: number[] = [];
  for (let i = 0; i + width <= text.length; i += width) {
    const value = parseInt(text.slice(i, i + width), 36);
    if (Number.isFinite(value) && value >= 0 && value < lineCount) out.push(value);
  }
  return out;
}
