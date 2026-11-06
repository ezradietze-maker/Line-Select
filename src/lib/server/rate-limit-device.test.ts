import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, number>();
vi.mock("@/lib/server/kv", () => ({
  incrementCounter: async (key: string) => {
    const next = (store.get(key) ?? 0) + 1;
    store.set(key, next);
    return next;
  },
  setJson: async () => {},
}));

const { ADDRESS_FACTOR, checkRequestLimit, deviceIdFrom } = await import("./rate-limit");

const CREW_ROOM = "203.0.113.50";
const deviceId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request = (ip: string, device?: string) => new Request("https://example.com/api/x", { headers: { "x-forwarded-for": ip, ...(device ? { cookie: `ls_device=${device}` } : {}) } });

beforeEach(() => store.clear());

describe("limits per device", () => {
  it("reads only a well-formed device id", () => {
    expect(deviceIdFrom(request(CREW_ROOM, deviceId(1)))).toBe(deviceId(1));
    expect(deviceIdFrom(request(CREW_ROOM, "not-a-uuid"))).toBeNull();
    expect(deviceIdFrom(request(CREW_ROOM))).toBeNull();
  });

  it("lets five pilots on one crew room's Wi-Fi each use the full limit", async () => {
    const limit = 3;
    for (let pilot = 1; pilot <= ADDRESS_FACTOR; pilot++) {
      for (let i = 0; i < limit; i++) expect((await checkRequestLimit("brain-question", request(CREW_ROOM, deviceId(pilot)), limit, 3600)).ok).toBe(true);
    }
    // One pilot past their own limit is stopped, even though the address has none left either.
    expect((await checkRequestLimit("brain-question", request(CREW_ROOM, deviceId(1)), limit, 3600)).ok).toBe(false);
    // On another address, the same limit starts fresh.
    expect((await checkRequestLimit("brain-question", request("198.51.100.20", deviceId(99)), limit, 3600)).ok).toBe(true);
  });

  it("stops a device that keeps changing its id at the address ceiling", async () => {
    const limit = 2;
    let allowed = 0;
    for (let n = 0; n < 50; n++) if ((await checkRequestLimit("brain-build", request(CREW_ROOM, deviceId(100 + n)), limit, 3600)).ok) allowed++;
    expect(allowed).toBe(limit * ADDRESS_FACTOR);
  });

  it("counts a request with no device cookie against its address at the plain limit", async () => {
    for (let i = 0; i < 2; i++) expect((await checkRequestLimit("hotels", request("198.51.100.9"), 2, 3600)).ok).toBe(true);
    expect((await checkRequestLimit("hotels", request("198.51.100.9"), 2, 3600)).ok).toBe(false);
  });
});
