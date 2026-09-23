/**
 * Account model for this prototype. Accounts are real and server-verified —
 * stored in a JSON file on the dev server's disk (see `lib/server/db.ts`),
 * not a production database, but genuinely shared across devices/browsers
 * hitting the same server, which the Trade Board depends on (a trade offer
 * has to be visible to a different pilot on a different device).
 */

export interface UserAccount {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  /**
   * Gating hook point for a future paid tier — every account today is
   * functionally "free" regardless of this field (nothing in the app
   * actually checks it yet). Optional, not defaulted at the type level,
   * so an account record written before this field existed still reads
   * fine; treat an absent value as `"free"` wherever it matters.
   */
  plan?: "free" | "pro";
}

/** Stored server-side alongside the account; password is hashed + salted, never kept in plain text. */
export interface StoredCredential {
  userId: string;
  email: string;
  passwordHash: string;
  salt: string;
  /**
   * Hash of the pilot's one-time recovery code — their way back in if they
   * forget the password, with no email service involved. Absent on an
   * account created before recovery codes existed (they can generate one
   * from the account menu while signed in). Hashed and salted exactly like
   * the password; the code itself is only ever shown once, at creation.
   */
  recoveryHash?: string;
  recoverySalt?: string;
}

export interface AuthSession {
  userId: string;
}
