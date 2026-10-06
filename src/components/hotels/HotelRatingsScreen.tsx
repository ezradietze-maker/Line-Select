"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { hasHotelQualityDetails, HotelQualityDetails } from "@/components/hotels/HotelQualityDetails";
import { EmptyState } from "@/components/ui/EmptyState";
import { Gauge, type GaugeTone } from "@/components/ui/Gauge";
import { Notice } from "@/components/ui/Notice";
import { NumberTicker } from "@/components/ui/NumberTicker";
import { PageHeader, packEyebrow } from "@/components/ui/PageHeader";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SkeletonCards } from "@/components/ui/SkeletonCards";
import { Spinner } from "@/components/ui/Spinner";
import { ChevronDownIcon, StarIcon } from "@/components/ui/icons";
import { fetchHotel } from "@/lib/hotel-client";
import { hotelFilterHref } from "@/lib/hotel-filter";
import { hotelCityReason } from "@/lib/hotel-personalization";
import type { BidPack } from "@/types/bidpack";
import type { HotelResult } from "@/types/hotel";
import type { PreferenceProfile } from "@/types/preferences";

interface HotelRatingsScreenProps {
  bidPack: BidPack | null;
  profile: PreferenceProfile | null;
}

interface HotelGroup {
  key: string;
  code: string;
  hotelName: string;
  lineNumbers: string[];
}

/** Every distinct (city, hotel) pair actually assigned somewhere in this bid pack, most-used first. */
function groupByHotel(bidPack: BidPack): HotelGroup[] {
  const groups = new Map<string, HotelGroup>();
  for (const line of bidPack.lines) {
    for (const trip of line.trips) {
      for (const layover of trip.layoverDetails) {
        if (!layover.hotelName) continue;
        const key = `${layover.city}|${layover.hotelName}`;
        const existing = groups.get(key);
        if (existing) {
          if (!existing.lineNumbers.includes(line.lineNumber)) existing.lineNumbers.push(line.lineNumber);
        } else {
          groups.set(key, {
            key,
            code: layover.city,
            hotelName: layover.hotelName,
            lineNumbers: [line.lineNumber],
          });
        }
      }
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.lineNumbers.length - a.lineNumbers.length);
}

const NOT_CONFIGURED_MARKER = "aren't configured yet";

export function HotelRatingsScreen({ bidPack, profile }: HotelRatingsScreenProps) {
  const [ratings, setRatings] = useState<Record<string, HotelResult | null>>({});
  const [notConfigured, setNotConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bidPack) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    const groups = groupByHotel(bidPack);
    if (groups.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function loadAll() {
      setLoading(true);
      const entries = await Promise.all(
        groups.map(async (g) => {
          const result = await fetchHotel(g.code, g.hotelName);
          return [g.key, result] as const;
        })
      );
      if (!cancelled) {
        setRatings(Object.fromEntries(entries.map(([k, r]) => [k, r.hotel])));
        setNotConfigured(entries.some(([, r]) => r.error?.includes(NOT_CONFIGURED_MARKER)));
        setLoading(false);
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [bidPack]);

  if (!bidPack) {
    return (
      <EmptyState
        title="Hotel Ratings"
        description="Upload your bid pack first — hotel ratings are pulled for the specific hotels its own pairing schedule assigns to each layover."
      />
    );
  }

  return <HotelRatingsList bidPack={bidPack} profile={profile} ratings={ratings} loading={loading} notConfigured={notConfigured} />;
}

type SortKey = "used" | "best" | "worst" | "city";

const SORT_LABEL: Record<SortKey, string> = {
  used: "Most-used first",
  best: "Highest rated",
  worst: "Lowest rated",
  city: "City A–Z",
};

/** How many hotels to draw before asking — a big pack assigns well over a hundred, and nobody reads them all in one scroll. */
const PAGE = 24;

function HotelRatingsList({
  bidPack,
  profile,
  ratings,
  loading,
  notConfigured,
}: {
  bidPack: BidPack;
  profile: PreferenceProfile | null;
  ratings: Record<string, HotelResult | null>;
  loading: boolean;
  notConfigured: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("used");
  const [shown, setShown] = useState(PAGE);
  const groups = useMemo(() => groupByHotel(bidPack), [bidPack]);

  const rated = groups.map((g) => ratings[g.key]?.rating).filter((r): r is number => typeof r === "number");
  const cityCount = new Set(groups.map((g) => g.code)).size;
  const average = rated.length > 0 ? rated.reduce((a, b) => a + b, 0) / rated.length : null;

  const q = query.trim().toLowerCase();
  const filtered = groups.filter((g) => !q || g.code.toLowerCase().includes(q) || g.hotelName.toLowerCase().includes(q));
  const ratingOf = (g: HotelGroup) => ratings[g.key]?.rating ?? null;
  const sorted =
    sort === "used"
      ? filtered
      : [...filtered].sort((a, b) => {
          if (sort === "city") return a.code.localeCompare(b.code) || b.lineNumbers.length - a.lineNumbers.length;
          const ra = ratingOf(a);
          const rb = ratingOf(b);
          // Unrated hotels sink to the bottom either way, rather than reading as the worst.
          if (ra === null || rb === null) return ra === null ? (rb === null ? 0 : 1) : -1;
          return sort === "best" ? rb - ra : ra - rb;
        });
  const visible = sorted.slice(0, shown);

  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in">
      <PageHeader
        eyebrow={packEyebrow(bidPack)}
        title="Hotel Ratings"
        description={
          <>
            The actual hotel your bid pack&rsquo;s pairing schedule assigns to each layover &mdash; not a generic nearby
            search &mdash; rated from Google Places.
          </>
        }
      />

      {!notConfigured && groups.length > 0 && (
        <div className="panel-glass mt-6 grid grid-cols-3 divide-x divide-hairline">
          <Readout label="Hotels" value={<NumberTicker value={groups.length} />} />
          <Readout label="Cities" value={<NumberTicker value={cityCount} />} />
          <Readout
            label="Avg rating"
            value={loading || average === null ? "—" : <NumberTicker value={average} format={(n) => n.toFixed(1)} />}
            hint={loading ? "Looking up…" : `${rated.length} rated`}
          />
        </div>
      )}

      {notConfigured && (
        <Notice tone="warn" className="mt-6">
          Hotel ratings aren&rsquo;t configured yet &mdash; this needs a Google Places API key set as{" "}
          <code className="font-mono">GOOGLE_PLACES_API_KEY</code> before it can look anything up.
        </Notice>
      )}

      {groups.length === 0 && (
        <EmptyState
          compact
          className="mt-8"
          description="No assigned hotels found in this bid pack yet — lines with a full trip-by-trip breakdown will show their hotels here."
        />
      )}

      {!notConfigured && groups.length > 0 && (
        <>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(PAGE);
              }}
              placeholder="Find a city or hotel"
              aria-label="Find a city or hotel"
              className="min-w-0 flex-1 rounded-lg border border-hairline bg-canvas/50 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort hotels"
              className="rounded-lg border border-hairline bg-canvas/50 px-3 py-2.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            >
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </div>

          <SectionHeading count={filtered.length} className="mt-6">
            {q ? "Matching hotels" : "Assigned hotels"}
          </SectionHeading>

          {loading ? (
            <SkeletonCards shape="hotel" count={4} className="mt-3" />
          ) : filtered.length === 0 ? (
            <EmptyState compact className="mt-3" description={`No hotel or city in this pack matches “${query.trim()}”.`} />
          ) : (
            <div className="mt-3 space-y-3">
              {visible.map((g) => (
                <HotelCard key={g.key} group={g} hotel={ratings[g.key]} profile={profile} />
              ))}
              {sorted.length > visible.length && (
                <button
                  type="button"
                  onClick={() => setShown((n) => n + PAGE)}
                  className="press w-full rounded-xl border border-dashed border-hairline py-3 text-sm font-medium text-ink-muted transition-colors hover:border-accent/60 hover:text-accent"
                >
                  Show {Math.min(PAGE, sorted.length - visible.length)} more &middot; {sorted.length - visible.length} left
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Readout({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="px-4 py-3.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-readout">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}

function ratingTone(rating: number): GaugeTone {
  if (rating >= 4.3) return { stroke: "var(--color-good)", text: "text-good", track: "var(--color-good-soft)" };
  if (rating >= 3.8) return { stroke: "var(--color-brand)", text: "text-brand", track: "var(--color-brand-soft)" };
  return { stroke: "var(--color-warn)", text: "text-warn", track: "var(--color-warn-soft)" };
}

function HotelCard({
  group,
  hotel,
  profile,
}: {
  group: HotelGroup;
  hotel: HotelResult | null | undefined;
  profile: PreferenceProfile | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAllLines, setShowAllLines] = useState(false);
  const shownLines = showAllLines ? group.lineNumbers : group.lineNumbers.slice(0, 8);
  const extra = group.lineNumbers.length - shownLines.length;
  const hasDetails = !!hotel && hasHotelQualityDetails(hotel);
  const cityReason = hotelCityReason(profile, group.code);
  const rating = hotel?.rating ?? null;

  return (
    <div className="panel-glass p-4 sm:p-5">
      <div className="flex items-start gap-4">
        {rating !== null ? (
          <Gauge
            value={rating}
            max={5}
            size={54}
            decimals={1}
            tone={ratingTone(rating)}
            label={`Rated ${rating.toFixed(1)} out of 5 on Google`}
            readoutClassName="text-sm font-semibold"
          />
        ) : (
          <div
            className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full border-2 border-dashed border-hairline font-mono text-xs text-ink-faint"
            aria-hidden
          >
            {hotel === undefined ? <Spinner size="sm" /> : "—"}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-accent/40 bg-accent-soft/60 px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-accent">
                  {group.code}
                </span>
                <span className="font-display text-base font-semibold text-ink">{group.hotelName}</span>
              </div>
              {hotel === undefined ? (
                <p className="mt-1 text-xs text-ink-faint">Looking up&hellip;</p>
              ) : hotel === null ? (
                <p className="mt-1 text-xs text-ink-faint">No Google Places match found for this hotel.</p>
              ) : (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
                  {rating !== null && (
                    <span className="inline-flex items-center gap-1">
                      <StarIcon className="h-3 w-3 fill-current text-accent" />
                      {rating.toFixed(1)}
                      {hotel.userRatingCount !== null && (
                        <span className="text-ink-faint">({hotel.userRatingCount.toLocaleString()})</span>
                      )}
                    </span>
                  )}
                  {hotel.formattedAddress && <span className="truncate text-ink-faint">{hotel.formattedAddress}</span>}
                </div>
              )}
            </div>
            {hotel?.priceLevel !== null && hotel?.priceLevel !== undefined && (
              <span className="shrink-0 font-mono text-xs text-ink-faint">{"$".repeat(Math.max(1, hotel.priceLevel))}</span>
            )}
          </div>

          <div className="mt-2.5 font-mono text-[11.5px] leading-relaxed text-ink-muted">
            <span className="text-ink-faint">Lines </span>
            {shownLines.join(" · ")}
            {extra > 0 && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => setShowAllLines(true)}
                  className="font-sans font-medium text-accent underline decoration-dotted underline-offset-4 hover:text-ink"
                >
                  +{extra} more
                </button>
              </>
            )}
            {showAllLines && group.lineNumbers.length > 8 && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => setShowAllLines(false)}
                  className="font-sans font-medium text-accent underline decoration-dotted underline-offset-4 hover:text-ink"
                >
                  show fewer
                </button>
              </>
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium">
            <Link href={hotelFilterHref({ city: group.code, hotelName: group.hotelName })} className="text-accent hover:underline">
              See {group.lineNumbers.length === 1 ? "this line" : `these ${group.lineNumbers.length} lines`} in your ranking &rarr;
            </Link>
            {hotel?.googleMapsUri && (
              <a href={hotel.googleMapsUri} target="_blank" rel="noopener noreferrer" className="text-ink-muted hover:text-ink hover:underline">
                View on Google Maps &#8599;
              </a>
            )}
          </div>
        </div>
      </div>

      {cityReason && (
        <p className="mt-3 rounded-md border border-brand/30 bg-brand-soft/70 px-2.5 py-1.5 text-xs leading-relaxed text-ink">
          <span className="font-medium">From your interview:</span> {cityReason}
        </p>
      )}

      {hasDetails && hotel && (
        <div className="mt-3 border-t border-hairline pt-2.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between py-1 text-left text-xs font-medium text-ink-muted hover:text-ink"
            aria-expanded={expanded}
          >
            <span>What&rsquo;s nearby &amp; what reviewers say</span>
            <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>

          {expanded && (
            <div className="mt-3">
              <HotelQualityDetails hotel={hotel} profile={profile} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
