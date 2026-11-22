import type { Trip, TripLeg } from "@/types/bidpack";

/**
 * The pairing header's own words, as a pilot says them: who it's for, the dates and weekdays it operates — the parts
 * of "1 MO TU SU REPORT AT 0930 (0130) STANDARD CREW / EFFECTIVE SEPTEMBER 28 - OCTOBER 4" the trip view didn't show.
 */

const MONTHS: Record<string, string> = {
  JANUARY: "Jan",
  FEBRUARY: "Feb",
  MARCH: "Mar",
  APRIL: "Apr",
  MAY: "May",
  JUNE: "Jun",
  JULY: "Jul",
  AUGUST: "Aug",
  SEPTEMBER: "Sep",
  OCTOBER: "Oct",
  NOVEMBER: "Nov",
  DECEMBER: "Dec",
};

const WEEKDAYS: Record<string, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };

/** "SEPTEMBER 28" → "Sep 28"; anything else as printed. */
function shortDate(text: string): string {
  const m = text.trim().match(/^([A-Z]+)\s+(\d{1,2})$/i);
  return m && MONTHS[m[1].toUpperCase()] ? `${MONTHS[m[1].toUpperCase()]} ${Number(m[2])}` : text.trim();
}

/** "SEPTEMBER 28 - OCTOBER 4" → "Sep 28 – Oct 4"; "OCTOBER 23 ONLY" → "Oct 23 only". Null when there's nothing printed. */
export function effectiveWords(text: string | undefined): string | null {
  const t = text?.replace(/^EFFECTIVE\s+/i, "").trim();
  if (!t) return null;
  const only = t.match(/^(.*?)\s+ONLY$/i);
  if (only) return `${shortDate(only[1])} only`;
  const range = t.split(/\s+-\s+/);
  if (range.length === 2) return `${shortDate(range[0])} – ${shortDate(range[1])}`;
  return t;
}

/** ["MO", "TU"] → "Mon Tue". */
export function weekdayWords(days: string[] | undefined): string | null {
  if (!days?.length) return null;
  return days.map((d) => WEEKDAYS[d.toUpperCase()] ?? d).join(" ");
}

/**
 * Who flies it: null for a standard crew (nothing to say), else the augmented crew as printed — "1 RFO" a relief first
 * officer, "1 RF2" a second one, "1 CAP" an extra captain — with a line on what that means.
 */
export function crewWords(crew: string | undefined): { short: string; title: string } | null {
  const c = crew?.trim().toUpperCase();
  if (!c || c.startsWith("STANDARD")) return null;
  const m = c.match(/^(\d+)\s+(RFO|RF2|CAP)$/);
  if (!m) return { short: c, title: `Crew: ${c}, as the pairing prints it` };
  const what = m[2] === "RFO" ? "relief first officer" : m[2] === "RF2" ? "second relief first officer" : "extra captain";
  return { short: `+${m[1]} ${m[2]}`, title: `Augmented crew: ${m[1]} ${what}${m[1] === "1" ? "" : "s"} on top of the standard crew (printed "${c}")` };
}

/**
 * A leg's MEAL and S columns. A pack read before the S column was told apart kept a lone "S" as the meal: it's the
 * Supplemental flag ("S - Leg is flown under Supplemental rules", the pages' legend) — it prints on cabs, hotel
 * standby and airline deadheads, which carry no meal.
 */
export function legColumns(leg: Pick<TripLeg, "meal" | "supplemental">): { meal: string | null; supplemental: boolean } {
  if (leg.meal === "S") return { meal: null, supplemental: true };
  return { meal: leg.meal ?? null, supplemental: !!leg.supplemental };
}

/** The header facts a trip has, in the order the pairing prints them. */
export function pairingHeaderFacts(trip: Pick<Trip, "crew" | "effectiveText" | "operatesOn">): { crew: ReturnType<typeof crewWords>; operates: string | null } {
  const days = weekdayWords(trip.operatesOn);
  const dates = effectiveWords(trip.effectiveText);
  return { crew: crewWords(trip.crew), operates: [days, dates].filter(Boolean).join(" · ") || null };
}
