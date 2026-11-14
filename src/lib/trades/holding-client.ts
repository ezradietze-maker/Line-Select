import { apiFetch } from "@/lib/shown-account";
import type { TradeDeclineReason, TradeHolding, TradeSettings, TradeSuggestionView } from "@/types/trade";

/** The browser's side of "what you hold". */

export type HoldingState = { holding: TradeHolding | null; settings: TradeSettings };

/** What this pilot holds in this pack, and their settings; null when it can't be asked. */
export async function fetchTradeHolding(packId: string): Promise<HoldingState | null> {
  try {
    const res = await apiFetch(`/api/trades/holding?pack=${encodeURIComponent(packId)}`, { credentials: "same-origin", cache: "no-store" });
    return res.ok ? ((await res.json()) as HoldingState) : null;
  } catch {
    return null;
  }
}

/** Refused because the pilot's email isn't confirmed, with the server's words for it. */
export interface ConfirmEmailFirst {
  confirmEmail: string;
}

async function confirmEmailFirst(res: Response): Promise<ConfirmEmailFirst | null> {
  if (res.status !== 403) return null;
  const data = (await res.json().catch(() => null)) as { confirmEmail?: unknown; error?: unknown } | null;
  return data?.confirmEmail === true && typeof data.error === "string" ? { confirmEmail: data.error } : null;
}

/** Saves what the pilot holds; the saved copy, the refusal of an unconfirmed account, or null when it didn't save. */
export async function saveTradeHolding(holding: Omit<TradeHolding, "confirmedAt">): Promise<TradeHolding | ConfirmEmailFirst | null> {
  try {
    const res = await apiFetch("/api/trades/holding", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(holding) });
    if (!res.ok) return confirmEmailFirst(res);
    return ((await res.json()) as { holding: TradeHolding }).holding;
  } catch {
    return null;
  }
}

export async function clearTradeHolding(packId: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/trades/holding?pack=${encodeURIComponent(packId)}`, { method: "DELETE", credentials: "same-origin" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function saveTradeSettings(settings: TradeSettings): Promise<boolean> {
  try {
    const res = await apiFetch("/api/trades/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(settings) });
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

/** The trades suggested on one pack; "limited" when the server says this pilot has asked too often for now, null on any other failure. */
export async function fetchSuggestions(packId: string): Promise<SuggestionsState | "limited" | null> {
  try {
    const res = await apiFetch(`/api/trades/matches?pack=${encodeURIComponent(packId)}`, { credentials: "same-origin", cache: "no-store" });
    if (res.status === 429) return "limited";
    return res.ok ? ((await res.json()) as SuggestionsState) : null;
  } catch {
    return null;
  }
}

/** How many suggested trades are waiting on this pilot, for the Inbox badge; null when it can't be asked. */
export async function fetchWaitingSuggestions(packId: string): Promise<number | null> {
  try {
    const res = await apiFetch(`/api/trades/matches?waiting&pack=${encodeURIComponent(packId)}`, { credentials: "same-origin", cache: "no-store" });
    return res.ok ? ((await res.json()) as { waiting: number }).waiting : null;
  } catch {
    return null;
  }
}

export type FindOutcome = { status: "ran"; found: number; pilots: number } | { status: "busy" } | { status: "not-ready" } | { status: "closed" } | { status: "pack-differs" };

export async function findTradesNow(packId: string): Promise<FindOutcome | ConfirmEmailFirst | null> {
  try {
    const res = await apiFetch("/api/trades/matches", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ pack: packId }) });
    if (!res.ok) return confirmEmailFirst(res);
    return (await res.json()) as FindOutcome;
  } catch {
    return null;
  }
}

async function act(url: string, body: unknown): Promise<{ ok: boolean; error?: string; confirmEmail?: boolean }> {
  try {
    const res = await apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string; confirmEmail?: unknown };
    return { ok: false, error: data.error, confirmEmail: data.confirmEmail === true };
  } catch {
    return { ok: false };
  }
}

export const answerSuggestion = (id: string, answer: "accepted" | "declined", reason: TradeDeclineReason | null = null) => act(`/api/trades/matches/${id}/answer`, { answer, reason });
export const markTradeStepDone = (id: string, step: number) => act(`/api/trades/matches/${id}/step`, { step });
