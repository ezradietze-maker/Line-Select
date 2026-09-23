import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import {
  createSession,
  createUserWithCredential,
  deleteSession,
  deleteSessionsForUser,
  findCredentialByEmail,
  findCredentialByUserId,
  findSession,
  findUserByEmail,
  findUserById,
  updateCredential,
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
  /** Plain-text recovery code — only ever present in the single response that just created or rotated it. */
  recoveryCode?: string;
}

/** No 0/O/1/I/L — a code someone has to read off a screen and type in later shouldn't hinge on telling look-alikes apart. */
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RECOVERY_GROUPS = 5;
const RECOVERY_GROUP_LENGTH = 4;

/** 20 characters from a 31-symbol alphabet is ~99 bits — far beyond guessing, and short enough to write down. */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < RECOVERY_GROUPS; g++) {
    let group = "";
    for (let i = 0; i < RECOVERY_GROUP_LENGTH; i++) {
      // rejection sampling: 248 = 31 * 8, so bytes >= 248 are re-rolled to keep every symbol equally likely
      let byte = randomBytes(1)[0];
      while (byte >= 248) byte = randomBytes(1)[0];
      group += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    }
    groups.push(group);
  }
  return groups.join("-");
}

/** Case, dashes and spaces are all ignored on entry — however someone copies it down, it should still match. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function storeNewRecoveryCode(userId: string): Promise<string> {
  const code = generateRecoveryCode();
  const salt = randomBytes(16).toString("hex");
  await updateCredential(userId, { recoveryHash: await hashPassword(normalizeRecoveryCode(code), salt), recoverySalt: salt });
  return code;
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
    plan: "free",
  };
  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(password, salt);

  await createUserWithCredential(user, { userId: user.id, email: normalized, passwordHash, salt });
  const recoveryCode = await storeNewRecoveryCode(user.id);

  const sessionToken = await startSession(user.id);
  return { ok: true, user, sessionToken, recoveryCode };
}

const RESET_RATE_LIMIT_SCOPE = "password-reset";
const RESET_FAILURE_MESSAGE = "That email and recovery code don't match.";

/**
 * Forgot-password path with no email service: the recovery code shown once
 * at signup proves the pilot is the account's owner. Deliberately gives the
 * same error for "no such account", "no recovery code on file" and "wrong
 * code" so it can't be used to discover which emails have accounts, is
 * rate-limited per email like login, signs out every existing session on
 * success, and rotates the code (the used one is spent).
 */
export async function resetPasswordWithRecoveryCode(email: string, recoveryCode: string, newPassword: string): Promise<AuthResult> {
  const normalized = normalizeEmail(email);
  if (await isRateLimited(RESET_RATE_LIMIT_SCOPE, normalized)) {
    return { ok: false, error: "Too many failed attempts. Try again in a few minutes." };
  }
  if (newPassword.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }

  const credential = await findCredentialByEmail(normalized);
  const matches =
    !!credential?.recoveryHash &&
    !!credential.recoverySalt &&
    timingSafeStringEqual(await hashPassword(normalizeRecoveryCode(recoveryCode), credential.recoverySalt), credential.recoveryHash);
  if (!credential || !matches) {
    await recordFailedAttempt(RESET_RATE_LIMIT_SCOPE, normalized);
    return { ok: false, error: RESET_FAILURE_MESSAGE };
  }

  const user = await findUserById(credential.userId);
  if (!user) return { ok: false, error: RESET_FAILURE_MESSAGE };

  const salt = randomBytes(16).toString("hex");
  await updateCredential(credential.userId, { passwordHash: await hashPassword(newPassword, salt), salt });
  await deleteSessionsForUser(credential.userId);
  await clearAttempts(RESET_RATE_LIMIT_SCOPE, normalized);
  await clearAttempts(LOGIN_RATE_LIMIT_SCOPE, normalized);
  const newRecoveryCode = await storeNewRecoveryCode(credential.userId);
  const sessionToken = await startSession(credential.userId);
  return { ok: true, user, sessionToken, recoveryCode: newRecoveryCode };
}

/** For a signed-in pilot with no recovery code yet (an account from before they existed) or who wants a fresh one. Re-checks the password first, so a borrowed unlocked laptop can't mint one. */
export async function createRecoveryCodeForUser(userId: string, password: string): Promise<AuthResult> {
  const credential = await findCredentialByUserId(userId);
  if (!credential) return { ok: false, error: "Account data is missing." };
  if (await isRateLimited(LOGIN_RATE_LIMIT_SCOPE, credential.email)) {
    return { ok: false, error: "Too many failed attempts. Try again in a few minutes." };
  }
  const attempt = await hashPassword(password, credential.salt);
  if (!timingSafeStringEqual(attempt, credential.passwordHash)) {
    await recordFailedAttempt(LOGIN_RATE_LIMIT_SCOPE, credential.email);
    return { ok: false, error: "Incorrect password." };
  }
  await clearAttempts(LOGIN_RATE_LIMIT_SCOPE, credential.email);
  return { ok: true, recoveryCode: await storeNewRecoveryCode(userId) };
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
