"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal shape of the browser's own Web Speech API — not part of
 * TypeScript's DOM lib, and only ever touched after a runtime feature
 * check (see `getConstructor`), never assumed to exist. Chrome, Edge, and
 * Safari implement it; Firefox has no speech API at all, so `supported`
 * is false there and callers should simply not render a mic control
 * rather than show one that silently does nothing.
 */
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly [index: number]: { readonly transcript: string };
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** One line, chosen for what a pilot can actually do about it — never the browser's own raw error code. */
function friendlyError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked — check your browser's site permissions and try again.";
    case "no-speech":
      return "Didn't catch anything — try again a little closer to the mic.";
    case "audio-capture":
      return "No microphone found on this device.";
    default:
      return "Voice input stopped working — you can keep typing instead.";
  }
}

/**
 * Browser-native dictation for a controlled text field. Nothing here ever
 * leaves the device — this is the browser's own on-device (or its own
 * vendor's) speech engine, not a Line Select server call.
 * `onChunk(text, isFinal)` fires with an interim (still-being-said, may
 * still change) or final (settled) piece of transcript; the caller
 * decides how to fold that into its own value — see `useDictation` below
 * for the common "append to whatever's already there" case every text
 * field in this app actually wants.
 */
export function useSpeechToText(onChunk: (text: string, isFinal: boolean) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onChunkRef = useRef(onChunk);
  useEffect(() => {
    onChunkRef.current = onChunk;
  }, [onChunk]);

  useEffect(() => {
    // A one-time runtime feature check (this browser either has the Web
    // Speech API or it doesn't) — not state derived from props, so there's
    // no cascading-render concern despite the lint rule's default suspicion.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(!!getConstructor());
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getConstructor();
    if (!Ctor) return;
    setError(null);
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
    recognition.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) final += transcript;
        else interim += transcript;
      }
      if (final) onChunkRef.current(final, true);
      if (interim) onChunkRef.current(interim, false);
    };
    recognition.onerror = (event) => {
      setError(friendlyError(event.error));
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, []);

  // Stop cleanly on unmount — navigating away or answering another way mid-dictation shouldn't leave the mic hot.
  useEffect(() => () => recognitionRef.current?.stop(), []);

  return { supported, listening, error, start, stop };
}

/**
 * The shape every free-text field in this app actually wants: dictated
 * speech appends to whatever the pilot already typed (or already
 * dictated), live, rather than replacing it — the same behavior as typing
 * more characters at the end. `value`/`onChange` are the field's own
 * existing controlled-input pair; nothing about wiring this in changes
 * how the field is otherwise built.
 */
export function useDictation(value: string, onChange: (next: string) => void) {
  const baseRef = useRef(value);
  // What we ourselves last asked the caller to adopt — `value` landing on
  // anything else (the pilot typing by hand mid-dictation, or a caller
  // like BiddingStoryStep clamping to a max length) means `value` is now
  // the real authoritative text, not what we think base is.
  const lastEmittedRef = useRef(value);

  const { supported, listening, error, start, stop } = useSpeechToText((chunk, isFinal) => {
    const base = baseRef.current;
    const needsSpace = base.length > 0 && !/\s$/.test(base);
    const combined = base + (needsSpace ? " " : "") + chunk;
    lastEmittedRef.current = combined;
    onChange(combined);
    if (isFinal) baseRef.current = combined;
  });

  // Re-base onto `value` whenever it diverges from our last emission —
  // otherwise the next dictated chunk builds on a stale pre-edit or
  // pre-clamp copy and silently erases whatever changed it.
  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      baseRef.current = value;
      lastEmittedRef.current = value;
    }
  }, [value]);

  const toggle = useCallback(() => {
    if (listening) {
      stop();
      return;
    }
    baseRef.current = value;
    lastEmittedRef.current = value;
    start();
  }, [listening, start, stop, value]);

  return { supported, listening, error, toggle };
}
