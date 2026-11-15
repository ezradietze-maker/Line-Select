import { gunzipSync, gzipSync } from "node:zlib";
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

  it("keeps the guest's own upload beside the account's when both fit, for signing out or Continue as guest", async () => {
    const store = storageWithRoom(Infinity);
    store.map.set(GUEST_KEY, JSON.stringify(compactBidPack(SAMPLE_BID_PACK)));
    vi.stubGlobal("window", { localStorage: store });
    serveAccountPack();
    expect((await accountBidPack("u1")).pack?.id).toBe(accountPack.id);
    expect((await loadBidPack(null))?.id).toBe(SAMPLE_BID_PACK.id);
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
    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));
    expect(await accountBidPack("u1")).toEqual({ pack: null, saveFailed: false, noneOnAccount: true });
    expect(store.map.has(GUEST_KEY)).toBe(true);
  });

  it("doesn't ask again when the load already knows the server isn't answering", async () => {
    // A crawling connection: the session check gave up, and a second request here would hang the same way, holding
    // every screen on "Loading…".
    const store = storageWithRoom(Infinity);
    vi.stubGlobal("window", { localStorage: store });
    serveAccountPack();
    await accountBidPack("u1");
    const asked = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", asked);
    expect((await accountBidPack("u1", true)).pack?.id).toBe(accountPack.id);
    store.map.delete(ACCOUNT_KEY);
    expect(await accountBidPack("u1", true)).toEqual({ pack: null, saveFailed: false, noneOnAccount: false });
    expect(asked).not.toHaveBeenCalled();
  });

  it("never says the account has none when it couldn't ask", async () => {
    vi.stubGlobal("window", { localStorage: storageWithRoom(Infinity) });
    for (const answer of [async () => new Response("{}", { status: 500 }), async () => new Response("{}", { status: 401 }), async () => { throw new TypeError("offline"); }]) {
      vi.stubGlobal("fetch", answer);
      expect(await accountBidPack("u1")).toEqual({ pack: null, saveFailed: false, noneOnAccount: false });
    }
  });

  describe("a pack saved to the account before ids named the aircraft (Nov 6–7, 2026)", () => {
    const olderId = "uploaded-mem-fo-oct26";
    const savedThen = { ...accountPack, id: olderId };
    /** The account holding it under the older id; what's put back to it, kept. */
    function serveUnderOlderId() {
      const body = gzipSync(Buffer.from(JSON.stringify(compactBidPack(savedThen))));
      const puts: BidPack[] = [];
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          puts.push(JSON.parse(gunzipSync(Buffer.from(init.body as Uint8Array)).toString("utf8")));
          return new Response(JSON.stringify({ saved: true }), { status: 200 });
        }
        return url.includes("?meta") ? new Response(JSON.stringify({ packId: olderId, savedAt: new Date().toISOString() }), { status: 200 }) : new Response(body, { status: 200 });
      });
      return puts;
    }
    const settle = () => new Promise((r) => setTimeout(r, 20));

    it("is saved there again under its own id when this device holds it", async () => {
      const store = storageWithRoom(Infinity);
      // This device's copy, saved under the older id too, and moved to the new one when it loads.
      store.map.set(ACCOUNT_KEY, JSON.stringify(compactBidPack(savedThen)));
      store.map.set(`${ACCOUNT_KEY}:saved-at`, String(Date.now() - 60_000));
      vi.stubGlobal("window", { localStorage: store });
      const puts = serveUnderOlderId();
      const { pack } = await accountBidPack("u1");
      expect(pack?.id).toBe(accountPack.id);
      await settle();
      expect(puts.map((p) => p.id)).toEqual([accountPack.id]);
    });

    it("is saved there again under its own id when it's brought to a new device", async () => {
      vi.stubGlobal("window", { localStorage: storageWithRoom(Infinity) });
      const puts = serveUnderOlderId();
      expect((await accountBidPack("u1")).pack?.id).toBe(accountPack.id);
      await settle();
      expect(puts.map((p) => p.id)).toEqual([accountPack.id]);
    });

    it("isn't saved again once the account has it under its own id", async () => {
      vi.stubGlobal("window", { localStorage: storageWithRoom(Infinity) });
      const puts: unknown[] = [];
      serveAccountPack();
      const served = globalThis.fetch;
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => (init?.method === "PUT" ? (puts.push(init), new Response("{}")) : served(url, init)));
      await accountBidPack("u1");
      await accountBidPack("u1");
      await settle();
      expect(puts).toEqual([]);
    });
  });

  it("still asks where the browser can't unzip a pack: none is none, a pack it can't open isn't", async () => {
    vi.stubGlobal("window", { localStorage: storageWithRoom(Infinity) });
    vi.stubGlobal("DecompressionStream", undefined);
    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));
    expect(await accountBidPack("u1")).toEqual({ pack: null, saveFailed: false, noneOnAccount: true });
    serveAccountPack();
    expect(await accountBidPack("u1")).toEqual({ pack: null, saveFailed: false, noneOnAccount: false });
  });
});
