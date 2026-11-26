import Link from "next/link";
import type { ReactNode } from "react";
import { heatColor } from "@/lib/heat-scale";
import { VacationLinePicture } from "@/components/welcome/VacationLinePicture";

/**
 * The landing page past the story: what Line Select does for a bid today, in the order a pilot meets it — the three
 * things no other bidding tool shows (each with a small picture of how the app draws it), the rest of the kit, how it
 * learns, what it costs and the questions a pilot asks first. Server-rendered words throughout, so the page reads before
 * any JavaScript arrives. The pictures are drawn as the app draws them, from made-up trips, and say so.
 */

function Caption({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-2xs font-medium text-ink-faint">{children}</p>;
}

const TRIPS = [
  { place: 1, route: "MEM–ANC–NRT", days: 4, grip: false },
  { place: 2, route: "MEM–CDG–DUB", days: 5, grip: true },
  { place: 3, route: "MEM–LAX–MEM", days: 2, grip: false },
  { place: 4, route: "MEM–HNL–MEM", days: 3, grip: false },
];

export function TripsPicture() {
  return (
    <ol aria-hidden className="space-y-1.5">
      {TRIPS.map((t) => (
        <li
          key={t.place}
          // Wraps with a phone's text set large: on one row at 200% the four pieces made every card wider than a 320 phone.
          className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-[4px] border px-3 py-2 ${t.grip ? "translate-x-2 border-accent bg-panel shadow-elevated" : "border-transparent bg-canvas/50"}`}
        >
          <span className={`font-mono text-xs ${t.grip ? "text-accent" : "text-ink-faint"}`} aria-hidden>
            ⋮⋮
          </span>
          <span className="w-6 font-mono text-xs text-ink-faint">#{t.place}</span>
          <span className="grow font-mono text-xs text-ink">{t.route}</span>
          <span className="font-mono text-2xs text-ink-faint">{t.days} days</span>
        </li>
      ))}
    </ol>
  );
}

/** A line's trips as the Heat Map draws them: each duty period and layover by how good it is for this pilot. */
const HEAT: { days: number; heat: number }[] = [
  { days: 0.6, heat: 0.85 },
  { days: 1.2, heat: 0.95 },
  { days: 0.5, heat: 0.7 },
  { days: 2.5, heat: -1 },
  { days: 0.5, heat: 0.2 },
  { days: 0.6, heat: 0.05 },
  { days: 0.4, heat: 0.35 },
  { days: 2.8, heat: -1 },
  { days: 0.7, heat: 0.9 },
  { days: 1.4, heat: 0.8 },
  { days: 0.6, heat: 0.65 },
];

export function HeatPicture() {
  const total = HEAT.reduce((s, h) => s + h.days, 0);
  return (
    <div aria-hidden>
      <div className="flex h-[30px] overflow-hidden rounded-[3px] border border-border bg-canvas/60">
        {HEAT.map((h, i) => (
          <div
            key={i}
            className={h.heat < 0 ? "border-x border-dashed border-border" : ""}
            style={{ width: `${(h.days / total) * 100}%`, background: h.heat < 0 ? "transparent" : heatColor(h.heat) }}
          />
        ))}
      </div>
      <div className="mt-3 flex h-[8px] overflow-hidden rounded-full">
        <div className="h-full" style={{ width: "72%", background: heatColor(0.9) }} />
        <div className="h-full" style={{ width: "12%", background: heatColor(0.5) }} />
        <div className="h-full" style={{ width: "16%", background: heatColor(0.05) }} />
      </div>
      <div className="mt-1.5 flex justify-between text-2xs text-ink-muted">
        <span>72% of the trips hot</span>
        <span>16% cold</span>
      </div>
    </div>
  );
}

const SPOTLIGHT: { eyebrow: string; title: string; body: string; picture: ReactNode; caption: string; wide?: boolean }[] = [
  {
    eyebrow: "Your vacation",
    title: "Your vacation, drawn on every line.",
    body: "Give your seniority number and Line Select finds your vacation in the pack. It shows on every line, with how far it can slide under the contract, and slides to the spot that gets you what you said you want: the most days off together, the most credit, or a date at home.",
    picture: <VacationLinePicture />,
    caption: "Made-up line and trips · the rankings page's own strip",
    wide: true,
  },
  {
    eyebrow: "Trip Rankings",
    title: "Every trip in the pack, best first.",
    body: "Not just lines: every trip ranked for you. Drag one where it belongs and the trips you didn't touch move with it, because it learned what you meant.",
    picture: <TripsPicture />,
    caption: "Made-up trips · drag, arrows or “Move to #”",
  },
  {
    eyebrow: "Heat Map",
    title: "See what's good and bad in a line at a glance.",
    body: "Every duty period and layover coloured by how it suits you, hot for good and cold for bad, with the reason a tap away. The Timeline draws the same month as routes, with flights over layovers.",
    picture: <HeatPicture />,
    caption: "Made-up line · hot is good for you",
  },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const KIT: { title: string; body: string; icon: string }[] = [
  {
    title: "Send to VIPS",
    body: "Your line order goes into VIPS's bid page, filled in. You sign in there and submit it yourself; nothing is sent until you do.",
    icon: "M4 12l16-8-6 16-2.5-6.5L4 12zM11.5 13.5L20 4",
  },
  {
    title: "Ask the Contract",
    body: "Ask in plain words and get the answer from the 2026 contract, with the section it comes from quoted.",
    icon: "M7 3h8l4 4v14H7zM10 12h6M10 16h6M10 8h2",
  },
  {
    title: "Body clock",
    body: "Every trip scored 1–100 for how well it suits your body clock, with a rest plan for each layover.",
    icon: "M12 3a9 9 0 109 9M12 7v5l3 2M17 3.5a4 4 0 004 4",
  },
  {
    title: "Commuting",
    body: "Trips flown back to back count as one departure, and real flights are checked in before your report and home after your release.",
    icon: "M3 17h18M5 17l2-6h10l2 6M9 11V7h6v4",
  },
  {
    title: "Carry-in and limits",
    body: "Last month's carry-over and your flight-time limits are counted first, so every line is scored as you'll really fly it.",
    icon: "M4 6h16M4 12h10M4 18h7M17 15l3 3-3 3",
  },
  {
    title: "Calendar feed",
    body: "Your awarded line in your phone's calendar, and kept up to date.",
    icon: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3",
  },
];

const LEARNS: { title: string; body: string }[] = [
  {
    title: "The interview",
    body: "A short conversation about how you like to fly, using real lines and trips from your pack. Talk instead of typing if you like: it knows pilot words.",
  },
  {
    title: "Swap two lines",
    body: "Put a line above another and it asks why, with its best guess. If the guess is wrong, say why in your own words and every line is re-scored.",
  },
  {
    title: "Move a trip",
    body: "Drag a trip where it belongs on Trip Rankings and the trips you didn't touch re-rank with it.",
  },
];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Is this from FedEx or the union?",
    a: "No. Line Select is independent and isn't affiliated with or endorsed by FedEx or ALPA.",
  },
  {
    q: "Does it bid for me?",
    a: "No. Send to VIPS opens VIPS's bid page with your order filled in; you sign in and submit it yourself. Line Select never asks for your FedEx sign-in.",
  },
  {
    q: "Which bid packs does it read?",
    a: "The line bid pack PDF exactly as you download it, for any aircraft, domicile and seat. Upload it and it's read in about a minute.",
  },
  {
    q: "What happens to my bid pack?",
    a: "It's read on our server and never stored there. The lines and your preferences stay on your device, unless you make an account to carry them between devices.",
  },
  {
    q: "Can I trust the contract answers?",
    a: "Each answer quotes the section of the 2026 contract it comes from, so you can read it for yourself. For anything that matters, check with crew scheduling or the union.",
  },
  {
    q: "Does it work on my phone?",
    a: "Yes: on a phone, a tablet or a computer, and your account carries your work between them.",
  },
];

export function FeatureTour({ freeSpots, price, previewLines }: { freeSpots: number; price: string; previewLines: number }) {
  return (
    <>
      <section aria-labelledby="tour-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-8 lg:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-2xs font-medium text-accent">Only in Line Select</div>
          <h2 id="tour-heading" className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            More of your month than any bid pack shows.
          </h2>
        </div>
        {/* The vacation across the whole row: drawn on a line as the rankings draw it, a month needs the width. */}
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          {SPOTLIGHT.map((s) => (
            <article key={s.eyebrow} className={`panel-glass flex min-w-0 flex-col p-[min(1.25rem,20px)] sm:p-6 ${s.wide ? "lg:col-span-2" : ""}`} data-landing-spotlight>
              <div className="text-2xs font-medium text-accent">{s.eyebrow}</div>
              <h3 className="mt-2 font-display text-xl font-semibold leading-snug text-ink">{s.title}</h3>
              <p className={`mt-2 flex-1 text-sm leading-relaxed text-ink-muted ${s.wide ? "max-w-3xl" : ""}`}>{s.body}</p>
              <div className="mt-5">
                {s.picture}
                <Caption>{s.caption}</Caption>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="kit-heading" className="mx-auto max-w-6xl px-4 sm:px-8">
        <h2 id="kit-heading" className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Everything else for the bid, in one place.
        </h2>
        <ul className="mt-8 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
          {KIT.map((k) => (
            <li key={k.title} className="flex gap-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] bg-on-sign text-sign">
                <Icon d={k.icon} />
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-base font-semibold text-ink">{k.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">{k.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="learns-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-8 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
          <div>
            <div className="text-2xs font-medium text-accent">It learns how you bid</div>
            <h2 id="learns-heading" className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              The more you use it, the closer it gets.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-ink-muted">
              It starts from what you tell it, then learns from what you do with the list. You don&rsquo;t have to explain
              a thing twice.
            </p>
          </div>
          <ol className="space-y-4">
            {LEARNS.map((l, i) => (
              <li key={l.title} className="flex gap-4 rounded-[6px] border border-hairline p-4 sm:p-5">
                <span className="font-mono text-sm font-semibold text-accent">0{i + 1}</span>
                <div className="min-w-0">
                  <h3 className="font-display text-base font-semibold text-ink">{l.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{l.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="price-heading" className="mx-auto max-w-6xl px-4 sm:px-8">
        {/* Its padding stays 24px with the text set large: doubled, "$20/month," ran past a 320 phone's edge at 200%. */}
        <div className="panel-glass relative overflow-hidden p-[min(1.5rem,24px)] sm:p-8">
          <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-accent" />
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div>
              <h2 id="price-heading" className="break-words font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                {price}, your first month free.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                One membership unlocks everything: every line ranked, every trip ranked, Send to VIPS, Strategies and the
                rest. The first {freeSpots} pilots get theirs free. Without one, you can still take the interview and see
                your top {previewLines} lines.
              </p>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 lg:justify-end">
              <Link href="/pricing" className="rounded-[4px] border border-border-strong px-4 py-2.5 font-display text-sm font-bold text-ink transition-colors hover:border-ink">
                See pricing
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="faq-heading" className="mx-auto max-w-3xl px-4 py-16 sm:px-8 lg:py-24">
        <h2 id="faq-heading" className="text-center font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Questions pilots ask first
        </h2>
        <div className="mt-8 divide-y divide-hairline border-y border-hairline">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-1" data-landing-faq>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3.5 font-display text-base font-semibold text-ink hover:text-accent">
                {f.q}
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                </svg>
              </summary>
              <p className="pb-4 text-sm leading-relaxed text-ink-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
