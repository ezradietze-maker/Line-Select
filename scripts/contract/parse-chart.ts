import type { PdfPage } from "./extract-pdf";

/** One row of the Implementation LOA's Appendix A: which change, in which phase. */
export interface ChartRow {
  section: string;
  refs: string[];
  summary: string;
  phase: 1 | 2 | 3 | 4;
  notes: string;
  /** Yellow in the chart: in force from signing (Phase 1), applied by hand until automated by the listed phase. */
  manualUntilPhase: boolean;
}

/** A cell like "4.A.2.b. and c.; A.6." or "1.E. and F." or "25.L.4.d. and 5.c." into full ids. */
export function expandRefs(cell: string): string[] {
  const out: string[] = [];
  for (const part of cell.replace(/\bflush\b/g, "").split(/;/).map((s) => s.trim()).filter(Boolean)) {
    for (const piece of part.split(/\s+and\s+/).map((s) => s.trim()).filter(Boolean)) {
      const bare = piece.replace(/\.$/, "");
      const prior = out[out.length - 1];
      if (/^\d+\./.test(bare) && /^\d+\.[A-Z]/.test(bare)) out.push(bare);
      else if (prior) {
        // "c." after "4.A.2.b." replaces the last step; "A.6" after "4.A.2.b" replaces all but the section; "F." after "1.E." the last.
        const steps = prior.split(".");
        const isCap = (s: string) => /^[A-Z]{1,2}$/.test(s);
        const given = bare.split(".");
        const keep = isCap(given[0]) ? steps.slice(0, 1) : /^\d+$/.test(given[0]) ? steps.slice(0, steps.findIndex((x) => /^\d+$/.test(x) && steps.indexOf(x) > 0)) : steps.slice(0, -1);
        out.push([...keep, ...given].join("."));
      }
    }
  }
  return out;
}

/** The agreement's own chart pages (printed 289–292). Columns sit at fixed places; rows are grouped by the phase cell. */
export function parseChart(pages: PdfPage[]): ChartRow[] {
  const rows: ChartRow[] = [];
  for (const page of pages) {
    const yellow = page.rects.filter((r) => r.color === "255,255,0");
    const runs = page.runs.filter((r) => r.ink !== "furniture" && r.text.trim());
    const phases = runs.filter((r) => r.x > 380 && r.x < 405 && /^[1-4]$/.test(r.text.trim()));
    for (const ph of phases) {
      const y = ph.y;
      // A row's cells share the phase's line, or wrap a little above and below it.
      const near = runs.filter((r) => Math.abs(r.y - y) < 11 && r !== ph);
      const closest = (test: (x: number) => boolean) => near.filter((r) => test(r.x) && !phases.some((p) => p !== ph && Math.abs(p.y - r.y) < Math.abs(y - r.y)));
      const sectionCell = closest((x) => x < 105).map((r) => r.text.trim());
      const refRuns = closest((x) => x >= 105 && x < 168).sort((a, b) => b.y - a.y);
      // A row with no phase of its own ("see note") sits nearby: of two complete references, this row's is the nearer.
      const complete = refRuns.filter((r) => /^\d+\.[A-Z]/.test(r.text.trim()));
      const refCell = (complete.length > 1 ? [complete.reduce((a, b) => (Math.abs(a.y - y) <= Math.abs(b.y - y) ? a : b))] : refRuns).map((r) => r.text.trim()).join(" ");
      const summary = closest((x) => x >= 168 && x < 380).sort((a, b) => b.y - a.y || a.x - b.x).map((r) => r.text.trim()).join(" ");
      const notes = closest((x) => x >= 420).sort((a, b) => b.y - a.y).map((r) => r.text.trim()).join(" ");
      const section = sectionCell[0] ?? "";
      if (!section || !refCell) continue;
      rows.push({
        section,
        refs: expandRefs(refCell.replace(/^new$/, "")),
        summary,
        phase: Number(ph.text.trim()) as ChartRow["phase"],
        notes,
        manualUntilPhase: yellow.some((r) => Math.abs(r.y + r.h / 2 - y) < r.h && r.x < ph.endX && r.x + r.w > ph.x),
      });
    }
  }
  return rows;
}
