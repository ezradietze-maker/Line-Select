"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReadingProgress } from "@/components/ui/ReadingProgress";
import { markLatestSeen, WHATS_NEW } from "@/lib/whats-new";

export default function WhatsNewPage() {
  useEffect(() => markLatestSeen(), []);
  const byDate = WHATS_NEW.reduce<Record<string, typeof WHATS_NEW>>((acc, e) => ({ ...acc, [e.date]: [...(acc[e.date] ?? []), e] }), {});
  return (
    <div className="mx-auto w-full max-w-2xl">
      <ReadingProgress />
      <PageHeader eyebrow="Line Select" title="What’s new" description="What’s changed lately, newest first." />
      <ol className="mt-8 space-y-8">
        {Object.entries(byDate).map(([date, entries]) => (
          <li key={date}>
            <div className="text-2xs text-accent font-medium">
              {new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
            </div>
            <ul className="mt-3 space-y-3">
              {entries.map((e) => (
                <li key={e.title} className="panel-glass p-4">
                  <h2 className="font-display text-lg font-semibold text-ink">{e.title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{e.body}</p>
                  {e.href && (
                    <Link href={e.href} className="mt-2 inline-block text-sm font-medium text-accent underline decoration-dotted underline-offset-4">
                      Take a look
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
