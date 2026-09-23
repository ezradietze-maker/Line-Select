import type { NavTarget } from "@/components/nav/LeftNav";

/** Which sidebar item a route belongs under — a route not listed here falls back to "upload", so every real route needs an explicit case or it lights up the wrong item. */
export function navTargetForPath(pathname: string): NavTarget {
  if (pathname === "/preferences" || pathname === "/interview" || pathname === "/confirm-preferences") return "preferences";
  if (pathname === "/preview") return "upload";
  if (pathname.startsWith("/results")) return "results";
  if (pathname.startsWith("/strategies")) return "strategies";
  if (pathname.startsWith("/trade-board")) return "trade-board";
  if (pathname.startsWith("/inbox")) return "inbox";
  if (pathname.startsWith("/hotel-ratings")) return "hotel-ratings";
  return "upload";
}
