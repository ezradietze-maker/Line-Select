/** A category of nearby amenity a pilot might care about at a layover hotel. */
export type HotelAmenityCategory = "food" | "gym" | "grocery" | "coffee";

/**
 * Count of decently-rated (>=3.5) real places within walking distance of the
 * hotel, per category — real Google Places data, not an invented "quality"
 * score. Used both to show a pilot what's actually nearby and, when they've
 * flagged which categories matter to them, to score lines on it.
 */
export type HotelAmenitySummary = Record<HotelAmenityCategory, number>;

/**
 * A theme a pilot might care about that only real guest reviews can speak
 * to — none of these are guessable from Places metadata alone.
 */
export type ReviewThemeKey =
  | "quietness"
  | "cleanliness"
  | "service"
  | "sleepComfort"
  | "breakfast"
  | "safety";

export type ReviewSentiment = "positive" | "mixed" | "negative";

/**
 * An LLM's read of a hotel's actual review excerpts — grounded only in what
 * reviewers wrote, never invented. A theme is present only when the reviews
 * actually supported a call on it; an absent theme means the reviews didn't
 * say enough about it either way, not that it was rated neutral.
 */
export interface ReviewSummary {
  /** A 1-2 sentence plain-language read of the reviews, e.g. "Reviewers consistently mention a quiet room...". */
  summary: string;
  themes: Partial<Record<ReviewThemeKey, ReviewSentiment>>;
  /** How many review excerpts this was generated from. */
  reviewCount: number;
  generatedAt: string;
}

/** A curated subset of a Google Places result — just what's useful for a pilot glancing at a layover. */
export interface HotelResult {
  name: string;
  rating: number | null;
  userRatingCount: number | null;
  /** 0 (free) to 4 (very expensive), per Google's Places API scale — null when Google has no data. */
  priceLevel: number | null;
  formattedAddress: string | null;
  googleMapsUri: string | null;
  location: { latitude: number; longitude: number } | null;
  /** Null when location was unavailable, so nearby search couldn't run. */
  amenities: HotelAmenitySummary | null;
  /** Null when no reviews were available to analyze, or review summarization isn't configured. */
  reviewSummary: ReviewSummary | null;
}

export interface HotelLookupResult {
  /** The airport code + hotel name that were looked up, echoed back so a caller can key its own state without re-deriving it. */
  code: string;
  hotelName: string;
  /** The matched Google Places result, or null if nothing confident was found for this specific property. */
  hotel: HotelResult | null;
  /** Set when the lookup couldn't run at all (no API key configured, Google error) — distinct from "not found". */
  error: string | null;
}
