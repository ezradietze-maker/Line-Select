"use client";

import { useEffect, useRef, useState } from "react";
import { AccountMenu } from "@/components/nav/AccountMenu";
import { AppearanceMenu } from "@/components/nav/AppearanceMenu";
import { FeedbackIcon, InfoIcon, type NavProps } from "@/components/nav/LeftNav";
import { NAV_ITEMS, disabledReason, homeTarget, type NavTarget } from "@/components/nav/nav-items";
import { LogoMark, Wordmark } from "@/components/ui/Logo";

/** The four destinations a pilot reaches for every month get a tab of their own; the crew tools share "More". */
const TAB_TARGETS: NavTarget[] = ["upload", "preferences", "results", "strategies"];
const MORE_TARGETS = NAV_ITEMS.filter((item) => !TAB_TARGETS.includes(item.target));

function MoreIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </svg>
  );
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

/**
 * The phone's frame: a slim top bar (the mark and appearance), and a bottom
 * tab bar within thumb reach — four destinations and a "More" sheet for the
 * crew tools, help, and the account. Replaces the old hamburger drawer,
 * which hid every destination behind a tap.
 */
export function PhoneNav({
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
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  const tabIndex = active === null ? -1 : TAB_TARGETS.includes(active) ? TAB_TARGETS.indexOf(active) : 4;

  useEffect(() => {
    if (!moreOpen) return;
    const moreButton = moreButtonRef.current;
    sheetRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      moreButton?.focus();
    };
  }, [moreOpen]);

  function go(target: NavTarget) {
    setMoreOpen(false);
    onNavigate(target);
  }

  return (
    <>
      <header
        style={{ viewTransitionName: "app-topbar" }}
        className="sticky top-0 z-30 flex items-center justify-between border-b border-sidebar-border bg-sidebar/95 px-4 py-2.5 backdrop-blur md:hidden"
      >
        <button type="button" onClick={() => go(homeTarget(hasProfile, hasBidPack))} className="flex items-center gap-2" aria-label="Line Select home">
          <LogoMark className="h-8 w-8" />
          <Wordmark className="text-base" />
        </button>
        <div className="flex items-center gap-2.5">
          {pack && (
            <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
              {pack.base} &middot; <span className="text-accent">{pack.month}</span>
            </span>
          )}
          <AppearanceMenu />
        </div>
      </header>

      <nav
        aria-label="Main"
        style={{ viewTransitionName: "app-tabbar" }}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-sidebar-border bg-sidebar/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <div className="relative grid h-16 grid-cols-5">
          {tabIndex >= 0 && (
            <span
              aria-hidden
              className="absolute top-0 flex w-1/5 justify-center transition-[left] duration-300 ease-[var(--ease-emphasized)]"
              style={{ left: `${tabIndex * 20}%` }}
            >
              <span className="h-[3px] w-8 rounded-b-full bg-accent shadow-[0_0_10px_var(--color-accent)]" />
            </span>
          )}
          {TAB_TARGETS.map((target, i) => {
            const item = NAV_ITEMS.find((n) => n.target === target)!;
            const reason = disabledReason(target, hasProfile, hasBidPack);
            const isActive = tabIndex === i;
            return (
              <button
                key={target}
                type="button"
                disabled={!!reason}
                aria-label={reason ? `${item.label} — ${reason}` : item.label}
                aria-current={isActive ? "page" : undefined}
                onClick={() => go(target)}
                className={`flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors disabled:opacity-35 ${
                  isActive ? "text-accent" : "text-ink-muted active:text-ink"
                }`}
              >
                <span className={`transition-transform duration-200 ${isActive ? "-translate-y-px drop-shadow-[0_0_6px_var(--color-accent)]" : ""}`}>
                  <item.icon className="h-[21px] w-[21px]" />
                </span>
                {item.tabLabel}
              </button>
            );
          })}
          <button
            ref={moreButtonRef}
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className={`flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors ${
              tabIndex === 4 || moreOpen ? "text-accent" : "text-ink-muted"
            }`}
          >
            <span className={`relative ${tabIndex === 4 ? "drop-shadow-[0_0_6px_var(--color-accent)]" : ""}`}>
              <MoreIcon className="h-[21px] w-[21px]" />
              <Badge count={inboxUnreadCount} />
            </span>
            More
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close"
            tabIndex={-1}
            onClick={() => setMoreOpen(false)}
            className="animate-fade-in absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px]"
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="More"
            className="animate-sheet-up absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-sidebar-border bg-sidebar px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2 shadow-elevated-lg"
          >
            <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-sidebar-border" />
            <div className="mb-2 px-1 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-ink-faint">Crew</div>
            <div className="grid grid-cols-3 gap-2">
              {MORE_TARGETS.map((item) => {
                const isActive = active === item.target;
                return (
                  <button
                    key={item.target}
                    type="button"
                    onClick={() => go(item.target)}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex flex-col items-center gap-2 rounded-xl border px-2 py-3.5 text-xs font-medium transition-colors ${
                      isActive ? "border-accent/50 bg-accent-wash text-accent" : "border-hairline bg-canvas/40 text-ink-muted active:bg-canvas"
                    }`}
                  >
                    <span className="relative">
                      <item.icon className="h-6 w-6" />
                      {item.target === "inbox" && <Badge count={inboxUnreadCount} />}
                    </span>
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 divide-y divide-hairline rounded-xl border border-hairline">
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onOpenHowItWorks();
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-ink-muted"
              >
                <InfoIcon className="h-[18px] w-[18px]" />
                How this works
              </button>
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onOpenFeedback();
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-ink-muted"
              >
                <FeedbackIcon className="h-[18px] w-[18px]" />
                Send feedback
              </button>
            </div>

            <div className="mt-3">
              <AccountMenu
                user={user}
                onSignIn={() => {
                  setMoreOpen(false);
                  onSignIn();
                }}
                onLogout={() => {
                  setMoreOpen(false);
                  onLogout();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
