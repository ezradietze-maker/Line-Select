import type { PdfPage, Run } from "./extract-pdf";

/** One numbered piece of the agreement, e.g. 25.F.3.a. `text` is its own words, without those of the pieces under it. */
export interface ParsedNode {
  id: string;
  doc: string;
  parent: string | null;
  marker: string;
  title?: string;
  page: number;
  pageEnd: number;
  text: string;
  /** The wording this place in the contract had before 2026; only when its own words changed. */
  old?: string;
  changed: boolean;
}

export interface ParsedDoc {
  id: string;
  title: string;
}

/** Page headers name each part of the agreement. Sections go by their tab number; these are the rest. */
const OTHER_DOCS: Record<string, ParsedDoc> = {
  "Letter from FedEx Corporation to ALPA (2026)": { id: "Letter-FedEx", title: "Letter from FedEx Corporation to ALPA (2026)" },
  "Prior Calendar Year Net Aircraft Difference Methodology": { id: "1-PCYNAD", title: "Prior Calendar Year Net Aircraft Difference Methodology" },
  "Appendix A": { id: "25-Appendix-A", title: "Section 25 Appendix A" },
  "MBCBP/Enhanced PRSP Benefit Implementation LOA": { id: "LOA-MBCBP", title: "MBCBP/Enhanced PRSP Benefit Implementation LOA" },
  "Letter—Section 28.F. Retirement Bonus": { id: "Letter-28.F", title: "Letter—Section 28.F. Retirement Bonus" },
  "Amendable Period Recovery Payments LOA (2026)": { id: "LOA-Recovery", title: "Amendable Period Recovery Payments LOA (2026)" },
  "Mediation LOA (2026)": { id: "LOA-Mediation", title: "Mediation LOA (2026)" },
  "Implementation LOA & Appendix (2026)": { id: "LOA-Implementation", title: "Implementation LOA & Appendix (2026)" },
};

type Kind = "cap" | "num" | "low" | "rom" | "plow" | "pnum" | "prom";

interface Candidate {
  kind: Kind;
  ord: number;
  label: string;
}

const ROMAN: Record<string, number> = Object.fromEntries(
  ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"].map((r, i) => [r, i + 1]),
);
const lowerOrd = (s: string) => (s.length === 1 ? s.charCodeAt(0) - 96 : s[0] === s[1] ? 26 + (s.charCodeAt(0) - 96) : 0);
const upperOrd = (s: string) => (s.length === 1 ? s.charCodeAt(0) - 64 : s[0] === s[1] ? 26 + (s.charCodeAt(0) - 64) : 0);

/** What a line's first token could be as a section marker. "i." can be the letter after h. or the first roman numeral. */
export function markerCandidates(token: string): Candidate[] {
  let m: RegExpMatchArray | null;
  if ((m = token.match(/^([A-Z]{1,2})\.$/)) && upperOrd(m[1])) return [{ kind: "cap", ord: upperOrd(m[1]), label: m[1] }];
  if ((m = token.match(/^(\d{1,3})\.$/))) return [{ kind: "num", ord: Number(m[1]), label: m[1] }];
  if ((m = token.match(/^([a-z]{1,5})\.$/))) {
    const out: Candidate[] = [];
    if (m[1].length <= 2 && lowerOrd(m[1])) out.push({ kind: "low", ord: lowerOrd(m[1]), label: m[1] });
    if (ROMAN[m[1]]) out.push({ kind: "rom", ord: ROMAN[m[1]], label: m[1] });
    return out;
  }
  if ((m = token.match(/^\(([a-z]{1,5})\)$/))) {
    const out: Candidate[] = [];
    if (m[1].length <= 2 && lowerOrd(m[1])) out.push({ kind: "plow", ord: lowerOrd(m[1]), label: `(${m[1]})` });
    if (ROMAN[m[1]]) out.push({ kind: "prom", ord: ROMAN[m[1]], label: `(${m[1]})` });
    return out;
  }
  if ((m = token.match(/^\((\d{1,2})\)$/))) return [{ kind: "pnum", ord: Number(m[1]), label: `(${m[1]})` }];
  return [];
}

const KEEP_2026 = new Set(["same", "added", "moved-to"]);
const KEEP_2015 = new Set(["same", "deleted", "moved-from"]);

interface Line {
  page: number;
  y: number;
  x: number;
  now: string;
  was: string;
  changed: boolean;
  gapBefore: number;
}

/** Joins kept runs. A space goes in only where the kept words themselves stand apart: a deleted word between two kept ones doesn't count. */
function joinRuns(runs: Run[], keep: Set<string>): { text: string; x: number | null } {
  let text = "";
  let x: number | null = null;
  let lastEnd = 0;
  let dropped = 0;
  for (const r of runs) {
    if (!keep.has(r.ink)) {
      dropped += r.endX - r.x;
      continue;
    }
    if (x === null && r.text.trim()) x = r.x;
    if (text && r.x - lastEnd - dropped > 1 && !/\s$/.test(text) && !/^\s/.test(r.text)) text += " ";
    text += r.text;
    lastEnd = r.endX;
    dropped = 0;
  }
  return { text: text.replace(/\s+/g, " ").trim(), x };
}

function linesOf(page: PdfPage, printedPage: number): Line[] {
  const runs = page.runs.filter((r) => r.ink !== "furniture");
  const rows: Run[][] = [];
  for (const r of runs) {
    const row = rows[rows.length - 1];
    const prior = row?.[row.length - 1];
    // A superscript ("4th") sits a little above its line and carries on along it.
    const superscript = prior && Math.abs(prior.y - r.y) < 7 && r.x >= prior.endX - 1 && (r.size < prior.size * 0.85 || prior.size < r.size * 0.85);
    if (row && (Math.abs(row[0].y - r.y) < 2 || superscript)) row.push(r);
    else rows.push([r]);
  }
  const lines: Line[] = [];
  let lastY: number | null = null;
  for (const row of rows) {
    const now = joinRuns(row, KEEP_2026);
    const was = joinRuns(row, KEEP_2015);
    if (!now.text && !was.text) continue;
    const y = row[0].y;
    lines.push({
      page: printedPage,
      y,
      x: now.x ?? was.x ?? row[0].x,
      now: now.text,
      was: was.text,
      changed: row.some((r) => r.text.trim() && r.ink !== "same"),
      gapBefore: lastY === null ? 0 : lastY - y,
    });
    lastY = y;
  }
  return lines;
}

function headerOf(page: PdfPage): { title: string; tab: string | null } | null {
  const header = page.runs.filter((r) => r.ink === "furniture" && r.y > 700);
  const titleRun = header.find((r) => r.size < 20 && r.text.trim());
  if (!titleRun) return null;
  const tab = header.find((r) => r.size >= 20 && /^\d+$/.test(r.text.trim()));
  return { title: titleRun.text.trim(), tab: tab ? tab.text.trim() : null };
}

/** Reads the running text; a wrapped line that ends in a hyphen joins the next without a space. */
function appendLine(text: string, line: string, paragraph: boolean): string {
  if (!line) return text;
  if (!text) return line;
  if (paragraph) return `${text}\n${line}`;
  return /[-/]$/.test(text) ? text + line : `${text} ${line}`;
}

interface Open {
  kind: Kind;
  ord: number;
  x: number;
  page: number;
  node: ParsedNode;
}

export interface ParseReport {
  docs: ParsedDoc[];
  nodes: ParsedNode[];
  /** Lines that looked like a marker but didn't fit the numbering around them, for checking by eye. */
  rejected: string[];
}

export function parseAgreement(pages: PdfPage[]): ParseReport {
  const docs: ParsedDoc[] = [];
  const nodes: ParsedNode[] = [];
  const rejected: string[] = [];
  let doc: ParsedDoc | null = null;
  let root: ParsedNode | null = null;
  let stack: Open[] = [];
  const seen = new Set<string>();
  let noteLines = 0;
  let heading: ParsedNode | null = null;

  const startDoc = (d: ParsedDoc, page: number) => {
    doc = d;
    if (!docs.some((x) => x.id === d.id)) docs.push(d);
    root = { id: d.id, doc: d.id, parent: null, marker: "", title: d.title, page, pageEnd: page, text: "", changed: false };
    nodes.push(root);
    seen.add(d.id);
    stack = [];
    heading = null;
  };

  for (const page of pages) {
    const printed = page.pageNumber - 2;
    if (page.pageNumber < 5) continue; // cover, legend, contents
    const header = headerOf(page);
    if (!header) continue;
    const other = OTHER_DOCS[header.title];
    const wanted: ParsedDoc = other ?? { id: header.tab ?? header.title, title: `Section ${header.tab}: ${header.title}` };
    if ((doc as ParsedDoc | null)?.id !== wanted.id) startDoc(wanted, printed);

    for (const line of linesOf(page, printed)) {
      // A bracketed note carries its own short lists ("1. LMS (4.I.4.d.)"), which aren't the section's numbering.
      if (noteLines > 0) {
        // One note in Section 26 never closes its bracket; the next capital heading ends it anyway.
        const heading_ = markerCandidates(line.now.split(" ")[0] ?? "").some((c) => c.kind === "cap" && stack.some((s) => s.kind === "cap" && c.ord === s.ord + 1));
        if (!heading_) {
          addText(stack.length ? stack[stack.length - 1].node : root!, line);
          noteLines = line.now.includes("]") ? 0 : noteLines - 1;
          continue;
        }
        noteLines = 0;
      }
      if (/^\[Note\b/.test(line.now) && !line.now.includes("]")) {
        noteLines = 15;
        addText(stack.length ? stack[stack.length - 1].node : root!, line);
        continue;
      }
      // Appendix A numbers each group of parameters afresh under a plain heading.
      if (root!.id === "25-Appendix-A" && /^(HARD PARAMETERS|Domestic|International)$/.test(line.now)) {
        stack = [];
        const id = `${root!.id}.${line.now.split(" ")[0]}`;
        const node: ParsedNode = { id, doc: root!.id, parent: root!.id, marker: "", title: line.now, page: line.page, pageEnd: line.page, text: "", changed: false };
        nodes.push(node);
        seen.add(id);
        heading = node;
        continue;
      }
      const current: ParsedNode = stack.length ? stack[stack.length - 1].node : (heading ?? root!);
      const token = line.now.split(" ")[0] ?? "";
      const candidates = markerCandidates(token);
      let placed = false;
      if (candidates.length) {
        placed = placeMarker(candidates, line, token);
        if (!placed && /^(\(?[a-z0-9]{1,5}\)|[A-Za-z0-9]{1,3}\.)$/.test(token) && line.now.length > token.length) {
          rejected.push(`p${line.page} x${line.x.toFixed(0)} [${stack.map((s) => s.node.id).pop() ?? doc!.id}] ${line.now.slice(0, 70)}`);
        }
      }
      if (!placed) addText(current, line);
    }
  }

  /**
   * Numbering decides, indent only breaks ties: the pages of several sections sit at different left margins, so an
   * indent is only comparable with one placed on the same page. A marker is the next one along at some open level (the
   * deepest that fits), or the first one under the deepest open piece.
   */
  function placeMarker(candidates: Candidate[], line: Line, token: string): boolean {
    const deepest = stack[stack.length - 1];
    const under = (c: Candidate) =>
      c.ord === 1 &&
      (deepest
        ? deepest.page === line.page
          ? line.x > deepest.x + (stack.some((s) => s.kind === c.kind) ? 6 : 1)
          : !stack.some((s) => s.kind === c.kind)
        : c.kind === "cap" || c.kind === "num" || c.kind === "low");

    // A capital A. starts a new top level, whatever was open: some sections open with definitions numbered their own way.
    const capital = candidates.find((c) => c.kind === "cap" && c.ord === 1);
    if (capital && !stack.some((s) => s.kind === "cap")) {
      stack = [];
      open_(capital, line, token);
      return true;
    }
    // "i." right after "h." is the letter at the same indent, or the first roman numeral further in.
    if (deepest && deepest.page === line.page) {
      const child = candidates.find((c) => under(c) && c.kind !== deepest.kind);
      if (child && line.x > deepest.x + 6) {
        open_(child, line, token);
        return true;
      }
    }
    for (let d = stack.length - 1; d >= 0; d--) {
      const open = stack[d];
      for (const c of candidates) {
        if (c.kind !== open.kind) continue;
        const samePage = open.page === line.page;
        // Numbering can skip a little where a provision was reserved or removed, but only at exactly the same indent.
        const next = c.ord === open.ord + 1 || (samePage && c.ord > open.ord && c.ord <= open.ord + 3 && Math.abs(line.x - open.x) < 1);
        // A list restarted inside a list (a "1." under "b.") only yields to its own next number at its own indent.
        const alsoOpenHigher = stack.slice(0, d).some((s) => s.kind === c.kind && c.ord === s.ord + 1);
        if (next && (!samePage || !alsoOpenHigher || Math.abs(line.x - open.x) < 6)) {
          stack = stack.slice(0, d);
          open_(c, line, token);
          return true;
        }
      }
    }
    for (const c of candidates) {
      if (under(c)) {
        open_(c, line, token);
        return true;
      }
    }
    return false;
  }

  function open_(c: Candidate, line: Line, token: string) {
    const parent: ParsedNode = stack.length ? stack[stack.length - 1].node : (heading ?? root!);
    let id = `${parent.id}.${c.label}`;
    // A second part of a section that restarts its numbering (a table's rows, a letter's list) keeps its ids unique.
    let n = 2;
    while (seen.has(id)) id = `${parent.id}.${c.label}~${n++}`;
    seen.add(id);
    const node: ParsedNode = { id, doc: parent.doc, parent: parent.id, marker: token, page: line.page, pageEnd: line.page, text: "", changed: false };
    nodes.push(node);
    stack = [...stack, { kind: c.kind, ord: c.ord, x: line.x, page: line.page, node }];
    const body = line.now.slice(token.length).trim();
    const old = line.was.startsWith(token) ? line.was.slice(token.length).trim() : line.was;
    if (body && body.length < 90 && !/[.:;,]$/.test(body) && (c.kind === "cap" || c.kind === "num")) node.title = body;
    addText(node, { ...line, now: body, was: old, gapBefore: 0 });
  }

  function addText(node: ParsedNode, line: Line) {
    const paragraph = line.gapBefore > 16 || line.gapBefore < 0;
    node.text = appendLine(node.text, line.now, paragraph);
    node.old = appendLine(node.old ?? "", line.was, paragraph);
    node.pageEnd = line.page;
    node.changed ||= line.changed;
  }

  for (const n of nodes) {
    if (!n.changed) delete n.old;
    // A heading stands alone on its line. A first line that runs on into the next was the start of a sentence.
    if (n.title && n.parent && n.text !== n.title && !n.text.startsWith(`${n.title}\n`)) delete n.title;
  }
  return { docs, nodes, rejected };
}
