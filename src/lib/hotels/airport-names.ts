/**
 * IATA code -> a search-friendly airport/city name, for looking up nearby
 * hotels. Google's Places API text search generally resolves a bare 3-letter
 * code reasonably well for major US domestic airports (the code itself is
 * unambiguous), but several international codes this bid pack actually uses
 * either aren't well recognized as bare codes or map to a city name quite
 * different from anything in the code — CRK (Clark, Philippines) and SGN
 * (Ho Chi Minh City) are common examples. Only codes that need the help are
 * listed; anything else falls back to a generic "<code> airport" query.
 */
const AIRPORT_SEARCH_NAMES: Record<string, string> = {
  HKG: "Hong Kong International Airport",
  ICN: "Incheon International Airport Seoul",
  KIX: "Kansai International Airport Osaka",
  NRT: "Narita International Airport Tokyo",
  HND: "Haneda Airport Tokyo",
  PVG: "Shanghai Pudong International Airport",
  PEK: "Beijing Capital International Airport",
  TPE: "Taiwan Taoyuan International Airport",
  CAN: "Guangzhou Baiyun International Airport",
  SIN: "Singapore Changi Airport",
  BKK: "Suvarnabhumi Airport Bangkok",
  CGK: "Soekarno-Hatta International Airport Jakarta",
  PEN: "Penang International Airport",
  KUL: "Kuala Lumpur International Airport",
  CRK: "Clark International Airport Philippines",
  SGN: "Tan Son Nhat International Airport Ho Chi Minh City",
  HAN: "Noi Bai International Airport Hanoi",
  MNL: "Ninoy Aquino International Airport Manila",
  DPS: "Ngurah Rai International Airport Bali",
};

export function airportSearchName(code: string): string {
  const normalized = code.trim().toUpperCase();
  return AIRPORT_SEARCH_NAMES[normalized] ?? `${normalized} airport`;
}

/**
 * A crew hotel isn't always near the airport — several of the specific
 * hotels this bid pack actually assigns are well-known downtown properties
 * (Fairmont Singapore, Sheraton Saigon, Grand Hyatt Taipei), and anchoring a
 * search to the airport actively excludes them from the results entirely
 * rather than just ranking them lower. Only codes actually seen assigning a
 * downtown-style hotel are listed; anything else falls back to the airport
 * name, since most crew hotels genuinely are airport-adjacent and a bare
 * city name is too broad for a sprawling metro with several same-brand
 * locations (e.g. multiple "Hilton Garden Inn"s across Los Angeles).
 */
const CITY_SEARCH_NAMES: Record<string, string> = {
  HKG: "Hong Kong",
  ICN: "Seoul, South Korea",
  KIX: "Osaka, Japan",
  HND: "Tokyo, Japan",
  PVG: "Shanghai, China",
  PEK: "Beijing, China",
  TPE: "Taipei, Taiwan",
  CAN: "Guangzhou, China",
  SIN: "Singapore",
  BKK: "Bangkok, Thailand",
  CGK: "Jakarta, Indonesia",
  PEN: "Penang, Malaysia",
  KUL: "Kuala Lumpur, Malaysia",
  CRK: "Clark, Pampanga, Philippines",
  SGN: "Ho Chi Minh City, Vietnam",
  HAN: "Hanoi, Vietnam",
  MNL: "Manila, Philippines",
  DPS: "Bali, Indonesia",
};

export function citySearchName(code: string): string {
  const normalized = code.trim().toUpperCase();
  return CITY_SEARCH_NAMES[normalized] ?? airportSearchName(normalized);
}
