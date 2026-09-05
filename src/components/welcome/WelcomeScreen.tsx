import { Button } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";

const FEATURES = [
  {
    title: "Scored, not guessed",
    description: "Every line gets a 0-100 score against exactly what you said matters, weighted by how strongly you feel about each thing.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    title: "Shows its work",
    description: "See exactly why a line ranked where it did, in plain English, with a readable trip-by-trip view instead of raw pairing text.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <path d="M7 3h8l4 4v14H7z" />
        <path strokeLinecap="round" d="M10 12h6M10 16h6M10 8h2" />
      </svg>
    ),
  },
  {
    title: "Yours alone",
    description: "Your bid pack PDF is parsed on our server and never stored there — the extracted line data and your preferences stay on this device unless you create an account to save them.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path strokeLinecap="round" d="M8 11V7a4 4 0 018 0v4" />
      </svg>
    ),
  },
];

/** Soft flight-path motif behind the hero — arcs and waypoints echoing the logo mark's climbing line, restrained enough to sit behind text without competing with it. */
function HeroMotif() {
  return (
    <svg
      viewBox="0 0 1000 420"
      preserveAspectRatio="xMidYMin slice"
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] w-full text-brand opacity-[0.08] dark:opacity-[0.14]"
    >
      <path d="M40 340 C 260 340, 300 120, 520 120 S 780 300, 960 60" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M-40 180 C 160 260, 340 40, 560 200 S 860 380, 1040 220" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.7" />
      <circle cx="40" cy="340" r="4" fill="currentColor" />
      <circle cx="520" cy="120" r="4" fill="currentColor" />
      <circle cx="960" cy="60" r="5" fill="currentColor" />
      <circle cx="560" cy="200" r="3.5" fill="currentColor" opacity="0.7" />
      <circle cx="1040" cy="220" r="3.5" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

export function WelcomeScreen({
  onStart,
  onTrySample,
}: {
  onStart: () => void;
  onTrySample: () => void;
}) {
  return (
    <div className="relative mx-auto flex max-w-3xl flex-col items-center overflow-hidden px-2 pt-4 text-center">
      <HeroMotif />

      <div className="animate-rise-in">
        <span className="rounded-full border border-border-strong bg-surface/80 px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-ink-faint backdrop-blur-sm">
          Independent prototype &middot; not affiliated with FedEx
        </span>
        <Heading as="h1" className="mt-6 text-4xl leading-[1.1] tracking-tight text-ink sm:text-5xl">
          Find the line that actually
          <br className="hidden sm:block" /> fits how you want to fly.
        </Heading>
        <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-ink-muted">
          No more spreading pairings across your kitchen table to cross-check
          them by hand. Tell Line Select what actually matters to you, and it
          ranks every line in your bid pack against it &mdash; with a
          plain-English reason for every score, so you can trust the answer
          instead of re-checking it yourself.
        </p>
        <div className="mt-8">
          <Button onClick={onStart} className="px-8 py-3 text-base shadow-elevated">
            Upload your bid pack
          </Button>
        </div>
        <p className="mt-4 text-xs text-ink-faint">
          Parsed on our server, never stored there — only the extracted line
          data comes back to this device. Takes about a minute after that,
          or two if you go deeper.
        </p>
        <button
          type="button"
          onClick={onTrySample}
          className="mt-3 text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
        >
          Don&rsquo;t have a bid pack handy? Try it with sample data
        </button>
      </div>

      <div className="mt-16 grid w-full gap-4 text-left sm:grid-cols-3">
        {FEATURES.map((f, i) => (
          <div
            key={f.title}
            style={{ animationDelay: `${120 + i * 90}ms` }}
            className="animate-rise-in group rounded-xl border border-border bg-surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-elevated"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand transition-transform duration-200 group-hover:scale-110">
              {f.icon}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-ink">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
              {f.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
