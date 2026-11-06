import { describe, expect, it, vi } from "vitest";
import type { PreferenceProfile } from "@/types/preferences";

const store = new Map<string, unknown>();
vi.mock("@/lib/server/kv", () => ({
  getJson: async (key: string) => store.get(key) ?? null,
  setJson: async (key: string, value: unknown) => void store.set(key, value),
  incrementCounter: async (key: string) => {
    const next = ((store.get(key) as number) ?? 0) + 1;
    store.set(key, next);
    return next;
  },
}));

const { VERSIONS, keepReplacedVersion, listKeptVersions } = await import("./profile-history");

describe("profile history", () => {
  it("keeps the last five replaced versions, newest first", async () => {
    for (let i = 1; i <= 7; i++) {
      await keepReplacedVersion("pilot-1", { profile: { completedAt: `v${i}` } as PreferenceProfile, updatedAt: `2026-11-0${i}T00:00:00Z` }, new Date(`2026-11-0${i}T01:00:00Z`));
    }
    const kept = await listKeptVersions("pilot-1");
    expect(kept).toHaveLength(VERSIONS);
    expect(kept.map((v) => v.profile.completedAt)).toEqual(["v7", "v6", "v5", "v4", "v3"]);
    expect(await listKeptVersions("pilot-2")).toEqual([]);
  });
});
