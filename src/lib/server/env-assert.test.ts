import { describe, expect, it } from "vitest";
import { assertProductionEnv, missingProductionEnv } from "./env-assert";

/** A production server env with everything the assertion requires. */
const complete = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://user:pass@host/db",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "token",
} satisfies Record<string, string>;

describe("missingProductionEnv", () => {
  it("finds nothing when every required var is set", () => {
    expect(missingProductionEnv(complete)).toEqual([]);
  });

  it("accepts Vercel's KV names in place of the Upstash ones", () => {
    const env = {
      NODE_ENV: "production",
      POSTGRES_URL: "postgres://user:pass@host/db",
      KV_REST_API_URL: "https://example.kv.vercel-storage.com",
      KV_REST_API_TOKEN: "token",
    };
    expect(missingProductionEnv(env)).toEqual([]);
  });

  it("flags a missing database connection", () => {
    const { DATABASE_URL, ...env } = complete;
    void DATABASE_URL;
    const names = missingProductionEnv(env).map((m) => m.name);
    expect(names).toContainEqual(expect.stringContaining("DATABASE_URL"));
  });

  it("flags Redis when only the URL is set", () => {
    const { UPSTASH_REDIS_REST_TOKEN, ...env } = complete;
    void UPSTASH_REDIS_REST_TOKEN;
    const names = missingProductionEnv(env).map((m) => m.name);
    expect(names).toContainEqual(expect.stringContaining("UPSTASH_REDIS_REST_URL"));
  });

  it("treats a blank string as unset", () => {
    expect(missingProductionEnv({ ...complete, DATABASE_URL: "   " })).toHaveLength(1);
  });

  it("flags both when the env is empty", () => {
    expect(missingProductionEnv({})).toHaveLength(2);
  });
});

describe("assertProductionEnv", () => {
  it("throws in production when required env is missing", () => {
    expect(() => assertProductionEnv({ NODE_ENV: "production" })).toThrow(/cannot start/i);
  });

  it("names the missing vars and points to the doc", () => {
    expect(() => assertProductionEnv({ NODE_ENV: "production" })).toThrow(/docs\/launch\/spend-caps\.md/);
  });

  it("does not throw in production when env is complete", () => {
    expect(() => assertProductionEnv(complete)).not.toThrow();
  });

  it("stays quiet in development even with nothing set", () => {
    expect(() => assertProductionEnv({ NODE_ENV: "development" })).not.toThrow();
  });

  it("stays quiet under test even with nothing set", () => {
    expect(() => assertProductionEnv({ NODE_ENV: "test" })).not.toThrow();
  });

  it("stays quiet during `next build` (production phase, no live credentials)", () => {
    expect(() => assertProductionEnv({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).not.toThrow();
  });
});
