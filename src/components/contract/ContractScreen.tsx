"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { NoteBox } from "@/components/ui/NoteBox";
import { PageHeader, packEyebrow } from "@/components/ui/PageHeader";
import { SectionViewer } from "@/components/contract/SectionViewer";
import { QuoteCard } from "@/components/contract/QuoteCard";
import { postWithRetry } from "@/lib/brain/client";
import { loadCarryIn } from "@/lib/carry-in-storage";
import { bidMonthOfPack, packFacts } from "@/lib/contract/pack-facts";
import type { ContractAnswer } from "@/lib/contract/types";
import type { BidPack } from "@/types/bidpack";

const MAX_CHARS = 500;
const RECENT_KEY = "line-select:contract-recent:v1";
const MAX_RECENT = 6;

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((q): q is string => typeof q === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // A private window or full storage: recent questions just aren't kept.
  }
}

interface ContractScreenProps {
  bidPack: BidPack | null;
  userId: string | null;
  prefilled: string;
}

/** A question box answered in the contract's own words, with the section and page of each quote (see `lib/contract/ask.ts`). */
export function ContractScreen({ bidPack, userId, prefilled }: ContractScreenProps) {
  const [question, setQuestion] = useState(prefilled.slice(0, MAX_CHARS));
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState<ContractAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);
  const bidMonth = bidMonthOfPack(bidPack?.month) ?? undefined;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- once, after hydration, from this device's storage
    setRecent(loadRecent());
  }, []);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    setAsked(q);
    try {
      const carry = bidPack ? loadCarryIn(userId, bidPack.id) : null;
      const facts = packFacts(q, bidPack, carry?.items, carry?.elections);
      const r = await postWithRetry<{ answer: ContractAnswer }>("/api/contract/ask", { question: q, ...(facts ? { facts } : {}), ...(bidMonth ? { bidMonth } : {}) }, 60_000);
      setAnswer(r.answer);
      const next = [q, ...recent.filter((x) => x !== q)].slice(0, MAX_RECENT);
      setRecent(next);
      saveRecent(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't answer that just now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        eyebrow={bidPack ? packEyebrow(bidPack) : "2026 contract"}
        title="Ask the contract"
        description="A short answer, then the contract's own words with the section and page, so you can check it yourself."
      />

      <form
        className="panel-glass space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor="contract-question" className="block text-sm font-medium text-ink">
          Your question
        </label>
        <NoteBox
          id="contract-question"
          value={question}
          onChange={setQuestion}
          maxLength={MAX_CHARS}
          rows={2}
          disabled={busy}
          placeholder="e.g. How long is the SWW and when does it start?"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ink-muted">Name a line, like “line 2016”, to ask about your own pack.</p>
          <Button type="submit" disabled={busy || !question.trim()}>
            {busy ? "Reading…" : "Ask"}
          </Button>
        </div>
      </form>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {answer && (
        <section aria-label="Answer" className="space-y-4" aria-live="polite">
          <p className="text-sm text-ink-muted">{asked}</p>
          {answer.found ? (
            <>
              <p className="text-base leading-relaxed text-ink">{answer.answer}</p>
              <div className="space-y-3">
                {answer.quotes.map((q, i) => (
                  <QuoteCard key={`${q.section}-${i}`} quote={q} onOpen={setViewing} />
                ))}
              </div>
            </>
          ) : (
            <div className="panel-glass space-y-3 p-4">
              <p className="text-base font-medium text-ink">{answer.answer}</p>
              {answer.closest.length > 0 && (
                <div>
                  <p className="text-sm text-ink-muted">The closest sections:</p>
                  <ul className="mt-1 space-y-1">
                    {answer.closest.map((c) => (
                      <li key={c.section}>
                        <button type="button" onClick={() => setViewing(c.section)} className="text-left text-sm text-accent underline-offset-2 hover:underline">
                          {c.section}
                          {c.path ? ` · ${c.path}` : ""} · p. {c.page}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <details className="text-sm text-ink-muted">
                <summary className="cursor-pointer">What we have</summary>
                <p className="mt-2 leading-relaxed">
                  The public 2026 agreement holds the parts the 2026 deal changed: {answer.covered.join("; ")}. Sections it left alone aren&apos;t in it, so the contract may still cover this.
                </p>
              </details>
            </div>
          )}
        </section>
      )}

      {recent.length > 0 && (
        <section aria-label="Recent questions">
          <h2 className="text-sm font-medium text-ink-muted">Recent on this device</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {recent.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setQuestion(q);
                    void ask(q);
                  }}
                  className="rounded-full border border-hairline px-3 py-1.5 text-left text-sm text-ink-muted transition-colors hover:border-accent/50 hover:text-ink"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs leading-relaxed text-ink-muted">ALPA and the contract itself are the authority. This isn&apos;t legal advice.</p>

      {viewing && <SectionViewer section={viewing} bidMonth={bidMonth} onClose={() => setViewing(null)} onOpen={setViewing} />}
    </div>
  );
}
