import { createHash, timingSafeEqual } from "node:crypto";

/** A shared secret from a request header against the configured one, in constant time; never matches when either is missing. */
export function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  // Hashed first so the two are the same length, which timingSafeEqual requires, without leaking the real length.
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
