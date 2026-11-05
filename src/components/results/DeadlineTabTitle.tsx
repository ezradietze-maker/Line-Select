"use client";

import { useEffect } from "react";
import { getBidDeadline } from "@/lib/bid-deadline-storage";

const PREFIX = /^⏱ [^·]+· /;
const BADGE_ID = "final-call-icon";

/** The time left as the tab shows it — "3h 12m", "42m" — inside the last day before bidding closes; null otherwise. */
export function tabCountdown(msLeft: number): string | null {
  if (msLeft <= 0 || msLeft > 24 * 3_600_000) return null;
  const minutes = Math.ceil(msLeft / 60_000);
  const h = Math.floor(minutes / 60);
  return h ? `${h}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
}

let appIcon: Promise<HTMLImageElement> | null = null;

/** The app's own tab icon with a dot in its corner — amber in the last day, red in the last six hours. */
async function badgedIcon(color: string): Promise<string | null> {
  try {
    const img = await (appIcon ??= new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = "/icon";
    }));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 64, 64);
    ctx.beginPath();
    ctx.arc(49, 15, 12, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#1f2125";
    ctx.stroke();
    return canvas.toDataURL("image/png");
  } catch {
    appIcon = null;
    return null;
  }
}

/**
 * Final call in the browser tab: inside the last day before the pilot's own bid-close time, the tab's title counts
 * down ("⏱ 3h 12m · Line Select") and its icon wears a dot, so it's seen from whatever else is open. Each page's own
 * title is kept underneath — a page that sets its title afresh gets the countdown put back in front of it.
 */
export function DeadlineTabTitle({ packId }: { packId: string | null }) {
  useEffect(() => {
    if (!packId) return;
    let badge: string | null = null; // the dot's color now shown, if any
    const setBadge = (color: string | null) => {
      if (color === badge) return;
      badge = color;
      if (!color) {
        document.getElementById(BADGE_ID)?.remove();
        return;
      }
      void badgedIcon(color).then((href) => {
        if (!href || badge !== color) return;
        let link = document.getElementById(BADGE_ID) as HTMLLinkElement | null;
        if (!link) {
          link = document.createElement("link");
          link.id = BADGE_ID;
          link.rel = "icon";
          link.type = "image/png";
          document.head.appendChild(link); // last in the head, so the browser takes it over the app's own
        }
        link.href = href;
      });
    };
    const apply = () => {
      const page = document.title.replace(PREFIX, "");
      const deadline = getBidDeadline(packId);
      const msLeft = deadline ? new Date(deadline).getTime() - Date.now() : null;
      const left = msLeft === null ? null : tabCountdown(msLeft);
      const next = left ? `⏱ ${left} · ${page}` : page;
      if (document.title !== next) document.title = next;
      setBadge(left && msLeft !== null ? (msLeft <= 6 * 3_600_000 ? "#e5484d" : "#ebb357") : null);
    };
    apply();
    const id = window.setInterval(apply, 15_000);
    const retitled = new MutationObserver(apply);
    retitled.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      window.clearInterval(id);
      retitled.disconnect();
      document.title = document.title.replace(PREFIX, "");
      document.getElementById(BADGE_ID)?.remove();
    };
  }, [packId]);
  return null;
}
