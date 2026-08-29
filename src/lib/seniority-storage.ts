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
    return { rank: parsed.rank, totalPilots: parsed.totalPilots };
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
