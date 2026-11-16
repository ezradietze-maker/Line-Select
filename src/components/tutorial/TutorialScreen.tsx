"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { TUTORIAL_CHAPTERS, formatChapterLength, tutorialLength } from "@/lib/tutorial";
import { useTutorialCaptions } from "@/lib/tutorial-captions";

/** The chapter a link points at (`/tutorial#strategies`), or the first. The server can't see the #fragment. */
function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
function chapterFromHash(hash: string): number {
  const i = TUTORIAL_CHAPTERS.findIndex((c) => `#${c.id}` === hash);
  return i < 0 ? 0 : i;
}

/**
 * The tutorial: one narrated video in short chapters, one feature at a time, made from a real bid pack on a demo
 * account. Each chapter is its own file, so a pilot can start anywhere without loading the rest; with "Play the next
 * chapter" on, they run straight through. Captions are on by default, for watching with the sound off; one switch turns
 * them off (or on) for every chapter, remembered on the device.
 */
export function TutorialScreen() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const at = chapterFromHash(hash);
  const [playOn, setPlayOn] = useState(true);
  const [captionsOn, setCaptionsOn] = useTutorialCaptions();
  const video = useRef<HTMLVideoElement>(null);
  // Set when a chapter is picked or the last one ends, so the new one starts playing once it has loaded; a page that
  // just opened waits for the pilot to press play.
  const autoplay = useRef(false);
  const chapter = TUTORIAL_CHAPTERS[at];
  const next = TUTORIAL_CHAPTERS[at + 1];

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.load();
    if (autoplay.current) v.play().catch(() => {});
    autoplay.current = false;
  }, [at]);

  // Captions follow the one choice in every chapter: set as each chapter loads (loading can put a default track back
  // on), and the player's own CC button changes the choice itself, so the next chapter keeps it.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const tracks = v.textTracks;
    const apply = () => {
      const t = tracks[0];
      if (t) t.mode = captionsOn ? "showing" : "hidden";
    };
    const followPlayer = () => {
      const t = tracks[0];
      if (t && (t.mode === "showing") !== captionsOn) setCaptionsOn(t.mode === "showing");
    };
    apply();
    v.addEventListener("loadedmetadata", apply);
    tracks.addEventListener("change", followPlayer);
    return () => {
      v.removeEventListener("loadedmetadata", apply);
      tracks.removeEventListener("change", followPlayer);
    };
  }, [at, captionsOn, setCaptionsOn]);

  function pick(i: number) {
    autoplay.current = true;
    // In the address, so a chapter can be linked and a reload keeps it; replaced, so Back leaves the page.
    history.replaceState(null, "", `#${TUTORIAL_CHAPTERS[i].id}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        eyebrow="Line Select"
        title="Tutorial"
        description={`How to use Line Select, one feature at a time. Watch it straight through (${tutorialLength()}) or pick the chapter you need.`}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label="Video" className="min-w-0">
          <div className="overflow-hidden rounded-xl border border-hairline bg-black">
            {/* The narration is captioned in the track below, shown or hidden by the captions switch. */}
            <video
              ref={video}
              key={chapter.id}
              controls
              playsInline
              preload="metadata"
              poster={chapter.poster}
              className="aspect-video w-full"
              onEnded={() => {
                if (playOn && next) pick(at + 1);
              }}
            >
              <source src={chapter.video} type="video/mp4" />
              <track kind="captions" src={chapter.captions} srcLang="en" label="English" default={captionsOn} />
            </video>
          </div>
          <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <p className="text-2xs font-medium text-accent">
                Chapter {at + 1} of {TUTORIAL_CHAPTERS.length}
              </p>
              <h2 className="mt-1 font-display text-xl font-semibold text-ink">{chapter.title}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">{chapter.summary}</p>
            </div>
            {next && (
              <button
                type="button"
                onClick={() => pick(at + 1)}
                className="self-start shrink-0 rounded-md border border-border px-3 py-2 text-left text-sm text-ink-muted hover:border-border-strong hover:text-ink"
              >
                <span className="block text-2xs text-ink-faint">Next</span>
                {next.title}
              </button>
            )}
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6">
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" checked={playOn} onChange={(e) => setPlayOn(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
              Play the next chapter when one ends
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" checked={captionsOn} onChange={(e) => setCaptionsOn(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
              Captions, in every chapter
            </label>
          </div>
        </section>

        <nav aria-label="Chapters">
          <ol className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline">
            {TUTORIAL_CHAPTERS.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pick(i)}
                  aria-current={i === at ? "true" : undefined}
                  className={`flex w-full items-baseline gap-3 px-3.5 py-2.5 text-left text-sm transition-colors ${
                    i === at ? "bg-brand-soft/40 text-ink" : "text-ink-muted hover:bg-ink/[0.04] hover:text-ink"
                  }`}
                >
                  <span className={`w-5 shrink-0 font-mono text-xs tabular-nums ${i === at ? "text-accent" : "text-ink-faint"}`}>{i + 1}</span>
                  <span className="min-w-0 flex-1">{c.title}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-ink-faint">{formatChapterLength(c.seconds)}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            Recorded on a real October bid pack with a demo account. View/Add and Open Time get their own chapters once
            they&rsquo;re finished.
          </p>
        </nav>
      </div>
    </div>
  );
}
