import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertLocalRuntimeNotProduction,
  assertSafeForDestructiveOp,
  looksLikeProductionUrl,
} from "@/lib/server/db-guard";

/**
 * Pure-logic tests for the production-database fence. No real database — they
 * only exercise how the guard reads a connection string and the environment.
 */

const ENV_KEYS = ["PRODUCTION_DB_HOST", "ALLOW_PRODUCTION_DB", "VERCEL", "VERCEL_ENV"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const prodUrl = "postgresql://user:pw@ep-cool-forest-12345678-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const devBranchUrl = "postgresql://user:pw@ep-wild-dev-87654321-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const localUrl = "postgresql://postgres:postgres@localhost:5432/line_select";

describe("looksLikeProductionUrl", () => {
  it("treats localhost and loopback as safe", () => {
    expect(looksLikeProductionUrl(localUrl)).toBe(false);
    expect(looksLikeProductionUrl("postgresql://u:p@127.0.0.1:5432/db")).toBe(false);
    expect(looksLikeProductionUrl("postgresql://u:p@db.localhost:5432/db")).toBe(false);
  });

  it("treats a host or db name carrying a dev/test/staging token as safe", () => {
    expect(looksLikeProductionUrl(devBranchUrl)).toBe(false);
    expect(looksLikeProductionUrl("postgresql://u:p@ep-x-staging-9.neon.tech/neondb")).toBe(false);
    expect(looksLikeProductionUrl("postgresql://u:p@some-host.example.com/app_test")).toBe(false);
  });

  it("does not match a token buried inside a larger word", () => {
    // "devious" must not read as the "dev" marker.
    expect(looksLikeProductionUrl("postgresql://u:p@ep-devious-forest-12345678.neon.tech/neondb")).toBe(true);
  });

  it("assumes an unrecognised remote host is production (fail-safe)", () => {
    expect(looksLikeProductionUrl(prodUrl)).toBe(true);
  });

  it("treats an unparseable string as production", () => {
    expect(looksLikeProductionUrl("not a url")).toBe(true);
  });

  describe("with PRODUCTION_DB_HOST set", () => {
    it("is authoritative: only a matching host is production", () => {
      process.env.PRODUCTION_DB_HOST = "ep-cool-forest-12345678";
      expect(looksLikeProductionUrl(prodUrl)).toBe(true);
      // A different branch is safe even though its host has no dev marker.
      expect(looksLikeProductionUrl("postgresql://u:p@ep-other-99887766-pooler.neon.tech/neondb")).toBe(false);
    });

    it("matches the direct host when the pooled one is named, and the other way round", () => {
      // Neon's pooled and direct hosts differ only by "-pooler"; migrate.ts and the scripts use the direct one
      // (POSTGRES_URL_NON_POOLING), so naming the pooled host must still fence it.
      const directUrl = "postgresql://user:pw@ep-cool-forest-12345678.us-east-1.aws.neon.tech/neondb?sslmode=require";
      process.env.PRODUCTION_DB_HOST = "ep-cool-forest-12345678-pooler.us-east-1.aws.neon.tech";
      expect(looksLikeProductionUrl(directUrl)).toBe(true);
      expect(looksLikeProductionUrl(prodUrl)).toBe(true);
      process.env.PRODUCTION_DB_HOST = "ep-cool-forest-12345678.us-east-1.aws.neon.tech";
      expect(looksLikeProductionUrl(prodUrl)).toBe(true);
      expect(() => assertSafeForDestructiveOp(directUrl, "db:migrate")).toThrow(/PRODUCTION/);
    });
  });
});

describe("assertSafeForDestructiveOp", () => {
  it("throws against a production-looking target", () => {
    expect(() => assertSafeForDestructiveOp(prodUrl, "db:migrate")).toThrow(/PRODUCTION/);
  });

  it("allows a dev/local target", () => {
    expect(() => assertSafeForDestructiveOp(devBranchUrl, "db:migrate")).not.toThrow();
    expect(() => assertSafeForDestructiveOp(localUrl, "db:migrate")).not.toThrow();
  });

  it("allows production when ALLOW_PRODUCTION_DB is set", () => {
    process.env.ALLOW_PRODUCTION_DB = "1";
    expect(() => assertSafeForDestructiveOp(prodUrl, "db:migrate")).not.toThrow();
  });
});

describe("assertLocalRuntimeNotProduction", () => {
  it("throws for a local process pointed at production", () => {
    expect(() => assertLocalRuntimeNotProduction(prodUrl)).toThrow(/PRODUCTION/);
  });

  it("steps aside on Vercel (the deployed app reaches its wired database)", () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertLocalRuntimeNotProduction(prodUrl)).not.toThrow();
    process.env.VERCEL_ENV = "preview";
    expect(() => assertLocalRuntimeNotProduction(prodUrl)).not.toThrow();
  });

  it("still fences `npm run dev` when .env.local came from `vercel env pull`", () => {
    // `vercel env pull` writes VERCEL="1" and VERCEL_ENV="development" into .env.local, which `next dev` loads.
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "development";
    vi.stubEnv("NODE_ENV", "development");
    expect(() => assertLocalRuntimeNotProduction(prodUrl)).toThrow(/PRODUCTION/);
    // A pull from the production environment says "production", but the dev server still runs in development.
    process.env.VERCEL_ENV = "production";
    expect(() => assertLocalRuntimeNotProduction(prodUrl)).toThrow(/PRODUCTION/);
  });

  it("still fences a script (no NODE_ENV) that loaded a pulled .env.local", () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    vi.stubEnv("NODE_ENV", undefined);
    expect(() => assertLocalRuntimeNotProduction(prodUrl)).toThrow(/PRODUCTION/);
  });

  it("allows a local process against a dev/local database", () => {
    expect(() => assertLocalRuntimeNotProduction(devBranchUrl)).not.toThrow();
    expect(() => assertLocalRuntimeNotProduction(localUrl)).not.toThrow();
  });

  it("allows production locally with the explicit opt-in", () => {
    process.env.ALLOW_PRODUCTION_DB = "1";
    expect(() => assertLocalRuntimeNotProduction(prodUrl)).not.toThrow();
  });
});
