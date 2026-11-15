import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The speech service's client against stand-ins for the browser's mic, sound and connection: nothing real is opened,
 * and the service is never called.
 */
vi.mock("@/lib/shown-account", () => ({
  apiFetch: async () => new Response(JSON.stringify({ token: "pass-token", socket: "wss://speech.example.test/ws", model: "m", maxSeconds: 900 }), { status: 200 }),
}));

const browser = vi.hoisted(() => ({ sourceFails: false, contexts: [] as { closed: boolean }[], sockets: [] as FakeSocketLike[], streams: [] as FakeStreamLike[] }));
interface FakeSocketLike {
  url: string;
  readyState: number;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
  begin(): void;
}
interface FakeStreamLike {
  tracks: FakeTrack[];
}

class FakeTrack {
  stopped = false;
  private ended: (() => void)[] = [];
  stop() {
    this.stopped = true;
  }
  addEventListener(type: string, fn: () => void) {
    if (type === "ended") this.ended.push(fn);
  }
  removeEventListener() {}
  /** The headset unplugged, or the mic taken away mid-session. */
  unplug() {
    for (const fn of this.ended) fn();
  }
}

class FakeAudioContext {
  sampleRate = 48000;
  closed = false;
  destination = {};
  constructor() {
    browser.contexts.push(this);
  }
  get audioWorklet() {
    return { addModule: async () => {} };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  createMediaStreamSource() {
    // Firefox, when the mic's sample rate isn't the sound's: "Connecting AudioNodes from AudioContexts with different sample-rate is currently not supported."
    if (browser.sourceFails) throw new DOMException("different sample-rate", "NotSupportedError");
    return { connect() {} };
  }
  createGain() {
    return { gain: { value: 1 }, connect() {} };
  }
}

class FakeWorkletNode {
  port = { onmessage: null as unknown };
  connect() {}
}

class FakeSocket implements FakeSocketLike {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 0;
  binaryType = "";
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: unknown[] = [];
  constructor(public url: string) {
    browser.sockets.push(this);
  }
  send(d: unknown) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  begin() {
    this.readyState = 1;
    this.onmessage?.({ data: JSON.stringify({ type: "Begin" }) });
  }
}

beforeEach(() => {
  browser.sourceFails = false;
  browser.contexts.length = 0;
  browser.sockets.length = 0;
  browser.streams.length = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", { AudioContext: FakeAudioContext, WebSocket: FakeSocket });
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => {
        const stream = { tracks: [new FakeTrack()], getTracks: () => stream.tracks };
        browser.streams.push(stream);
        return stream;
      },
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const { startServiceDictation } = await import("./service-dictation");

/** Starts a session and lets the service answer "Begin". */
async function started(onEnd: (reason: string) => void = () => {}) {
  const session = startServiceDictation({ keyterms: ["hub turn", "MEM"], onHeard: () => {}, onEnd });
  await vi.waitFor(() => expect(browser.sockets).toHaveLength(1));
  browser.sockets[0].begin();
  return session;
}

describe("startServiceDictation", () => {
  it("lets go of the mic when the sound can't be wired up", async () => {
    // Before, this failure came after the mic was granted and outside the clean-up: the mic stayed on (the browser's
    // red dot) with the pilot told voice input had stopped working. Firefox has no speech engine of its own to fall to.
    browser.sourceFails = true;
    await expect(startServiceDictation({ keyterms: [], onHeard: () => {}, onEnd: () => {} })).rejects.toThrow();
    expect(browser.streams[0].tracks.every((t) => t.stopped)).toBe(true);
    expect(browser.contexts[0].closed).toBe(true);
  });

  it("ends the session as soon as the mic is unplugged, not after the quiet spell", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
    const ends: string[] = [];
    await started((r) => ends.push(r));
    browser.streams[0].tracks[0].unplug();
    // Before, nothing listened: the connection stayed open (billed by the minute) with no sound in it, and the pilot
    // talked on for 30 seconds into nothing before being told the mic went quiet.
    expect(ends).toEqual(["mic"]);
    expect(browser.contexts[0].closed).toBe(true);
  });

  it("sends the pilot's word list, and asks the service to close a connection that goes silent", async () => {
    await started();
    const url = new URL(browser.sockets[0].url);
    expect(JSON.parse(url.searchParams.get("keyterms_prompt") ?? "[]")).toEqual(["hub turn", "MEM"]);
    // A locked phone stops the page — and its watch on the time — but not the connection, which is billed while it's
    // open: the service itself closes one no sound has come down for a minute.
    expect(Number(url.searchParams.get("inactivity_timeout"))).toBe(60);
  });
});
