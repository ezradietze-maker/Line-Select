import { afterEach, describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { hashUser, keyedPilotHash, PILOT_HASH_COLUMNS, pilotHashIsKeyed, plainPilotHash } from "@/lib/server/pilot-hash";
import * as schema from "@/lib/server/schema";

const ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  delete process.env.PILOT_HASH_SECRET;
});

describe("the pilot hash", () => {
  it("can't be recomputed from the account id alone once keyed", () => {
    process.env.PILOT_HASH_SECRET = "a-secret";
    expect(pilotHashIsKeyed()).toBe(true);
    expect(hashUser(ID)).not.toBe(plainPilotHash(ID));
    expect(hashUser(ID)).toBe(keyedPilotHash(ID, "a-secret"));
    expect(keyedPilotHash(ID, "another")).not.toBe(keyedPilotHash(ID, "a-secret"));
  });

  it("stays what's stored until the key is set", () => {
    expect(pilotHashIsKeyed()).toBe(false);
    expect(hashUser(ID)).toBe(plainPilotHash(ID));
  });

  it("never contains the id, and is the same size as before", () => {
    expect(keyedPilotHash(ID, "s")).toMatch(/^[0-9a-f]{20}$/);
    expect(plainPilotHash(ID)).toMatch(/^[0-9a-f]{20}$/);
  });

  it("the move covers every hash column in the schema", () => {
    const found: string[] = [];
    for (const table of Object.values(schema)) {
      if (typeof table !== "object" || table === null || !(Symbol.for("drizzle:IsDrizzleTable") in table)) continue;
      const name = (table as unknown as Record<symbol, string>)[Symbol.for("drizzle:Name")];
      for (const c of Object.values(getTableColumns(table as never)) as { name: string }[]) if (c.name === "pilot_hash" || c.name === "user_hash") found.push(`${name}.${c.name}`);
    }
    expect(found.sort()).toEqual(PILOT_HASH_COLUMNS.map((c) => `${c.table}.${c.column}`).sort());
  });
});
