import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { airportSearchName, citySearchName } from "@/lib/hotels/airport-names";
import { isPlausibleMatch, pickBestMatch, readHotelName } from "@/lib/hotels/hotel-names";
import { cacheKey, getCachedHotel, setCachedHotel } from "@/lib/server/hotel-cache";
import { deleteKey, getJson, takeLock } from "@/lib/server/kv";
import { checkRateLimit, checkRequestLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { isPackHotel } from "@/lib/server/pack-hotels";
import { checkSpend, recordSpend, spenderFor, spendLimitResponse } from "@/lib/server/spend-guard";
import type { HotelAmenityCategory, HotelAmenitySummary, HotelLookupResult, HotelResult, ReviewSentiment, ReviewSummary, ReviewThemeKey } from "@/types/hotel";

// Reads/writes the local hotel-cache file, which needs Node's fs module.
/** How long one hotel's lookup holds off copies of it, and how long and how often a copy checks the cache for its answer. */
const LOOKUP_LOCK_SECONDS = 45;
const LOOKUP_WAIT_MS = 25_000;
const LOOKUP_POLL_MS = 500;

/** Uncached Google Places lookups allowed per IP per hour. Raised deliberately to cover a full cold bid pack, accepting the extra Places spend. */
const HOTEL_LOOKUPS_PER_HOUR = 250;
/**
 * What one uncached lookup costs, estimated from Google's list prices: two text searches, a nearby search, the
 * reviews, and a short AI summary of them. It counts toward the site's daily total only (see `checkSpend`).
 */
const LOOKUP_COST_USD = 0.15;
const UNLISTED_LOOKUPS_PER_DAY = 150;
/** Lookups the whole site makes in a day: a cold pack has around a hundred hotels, so this covers several fresh packs a day. Raise with HOTEL_SITE_DAILY_LOOKUPS. */
const hotelSiteLookupsPerDay = () => Number(process.env.HOTEL_SITE_DAILY_LOOKUPS) || 300;
/** A result missing its amenities or review summary for a passing failure is kept a day, not a month. */
const INCOMPLETE_CACHE_SECONDS = 24 * 60 * 60;

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

/** Google's own cap on `searchNearby` result counts — the most a single call can return regardless of how many types it covers. */
const MAX_NEARBY_RESULTS = 20;

/**
 * One `searchNearby` call covering every amenity category's Google types at
 * once (Google's `includedTypes` already accepts a mixed list and ORs them),
 * then buckets the results back into per-category counts locally via each
 * place's own `types` array. Previously this was 4 separate calls, one per
 * category — same amenity signal, a quarter of the Places API quota per hotel.
 */
export async function fetchAmenitySummary(location: LatLng | null, apiKey: string): Promise<HotelAmenitySummary | null> {
  if (!location) return null;
  const categories = Object.keys(AMENITY_TYPES) as HotelAmenityCategory[];
  const typeToCategory = new Map<string, HotelAmenityCategory>();
  for (const category of categories) {
    for (const type of AMENITY_TYPES[category]) typeToCategory.set(type, category);
  }

  const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.rating,places.types",
    },
    body: JSON.stringify({
      includedTypes: [...typeToCategory.keys()],
      maxResultCount: MAX_NEARBY_RESULTS,
      locationRestriction: { circle: { center: location, radius: AMENITY_RADIUS_METERS } },
    }),
  });
  const counts = Object.fromEntries(categories.map((c) => [c, 0])) as Record<HotelAmenityCategory, number>;
  // A refused request (a burst of lookups from a cold pack hitting Google's rate limit) is "couldn't tell", not
  // "nothing nearby": thrown, so the lookup is kept only briefly and asked again.
  if (!response.ok) throw new Error(`Places nearby search failed (${response.status})`);

  const data = (await response.json()) as { places?: { rating?: number; types?: string[] }[] };
  for (const place of data.places ?? []) {
    if ((place.rating ?? 0) < MIN_AMENITY_RATING) continue;
    const matchedCategories = new Set<HotelAmenityCategory>();
    for (const type of place.types ?? []) {
      const category = typeToCategory.get(type);
      if (category) matchedCategories.add(category);
    }
    for (const category of matchedCategories) counts[category]++;
  }
  return counts as HotelAmenitySummary;
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
    body: JSON.stringify({ textQuery, maxResultCount: 5 }),
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

const REVIEW_THEME_KEYS = new Set<ReviewThemeKey>(["quietness", "cleanliness", "service", "sleepComfort", "breakfast", "safety", "onSiteGym", "walkability"]);
const REVIEW_SENTIMENTS = new Set<ReviewSentiment>(["positive", "mixed", "negative"]);

const REVIEW_SUMMARY_SYSTEM_PROMPT = `You analyze hotel guest reviews for airline flight crew on work layovers. Given review excerpts for one hotel, identify what reviewers actually said about up to eight themes:
- quietness: room/hotel noise
- cleanliness: how clean the property is
- service: staff friendliness and helpfulness
- sleepComfort: bed and sleep quality
- breakfast: breakfast quality (only if reviewers mention breakfast at all)
- safety: how safe the property and neighborhood feel (only if reviewers actually raise safety, not just proximity)
- onSiteGym: whether the hotel's OWN on-site fitness center is usable and well-equipped — only if reviewers describe the property's own gym, not a gym elsewhere
- walkability: whether reviewers describe the surrounding area as easy to get around on foot — restaurants, shops, or transit within walking distance, sidewalks that actually exist, that kind of thing

Only include a theme in your output if the reviews actually discuss it — never guess, infer, or embellish a theme with no real textual support. Rate each included theme "positive", "mixed", or "negative" based on the balance of what reviewers wrote.

Also write a 1-2 sentence plain-language summary a busy pilot could read in five seconds, grounded only in what the reviews say — specific, not generic ("Reviewers consistently mention a quiet room and an easy walk to restaurants; a few note the gym is small.").

Respond with ONLY a JSON object in exactly this shape, no other text, no markdown fences:
{"summary": "...", "themes": {"quietness": "positive"}}`;

function parseReviewSummaryResponse(text: string): { summary: string; themes: Partial<Record<ReviewThemeKey, ReviewSentiment>> } | null {
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
async function summarizeReviews(hotelName: string, placeId: string, googleApiKey: string, anthropicApiKey: string): Promise<ReviewSummary | null> {
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
  if (!response.ok) throw new Error(`Review summary failed (${response.status})`);

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

async function findHotelOnGoogle(code: string, hotelName: string, apiKey: string, anthropicApiKey: string | undefined): Promise<{ hotel: HotelResult | null; complete: boolean }> {
  // The pairing schedule's own hotel name is often abbreviated (e.g. "HILTON
  // NRT" for the Hilton Tokyo Narita), and most crew hotels genuinely are
  // airport-adjacent — but several real assigned hotels are well-known
  // downtown properties (Fairmont Singapore, Sheraton Saigon, Grand Hyatt
  // Taipei) that an airport-anchored query excludes entirely rather than
  // just ranking lower. Both queries run in parallel and the candidate whose
  // name best overlaps the searched hotel name wins, tie-breaking toward the
  // airport-anchored result since that's right far more often than not.
  // Searched under its spelled-out name (the packs abbreviate: "DTREE S PARK", "INTERCON DT"), and only a match that's
  // plausibly the same hotel in the right place counts — otherwise no rating at all rather than another hotel's.
  const name = readHotelName(hotelName);
  if (!name.assigned) return { hotel: null, complete: true };
  const [airportResults, cityResults] = await Promise.all([
    searchPlaces(`${name.search} hotel near ${airportSearchName(code)}`, apiKey),
    searchPlaces(`${name.search} hotel, ${citySearchName(code)}`, apiKey),
  ]);

  const best = pickBestMatch(
    code,
    hotelName,
    [...airportResults, ...cityResults].map((place) => ({
      ...place,
      name: place.displayName?.text ?? "",
      formattedAddress: place.formattedAddress ?? null,
      location: place.location ?? null,
    }))
  );
  if (!best) return { hotel: null, complete: true };

  const location = best.location ? { latitude: best.location.latitude, longitude: best.location.longitude } : null;

  // Either side failing for a moment leaves its part empty and the result marked incomplete, so it isn't kept a month.
  let complete = true;
  const failed = () => {
    complete = false;
    return null;
  };
  const [amenities, reviewSummary] = await Promise.all([
    fetchAmenitySummary(location, apiKey).catch(failed),
    best.id && anthropicApiKey ? summarizeReviews(hotelName, best.id, apiKey, anthropicApiKey).catch(failed) : Promise.resolve(null),
  ]);

  const hotel: HotelResult = {
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
  return { hotel, complete };
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
  // Not assigned yet ("TBA"): nothing to look up.
  if (!readHotelName(hotelName).assigned) {
    const result: HotelLookupResult = { code, hotelName, hotel: null, error: null };
    return NextResponse.json(result);
  }

  // A cached match from before matches were checked (another city's hotel, another property) is looked up again.
  const usableCached = async () => {
    const raw = await getCachedHotel(key);
    return raw && !isPlausibleMatch(code, hotelName, raw) ? undefined : raw;
  };
  const cached = await usableCached();
  if (cached !== undefined) {
    const result: HotelLookupResult = { code, hotelName, hotel: cached, error: null };
    return NextResponse.json(result);
  }

  // Only cache misses reach here, which is what actually costs a Google
  // Places call — a cache hit above never touches this limit, so pilots
  // repeatedly viewing already-cached hotels are never throttled.
  // Sized for one real bid pack loading cold: a 283-line Captain pack has
  // ~100 unique hotels and a larger First Officer pack more, and the results
  // page looks all of them up at once. 60 left the first pilot to open a
  // fresh pack with only partial hotel data until the next hour.
  const { ok } = await checkRequestLimit("hotels-lookup", request, HOTEL_LOOKUPS_PER_HOUR, 60 * 60);
  if (!ok) return rateLimitedResponse();

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

  const spender = await spenderFor(request);
  const packHotel = await isPackHotel(code, hotelName);
  // A guest looks up only hotels a real uploaded pack names, so made-up names can't be used to run up Google's bill.
  if (!spender.signedIn && !packHotel) {
    const result: HotelLookupResult = { code, hotelName, hotel: null, error: null };
    return NextResponse.json(result);
  }
  // A signed-in pilot may look up names no parsed pack lists (a pack saved before packs' hotels were kept), but only
  // so many a day: unlimited, one account could spend the whole site's day on made-up names and pause the interview
  // for everyone. A pack has around a hundred hotels.
  const allowed = await checkSpend(spender, { siteOnly: true });
  if (!allowed.ok) return spendLimitResponse(allowed);
  if (!packHotel && !(await checkRateLimit("hotels-unlisted", spender.key, UNLISTED_LOOKUPS_PER_DAY, 24 * 60 * 60)).ok) return rateLimitedResponse();
  // Hotel lookups share the site's daily spending cap with the AI, so they get a ceiling of their own inside it: names
  // run through by the thousand (made up, or from an uploaded PDF) would otherwise pause the interview for everyone.
  // One lookup per hotel at a time: the same uncached hotel asked for at once (two tabs, two pilots opening a fresh
  // pack, or one guest's requests in parallel) paid Google for each copy and counted each against the site's day.
  // The others wait for the first one's answer in the cache, and look it up themselves only if it never comes. The first
  // lets go once it has answered, found or not: a lookup that failed kept the others waiting the full time for an answer
  // that was never coming, and a retry after it too.
  const lock = `hotel-lock:${key}`;
  const holding = await takeLock(lock, LOOKUP_LOCK_SECONDS);
  if (!holding) {
    for (let waited = 0; waited < LOOKUP_WAIT_MS; waited += LOOKUP_POLL_MS) {
      await new Promise((r) => setTimeout(r, LOOKUP_POLL_MS));
      const found = await usableCached();
      if (found !== undefined) {
        const result: HotelLookupResult = { code, hotelName, hotel: found, error: null };
        return NextResponse.json(result);
      }
      // Let go without an answer in the cache: the lookup failed, or rested for the day. Asking now beats waiting on.
      if (!(await getJson(lock))) break;
    }
  }
  try {
    if (!(await checkRateLimit("hotels-site", "all", hotelSiteLookupsPerDay(), 24 * 60 * 60)).ok) {
      const result: HotelLookupResult = { code, hotelName, hotel: null, error: "Hotel ratings are resting until tomorrow." };
      return NextResponse.json(result);
    }

    let charged = false;
    const charge = async () => {
      if (charged) return;
      charged = true;
      await recordSpend(spender, LOOKUP_COST_USD, { siteOnly: true });
    };
    try {
      const { hotel, complete } = await findHotelOnGoogle(code, hotelName, apiKey, process.env.ANTHROPIC_API_KEY);
      await charge();
      await setCachedHotel(key, hotel, complete ? undefined : INCOMPLETE_CACHE_SECONDS);
      const result: HotelLookupResult = { code, hotelName, hotel, error: null };
      return NextResponse.json(result);
    } catch (e) {
      // The detail (Google's own error body) goes to the server log, not the pilot.
      await reportProblem("hotels", e, { code });
      // The searches that ran before the failure were still billed — once.
      await charge().catch(() => {});
      const result: HotelLookupResult = {
        code,
        hotelName,
        hotel: null,
        error: "Couldn't reach Google Places.",
      };
      return NextResponse.json(result);
    }
  } finally {
    if (holding) await deleteKey(lock).catch(() => {});
  }
}
