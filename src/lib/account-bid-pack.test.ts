import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountBidPack } from "@/lib/account-bid-pack";
import { compactBidPack, loadBidPack } from "@/lib/bidpack-storage";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { BidPack } from "@/types/bidpack";

const GUEST_KEY = "line-select:bidpack:guest:v1";
const ACCOUNT_KEY = "line-select:bidpack:u1:v1";

/** A browser's storage with one room for everything in it, as a real one has: a write that doesn't fit is refused. */
function storageWithRoom(room: number) {
  const map = new Map<string, string>();
  const used = () => [...map].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (used() - (map.get(k)?.length ?? 0) + k.length + v.length > room) throw new DOMException("quota", "QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
  };
}

/** The account's own pack: a different month's than the guest's. */
const accountPack: BidPack = { ...SAMPLE_BID_PACK, id: "uploaded-mem-b777-fo-oct26", base: "MEM", aircraft: "B777", seat: "FO", month: "OCT26" };

function serveAccountPack() {
  const body = gzipSync(Buffer.from(JSON.stringify(compactBidPack(accountPack))));
  vi.stubGlobal("fetch", async (url: string) =>
    url.includes("?meta")
      ? new Response(JSON.stringify({ packId: accountPack.id, savedAt: new Date().toISOString() }), { status: 200 })
      : new Response(body, { status: 200 })
  );
}

describe("a signed-in pilot's pack on a device a guest's pack is still on", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("keeps the account's pack, clearing the guest's that left no room for it", async () => {
    // The guest's pack saved before packs were gzipped, taking most of the room: the account's own doesn't fit beside it.
    const guest = JSON.stringify(SAMPLE_BID_PACK);
    const room = guest.length + GUEST_KEY.length + 100;
    const store = storageWithRoom(room);
    store.map.set(GUEST_KEY, guest);
    vi.stubGlobal("window", { localStorage: store });
    serveAccountPack();

    const first = await accountBidPack("u1");
    expect(first.pack?.id).toBe(accountPack.id);
    expect(first.saveFailed).toBe(false);
    expect(store.map.has(GUEST_KEY)).toBe(false);
    expect(store.map.get(ACCOUNT_KEY)?.startsWith("gz1:")).toBe(true);

    // The next load with no signal still has it, from this device.
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    const offline = await accountBidPack("u1");
    expect(offline.pack?.id).toBe(accountPack.id);
    expect((await loadBidPack("u1"))?.lines).toHaveLength(accountPack.lines.length);
  });

  it("says so when the browser won't keep the account's pack at all", async () => {
    vi.stubGlobal("window", { localStorage: storageWithRoom(100) });
    serveAccountPack();
    const result = await accountBidPack("u1");
    expect(result.pack?.id).toBe(accountPack.id);
    expect(result.saveFailed).toBe(true);
  });

  it("leaves the guest's pack alone when the account has none to bring", async () => {
    const store = storageWithRoom(Infinity);
    store.map.set(GUEST_KEY, JSON.stringify(compactBidPack(SAMPLE_BID_PACK)));
    vi.stubGlobal("window", { localStorage: store });
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
    expect(await accountBidPack("u1")).toEqual({ pack: null, saveFailed: false });
    expect(store.map.has(GUEST_KEY)).toBe(true);
  });
});
