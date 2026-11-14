"use client";

import { apiFetch } from "@/lib/shown-account";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBidPackIfAny } from "@/lib/app-state";
import { browserText, withDictated, type BrowserResult, type Heard } from "@/lib/dictation/assemble";
import { DictationUnavailable, serviceDictationPossible, startServiceDictation, type EndReason, type ServiceSession } from "@/lib/dictation/service-dictation";
import { dictationWords, fixSpelledCodes, packAirports } from "@/lib/dictation/word-list";

/**
 * Minimal shape of the browser's own Web Speech API — not part of
 * TypeScript's DOM lib, and only ever touched after a runtime feature
 * check (see `getConstructor`), never assumed to exist. Chrome, Edge, and
 * Safari implement it; Firefox has no speech API at all.
 */
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<BrowserResult>;
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
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access is blocked — check your browser's site permissions and try again.";
    case "no-speech":
      return "Didn't catch anything — try again a little closer to the mic.";
    case "audio-capture":
    case "NotFoundError":
    case "NotReadableError":
      return "No microphone found on this device.";
    default:
      return "Voice input stopped working — you can keep typing instead.";
  }
}

/** Why the mic switched itself off, when it wasn't the pilot. */
const END_NOTICE: Partial<Record<EndReason, string>> = {
  quiet: "The mic switched off after a quiet spell — tap it to keep going.",
  limit: "The mic switches off after 15 minutes — tap it to keep going.",
  lost: "Lost the connection — tap the mic to keep going.",
};

/** A browser session that ends by itself (Safari after a pause) is restarted this many times at most, and only while words keep coming. */
const MAX_RESTARTS = 20;
const QUIET_MS = 30_000;

/**
 * The browser's own speech engine, for when the speech service isn't there (not configured, offline, busy). Every
 * result of the session is rebuilt from the start on each update (`browserText`), never added piece by piece, so the
 * browsers' habit of resending what they've heard can't double the text. A session the browser ends by itself is
 * restarted, carrying what was said, so a pause doesn't switch the mic off.
 */
function startBrowserDictation(opts: { onHeard: (heard: Heard) => void; onEnd: (error?: string) => void }): ServiceSession | null {
  const Ctor = getConstructor();
  if (!Ctor) return null;
  let carried = "";
  let latest: Heard = { settled: "", hearing: "" };
  let stopped = false;
  let failed: string | undefined;
  let restarts = 0;
  let lastWords = Date.now();
  let recognition: SpeechRecognitionLike;

  const run = () => {
    recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
    recognition.onresult = (event) => {
      const heard = browserText(event.results);
      if (heard.settled !== latest.settled || heard.hearing !== latest.hearing) lastWords = Date.now();
      latest = heard;
      opts.onHeard({ settled: [carried, heard.settled].filter(Boolean).join(" "), hearing: heard.hearing });
    };
    recognition.onerror = (event) => {
      if (event.error !== "no-speech" && event.error !== "aborted") failed = friendlyError(event.error);
    };
    recognition.onend = () => {
      // What was still being heard when the session ended is kept as said.
      carried = [carried, latest.settled, latest.hearing].filter(Boolean).join(" ");
      latest = { settled: "", hearing: "" };
      if (!stopped && !failed && restarts < MAX_RESTARTS && Date.now() - lastWords < QUIET_MS) {
        restarts++;
        try {
          run();
          return;
        } catch {
          // A browser that won't restart without a tap ends here.
        }
      }
      opts.onEnd(failed);
    };
    recognition.start();
  };
  run();
  return {
    stop: () => {
      stopped = true;
      recognition.stop();
    },
  };
}

/** Whether this server has the speech service set up — asked once per page load. */
let serviceAvailable: Promise<boolean> | null = null;
function checkService(): Promise<boolean> {
  if (!serviceAvailable) {
    serviceAvailable = apiFetch("/api/dictation-token", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d: { available?: boolean }) => !!d.available)
      .catch(() => false);
  }
  return serviceAvailable;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean);
/** A run of words by its letters alone, for telling the same words apart however they're split or punctuated. */
const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Said when a box with a limit is full: the mic stops there. */
const FULL_NOTICE = "That’s as long as one answer can be, so the mic stopped. Shorten it to add more.";

/** The answer box whose mic is on, page-wide: starting another one stops it. */
let activeDictation: { stop: () => void } | null = null;

/**
 * The mic for an answer box: dictated speech goes in after whatever the pilot already typed, live, the way typing
 * more at the end would. It uses the speech service with the pilot's word list (pilot terms, the pack's airports and
 * aircraft) when the server has it, and the browser's own engine otherwise. `value`/`onChange` are the box's own
 * controlled-input pair. With `maxLength`, the mic stops once the box is full and says so: the words after it went
 * nowhere, and the pilot talked on for minutes not knowing.
 */
export function useDictation(value: string, onChange: (next: string) => void, { maxLength }: { maxLength?: number } = {}) {
  const pack = useBidPackIfAny();
  const keyterms = useMemo(() => dictationWords(pack), [pack]);
  const codes = useMemo(() => packAirports(pack), [pack]);
  const [browserOk, setBrowserOk] = useState(false);
  const [serviceOk, setServiceOk] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<ServiceSession | null>(null);
  /** This box, as the page-wide active mic knows it. */
  const self = useRef<{ stop: () => void }>({ stop: () => {} });
  // Which tap of the mic is current: words or a late start from an earlier one are ignored (or stopped).
  const generation = useRef(0);
  const stoppedEarly = useRef(-1);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const maxRef = useRef(maxLength);
  useEffect(() => {
    maxRef.current = maxLength;
  }, [maxLength]);

  // What was in the box when dictation started; what we last put there; and how many dictated words are already in
  // the box by other means (the pilot typed mid-dictation, or the box trimmed to its limit) and mustn't be added again.
  const base = useRef(value);
  const lastEmitted = useRef(value);
  const said = useRef("");
  const consumed = useRef(0);
  // The settled part of the dictation as last heard, and the half-heard words after it.
  const heardSettled = useRef("");
  const heardHearing = useRef("");
  // Half-heard words already in the box when the pilot typed: the engine may settle them re-split ("four teen" →
  // "fourteen"), so they're matched by their letters when they come back, not counted off as words.
  const pendingHearing = useRef("");

  useEffect(() => {
    // One-time checks of what this browser and server can do — not state derived from props.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrowserOk(!!getConstructor());
    if (!serviceDictationPossible()) return;
    let live = true;
    void checkService().then((ok) => live && setServiceOk(ok));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      base.current = value;
      lastEmitted.current = value;
      consumed.current = words(heardSettled.current).length;
      pendingHearing.current = heardHearing.current;
    }
  }, [value]);

  const apply = useCallback(
    (heard: Heard) => {
      const fixed = { settled: fixSpelledCodes(heard.settled, codes), hearing: fixSpelledCodes(heard.hearing, codes) };
      said.current = [fixed.settled, fixed.hearing].filter(Boolean).join(" ");
      heardSettled.current = fixed.settled;
      heardHearing.current = fixed.hearing;
      let freshWords = words(said.current).slice(consumed.current);
      if (pendingHearing.current) {
        const already = letters(pendingHearing.current);
        let matched = -1;
        for (let j = 0; j < freshWords.length; j++) {
          const sofar = letters(freshWords.slice(0, j + 1).join(""));
          if (sofar === already) {
            matched = j + 1;
            break;
          }
          if (sofar.length > already.length) break;
        }
        // Matched: those words are in the box already. Heard differently: as many words as were half-heard.
        const drop = matched > 0 ? matched : Math.min(words(pendingHearing.current).length, freshWords.length);
        freshWords = freshWords.slice(drop);
        // Counted off for good once the engine has settled them; until then they can still be re-split.
        if (words(fixed.settled).length - consumed.current >= drop) {
          consumed.current += drop;
          pendingHearing.current = "";
        }
      }
      const fresh = freshWords.join(" ");
      let next = withDictated(base.current, { settled: fresh, hearing: "" });
      const max = maxRef.current;
      const full = max !== undefined && next.length >= max;
      if (full) next = next.slice(0, max);
      if (next !== lastEmitted.current) {
        lastEmitted.current = next;
        onChangeRef.current(next);
      }
      if (full) {
        // This tap is over: words still on their way are dropped, not trimmed off one by one.
        generation.current += 1;
        self.current.stop();
        setError(FULL_NOTICE);
      }
    },
    [codes]
  );

  const startBrowser = useCallback(() => {
    const mine = generation.current;
    const s = startBrowserDictation({
      onHeard: (heard) => mine === generation.current && apply(heard),
      onEnd: (failure) => {
        if (mine !== generation.current) return;
        session.current = null;
        setListening(false);
        if (failure) setError(failure);
      },
    });
    if (!s) {
      setListening(false);
      setError("Voice input isn't available in this browser — you can type instead.");
      return;
    }
    session.current = s;
  }, [apply]);

  // Tapped off: the last words of this tap still land; only a new tap stops them. Also how another box's mic stops this one.
  const stopListening = useCallback(() => {
    if (!session.current) stoppedEarly.current = generation.current;
    session.current?.stop();
    session.current = null;
    setListening(false);
    if (activeDictation === self.current) activeDictation = null;
  }, []);
  useEffect(() => {
    self.current.stop = stopListening;
  }, [stopListening]);

  const toggle = useCallback(() => {
    if (listening) {
      stopListening();
      return;
    }
    if (maxRef.current !== undefined && value.length >= maxRef.current) {
      setError(FULL_NOTICE);
      return;
    }
    // One mic at a time: another box still listening would hear the same words and write them in too.
    if (activeDictation && activeDictation !== self.current) activeDictation.stop();
    activeDictation = self.current;
    const mine = ++generation.current;
    base.current = value;
    lastEmitted.current = value;
    said.current = "";
    consumed.current = 0;
    setError(null);
    setListening(true);
    if (!serviceOk) {
      startBrowser();
      return;
    }
    // Called straight from the tap: the service starts the sound before anything else.
    startServiceDictation({
      keyterms,
      onHeard: (heard) => mine === generation.current && apply(heard),
      onEnd: (reason) => {
        if (mine !== generation.current) return;
        session.current = null;
        setListening(false);
        const notice = END_NOTICE[reason];
        if (notice) setError(notice);
      },
    })
      .then((s) => {
        // Tapped off (or on again) while it was connecting.
        if (mine !== generation.current || stoppedEarly.current === mine) s.stop();
        else session.current = s;
      })
      .catch((e: unknown) => {
        if (mine !== generation.current || stoppedEarly.current === mine) return;
        if (e instanceof DictationUnavailable && browserOk) {
          startBrowser();
          return;
        }
        setListening(false);
        setError(friendlyError(e instanceof DOMException ? e.name : e instanceof DictationUnavailable ? "unavailable" : "other"));
      });
  }, [listening, value, serviceOk, browserOk, keyterms, apply, startBrowser, stopListening]);

  // Stop cleanly on unmount — navigating away or answering another way mid-dictation shouldn't leave the mic hot. A
  // session still connecting has no handle yet: moving the generation on has it stopped the moment it connects.
  useEffect(() => {
    const me = self.current;
    return () => {
      generation.current += 1;
      session.current?.stop();
      if (activeDictation === me) activeDictation = null;
    };
  }, []);

  return { supported: browserOk || serviceOk, listening, error, toggle };
}
