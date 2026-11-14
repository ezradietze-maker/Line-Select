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
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      x: Math.min(menu.x, window.innerWidth - width - pad),
      y: Math.min(menu.y, window.innerHeight - height - pad),
    });
  }, [menu.x, menu.y]);

  // A menu opens onto its first item, and gives the keyboard back to where it was when it closes: left where it was, the
  // arrows went on moving the line under it.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    return () => opener?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onScroll = () => onClose();
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
        className="panel-glass absolute min-w-52 overflow-hidden rounded-lg border border-hairline bg-surface-raised py-1 shadow-lg"
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
