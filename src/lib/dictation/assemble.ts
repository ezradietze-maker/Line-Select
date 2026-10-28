/**
 * Putting dictated words together without doubling them. Both speech engines resend what they've heard — the speech
 * service sends each turn's whole text again as it firms up, Chrome on Android resends the whole sentence so far as
 * each new "final" piece, Safari sometimes sends a finished phrase twice — so the dictated text is always rebuilt from
 * the latest of everything heard, never added to piece by piece.
 */

export interface Heard {
  /** Words the engine is done with. */
  settled: string;
  /** Words still being worked out — they may change. */
  hearing: string;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const joinAll = (parts: string[]) => parts.map(clean).filter(Boolean).join(" ");

/** One turn of speech from the service, as last sent: its text so far, and whether it's done. */
export interface Turn {
  text: string;
  final: boolean;
}

/** The service's turns, in the order spoken: done ones settled, the rest still being heard. */
export function serviceText(turns: Map<number, Turn>): Heard {
  const ordered = [...turns.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
  const firstOpen = ordered.findIndex((t) => !t.final);
  const done = firstOpen < 0 ? ordered : ordered.slice(0, firstOpen);
  const open = firstOpen < 0 ? [] : ordered.slice(firstOpen);
  return { settled: joinAll(done.map((t) => t.text)), hearing: joinAll(open.map((t) => t.text)) };
}

/** The shape of the browser's own speech results (Web Speech API): every result of the session, each final or not. */
export interface BrowserResult {
  readonly isFinal: boolean;
  readonly [index: number]: { readonly transcript: string };
}

const comparable = (s: string) => clean(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "");

/**
 * Every result of a browser speech session, rebuilt from the start each time. A final result that repeats the one
 * before it — or carries it and goes on, Chrome on Android's habit — replaces it instead of following it.
 */
export function browserText(results: ArrayLike<BrowserResult>): Heard {
  const finals: string[] = [];
  const interim: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const text = clean(r[0]?.transcript ?? "");
    if (!text) continue;
    if (!r.isFinal) {
      interim.push(text);
      continue;
    }
    const prev = finals[finals.length - 1];
    if (prev !== undefined) {
      const p = comparable(prev);
      const t = comparable(text);
      if (t === p || p.startsWith(t)) continue;
      if (t.startsWith(p)) {
        finals[finals.length - 1] = text;
        continue;
      }
    }
    finals.push(text);
  }
  // A still-changing piece that just repeats what's settled (Android again) adds nothing.
  const settled = joinAll(finals);
  const hearing = joinAll(interim);
  const s = comparable(settled);
  const h = comparable(hearing);
  if (h && s && s.endsWith(h)) return { settled, hearing: "" };
  if (h && s && h.startsWith(s)) return { settled: "", hearing };
  return { settled, hearing };
}

/** What was there before dictation started, and what's been said since: one space between, never two. */
export function withDictated(base: string, heard: Heard): string {
  const said = joinAll([heard.settled, heard.hearing]);
  if (!said) return base;
  const gap = base.length > 0 && !/\s$/.test(base) ? " " : "";
  return base + gap + said;
}
