"use client";

interface SelectableCardProps {
  label: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
  /** "grid" is a bordered card with a corner checkmark badge, for a small
   * set of options side by side. "list" is a bordered row with a leading
   * checkmark, for stacking several independently-toggleable options. */
  layout?: "grid" | "list";
}

function CheckBadge({ selected }: { selected: boolean }) {
  return (
    <div
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
        selected
          ? "border-brand bg-brand text-white"
          : "border-border-strong bg-surface text-transparent"
      }`}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-3 w-3">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 6L9 17l-5-5" />
      </svg>
    </div>
  );
}

export function SelectableCard({
  label,
  description,
  selected,
  onClick,
  layout = "grid",
}: SelectableCardProps) {
  const baseClasses = `relative rounded-lg border-2 text-left transition-all ${
    selected
      ? "border-brand bg-brand-soft ring-2 ring-brand/25 ring-offset-2 ring-offset-canvas"
      : "border-border bg-surface hover:border-border-strong hover:bg-canvas"
  }`;

  if (layout === "list") {
    return (
      <button
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className={`flex w-full items-start gap-3 p-4 ${baseClasses}`}
      >
        <div className="mt-0.5">
          <CheckBadge selected={selected} />
        </div>
        <div>
          <div className="text-sm font-semibold text-ink">{label}</div>
          {description && <div className="mt-1 text-sm text-ink-muted">{description}</div>}
        </div>
      </button>
    );
  }

  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={`p-5 ${baseClasses}`}>
      <div className="absolute right-3 top-3">
        <CheckBadge selected={selected} />
      </div>
      <div className="pr-6 text-sm font-semibold text-ink">{label}</div>
      {description && <div className="mt-1 pr-6 text-sm text-ink-muted">{description}</div>}
    </button>
  );
}
