"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode, type SyntheticEvent } from "react";
import { AccountMenu, AccountPlaceholder } from "@/components/nav/AccountMenu";
import { AppearanceMenu } from "@/components/nav/AppearanceMenu";
import { COMING_SOON, NAV_ITEMS, disabledReason, homeTarget, navItemName, type NavTarget } from "@/components/nav/nav-items";
import { ChevronDownIcon, ChevronLeftIcon, PlayIcon, SearchIcon } from "@/components/ui/icons";
import { Wordmark } from "@/components/ui/Logo";
import { LogoFlight } from "@/components/ui/LogoFlight";
import { setRailCollapsed, useRailCollapsed } from "@/lib/rail";
import { STRATEGY_MENU, useStrategiesMenuOpen, useStrategyId, type StrategyMenuId } from "@/lib/strategy-menu";
import { hasSeenLatest, subscribeWhatsNewSeen } from "@/lib/whats-new";
import type { UserAccount } from "@/types/auth";

export type { NavTarget } from "@/components/nav/nav-items";

const SECTION_LABELS = { bid: "Your bid", flying: "Your flying", crew: "Crew" } as const;

/** The loaded bid pack, as the panel's one standing readout. */
export interface PackLabel {
  base: string;
  aircraft: string;
  seat: string;
  month: string;
}

export interface NavProps {
  /** Null on a page that isn't a sidebar destination — nothing lights up. */
  active: NavTarget | null;
  hasProfile: boolean;
  hasBidPack: boolean;
  user: UserAccount | null;
  /** The pilot's saved state has loaded: until then the account area and which destinations are open aren't known yet. */
  ready: boolean;
  inboxUnreadCount?: number;
  pack: PackLabel | null;
  onNavigate: (target: NavTarget) => void;
  /** Shows one strategy on the Strategies page, from wherever the pilot is. */
  onOpenStrategy: (id: StrategyMenuId) => void;
  onSignIn: () => void;
  onLogout: () => void;
  onOpenHowItWorks: () => void;
  onOpenFeedback: () => void;
  onOpenPalette: () => void;
}

/**
 * The name a collapsed rail shows beside an icon on hover — the label itself is still there for screen readers. Just
 * past the rail's edge, `fixed` at the row's middle (`--tip-y`, measured as the row is pointed at or focused, see
 * `placeTip`): inside the rail, which scrolls on a window too short for it, it would be cut off.
 */
function RailTip({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none fixed left-[var(--shell-left)] top-[var(--tip-y)] z-40 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-hairline bg-surface-raised px-2.5 py-1 text-xs font-medium text-ink shadow-elevated rail-collapsed:group-hover:block rail-collapsed:group-focus-visible:block"
    >
      {children}
    </span>
  );
}

/** Puts the row under the pointer, or just focused, where its `RailTip` reads it: its middle, on the screen. */
function placeTip(e: SyntheticEvent) {
  const row = e.target instanceof Element ? e.target.closest<HTMLElement>(".group") : null;
  if (row) row.style.setProperty("--tip-y", `${row.getBoundingClientRect().top + row.offsetHeight / 2}px`);
}

const ROW =
  "group relative flex w-full items-center gap-3 rounded-md py-[7px] pl-3 pr-3 text-left text-sm transition-colors duration-150 rail-collapsed:justify-center rail-collapsed:px-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]";

/** An icon that lifts a hair on hover — the switch under your finger, not a link in a list. */
function RowIcon({ icon: Icon, badge = 0 }: { icon: ComponentType<{ className?: string }>; active: boolean; badge?: number }) {
  return (
    <span className="relative shrink-0 transition-transform duration-200 ease-[var(--ease-emphasized)] group-hover:-translate-y-px group-disabled:transform-none">
      <Icon className="h-[18px] w-[18px]" />
      {badge > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-2xs font-semibold leading-none text-on-danger">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </span>
  );
}

/** A bank's heading — folded down to a short rule between banks on the icon rail. */
function SectionLabel({ children, first }: { children: ReactNode; first: boolean }) {
  return (
    <>
      <div className={`px-3 pb-1.5 text-2xs font-medium text-ink-faint rail-collapsed:hidden ${first ? "pt-1" : "pt-3"}`}>
        {children}
      </div>
      {!first && <div aria-hidden className="mx-auto my-2 hidden h-px w-6 bg-sidebar-border rail-collapsed:block" />}
    </>
  );
}

/**
 * The destinations, in three banks — this month's bid, the pilot's own flying, then the crew-wide tools — with one
 * location sign (yellow on black, yellow border: "you are here") that slides to whichever is live.
 */
function NavList({
  active,
  hasProfile,
  hasBidPack,
  ready,
  inboxUnreadCount,
  onGo,
  onOpenStrategy,
}: {
  active: NavTarget | null;
  hasProfile: boolean;
  hasBidPack: boolean;
  ready: boolean;
  inboxUnreadCount: number;
  onGo: (target: NavTarget) => void;
  onOpenStrategy: (id: StrategyMenuId) => void;
}) {
  const itemRefs = useRef<Partial<Record<NavTarget, HTMLButtonElement | null>>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const collapsed = useRailCollapsed();
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);
  const [strategiesOpen, setStrategiesOpen] = useStrategiesMenuOpen(active === "strategies");

  useLayoutEffect(() => {
    const measure = () => {
      const el = active ? itemRefs.current[active] : null;
      // Measured against the list itself, not the row's own parent: Strategies sits in a group of its own (with its list).
      const list = listRef.current;
      const next = el && list ? { top: Math.round(el.getBoundingClientRect().top - list.getBoundingClientRect().top), height: el.offsetHeight } : null;
      setIndicator((now) => (now?.top === next?.top && now?.height === next?.height ? now : next));
    };
    measure();
    // Measured again whenever the list reflows with the same row lit: coming back from the sign-in page, the sidebar
    // grows in from nothing, its first label wraps for a moment, and the sign was left half a row below its row.
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [active, collapsed]);

  return (
    <div ref={listRef} className="relative">
      {indicator && (
        <div
          aria-hidden
          className="absolute inset-x-0 z-0 rounded-[4px] bg-accent-wash ring-[1.5px] ring-inset ring-accent transition-[transform,height] duration-300 ease-[var(--ease-emphasized)]"
          style={{ transform: `translateY(${indicator.top}px)`, height: indicator.height }}
        />
      )}
      {(["bid", "flying", "crew"] as const).map((section) => (
        <div key={section} role="group" aria-label={SECTION_LABELS[section]}>
          <SectionLabel first={section === "bid"}>{SECTION_LABELS[section]}</SectionLabel>
          {NAV_ITEMS.filter((item) => item.section === section).map((item) => {
            const reason = disabledReason(item.target, hasProfile, hasBidPack, ready);
            const isActive = active === item.target;
            const isStrategies = item.target === "strategies";
            const row = (
              <button
                key={item.target}
                ref={(el) => {
                  itemRefs.current[item.target] = el;
                }}
                type="button"
                disabled={!!reason}
                title={reason}
                aria-label={reason ? `${navItemName(item)} — ${reason}` : navItemName(item)}
                aria-current={isActive ? "page" : undefined}
                onClick={() => {
                  if (isStrategies && !strategiesOpen) setStrategiesOpen(true);
                  onGo(item.target);
                }}
                className={`${ROW} z-10 mb-0.5 ${isStrategies ? "pr-9 rail-collapsed:pr-0" : ""} disabled:cursor-not-allowed disabled:opacity-40 ${
                  isActive ? "font-semibold text-on-wash" : "font-medium text-ink-muted hover:bg-ink/[0.06] hover:text-ink"
                }`}
              >
                <RowIcon icon={item.icon} active={isActive} badge={item.target === "inbox" ? inboxUnreadCount : 0} />
                <span className="truncate rail-collapsed:sr-only">{item.label}</span>
                {/* Snug enough that the row it's on, in bold, keeps its whole name: Safari cut it to "Open Ti…". */}
                {item.comingSoon && (
                  <span aria-hidden className="ml-auto shrink-0 whitespace-nowrap rounded-[2px] border border-border px-1 py-px text-2xs font-medium leading-[14px] text-ink-faint rail-collapsed:hidden">
                    {COMING_SOON}
                  </span>
                )}
                {/* The strategies' own pop-out names the row in a folded rail, so it has no tip of its own. */}
                {!reason && !isStrategies && <RailTip>{navItemName(item)}</RailTip>}
              </button>
            );
            if (!isStrategies) return row;
            return (
              <StrategiesGroup
                key={item.target}
                row={row}
                disabled={!!reason}
                open={strategiesOpen}
                onToggle={() => setStrategiesOpen(!strategiesOpen)}
                current={active === "strategies"}
                onOpenStrategy={onOpenStrategy}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Strategies, unfolded: its row, an arrow that folds the list without leaving the page, and every strategy beneath it,
 * the one on screen marked. Folded down to icons, the list pops out beside the rail on hover or focus instead.
 */
function StrategiesGroup({
  row,
  disabled,
  open,
  onToggle,
  current,
  onOpenStrategy,
}: {
  row: ReactNode;
  disabled: boolean;
  open: boolean;
  onToggle: () => void;
  /** On the Strategies page: the strategy the address shows is marked as the one on screen. */
  current: boolean;
  onOpenStrategy: (id: StrategyMenuId) => void;
}) {
  const shown = useStrategyId();
  const items = (inFlyout: boolean) => (
    <ul className={inFlyout ? "space-y-0.5" : "mb-1 ml-[22px] space-y-0.5 border-l border-sidebar-border pl-2"}>
      {STRATEGY_MENU.map((s) => {
        const isShown = current && shown === s.id;
        return (
          <li key={s.id}>
            <button
              type="button"
              title={s.name}
              aria-label={s.name}
              aria-current={isShown ? "true" : undefined}
              onClick={() => onOpenStrategy(s.id)}
              className={`block w-full truncate rounded-md px-2.5 py-[5px] text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] ${
                isShown ? "bg-ink/[0.07] font-semibold text-ink" : "text-ink-muted hover:bg-ink/[0.06] hover:text-ink"
              }`}
            >
              {s.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
  const flyoutRef = useRef<HTMLDivElement>(null);
  // The pop-out sits at the row's top, beside the rail (`fixed`, as the tips are, so the rail's scroll can't cut it off).
  // In a short window (a phone on its side) it rises as far as it must for the last strategy to stay on screen.
  const placeFlyout = (e: SyntheticEvent<HTMLDivElement>) => {
    const group = e.currentTarget;
    const top = group.getBoundingClientRect().top;
    const place = () => {
      const height = flyoutRef.current?.offsetHeight ?? 0;
      group.style.setProperty("--flyout-y", `${height ? Math.max(8, Math.min(top, window.innerHeight - height - 8)) : top}px`);
      return height > 0;
    };
    if (!place()) requestAnimationFrame(place);
  };
  return (
    <div className="group/strat relative" onPointerEnter={placeFlyout} onFocus={placeFlyout}>
      {row}
      {!disabled && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="sidebar-strategies"
          aria-label={open ? "Hide the strategies list" : "Show every strategy"}
          className="absolute right-1 top-[5px] z-20 flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] rail-collapsed:hidden"
        >
          <ChevronDownIcon className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      )}
      {!disabled && open && (
        <div id="sidebar-strategies" className="relative z-10 rail-collapsed:hidden">
          {items(false)}
        </div>
      )}
      {!disabled && (
        <div
          ref={flyoutRef}
          role="group"
          aria-label="Strategies"
          className="fixed left-[var(--shell-left)] top-[var(--flyout-y)] z-40 hidden max-h-[calc(100dvh-1rem)] w-60 overflow-y-auto rounded-md border border-hairline bg-surface-raised p-1.5 shadow-elevated rail-collapsed:group-hover/strat:block rail-collapsed:group-focus-within/strat:block"
        >
          <p className="px-2.5 pb-1 pt-0.5 text-2xs font-medium text-ink-faint">Strategies</p>
          {items(true)}
        </div>
      )}
    </div>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 17v-5M12 8h.01" />
    </svg>
  );
}

function FeedbackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5a8.38 8.38 0 01-1.9 5.4L21 21l-4.65-1.55a8.5 8.5 0 11-6.85-15A8.5 8.5 0 0121 11.5z" />
    </svg>
  );
}

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className}>
      <path strokeLinejoin="round" d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z" />
      <path strokeLinecap="round" d="M19 16v4M17 18h4" />
    </svg>
  );
}

/** What's new, with a yellow dot until this device has seen the latest entry. */
function WhatsNewLink() {
  const [unseen, setUnseen] = useState(false);
  useEffect(() => {
    // Read after mount: the server can't know what this device has seen. Read again whenever it's seen from anywhere
    // else (the footer link, the palette, another tab), so the dot doesn't stay once the page has been read.
    const read = () => setUnseen(!hasSeenLatest());
    read();
    return subscribeWhatsNewSeen(read);
  }, []);
  return (
    <Link href="/whats-new" onClick={() => setUnseen(false)} className={`${ROW} font-medium text-ink-faint hover:bg-ink/[0.06] hover:text-ink-muted`}>
      <span className="relative">
        <RowIcon icon={SparkIcon} active={false} />
        {unseen && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-sidebar" />}
      </span>
      <span className="rail-collapsed:sr-only">
        What&rsquo;s new{unseen && <span className="sr-only"> (new things since you last looked)</span>}
      </span>
      <RailTip>What&rsquo;s new</RailTip>
    </Link>
  );
}

export { InfoIcon, FeedbackIcon };

/**
 * The desktop instrument rail: the mark, a standing readout of the loaded
 * pack, the destinations, and the utilities — foldable down to icons (the
 * choice is remembered on this device). Phones get `PhoneNav` instead.
 */
export function LeftNav({
  active,
  hasProfile,
  hasBidPack,
  user,
  ready,
  inboxUnreadCount = 0,
  pack,
  onNavigate,
  onOpenStrategy,
  onSignIn,
  onLogout,
  onOpenHowItWorks,
  onOpenFeedback,
  onOpenPalette,
}: NavProps) {
  const collapsed = useRailCollapsed();

  return (
    <aside
      aria-label="Main"
      style={{ viewTransitionName: "app-rail" }}
      onPointerOver={placeTip}
      onFocus={placeTip}
      className="sidebar-scheme shadow-sidebar fixed inset-y-0 left-0 z-30 hidden w-[var(--shell-left)] flex-col overflow-y-auto overscroll-contain border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-[var(--ease-emphasized)] md:flex"
    >
      <div className="relative flex items-center justify-between gap-2 border-b border-sidebar-border/70 px-4 py-4 rail-collapsed:flex-col rail-collapsed:gap-3 rail-collapsed:px-0">
        <button
          type="button"
          onClick={() => onNavigate(homeTarget(hasProfile, hasBidPack))}
          aria-label="Line Select home"
          className="group relative flex min-w-0 items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        >
          <LogoFlight className="h-9 w-9 shrink-0 transition-transform duration-200 group-hover:scale-105" />
          <Wordmark className="h-9 text-[15px] rail-collapsed:hidden" />
        </button>
        <AppearanceMenu />
      </div>

      {pack && (
        <div className="mx-3 mt-3 rounded-[4px] border border-border px-3 py-2 rail-collapsed:hidden">
          <div className="flex items-center justify-between text-2xs text-ink-faint font-medium">
            <span>Bid pack</span>
            <span className="flex items-center gap-1.5 text-good">
              {/* A steady green centreline light: loaded and clear to go. */}
              <span className="h-1.5 w-1.5 rounded-full bg-good" aria-hidden />
              Loaded
            </span>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2 font-mono text-[13px] font-semibold tabular-nums">
            <span className="truncate text-readout">
              {pack.base} &middot; {pack.aircraft} &middot; {pack.seat}
            </span>
            <span className="shrink-0 text-accent">{pack.month}</span>
          </div>
        </div>
      )}

      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={onOpenPalette}
          aria-keyshortcuts="Meta+K Control+K"
          className={`${ROW} border border-hairline bg-canvas/30 !py-2 font-medium text-ink-faint hover:border-border-strong hover:text-ink-muted rail-collapsed:border-transparent rail-collapsed:bg-transparent`}
        >
          <RowIcon icon={SearchIcon} active={false} />
          <span className="flex-1 rail-collapsed:sr-only">Jump to line…</span>
          <kbd className="rounded border border-hairline px-1.5 font-mono text-2xs text-ink-faint rail-collapsed:hidden">⌘K</kbd>
          <RailTip>Jump to line (⌘K)</RailTip>
        </button>
      </div>

      {/* The one part that scrolls, on a window too short for the whole rail, so the links below stay in view. On a
          window shorter still (a phone held sideways, 390 px) it keeps room for a few rows and the whole rail scrolls
          instead: shrunk to nothing, every destination was out of sight and the account was below the screen's edge.
          The icon rail (about 940 px, taller than a laptop's window) always scrolls whole: held still, its last links,
          Expand and the account were below the screen's edge. Its tips and menus are `fixed`, so that doesn't cut them
          off where they stand out past its edge. */}
      <nav aria-label="Destinations" className="min-h-36 flex-1 overflow-y-auto px-3 pb-2 pt-3 rail-collapsed:min-h-fit rail-collapsed:overflow-visible">
        <NavList active={active} hasProfile={hasProfile} hasBidPack={hasBidPack} ready={ready} inboxUnreadCount={inboxUnreadCount} onGo={onNavigate} onOpenStrategy={onOpenStrategy} />
      </nav>

      <div className="space-y-0.5 border-t border-sidebar-border/70 px-3 py-2">
        <button type="button" onClick={onOpenHowItWorks} className={`${ROW} font-medium text-ink-faint hover:bg-ink/[0.06] hover:text-ink-muted`}>
          <RowIcon icon={InfoIcon} active={false} />
          <span className="rail-collapsed:sr-only">How this works</span>
          <RailTip>How this works</RailTip>
        </button>
        <Link href="/tutorial" className={`${ROW} font-medium text-ink-faint hover:bg-ink/[0.06] hover:text-ink-muted`}>
          <RowIcon icon={PlayIcon} active={false} />
          <span className="rail-collapsed:sr-only">Tutorial</span>
          <RailTip>Tutorial</RailTip>
        </Link>
        <WhatsNewLink />
        <button type="button" onClick={onOpenFeedback} className={`${ROW} font-medium text-ink-faint hover:bg-ink/[0.06] hover:text-ink-muted`}>
          <RowIcon icon={FeedbackIcon} active={false} />
          <span className="rail-collapsed:sr-only">Send feedback</span>
          <RailTip>Send feedback</RailTip>
        </button>
        <button
          type="button"
          onClick={() => setRailCollapsed(!collapsed)}
          aria-pressed={collapsed}
          className={`${ROW} font-medium text-ink-faint hover:bg-ink/[0.06] hover:text-ink-muted`}
        >
          <span className="shrink-0 transition-transform duration-300 rail-collapsed:rotate-180">
            <ChevronLeftIcon className="h-[18px] w-[18px]" />
          </span>
          <span className="rail-collapsed:sr-only">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
          <RailTip>Expand sidebar</RailTip>
        </button>
      </div>

      <div className="border-t border-sidebar-border px-3 py-3">
        {ready ? <AccountMenu user={user} onSignIn={onSignIn} onLogout={onLogout} /> : <AccountPlaceholder />}
      </div>
    </aside>
  );
}
