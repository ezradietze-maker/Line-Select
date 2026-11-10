import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetPilotOnDevice } from "./device-data";

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
});
