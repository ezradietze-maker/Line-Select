const PLANE =
  "M21 12c0-.8-.7-1.2-1.6-1.2H15L10.3 3.6H8.5l2.3 7.2H6.2L4.6 8.6H3.2l1 3.4-1 3.4h1.4l1.6-2.2h4.6l-2.3 7.2h1.8l4.7-7.2h4.4c.9 0 1.6-.4 1.6-1.2z";

/** As many of the pilots ahead as are drawn one by one; past that the middle of the line is a count. */
const MAX_DRAWN = 9;

function Plane({ className, delay, opacity }: { className: string; delay: number; opacity?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={`queue-roll h-4 w-4 shrink-0 ${className}`} style={{ animationDelay: `${delay}ms`, opacity }} aria-hidden>
      <path d={PLANE} />
    </svg>
  );
}

/**
 * Your place in the bid, as a line of aircraft waiting for the runway: the pilots who bid ahead of you nearest it,
 * yours in amber, a few still behind fading back down the taxiway. A long line shows its ends and counts the middle.
 * The line rolls up into place, nose to tail; still under reduced motion.
 */
export function SeniorityQueue({ ahead, total }: { ahead: number; total: number }) {
  const behind = Math.min(3, Math.max(0, total - ahead - 1));
  const long = ahead > MAX_DRAWN;
  let i = 0;
  const next = () => (i++) * 45;
  return (
    <div className="mt-5" aria-hidden>
      {/* Clipped sideways only: the "You" label hangs below the row. On a phone the planes behind are left off and the
          runway is shorter, so the line ahead and the runway fit; yours is then first in the row, so its label starts
          at the plane's edge instead of centring past the clip. */}
      <div className="flex items-center gap-1 overflow-x-clip pb-4 sm:gap-1.5">
        {Array.from({ length: behind }, (_, k) => (
          <Plane key={k} className="hidden text-ink-faint sm:block" delay={next()} opacity={0.3 + (0.4 * (k + 1)) / behind} />
        ))}
        <span className="relative flex">
          <Plane className="text-accent" delay={next()} />
          <span className="absolute left-0 top-full mt-1 text-2xs text-accent sm:left-1/2 sm:-translate-x-1/2 font-medium">You</span>
        </span>
        <span className="mx-1 h-px w-3 bg-hairline" />
        {long ? (
          <>
            <Plane className="text-ink-muted" delay={next()} />
            <Plane className="text-ink-muted" delay={next()} />
            <span className="queue-roll whitespace-nowrap px-1.5 font-mono text-2xs text-ink-faint" style={{ animationDelay: `${next()}ms` }}>
              &middot; &middot; {ahead - 5} more &middot; &middot;
            </span>
            {[0, 1, 2].map((k) => (
              <Plane key={k} className="text-ink-muted" delay={next()} />
            ))}
          </>
        ) : (
          Array.from({ length: ahead }, (_, k) => <Plane key={k} className="text-ink-muted" delay={next()} />)
        )}
        {/* Hold short, then the runway. */}
        <span className="ml-1 flex h-6 shrink-0 gap-[3px]">
          <span className="w-[2px] bg-accent/70" />
          <span className="w-[2px] bg-[repeating-linear-gradient(to_bottom,var(--color-accent)_0_3px,transparent_3px_6px)] opacity-70" />
        </span>
        <span className="relative h-6 w-10 shrink-0 rounded-sm bg-ink/10 sm:w-16">
          <span className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-[repeating-linear-gradient(to_right,var(--color-ink-faint)_0_6px,transparent_6px_10px)]" />
        </span>
      </div>
      <div className="mt-1 text-2xs text-ink-faint font-medium">
        {ahead === 0 ? "First in line for the runway" : `${ahead} ahead of you for the runway`}
      </div>
    </div>
  );
}
