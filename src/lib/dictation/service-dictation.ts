"use client";

import { serviceText, type Heard, type Turn } from "@/lib/dictation/assemble";

/**
 * Dictation through the speech service (AssemblyAI's live transcription): the mic's sound goes straight from the
 * browser to the service over a connection opened with a one-minute pass from `/api/dictation-token`, along with the
 * pilot's word list (`dictationWords`), and the words come back as they're spoken. Nothing is kept: this app stores
 * neither the sound nor anything the service sends, beyond the words that land in the answer box.
 *
 * `startServiceDictation` must be called straight from the tap on the mic — browsers only let sound start from a tap,
 * and the very first thing it does is start it. It rejects with `DictationUnavailable` when the service can't be
 * reached (no key on the server, offline, too many people dictating at once), so the caller can fall back to the
 * browser's own speech engine; with any other error (the mic blocked) there's nothing to fall back to.
 */

export class DictationUnavailable extends Error {}

export type EndReason = "stopped" | "quiet" | "limit" | "lost";

export interface ServiceSession {
  stop(): void;
}

interface Pass {
  token: string;
  socket: string;
  model: string;
  maxSeconds: number;
}

/** No new words for this long and the mic switches itself off — an open mic left on a tray costs money. */
const QUIET_MS = 30_000;
/** How long to wait for the connection to open before giving up on the service. */
const OPEN_TIMEOUT_MS = 8_000;
/** Sound held while the connection opens, so the first words aren't lost — no more than this. */
const MAX_HELD_CHUNKS = 30;

export function serviceDictationPossible(): boolean {
  if (typeof window === "undefined") return false;
  return !!(typeof navigator.mediaDevices?.getUserMedia === "function" && window.AudioContext && window.WebSocket && "audioWorklet" in AudioContext.prototype);
}

async function fetchPass(): Promise<Pass> {
  let res: Response;
  try {
    res = await fetch("/api/dictation-token", { method: "POST", cache: "no-store" });
  } catch {
    throw new DictationUnavailable("offline");
  }
  if (!res.ok) throw new DictationUnavailable(`pass ${res.status}`);
  const pass = (await res.json()) as Partial<Pass>;
  if (!pass.token || !pass.socket || !pass.model) throw new DictationUnavailable("bad pass");
  return { token: pass.token, socket: pass.socket, model: pass.model, maxSeconds: pass.maxSeconds ?? 900 };
}

export async function startServiceDictation(opts: {
  keyterms: string[];
  onHeard: (heard: Heard) => void;
  onEnd: (reason: EndReason) => void;
}): Promise<ServiceSession> {
  if (!serviceDictationPossible()) throw new DictationUnavailable("browser");
  // First, while still inside the tap: browsers (iPhone Safari above all) only start sound from a tap.
  const audio = new AudioContext();
  void audio.resume();

  let stream: MediaStream | null = null;
  let socket: WebSocket | null = null;
  const cleanup = () => {
    stream?.getTracks().forEach((t) => t.stop());
    void audio.close().catch(() => {});
  };

  let pass: Pass;
  try {
    const passPromise = fetchPass();
    // Ask for the mic at the same time as the pass; a blocked mic is the pilot's to fix, not a reason to fall back.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    pass = await passPromise;
    await audio.audioWorklet.addModule("/dictation-worklet.js");
  } catch (e) {
    cleanup();
    throw e;
  }

  const source = audio.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(audio, "dictation-tap");
  const mute = audio.createGain();
  mute.gain.value = 0;
  source.connect(tap);
  tap.connect(mute);
  mute.connect(audio.destination);

  const params = new URLSearchParams({
    sample_rate: String(Math.round(audio.sampleRate)),
    encoding: "pcm_s16le",
    speech_model: pass.model,
    token: pass.token,
  });
  if (opts.keyterms.length) params.set("keyterms_prompt", JSON.stringify(opts.keyterms));

  const held: ArrayBuffer[] = [];
  let sending = false;
  let ended = false;
  let lastWords = Date.now();
  const turns = new Map<number, Turn>();
  const startedAt = Date.now();
  let watch: ReturnType<typeof setInterval> | null = null;

  const finish = (reason: EndReason) => {
    if (ended) return;
    ended = true;
    if (watch) clearInterval(watch);
    tap.port.onmessage = null;
    sending = false;
    if (socket && socket.readyState === WebSocket.OPEN) {
      // Ask the service for the last words, then let it close; don't wait on it forever.
      socket.send(JSON.stringify({ type: "Terminate" }));
      const s = socket;
      setTimeout(() => s.readyState !== WebSocket.CLOSED && s.close(), 3000);
    }
    cleanup();
    opts.onEnd(reason);
  };

  tap.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    if (sending && socket?.readyState === WebSocket.OPEN) socket.send(e.data);
    else if (!sending && held.length < MAX_HELD_CHUNKS) held.push(e.data);
  };

  await new Promise<void>((resolve, reject) => {
    let begun = false;
    const timer = setTimeout(() => {
      if (begun) return;
      socket?.close();
      cleanup();
      reject(new DictationUnavailable("timeout"));
    }, OPEN_TIMEOUT_MS);
    socket = new WebSocket(`${pass.socket}?${params}`);
    socket.binaryType = "arraybuffer";
    socket.onmessage = (e) => {
      let m: { type?: string; turn_order?: number; transcript?: string; end_of_turn?: boolean; error?: string };
      try {
        m = JSON.parse(typeof e.data === "string" ? e.data : "");
      } catch {
        return;
      }
      if (m.type === "Begin" && !begun) {
        begun = true;
        clearTimeout(timer);
        sending = true;
        for (const chunk of held.splice(0)) socket?.send(chunk);
        lastWords = Date.now();
        watch = setInterval(() => {
          if (Date.now() - lastWords > QUIET_MS) finish("quiet");
          else if (Date.now() - startedAt > pass.maxSeconds * 1000 - 5000) finish("limit");
        }, 1000);
        resolve();
        return;
      }
      if (m.type === "Turn" && typeof m.turn_order === "number") {
        const text = m.transcript ?? "";
        const before = turns.get(m.turn_order);
        if (before?.text !== text) lastWords = Date.now();
        // A turn that's done stays done, even if a later copy of it arrives unmarked.
        turns.set(m.turn_order, { text, final: !!m.end_of_turn || !!before?.final });
        opts.onHeard(serviceText(turns));
      }
    };
    socket.onclose = () => {
      if (!begun) {
        clearTimeout(timer);
        cleanup();
        reject(new DictationUnavailable("refused"));
        return;
      }
      if (!ended) finish("lost");
    };
    socket.onerror = () => {};
  });

  return { stop: () => finish("stopped") };
}
