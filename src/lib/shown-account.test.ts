import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * A tab says which account its screen is for with every call to the server, so a save from a tab left open on pilot A
 * after pilot B signed in elsewhere is refused instead of landing in B's account (`getCurrentServerUser`). The network
 * and the window are stand-ins.
 */
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HEADER = "x-line-select-account";

const listeners = vi.hoisted(() => new Map<string, Set<() => void>>());
const on = (type: string, fn: () => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn);
const off = (type: string, fn: () => void) => void listeners.get(type)?.delete(fn);
const fire = (type: string, event: unknown = {}) => [...(listeners.get(type) ?? [])].forEach((fn) => (fn as (e: unknown) => void)(event));
vi.stubGlobal("window", { addEventListener: on, removeEventListener: off, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
vi.stubGlobal("document", { visibilityState: "visible", addEventListener: on, removeEventListener: off });

const { onAccountRefused, onSignedInElsewhere, setShownAccount } = await import("@/lib/shown-account");
const { saveServerProfile } = await import("@/lib/preference-profile-client");
const { saveServerDraft } = await import("@/lib/interview-draft-sync");
const { clearServerBidPack } = await import("@/lib/bidpack-server");
const { saveTradeHolding } = await import("@/lib/trades/holding-client");

const sent: { url: string; account: string | null }[] = [];
let status = 200;

beforeEach(() => {
  sent.length = 0;
  status = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      sent.push({ url, account: headers[HEADER] ?? null });
      return new Response(JSON.stringify({ updatedAt: "v2", holding: {} }), { status });
    })
  );
});
afterEach(() => vi.useRealTimers());

describe("which account a call is for", () => {
  it("is the one the tab shows, a guest's included", async () => {
    setShownAccount(A);
    await clearServerBidPack();
    await saveTradeHolding({ packId: "p", lineNumber: "1" } as never);
    setShownAccount(null);
    await clearServerBidPack();
    expect(sent.map((s) => s.account)).toEqual([A, A, "guest"]);
  });

  it("is the account a profile save was made for, even when the tab shows another by the time it goes up", async () => {
    setShownAccount(B);
    await saveServerProfile({ completedAt: "x" } as PreferenceProfile, A);
    expect(sent).toEqual([{ url: "/api/preference-profile", account: A }]);
  });

  it("is the account an interview answer was given for, when the tab moved on before it was sent", async () => {
    vi.useFakeTimers();
    setShownAccount(A);
    saveServerDraft("pack-1", { answers: ["A's answer"] });
    // Another tab signed in as B, and this one caught up before the save's timer ran.
    setShownAccount(B);
    await vi.runAllTimersAsync();
    expect(sent).toEqual([{ url: "/api/interview-draft", account: A }]);
  });

  it("a refusal tells the app to ask who's signed in", async () => {
    const heard = vi.fn();
    const stop = onAccountRefused(heard);
    setShownAccount(A);
    status = 401;
    await clearServerBidPack();
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    await clearServerBidPack();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("another tab signing in or out", () => {
  it("is heard at once, and by a tab the browser put to sleep when it's looked at again", () => {
    let device: string | null | undefined = A;
    const changed = vi.fn();
    const stop = onSignedInElsewhere(A, () => device, changed);
    fire("storage", { key: "line-select:last-user:v1" });
    expect(changed).not.toHaveBeenCalled();
    device = B;
    fire("storage", { key: "line-select:last-user:v1" });
    expect(changed).toHaveBeenCalledTimes(1);
    fire("focus");
    fire("pageshow");
    fire("visibilitychange");
    expect(changed).toHaveBeenCalledTimes(4);
    // Signed out there: this tab still shows A.
    device = null;
    fire("focus");
    expect(changed).toHaveBeenCalledTimes(5);
    // Nothing known on the device (storage blocked): the server's refusal is what tells it.
    device = undefined;
    fire("focus");
    expect(changed).toHaveBeenCalledTimes(5);
    stop();
    device = B;
    fire("focus");
    expect(changed).toHaveBeenCalledTimes(5);
  });
});

/**
 * The browser's calls to this app's server go through `apiFetch`, so each says which account it's for. A bare `fetch`
 * from a screen would go up with whoever's cookie the browser holds now. Only these may: asking who's signed in, and
 * signing in or out, are how a tab finds out (`auth.ts`); a ping and a crash report carry nothing of an account's; the
 * weather is another site.
 */
const BARE_FETCH_ALLOWED = ["src/lib/auth.ts", "src/lib/connection.ts", "src/lib/client-error-report.ts", "src/lib/weather-client.ts", "src/lib/shown-account.ts"];

function browserFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name);
    if (d.isDirectory()) return path.endsWith(join("src", "app", "api")) || path.endsWith(join("src", "lib", "server")) ? [] : browserFiles(path);
    return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [path] : [];
  });
}

describe("calls to the app's server", () => {
  it("all say which account they're for", () => {
    const root = process.cwd();
    const bare = browserFiles(join(root, "src")).flatMap((file) => {
      const name = relative(root, file);
      if (BARE_FETCH_ALLOWED.includes(name)) return [];
      return readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ line, at: `${name}:${i + 1}` }))
        .filter(({ line }) => !/^\s*(\/\/|\*)/.test(line) && /(^|[^\w.])fetch\(/.test(line))
        .map(({ at }) => at);
    });
    expect(bare).toEqual([]);
  });
});
