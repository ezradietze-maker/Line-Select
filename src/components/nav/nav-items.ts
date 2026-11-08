import type { ComponentType } from "react";
import {
  BookIcon,
  BuildingIcon,
  ContractIcon,
  GlobeIcon,
  ListIcon,
  MailIcon,
  SlidersIcon,
  SwapIcon,
  TargetIcon,
  ToolboxIcon,
  TrophyIcon,
  UploadIcon,
} from "@/components/ui/icons";

export type NavTarget =
  | "upload"
  | "preferences"
  | "results"
  | "strategies"
  | "view-add"
  | "trade-board"
  | "inbox"
  | "hotel-ratings"
  | "cities"
  | "logbook"
  | "tools"
  | "contract";

export interface NavItem {
  target: NavTarget;
  label: string;
  /** For the phone tab bar, where a full label won't fit under the icon. */
  tabLabel: string;
  /** "bid" is this month's own work; "flying" the pilot's own kit beyond one bid; "crew" what's shared with other pilots. */
  section: "bid" | "flying" | "crew";
  icon: ComponentType<{ className?: string }>;
}

export const NAV_ITEMS: NavItem[] = [
  { target: "upload", label: "Upload Bid Pack", tabLabel: "Upload", section: "bid", icon: UploadIcon },
  { target: "preferences", label: "Preferences", tabLabel: "Preferences", section: "bid", icon: SlidersIcon },
  { target: "results", label: "My Rankings", tabLabel: "Rankings", section: "bid", icon: TrophyIcon },
  { target: "strategies", label: "Strategies", tabLabel: "Strategies", section: "bid", icon: TargetIcon },
  { target: "view-add", label: "View/Add", tabLabel: "View/Add", section: "bid", icon: ListIcon },
  { target: "cities", label: "Cities", tabLabel: "Cities", section: "flying", icon: GlobeIcon },
  { target: "logbook", label: "Logbook", tabLabel: "Logbook", section: "flying", icon: BookIcon },
  { target: "tools", label: "Tools", tabLabel: "Tools", section: "flying", icon: ToolboxIcon },
  { target: "contract", label: "Ask the Contract", tabLabel: "Contract", section: "flying", icon: ContractIcon },
  { target: "trade-board", label: "Trade Board", tabLabel: "Trades", section: "crew", icon: SwapIcon },
  { target: "inbox", label: "Inbox", tabLabel: "Inbox", section: "crew", icon: MailIcon },
  { target: "hotel-ratings", label: "Hotel Ratings", tabLabel: "Hotels", section: "crew", icon: BuildingIcon },
];

/** Why a destination can't be opened yet, or undefined when it can. */
export function disabledReason(target: NavTarget, hasProfile: boolean, hasBidPack: boolean): string | undefined {
  if (target === "results" && !hasProfile) return "Set your preferences first to see your ranked lines.";
  if (target === "strategies" && !hasBidPack) return "Upload a bid pack first to see strategies.";
  if (target === "view-add" && !hasBidPack) return "Upload a bid pack first to build your View/Add list.";
  if (target === "cities" && !hasBidPack) return "Upload a bid pack first to see its layover cities.";
  return undefined;
}

/** Where the logo takes you: as far along as this pilot has got. */
export function homeTarget(hasProfile: boolean, hasBidPack: boolean): NavTarget {
  return hasProfile ? "results" : hasBidPack ? "preferences" : "upload";
}
