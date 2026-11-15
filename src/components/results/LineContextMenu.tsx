"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { useLineTiers } from "@/lib/use-line-tiers";

type Tiers = ReturnType<typeof useLineTiers>;

export interface LineMenu {
  id: string;
  x: number;
  y: number;
}

function Item({ onClick, children, disabled = false }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left text-sm text-ink transition-colors hover:bg-accent-soft/60 disabled:cursor-default disabled:text-ink-faint disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

const MENU_PAD = 8;

/**
 * Where the menu goes: at the pointer, moved left or up as far as it must to stay on screen, never past the top or the
 * left edge. Moved up by its whole height, a menu taller than the space (a phone turned sideways, or many tiers) put
 * its first items above the top of the screen, where nothing could reach them; it scrolls instead (`max-h` below).
 */
export function placeMenu(at: { x: number; y: number }, size: { width: number; height: number }, screen: { width: number; height: number }): { x: number; y: number } {
  return {
    x: Math.max(MENU_PAD, Math.min(at.x, screen.width - size.width - MENU_PAD)),
    y: Math.max(MENU_PAD, Math.min(at.y, screen.height - size.height - MENU_PAD)),
  };
}

/**
 * Right-click a line to work a block at once: select everything above or below it, then send the whole
 * selection to a tier, set it aside, or take it out — the bulk moves Acrobid's grid has, on our scored list.
 * It drives the same tier state the keyboard and drag do, so every move still teaches the brain and still undoes.
 */
export function LineContextMenu({ menu, tiers, listedIds, onClose }: { menu: LineMenu; tiers: Tiers; listedIds: string[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  // Keep the menu on screen: flip it left/up when it would spill past the edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(placeMenu(menu, el.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
  }, [menu]);

  // A menu opens onto its first item, and gives the keyboard back to where it was when it closes: left where it was, the
  // arrows went on moving the line under it. When that's gone with its line (set aside), to the line now in its place:
  // given back to nothing, focus fell to the page, and the next Tab started again at the top.
  const [neighbours] = useState(() => {
    const at = listedIds.indexOf(menu.id);
    return at < 0 ? [] : [...listedIds.slice(at + 1), ...listedIds.slice(0, at).reverse()];
  });
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    return () => {
      if (!opener) return;
      if (opener.isConnected) return opener.focus({ preventScroll: true });
      for (const id of neighbours) {
        const card = document.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(id)}"]`);
        if (!card) continue;
        // The strip's own button, which opens the line: the first stop in a card is its drag handle.
        (card.querySelector<HTMLElement>("button[aria-expanded]") ?? card.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
        return;
      }
    };
  }, [neighbours]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // The page scrolling closes it; the menu's own scroll, when it's taller than the screen, doesn't.
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node && ref.current?.contains(e.target))) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const targets = tiers.selected.has(menu.id) ? [...tiers.selected] : [menu.id];
  // The whole list, not the page of it showing: "everything below" stopped at the 25th line, and the lines under
  // "Show more" were left where they were.
  const idx = listedIds.indexOf(menu.id);
  const above = idx >= 0 ? listedIds.slice(0, idx + 1) : [];
  const below = idx >= 0 ? listedIds.slice(idx) : [];

  const selectRun = (ids: string[], word: string) => {
    tiers.select(ids);
    tiers.say(`${ids.length} line${ids.length === 1 ? "" : "s"} selected, this line and ${word}`);
    onClose();
  };
  const moveTo = (tierId: string | null) => {
    tiers.move(targets, tierId);
    onClose();
  };
  const setAside = () => {
    tiers.park(targets);
    onClose();
  };

  return (
    // The backdrop catches the next click (or right-click) anywhere and closes.
    <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        ref={ref}
        role="menu"
        aria-label="Line actions"
        className="panel-glass absolute max-h-[calc(100dvh-1rem)] min-w-52 overflow-y-auto rounded-lg border border-hairline bg-surface-raised py-1 shadow-lg"
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        // Up and Down move between the items, Home and End go to the ends, Tab leaves and closes it.
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            onClose();
            return;
          }
          const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
          const at = items.indexOf(document.activeElement as HTMLElement);
          const next =
            e.key === "ArrowDown" ? (at + 1) % items.length : e.key === "ArrowUp" ? (at - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
          if (next === null) return;
          e.preventDefault();
          e.stopPropagation();
          items[next]?.focus();
        }}
      >
        {targets.length > 1 && <p className="px-3 pb-1 pt-0.5 text-2xs font-medium uppercase tracking-wide text-ink-faint">{targets.length} lines selected</p>}
        <Item onClick={() => selectRun(above, "everything above")} disabled={idx <= 0}>Select all above</Item>
        <Item onClick={() => selectRun(below, "everything below")} disabled={idx < 0 || idx >= listedIds.length - 1}>Select all below</Item>
        {tiers.selected.size > 0 && <Item onClick={() => { tiers.clearSelected(); onClose(); }}>Clear selection</Item>}
        <div className="my-1 border-t border-hairline/70" />
        <p className="px-3 pb-0.5 pt-0.5 text-2xs font-medium uppercase tracking-wide text-ink-faint">Move {targets.length > 1 ? `${targets.length} lines` : "to"}</p>
        {tiers.state.tiers.map((t) => (
          <Item key={t.id} onClick={() => moveTo(t.id)}>{t.name}</Item>
        ))}
        <Item onClick={setAside}>Set aside</Item>
        <Item onClick={() => moveTo(null)}>Out of any tier</Item>
      </div>
    </div>
  );
}
