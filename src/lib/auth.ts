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
    return { ok: true, user: data.user, recoveryCode: data.recoveryCode };
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
    const res = await fetch("/api/auth/recovery-code", {
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

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    // ignore — worst case the session cookie just expires on its own later.
  }
}

export async function getCurrentUser(): Promise<UserAccount | null> {
  try {
    const res = await fetch("/api/auth/session", { credentials: "same-origin" });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.user as UserAccount | null) ?? null;
  } catch {
    return null;
  }
}
