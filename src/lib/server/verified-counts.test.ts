import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeRanking } from "@/lib/forecast/ranking-codec";
import { hashUser } from "@/lib/server/pilot-hash";
import { forecastRankings, interviewOutcomes, preferenceCorrections, users } from "@/lib/server/schema";

/**
 * The shared tables kept by a pilot's one-way tag, not their account: what's read from them counts only confirmed
 * accounts' rows. A stand-in database answers each query with the rows of the table it's from: never Postgres.
 */

const tables = vi.hoisted(() => new Map<unknown, unknown[]>());
vi.mock("@/lib/server/postgres", () => {
  const chain = (rows: () => unknown[]): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve(rows());
          return () => chain(rows);
        },
      }
    );
  return {
    db: {
      select: () => ({ from: (table: unknown) => chain(() => tables.get(table) ?? []) }),
    },
  };
});

const { forgetVerifiedPilots } = await import("@/lib/server/verified-pilots");
const { loadKnownRankings, blobKey } = await import("@/lib/server/forecast-store");
const { loadBrainOutcomes, loadCorrections } = await import("@/lib/server/learning-store");

const confirmed = ["11111111-1111-4111-8111-000000000001", "11111111-1111-4111-8111-000000000002", "11111111-1111-4111-8111-000000000003"];
const unconfirmed = ["22222222-2222-4222-8222-000000000001", "22222222-2222-4222-8222-000000000002"];
const lines = ["1001", "1002", "1003"];

beforeEach(() => {
  tables.clear();
  forgetVerifiedPilots();
  tables.set(users, confirmed.map((id) => ({ id })));
});

describe("shared forecast rankings", () => {
  it("only confirmed accounts' rankings are used, or counted as sharing", async () => {
    const key = blobKey("oct26|mem|md11|cap", lines);
    tables.set(
      forecastRankings,
      [...confirmed, ...unconfirmed].map((id, i) => ({ blobKey: key, userHash: hashUser(id), bidNumber: i + 1, seniority: i + 1, ranking: encodeRanking([0, 1, 2], 3) }))
    );
    const { known, total } = await loadKnownRankings("oct26|mem|md11|cap", lines, null);
    expect(total).toBe(3);
    expect(known.map((k) => k.bidNumber)).toEqual([1, 2, 3]);
  });
});

describe("what the fleet learning reads", () => {
  it("interviews from confirmed accounts only, so made-up accounts can't make up a group's ten pilots", async () => {
    const outcome = (base: string) => ({ v: 2, month: "DEC26", cohort: { base, aircraft: "MD11", seat: "CAP", commute: "local", seniority: "middle" }, checkIn: false, questions: 1, choices: 1, criteria: [], cities: {}, review: [] });
    tables.set(
      interviewOutcomes,
      [...confirmed, ...unconfirmed].map((id) => ({ payload: outcome("MEM"), pilotHash: hashUser(id), at: new Date() }))
    );
    const read = await loadBrainOutcomes();
    expect(read).toHaveLength(3);
    expect(new Set(read.map((o) => o.pilot))).toEqual(new Set(confirmed.map(hashUser)));
  });

  it("corrections from confirmed accounts only", async () => {
    tables.set(
      preferenceCorrections,
      [...confirmed, ...unconfirmed, null].map((id) => ({ pilotHash: id && hashUser(id), dim: "d", src: "review", fromValue: 1, toValue: 2 }))
    );
    expect(await loadCorrections()).toHaveLength(3);
  });

  it("everything again once the account is confirmed", async () => {
    tables.set(preferenceCorrections, unconfirmed.map((id) => ({ pilotHash: hashUser(id), dim: "d", src: "review", fromValue: 1, toValue: 2 })));
    expect(await loadCorrections()).toHaveLength(0);
    tables.set(users, [...confirmed, ...unconfirmed].map((id) => ({ id })));
    forgetVerifiedPilots();
    expect(await loadCorrections()).toHaveLength(2);
  });
});
