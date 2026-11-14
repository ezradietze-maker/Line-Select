import { ACCOUNT_HEADER, apiFetch } from "@/lib/shown-account";
import type { UserAccount } from "@/types/auth";

/**
 * Thin client for the server-backed account API (see `lib/server/auth.ts`).
 * Accounts are real now — sessions live in a server-side cookie, not
 * localStorage — because the Trade Board needs a trade offer posted by one
 * pilot to be visible to a different pilot on a different device.
 */

export interface AuthResult {
  ok: boolean;
  error?: string;
  user?: UserAccount;
  /** Present only in the response that just created or rotated it — shown to the pilot once, never stored client-side. */
  recoveryCode?: string;
  /**
   * Signing up with email set up: nobody is signed in yet, and the pilot finishes from the link in their email. The
   * same whether or not the address already had an account, which is the point.
   */
  checkEmail?: boolean;
}

async function postJson(url: string, body: unknown): Promise<AuthResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error ?? "Something went wrong. Try again." };
    }
    return { ok: true, user: data.user, recoveryCode: data.recoveryCode, checkEmail: data.checkEmail === true };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

export async function signUp(
  email: string,
  password: string,
  displayName: string
): Promise<AuthResult> {
  return postJson("/api/auth/signup", { email, password, displayName });
}

export async function login(email: string, password: string): Promise<AuthResult> {
  return postJson("/api/auth/login", { email, password });
}

export async function resetPassword(email: string, recoveryCode: string, newPassword: string): Promise<AuthResult> {
  return postJson("/api/auth/reset", { email, recoveryCode, newPassword });
}

/** Whether this deployment can send reset emails — the sign-in screen only offers the option when it will actually work. */
export async function fetchEmailResetEnabled(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/forgot", { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.emailEnabled === true;
  } catch {
    return false;
  }
}

/** Asks for a reset link. Succeeds identically whether or not the address has an account. */
export async function requestResetEmail(email: string): Promise<{ ok: boolean; emailEnabled?: boolean; error?: string }> {
  try {
    const res = await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? "Something went wrong. Try again." };
    return { ok: true, emailEnabled: data.emailEnabled };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

/** Finishes an emailed reset — signs the pilot in on success. */
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<AuthResult> {
  return postJson("/api/auth/reset-email", { token, newPassword });
}

/** For a signed-in pilot: mints a fresh recovery code (replacing any old one), after re-checking their password. */
export async function createRecoveryCode(password: string): Promise<{ ok: boolean; error?: string; recoveryCode?: string }> {
  try {
    const res = await apiFetch("/api/auth/recovery-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? "Something went wrong. Try again." };
    return { ok: true, recoveryCode: data.recoveryCode };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

/** How opening a confirm link went (see `/api/auth/confirm-email`). */
export type ConfirmEmailOutcome =
  | { status: "confirmed"; signedIn: "now" | "already"; user: UserAccount; recoveryCode?: string }
  | { status: "confirmed"; signedIn: "other-account" }
  /** Opened by anyone but its own signed-in pilot: the account's password, or "This wasn't me", first. */
  | { status: "needs-password"; email: string }
  | { status: "used"; yours: boolean }
  | { status: "wrong-password" | "limited" | "not-me" | "expired" | "invalid" | "unreachable" };

const CONFIRM_STATUSES = new Set(["confirmed", "needs-password", "wrong-password", "limited", "not-me", "used", "expired", "invalid"]);

/** Opens a confirm link; away from the device that signed up, with the account's `password` or `notMe` ("This wasn't me"). */
export async function confirmEmailLink(token: string, choice: { password?: string; notMe?: boolean } = {}): Promise<ConfirmEmailOutcome> {
  try {
    const res = await fetch("/api/auth/confirm-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ token, ...choice }),
    });
    const data = (await res.json().catch(() => ({}))) as { status?: string };
    if (data.status && CONFIRM_STATUSES.has(data.status)) return data as ConfirmEmailOutcome;
    return { status: "unreachable" };
  } catch {
    return { status: "unreachable" };
  }
}

/** "Send it again": a fresh confirm link to the signed-in pilot's address. */
export async function resendConfirmEmail(): Promise<{ ok: true; email: string } | { ok: true; confirmed: true } | { ok: false; error: string }> {
  try {
    const res = await apiFetch("/api/auth/confirm-email/resend", { method: "POST", credentials: "same-origin" });
    const data = (await res.json().catch(() => ({}))) as { sent?: boolean; email?: string; confirmed?: boolean; error?: string };
    if (data.sent && data.email) return { ok: true, email: data.email };
    if (data.confirmed) return { ok: true, confirmed: true };
    return { ok: false, error: data.error ?? "That didn't send. Try again in a few minutes." };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

/** "Send the link again" by address, from the log-in screen: the server's one answer for every address, or an error. */
export async function resendConfirmEmailTo(email: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/auth/confirm-email/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email }),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    if (res.ok && data.message) return { ok: true, message: data.message };
    return { ok: false, error: data.error ?? (res.status === 429 ? "Too many requests. Try again shortly." : "That didn't send. Try again in a few minutes.") };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

/**
 * Whether the server ended the session. When it didn't, the cookie still signs this device in — so the app must not
 * act signed out. "other": someone else signed in in another tab since, and their session was left alone.
 */
export async function logout(forAccount?: string): Promise<boolean | "other"> {
  try {
    const res = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: forAccount ? { [ACCOUNT_HEADER]: forAccount } : undefined });
    if (res.status === 409 && (await res.json().catch(() => null))?.otherAccount === true) return "other";
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The signed-in account, and whether the server could be asked at all — no signal on a layover is not the same
 * answer as "signed out", and the app keeps a pilot's own data on screen for the first.
 */
export async function checkSession(): Promise<{ user: UserAccount | null; reachable: boolean }> {
  try {
    const res = await fetch("/api/auth/session", { credentials: "same-origin" });
    if (!res.ok) return { user: null, reachable: res.status < 500 };
    const data = await res.json();
    return { user: (data.user as UserAccount | null) ?? null, reachable: true };
  } catch {
    return { user: null, reachable: false };
  }
}
