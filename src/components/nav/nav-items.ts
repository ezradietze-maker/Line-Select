import type { ComponentType } from "react";
import {
  BuildingIcon,
  MailIcon,
  SlidersIcon,
  SwapIcon,
  TargetIcon,
  TrophyIcon,
  UploadIcon,
} from "@/components/ui/icons";

export type NavTarget =
  | "upload"
  | "preferences"
  | "results"
  | "strategies"
  | "trade-board"
  | "inbox"
  | "hotel-ratings";

export interface NavItem {
  target: NavTarget;
  label: string;
  /** For the phone tab bar, where a full label won't fit under the icon. */
  tabLabel: string;
  /** "bid" is this month's own work; "crew" is everything shared with other pilots. */
  section: "bid" | "crew";
  icon: ComponentType<{ className?: string }>;
}

export const NAV_ITEMS: NavItem[] = [
  { target: "upload", label: "Upload Bid Pack", tabLabel: "Upload", section: "bid", icon: UploadIcon },
  { target: "preferences", label: "Preferences", tabLabel: "Preferences", section: "bid", icon: SlidersIcon },
  { target: "results", label: "My Rankings", tabLabel: "Rankings", section: "bid", icon: TrophyIcon },
  { target: "strategies", label: "Strategies", tabLabel: "Strategies", section: "bid", icon: TargetIcon },
  { target: "trade-board", label: "Trade Board", tabLabel: "Trades", section: "crew", icon: SwapIcon },
  { target: "inbox", label: "Inbox", tabLabel: "Inbox", section: "crew", icon: MailIcon },
  { target: "hotel-ratings", label: "Hotel Ratings", tabLabel: "Hotels", section: "crew", icon: BuildingIcon },
];

/** Why a destination can't be opened yet, or undefined when it can. */
export function disabledReason(target: NavTarget, hasProfile: boolean, hasBidPack: boolean): string | undefined {
  if (target === "results" && !hasProfile) return "Set your preferences first to see your ranked lines.";
  if (target === "strategies" && !hasBidPack) return "Upload a bid pack first to see strategies.";
  return undefined;
}

/** Where the logo takes you: as far along as this pilot has got. */
export function homeTarget(hasProfile: boolean, hasBidPack: boolean): NavTarget {
  return hasProfile ? "results" : hasBidPack ? "preferences" : "upload";
}
