import { afterEach, describe, expect, it, vi } from "vitest";
import { saveServerProfile, setServerProfileVersion } from "@/lib/preference-profile-client";
import type { PreferenceProfile } from "@/types/preferences";

describe("saving the profile from one tab", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends two quick saves one after the other, the second with the version the first got back", async () => {
    setServerProfileVersion("v1");
    const sent: (string | null)[] = [];
    let version = 1;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const { baseUpdatedAt } = JSON.parse(String(init.body)) as { baseUpdatedAt: string | null };
        sent.push(baseUpdatedAt);
        await new Promise((r) => setTimeout(r, 5));
        if (baseUpdatedAt !== `v${version}`) return new Response(JSON.stringify({ updatedAt: `v${version}` }), { status: 409 });
        version++;
        return new Response(JSON.stringify({ updatedAt: `v${version}` }), { status: 200 });
      })
    );
    const [a, b] = await Promise.all([saveServerProfile({ completedAt: "a" } as PreferenceProfile), saveServerProfile({ completedAt: "b" } as PreferenceProfile)]);
    expect([a.kind, b.kind]).toEqual(["saved", "saved"]);
    expect(sent).toEqual(["v1", "v2"]);
  });
});
