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
  markEmailVerified,
  saveResetToken,
  saveVerificationToken,
  updateCredential,
  spendVerificationToken,
  isUnconfirmedSignUp,
  peekVerificationToken,
  voidVerificationToken,
} from "@/lib/server/db";
import { getEmailConfig, sendEmail, type EmailConfig } from "@/lib/server/email";
import { getJson, setJson } from "@/lib/server/kv";
import { revokeFeed } from "@/lib/server/calendar-feeds";
import { siteMailLeft } from "@/lib/server/mail-allowance";
import { addressGroup, attemptsUsed, checkRateLimit, clearAttempts, countAttempt, MAX_ATTEMPTS, takeAttempt } from "@/lib/server/rate-limit";
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

/** What's wrong with a sign-up's own fields, or null. Asked before anything about the address is looked up, so the answer is the same whether or not it has an account. */
export function signUpInputError(email: string, password: string, displayName: string): string | null {
  if (!/^\S+@\S+\.\S+$/.test(normalizeEmail(email))) return "Enter a valid email address.";
  if (password.length < MIN_PASSWORD_LENGTH) return PASSWORD_TOO_SHORT;
  if (!displayName.trim()) return "Enter a name to display.";
  return null;
}

/**
 * Sign-up when email isn't set up on this server: the account is made and signed in at once, as before confirming
 * existed, with its recovery code. It can't be confirmed, so it shares and trades nothing (`verified-pilots.ts`). With
 * no email there's nothing to tell an address's owner, so an address with an account is still refused by name here.
 */
export async function signUp(
  email: string,
  password: string,
  displayName: string
): Promise<AuthResult> {
  const normalized = normalizeEmail(email);
  const inputError = signUpInputError(email, password, displayName);
  if (inputError) return { ok: false, error: inputError };
  if (await findUserByEmail(normalized)) {
    return { ok: false, error: "An account with that email already exists." };
  }

  const user = await createAccount(normalized, password, displayName);
  if (!user) {
    // The pre-check above already caught the common case; this closes the
    // race where two signups for the same email landed at once — the
    // database's own unique constraint is the real guard.
    return { ok: false, error: "An account with that email already exists." };
  }
  const recoveryCode = await storeNewRecoveryCode(user.id);

  const sessionToken = await startSession(user.id);
  return { ok: true, user, sessionToken, recoveryCode };
}

/** A new, unconfirmed account; null when the address already has one (two sign-ups for it at once). */
async function createAccount(normalized: string, password: string, displayName: string): Promise<UserAccount | null> {
  const user: UserAccount = {
    id: randomUUID(),
    email: normalized,
    displayName: displayName.trim(),
    createdAt: new Date().toISOString(),
    plan: "free",
    emailVerified: false,
  };
  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(password, salt);
  const created = await createUserWithCredential(user, { userId: user.id, email: normalized, passwordHash, salt });
  return created.ok ? user : null;
}

// ---- Confirming the address ----

const CONFIRM_LINK_TTL_MS = 24 * 60 * 60 * 1000;
/** How long an account made by signing up has to be confirmed before the daily run removes it (`deleteUnconfirmedSignUps`). */
export const UNCONFIRMED_SIGN_UP_DAYS = 7;
/** "Send it again", per account and per address it's asked from, in an hour. */
export const RESENDS_PER_ACCOUNT = 3;
export const RESENDS_PER_ADDRESS = 10;

/**
 * One fresh link, replacing the account's last. False when the email didn't go. It isn't tied to the device that asked
 * for it: a device id is a long-lived cookie a shared computer hands to everyone who uses it, so opening the link always
 * takes the account's password too (`confirmEmail`), wherever it's opened and whoever asked for it.
 */
async function sendConfirmLink(userId: string, email: string, config: EmailConfig, { signUp }: { signUp: boolean; device?: string | null }): Promise<boolean> {
  const token = randomBytes(32).toString("hex");
  await saveVerificationToken({ tokenHash: hashResetToken(token), userId, expiresAt: new Date(Date.now() + CONFIRM_LINK_TTL_MS).toISOString(), signUp, deviceHash: null });
  return sendEmail({
    to: email,
    subject: "Confirm your email for Line Select",
    text:
      `Open this link to confirm this is your address and finish setting up your Line Select account:\n${config.appUrl}/confirm-email?token=${token}\n\n` +
      `It works for 24 hours, once.` +
      (signUp ? ` An account that isn't confirmed within ${UNCONFIRMED_SIGN_UP_DAYS} days is removed.` : "") +
      `\n\nIf you didn't sign up for Line Select, ignore this email.`,
  });
}

/**
 * Signing up, when email is set up. The route has already answered "Check your email" and this runs after, so the
 * answer, and how long it took, are the same whether or not the address has an account. Then, by what's there:
 *
 * - nothing: a new, unconfirmed account and a confirm link. It isn't signed in until the link is opened, and its
 *   recovery code is made then, so whoever signed up with someone else's address never sees one.
 * - a confirmed account: nothing is made or changed; its owner gets a short note saying someone tried.
 * - an unconfirmed account: maybe someone else's attempt at this address. Its owner gets a reset link: setting a
 *   password with it confirms the account and replaces its recovery code (`resetPasswordWithEmailToken`), so the
 *   account is theirs and no one else's.
 *
 * Each sender gets a few of these an hour for one address, and an address a few more from everyone together; then
 * the site's hourly allowance, taken only for an email that's really about to go. When that's used up nothing is made
 * or sent, and the answer was the same anyway.
 */
export async function signUpByEmail(email: string, password: string, displayName: string, device?: string | null, from = "unknown"): Promise<void> {
  const config = getEmailConfig();
  if (!config || signUpInputError(email, password, displayName)) return;
  const normalized = normalizeEmail(email);
  if (!(await mayMailAddress("sign-up-mail", normalized, from))) return;

  const existing = await findUserByEmail(normalized);
  if (!existing) {
    // No email can go, so no account: one nobody could confirm would only sit there.
    if (!(await siteMailLeft("sign-up", from))) return;
    const user = await createAccount(normalized, password, displayName);
    // Null: another sign-up for this address got there a moment before, and its email covers this one.
    if (user) await sendConfirmLink(user.id, normalized, config, { signUp: true, device });
    return;
  }
  if (!(await siteMailLeft("sign-up", from))) return;
  if (existing.emailVerified) {
    await sendEmail({
      to: normalized,
      subject: "Someone tried to sign up for Line Select with your email",
      text:
        `Someone tried to make a new Line Select account with this address. You already have one, so nothing was changed.\n\n` +
        `If it was you, sign in at ${config.appUrl}/auth, or reset your password from there if you've forgotten it.\n\n` +
        `If it wasn't you, you don't need to do anything.`,
    });
    return;
  }
  await sendTakeBackLink(existing.id, normalized, config, "Someone tried to make a Line Select account with this address. There's already an account for it that was never confirmed.");
}

/**
 * A reset link to an address whose unconfirmed account may be someone else's: setting a password with it confirms the
 * account, replaces its recovery code and signs everyone else out (`resetPasswordWithEmailToken`), so it's the
 * address owner's alone. The caller has already taken this email from the site's allowance.
 */
async function sendTakeBackLink(userId: string, email: string, config: EmailConfig, why: string): Promise<boolean> {
  const token = randomBytes(32).toString("hex");
  await saveResetToken({ tokenHash: hashResetToken(token), userId, expiresAt: new Date(Date.now() + RESET_LINK_TTL_MS).toISOString() });
  return sendEmail({
    to: email,
    subject: "Finish signing up for Line Select",
    text:
      `${why}\n\n` +
      `If it's yours, open this link within the hour and choose a password. That confirms the account and makes it yours, and signs out anyone else using it:\n` +
      `${config.appUrl}/reset-password?token=${token}\n\n` +
      `If you don't want a Line Select account, ignore this email.`,
  });
}

/**
 * Emails one sender may cause to one address in an hour (enough for a pilot who retries a few times), and all senders
 * together: a sender can't use up an address's share for everyone.
 */
const MAILS_PER_SENDER_AND_ADDRESS = 5;
const MAILS_PER_ADDRESS = 10;

/**
 * Whether another email to this address may go, as asked from `from`: a few an hour for each sender, then a ceiling for
 * the address from everyone. A sender over their own few is turned away before the address's count is touched, so one
 * address asking over and over can't keep a pilot from getting their own email.
 */
async function mayMailAddress(scope: string, email: string, from: string): Promise<boolean> {
  if (!(await checkRateLimit(scope, `${email}|${addressGroup(from)}`, MAILS_PER_SENDER_AND_ADDRESS, 60 * 60)).ok) return false;
  return (await checkRateLimit(`${scope}:address`, email, MAILS_PER_ADDRESS, 60 * 60)).ok;
}

export type ResendResult = { sent: true } | { sent: false; reason: "confirmed" | "not-set-up" | "limited" | "failed" };

/** "Send it again", for a signed-in pilot whose address isn't confirmed. Limited per account and per address it's asked from, then out of the site's hourly allowance. */
export async function resendConfirmEmail(user: UserAccount, from: string, device?: string | null): Promise<ResendResult> {
  if (user.emailVerified) return { sent: false, reason: "confirmed" };
  const config = getEmailConfig();
  if (!config) return { sent: false, reason: "not-set-up" };
  const [mine, address] = await Promise.all([
    checkRateLimit("confirm-resend", user.id, RESENDS_PER_ACCOUNT, 60 * 60),
    checkRateLimit("confirm-resend-address", addressGroup(from), RESENDS_PER_ADDRESS, 60 * 60),
  ]);
  if (!mine.ok || !address.ok || !(await siteMailLeft("sign-up", from))) return { sent: false, reason: "limited" };
  return (await sendConfirmLink(user.id, normalizeEmail(user.email), config, { signUp: false, device })) ? { sent: true } : { sent: false, reason: "failed" };
}

/**
 * "Send the link again" from the log-in screen, by address: for a pilot who signed up and can't sign in until they
 * confirm. The caller answers the same whatever happens here, so it says nothing about the address. Only an account
 * whose address isn't confirmed gets a link; limited per sender and address and per address, then the site's allowance.
 */
export async function resendConfirmEmailByAddress(email: string, from: string, device?: string | null): Promise<void> {
  const config = getEmailConfig();
  const normalized = normalizeEmail(email);
  if (!config || !/^\S+@\S+\.\S+$/.test(normalized)) return;
  if (!(await mayMailAddress("confirm-resend-mail", normalized, from))) return;
  const user = await findUserByEmail(normalized);
  if (!user || user.emailVerified) return;
  if (!(await siteMailLeft("sign-up", from))) return;
  await sendConfirmLink(user.id, normalized, config, { signUp: false, device });
}

export type ConfirmResult =
  | {
      status: "confirmed";
      user: UserAccount;
      /** How this device stands now: signed in by this link, signed in already, or left as it was (see `confirmEmail`). */
      signedIn: "now" | "already" | "other-account";
      sessionToken?: string;
      /** Made now, for an account that had none (every account made by signing up with email): shown once. */
      recoveryCode?: string;
    }
  /** Opened by anyone but its own signed-in pilot: the account's password, or "This wasn't me", before anything happens. */
  | { status: "needs-password"; email: string }
  | { status: "wrong-password" }
  | { status: "limited" }
  /** "This wasn't me": the link is spent, nothing is confirmed, and the address has been sent a link that takes the account. */
  | { status: "not-me" }
  | { status: "used"; yours: boolean }
  | { status: "expired" | "invalid" };

export type ConfirmChoice = { password?: string; notMe?: boolean };

/**
 * Opens a confirm link. Confirming says the account is the address owner's, so whoever confirms must have both the
 * inbox (the link) and the account's password: otherwise someone could sign up with a pilot's address, and the pilot,
 * opening the link, would vouch for an account whose password only that someone knows.
 *
 * - With the account's own pilot signed in here: confirmed straight away.
 * - Otherwise, wherever it's opened, the link isn't spent until the account's password is given (`choice.password`),
 *   checked and limited like a sign-in. A device that signed up proves nothing: on a crew room's or hotel's shared
 *   computer, whoever signed up with a pilot's address and the pilot reading their mail there are on the same device.
 *   Then it's confirmed and, if nobody is signed in here, signed in. Anyone else signed in here stays themselves.
 * - Or "This wasn't me" (`choice.notMe`): the link is spent without confirming, and the address is sent a reset link
 *   that makes the account the address owner's (`sendTakeBackLink`).
 *
 * The recovery code, for an account with none yet, comes back only to its own pilot.
 */
export async function confirmEmail(token: string, signedInAs: string | null, device?: string | null, choice: ConfirmChoice = {}, from?: string): Promise<ConfirmResult> {
  const hash = hashResetToken(token);
  const peek = await peekVerificationToken(hash);
  if (peek.status === "expired" || peek.status === "invalid") return { status: peek.status };
  if (peek.status === "used") return { status: "used", yours: signedInAs === peek.userId };
  const user = await findUserById(peek.userId);
  if (!user) return { status: "invalid" };

  if (choice.notMe) {
    const config = getEmailConfig();
    if (!config) return { status: "invalid" };
    if (!(await mayMailAddress("take-back-mail", normalizeEmail(user.email), from ?? "unknown")) || !(await siteMailLeft("sign-up", from ?? "unknown"))) return { status: "limited" };
    if (!(await voidVerificationToken(hash))) return { status: "used", yours: false };
    // Whoever made the account may be signed in to it, or have a calendar link from it: both end here.
    await endOtherWaysIn(user.id);
    await sendTakeBackLink(user.id, normalizeEmail(user.email), config, "You told us you didn't sign up for the Line Select account with this address. Whoever did can't use this link, and the account isn't confirmed.");
    return { status: "not-me" };
  }

  const ownPilot = signedInAs === user.id;
  if (!ownPilot) {
    if (choice.password === undefined) return { status: "needs-password", email: user.email };
    const normalized = normalizeEmail(user.email);
    if (!(await takeAccountAttempt(LOGIN_RATE_LIMIT_SCOPE, normalized, from, device))) return { status: "limited" };
    const credential = await findCredentialByUserId(user.id);
    const attempt = await hashPassword(choice.password, credential?.salt ?? NO_ACCOUNT_SALT);
    if (!credential || !timingSafeStringEqual(attempt, credential.passwordHash)) return { status: "wrong-password" };
  }

  const spent = await spendVerificationToken(hash);
  if (spent.status !== "confirmed") return spent.status === "used" ? { status: "used", yours: ownPilot } : { status: spent.status };
  const confirmed = { ...user, emailVerified: true };
  if (signedInAs && !ownPilot) return { status: "confirmed", user: confirmed, signedIn: "other-account" };
  const credential = await findCredentialByUserId(user.id);
  const recoveryCode = credential && !credential.recoveryHash ? await storeNewRecoveryCode(user.id) : undefined;
  if (ownPilot) return { status: "confirmed", user: confirmed, signedIn: "already", recoveryCode };
  return { status: "confirmed", user: confirmed, signedIn: "now", sessionToken: await startSession(user.id), recoveryCode };
}

/**
 * Every way someone else may still be in an account once its owner has taken it back (a reset by either route, "This
 * wasn't me"): every session is signed out, and the private calendar link is revoked, since whoever was in could have
 * made one and kept it; the owner makes a new one from Tools. The recovery code is replaced by the caller.
 */
async function endOtherWaysIn(userId: string): Promise<void> {
  await Promise.all([deleteSessionsForUser(userId), revokeFeed(userId)]);
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
  await endOtherWaysIn(credential.userId);
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
  // Out of the site's hourly allowance only now, with the limits per account and per address passed and an email about
  // to go: taken before them, one address asking over and over used up every pilot's reset emails for the hour. Past
  // it the answer is the same as ever, so it says nothing about who has an account.
  if (!(await siteMailLeft("reset", from ?? "unknown"))) return true;

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
 *
 * The link came to the account's address, so it confirms that address too. The recovery code is replaced every time,
 * and the new one comes back to be shown: someone else may have made the old one (an account started with this address
 * by someone else, or one they got into), and with it they could take the account straight back.
 */
export async function resetPasswordWithEmailToken(token: string, newPassword: string, from?: string, device?: string | null): Promise<AuthResult> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false, error: PASSWORD_TOO_SHORT };
  const userId = await consumeResetToken(hashResetToken(token));
  const user = userId ? await findUserById(userId) : null;
  if (!userId || !user) return { ok: false, error: "This reset link is invalid or has expired. Request a new one." };

  const salt = randomBytes(16).toString("hex");
  await updateCredential(userId, { passwordHash: await hashPassword(newPassword, salt), salt });
  await endOtherWaysIn(userId);
  await markEmailVerified(userId);
  const recoveryCode = await storeNewRecoveryCode(userId);
  const normalized = normalizeEmail(user.email);
  await clearAttemptsAfterReset(normalized, from);
  await rememberDevice(normalized, device);
  return { ok: true, user: { ...user, emailVerified: true }, sessionToken: await startSession(userId), recoveryCode };
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
/**
 * The same answer for "no such account", "wrong password" and "an account just made by signing up whose address isn't
 * confirmed yet" (`isUnconfirmedSignUp`), so neither the sign-in form nor signing in straight after signing up can be
 * used to find out who has an account. The words cover the last of these too.
 */
export const LOGIN_FAILED = "Wrong email or password. If you just signed up, open the link we emailed you first.";
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
  // Asked beside the hash, right or wrong, so a correct password to an account waiting on its link takes no longer to
  // turn away than a wrong one.
  const [attemptHash, waitingOnLink] = await Promise.all([
    hashPassword(password, credential?.salt ?? NO_ACCOUNT_SALT),
    credential ? isUnconfirmedSignUp(credential.userId) : Promise.resolve(false),
  ]);
  if (!credential || !timingSafeStringEqual(attemptHash, credential.passwordHash) || waitingOnLink) {
    return { ok: false, error: LOGIN_FAILED };
  }

  const user = await findUserById(credential.userId);
  if (!user) {
    return { ok: false, error: "Account data is missing. Try creating a new account." };
  }

  // This address's count only: the account-wide one is left to run out, or a guesser working from many addresses
  // would get a fresh set of them each time the pilot signed in.
  await clearAttempts(LOGIN_RATE_LIMIT_SCOPE, normalized);
  if (from) await clearAttempts(LOGIN_RATE_LIMIT_SCOPE, `${normalized}|${addressGroup(from)}`);
  await rememberDevice(normalized, device);
  const sessionToken = await startSession(user.id);
  // An account with no recovery code yet (one confirmed from a tab signed in as someone else, or from before codes
  // existed) gets one now, shown once, so the way back in the sign-in screen speaks of is really there.
  const recoveryCode = credential.recoveryHash ? undefined : await storeNewRecoveryCode(user.id);
  return { ok: true, user, sessionToken, recoveryCode };
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
async function takeAccountAttempt(scope: string, email: string, sentFrom?: string, device?: string | null): Promise<boolean> {
  if (!sentFrom) return takeAttempt(scope, email);
  // Counted by the sender's address group (an IPv6 /64 is one sender), however the caller wrote it.
  const from = addressGroup(sentFrom);
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
async function clearAttemptsAfterReset(email: string, sentFrom?: string): Promise<void> {
  const from = sentFrom && addressGroup(sentFrom);
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
