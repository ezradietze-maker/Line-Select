"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { NAV_ITEMS, disabledReason, type NavTarget } from "@/components/nav/nav-items";
import { FlipText } from "@/components/ui/FlipText";
import { SearchIcon } from "@/components/ui/icons";
import { rankingSnapshotFor } from "@/lib/ranking-snapshot";
import { setStoredTheme, type ThemeMode } from "@/lib/theme";
import type { Line } from "@/types/bidpack";

interface Command {
  id: string;
  group: "Lines" | "Go to" | "Appearance" | "Help";
  label: string;
  hint?: string;
  /** Extra words it answers to. */
  keywords?: string;
  icon?: ComponentType<{ className?: string }>;
  /** A line's place in the pilot's ranking and its score, when the rankings have been worked out this visit. */
  standing?: { rank: number; score: number };
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  lines: Line[] | null;
  bidPackId: string | null;
  hasProfile: boolean;
  hasBidPack: boolean;
  onNavigate: (target: NavTarget) => void;
  onOpenLine: (lineNumber: string) => void;
  onOpenHowItWorks: () => void;
  onOpenFeedback: () => void;
}

const THEMES: { mode: ThemeMode; label: string; keywords: string }[] = [
  { mode: "light", label: "Light theme", keywords: "day bright" },
  { mode: "dark", label: "Dark theme", keywords: "dim" },
  { mode: "night", label: "Night theme — red cockpit lighting", keywords: "red night vision" },
  { mode: "system", label: "Match the system theme", keywords: "auto device" },
];

function formatHours(hours: number): string {
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** How many lines show for a number typed in — enough to pick from, not a second rankings list. */
const MAX_LINES = 8;

/**
 * ⌘K (Ctrl+K, or "/") from anywhere: type a line number to open that line on
 * your rankings, or a word to jump to a screen or switch the lighting. A pilot
 * reading a line number off a crew-room sheet gets to it in two keystrokes
 * instead of scrolling a list of three hundred.
 */
export function CommandPalette({ open, onClose, lines, bidPackId, hasProfile, hasBidPack, onNavigate, onOpenLine, onOpenHowItWorks, onOpenFeedback }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Fresh each time it opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }

  const commands = useMemo<Command[]>(() => {
    const close = (f: () => void) => () => {
      onClose();
      f();
    };
    const pages: Command[] = NAV_ITEMS.filter((item) => !disabledReason(item.target, hasProfile, hasBidPack)).map((item) => ({
      id: `go-${item.target}`,
      group: "Go to",
      label: item.label,
      keywords: `${item.tabLabel} ${item.target}`,
      icon: item.icon,
      run: close(() => onNavigate(item.target)),
    }));
    const themes: Command[] = THEMES.map((t) => ({
      id: `theme-${t.mode}`,
      group: "Appearance",
      label: t.label,
      keywords: `theme mode ${t.keywords}`,
      run: close(() => setStoredTheme(t.mode)),
    }));
    const help: Command[] = [
      { id: "how", group: "Help", label: "How this works", keywords: "help score explain", run: close(onOpenHowItWorks) },
      { id: "feedback", group: "Help", label: "Send feedback", keywords: "bug report idea", run: close(onOpenFeedback) },
    ];
    return [...pages, ...themes, ...help];
  }, [hasProfile, hasBidPack, onClose, onNavigate, onOpenHowItWorks, onOpenFeedback]);

  // Read fresh each render: the rankings may have been worked out since the palette was last shown.
  const ranking = open && bidPackId ? rankingSnapshotFor(bidPackId) : null;
  const results = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/^line\s*/, "").replace(/\D/g, "");
    const lineHits: Command[] =
      hasProfile && lines && digits && /^(line\s*)?\d+$/.test(q)
        ? lines
            .filter((l) => l.lineNumber.includes(digits))
            // A line whose number starts with what was typed first, then the rest in order.
            .sort((a, b) => Number(!b.lineNumber.startsWith(digits)) - Number(!a.lineNumber.startsWith(digits)) || a.lineNumber.localeCompare(b.lineNumber, undefined, { numeric: true }))
            .slice(0, MAX_LINES)
            .map((l) => ({
              id: `line-${l.id}`,
              group: "Lines",
              label: `Line ${l.lineNumber}`,
              standing: ranking?.byLineId.get(l.id),
              hint: `${formatHours(l.totalCreditHours)} credit · ${l.daysOff} days off · ${l.trips.length} trip${l.trips.length === 1 ? "" : "s"}`,
              run: () => {
                onClose();
                onOpenLine(l.lineNumber);
              },
            }))
        : [];
    const words = q.split(/\s+/).filter(Boolean);
    const rest = commands.filter((c) => {
      const hay = `${c.label} ${c.keywords ?? ""} ${c.group}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    return [...lineHits, ...rest];
  }, [query, lines, ranking, hasProfile, commands, onClose, onOpenLine]);

  const active = Math.min(cursor, Math.max(0, results.length - 1));

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    document.body.style.overflow = "hidden";
    // It's modal: focus that lands on the page behind (a screen reader's cursor, a click through) comes back to the box.
    const keepFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Node && !dialogRef.current?.contains(e.target)) inputRef.current?.focus();
    };
    document.addEventListener("focusin", keepFocusIn);
    return () => {
      document.removeEventListener("focusin", keepFocusIn);
      document.body.style.overflow = "";
      previouslyFocused?.focus?.();
    };
  }, [open]);

  // Its keys are heard wherever focus is while it's open, not only inside the box: once Tab had taken focus out (in
  // Safari, on the very first Tab, since its Tab skips buttons), Esc no longer closed it.
  useEffect(() => {
    if (!open) return;
    /** The option with focus, when one has it rather than the search box. */
    const focusedOption = () => {
      const el = document.activeElement;
      return el instanceof HTMLElement && el.getAttribute("role") === "option" && listRef.current?.contains(el) ? Number(el.dataset.index) : null;
    };
    /** The highlight moves; so does focus when it's on an option, or Enter would open the one it left. */
    const move = (by: number) => {
      if (!results.length) return;
      const next = (active + by + results.length) % results.length;
      setCursor(next);
      if (focusedOption() !== null) listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus();
    };
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        // Only the palette closes, not a dialog it was opened over.
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        move(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        // The option Tab moved focus to, when it's on one; otherwise the highlighted one.
        results[focusedOption() ?? active]?.run();
      } else if (e.key === "Tab") {
        // Round the search box and the options, never out to the page behind. Moved by hand: Safari's own Tab skips
        // the options and leaves.
        e.preventDefault();
        const stops = [inputRef.current, ...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].filter((el): el is HTMLElement => !!el);
        const at = stops.indexOf(document.activeElement as HTMLElement);
        stops[at === -1 ? 0 : (at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
      }
    }
    // Capturing, so it's heard first, wherever focus is.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, results, active, onClose]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  let lastGroup: string | null = null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" role="presentation">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="animate-fade-in absolute inset-0 cursor-default bg-black/40 backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a line or screen"
        ref={dialogRef}
        className="animate-palette-in relative w-full max-w-lg overflow-hidden rounded-[8px] border border-border bg-surface shadow-elevated-lg"
      >
        <div className="flex items-center gap-3 border-b border-hairline px-4">
          <SearchIcon className="h-4 w-4 shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            placeholder={hasProfile && lines ? "Type a line number, or where to go…" : "Where to go…"}
            aria-label="Search"
            data-no-ring
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
            className="h-12 w-full bg-transparent text-[15px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-hairline px-1.5 py-0.5 font-mono text-2xs text-ink-faint sm:block">esc</kbd>
        </div>
        <div ref={listRef} id="palette-results" role="listbox" aria-label="Results" className="max-h-[min(60vh,26rem)] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-faint">
              {/^\d+$/.test(query.trim()) ? `No line ${query.trim()} in this bid pack.` : "Nothing matches that."}
            </p>
          ) : (
            results.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              const Icon = c.icon;
              return (
                <div key={c.id}>
                  {header && <div className="px-3 pb-1 pt-2.5 text-2xs text-ink-faint font-medium">{header}</div>}
                  <button
                    type="button"
                    id={`palette-${c.id}`}
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    onMouseMove={() => setCursor(i)}
                    // Tabbed to, it's the one lit and the one Enter opens.
                    onFocus={() => setCursor(i)}
                    onClick={c.run}
                    className={`flex w-full items-center gap-3 rounded-[4px] px-3 py-2.5 text-left text-sm transition-colors ${
                      i === active ? "bg-accent-wash text-on-wash ring-[1.5px] ring-inset ring-accent" : "text-ink-muted"
                    }`}
                  >
                    {Icon ? (
                      <Icon className="h-4 w-4 shrink-0" />
                    ) : c.standing ? (
                      <span className={`w-9 shrink-0 font-mono text-2xs tabular-nums ${i === active ? "text-on-wash" : "text-ink-faint"}`}>#{c.standing.rank}</span>
                    ) : (
                      <span className="h-4 w-4 shrink-0" aria-hidden />
                    )}
                    {/* Lines turn over like rows on a departures board, one row after the next. */}
                    <span className={`min-w-0 flex-1 truncate ${c.group === "Lines" ? "font-mono font-semibold" : "font-medium"}`}>
                      {c.group === "Lines" ? <FlipText text={c.label} delay={Math.min(i, 8) * 45} stagger={22} /> : c.label}
                    </span>
                    {c.standing && (
                      <span className="shrink-0 rounded-md border border-hairline px-1.5 py-0.5 font-mono text-2xs font-semibold tabular-nums" title="Score">
                        {c.group === "Lines" ? <FlipText text={String(Math.round(c.standing.score))} delay={Math.min(i, 8) * 45 + 160} stagger={30} /> : Math.round(c.standing.score)}
                      </span>
                    )}
                    {c.hint && <span className={`hidden shrink-0 font-mono text-2xs tabular-nums sm:block ${i === active ? "text-on-wash" : "text-ink-faint"}`}>{c.hint}</span>}
                    {i === active && <span className="shrink-0 font-mono text-2xs text-on-wash" aria-hidden>↵</span>}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-hairline px-4 py-2 font-mono text-2xs text-ink-faint">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span className="ml-auto hidden sm:inline">⌘K anywhere</span>
        </div>
      </div>
    </div>
  );
}
