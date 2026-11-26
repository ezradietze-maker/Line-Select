import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepStorage, resetKeepStorageForTests } from "@/lib/persistent-storage";

function withStorage(storage: unknown) {
  vi.stubGlobal("navigator", { storage });
}

describe("keepStorage", () => {
  beforeEach(() => resetKeepStorageForTests());
  afterEach(() => vi.unstubAllGlobals());

  it("asks the browser to keep the site's storage", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    withStorage({ persisted: vi.fn().mockResolvedValue(false), persist });
    expect(await keepStorage()).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("doesn't ask again once the browser already keeps it", async () => {
    const persist = vi.fn();
    withStorage({ persisted: vi.fn().mockResolvedValue(true), persist });
    expect(await keepStorage()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it("asks once a page load, however many packs are saved", async () => {
    const persist = vi.fn().mockResolvedValue(false);
    withStorage({ persisted: vi.fn().mockResolvedValue(false), persist });
    await Promise.all([keepStorage(), keepStorage()]);
    expect(await keepStorage()).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("is a quiet no where the browser can't keep storage, or refuses", async () => {
    withStorage(undefined);
    expect(await keepStorage()).toBe(false);
    resetKeepStorageForTests();
    withStorage({ persist: vi.fn().mockRejectedValue(new Error("denied")) });
    expect(await keepStorage()).toBe(false);
  });
});
