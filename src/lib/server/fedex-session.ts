/**
 * Server-side store for a pilot's FedEx connection (step-8 phase 2): the connection record, the pilot-visible audit
 * trail, and — when a method that holds a server session is ever chosen — the ENCRYPTED session material.
 *
 * Security properties (step-8 phase 2 "Security"):
 *   - Any session material is encrypted at rest with AES-256-GCM under a managed key (`FEDEX_SESSION_KEY`). The plaintext
 *     session is NEVER written to the store and NEVER logged. We never hold a password at all.
 *   - The record is keyed per pilot and only ever read for that pilot (see the routes' `getCurrentServerUser` check).
 *   - Deleted on disconnect, and on expiry (the kv key carries a TTL, and expired session material is dropped on read).
 *   - This module is the only place session material is handled, keeping it isolated from the rest of the app. The
 *     always-on polling WORKER that phase 4 needs is a separate small service (not this Next.js app) and is not built
 *     here — nothing here reads FedEx.
 *
 * Today no session material ever exists: `fetchLiveOpenTime` is a stub and the connect flow is "coming soon". The
 * encryption path is exercised by tests and is ready for the day a real session is captured in discovery.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getJson, setJson } from "@/lib/server/kv";
import type { AuditEntry, FedexConnection } from "@/lib/fedex-connect/types";
import { emptyConnection } from "@/lib/fedex-connect/types";

const KEY_PREFIX = "fedex-conn:";
/** How long a connection record lingers in the store with no activity. Session material carries its own, shorter expiry. */
const RECORD_TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days.
/** The audit stays useful without growing forever; the pilot sees the most recent uses. */
const AUDIT_CAP = 50;

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

/**
 * The managed encryption key: 32 bytes, from `FEDEX_SESSION_KEY` as base64 or hex. Required to encrypt session material.
 * Absent, encryption refuses rather than storing anything weakly — there is nothing to store today anyway.
 */
function sessionKey(): Buffer {
  const raw = process.env.FEDEX_SESSION_KEY;
  if (!raw) throw new Error("FEDEX_SESSION_KEY is not set; refusing to encrypt FedEx session material.");
  const key = raw.length === 64 ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("FEDEX_SESSION_KEY must decode to 32 bytes (a 256-bit key).");
  return key;
}

/** AES-256-GCM encrypt. Returns `iv.tag.ciphertext`, all base64url. The plaintext is never logged or persisted elsewhere. */
export function encryptSession(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, sessionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64url")).join(".");
}

/** AES-256-GCM decrypt of what `encryptSession` produced. Throws on any tampering (GCM auth tag). */
export function decryptSession(blob: string): string {
  const [ivB64, tagB64, dataB64] = blob.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted session blob.");
  const decipher = createDecipheriv(ALGO, sessionKey(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
}

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/** The pilot's connection, or a blank one. Expired session material is dropped here, so a read never returns a dead session. */
export async function getConnection(userId: string): Promise<FedexConnection> {
  const stored = await getJson<FedexConnection>(keyFor(userId));
  if (!stored) return emptyConnection(userId);
  const conn: FedexConnection = { ...emptyConnection(userId), ...stored, userId };
  if (conn.sessionExpiresAt !== null && Date.now() >= conn.sessionExpiresAt) {
    conn.encryptedSession = null;
    conn.sessionExpiresAt = null;
    if (conn.status === "connected") conn.status = "expired";
  }
  return conn;
}

export async function saveConnection(conn: FedexConnection): Promise<void> {
  await setJson(keyFor(conn.userId), conn, { ttlSeconds: RECORD_TTL_SECONDS });
}

/** Append an audit line (newest last), capped. The audit never contains a token, a password, or another pilot's name. */
export function withAudit(conn: FedexConnection, entry: AuditEntry): FedexConnection {
  const audit = [...conn.audit, entry].slice(-AUDIT_CAP);
  return { ...conn, audit };
}

/**
 * Disconnect: delete session material and mark the connection gone, keeping the audit so the pilot still sees their
 * history. A disconnect line is appended.
 */
export async function disconnect(userId: string): Promise<FedexConnection> {
  const conn = await getConnection(userId);
  const cleared = withAudit(
    { ...conn, status: "none", method: "undecided", encryptedSession: null, sessionExpiresAt: null, quota: { day: null, used: 0 } },
    { at: Date.now(), action: "disconnect", detail: "You disconnected FedEx. Anything held for the connection was deleted." },
  );
  await saveConnection(cleared);
  return cleared;
}

/**
 * Whether the live FedEx feed is wired. FALSE today, everywhere: the real calls don't exist until phase-1 discovery with
 * a current pilot. The connect flow reads this to show "coming soon / needs setup" rather than pretending to connect.
 */
export function isLiveWired(): boolean {
  return false;
}
