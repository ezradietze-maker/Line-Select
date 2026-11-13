import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/postgres", () => ({ db: {} }));

const { BLOB_KEY_V2_PREFIX, blobKey, legacyBlobKey } = await import("@/lib/server/forecast-store");

const PACK = "2026-12|mem|md11|cap";
const realOrder = Array.from({ length: 12 }, (_, i) => String(i + 1));
// Same count, same first and last line: only the middle is shuffled.
const forged = ["1", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "12"];

describe("where a pack's forecast rows are kept", () => {
  it("names the whole line order, so a shuffled middle is another key", () => {
    expect(blobKey(PACK, forged)).not.toBe(blobKey(PACK, realOrder));
    expect(blobKey(PACK, [...realOrder])).toBe(blobKey(PACK, realOrder));
    // Lines that would join up the same way as text are still told apart.
    expect(blobKey(PACK, ["1", "23"])).not.toBe(blobKey(PACK, ["12", "3"]));
    expect(blobKey(PACK, realOrder).startsWith(BLOB_KEY_V2_PREFIX)).toBe(true);
  });

  it("keeps the old key shape for rows written before, which the shuffled order shared", () => {
    expect(legacyBlobKey(PACK, forged)).toBe(legacyBlobKey(PACK, realOrder));
    expect(legacyBlobKey(PACK, realOrder)).toBe(`line-select:forecast:${PACK}:12:1-12`);
    expect(legacyBlobKey(PACK, realOrder).startsWith(BLOB_KEY_V2_PREFIX)).toBe(false);
  });
});
