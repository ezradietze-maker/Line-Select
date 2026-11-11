/**
 * Types shared across the FedEx-connection feature (step 8, phases 2–4).
 *
 * This feature lets a pilot connect their own FedEx account so Line Select can read their open time (and later their
 * schedule) and score it the way the pasted list is scored today. It is OFF by default and ships "coming soon": the real
 * FedEx request/response details are UNKNOWN until a current pilot helps with discovery (phase 1), and nobody on this
 * project can sign in to FedEx. Nothing here probes, scrapes or sends any request to a FedEx host.
 *
 * See `private/plans/step-8-fedex-connection.md`. The five hard limits that govern every file here:
 *   1. Never bypass Okta / two-factor — the pilot signs in on FedEx's own page, themselves.
 *   2. Never use a login without the pilot's clear, specific consent; they can disconnect at any time.
 *   3. Never evade a FedEx limit or block — no address rotation, no disguising traffic; stop on the quota, back off on errors.
 *   4. Never store a password. We aim to never even see one.
 *   5. Claude never signs in or enters credentials; a real pilot does that themselves.
 */

/** Which connection method phase 1 picks. Undecided until a current pilot helps; the session store is method-agnostic. */
export type ConnectionMethod =
  /** A. Companion in the pilot's own browser (extension). Session stays on the device; nothing is held server-side. */
  | "device-extension"
  /** B. Native app with FedEx's real sign-in in a web view. */
  | "native-app"
  /** C. Server-held encrypted session (only if login can be done without seeing the password). */
  | "server-session"
  /** Not yet chosen — the state everything is in today. */
  | "undecided";

export type ConnectionStatus =
  /** No connection, or disconnected. */
  | "none"
  /** Consent accepted; the live feed is not wired yet (the only state a pilot can reach today). */
  | "coming-soon"
  /** A live session exists and is usable. Not reachable until discovery wires `fetchLiveOpenTime`. */
  | "connected"
  /** The FedEx session expired; the pilot signs in again. */
  | "expired";

/** One line in the audit the pilot can see: every time the connection was used, and for what. Never contains secrets. */
export interface AuditEntry {
  /** Epoch ms. Shown as e.g. "used your connection at 14:02 to read open time". */
  at: number;
  action: "consent" | "consent-changed" | "connect" | "read-open-time" | "read-schedule" | "disconnect" | "expired" | "quota-reached" | "error";
  /** Short, pilot-readable detail. No tokens, no other pilots' names. */
  detail: string;
}

/**
 * A pilot's connection record, as the server holds it. The only field that could carry a secret is `encryptedSession`,
 * and it is AES-256-GCM ciphertext (see `lib/server/fedex-session.ts`) — the plaintext session is never stored or logged.
 * With method A (device extension) `encryptedSession` stays null: the session lives on the pilot's device, not here.
 */
export interface FedexConnection {
  userId: string;
  status: ConnectionStatus;
  method: ConnectionMethod;
  /** Which consent version the pilot accepted, and when. Re-consent is required if the version changes. */
  consentVersion: string | null;
  consentAt: number | null;
  /** AES-256-GCM blob of the FedEx session material, or null. NEVER the password — passwords are never seen or stored. */
  encryptedSession: string | null;
  /** When the FedEx session stops working (epoch ms). Acrobid's last about 4h; the real figure is unknown until phase 1. */
  sessionExpiresAt: number | null;
  /** The pilot-visible audit trail, newest last, capped. */
  audit: AuditEntry[];
  /** Per-pilot open-time quota tracking for the poller (see `poller.ts`). */
  quota: QuotaState;
}

/**
 * FedEx enforces a per-pilot daily open-time quota (known to exist from Acrobid's code; the size is UNKNOWN until phase 1).
 * We stay well below it on each pilot's OWN connection and stop when it's reached. No shared-across-pilots feed yet — that
 * is a separate owner + lawyer decision (step-8 phase 4, hard limit 3).
 */
export interface QuotaState {
  /** "YYYY-MM-DD" in the pilot's base-local day the quota resets on; counting restarts when this rolls over. */
  day: string | null;
  /** Reads spent today on this pilot's connection. */
  used: number;
}

/** A blank connection for a user who has never connected. */
export function emptyConnection(userId: string): FedexConnection {
  return {
    userId,
    status: "none",
    method: "undecided",
    consentVersion: null,
    consentAt: null,
    encryptedSession: null,
    sessionExpiresAt: null,
    audit: [],
    quota: { day: null, used: 0 },
  };
}

/** What the client needs to render the connect panel — never the encrypted session or any raw session material. */
export interface ConnectionView {
  status: ConnectionStatus;
  method: ConnectionMethod;
  consentVersion: string | null;
  consentAt: number | null;
  sessionExpiresAt: number | null;
  audit: AuditEntry[];
  /** Whether the live feed is wired. False today everywhere — the connect flow shows "coming soon / needs setup". */
  liveWired: boolean;
}

export function toView(conn: FedexConnection, liveWired: boolean): ConnectionView {
  return {
    status: conn.status,
    method: conn.method,
    consentVersion: conn.consentVersion,
    consentAt: conn.consentAt,
    sessionExpiresAt: conn.sessionExpiresAt,
    audit: conn.audit,
    liveWired,
  };
}
