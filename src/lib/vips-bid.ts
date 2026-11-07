/**
 * Hands a ranked line order to FedEx's VIPS "Monthly Bid Input" page.
 *
 * VIPS is a CGI app on pilot.fedex.com with no public API. Its bid page
 * accepts an ordinary form POST, so the bid goes in as a form posted into a
 * new tab: the pilot signs in to VIPS (PurpleID) there, and Line Select never
 * sees a password. The field layout below is the one other FedEx bidding
 * tools post today (n003–n009 the bid questions, n101… the lines in order,
 * n999 the submit), worked out from their public client code — VIPS itself
 * documents none of it, and FedEx could change it at any time, which is why
 * the dialog always points the pilot at VIPS's own Monthly Bid Review.
 *
 * The employee number is needed only because VIPS keys the bid page's
 * address on it; it is kept in this browser and goes nowhere but FedEx.
 */

const VIPS_CGI = "https://pilot.fedex.com/vips-bin/vipscgi";

/** VIPS's own review of the bid it currently holds — what the pilot checks after sending. */
export const VIPS_BID_REVIEW_URL = `${VIPS_CGI}?webmbd`;

/** VIPS's catch-all choices, bid after the specific lines: "any line of this kind that's left." */
export const ANY_LINE_CODES = {
  regular: "9950",
  secondary: "9952",
  reserve: "9954",
} as const;

export type AnyLineKind = keyof typeof ANY_LINE_CODES;

/** Lines go in n101 onward and the submit field is n999, so n998 is the last line slot. */
export const MAX_VIPS_LINES = 998 - 101 + 1;

export interface VipsBidAnswers {
  waiveBufferRecurrent: boolean;
  waiveBufferPhaseIn: boolean;
  waive1in10: boolean;
  protectMinDays: boolean;
}

export const NO_TO_EVERYTHING: VipsBidAnswers = {
  waiveBufferRecurrent: false,
  waiveBufferPhaseIn: false,
  waive1in10: false,
  protectMinDays: false,
};

/** The bid's Yes/No questions in VIPS's own order and wording, each with the field it fills. */
export const VIPS_QUESTIONS: { key: keyof VipsBidAnswers; field: string; text: string }[] = [
  {
    key: "waiveBufferRecurrent",
    field: "n003",
    text: "If you have recurrent training due, do you wish to waive the international duty free buffers in order to schedule recurrent training closer to an international trip?",
  },
  {
    key: "waiveBufferPhaseIn",
    field: "n004",
    text: "Do you wish to waive your international duty free buffer in case of phase-in conflict?",
  },
  { key: "waive1in10", field: "n005", text: "Do you wish to waive 1-in-10 legality in case of phase-in conflict?" },
  { key: "protectMinDays", field: "n006", text: "Do you desire minimum days off protection?" },
];

/** Digits only, as VIPS uses it in the page address — null when what was typed can't be one. */
export function normalizeEmployeeNumber(raw: string): string | null {
  const digits = raw.trim();
  return /^\d{1,7}$/.test(digits) && Number(digits) > 0 ? digits : null;
}

export function vipsBidInputUrl(employeeNumber: string): string {
  return `${VIPS_CGI}?webmtb?${employeeNumber}?input`;
}

export type VipsBidBuild =
  | { ok: true; fields: [name: string, value: string][]; lines: string[] }
  | { ok: false; reason: string };

/**
 * The form fields for one bid, in the order VIPS reads them. `lineNumbers` is
 * the pilot's order, best first; a repeat is dropped (VIPS would only award
 * the first anyway), and the catch-alls go last in the order given.
 */
export function buildVipsBidFields({
  lineNumbers,
  anyLines = [],
  answers,
}: {
  lineNumbers: string[];
  anyLines?: AnyLineKind[];
  answers: VipsBidAnswers;
}): VipsBidBuild {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...lineNumbers, ...anyLines.map((k) => ANY_LINE_CODES[k])]) {
    const n = raw.trim();
    if (!n || seen.has(n)) continue;
    if (!/^\d+$/.test(n)) return { ok: false, reason: `Line "${n}" isn't a line number VIPS can take.` };
    seen.add(n);
    lines.push(n);
  }
  if (lines.length === 0) return { ok: false, reason: "There are no lines to bid." };
  if (lines.length > MAX_VIPS_LINES) {
    return { ok: false, reason: `VIPS takes at most ${MAX_VIPS_LINES} choices; this bid has ${lines.length}.` };
  }

  const fields: [string, string][] = VIPS_QUESTIONS.map((q) => [q.field, answers[q.key] ? "Yes" : "No"]);
  // Questions VIPS has fields for but no longer asks on this page.
  fields.push(["n007", "Unasked"], ["n008", "Unasked"], ["n009", "Unasked"]);
  lines.forEach((n, i) => fields.push([`n${101 + i}`, n]));
  fields.push(["n999", "   Submit   "]);
  return { ok: true, fields, lines };
}

const EMPLOYEE_KEY = "line-select:vips-employee-number:v1";
const ANSWERS_KEY = "line-select:vips-answers:v1";

export function getVipsEmployeeNumber(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(EMPLOYEE_KEY);
  } catch {
    return null;
  }
}

export function setVipsEmployeeNumber(employeeNumber: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (employeeNumber) window.localStorage.setItem(EMPLOYEE_KEY, employeeNumber);
    else window.localStorage.removeItem(EMPLOYEE_KEY);
  } catch {
    // ignore, same as the rest of this storage family
  }
}

/** Last month's answers, so a pilot who always waives the same things doesn't re-tick them — No to everything until they've answered once. */
export function getVipsAnswers(): VipsBidAnswers {
  if (typeof window === "undefined") return NO_TO_EVERYTHING;
  try {
    const raw = window.localStorage.getItem(ANSWERS_KEY);
    if (!raw) return NO_TO_EVERYTHING;
    const parsed = JSON.parse(raw) as Partial<Record<keyof VipsBidAnswers, unknown>>;
    return {
      waiveBufferRecurrent: parsed.waiveBufferRecurrent === true,
      waiveBufferPhaseIn: parsed.waiveBufferPhaseIn === true,
      waive1in10: parsed.waive1in10 === true,
      protectMinDays: parsed.protectMinDays === true,
    };
  } catch {
    return NO_TO_EVERYTHING;
  }
}

export function setVipsAnswers(answers: VipsBidAnswers): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ANSWERS_KEY, JSON.stringify(answers));
  } catch {
    // ignore
  }
}
