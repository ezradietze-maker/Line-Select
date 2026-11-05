/**
 * Text that turns over like a split-flap departures board: each character that changes flips down into place; the
 * ones that don't, stay still. Keyed by position and character, so only a changed character remounts and animates.
 * `delay` (ms) holds the first flip back; `stagger` (ms) turns the characters over one after another, left to right.
 */
export function FlipText({ text, className = "", delay = 0, stagger = 0 }: { text: string; className?: string; delay?: number; stagger?: number }) {
  return (
    <span className={className} aria-label={text}>
      {[...text].map((ch, i) => (
        <span
          key={`${i}-${ch}`}
          aria-hidden
          className={ch === " " || ch === ":" ? "inline-block" : "flap"}
          style={delay || stagger ? { animationDelay: `${delay + i * stagger}ms` } : undefined}
        >
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}
