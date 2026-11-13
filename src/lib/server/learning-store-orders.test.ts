import { describe, expect, it, vi } from "vitest";

/**
 * Which stored line order a reported award is read through, against in-memory tables: the query builder is stood in
 * for and the conditions made plain, so no database is touched.
 */
type Row = Record<string, unknown>;
type Where = (row: Row) => boolean;
const tables = vi.hoisted(() => new Map<unknown, Row[]>());

vi.mock("drizzle-orm", async (importOriginal) => {
  const real = await importOriginal<typeof import("drizzle-orm")>();
  const prop = (column: { table: never }) => Object.entries(real.getTableColumns(column.table)).find(([, c]) => c === column)![0];
  return {
    ...real,
    eq: (column: never, value: unknown): Where => (row) => row[prop(column)] === value,
    inArray: (column: never, values: unknown[]): Where => (row) => values.includes(row[prop(column)]),
    and: (...wheres: Where[]): Where => (row) => wheres.every((w) => w(row)),
    desc: (column: never) => column,
  };
});

vi.mock("@/lib/server/postgres", () => {
  const query = (rows: Row[]) => {
    const q = {
      where: (w: Where) => query(rows.filter(w)),
      orderBy: () => q,
      limit: async (n: number) => rows.slice(0, n),
      then: (resolve: (r: Row[]) => unknown) => resolve(rows),
    };
    return q;
  };
  return { db: { select: () => ({ from: (table: unknown) => query(tables.get(table) ?? []) }) } };
});

const { forecastPredictions, packFeatures } = await import("@/lib/server/schema");
const { blobKey, legacyBlobKey } = await import("@/lib/server/forecast-store");
const { awardedChoiceFromPrediction } = await import("@/lib/server/learning-store");

const PACK = "2026-12|mem|md11|cap";
const realOrder = Array.from({ length: 12 }, (_, i) => String(i + 1));
const forged = ["1", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "12"];
const PILOT = "pilot-hash";

function setUp(predictionKey: string, packs: { blobKey: string; lineNumbers: string[] }[]) {
  tables.clear();
  // The pilot ranked line 3 first (index 2 in the real order).
  tables.set(forecastPredictions, [{ pilotHash: PILOT, packKey: PACK, blobKey: predictionKey, ranking: [2, 0, 1], createdAt: new Date() }]);
  tables.set(packFeatures, packs.map((p) => ({ ...p, packKey: PACK })));
}

describe("reading an award through the stored line order", () => {
  it("uses the order under the new key, which names that order", async () => {
    setUp(blobKey(PACK, realOrder), [{ blobKey: blobKey(PACK, realOrder), lineNumbers: realOrder }]);
    expect(await awardedChoiceFromPrediction(PILOT, PACK, "3")).toBe(1);
  });

  it("doesn't read an award through an old-key order nothing vouches for: a guest's shuffled one may have been stored first", async () => {
    setUp(legacyBlobKey(PACK, realOrder), [{ blobKey: legacyBlobKey(PACK, realOrder), lineNumbers: forged }]);
    expect(await awardedChoiceFromPrediction(PILOT, PACK, "3")).toBeNull();
  });

  it("still reads an old-key order once a signed-in pilot's forecast stored the same order under its new key", async () => {
    setUp(legacyBlobKey(PACK, realOrder), [
      { blobKey: legacyBlobKey(PACK, realOrder), lineNumbers: realOrder },
      { blobKey: blobKey(PACK, realOrder), lineNumbers: realOrder },
    ]);
    expect(await awardedChoiceFromPrediction(PILOT, PACK, "3")).toBe(1);
  });
});
