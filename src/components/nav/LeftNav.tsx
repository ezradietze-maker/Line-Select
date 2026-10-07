"use client";

import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { AccountMenu } from "@/components/nav/AccountMenu";
import { AppearanceMenu } from "@/components/nav/AppearanceMenu";
import { NAV_ITEMS, disabledReason, homeTarget, type NavTarget } from "@/components/nav/nav-items";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { LogoMark, Wordmark } from "@/components/ui/Logo";
import { setRailCollapsed, useRailCollapsed } from "@/lib/rail";
import type { UserAccount } from "@/types/auth";

export type { NavTarget } from "@/components/nav/nav-items";

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
  inboxUnreadCount?: number;
  pack: PackLabel | null;
  onNavigate: (target: NavTarget) => void;
  onSignIn: () => void;
  onLogout: () => void;
  onOpenHowItWorks: () => void;
  onOpenFeedback: () => void;
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
  "group relative flex w-full items-center gap-3 rounded-md py-2.5 pl-3 pr-3 text-left text-sm transition-colors duration-150 rail-collapsed:justify-center rail-collapsed:px-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]";

/** An icon that lifts a hair and catches the light on hover — the switch under your finger, not a link in a list. */
function RowIcon({ icon: Icon, active, badge = 0 }: { icon: ComponentType<{ className?: string }>; active: boolean; badge?: number }) {
  return (
    <span
      className={`relative shrink-0 transition-[transform,filter] duration-200 ease-[var(--ease-emphasized)] group-hover:-translate-y-px group-hover:scale-110 group-disabled:transform-none ${
        active ? "drop-shadow-[0_0_6px_var(--color-accent)]" : ""
      }`}
    >
      <Icon className="h-[18px] w-[18px]" />
      {badge > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-on-danger">
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
      <div className={`px-3 pb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-ink-faint rail-collapsed:hidden ${first ? "pt-1" : "pt-4"}`}>
        {children}
      </div>
      {!first && <div aria-hidden className="mx-auto my-3 hidden h-px w-6 bg-sidebar-border rail-collapsed:block" />}
    </>
  );
}

/**
 * The destinations, in two banks — this month's bid, then the crew-wide
 * tools — with one lit indicator that slides to whichever is live.
 */
function NavList({
  active,
  hasProfile,
  hasBidPack,
  inboxUnreadCount,
  onGo,
}: {
  active: NavTarget | null;
  hasProfile: boolean;
  hasBidPack: boolean;
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
          className="absolute inset-x-0 z-0 rounded-md bg-accent-wash shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)] transition-[transform,height] duration-300 ease-[var(--ease-emphasized)]"
          style={{ transform: `translateY(${indicator.top}px)`, height: indicator.height }}
        >
          {/* A status LED, not a generic highlight — the panel's own way of saying "this one's live." */}
          <div className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
        </div>
      )}
      {(["bid", "crew"] as const).map((section) => (
        <div key={section} role="group" aria-label={section === "bid" ? "Your bid" : "Crew"}>
          <SectionLabel first={section === "bid"}>{section === "bid" ? "Your bid" : "Crew"}</SectionLabel>
          {NAV_ITEMS.filter((item) => item.section === section).map((item) => {
            const reason = disabledReason(item.target, hasProfile, hasBidPack);
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
                  isActive ? "font-semibold text-on-wash" : "font-medium text-ink-muted hover:bg-black/[0.035] hover:text-ink"
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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 17v-5M12 8h.01" />
    </svg>
  );
}

function FeedbackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5a8.38 8.38 0 01-1.9 5.4L21 21l-4.65-1.55a8.5 8.5 0 11-6.85-15A8.5 8.5 0 0121 11.5z" />
    </svg>
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
  inboxUnreadCount = 0,
  pack,
  onNavigate,
  onSignIn,
  onLogout,
  onOpenHowItWorks,
  onOpenFeedback,
}: NavProps) {
  const collapsed = useRailCollapsed();

  return (
    <aside
      aria-label="Main"
      style={{ viewTransitionName: "app-rail" }}
      className="shadow-sidebar fixed inset-y-0 left-0 z-30 hidden w-[var(--shell-left)] flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-[var(--ease-emphasized)] md:flex"
    >
      <div className="flex items-center justify-between gap-2 border-b border-sidebar-border/70 px-4 py-5 rail-collapsed:flex-col rail-collapsed:gap-3 rail-collapsed:px-0">
        <button
          type="button"
          onClick={() => onNavigate(homeTarget(hasProfile, hasBidPack))}
          aria-label="Line Select home"
          className="group flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        >
          <LogoMark className="h-9 w-9 shrink-0 transition-transform duration-200 group-hover:scale-105" />
          <Wordmark className="truncate text-[17px] rail-collapsed:hidden" />
        </button>
        <AppearanceMenu />
      </div>

      {pack && (
        <div className="mx-3 mt-3 rounded-lg border border-hairline bg-canvas/40 px-3 py-2.5 rail-collapsed:hidden">
          <div className="flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.2em] text-ink-faint">
            <span>Bid pack</span>
            <span className="flex items-center gap-1.5 text-good">
              <span className="h-1.5 w-1.5 rounded-full bg-good shadow-[0_0_6px_var(--color-good)]" aria-hidden />
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

      <nav aria-label="Destinations" className="flex-1 px-3 pt-3">
        <NavList active={active} hasProfile={hasProfile} hasBidPack={hasBidPack} inboxUnreadCount={inboxUnreadCount} onGo={onNavigate} />
      </nav>

      <div className="space-y-0.5 border-t border-sidebar-border/70 px-3 py-3">
        <button type="button" onClick={onOpenHowItWorks} className={`${ROW} font-medium text-ink-faint hover:bg-black/[0.035] hover:text-ink-muted`}>
          <RowIcon icon={InfoIcon} active={false} />
          <span className="rail-collapsed:sr-only">How this works</span>
          <RailTip>How this works</RailTip>
        </button>
        <button type="button" onClick={onOpenFeedback} className={`${ROW} font-medium text-ink-faint hover:bg-black/[0.035] hover:text-ink-muted`}>
          <RowIcon icon={FeedbackIcon} active={false} />
          <span className="rail-collapsed:sr-only">Send feedback</span>
          <RailTip>Send feedback</RailTip>
        </button>
        <button
          type="button"
          onClick={() => setRailCollapsed(!collapsed)}
          aria-pressed={collapsed}
          className={`${ROW} font-medium text-ink-faint hover:bg-black/[0.035] hover:text-ink-muted`}
        >
          <span className="shrink-0 transition-transform duration-300 rail-collapsed:rotate-180">
            <ChevronLeftIcon className="h-[18px] w-[18px]" />
          </span>
          <span className="rail-collapsed:sr-only">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
          <RailTip>Expand sidebar</RailTip>
        </button>
      </div>

      <div className="border-t border-sidebar-border px-3 pb-4 pt-4">
        <AccountMenu user={user} onSignIn={onSignIn} onLogout={onLogout} />
      </div>
    </aside>
  );
}
