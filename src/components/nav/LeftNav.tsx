"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { AccountMenu, AccountPlaceholder } from "@/components/nav/AccountMenu";
import { AppearanceMenu } from "@/components/nav/AppearanceMenu";
import { NAV_ITEMS, disabledReason, homeTarget, type NavTarget } from "@/components/nav/nav-items";
import { ChevronLeftIcon, SearchIcon } from "@/components/ui/icons";
import { Wordmark } from "@/components/ui/Logo";
import { LogoFlight } from "@/components/ui/LogoFlight";
import { setRailCollapsed, useRailCollapsed } from "@/lib/rail";
import { hasSeenLatest } from "@/lib/whats-new";
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
  onSignIn: () => void;
  onLogout: () => void;
  onOpenHowItWorks: () => void;
  onOpenFeedback: () => void;
  onOpenPalette: () => void;
}

/** The name a collapsed rail shows beside an icon on hover — the label itself is still there for screen readers. */
function RailTip({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-full top-1/2 z-40 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-hairline bg-surface-raised px-2.5 py-1 text-xs font-medium text-ink shadow-elevated rail-collapsed:group-hover:block rail-collapsed:group-focus-visible:block"
    >
      {children}
    </span>
  );
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
}: {
  active: NavTarget | null;
  hasProfile: boolean;
  hasBidPack: boolean;
  ready: boolean;
  inboxUnreadCount: number;
  onGo: (target: NavTarget) => void;
}) {
  const itemRefs = useRef<Partial<Record<NavTarget, HTMLButtonElement | null>>>({});
  const collapsed = useRailCollapsed();
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = active ? itemRefs.current[active] : null;
    setIndicator(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
  }, [active, collapsed]);

  return (
    <div className="relative">
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
            return (
              <button
                key={item.target}
                ref={(el) => {
                  itemRefs.current[item.target] = el;
                }}
                type="button"
                disabled={!!reason}
                title={reason}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onGo(item.target)}
                className={`${ROW} z-10 mb-0.5 disabled:cursor-not-allowed disabled:opacity-40 ${
                  isActive ? "font-semibold text-on-wash" : "font-medium text-ink-muted hover:bg-ink/[0.06] hover:text-ink"
                }`}
              >
                <RowIcon icon={item.icon} active={isActive} badge={item.target === "inbox" ? inboxUnreadCount : 0} />
                <span className="truncate rail-collapsed:sr-only">{item.label}</span>
                {!reason && <RailTip>{item.label}</RailTip>}
              </button>
            );
          })}
        </div>
      ))}
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
    // Read after mount: the server can't know what this device has seen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnseen(!hasSeenLatest());
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
      className="sidebar-scheme shadow-sidebar fixed inset-y-0 left-0 z-30 hidden w-[var(--shell-left)] flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-[var(--ease-emphasized)] md:flex"
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

      {/* The one part that scrolls, on a window too short for the whole rail, so the links below stay in view. Not on
          the icon rail: its tooltips stand out past its edge, and a scrolling box would clip them. */}
      <nav aria-label="Destinations" className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 pt-3 rail-collapsed:min-h-fit rail-collapsed:overflow-visible">
        <NavList active={active} hasProfile={hasProfile} hasBidPack={hasBidPack} ready={ready} inboxUnreadCount={inboxUnreadCount} onGo={onNavigate} />
      </nav>

      <div className="space-y-0.5 border-t border-sidebar-border/70 px-3 py-2">
        <button type="button" onClick={onOpenHowItWorks} className={`${ROW} font-medium text-ink-faint hover:bg-ink/[0.06] hover:text-ink-muted`}>
          <RowIcon icon={InfoIcon} active={false} />
          <span className="rail-collapsed:sr-only">How this works</span>
          <RailTip>How this works</RailTip>
        </button>
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
