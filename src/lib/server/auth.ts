import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import {
  createSession,
  createUserWithCredential,
  deleteSession,
  findCredentialByEmail,
  findSession,
  findUserByEmail,
  findUserById,
} from "@/lib/server/db";
import { clearAttempts, isRateLimited, recordFailedAttempt } from "@/lib/server/rate-limit";
import type { UserAccount } from "@/types/auth";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const SESSION_COOKIE = "line_select_session";

/**
 * Node's built-in scrypt KDF (a standard, well-reviewed algorithm) — not a
 * hand-rolled hash. Each password gets its own random salt so two pilots
 * with the same password don't produce the same stored hash.
 */
async function hashPassword(password: string, salt: string): Promise<string> {
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return derived.toString("hex");
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface AuthResult {
  ok: boolean;
  error?: string;
  user?: UserAccount;
  sessionToken?: string;
}

export async function signUp(
  email: string,
  password: string,
  displayName: string
): Promise<AuthResult> {
  const normalized = normalizeEmail(email);
  if (!/^\S+@\S+\.\S+$/.test(normalized)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }
  if (!displayName.trim()) {
    return { ok: false, error: "Enter a name to display." };
  }
  if (await findUserByEmail(normalized)) {
    return { ok: false, error: "An account with that email already exists." };
  }

  const user: UserAccount = {
    id: randomUUID(),
    email: normalized,
    displayName: displayName.trim(),
    createdAt: new Date().toISOString(),
  };
  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(password, salt);

  await createUserWithCredential(user, { userId: user.id, email: normalized, passwordHash, salt });

  const sessionToken = await startSession(user.id);
  return { ok: true, user, sessionToken };
}

const LOGIN_RATE_LIMIT_SCOPE = "login";

export async function login(email: string, password: string): Promise<AuthResult> {
  const normalized = normalizeEmail(email);

  // Rate-limited per normalized email rather than per IP — the thing being
  // protected is the *account*, and this also means a shared or rotating IP
  // (common on mobile) can't accidentally lock someone else out.
  if (await isRateLimited(LOGIN_RATE_LIMIT_SCOPE, normalized)) {
    return { ok: false, error: "Too many failed attempts. Try again in a few minutes." };
  }

  const credential = await findCredentialByEmail(normalized);
  if (!credential) {
    await recordFailedAttempt(LOGIN_RATE_LIMIT_SCOPE, normalized);
    return { ok: false, error: "No account found with that email." };
  }

  const attemptHash = await hashPassword(password, credential.salt);
  if (!timingSafeStringEqual(attemptHash, credential.passwordHash)) {
    await recordFailedAttempt(LOGIN_RATE_LIMIT_SCOPE, normalized);
    return { ok: false, error: "Incorrect password." };
  }

  const user = await findUserById(credential.userId);
  if (!user) {
    return { ok: false, error: "Account data is missing. Try creating a new account." };
  }

  await clearAttempts(LOGIN_RATE_LIMIT_SCOPE, normalized);
  const sessionToken = await startSession(user.id);
  return { ok: true, user, sessionToken };
}

async function startSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await createSession({
    token,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  });
  return token;
}

export async function endSession(token: string): Promise<void> {
  await deleteSession(token);
}

export async function getUserForSessionToken(token: string | undefined): Promise<UserAccount | null> {
  if (!token) return null;
  const session = await findSession(token);
  if (!session) return null;
  return findUserById(session.userId);
}

export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

/**
 * Shared so login/signup can't drift out of sync on this. `secure` is tied
 * to NODE_ENV rather than hardcoded true: Vercel sets it to "production" for
 * every real deployment (including previews), while `next dev` runs
 * "development" over plain http, where a `secure` cookie would silently
 * never be sent at all.
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === "production",
  };
}

/** Convenience for other API routes that need to know who's making the request. */
export async function getCurrentServerUser(): Promise<UserAccount | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return getUserForSessionToken(token);
}
