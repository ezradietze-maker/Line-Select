import type { TimeMode } from "@/lib/trip-timeline";

const OPTIONS: { mode: TimeMode; label: string }[] = [
  { mode: "zulu", label: "Zulu" },
  { mode: "local", label: "Local" },
];

interface TimeModeToggleProps {
  mode: TimeMode;
  onChange: (mode: TimeMode) => void;
}

/**
 * Governs how every timestamp in a trip's expanded detail displays — the whole trip schedule below reads one of these two
 * ways at a time, never a per-trip choice. No wider than its box: on a 320 phone with the text at 200%, "Local" ran off
 * the side of an interview trip card (the page scrolled sideways) and was cut off in a line's calendar. There, "Local"
 * goes under "Zulu".
 */
export function TimeModeToggle({ mode, onChange }: TimeModeToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Time system"
      className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-[3px] border border-hairline bg-surface p-0.5"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.mode}
          type="button"
          role="radio"
          aria-checked={mode === opt.mode}
          onClick={() => onChange(opt.mode)}
          className={`rounded-[3px] px-3 py-1 font-mono text-xs font-medium transition-colors ${
            mode === opt.mode ? "bg-brand text-on-brand" : "text-ink-faint hover:text-ink"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
