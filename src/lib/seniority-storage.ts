import type { SeniorityInput } from "@/types/strategy";

function seniorityKey(userId: string | null): string {
  return userId ? `line-select:seniority:${userId}:v1` : "line-select:seniority:guest:v1";
}

export function loadSeniority(userId: string | null): SeniorityInput | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(seniorityKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SeniorityInput>;
    if (typeof parsed.rank !== "number" || typeof parsed.totalPilots !== "number") return null;
    // Where it came from, when it was kept: the number it was found by, and the pack it was saved on.
    const from = {
      ...(typeof parsed.seniorityNumber === "number" && parsed.seniorityNumber > 0 ? { seniorityNumber: parsed.seniorityNumber } : {}),
      ...(typeof parsed.packId === "string" ? { packId: parsed.packId } : {}),
    };
    if (parsed.source === "band" || parsed.source === "between" || parsed.source === "typed") return { rank: parsed.rank, totalPilots: parsed.totalPilots, source: parsed.source, ...from };
    // A band picked before bands were marked: exactly one of their midpoints on the 100-pilot scale.
    if (parsed.totalPilots === 100 && [5, 20, 50, 83].includes(parsed.rank)) return { rank: parsed.rank, totalPilots: 100, source: "band" };
    return { rank: parsed.rank, totalPilots: parsed.totalPilots, ...from };
  } catch {
    return null;
  }
}

export function saveSeniority(userId: string | null, input: SeniorityInput): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(seniorityKey(userId), JSON.stringify(input));
  } catch {
    // ignore — quota exceeded or unavailable
  }
}
