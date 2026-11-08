"use client";

import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { canAddTier, DEFAULT_TIERS, type TierHeading as Heading } from "@/lib/line-tiers";
import type { LineScore } from "@/lib/scoring";
import type { LineTiers } from "@/lib/use-line-tiers";

const LONG_PRESS_MS = 500;
const PRESS_SLOP_PX = 8;

type CardPressProps = Pick<HTMLAttributes<HTMLDivElement>, "onClickCapture" | "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel">;

/** The press under way. One finger at a time, and it has to outlive the re-render its own long-press causes. */
const press: { timer?: number; start: { x: number; y: number } | null; longPressed: boolean } = { start: null, longPressed: false };
const endPress = () => {
  window.clearTimeout(press.timer);
  press.start = null;
};

/**
 * What makes a card selectable: shift-click for a run, cmd/ctrl-click for one more, long-press on a phone, and while a
 * selection is going, any tap. A plain click with nothing selected still opens the line.
 */
export function selectableCardProps(tiers: LineTiers, lineId: string, listedIds: string[]): CardPressProps {
  const inControl = (t: EventTarget) => t instanceof Element && !!t.closest("[data-tier-control], [data-drag-handle]");
  return {
    onClickCapture: (e) => {
      if (inControl(e.target)) return;
      // The click that ends a long-press has already done its work.
      if (press.longPressed) {
        press.longPressed = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.shiftKey || e.metaKey || e.ctrlKey || tiers.selected.size > 0) {
        e.preventDefault();
        e.stopPropagation();
        tiers.toggleSelected(lineId, e.shiftKey ? listedIds : undefined);
      }
    },
    onPointerDown: (e) => {
      press.longPressed = false;
      if (e.pointerType !== "touch" || inControl(e.target)) return;
      press.start = { x: e.clientX, y: e.clientY };
      press.timer = window.setTimeout(() => {
        press.longPressed = true;
        tiers.toggleSelected(lineId);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      if (press.start && Math.hypot(e.clientX - press.start.x, e.clientY - press.start.y) > PRESS_SLOP_PX) endPress();
    },
    onPointerUp: endPress,
    onPointerCancel: endPress,
  };
}

/** Over each group in the list: a tier's name and how many lines it has. The lines themselves carry nothing new. */
export function TierHeadingRow({ heading }: { heading: Heading }) {
  return (
    <div role="heading" aria-level={2} className="flex items-baseline gap-2 px-1 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
      {heading.name}
      <span className="font-normal normal-case tracking-normal">
        {heading.count} {heading.count === 1 ? "line" : "lines"}
      </span>
    </div>
  );
}

/** The move buttons in an opened line: one press, no dragging (WCAG 2.5.7). */
export function TierMoveRow({ tiers, lineId }: { tiers: LineTiers; lineId: string }) {
  const current = tiers.tierOf(lineId);
  const chip = (active: boolean) => `min-h-8 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? "border-accent bg-accent-soft text-accent" : "border-hairline text-ink-muted hover:border-accent hover:text-accent"}`;
  return (
    <div data-tier-control role="group" aria-label="Move this line" className="flex flex-wrap items-center gap-1.5 border-b border-hairline px-5 py-2 sm:px-6 print:hidden">
      <span className="text-xs font-medium text-ink-muted">Tier</span>
      {tiers.state.tiers.map((t) => (
        <button key={t.id} type="button" aria-pressed={current === t.id} onClick={() => tiers.move([lineId], t.id)} className={chip(current === t.id)}>
          {t.name}
        </button>
      ))}
      {current && (
        <button type="button" onClick={() => tiers.move([lineId], null)} className={chip(false)}>
          No tier
        </button>
      )}
      <button type="button" onClick={() => tiers.park([lineId])} className={chip(false)}>
        Set aside
      </button>
      <button type="button" aria-pressed={tiers.selected.has(lineId)} onClick={() => tiers.toggleSelected(lineId)} className={chip(tiers.selected.has(lineId))}>
        Select
      </button>
    </div>
  );
}

/** Tiers above the list: what's in each, undo and redo, the scratch area, and the bar for moving a selection. */
export function TierBar({ tiers, lines }: { tiers: LineTiers; lines: LineScore[] }) {
  const { state, selected, undo, redo } = tiers;
  const [managing, setManaging] = useState(false);
  const counts = new Map<string, number>();
  for (const id of Object.keys(state.assigned)) counts.set(state.assigned[id], (counts.get(state.assigned[id]) ?? 0) + 1);
  const numberOf = (id: string) => lines.find((r) => r.line.id === id)?.line.lineNumber ?? id;

  // ⌘Z and ⇧⌘Z, unless a text field has its own undo to run.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const small = "min-h-8 rounded-md px-2 py-1 text-xs font-semibold text-accent underline-offset-2 hover:underline disabled:cursor-default disabled:text-ink-faint disabled:no-underline";
  const notBidCount = tiers.notBid.size;

  return (
    <div data-tier-control className="mt-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm print:hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-ink">Tiers</span>
        {tiers.inUse ? (
          <span className="text-xs text-ink-muted">{state.tiers.map((t) => `${t.name} ${counts.get(t.id) ?? 0}`).join(" · ")}</span>
        ) : (
          <span className="text-xs text-ink-muted">
            Open a line and pick a tier<span className="hidden sm:inline">, or press 1&ndash;{Math.min(state.tiers.length, 9)} on it. Shift-click to pick several</span>
            <span className="sm:hidden">. Long-press to pick several</span>.
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={undo} disabled={!tiers.canUndo} className={small}>
            Undo
          </button>
          <button type="button" onClick={redo} disabled={!tiers.canRedo} className={small}>
            Redo
          </button>
          <button type="button" onClick={() => setManaging(true)} className={small}>
            Rename or add
          </button>
        </span>
      </div>
      {notBidCount > 0 && <p className="mt-1 text-xs text-ink-muted">Send to VIPS and Copy follow these tiers and leave out {notBidCount === 1 ? "the 1 Not bid line" : `the ${notBidCount} Not bid lines`}.</p>}

      {state.setAside.length > 0 && (
        <div className="mt-2 border-t border-hairline pt-2">
          <p className="text-xs text-ink-muted">Set aside: out of the list while you sort, still in your bid where they&rsquo;d rank.</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {state.setAside.map((id) => (
              <button key={id} type="button" onClick={() => tiers.unpark([id])} className="min-h-8 rounded-full border border-hairline px-2.5 py-1 font-mono text-xs text-ink hover:border-accent" aria-label={`Bring line ${numberOf(id)} back to the list`}>
                {numberOf(id)} &#8617;
              </button>
            ))}
          </div>
        </div>
      )}

      <p role="status" className="sr-only">
        {tiers.said}
      </p>

      {selected.size > 0 && (
        <div role="toolbar" aria-label={`Move ${selected.size} selected lines`} className="fixed inset-x-3 bottom-20 z-30 flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface p-2 shadow-elevated-lg md:bottom-4 md:left-1/2 md:right-auto md:w-max md:max-w-[90vw] md:-translate-x-1/2">
          <span className="px-1 text-xs font-medium text-ink">{selected.size} selected</span>
          {state.tiers.map((t) => (
            <button key={t.id} type="button" onClick={() => tiers.move([...selected], t.id)} className="min-h-9 rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-ink hover:border-accent hover:text-accent">
              {t.name}
            </button>
          ))}
          <button type="button" onClick={() => tiers.move([...selected], null)} className="min-h-9 rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-ink-muted hover:border-accent">
            No tier
          </button>
          <button type="button" onClick={() => tiers.park([...selected])} className="min-h-9 rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-ink-muted hover:border-accent">
            Set aside
          </button>
          <button type="button" onClick={tiers.clearSelected} className="min-h-9 rounded-md px-2.5 py-1 text-xs font-semibold text-accent hover:underline">
            Clear
          </button>
        </div>
      )}

      {managing && <ManageTiers tiers={tiers} onClose={() => setManaging(false)} />}
    </div>
  );
}

function ManageTiers({ tiers, onClose }: { tiers: LineTiers; onClose: () => void }) {
  const [name, setName] = useState("");
  const addRef = useRef<HTMLInputElement>(null);
  const field = "w-full rounded-md border border-hairline bg-canvas/50 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";
  return (
    <Modal title="Rename or add tiers" onClose={onClose}>
      <ul className="space-y-2">
        {tiers.state.tiers.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <input
              defaultValue={t.name}
              aria-label={`Name for the tier now called ${t.name}`}
              maxLength={30}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value.trim() !== t.name) tiers.rename(t.id, e.target.value);
              }}
              className={field}
            />
            {!DEFAULT_TIERS.some((d) => d.id === t.id) && (
              <button type="button" onClick={() => tiers.remove(t.id)} aria-label={`Remove the tier ${t.name}`} className="min-h-9 shrink-0 px-2 text-sm font-semibold text-accent hover:underline">
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {canAddTier(tiers.state) && (
        <form
          className="mt-4 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            tiers.add(name);
            setName("");
            addRef.current?.focus();
          }}
        >
          <input ref={addRef} value={name} onChange={(e) => setName(e.target.value)} maxLength={30} aria-label="New tier name" placeholder="New tier" className={field} />
          <Button type="submit" variant="secondary" disabled={!name.trim()} className="shrink-0">
            Add
          </Button>
        </form>
      )}
      <p className="mt-3 text-xs text-ink-muted">New tiers go after Good and above the lines with no tier. Not bid always stays out of what gets sent.</p>
      {tiers.inUse && (
        <button
          type="button"
          onClick={() => {
            tiers.clear();
            onClose();
          }}
          className="mt-3 text-sm font-semibold text-accent hover:underline"
        >
          Clear every line&rsquo;s tier
        </button>
      )}
    </Modal>
  );
}
