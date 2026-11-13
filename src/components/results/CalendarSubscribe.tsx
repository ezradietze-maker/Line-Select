"use client";

import Link from "next/link";
import { useState } from "react";
import { isSamplePack } from "@/lib/fake-trade-offers";
import { useAppState } from "@/lib/app-state";
import { feedChoiceFor, feedLinks, fetchFeedStatus, forgetFeedSync, makeFeedLink, setFeedHomeDays, syncFeedChoice, turnOffFeed, useCalendarFeedSync, type FeedStatusView } from "@/lib/calendar-feed-client";

/**
 * A private subscription link for the pilot's calendar app: their bid dates and their awarded or #1 line, kept up to
 * date with no re-exporting. The link is shown once, right after it's made; only a hash of it is kept.
 */
export function CalendarSubscribe({ topLineNumber = null }: { /** The pilot's current #1, where the screen knows it. */ topLineNumber?: string | null }) {
  const { user, bidPack, profile } = useAppState();
  useCalendarFeedSync(bidPack, profile, user?.id ?? null, topLineNumber);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<FeedStatusView | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [homeDays, setHomeDays] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<"new" | "off" | null>(null);

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach your calendar link just now.");
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && user && !status) {
      void act(async () => {
        const s = await fetchFeedStatus();
        setStatus(s);
        setHomeDays(s.options?.homeDays ?? false);
      });
    }
  }

  const makeLink = () =>
    act(async () => {
      const made = await makeFeedLink(homeDays);
      setLink(made.url ?? null);
      setStatus(made);
      setCopied(false);
      forgetFeedSync();
      // From a screen that doesn't know the #1 (the Logbook) and no award logged: sending now would put up a month with
      // no line and call it done. My Rankings sends it, as the link is new.
      if (bidPack && !feedChoiceFor(bidPack, profile, topLineNumber)) {
        setNotice("Your link works. Your #1 line's trips appear on it after your next visit to My Rankings.");
      } else if (bidPack) {
        const result = await syncFeedChoice(bidPack, profile, topLineNumber, user?.id ?? null);
        if (result === "pack-not-saved") setNotice("Your link works, but your bid pack couldn't be saved to your account just now. Your trips will appear after your next visit to My Rankings.");
        if (result === "failed") setNotice("Your link works, but your line didn't reach it yet. It will on your next visit to My Rankings.");
        if (result === "ok") setStatus(await fetchFeedStatus());
      }
    });

  const changeHomeDays = (next: boolean) => {
    setHomeDays(next);
    if (!status?.on) return;
    void act(async () => {
      try {
        setStatus(await setFeedHomeDays(next));
      } catch (e) {
        // Refused: the box shows what the link still does, not what was asked for.
        setHomeDays(!next);
        throw e;
      }
    });
  };

  const turnOff = () =>
    act(async () => {
      setStatus(await turnOffFeed());
      setLink(null);
    });

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Select the link above and copy it.");
    }
  }

  const button = "rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-50";
  const links = link ? feedLinks(link) : null;
  const sample = !!bidPack && isSamplePack(bidPack);

  return (
    <div className="mt-2 print:hidden">
      <button type="button" onClick={toggle} aria-expanded={open} className="text-xs font-medium text-accent hover:underline">
        {open ? "Hide calendar link" : "Subscribe in your calendar"}
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-border bg-canvas/40 p-3 text-sm text-ink">
          <p className="text-xs leading-relaxed text-ink-muted">
            A private link your calendar app re-reads on its own: this bid&rsquo;s dates for your seat, plus your #1 line&rsquo;s trips with hotels and pickups (your award, once you log it). Change your line here and your calendar follows, with nothing to export again.
          </p>

          {!user ? (
            <p className="mt-3 text-xs text-ink-muted">
              <Link href="/auth" className="font-medium text-accent hover:underline">
                Sign in
              </Link>{" "}
              to get your link. It needs your bid pack on your account.
            </p>
          ) : sample ? (
            <p className="mt-3 text-xs text-ink-muted">Upload your own bid pack to get a link. The sample pack isn&rsquo;t saved to your account.</p>
          ) : (
            <>
              <label className="mt-3 flex items-center gap-2 text-xs text-ink">
                <input type="checkbox" checked={homeDays} disabled={busy} onChange={(e) => changeHomeDays(e.target.checked)} />
                Also show my days off as all-day &ldquo;Home&rdquo; events
              </label>

              {links && (
                <div className="mt-3">
                  <div className="flex flex-wrap gap-2">
                    <a href={links.apple} className={button}>
                      Apple Calendar
                    </a>
                    <a href={links.google} target="_blank" rel="noopener noreferrer" className={button}>
                      Google Calendar
                    </a>
                    <a href={links.outlook} target="_blank" rel="noopener noreferrer" className={button}>
                      Outlook
                    </a>
                    <button type="button" onClick={copyLink} className={button}>
                      {copied ? "Copied" : "Copy link"}
                    </button>
                  </div>
                  <input readOnly value={link ?? ""} aria-label="Your calendar link" onFocus={(e) => e.target.select()} className="mt-2 w-full rounded border border-field-edge bg-surface px-2 py-1 font-mono text-[11px] text-ink-muted" />
                  <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                    This is the only time this link can be shown, because we keep just a scrambled copy of it. Add it to your calendar now. In Apple Calendar, change Auto-refresh to &ldquo;Every hour&rdquo; when it asks, since it starts on once a week, and pick iCloud to see it on your iPhone too. Google and Outlook pick their own pace, which can take up to a day.
                  </p>
                </div>
              )}

              {status?.on && !link && (
                <p className="mt-3 text-xs text-ink-muted">
                  Your link is on
                  {status.createdAt ? ` since ${new Date(status.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
                  {status.lineNumber ? `, showing Line ${status.lineNumber} (${status.lineSource === "awarded" ? "your award" : "your #1"})` : ""}. We can&rsquo;t show an existing link again. Make a new one if you need it.
                </p>
              )}

              <p className="mt-3 text-xs leading-relaxed text-warn">Anyone who has this link can read this calendar, so keep it to yourself. It shows no other pilot&rsquo;s details.</p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!status?.on && (
                  <button type="button" onClick={makeLink} disabled={busy || !status} className={button}>
                    Make my link
                  </button>
                )}
                {status?.on && confirming === null && (
                  <>
                    <button type="button" onClick={() => setConfirming("new")} disabled={busy} className={button}>
                      Make a new link
                    </button>
                    <button type="button" onClick={() => setConfirming("off")} disabled={busy} className={button}>
                      Turn off
                    </button>
                  </>
                )}
                {confirming && (
                  <>
                    <span className="text-xs text-ink">The current link stops working in every calendar using it.</span>
                    <button type="button" onClick={confirming === "new" ? makeLink : turnOff} disabled={busy} className={button}>
                      {confirming === "new" ? "Yes, make a new link" : "Yes, turn off"}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} disabled={busy} className={button}>
                      Keep it
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          {notice && <p className="mt-2 text-xs text-ink-muted">{notice}</p>}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
