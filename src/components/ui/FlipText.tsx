/**
 * Text that turns over like a split-flap departures board: each character that changes flips down into place; the
 * ones that don't, stay still. Keyed by position and character, so only a changed character remounts and animates.
 */
export function FlipText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={className} aria-label={text}>
      {[...text].map((ch, i) => (
        <span key={`${i}-${ch}`} aria-hidden className={ch === " " || ch === ":" ? "inline-block" : "flap"}>
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}
