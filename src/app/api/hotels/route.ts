import { NextResponse } from "next/server";
import { airportSearchName, citySearchName } from "@/lib/hotels/airport-names";
import { cacheKey, getCachedHotel, setCachedHotel } from "@/lib/server/hotel-cache";
import type {
  HotelAmenityCategory,
  HotelAmenitySummary,
  HotelLookupResult,
  HotelResult,
  ReviewSentiment,
  ReviewSummary,
  ReviewThemeKey,
} from "@/types/hotel";

// Reads/writes the local hotel-cache file, which needs Node's fs module.
export const runtime = "nodejs";

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  formattedAddress?: string;
  googleMapsUri?: string;
  location?: { latitude: number; longitude: number };
}

type LatLng = { latitude: number; longitude: number };

const AMENITY_TYPES: Record<HotelAmenityCategory, string[]> = {
  food: ["restaurant"],
  gym: ["gym"],
  grocery: ["grocery_store", "supermarket", "pharmacy"],
  coffee: ["cafe"],
};

/** A quality bar so a count of "nearby places" means somewhere actually worth going, not just anything Google has an entry for. */
const MIN_AMENITY_RATING = 3.5;
/** ~1km — roughly a 12-minute walk, a reasonable "actually usable on a layover" radius. */
const AMENITY_RADIUS_METERS = 1000;

async function countNearbyAmenities(location: LatLng, types: string[], apiKey: string): Promise<number> {
  const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.rating",
    },
    body: JSON.stringify({
      includedTypes: types,
      maxResultCount: 10,
      locationRestriction: { circle: { center: location, radius: AMENITY_RADIUS_METERS } },
    }),
  });
  if (!response.ok) return 0;
  const data = (await response.json()) as { places?: { rating?: number }[] };
  return (data.places ?? []).filter((p) => (p.rating ?? 0) >= MIN_AMENITY_RATING).length;
}

async function fetchAmenitySummary(
  location: LatLng | null,
  apiKey: string
): Promise<HotelAmenitySummary | null> {
  if (!location) return null;
  const categories = Object.keys(AMENITY_TYPES) as HotelAmenityCategory[];
  const counts = await Promise.all(
    categories.map((c) => countNearbyAmenities(location, AMENITY_TYPES[c], apiKey))
  );
  return Object.fromEntries(categories.map((c, i) => [c, counts[i]])) as HotelAmenitySummary;
}

/** Words too generic to help tell one property from another. */
const NAME_STOPWORDS = new Set([
  "HOTEL",
  "THE",
  "AND",
  "INTERNATIONAL",
  "AIRPORT",
  "INN",
  "AT",
  "BY",
  "A",
  "OF",
  "RESORT",
]);

function significantWords(name: string): string[] {
  return name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length >= 3 && !NAME_STOPWORDS.has(w));
}

/**
 * How many of the searched hotel's significant words appear in a candidate's
 * display name (a cheap proxy for "is this actually the same property"),
 * and how many of the candidate's own significant words are NOT accounted
 * for — a tiebreaker so "Clark Marriott Hotel" beats "The Lounge at Clark
 * Marriott Hotel" for a search of "CLARK MARRIOTT": both match on every
 * searched word, but the second candidate is a sub-venue inside the hotel,
 * evidenced by its extra, unmatched words.
 */
function overlapScore(hotelName: string, candidateName: string): { matches: number; extras: number } {
  const searchWords = significantWords(hotelName);
  const candidateWords = significantWords(candidateName);
  const matches = searchWords.filter((w) => candidateWords.includes(w)).length;
  const extras = candidateWords.filter((w) => !searchWords.includes(w)).length;
  return { matches, extras };
}

/** True if `a` is a better match than the current best `b` (more matched words, then fewer unmatched extras). */
function isBetterMatch(a: { matches: number; extras: number }, b: { matches: number; extras: number }): boolean {
  if (a.matches !== b.matches) return a.matches > b.matches;
  return a.extras < b.extras;
}

async function searchPlaces(textQuery: string, apiKey: string): Promise<GooglePlace[]> {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.rating,places.userRatingCount,places.priceLevel,places.formattedAddress,places.googleMapsUri,places.location",
    },
    body: JSON.stringify({ textQuery, maxResultCount: 3 }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google Places returned ${response.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as { places?: GooglePlace[] };
  return data.places ?? [];
}

interface GoogleReview {
  rating?: number;
  text?: { text?: string };
}

async function fetchPlaceReviews(placeId: string, apiKey: string): Promise<GoogleReview[]> {
  const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "reviews" },
  });
  if (!response.ok) return [];
  const data = (await response.json()) as { reviews?: GoogleReview[] };
  return data.reviews ?? [];
}

const REVIEW_THEME_KEYS = new Set<ReviewThemeKey>([
  "quietness",
  "cleanliness",
  "service",
  "sleepComfort",
  "breakfast",
  "safety",
]);
const REVIEW_SENTIMENTS = new Set<ReviewSentiment>(["positive", "mixed", "negative"]);

const REVIEW_SUMMARY_SYSTEM_PROMPT = `You analyze hotel guest reviews for airline flight crew on work layovers. Given review excerpts for one hotel, identify what reviewers actually said about up to six themes:
- quietness: room/hotel noise
- cleanliness: how clean the property is
- service: staff friendliness and helpfulness
- sleepComfort: bed and sleep quality
- breakfast: breakfast quality (only if reviewers mention breakfast at all)
- safety: safety and neighborhood feel

Only include a theme in your output if the reviews actually discuss it — never guess, infer, or embellish a theme with no real textual support. Rate each included theme "positive", "mixed", or "negative" based on the balance of what reviewers wrote.

Also write a 1-2 sentence plain-language summary a busy pilot could read in five seconds, grounded only in what the reviews say — specific, not generic ("Reviewers consistently mention a quiet room and an easy walk to restaurants; a few note the gym is small.").

Respond with ONLY a JSON object in exactly this shape, no other text, no markdown fences:
{"summary": "...", "themes": {"quietness": "positive"}}`;

function parseReviewSummaryResponse(
  text: string
): { summary: string; themes: Partial<Record<ReviewThemeKey, ReviewSentiment>> } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { summary?: unknown; themes?: unknown };
    if (typeof parsed.summary !== "string" || !parsed.summary.trim()) return null;
    const themes: Partial<Record<ReviewThemeKey, ReviewSentiment>> = {};
    if (parsed.themes && typeof parsed.themes === "object") {
      for (const [theme, sentiment] of Object.entries(parsed.themes as Record<string, unknown>)) {
        if (REVIEW_THEME_KEYS.has(theme as ReviewThemeKey) && REVIEW_SENTIMENTS.has(sentiment as ReviewSentiment)) {
          themes[theme as ReviewThemeKey] = sentiment as ReviewSentiment;
        }
      }
    }
    return { summary: parsed.summary.trim(), themes };
  } catch {
    return null;
  }
}

/**
 * Best-effort: review summarization is additive on top of the core hotel
 * lookup, so any failure here (no key configured, no reviews, a bad LLM
 * response) degrades to `null` rather than breaking the hotel result the
 * pilot actually asked for.
 */
async function summarizeReviews(
  hotelName: string,
  placeId: string,
  googleApiKey: string,
  anthropicApiKey: string
): Promise<ReviewSummary | null> {
  const reviews = await fetchPlaceReviews(placeId, googleApiKey);
  const excerpts = reviews.map((r) => r.text?.text?.trim()).filter((t): t is string => !!t);
  if (excerpts.length === 0) return null;

  const reviewLines = reviews
    .map((r) => `- (${r.rating ?? "?"}/5) ${r.text?.text?.trim() ?? ""}`)
    .filter((l) => l.length > 8)
    .join("\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 500,
      system: REVIEW_SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Hotel: ${hotelName}\n\nReview excerpts:\n${reviewLines}` }],
    }),
  });
  if (!response.ok) return null;

  const data = (await response.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) return null;

  const parsed = parseReviewSummaryResponse(text);
  if (!parsed) return null;

  return {
    summary: parsed.summary,
    themes: parsed.themes,
    reviewCount: excerpts.length,
    generatedAt: new Date().toISOString(),
  };
}

async function findHotelOnGoogle(
  code: string,
  hotelName: string,
  apiKey: string,
  anthropicApiKey: string | undefined
): Promise<HotelResult | null> {
  // The pairing schedule's own hotel name is often abbreviated (e.g. "HILTON
  // NRT" for the Hilton Tokyo Narita), and most crew hotels genuinely are
  // airport-adjacent — but several real assigned hotels are well-known
  // downtown properties (Fairmont Singapore, Sheraton Saigon, Grand Hyatt
  // Taipei) that an airport-anchored query excludes entirely rather than
  // just ranking lower. Both queries run in parallel and the candidate whose
  // name best overlaps the searched hotel name wins, tie-breaking toward the
  // airport-anchored result since that's right far more often than not.
  const [airportResults, cityResults] = await Promise.all([
    searchPlaces(`${hotelName} hotel near ${airportSearchName(code)}`, apiKey),
    searchPlaces(`${hotelName} hotel, ${citySearchName(code)}`, apiKey),
  ]);

  let best: GooglePlace | null = null;
  let bestScore = { matches: -1, extras: Infinity };
  for (const place of [...airportResults, ...cityResults]) {
    const score = overlapScore(hotelName, place.displayName?.text ?? "");
    if (isBetterMatch(score, bestScore)) {
      bestScore = score;
      best = place;
    }
  }
  if (!best) best = airportResults[0] ?? cityResults[0] ?? null;
  if (!best) return null;

  const location = best.location
    ? { latitude: best.location.latitude, longitude: best.location.longitude }
    : null;

  const [amenities, reviewSummary] = await Promise.all([
    fetchAmenitySummary(location, apiKey),
    best.id && anthropicApiKey
      ? summarizeReviews(hotelName, best.id, apiKey, anthropicApiKey).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    name: best.displayName?.text ?? hotelName,
    rating: best.rating ?? null,
    userRatingCount: best.userRatingCount ?? null,
    priceLevel: best.priceLevel ? (PRICE_LEVELS[best.priceLevel] ?? null) : null,
    formattedAddress: best.formattedAddress ?? null,
    googleMapsUri: best.googleMapsUri ?? null,
    location,
    amenities,
    reviewSummary,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get("code") ?? "").trim().toUpperCase();
  const hotelName = (searchParams.get("name") ?? "").trim();

  if (!/^[A-Z]{3,4}$/.test(code)) {
    return NextResponse.json({ error: "Expected a 3-4 letter airport code." }, { status: 400 });
  }
  if (!hotelName || hotelName.length > 100) {
    return NextResponse.json({ error: "Expected a hotel name." }, { status: 400 });
  }

  const key = cacheKey(code, hotelName);
  const cached = await getCachedHotel(key);
  if (cached !== undefined) {
    const result: HotelLookupResult = { code, hotelName, hotel: cached, error: null };
    return NextResponse.json(result);
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    const result: HotelLookupResult = {
      code,
      hotelName,
      hotel: null,
      error: "Hotel ratings aren't configured yet — add a Google Places API key to enable this.",
    };
    return NextResponse.json(result);
  }

  try {
    const hotel = await findHotelOnGoogle(code, hotelName, apiKey, process.env.ANTHROPIC_API_KEY);
    await setCachedHotel(key, hotel);
    const result: HotelLookupResult = { code, hotelName, hotel, error: null };
    return NextResponse.json(result);
  } catch (e) {
    const result: HotelLookupResult = {
      code,
      hotelName,
      hotel: null,
      error: e instanceof Error ? e.message : "Couldn't reach Google Places.",
    };
    return NextResponse.json(result);
  }
}
