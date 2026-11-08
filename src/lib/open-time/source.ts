/**
 * Where open time comes from. Everything past this file reads an `OpenTimeSnapshot` and doesn't care how it was made:
 * today a pilot's paste (`parse.ts`); later anything else that can name a trip and a date. A new source fills in these
 * shapes and changes nothing in the rules or the scoring.
 */

/** One row of open time, as far as the source says. */
export interface OpenTimeRow {
  /** The source's own text, for showing back to the pilot. */
  raw: string;
  /**
   * The trip number, or the numbers it could be, likeliest first. A source that knows has one. A paste with an unlabelled
   * "213 14OCT 1430" has two, and the pack decides: the row is only used if exactly one of them flies on that date.
   */
  tripNumbers: string[];
  month: number;
  day: number;
  year?: number;
  /** What the row itself prints, when it does, to catch a trip revised since the pack. */
  creditHours?: number;
  tafbHours?: number;
  /** "HHMM", in whatever zone the source prints. */
  reportTime?: string;
  /** CBA 2026 25.G.2.b.iii: visible, "but displayed in a manner indicating that it is available only to CRS". */
  frozen?: boolean;
  /** CBA 2026 25.L.1.a.v: "the time stamp for a trip or standby's appearance in open time", when the source has it. Epoch ms. */
  appearedAt?: number;
}

/** A row that couldn't be read, and why. It's shown to the pilot, never guessed at. */
export interface UnreadRow {
  raw: string;
  why: string;
}

export interface OpenTimeSnapshot {
  /** "paste" today. A label for showing; nothing branches on it. */
  source: string;
  /** When this list was true, epoch ms. A paste is as fresh as the moment it was pasted. */
  readAt: number;
  rows: OpenTimeRow[];
  unread: UnreadRow[];
  /** Lines taken as column headings and not as trips. */
  headings: string[];
}

export interface OpenTimeSource {
  read(): Promise<OpenTimeSnapshot>;
}
