import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// The local-file store, in a folder of its own: never Redis, never this checkout's .data.
const dir = mkdtempSync(path.join(tmpdir(), "kv-local-"));
vi.spyOn(process, "cwd").mockReturnValue(dir);
vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
vi.stubEnv("KV_REST_API_URL", "");
const { addToCounter, deleteKey, getJson, incrementCounter, releaseSlot, takeLock, takeSlot } = await import("./kv");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the local-file store", () => {
  it("counts", async () => {
    expect(await incrementCounter("count", 60)).toBe(1);
    expect(await incrementCounter("count", 60)).toBe(2);
    expect(await addToCounter("total", 500, 60)).toBe(500);
    expect(await addToCounter("total", -200, 60)).toBe(300);
  });

  it("gives places in flight up to the limit and takes them back", async () => {
    expect(await takeSlot("slot", 2, 60)).toBe(true);
    expect(await takeSlot("slot", 2, 60)).toBe(true);
    expect(await takeSlot("slot", 2, 60)).toBe(false);
    await releaseSlot("slot");
    expect(await getJson("slot")).toBe(1);
    await releaseSlot("slot");
    expect(await getJson("slot")).toBeNull();
    await releaseSlot("slot");
    expect(await getJson("slot")).toBeNull();
  });

  it("takes a lock once until it's let go", async () => {
    expect(await takeLock("lock", 60)).toBe(true);
    expect(await takeLock("lock", 60)).toBe(false);
    await deleteKey("lock");
    expect(await takeLock("lock", 60)).toBe(true);
  });
});
