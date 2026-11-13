interface ProgressDotsProps {
  total: number;
  current: number; // 0-indexed
}

export function ProgressDots({ total, current }: ProgressDotsProps) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current + 1}
      aria-valuetext={`Step ${current + 1} of ${total}`}
      className="flex items-center gap-1"
    >
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          // Progress is the green centreline: the steps flown lit, this one lit longest, the rest still dark.
          className={`h-1 rounded-[1px] transition-all ${
            i === current
              ? "w-6 bg-good"
              : i < current
                ? "w-3 bg-good/55"
                : "w-3 bg-border-strong"
          }`}
        />
      ))}
    </div>
  );
}
