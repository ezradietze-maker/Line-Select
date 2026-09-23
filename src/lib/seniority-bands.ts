import type { SeniorityInput } from "@/types/strategy";

/**
 * Plenty of pilots know roughly where they sit ("upper third") without
 * knowing their exact number in this seat, or how many pilots hold it — and
 * the Strategies board only needs the *proportion* (rank / total) to tell a
 * realistic move from a reach. So a rough band is a valid answer, stored in
 * the same shape as an exact one: a fixed 100-pilot scale with the band's
 * midpoint as the rank.
 */
export type SeniorityBand = "top-10" | "upper-third" | "middle-third" | "lower-third";

export const SENIORITY_BANDS: { id: SeniorityBand; label: string; hint: string; input: SeniorityInput }[] = [
  { id: "top-10", label: "Top 10%", hint: "Among the most senior in the seat", input: { rank: 5, totalPilots: 100 } },
  { id: "upper-third", label: "Upper third", hint: "Senior, but not at the very top", input: { rank: 20, totalPilots: 100 } },
  { id: "middle-third", label: "Middle third", hint: "Right around the middle", input: { rank: 50, totalPilots: 100 } },
  { id: "lower-third", label: "Lower third", hint: "Toward the junior end", input: { rank: 83, totalPilots: 100 } },
];

export function seniorityFromBand(band: SeniorityBand): SeniorityInput {
  const found = SENIORITY_BANDS.find((b) => b.id === band);
  if (!found) throw new Error(`Unknown seniority band "${band}"`);
  return { ...found.input };
}
