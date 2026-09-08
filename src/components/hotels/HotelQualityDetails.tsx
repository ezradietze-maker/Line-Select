import { BasketIcon, CupIcon, DumbbellIcon, UtensilsIcon } from "@/components/ui/icons";
import { orderedAmenityCategories, orderedThemeEntries, wantsQuietRoom } from "@/lib/hotel-personalization";
import type { HotelAmenityCategory, HotelResult, ReviewSentiment, ReviewThemeKey } from "@/types/hotel";
import type { PreferenceProfile } from "@/types/preferences";

const AMENITY_META: Record<
  HotelAmenityCategory,
  { label: string; icon: (props: { className?: string }) => React.JSX.Element }
> = {
  food: { label: "Food & restaurants", icon: UtensilsIcon },
  gym: { label: "Gyms", icon: DumbbellIcon },
  grocery: { label: "Grocery & pharmacy", icon: BasketIcon },
  coffee: { label: "Coffee shops", icon: CupIcon },
};

function countLabel(count: number): string {
  if (count === 0) return "None within a 12-min walk";
  if (count === 1) return "1 nearby";
  return `${count} nearby`;
}

const THEME_LABELS: Record<ReviewThemeKey, string> = {
  quietness: "Room noise",
  cleanliness: "Cleanliness",
  service: "Staff & service",
  sleepComfort: "Bed & sleep comfort",
  breakfast: "Breakfast",
  safety: "Safety & area",
  onSiteGym: "On-site gym",
  walkability: "Walkable area",
};

const SENTIMENT_CLASS: Record<ReviewSentiment, string> = {
  positive: "border-good/30 bg-good-soft text-good",
  mixed: "border-warn/30 bg-warn-soft text-warn",
  negative: "border-danger/30 bg-danger-soft text-danger",
};

/** True when there's anything at all to show — used by callers to decide whether an expand toggle is worth rendering. */
export function hasHotelQualityDetails(hotel: HotelResult): boolean {
  return hotel.amenities != null || hotel.reviewSummary != null;
}

/**
 * The nearby-amenity tiles plus the review-derived read on a hotel, shared
 * between the Hotel Ratings page and each line's trip detail view so the
 * two stay in sync rather than drifting into two slightly different
 * presentations of the same underlying data.
 */
export function HotelQualityDetails({
  hotel,
  profile = null,
}: {
  hotel: HotelResult;
  /** When supplied, amenity tiles and review themes reorder toward whatever this pilot's own interview actually weighted, instead of the same fixed order for every pilot. */
  profile?: PreferenceProfile | null;
}) {
  const rawThemeEntries = Object.entries(hotel.reviewSummary?.themes ?? {}) as [
    ReviewThemeKey,
    ReviewSentiment,
  ][];
  const themeEntries = orderedThemeEntries(profile, rawThemeEntries);
  const hasQuietSignal = themeEntries.some(([theme]) => theme === "quietness" || theme === "sleepComfort");
  const showQuietNote = wantsQuietRoom(profile) && !hasQuietSignal;

  return (
    <div className="space-y-4">
      {hotel.amenities && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {orderedAmenityCategories(profile, Object.keys(AMENITY_META) as HotelAmenityCategory[]).map((category) => {
            const { label, icon: Icon } = AMENITY_META[category];
            const count = hotel.amenities![category];
            return (
              <div key={category} className="flex flex-col items-start gap-1">
                <Icon className={`h-4 w-4 ${count > 0 ? "text-accent" : "text-ink-faint"}`} />
                <span className="text-xs font-medium text-ink">{label}</span>
                <span className="text-xs text-ink-faint">{countLabel(count)}</span>
              </div>
            );
          })}
        </div>
      )}

      {showQuietNote && (
        <p className="rounded-md border border-accent/30 bg-accent-soft px-2.5 py-1.5 text-xs leading-relaxed text-ink">
          You flagged room quiet or circadian recovery in your interview — worth calling the hotel
          or asking at check-in for a quiet floor or blackout curtains, since reviews here
          don&rsquo;t say either way.
        </p>
      )}

      {hotel.reviewSummary && (
        <div className={hotel.amenities ? "border-t border-border pt-3" : ""}>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            From recent reviews
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{hotel.reviewSummary.summary}</p>
          {themeEntries.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {themeEntries.map(([theme, sentiment]) => (
                <span
                  key={theme}
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${SENTIMENT_CLASS[sentiment]}`}
                >
                  {THEME_LABELS[theme]}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
