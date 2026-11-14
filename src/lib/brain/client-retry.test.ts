import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

async function load() {
  const listeners: Record<string, () => void> = {};
  vi.stubGlobal("window", { addEventListener: (e: string, f: () => void) => (listeners[e] = f) });
  vi.stubGlobal("navigator", { onLine: true });
  const client = await import("./client");
  const connection = await import("@/lib/connection");
  return { client, connection, listeners };
}

const body = { packBrief: "p", pilotContext: "c", exchanges: [], prior: null };
const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });

describe("interview requests on a bad connection", () => {
  it("wait for a dropped connection and go through once it's back", async () => {
    vi.useFakeTimers();
    let online = false;
    const fetch = vi.fn(async (url: string) => {
      if (url === "/api/ping") {
        if (!online) throw new TypeError("Failed to fetch");
        return new Response(null, { status: 204 });
      }
      if (!online) throw new TypeError("Failed to fetch");
      return ok({ model: { version: 2, criteria: [] } });
    });
    vi.stubGlobal("fetch", fetch);
    const { client, connection } = await load();
    const pending = client.requestModelBuild(body as never);
    await vi.advanceTimersByTimeAsync(10);
    expect(connection.isOffline()).toBe(true);
    online = true;
    await vi.advanceTimersByTimeAsync(5_100); // the next connection check
    await expect(pending).resolves.toEqual({ version: 2, criteria: [] });
    expect(connection.isOffline()).toBe(false);
  });

  it("still give up, plainly, when the connection never comes back", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const { client } = await load();
    const pending = client.requestModelBuild(body as never).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000 + 1000);
    expect(await pending).toBe("Couldn’t reach Line Select. Check your connection and try again.");
  });

  it("keep a slow answer a timeout, not a lost connection", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))));
    const { client, connection } = await load();
    const pending = client.requestModelBuild(body as never).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(291_000);
    expect(await pending).toBe("That took too long to come back. Try again.");
    expect(connection.isOffline()).toBe(false);
  });
});

describe("a read asked for from the priorities page after a long interview", () => {
  it("goes within the routes' limit, with the interview's answers and the newest edit in it", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return ok({ model: { version: 2, criteria: [] } });
      })
    );
    const { client } = await load();
    const { readExchanges } = await import("@/lib/server/brain-input");
    const interview = Array.from({ length: 45 }, (_, i) => ({ turn: i, question: `Question ${i}`, answer: `Answer ${i}` }));
    // Each level tapped on the priorities page is written into the record.
    const edits = Array.from({ length: 40 }, (_, i) => ({ turn: 45 + i, question: `Your priorities: how much does "Days off" matter?`, answer: i % 2 ? "Top priority." : "High priority." }));
    const added = { turn: 85, question: "Something to add about how you bid (from your priorities page):", answer: "Weekends off matter more now." };
    await client.requestModelBuild({ ...body, exchanges: [...interview, ...edits, added] } as never);
    const exchanges = readExchanges((sent[0] as { exchanges: unknown }).exchanges);
    expect(exchanges).not.toBeNull();
    expect(exchanges!.slice(0, 45)).toEqual(interview);
    expect(exchanges!.at(-1)).toEqual(added);
  });
});
