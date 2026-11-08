import type { TradeHolding, TradeSettings, TradeSuggestionView } from "@/types/trade";

/** The browser's side of "what you hold". */

export type HoldingState = { holding: TradeHolding | null; settings: TradeSettings };

/** What this pilot holds in this pack, and their settings; null when it can't be asked. */
export async function fetchTradeHolding(packId: string): Promise<HoldingState | null> {
  try {
    const res = await fetch(`/api/trades/holding?pack=${encodeURIComponent(packId)}`, { credentials: "same-origin", cache: "no-store" });
    return res.ok ? ((await res.json()) as HoldingState) : null;
  } catch {
    return null;
  }
}

/** Saves what the pilot holds; the saved copy, or null when it didn't save. */
export async function saveTradeHolding(holding: Omit<TradeHolding, "confirmedAt">): Promise<TradeHolding | null> {
  try {
    const res = await fetch("/api/trades/holding", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(holding) });
    return res.ok ? ((await res.json()) as { holding: TradeHolding }).holding : null;
  } catch {
    return null;
  }
}

export async function clearTradeHolding(packId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/trades/holding?pack=${encodeURIComponent(packId)}`, { method: "DELETE", credentials: "same-origin" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function saveTradeSettings(settings: TradeSettings): Promise<boolean> {
  try {
    const res = await fetch("/api/trades/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(settings) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Suggested trades on one pack, and whether this pilot can ask for more. */
export interface SuggestionsState {
  suggestions: TradeSuggestionView[];
  waiting: number;
  confirmedPilots: number;
  ready: { holding: boolean; suggestMe: boolean; interview: boolean };
}

export async function fetchSuggestions(packId: string): Promise<SuggestionsState | null> {
  try {
    const res = await fetch(`/api/trades/matches?pack=${encodeURIComponent(packId)}`, { credentials: "same-origin", cache: "no-store" });
    return res.ok ? ((await res.json()) as SuggestionsState) : null;
  } catch {
    return null;
  }
}

/** How many suggested trades are waiting on this pilot, for the Inbox badge; null when it can't be asked. */
export async function fetchWaitingSuggestions(packId: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/trades/matches?waiting&pack=${encodeURIComponent(packId)}`, { credentials: "same-origin", cache: "no-store" });
    return res.ok ? ((await res.json()) as { waiting: number }).waiting : null;
  } catch {
    return null;
  }
}

export type FindOutcome = { status: "ran"; found: number; pilots: number } | { status: "busy" } | { status: "not-ready" };

export async function findTradesNow(packId: string): Promise<FindOutcome | null> {
  try {
    const res = await fetch("/api/trades/matches", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ pack: packId }) });
    return res.ok ? ((await res.json()) as FindOutcome) : null;
  } catch {
    return null;
  }
}

async function act(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
    if (res.ok) return { ok: true };
    return { ok: false, error: ((await res.json().catch(() => ({}))) as { error?: string }).error };
  } catch {
    return { ok: false };
  }
}

export const answerSuggestion = (id: string, answer: "accepted" | "declined") => act(`/api/trades/matches/${id}/answer`, { answer });
export const markTradeStepDone = (id: string, step: number) => act(`/api/trades/matches/${id}/step`, { step });
