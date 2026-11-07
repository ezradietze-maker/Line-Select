/**
 * The server copy of a signed-in pilot's unfinished interview (see `/api/interview-draft`), so it follows them to
 * another device. Only ever called for a signed-in pilot — a guest's draft stays in this browser alone. Nothing here
 * throws: a draft that can't reach the server is still saved on this device, as before.
 */

/** The draft saved on the server for this pack, or null when there's none or it couldn't be reached. */
export async function fetchServerDraft<T>(packId: string): Promise<T | null> {
  try {
    const res = await fetch(`/api/interview-draft?pack=${encodeURIComponent(packId)}`, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { draft?: T | null };
    return data.draft ?? null;
  } catch {
    return null;
  }
}

/** Waits this long after an answer before saving: the save that follows several quick changes carries them all. */
const SAVE_AFTER_MS = 1500;
let pending: { packId: string; draft: unknown; timer: ReturnType<typeof setTimeout> } | null = null;

/**
 * Browsers refuse a `keepalive` request past 64 KiB — counted in bytes, and across every keepalive request still in
 * flight at once — so a draft only goes that way well under it. Curly quotes and dashes are three bytes each.
 */
const KEEPALIVE_MAX_BYTES = 48 * 1024;

async function send(packId: string, draft: unknown): Promise<void> {
  const body = JSON.stringify({ pack: packId, draft });
  const put = (keepalive: boolean) =>
    fetch("/api/interview-draft", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin", keepalive, body });
  // Sent even if the page is closing, so the last answer isn't lost to a tab shut right after it — when it's small
  // enough to be. Refused that way (too big after all, with another save still going), it's sent the ordinary way.
  const keepalive = new TextEncoder().encode(body).length <= KEEPALIVE_MAX_BYTES;
  try {
    await put(keepalive);
  } catch {
    if (keepalive) await put(false).catch(() => {});
  }
}

/** Sends a save that's still waiting, now — the page is closing or going into the background, where its timer may never fire. */
function flush(): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  const { packId, draft } = pending;
  pending = null;
  void send(packId, draft);
}

let flushOnLeave = false;

/** Saves the draft to the server shortly — the latest one only, when several come in a row. */
export function saveServerDraft(packId: string, draft: unknown): void {
  if (pending) clearTimeout(pending.timer);
  const timer = setTimeout(() => {
    pending = null;
    void send(packId, draft);
  }, SAVE_AFTER_MS);
  pending = { packId, draft, timer };
  // An answer given just before the tab is swiped away (or the phone locks) would otherwise wait on a timer that
  // never fires — iOS freezes it in the background, and a closed tab never runs it.
  if (!flushOnLeave && typeof window !== "undefined") {
    flushOnLeave = true;
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }
}

/** Clears the server's draft for this pack (the interview finished, or the pilot chose to start fresh). */
export async function clearServerDraft(packId: string): Promise<void> {
  if (pending?.packId === packId) {
    clearTimeout(pending.timer);
    pending = null;
  }
  try {
    await fetch(`/api/interview-draft?pack=${encodeURIComponent(packId)}`, { method: "DELETE", credentials: "same-origin", keepalive: true });
  } catch {}
}
