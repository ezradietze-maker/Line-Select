"use client";

import { useEffect, useState } from "react";
import { hasHotelQualityDetails, HotelQualityDetails } from "@/components/hotels/HotelQualityDetails";
import { EmptyState } from "@/components/ui/EmptyState";
import { Heading } from "@/components/ui/Heading";
import { Spinner } from "@/components/ui/Spinner";
import { ChevronDownIcon, StarIcon } from "@/components/ui/icons";
import { fetchHotel } from "@/lib/hotel-client";
import type { BidPack } from "@/types/bidpack";
import type { HotelResult } from "@/types/hotel";

interface HotelRatingsScreenProps {
  bidPack: BidPack | null;
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

export function HotelRatingsScreen({ bidPack }: HotelRatingsScreenProps) {
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

  const groups = groupByHotel(bidPack);

  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in">
      <Heading as="h1" className="text-2xl text-ink sm:text-3xl">Hotel Ratings</Heading>
      <p className="mt-1.5 text-sm text-ink-muted">
        The actual hotel your bid pack&rsquo;s pairing schedule assigns to each layover — not a
        generic nearby search — rated from Google Places, most-used first.
      </p>

      {loading && <Spinner label="Loading hotel ratings…" className="mt-8" />}

      {!loading && notConfigured && (
        <div className="mt-6 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">
          Hotel ratings aren&rsquo;t configured yet &mdash; this needs a Google Places API key set
          as <code className="font-mono">GOOGLE_PLACES_API_KEY</code> before it can look anything
          up.
        </div>
      )}

      {!loading && !notConfigured && groups.length === 0 && (
        <EmptyState
          compact
          className="mt-8"
          description="No assigned hotels found in this bid pack yet — lines with a full trip-by-trip breakdown will show their hotels here."
        />
      )}

      {!loading && !notConfigured && groups.length > 0 && (
        <div className="mt-8 space-y-3">
          {groups.map((g) => (
            <HotelCard key={g.key} group={g} hotel={ratings[g.key]} />
          ))}
        </div>
      )}
    </div>
  );
}

function HotelCard({ group, hotel }: { group: HotelGroup; hotel: HotelResult | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const shownLines = group.lineNumbers.slice(0, 8);
  const extra = group.lineNumbers.length - shownLines.length;
  const hasDetails = !!hotel && hasHotelQualityDetails(hotel);

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink">
            {group.hotelName} <span className="font-normal text-ink-faint">&middot; {group.code}</span>
          </div>
          <div className="mt-1 text-xs text-ink-muted">
            Lines {shownLines.join(", ")}
            {extra > 0 ? ` +${extra} more` : ""}
          </div>
        </div>
        {hotel?.priceLevel !== null && hotel?.priceLevel !== undefined && (
          <span className="shrink-0 font-mono text-xs text-ink-faint">
            {"$".repeat(Math.max(1, hotel.priceLevel))}
          </span>
        )}
      </div>

      {hotel === undefined ? (
        <Spinner label="Loading…" className="mt-2" />
      ) : hotel === null ? (
        <p className="mt-2 text-sm text-ink-faint">No Google Places match found for this hotel.</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
            {hotel.rating !== null && (
              <span className="inline-flex items-center gap-1">
                <StarIcon className="h-3.5 w-3.5 fill-current text-accent" />
                {hotel.rating.toFixed(1)}
                {hotel.userRatingCount !== null && (
                  <span className="text-ink-faint">({hotel.userRatingCount.toLocaleString()})</span>
                )}
              </span>
            )}
            {hotel.formattedAddress && <span className="text-ink-faint">{hotel.formattedAddress}</span>}
          </div>
          {hotel.googleMapsUri && (
            <a
              href={hotel.googleMapsUri}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm font-medium text-brand hover:underline"
            >
              View on Google Maps
            </a>
          )}

          {hasDetails && (
            <div className="mt-3 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full items-center justify-between text-left text-xs font-medium text-ink-muted hover:text-ink"
                aria-expanded={expanded}
              >
                <span>What&rsquo;s nearby &amp; what reviewers say</span>
                <ChevronDownIcon
                  className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </button>

              {expanded && (
                <div className="mt-3">
                  <HotelQualityDetails hotel={hotel} />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
