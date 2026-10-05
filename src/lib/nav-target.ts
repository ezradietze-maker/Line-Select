import type { NavTarget } from "@/components/nav/LeftNav";

/** Info pages that live outside the sidebar's destinations — nothing lights up for them, rather than wrongly lighting "Upload Bid Pack". */
const NO_NAV_ITEM_PATHS = ["/how-it-works", "/pricing", "/privacy", "/terms"];

/** Which sidebar item a route belongs under, or null for a page that isn't one of them. Any other unlisted route falls back to "upload". */
export function navTargetForPath(pathname: string): NavTarget | null {
  if (NO_NAV_ITEM_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  if (pathname === "/preferences" || pathname === "/interview" || pathname === "/confirm-preferences") return "preferences";
  if (pathname === "/preview") return "upload";
  if (pathname.startsWith("/results")) return "results";
  if (pathname.startsWith("/strategies")) return "strategies";
  if (pathname.startsWith("/trade-board")) return "trade-board";
  if (pathname.startsWith("/inbox")) return "inbox";
  if (pathname.startsWith("/hotel-ratings")) return "hotel-ratings";
  return "upload";
}
