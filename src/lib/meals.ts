/**
 * The pairing's MEAL column in words. The codes, as the ex-pilot read them: S snack, DS dinner snack, BS breakfast
 * snack, DH dinner hot, BH breakfast hot. Two meals print joined ("DH/BH"); a trailing "I" ("BSI", "DSI") is left
 * aside for now. A code nobody has explained yet (DM, BM, MS, NOCAT) prints as itself rather than as a guess.
 */

const MEALS: Record<string, string> = {
  S: "Snack",
  DS: "Dinner snack",
  BS: "Breakfast snack",
  DH: "Dinner hot",
  BH: "Breakfast hot",
};

/** One meal code's words, or null when it isn't one we know. */
function oneMeal(code: string): string | null {
  return MEALS[code] ?? (code.length > 1 && code.endsWith("I") ? (MEALS[code.slice(0, -1)] ?? null) : null);
}

/** "DH/BH" → "Dinner hot, then breakfast hot"; "BSI" → "Breakfast snack"; "NOCAT" → "NOCAT". */
export function mealWords(code: string): string {
  const parts = code.split("/").map((c) => oneMeal(c) ?? c);
  return parts.map((p, i) => (i === 0 ? p : p.charAt(0).toLowerCase() + p.slice(1))).join(", then ");
}
