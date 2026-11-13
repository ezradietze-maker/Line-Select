/**
 * A safety fence around the production database.
 *
 * Until now there was no dev/prod separation: `.env.local`'s `DATABASE_URL` is
 * the live Neon database, so `npm run dev`, `npm run db:migrate`, or any ad-hoc
 * `tsx scripts/…` run from a laptop wrote straight to real pilots' accounts and
 * trades. One careless migration or stray `delete` could corrupt customer data
 * with nothing to stop it. Now that pilots are about to pay, that's the single
 * most dangerous gap, so this module refuses those operations when the
 * connection string points at production — unless the operator explicitly opts
 * in. See `docs/safe-database.md` for how to point local work at a safe DB.
 *
 * The rule, in one line: a *local* process (not running on Vercel) will not
 * touch a *production-looking* database unless `ALLOW_PRODUCTION_DB` is set.
 *
 * Nothing here changes how the deployed app behaves. On Vercel the platform
 * wires the right `DATABASE_URL` per environment (production, preview,
 * development), and `process.env.VERCEL` is always set there, so the guard
 * steps aside and the app connects exactly as before.
 */

/** Truthy values accepted for the opt-in / marker env vars. */
function envTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Are we running on Vercel? Vercel sets `VERCEL=1` in build and at runtime for
 * every environment. Locally it's undefined. We use this to tell "the deployed
 * app, which is supposed to reach its wired database" from "a process on
 * someone's laptop, which is not."
 */
export function onVercel(): boolean {
  return !!process.env.VERCEL;
}

/**
 * The explicit opt-in that lets a process deliberately touch production — for
 * example a deploy pipeline running `ALLOW_PRODUCTION_DB=1 npm run db:migrate`,
 * or an operator who really does mean to run a one-off against the live DB.
 */
export function productionDbOptIn(): boolean {
  return envTruthy(process.env.ALLOW_PRODUCTION_DB);
}

/**
 * Does this connection string look like the production database?
 *
 * The reliable signal, when it's available, is the host: set
 * `PRODUCTION_DB_HOST` to your live Neon endpoint host (or any substring unique
 * to it) and a string whose host contains it is treated as production, while
 * every other database — your dev branch, a local Postgres — is treated as
 * safe. This is the recommended setup because Neon branch endpoints get random
 * hostnames that don't contain the branch name, so a name-based guess alone
 * can't recognise a dev branch.
 *
 * Without `PRODUCTION_DB_HOST`, we fall back to markers: localhost and anything
 * carrying a `dev`/`test`/`staging`/`sandbox`/`preview`/`ci`/`local` token in
 * its host or database name is treated as safe, and anything else is treated as
 * production. That default is deliberately fail-safe: an unrecognised database
 * is assumed to be production so a slip errs toward refusing, never toward
 * silently writing to live data.
 */
export function looksLikeProductionUrl(connectionString: string): boolean {
  let host = "";
  let dbName = "";
  try {
    const url = new URL(connectionString);
    host = url.hostname.toLowerCase();
    dbName = decodeURIComponent(url.pathname.replace(/^\//, "")).toLowerCase();
  } catch {
    // Unparseable connection string: be conservative and treat it as production.
    return true;
  }

  // Local Postgres is never the production database.
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return false;
  }

  // If the operator has named the production host, that is authoritative.
  const prodHost = process.env.PRODUCTION_DB_HOST?.trim().toLowerCase();
  if (prodHost) return host.includes(prodHost);

  // Otherwise, a recognisable non-production marker in the host or db name
  // makes it safe. We split on non-alphanumerics (`.`, `-`, `_`) and match whole
  // tokens, so "dev" marks `ep-x-dev-123` and `app_dev` as safe but does not
  // match inside a larger word like a random endpoint "ep-devious-…".
  const MARKERS = new Set([
    "dev", "development", "test", "testing", "staging", "stage",
    "sandbox", "preview", "local", "ci", "scratch",
  ]);
  const tokens = `${host}/${dbName}`.split(/[^a-z0-9]+/);
  if (tokens.some((t) => MARKERS.has(t))) {
    return false;
  }

  // Unknown host, no safe marker, no PRODUCTION_DB_HOST to check against:
  // assume production so we fail safe.
  return true;
}

/** Redact credentials so an error message can name the database without leaking the password. */
function describeTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const db = url.pathname.replace(/^\//, "");
    return `${url.hostname}${db ? `/${db}` : ""}`;
  } catch {
    return "(unparseable connection string)";
  }
}

/**
 * Guard for a destructive / schema-changing operation run outside the deployed
 * app — migrations and the one-off maintenance scripts. Throws, before anything
 * touches the database, when the target looks like production and the operator
 * has not opted in. On Vercel this still applies: a migration against
 * production (on Vercel or off it) is exactly the thing that must be deliberate,
 * so it requires `ALLOW_PRODUCTION_DB=1` either way.
 */
export function assertSafeForDestructiveOp(connectionString: string, opLabel: string): void {
  if (productionDbOptIn()) return;
  if (!looksLikeProductionUrl(connectionString)) return;
  throw new Error(
    `Refusing to run "${opLabel}" against what looks like the PRODUCTION database (${describeTarget(connectionString)}).\n` +
      `This would change live pilot data. If you really mean to, re-run with ALLOW_PRODUCTION_DB=1.\n` +
      `To work safely, point DATABASE_URL at a dev/test database instead — see docs/safe-database.md.`
  );
}

/**
 * Guard for the app's own runtime connection (`postgres.ts`). It only fires for
 * a *local* process: on Vercel the platform wires the correct database per
 * environment, so the guard steps aside there and never risks breaking a
 * preview or production deploy. Locally, it stops `npm run dev` (and anything
 * else that opens the app's pool) from connecting to production, so poking
 * around on localhost can't mutate real accounts and trades.
 */
export function assertLocalRuntimeNotProduction(connectionString: string): void {
  if (onVercel()) return;
  if (productionDbOptIn()) return;
  if (!looksLikeProductionUrl(connectionString)) return;
  throw new Error(
    `Refusing to connect this local process to what looks like the PRODUCTION database (${describeTarget(connectionString)}).\n` +
      `Anything you do on localhost would hit real pilot data. Point DATABASE_URL at a dev/test database ` +
      `(see docs/safe-database.md), or set ALLOW_PRODUCTION_DB=1 if you genuinely need production here.`
  );
}
