"use client";

import { appliesLine } from "@/lib/contract/wording";
import type { AnswerQuote } from "@/lib/contract/types";

/** One quote: the contract's words, where they are, and when they apply. */
export function QuoteCard({ quote, onOpen }: { quote: AnswerQuote; onOpen: (section: string) => void }) {
  const other = quote.version === "2026" ? "2015" : "2026";
  return (
    <article className="panel-glass p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <button type="button" onClick={() => onOpen(quote.section)} className="font-mono text-sm font-medium text-accent underline-offset-2 hover:underline">
          {quote.section}
        </button>
        <span className="text-xs text-ink-muted">
          {quote.path ? `${quote.path} · ` : ""}p. {quote.page}
          {quote.version === "2015" ? " · 2015 wording" : ""}
        </span>
      </div>
      <blockquote className="mt-2 border-l-2 border-accent/40 pl-3 text-sm leading-relaxed text-ink">{quote.quote}</blockquote>
      <p className="mt-2 text-xs leading-relaxed text-ink-muted">{appliesLine(quote.applies, quote.version)}</p>
      {quote.otherWording && (
        <details className="mt-2 text-xs text-ink-muted">
          <summary className="cursor-pointer">The {other} wording</summary>
          <p className="mt-1 leading-relaxed">{quote.otherWording}</p>
        </details>
      )}
    </article>
  );
}
