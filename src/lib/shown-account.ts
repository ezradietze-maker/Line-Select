/**
 * Which account this tab's screen belongs to, said with every call it makes to the app's own server. Signing in as
 * someone else in another tab (or signing out there) changes the session cookie for the whole browser, but not what
 * this tab has on screen: its next star, tier move or profile save went up with the new account's cookie and landed in
 * that account, its pack over theirs. Told which account a call is for, the server refuses one the cookie doesn't
 * match (`getCurrentServerUser`, 401), and the app asks who's signed in now and shows that (`refreshUser`, app-state).
 */
export const ACCOUNT_HEADER = "x-line-select-account";
/** What a guest's tab says: a guest's call isn't taken for an account that signed in since in another tab. */
export const GUEST_ACCOUNT = "guest";

/** The account on screen, null for a guest; undefined until the app first knows, when calls say nothing, as before. */
let shown: string | null | undefined;

/** Set by the app the moment the account on screen changes, before any call for the new one goes out. */
export function setShownAccount(userId: string | null): void {
  shown = userId;
}
export const shownAccount = (): string | null | undefined => shown;

const refusedListeners = new Set<() => void>();

/** Calls `listener` when the server turns a call away as not signed in: the account it was for may not be the one now. */
export function onAccountRefused(listener: () => void): () => void {
  refusedListeners.add(listener);
  return () => void refusedListeners.delete(listener);
}

type ApiInit = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };

/**
 * `fetch` for this app's own API, saying which account the call is for: the one on screen when it's made, unless the
 * caller names the account its work belongs to (a save that waited its turn, or a timer, goes up after the screen may
 * have moved on).
 */
export async function apiFetch(url: string, init?: ApiInit, forAccount: string | null | undefined = shown): Promise<Response> {
  if (forAccount === undefined) return init === undefined ? fetch(url) : fetch(url, init);
  const res = await fetch(url, { ...init, headers: { ...init?.headers, [ACCOUNT_HEADER]: forAccount ?? GUEST_ACCOUNT } });
  if (res.status === 401) for (const listener of [...refusedListeners]) listener();
  return res;
}

/**
 * Calls `onChange` when this device's note of who's signed in (`signedInHere`: an id, null for nobody, undefined when
 * it can't tell) stops matching `userId`, the account this tab shows: straight away for a tab open alongside the one
 * that signed in or out, and when a tab the browser put to sleep in the background is looked at again.
 */
export function onSignedInElsewhere(userId: string | null, signedInHere: () => string | null | undefined, onChange: () => void): () => void {
  const check = () => {
    const now = signedInHere();
    if (now !== undefined && now !== userId) onChange();
  };
  const onVisible = () => document.visibilityState === "visible" && check();
  window.addEventListener("storage", check);
  window.addEventListener("pageshow", check);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("storage", check);
    window.removeEventListener("pageshow", check);
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
