"use client";

import { apiFetch } from "@/lib/shown-account";
import { useEffect, useState } from "react";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import type { SectionView } from "@/lib/contract/types";
import { appliesLine } from "@/lib/contract/wording";

interface SectionViewerProps {
  section: string;
  bidMonth?: string;
  onClose: () => void;
  onOpen: (section: string) => void;
}

/** The section a quote came from, whole: the quote in its setting, with the 2015 wording under anything that changed. */
export function SectionViewer({ section, bidMonth, onClose, onOpen }: SectionViewerProps) {
  const [loaded, setLoaded] = useState<{ section: string; view: SectionView | null; error: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    const params = new URLSearchParams({ id: section, ...(bidMonth ? { bidMonth } : {}) });
    apiFetch(`/api/contract/section?${params}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Couldn't open that section.");
        const view = (await r.json()) as SectionView;
        if (live) setLoaded({ section, view, error: null });
      })
      .catch(() => {
        if (live) setLoaded({ section, view: null, error: "Couldn't open that section. Please try again." });
      });
    return () => {
      live = false;
    };
  }, [section, bidMonth]);

  const current = loaded?.section === section ? loaded : null;
  const view = current?.view ?? null;
  const parent = section.includes(".") ? section.slice(0, section.lastIndexOf(".")) : null;
  return (
    <Modal title={`Section ${section}`} onClose={onClose} wide>
      {!current && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}
      {current?.error && <ErrorBanner>{current.error}</ErrorBanner>}
      {view && (
        <div className="space-y-3">
          <div className="space-y-1 text-xs leading-relaxed text-ink-muted">
            <p>
              {view.path ? `${view.path} · ` : ""}
              {view.page === view.pageEnd ? `p. ${view.page}` : `pp. ${view.page}–${view.pageEnd}`}
            </p>
            <p>{appliesLine(view.applies, "2026")}</p>
            {parent && (
              <button type="button" onClick={() => onOpen(parent)} className="text-accent underline-offset-2 hover:underline">
                Show all of {parent}
              </button>
            )}
          </div>
          <div className="space-y-2 text-sm leading-relaxed text-ink">
            {view.pieces.map((p) => (
              <div key={p.id} style={{ marginLeft: `${Math.min(p.depth, 5) * 0.75}rem` }}>
                <p>
                  {p.marker && <span className="mr-1.5 font-mono text-xs text-ink-muted">{p.marker}</span>}
                  {p.title && <span className="font-medium">{p.title} </span>}
                  {p.text}
                </p>
                {p.old && (
                  <details className="mt-1 text-xs text-ink-muted">
                    <summary className="cursor-pointer">The 2015 wording</summary>
                    <p className="mt-1 leading-relaxed">{p.old}</p>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
