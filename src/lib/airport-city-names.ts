/**
 * The city a pilot means by each airport code — "Hartford", not "BDL" —
 * for screens where a pilot rates or picks layover cities by name. Covers
 * every layover city in the October 2026 FedEx bid packs (ANC, IND and MEM
 * bases, every fleet); an unlisted code falls back to the code itself.
 */
const AIRPORT_CITY_NAMES: Record<string, string> = {
  ABE: "Allentown", ABQ: "Albuquerque", AFW: "Fort Worth Alliance", AKL: "Auckland", ALB: "Albany", AMS: "Amsterdam",
  ANC: "Anchorage", ATL: "Atlanta", ATW: "Appleton", AUS: "Austin", BDL: "Hartford", BFM: "Mobile", BHM: "Birmingham",
  BLR: "Bengaluru", BMI: "Bloomington", BNA: "Nashville", BOG: "Bogotá", BOI: "Boise", BOM: "Mumbai",
  BOS: "Boston", BQN: "Aguadilla", BTV: "Burlington", BUF: "Buffalo", BUR: "Burbank", BWI: "Baltimore", CAE: "Columbia",
  CAN: "Guangzhou", CDG: "Paris", CGN: "Cologne", CHA: "Chattanooga", CID: "Cedar Rapids", CLE: "Cleveland",
  CLT: "Charlotte", COS: "Colorado Springs", CRK: "Clark", CVG: "Cincinnati", DAY: "Dayton", DEL: "Delhi", DEN: "Denver",
  DFW: "Dallas–Fort Worth", DOV: "Dover AFB", DSM: "Des Moines", DTW: "Detroit", DUB: "Dublin",
  ELP: "El Paso", EWR: "Newark", EZE: "Buenos Aires", FAR: "Fargo", FAT: "Fresno", FLL: "Fort Lauderdale", FNT: "Flint",
  FRA: "Frankfurt", FSD: "Sioux Falls", GDL: "Guadalajara", GEG: "Spokane", GJT: "Grand Junction", GRR: "Grand Rapids",
  GSO: "Greensboro", GSP: "Greenville–Spartanburg", GTF: "Great Falls", GUM: "Guam", HAN: "Hanoi", HKG: "Hong Kong",
  HNL: "Honolulu", HRL: "Harlingen", HTS: "Huntington", IAD: "Washington Dulles", IAH: "Houston", ICN: "Seoul",
  ICT: "Wichita", IND: "Indianapolis", IST: "Istanbul", JAX: "Jacksonville", JFK: "New York JFK", JNB: "Johannesburg",
  KIX: "Osaka", LAS: "Las Vegas", LAX: "Los Angeles", LBB: "Lubbock", LCK: "Columbus Rickenbacker", LFT: "Lafayette",
  LGG: "Liège", LHR: "London Heathrow", LRD: "Laredo", MCI: "Kansas City", MCO: "Orlando", MDT: "Harrisburg",
  MEM: "Memphis", MHT: "Manchester NH", MIA: "Miami", MKE: "Milwaukee", MSN: "Madison", MSP: "Minneapolis",
  MSY: "New Orleans", MTY: "Monterrey", MXP: "Milan", NRT: "Tokyo Narita", OAK: "Oakland", OKC: "Oklahoma City",
  OMA: "Omaha", ONT: "Ontario", ORD: "Chicago", ORF: "Norfolk", PDX: "Portland", PHL: "Philadelphia", PHX: "Phoenix",
  PIT: "Pittsburgh", PTY: "Panama City", PVD: "Providence", PVG: "Shanghai", PWM: "Portland ME", QRO: "Querétaro",
  RDU: "Raleigh–Durham", RIC: "Richmond", RMS: "Ramstein", RNO: "Reno", ROA: "Roanoke", ROC: "Rochester",
  RST: "Rochester MN", RSW: "Fort Myers", SAN: "San Diego", SAT: "San Antonio", SAV: "Savannah", SBN: "South Bend",
  SCL: "Santiago", SDF: "Louisville", SDQ: "Santo Domingo", SEA: "Seattle", SFO: "San Francisco", SGF: "Springfield",
  SHV: "Shreveport", SIN: "Singapore", SJC: "San Jose", SJU: "San Juan", SLC: "Salt Lake City", SMF: "Sacramento",
  STL: "St. Louis", STN: "London Stansted", SWF: "Newburgh", SYD: "Sydney", SYR: "Syracuse", SZX: "Shenzhen",
  TLC: "Toluca", TLH: "Tallahassee", TPA: "Tampa", TPE: "Taipei", TUL: "Tulsa", TUS: "Tucson", TYS: "Knoxville",
  UIO: "Quito", VCP: "Campinas", XMN: "Xiamen", YEG: "Edmonton", YMX: "Montréal Mirabel", YOW: "Ottawa",
  YVR: "Vancouver", YWG: "Winnipeg", YYC: "Calgary", YYZ: "Toronto",
};

/** The city name for an airport code, or null when it isn't known. */
export function airportCityName(code: string): string | null {
  return AIRPORT_CITY_NAMES[code.trim().toUpperCase()] ?? null;
}
