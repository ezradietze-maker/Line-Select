/** Shapes shared by the contract question box's server code and its page. The contract's text itself stays on the server. */

export interface ContractNode {
  /** 25.F.3.a, 25.A.7.b.i.(c), LOA-Mediation.2 */
  id: string;
  doc: string;
  parent: string | null;
  marker: string;
  title?: string;
  /** The agreement's printed page. */
  page: number;
  pageEnd: number;
  /** Its own 2026 words, without the pieces under it. */
  text: string;
  /** Its own 2015 words at this place in the contract, when they changed. */
  old?: string;
  changed: boolean;
}

export interface ContractDoc {
  id: string;
  title: string;
}

export interface ChartRow {
  section: string;
  refs: string[];
  summary: string;
  phase: 1 | 2 | 3 | 4;
  notes: string;
  manualUntilPhase: boolean;
}

export type ContractVersion = "2026" | "2015";

/** When a piece of the contract applies, worked out from the Implementation LOA's chart, not from the model. */
export type Applicability =
  | { kind: "unchanged" }
  | { kind: "scheduled"; phase: 1 | 2 | 3 | 4; startsLabel: string; inForce: boolean; manual: boolean; note?: string }
  | { kind: "mixed"; phases: { phase: 1 | 2 | 3 | 4; startsLabel: string; refs: string[] }[] }
  | { kind: "unlisted" }
  /** A change the chart doesn't list that ties to one it dates later, too loosely to say which date it takes. */
  | { kind: "undated" };

export interface AnswerQuote {
  section: string;
  /** "Bid Period Processing › Secondary Working Window (SWW)" */
  path: string;
  page: number;
  quote: string;
  version: ContractVersion;
  applies: Applicability;
  /** The other version's wording of this piece, when it has one, to show beside a rule that's changing. */
  otherWording?: string;
}

export interface ClosestSection {
  section: string;
  path: string;
  page: number;
}

export type ContractAnswer =
  | { found: true; answer: string; quotes: AnswerQuote[] }
  | { found: false; answer: string; closest: ClosestSection[]; covered: string[] };

export interface SectionView {
  section: string;
  path: string;
  page: number;
  pageEnd: number;
  applies: Applicability;
  pieces: { id: string; marker: string; depth: number; title?: string; text: string; old?: string }[];
}
