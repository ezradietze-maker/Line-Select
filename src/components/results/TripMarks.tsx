import { hm } from "@/lib/trip-day-stats";
import type { TimeMode } from "@/lib/trip-timeline";

/**
 * Small marks the ex-pilot asked for on every trip picture, so nothing printed has to be guessed at: credit written as
 * credit hours ("60:27CH"), and every clock time marked with whose clock it is ("13:47L", or "Z" for Zulu).
 */

/** A trip's credit the way he writes it in the oval: "60:27CH". */
export function CreditHours({ hours, className = "" }: { hours: number; className?: string }) {
  return (
    <span className={className}>
      {hm(Math.round(hours * 60))}
      <span className="text-[0.8em] tracking-tight">CH</span>
    </span>
  );
}

/** "L" (local) or "Z" (Zulu) after a clock time. */
export function Zone({ mode = "local" }: { mode?: TimeMode }) {
  return <span className="ml-px text-[0.8em] font-normal opacity-80">{mode === "zulu" ? "Z" : "L"}</span>;
}
