import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import {
  createSession,
  consumeResetToken,
  createUserWithCredential,
  deleteSession,
  deleteSessionsForUser,
  findCredentialByEmail,
  findCredentialByUserId,
  findSession,
  findUserByEmail,
  findUserById,
  saveResetToken,
  updateCredential,
} from "@/lib/server/db";
import { getEmailConfig, sendEmail } from "@/lib/server/email";
import { getJson, setJson } from "@/lib/server/kv";
import { attemptsUsed, clearAttempts, countAttempt, MAX_ATTEMPTS, takeAttempt } from "@/lib/server/rate-limit";
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

/** For every new password (sign-up and both resets). Passwords set before this rule keep working. */
export const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_TOO_SHORT = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;

export async function signUp(
  email: string,
  password: string,
  displayName: string
): Promise<AuthResult> {
  const normalized = normalizeEmail(email);
  if (!/^\S+@\S+\.\S+$/.test(normalized)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: PASSWORD_TOO_SHORT };
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

  const created = await createUserWithCredential(user, { userId: user.id, email: normalized, passwordHash, salt });
  if (!created.ok) {
    // The pre-check above already caught the common case; this closes the
    // race where two signups for the same email landed at once — the
    // database's own unique constraint is the real guard.
    return { ok: false, error: "An account with that email already exists." };
  }
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
export async function resetPasswordWithRecoveryCode(email: string, recoveryCode: string, newPassword: string, from?: string, device?: string | null): Promise<AuthResult> {
  const normalized = normalizeEmail(email);
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: PASSWORD_TOO_SHORT };
  }
  if (!(await takeAccountAttempt(RESET_RATE_LIMIT_SCOPE, normalized, from, device))) {
    return { ok: false, error: "Too many failed attempts. Try again in a few minutes." };
  }

  const credential = await findCredentialByEmail(normalized);
  // Hashed whether or not there's a code to check it against, as sign-in does: answering faster for an email with no
  // account (or no code) would say which emails have one.
  const attempt = await hashPassword(normalizeRecoveryCode(recoveryCode), credential?.recoverySalt ?? NO_ACCOUNT_SALT);
  const matches = !!credential?.recoveryHash && !!credential.recoverySalt && timingSafeStringEqual(attempt, credential.recoveryHash);
  if (!credential || !matches) {
    return { ok: false, error: RESET_FAILURE_MESSAGE };
  }

  const user = await findUserById(credential.userId);
  if (!user) return { ok: false, error: RESET_FAILURE_MESSAGE };

  const salt = randomBytes(16).toString("hex");
  await updateCredential(credential.userId, { passwordHash: await hashPassword(newPassword, salt), salt });
  await deleteSessionsForUser(credential.userId);
  await clearAttemptsAfterReset(normalized, from);
  await rememberDevice(normalized, device);
  const newRecoveryCode = await storeNewRecoveryCode(credential.userId);
  const sessionToken = await startSession(credential.userId);
  return { ok: true, user, sessionToken, recoveryCode: newRecoveryCode };
}

const RESET_LINK_TTL_MS = 60 * 60 * 1000; // 1 hour
const RESET_EMAIL_SCOPE = "password-reset-email";

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Emails a one-hour, single-use reset link. Says nothing about whether the
 * address has an account — the caller gets the same answer either way, so
 * this can't be used to discover who's registered — and is limited to a few
 * requests per address in a short window so it can't be used to spam an inbox.
 * Returns false only when email isn't configured on this deployment.
 */
export async function requestPasswordResetEmail(email: string, from?: string, device?: string | null): Promise<boolean> {
  const config = getEmailConfig();
  if (!config) return false;
  const normalized = normalizeEmail(email);
  if (!(await takeAccountAttempt(RESET_EMAIL_SCOPE, normalized, from, device))) return true;

  const credential = await findCredentialByEmail(normalized);
  if (!credential) return true;

  const token = randomBytes(32).toString("hex");
  await saveResetToken({
    tokenHash: hashResetToken(token),
    userId: credential.userId,
    expiresAt: new Date(Date.now() + RESET_LINK_TTL_MS).toISOString(),
  });
  await sendEmail({
    to: normalized,
    subject: "Reset your Line Select password",
    text:
      `Someone asked to reset the password for your Line Select account.\n\n` +
      `Open this link within the hour to choose a new one:\n${config.appUrl}/reset-password?token=${token}\n\n` +
      `If that wasn't you, ignore this email — your password hasn't changed.`,
  });
  return true;
}

/**
 * Completes an emailed reset: the token is spent, every old session is signed out, and the pilot is signed straight in.
 * Every count against the account is cleared too, the account-wide ones included: the password someone was guessing at
 * is gone, and a pilot who had to reset because someone kept them out shouldn't find the door still shut.
 */
export async function resetPasswordWithEmailToken(token: string, newPassword: string, from?: string, device?: string | null): Promise<AuthResult> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false, error: PASSWORD_TOO_SHORT };
  const userId = await consumeResetToken(hashResetToken(token));
  const user = userId ? await findUserById(userId) : null;
  if (!userId || !user) return { ok: false, error: "This reset link is invalid or has expired. Request a new one." };

  const salt = randomBytes(16).toString("hex");
  await updateCredential(userId, { passwordHash: await hashPassword(newPassword, salt), salt });
  await deleteSessionsForUser(userId);
  const normalized = normalizeEmail(user.email);
  await clearAttemptsAfterReset(normalized, from);
  await rememberDevice(normalized, device);
  return { ok: true, user, sessionToken: await startSession(userId) };
}

/** For a signed-in pilot with no recovery code yet (an account from before they existed) or who wants a fresh one. Re-checks the password first, so a borrowed unlocked laptop can't mint one. */
export async function createRecoveryCodeForUser(userId: string, password: string): Promise<AuthResult> {
  const credential = await findCredentialByUserId(userId);
  if (!credential) return { ok: false, error: "Account data is missing." };
  if (!(await takeAttempt(LOGIN_RATE_LIMIT_SCOPE, credential.email))) {
    return { ok: false, error: "Too many failed attempts. Try again in a few minutes." };
  }
  const attempt = await hashPassword(password, credential.salt);
  if (!timingSafeStringEqual(attempt, credential.passwordHash)) {
    return { ok: false, error: "Incorrect password." };
  }
  await clearAttempts(LOGIN_RATE_LIMIT_SCOPE, credential.email);
  return { ok: true, recoveryCode: await storeNewRecoveryCode(userId) };
}

const LOGIN_RATE_LIMIT_SCOPE = "login";
/** The same answer for "no such account" and "wrong password", so the sign-in form can't be used to find out who has an account. */
export const LOGIN_FAILED = "Email or password is incorrect.";
/** A dummy salt, so a sign-in for an email with no account takes as long as one with a wrong password. */
const NO_ACCOUNT_SALT = "0".repeat(32);

export async function login(email: string, password: string, from?: string, device?: string | null): Promise<AuthResult> {
  const normalized = normalizeEmail(email);

  // Rate-limited per account and address, with a ceiling on how many addresses may try one account (see
  // `takeAccountAttempt`); the login route adds a limit per address on top, against one machine trying many accounts.
  if (!(await takeAccountAttempt(LOGIN_RATE_LIMIT_SCOPE, normalized, from, device))) {
    return { ok: false, error: "Too many failed attempts. Try again in 15 minutes, or reset your password with your recovery code." };
  }

  const credential = await findCredentialByEmail(normalized);
  const attemptHash = await hashPassword(password, credential?.salt ?? NO_ACCOUNT_SALT);
  if (!credential || !timingSafeStringEqual(attemptHash, credential.passwordHash)) {
    return { ok: false, error: LOGIN_FAILED };
  }

  const user = await findUserById(credential.userId);
  if (!user) {
    return { ok: false, error: "Account data is missing. Try creating a new account." };
  }

  // This address's count only: the account-wide one is left to run out, or a guesser working from many addresses
  // would get a fresh set of them each time the pilot signed in.
  await clearAttempts(LOGIN_RATE_LIMIT_SCOPE, normalized);
  if (from) await clearAttempts(LOGIN_RATE_LIMIT_SCOPE, `${normalized}|${from}`);
  await rememberDevice(normalized, device);
  const sessionToken = await startSession(user.id);
  return { ok: true, user, sessionToken };
}

/**
 * Addresses that may try one account in the window, each with its own few attempts: enough for a pilot moving
 * between home, a hotel and a phone, and few enough that guessing spread across many addresses still stops.
 */
const ACCOUNT_ADDRESS_CEILING = 12;

/** A new name for the account-wide count: under the old one it counted tries, and a leftover count of tries isn't addresses. */
const accountWideScope = (scope: string) => `${scope}:addresses`;

/**
 * One attempt at an account. Counted per account and the address it came from first: once that address has used its
 * few tries it's turned away before anything else is counted, so one address hammering away can't use up the account's
 * allowance for everyone. Then the account as a whole, by how many addresses have tried it in the window rather than
 * how many tries: an address adds one on its first try, so it takes many addresses, not many tries, to shut the
 * account to everyone. A device this account has signed in on before isn't held to that account-wide ceiling (its
 * address's own limit still holds), so even then the pilot's own phone or laptop gets in. Without an address (a caller
 * that doesn't know one), per account as before.
 */
async function takeAccountAttempt(scope: string, email: string, from?: string, device?: string | null): Promise<boolean> {
  if (!from) return takeAttempt(scope, email);
  const mine = await countAttempt(scope, `${email}|${from}`);
  if (mine > MAX_ATTEMPTS) return false;
  if (await isKnownDevice(email, device)) return true;
  const addresses = mine === 1 ? await countAttempt(accountWideScope(scope), email) : await attemptsUsed(accountWideScope(scope), email);
  return addresses <= ACCOUNT_ADDRESS_CEILING;
}

/**
 * After a reset, by either route: every count for the account, sign-in and both resets, the account-wide ones
 * included. Other addresses' own counts are left; they keep out only whoever was using those addresses.
 */
async function clearAttemptsAfterReset(email: string, from?: string): Promise<void> {
  await Promise.all(
    [LOGIN_RATE_LIMIT_SCOPE, RESET_RATE_LIMIT_SCOPE, RESET_EMAIL_SCOPE].flatMap((scope) => [
      clearAttempts(scope, email),
      clearAttempts(accountWideScope(scope), email),
      ...(from ? [clearAttempts(scope, `${email}|${from}`)] : []),
    ])
  );
}

/** How long a device stays known to an account after it last signed in: about as long as a pilot goes between bids and then some. */
const KNOWN_DEVICE_SECONDS = 180 * 24 * 60 * 60;

/**
 * The device id is the signed one from the device cookie (`deviceIdFrom`): random, never shown, so no one else can
 * claim to be the pilot's laptop. Keyed by a hash of the email, so the stored keys don't spell out the address.
 */
function knownDeviceKey(email: string, device: string): string {
  return `line-select:known-device:${createHash("sha256").update(email).digest("hex").slice(0, 32)}:${device}`;
}

async function rememberDevice(email: string, device?: string | null): Promise<void> {
  if (!device) return;
  try {
    await setJson(knownDeviceKey(email, device), 1, { ttlSeconds: KNOWN_DEVICE_SECONDS });
  } catch {
    // Only means this device is held to the account-wide ceiling like any other next time.
  }
}

async function isKnownDevice(email: string, device?: string | null): Promise<boolean> {
  if (!device) return false;
  try {
    return (await getJson<number>(knownDeviceKey(email, device))) === 1;
  } catch {
    return false;
  }
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
