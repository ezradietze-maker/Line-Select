/**
 * Text that rolls over like a counter when it changes: each character that changes slides up into place once; the
 * ones that don't, stay still. Keyed by position and character, so only a changed character remounts and animates.
 * `delay` (ms) holds the first roll back; `stagger` (ms) turns the characters over one after another, left to right.
 */
export function FlipText({ text, className = "", delay = 0, stagger = 0 }: { text: string; className?: string; delay?: number; stagger?: number }) {
  return (
    <span className={className}>
      {/* Read once, as plain text: the rolling characters are drawing, not words. */}
      <span className="sr-only">{text}</span>
      {[...text].map((ch, i) => (
        <span
          key={`${i}-${ch}`}
          aria-hidden
          className={ch === " " || ch === ":" ? "inline-block" : "digit-roll"}
          style={delay || stagger ? { animationDelay: `${delay + i * stagger}ms` } : undefined}
        >
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}
