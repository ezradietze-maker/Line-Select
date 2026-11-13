import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadBidPack, saveBidPack } from "./bidpack-storage";
import { forgetPilotOnDevice, forgetPilotWork } from "./device-data";
import { SAMPLE_BID_PACK } from "./sample-bidpack";

function fakeStorage() {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (i: number) => [...items.keys()][i] ?? null,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
}

describe("signing out on a shared computer", () => {
  let store: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    store = fakeStorage();
    vi.stubGlobal("window", { localStorage: store });
  });

  it("removes that pilot's contract chat and leaves everyone else's", () => {
    store.setItem("line-select:contract-chat:pilot-1:v1", "[{}]");
    store.setItem("line-select:contract-chat:pilot-2:v1", "[{}]");
    forgetPilotOnDevice("pilot-1");
    expect(store.getItem("line-select:contract-chat:pilot-1:v1")).toBeNull();
    expect(store.getItem("line-select:contract-chat:pilot-2:v1")).toBe("[{}]");
  });

  it("removes what was kept under no id: the employee number, home airport and flights", () => {
    store.setItem("line-select:vips-employee-number:v1", "123456");
    store.setItem("line-select:commute-settings:v1", "{}");
    store.setItem("line-select:flights:v5:abc", "{}");
    store.setItem("line-select:theme:v1", "dark");
    forgetPilotOnDevice("pilot-1");
    expect(store.getItem("line-select:vips-employee-number:v1")).toBeNull();
    expect(store.getItem("line-select:commute-settings:v1")).toBeNull();
    expect(store.getItem("line-select:flights:v5:abc")).toBeNull();
    expect(store.getItem("line-select:theme:v1")).toBe("dark");
  });

  it("removes what they did as a guest before signing in, and the feed sent, but keeps the guest's pack", () => {
    for (const k of ["line-select:seniority:guest:v1", "line-select:preference-profile:guest:v1", "line-select:contract-chat:guest:v1", "line-select:brain-interview:guest:pack-1:v1", "line-select:calendar-feed-sent:v1", "line-select:bidpack:guest:v1"]) store.setItem(k, "x");
    forgetPilotOnDevice("pilot-1");
    expect([...Array(store.length).keys()].map((i) => store.key(i))).toEqual(["line-select:bidpack:guest:v1"]);
  });

  it("keeps a pack save still compressing from writing it back after sign-out", async () => {
    const saving = saveBidPack("pilot-1", SAMPLE_BID_PACK);
    forgetPilotOnDevice("pilot-1");
    await saving;
    expect(await loadBidPack("pilot-1")).toBeNull();
  });
});

describe("starting over from scratch", () => {
  let store: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    store = fakeStorage();
    vi.stubGlobal("window", { localStorage: store });
  });
  const keys = () => [...Array(store.length).keys()].map((i) => store.key(i)).sort();

  it("removes the pilot's bidding for every pack, so the same month's pack uploaded again brings none of it back", () => {
    for (const k of [
      "line-select:line-marks:pilot-1:pack-a:v1",
      "line-select:line-tiers:pilot-1:pack-a:v1",
      "line-select:line-tiers:pilot-1:pack-b:v1",
      "line-select:seniority:pilot-1:v1",
      "line-select:top-lines:pilot-1:v2",
      "line-select:bid-period-history:pilot-1:v1",
      "line-select:commute-settings:v1",
    ])
      store.setItem(k, "x");
    forgetPilotWork("pilot-1");
    expect(keys()).toEqual([]);
  });

  it("keeps the sign-in, the contract chat, other pilots' and the guest's own", () => {
    for (const k of ["line-select:signed-in-hint:v1", "line-select:last-user:v1", "line-select:contract-chat:pilot-1:v1", "line-select:line-tiers:pilot-2:pack-a:v1", "line-select:seniority:guest:v1"]) store.setItem(k, "x");
    forgetPilotWork("pilot-1");
    expect(keys()).toEqual(["line-select:contract-chat:pilot-1:v1", "line-select:last-user:v1", "line-select:line-tiers:pilot-2:pack-a:v1", "line-select:seniority:guest:v1", "line-select:signed-in-hint:v1"]);
  });

  it("for a guest, removes the guest's own and their pack", () => {
    for (const k of ["line-select:bidpack:guest:v1", "line-select:line-marks:guest:pack-a:v1", "line-select:seniority:guest:v1", "line-select:seniority:pilot-1:v1"]) store.setItem(k, "x");
    forgetPilotWork(null);
    expect(keys()).toEqual(["line-select:seniority:pilot-1:v1"]);
  });
});
