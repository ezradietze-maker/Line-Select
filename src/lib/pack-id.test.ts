import { afterEach, describe, expect, it, vi } from "vitest";
import { isPackId, legacyPackIdFor, moveGuestWorkToAccount, moveKeptUnderOldId, packIdFor, withCurrentPackId } from "@/lib/pack-id";
import type { BidPack } from "@/types/bidpack";

const meta = { base: "MEM", aircraft: "B777", seat: "CAP" as const, month: "OCT26" };
const pack = { ...meta, id: packIdFor(meta), bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [] } as unknown as BidPack;

function fakeStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("pack ids", () => {
  it("name the aircraft, so two fleets' packs at one base no longer share an id", () => {
    expect(packIdFor(meta)).toBe("uploaded-mem-b777-cap-oct26");
    expect(packIdFor({ ...meta, aircraft: "MD11" })).not.toBe(packIdFor(meta));
  });

  it("still recognise the id a pack had before, for what saved profiles and drafts carry", () => {
    expect(isPackId("uploaded-mem-cap-oct26", pack)).toBe(true);
    expect(isPackId(pack.id, pack)).toBe(true);
    expect(isPackId("uploaded-mem-cap-nov26", pack)).toBe(false);
    expect(isPackId(null, pack)).toBe(false);
  });

  it("give a pack saved under the older id its new one, and leave the sample alone", () => {
    expect(withCurrentPackId({ ...pack, id: legacyPackIdFor(meta) }).id).toBe("uploaded-mem-b777-cap-oct26");
    const sample = { ...pack, id: "sample-bidpack" };
    expect(withCurrentPackId(sample)).toBe(sample);
  });

  it("move what the device kept under the older id onto the new one", () => {
    const old = legacyPackIdFor(meta);
    const store = fakeStorage({
      [`line-select:line-marks:guest:${old}:v1`]: '{"starred":["line-1001"],"hidden":[]}',
      [`line-select:bid-deadline:${old}:v1`]: "2026-09-20T22:00:00Z",
      "line-select:pending-profile:guest:v1": JSON.stringify({ bidPackId: old, savedAt: 1 }),
      "line-select:theme:v1": "dark",
    });
    vi.stubGlobal("window", { localStorage: store });
    moveKeptUnderOldId(old, pack.id, null);
    expect(store.map.get(`line-select:line-marks:guest:${pack.id}:v1`)).toBe('{"starred":["line-1001"],"hidden":[]}');
    expect(store.map.has(`line-select:line-marks:guest:${old}:v1`)).toBe(false);
    expect(store.map.get(`line-select:bid-deadline:${pack.id}:v1`)).toBe("2026-09-20T22:00:00Z");
    expect(JSON.parse(store.map.get("line-select:pending-profile:guest:v1")!).bidPackId).toBe(pack.id);
    expect(store.map.get("line-select:theme:v1")).toBe("dark");
  });

  it("leave another pilot's keys for their own pack, which may be another fleet's", () => {
    const old = legacyPackIdFor(meta);
    const me = "11111111-1111-4111-8111-111111111111";
    const store = fakeStorage({
      [`line-select:line-marks:${me}:${old}:v1`]: "mine",
      [`line-select:line-marks:guest:${old}:v1`]: "the guest's",
      [`line-select:line-marks:22222222-2222-4222-8222-222222222222:${old}:v1`]: "someone else's",
    });
    vi.stubGlobal("window", { localStorage: store });
    moveKeptUnderOldId(old, pack.id, me);
    expect(store.map.get(`line-select:line-marks:${me}:${pack.id}:v1`)).toBe("mine");
    expect(store.map.get(`line-select:line-marks:guest:${old}:v1`)).toBe("the guest's");
    expect(store.map.has(`line-select:line-marks:22222222-2222-4222-8222-222222222222:${old}:v1`)).toBe(true);
  });
});

describe("a guest's work on the pack an account takes over", () => {
  const me = "11111111-1111-4111-8111-111111111111";

  it("moves to the account: stars, tiers, their own order, the sort, the carry-in and the finished interview", () => {
    const store = fakeStorage({
      [`line-select:line-marks:guest:${pack.id}:v1`]: '{"starred":["line-1001"],"hidden":["line-1040"]}',
      [`line-select:line-tiers:guest:${pack.id}:v1`]: "tiers",
      [`line-select:line-placements:guest:${pack.id}:v1`]: "swaps",
      [`line-select:line-sort:guest:${pack.id}:v1`]: "sort",
      [`line-select:carry-in:guest:${pack.id}:v1`]: "carry",
      [`line-select:brain-interview-done:guest:${pack.id}`]: "1",
      "line-select:line-marks:guest:uploaded-mem-md11-cap-oct26:v1": "another pack's",
      "line-select:contract-chat:guest:v1": "not the pack's",
    });
    vi.stubGlobal("window", { localStorage: store });
    moveGuestWorkToAccount(pack.id, me);
    expect(store.map.get(`line-select:line-marks:${me}:${pack.id}:v1`)).toBe('{"starred":["line-1001"],"hidden":["line-1040"]}');
    expect(store.map.get(`line-select:line-tiers:${me}:${pack.id}:v1`)).toBe("tiers");
    expect(store.map.get(`line-select:line-placements:${me}:${pack.id}:v1`)).toBe("swaps");
    expect(store.map.get(`line-select:line-sort:${me}:${pack.id}:v1`)).toBe("sort");
    expect(store.map.get(`line-select:carry-in:${me}:${pack.id}:v1`)).toBe("carry");
    expect(store.map.get(`line-select:brain-interview-done:${me}:${pack.id}`)).toBe("1");
    expect([...store.map.keys()].filter((k) => k.includes(`:guest:${pack.id}`))).toEqual([]);
    // Only that pack's, and only what's kept by pack.
    expect(store.map.get("line-select:line-marks:guest:uploaded-mem-md11-cap-oct26:v1")).toBe("another pack's");
    expect(store.map.get("line-select:contract-chat:guest:v1")).toBe("not the pack's");
  });

  it("leaves what the account already keeps for the pack as it is", () => {
    const store = fakeStorage({
      [`line-select:line-marks:guest:${pack.id}:v1`]: "the guest's",
      [`line-select:line-marks:${me}:${pack.id}:v1`]: "the account's",
    });
    vi.stubGlobal("window", { localStorage: store });
    moveGuestWorkToAccount(pack.id, me);
    expect(store.map.get(`line-select:line-marks:${me}:${pack.id}:v1`)).toBe("the account's");
  });

  it("keeps it the guest's when the browser refuses the copy", () => {
    const store = fakeStorage({ [`line-select:line-tiers:guest:${pack.id}:v1`]: "tiers" });
    vi.stubGlobal("window", {
      localStorage: {
        ...store,
        get length() {
          return store.map.size;
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    moveGuestWorkToAccount(pack.id, me);
    expect(store.map.get(`line-select:line-tiers:guest:${pack.id}:v1`)).toBe("tiers");
  });
});
