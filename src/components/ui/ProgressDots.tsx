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
      className="flex items-center gap-1.5"
    >
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          className={`h-1.5 rounded-full transition-all ${
            i === current
              ? "w-6 bg-brand"
              : i < current
                ? "w-1.5 bg-brand/50"
                : "w-1.5 bg-border-strong"
          }`}
        />
      ))}
    </div>
  );
}
