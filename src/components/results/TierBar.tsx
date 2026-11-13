"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes } from "react";
import { Button } from "@/components/ui/Button";
import { FIELD } from "@/components/ui/field";
import { Modal } from "@/components/ui/Modal";
import { canAddTier, DEFAULT_TIERS, type TierHeading as Heading } from "@/lib/line-tiers";
import type { LineScore } from "@/lib/scoring";
import type { LineTiers } from "@/lib/use-line-tiers";

const LONG_PRESS_MS = 500;
const PRESS_SLOP_PX = 8;

export type CardPressProps = Pick<HTMLAttributes<HTMLDivElement>, "onClickCapture" | "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel">;

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
function selectableCardProps(now: () => { tiers: LineTiers; listedIds: string[] }, lineId: string): CardPressProps {
  // The tiers and the list are read when a press happens, not when the handlers are made: made once per line, they
  // never hold on to an old render's list.
  const inControl = (t: EventTarget) => t instanceof Element && !!t.closest("[data-tier-control], [data-drag-handle]");
  return {
    onClickCapture: (e) => {
      const { tiers, listedIds } = now();
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
        now().tiers.toggleSelected(lineId);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      if (press.start && Math.hypot(e.clientX - press.start.x, e.clientY - press.start.y) > PRESS_SLOP_PX) endPress();
    },
    onPointerUp: endPress,
    onPointerCancel: endPress,
  };
}

/**
 * Each card's press handlers, made once per line and reading the newest tiers and list when pressed. Handlers made fresh
 * each render each held on to that render's whole list, for as long as anything kept the handler.
 */
export function useCardPressProps(tiers: LineTiers, listedIds: string[]): (lineId: string) => CardPressProps {
  const now = useRef({ tiers, listedIds });
  useLayoutEffect(() => {
    now.current = { tiers, listedIds };
  });
  const [made] = useState(() => new Map<string, CardPressProps>());
  return useCallback(
    (lineId: string) => {
      let props = made.get(lineId);
      if (!props) made.set(lineId, (props = selectableCardProps(() => now.current, lineId)));
      return props;
    },
    [made]
  );
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

/** The page's one undo history, across tier changes and swaps alike (see `lib/order-history.ts`). */
export interface OrderUndo {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/** Tiers above the list: what's in each, undo and redo, the scratch area, and the bar for moving a selection. */
export function TierBar({ tiers, lines, history }: { tiers: LineTiers; lines: LineScore[]; history: OrderUndo }) {
  const { state, selected } = tiers;
  const { undo, redo } = history;
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
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <button type="button" onClick={undo} disabled={!history.canUndo} className={small}>
            Undo
          </button>
          <button type="button" onClick={redo} disabled={!history.canRedo} className={small}>
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
  // Names as typed, by tier. Saved on Enter, on leaving the box, and on closing however it's closed: Esc used to drop
  // a name the X kept, since only the X's click took focus out of the box first.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const addRef = useRef<HTMLInputElement>(null);
  const field = `w-full ${FIELD}`;
  const save = (tierId: string) => {
    const typed = drafts[tierId]?.trim();
    const current = tiers.state.tiers.find((t) => t.id === tierId)?.name;
    if (typed && current !== undefined && typed !== current) tiers.rename(tierId, typed);
  };
  const close = () => {
    for (const id of Object.keys(drafts)) save(id);
    onClose();
  };
  return (
    <Modal title="Rename or add tiers" onClose={close}>
      <ul className="space-y-2">
        {tiers.state.tiers.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <input
              value={drafts[t.id] ?? t.name}
              aria-label={`Name for the tier now called ${t.name}`}
              maxLength={30}
              onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                save(t.id);
              }}
              onBlur={() => save(t.id)}
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
