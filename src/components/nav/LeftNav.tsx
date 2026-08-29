"use client";

import { useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { AccountMenu } from "@/components/nav/AccountMenu";
import { ThemeToggle } from "@/components/nav/ThemeToggle";
import {
  BuildingIcon,
  LogoMark,
  MailIcon,
  SlidersIcon,
  SwapIcon,
  TargetIcon,
  TrophyIcon,
  UploadIcon,
} from "@/components/ui/icons";
import type { UserAccount } from "@/types/auth";

export type NavTarget =
  | "upload"
  | "preferences"
  | "results"
  | "strategies"
  | "trade-board"
  | "inbox"
  | "hotel-ratings";

interface LeftNavProps {
  active: NavTarget;
  hasProfile: boolean;
  hasBidPack: boolean;
  user: UserAccount | null;
  inboxUnreadCount?: number;
  onNavigate: (target: NavTarget) => void;
  onSignIn: () => void;
  onLogout: () => void;
  onOpenHowItWorks: () => void;
}

const NAV_ITEMS: {
  target: NavTarget;
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { target: "upload", label: "Upload Bid Pack", icon: UploadIcon },
  { target: "preferences", label: "Preferences", icon: SlidersIcon },
  { target: "results", label: "My Rankings", icon: TrophyIcon },
  { target: "strategies", label: "Strategies", icon: TargetIcon },
  { target: "trade-board", label: "Trade Board", icon: SwapIcon },
  { target: "inbox", label: "Inbox", icon: MailIcon },
  { target: "hotel-ratings", label: "Hotel Ratings", icon: BuildingIcon },
];

/**
 * The nav item list, with its own sliding active-indicator. Rendered once
 * for the desktop sidebar and once for the mobile drawer — each needs its
 * own DOM measurements and its own ref array, so this can't be a single JSX
 * value shared between the two (a shared element reused twice in one render
 * would fight over one ref array across two different mounted trees).
 */
function NavList({
  active,
  hasProfile,
  hasBidPack,
  inboxUnreadCount,
  onGo,
}: {
  active: NavTarget;
  hasProfile: boolean;
  hasBidPack: boolean;
  inboxUnreadCount: number;
  onGo: (target: NavTarget) => void;
}) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);

  const activeIndex = NAV_ITEMS.findIndex((item) => item.target === active);

  useLayoutEffect(() => {
    const el = itemRefs.current[activeIndex];
    const list = listRef.current;
    if (!el || !list) {
      setIndicator(null);
      return;
    }
    setIndicator({ top: el.offsetTop, height: el.offsetHeight });
  }, [activeIndex]);

  return (
    <div ref={listRef} className="relative">
      {indicator && (
        <div
          aria-hidden
          className="absolute inset-x-0 z-0 rounded-md bg-accent-wash transition-[transform,height] duration-300 ease-out"
          style={{ transform: `translateY(${indicator.top}px)`, height: indicator.height }}
        />
      )}
      {NAV_ITEMS.map((item, i) => {
        const disabled =
          (item.target === "results" && !hasProfile) ||
          (item.target === "strategies" && !hasBidPack);
        const isActive = active === item.target;
        const badgeCount = item.target === "inbox" ? inboxUnreadCount : 0;
        return (
          <button
            key={item.target}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            disabled={disabled}
            onClick={() => onGo(item.target)}
            className={`relative z-10 mb-1 flex w-full items-center gap-3 rounded-md py-2.5 pl-3 pr-3 text-left text-sm transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
              isActive
                ? "font-semibold text-accent"
                : "font-medium text-ink-muted hover:translate-x-0.5 hover:bg-black/[0.035] hover:text-ink"
            }`}
          >
            <span className="relative shrink-0 transition-transform duration-150">
              <item.icon className="h-[18px] w-[18px]" />
              {badgeCount > 0 && (
                // A fixed red rather than the `danger` theme token — that
                // token's dark-mode value is a muted salmon (meant for
                // soft error banners), which read as barely-there for an
                // unread dot that's supposed to grab attention regardless
                // of theme.
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#e0342a] px-1 text-[10px] font-semibold leading-none text-white">
                  {badgeCount > 9 ? "9+" : badgeCount}
                </span>
              )}
            </span>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function LeftNav({
  active,
  hasProfile,
  hasBidPack,
  user,
  inboxUnreadCount = 0,
  onNavigate,
  onSignIn,
  onLogout,
  onOpenHowItWorks,
}: LeftNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  function go(target: NavTarget) {
    onNavigate(target);
    setMobileOpen(false);
  }

  const homeTarget = hasProfile ? "results" : hasBidPack ? "preferences" : "upload";

  // A plain JSX value, not a component — reused in two tree positions below
  // (desktop aside + mobile drawer). Each embedding still gets its own
  // `NavList` fiber and hook state since React keys hook state by tree
  // position, not by JSX object identity, so this is safe despite looking
  // like the same element rendered twice.
  const sidebar = (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={() => go(homeTarget)}
        className="group flex items-center gap-2.5 px-4 py-5"
      >
        <LogoMark className="h-8 w-8 shrink-0 transition-transform duration-200 group-hover:scale-105" />
        <span className="text-sm font-semibold tracking-tight text-ink">Line Select</span>
      </button>

      <nav className="flex-1 space-y-1 px-3">
        <NavList
          active={active}
          hasProfile={hasProfile}
          hasBidPack={hasBidPack}
          inboxUnreadCount={inboxUnreadCount}
          onGo={go}
        />

        <button
          type="button"
          onClick={onOpenHowItWorks}
          className="mt-3 flex w-full items-center gap-3 rounded-md py-2.5 pl-3 pr-3 text-left text-sm font-medium text-ink-faint transition-all duration-150 hover:translate-x-0.5 hover:bg-black/[0.035] hover:text-ink-muted"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-[18px] w-[18px] shrink-0">
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" d="M12 17v-5M12 8h.01" />
          </svg>
          How this works
        </button>
      </nav>

      <div className="space-y-3 border-t border-sidebar-border px-3 pb-4 pt-4">
        <ThemeToggle />
        <AccountMenu user={user} onSignIn={onSignIn} onLogout={onLogout} />
      </div>
    </div>
  );

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-sidebar-border bg-sidebar px-4 py-3 md:hidden">
        <button type="button" onClick={() => go(homeTarget)} className="flex items-center gap-2">
          <LogoMark className="h-7 w-7" />
          <span className="text-sm font-semibold tracking-tight text-ink">Line Select</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-black/[0.05]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 cursor-default bg-ink/40 backdrop-blur-[1px] animate-fade-in"
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-slide-in-left border-r border-sidebar-border bg-sidebar shadow-elevated-lg">
            {sidebar}
          </div>
        </div>
      )}

      <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:w-60 md:flex-col md:border-r md:border-sidebar-border md:bg-sidebar shadow-sidebar">
        {sidebar}
      </aside>
    </>
  );
}
