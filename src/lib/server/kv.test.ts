import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A fake Upstash client: no network. Its scripts are run by what they're for (the real ones are Lua, run by Redis), and
 * it keeps each key's end, so a test can see whether a counter would ever reset. EXPIRE and INCR on their own throw, as
 * a lost request would: nothing here may rely on a second round trip.
 */
const fake = vi.hoisted(() => {
  const values = new Map<string, number>();
  const ends = new Map<string, number>();
  const calls: string[] = [];
  const ttl = (k: string) => (!values.has(k) ? -2 : (ends.get(k) ?? -1));
  return { values, ends, calls, ttl };
});
vi.mock("@upstash/redis", () => ({
  Redis: class {
    async eval(script: string, keys: string[], args: number[]) {
      fake.calls.push("eval");
      const [k] = keys;
      if (script.includes("INCRBY")) {
        expect(script).toContain("TTL");
        const n = (fake.values.get(k) ?? 0) + Number(args[0]);
        fake.values.set(k, n);
        if (fake.ttl(k) === -1) fake.ends.set(k, Number(args[1]));
        return n;
      }
      if (script.includes("EXISTS")) {
        if (!fake.values.has(k)) return 0;
        const n = fake.values.get(k)! - 1;
        if (n <= 0) {
          fake.values.delete(k);
          fake.ends.delete(k);
        } else fake.values.set(k, n);
        return n;
      }
      const n = (fake.values.get(k) ?? 0) + 1;
      if (n > Number(args[0])) {
        if (fake.ttl(k) === -1) fake.ends.set(k, Number(args[1]));
        return 0;
      }
      fake.values.set(k, n);
      fake.ends.set(k, Number(args[1]));
      return 1;
    }
    async incr() {
      throw new Error("a second round trip");
    }
    async incrby() {
      throw new Error("a second round trip");
    }
    async expire() {
      throw new Error("fetch failed");
    }
    async set(k: string, v: number, o?: { nx?: boolean; ex?: number }) {
      fake.calls.push("set");
      if (o?.nx && fake.values.has(k)) return null;
      fake.values.set(k, v);
      if (o?.ex) fake.ends.set(k, o.ex);
      return "OK";
    }
    async get(k: string) {
      return fake.values.get(k) ?? null;
    }
    async del(k: string) {
      fake.calls.push("del");
      fake.values.delete(k);
      fake.ends.delete(k);
      return 1;
    }
  },
}));

vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake");
const { addToCounter, deleteKey, incrementCounter, releaseSlot, takeLock, takeSlot } = await import("./kv");

beforeEach(() => {
  fake.values.clear();
  fake.ends.clear();
  fake.calls.length = 0;
});

describe("counters on Redis", () => {
  it("count and get their end in one round trip", async () => {
    const key = "line-select:attempts:login:all:pilot@example.com";
    expect(await incrementCounter(key, 900)).toBe(1);
    expect(await incrementCounter(key, 900)).toBe(2);
    expect(fake.calls).toEqual(["eval", "eval"]);
    expect(fake.ends.get(key)).toBe(900);
  });

  it("give a counter left with no end one the next time it's touched", async () => {
    const key = "line-select:attempts:login:all:victim@example.com";
    // As the old INCR-then-EXPIRE left it when the EXPIRE was lost.
    fake.values.set(key, 61);
    expect(await incrementCounter(key, 900)).toBe(62);
    expect(fake.ends.get(key)).toBe(900);
  });

  it("don't push a counter's end out as it counts, so a window still closes", async () => {
    const key = "line-select:rate:x";
    await incrementCounter(key, 900);
    fake.ends.set(key, 12); // twelve seconds left
    await incrementCounter(key, 900);
    expect(fake.ends.get(key)).toBe(12);
  });

  it("add whole amounts, taking away too, with the same end", async () => {
    const key = "line-select:spend:site:2026-11-12";
    expect(await addToCounter(key, 300_000, 93_600)).toBe(300_000);
    expect(await addToCounter(key, -120_000, 93_600)).toBe(180_000);
    expect(fake.ends.get(key)).toBe(93_600);
    expect(fake.calls).toEqual(["eval", "eval"]);
  });
});

describe("places in flight on Redis", () => {
  it("are given up to the limit, each pushing the end out, and given back", async () => {
    const key = "line-select:spend:in-flight:u:1";
    expect(await takeSlot(key, 2, 360)).toBe(true);
    fake.ends.set(key, 100);
    expect(await takeSlot(key, 2, 360)).toBe(true);
    expect(fake.ends.get(key)).toBe(360);
    fake.ends.set(key, 100);
    expect(await takeSlot(key, 2, 360)).toBe(false);
    // A refused try doesn't keep a stranded place alive.
    expect(fake.ends.get(key)).toBe(100);
    expect(fake.values.get(key)).toBe(2);
    await releaseSlot(key);
    expect(await takeSlot(key, 2, 360)).toBe(true);
    await releaseSlot(key);
    await releaseSlot(key);
    expect(fake.values.has(key)).toBe(false);
  });

  it("aren't made again below zero once the key has run out", async () => {
    await releaseSlot("line-select:spend:in-flight:gone");
    expect(fake.values.has("line-select:spend:in-flight:gone")).toBe(false);
  });
});

describe("locks on Redis", () => {
  it("are taken with their end in one SET NX EX, and let go", async () => {
    expect(await takeLock("line-select:lock:hotel", 60)).toBe(true);
    expect(await takeLock("line-select:lock:hotel", 60)).toBe(false);
    expect(fake.ends.get("line-select:lock:hotel")).toBe(60);
    await deleteKey("line-select:lock:hotel");
    expect(await takeLock("line-select:lock:hotel", 60)).toBe(true);
    expect(fake.calls).toEqual(["set", "set", "del", "set"]);
  });
});
