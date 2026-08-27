import { StarIcon } from "@/components/ui/icons";
import type { CircadianAssessment } from "@/lib/circadian";

/** Worse scores read as more alarming colors — the same good/warn/danger vocabulary already used for match quality elsewhere, so a pilot doesn't have to learn a new color language for a health-facing rating. */
function colorForStars(stars: number): string {
  if (stars >= 4) return "text-good";
  if (stars === 3) return "text-ink-muted";
  if (stars === 2) return "text-warn";
  return "text-danger";
}

function tooltipFor(a: CircadianAssessment): string {
  const parts = [
    a.summary,
    `Time-zone shift: ${a.timezoneShiftHours === 0 ? "none" : `${Math.abs(a.timezoneShiftHours)}h ${a.timezoneShiftHours > 0 ? "eastward" : "westward"}`}`,
    `Report times in the 2-6am circadian low: ${a.wocEncroachments}`,
    `Layovers under the 10hr rest floor: ${a.shortRestCount}`,
  ];
  return parts.join("\n");
}

/**
 * A separate, health-facing 1-5 rating from the 0-100 preference match
 * score — see `lib/circadian.ts` for the real science behind it (time-zone
 * phase-shift direction, Window of Circadian Low, FAA Part 117 rest floor).
 * `size` lets the same component read clearly both in the compact mini
 * preview and the fuller trip-list header.
 */
export function CircadianStars({
  assessment,
  size = "sm",
}: {
  assessment: CircadianAssessment | null;
  size?: "sm" | "xs";
}) {
  if (!assessment) return null;
  const starClass = size === "sm" ? "h-3 w-3" : "h-2.5 w-2.5";
  const color = colorForStars(assessment.stars);

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 ${color}`}
      title={`Circadian disruption: ${assessment.stars}/5\n${tooltipFor(assessment)}`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon key={i} className={`${starClass} ${i <= assessment.stars ? "fill-current" : "fill-none opacity-35"}`} />
      ))}
    </span>
  );
}
