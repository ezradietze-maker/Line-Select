interface ProgressDotsProps {
  total: number;
  current: number; // 0-indexed
}

export function ProgressDots({ total, current }: ProgressDotsProps) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
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
