import { Button } from "@/components/ui/Button";

const FEATURES = [
  {
    title: "Preference-based scoring",
    description: "Every line scored 0-100 against exactly what you said matters, weighted by how strongly you feel about it.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    title: "Plain-English breakdowns",
    description: "See exactly why a line ranked where it did, with a readable trip-by-trip view in place of raw pairing text.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <path d="M7 3h8l4 4v14H7z" />
        <path strokeLinecap="round" d="M10 12h6M10 16h6M10 8h2" />
      </svg>
    ),
  },
  {
    title: "Private by default",
    description: "Runs in your browser. Your preferences stay on this device unless you create an account to save them.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path strokeLinecap="round" d="M8 11V7a4 4 0 018 0v4" />
      </svg>
    ),
  },
];

export function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center px-2 text-center animate-fade-in">
      <span className="rounded-full border border-border-strong px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
        Independent prototype &middot; not affiliated with FedEx
      </span>
      <h1 className="mt-6 text-3xl font-semibold leading-tight text-ink sm:text-4xl">
        Find the line that actually fits how you want to fly.
      </h1>
      <p className="mt-4 max-w-lg text-base leading-relaxed text-ink-muted">
        Upload your bid pack PDF, answer a few quick questions about what you
        care about &mdash; nights home, trip length and departures, layover
        cities, report times, pay versus lifestyle &mdash; and Line Select
        ranks every line in it against that, so you don&rsquo;t have to
        compare dozens of lines by hand.
      </p>
      <div className="mt-8">
        <Button onClick={onStart} className="px-8 py-3 text-base shadow-elevated">
          Upload your bid pack
        </Button>
      </div>
      <p className="mt-4 text-xs text-ink-faint">
        PDF stays on this device for parsing. Takes about a minute after
        that, or two if you go deeper.
      </p>

      <div className="mt-16 grid w-full gap-4 text-left sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="rounded-xl border border-border bg-surface p-5 transition-shadow hover:shadow-elevated"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
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
