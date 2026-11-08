import type { TradeHolding, TradeSettings } from "@/types/trade";

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
