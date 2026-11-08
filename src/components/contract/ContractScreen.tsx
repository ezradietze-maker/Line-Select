"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatTurn, type Turn } from "@/components/contract/ChatTurn";
import { SectionViewer } from "@/components/contract/SectionViewer";
import { prefersLessMotion } from "@/components/contract/useTyped";
import { ArrowUpIcon, ContractIcon } from "@/components/ui/icons";
import { NoteBox } from "@/components/ui/NoteBox";
import { loadCarryIn } from "@/lib/carry-in-storage";
import { askTheContract } from "@/lib/contract/client";
import { bidMonthOfPack, packFacts } from "@/lib/contract/pack-facts";
import type { BidPack } from "@/types/bidpack";

const MAX_CHARS = 500;
const MAX_KEPT_TURNS = 20;
/** How far back a follow-up can reach. Matches what the server accepts. */
const HISTORY_TURNS = 3;
const FAILED = "Couldn't answer that just now. Please try again.";

const STARTERS = ["How long is the SWW and when does it start?", "What's the minimum domestic rest?", "What happens if a phase-in conflict hits an R-day block?", "What do I get if the company cancels my vacation?"];

/** The chat is kept with the signed-in pilot's id in its key, so signing out on a shared computer removes it (`forgetPilotOnDevice`). */
const chatKey = (userId: string | null) => `line-select:contract-chat:${userId ?? "guest"}:v1`;

function loadChat(userId: string | null): Turn[] {
  try {
    // The page's first version kept recent questions under a key sign-out didn't clear.
    localStorage.removeItem("line-select:contract-recent:v1");
    const raw = JSON.parse(localStorage.getItem(chatKey(userId)) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as Turn[]).filter((t) => t && typeof t.question === "string" && t.answer).map((t) => ({ ...t, restored: true })) : [];
  } catch {
    return [];
  }
}

function saveChat(userId: string | null, turns: Turn[]) {
  try {
    const finished = turns.filter((t) => t.answer).slice(-MAX_KEPT_TURNS);
    localStorage.setItem(chatKey(userId), JSON.stringify(finished));
  } catch {
    // A private window or full storage: the chat just isn't kept.
  }
}

/** Near enough to the bottom that new words should keep the view with them. */
const nearBottom = () => window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 160;

interface ContractScreenProps {
  bidPack: BidPack | null;
  userId: string | null;
  prefilled: string;
}

/** A full-page chat over the contract: the working as it happens, then a checked answer in the contract's own words (see `lib/contract/ask.ts`). */
export function ContractScreen({ bidPack, userId, prefilled }: ContractScreenProps) {
  const [question, setQuestion] = useState(prefilled.slice(0, MAX_CHARS));
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [lessMotion, setLessMotion] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const bidMonth = bidMonthOfPack(bidPack?.month) ?? undefined;
  const firstLine = bidPack?.lines[0]?.lineNumber;

  useEffect(() => {
    // Once, after hydration, from this device's storage. A chat picked up again opens at its last question.
    const kept = loadChat(userId);
    following.current = false;
    setTurns(kept);
    setLessMotion(prefersLessMotion());
    if (kept.length) requestAnimationFrame(() => [...document.querySelectorAll("[data-turn]")].pop()?.scrollIntoView({ block: "start" }));
  }, [userId]);

  // The page itself scrolls, so the box stays put on a phone when the keyboard comes up. It follows the words as they
  // appear, unless the pilot has scrolled up to read.
  useEffect(() => {
    const onScroll = () => {
      following.current = nearBottom();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(() => {
      if (following.current) window.scrollTo({ top: document.documentElement.scrollHeight });
    });
    if (thread.current) observer.observe(thread.current);
    return () => {
      window.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  // With the answer all showing, the view stops following: several quotes under it would otherwise push it off the top.
  // The question goes to the top instead, with the answer and the first quotes in view.
  const onSettled = useCallback((turn: HTMLElement) => {
    if (following.current) turn.scrollIntoView({ block: "start", behavior: "smooth" });
    following.current = false;
  }, []);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setQuestion("");
    following.current = true;
    const id = crypto.randomUUID();
    const update = (change: (t: Turn) => Turn) => setTurns((all) => all.map((t) => (t.id === id ? change(t) : t)));
    const earlier = turns.filter((t) => t.answer).slice(-HISTORY_TURNS);
    setTurns((all) => [...all, { id, question: q, steps: [], answer: null, error: null }]);
    try {
      const carry = bidPack ? loadCarryIn(userId, bidPack.id) : null;
      const facts = packFacts(q, bidPack, carry?.items, carry?.elections);
      const history = earlier.map((t) => ({
        question: t.question,
        answer: t.answer!.answer.slice(0, 1_500),
        sections: t.answer!.found ? [...new Set(t.answer!.quotes.map((x) => x.section))].slice(0, 8) : [],
      }));
      const answer = await askTheContract({ question: q, ...(history.length ? { history } : {}), ...(facts ? { facts } : {}), ...(bidMonth ? { bidMonth } : {}) }, (step) => update((t) => ({ ...t, steps: [...t.steps, step] })));
      setTurns((all) => {
        const next = all.map((t) => (t.id === id ? { ...t, answer } : t));
        saveChat(userId, next);
        return next;
      });
    } catch (e) {
      update((t) => ({ ...t, error: e instanceof Error ? e.message : FAILED, final: !!(e as { final?: boolean }).final }));
    } finally {
      setBusy(false);
    }
  }

  function newChat() {
    setTurns([]);
    saveChat(userId, []);
    setQuestion("");
  }

  const empty = turns.length === 0;
  const starters = firstLine ? [...STARTERS.slice(0, 3), `How many days off does line ${firstLine} have, and what does the contract require?`] : STARTERS;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
      <div ref={thread} className="flex flex-1 flex-col">
        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-hairline bg-accent-soft text-accent">
              <ContractIcon className="h-7 w-7" />
            </span>
            <h1 className="mt-4 font-display text-3xl font-semibold text-ink">Ask the contract</h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-muted">Ask anything about the 2026 agreement. You&apos;ll see it search, read and check, then get a short answer in the contract&apos;s own words, with the section and page. Name a line to ask about your own pack.</p>
            <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
              {starters.map((s) => (
                <button key={s} type="button" onClick={() => void ask(s)} className="rounded-xl border border-hairline px-4 py-3 text-left text-sm text-ink-muted transition-colors hover:border-accent/50 hover:text-ink">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h1 className="font-display text-lg font-semibold text-ink">Ask the contract</h1>
              <button type="button" onClick={newChat} disabled={busy} className="rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-accent/50 hover:text-ink disabled:opacity-50">
                New chat
              </button>
            </div>
            <div className="flex-1 space-y-8 pb-4">
              {turns.map((t) => (
                <ChatTurn key={t.id} turn={t} lessMotion={lessMotion} onOpen={setViewing} onRetry={(q) => void ask(q)} onSettled={onSettled} />
              ))}
            </div>
          </>
        )}
      </div>

      <form
        className="sticky bottom-[var(--shell-bottom)] z-20 -mx-4 bg-canvas px-4 pb-3 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        onKeyDown={(e) => {
          // Enter sends on a keyboard. On a phone it stays a new line, and the arrow sends.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !window.matchMedia("(pointer: coarse)").matches) {
            e.preventDefault();
            void ask(question);
          }
        }}
      >
        <div className="flex items-end gap-2">
          <NoteBox
            className="min-w-0 flex-1"
            ariaLabel="Your question"
            value={question}
            onChange={setQuestion}
            maxLength={MAX_CHARS}
            rows={1}
            placeholder={empty ? "Ask about the contract…" : "Ask a follow-up…"}
          />
          <button
            type="submit"
            aria-label="Ask"
            disabled={busy || !question.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand transition-opacity disabled:opacity-40"
          >
            <ArrowUpIcon className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 text-center text-xs leading-relaxed text-ink-muted">ALPA and the contract itself are the authority. This isn&apos;t legal advice.</p>
      </form>

      {viewing && <SectionViewer section={viewing} bidMonth={bidMonth} onClose={() => setViewing(null)} onOpen={setViewing} />}
    </div>
  );
}
