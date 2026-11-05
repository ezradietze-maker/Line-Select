/**
 * The city a pilot means by each airport code — "Oakland", not "OAK airport" — for every airport the app places on
 * the clock (`airport-timezones.ts`). Where a city has two airports in the packs, the airport tells them apart.
 */
const CITY_NAMES: Record<string, string> = {
  OAK: "Oakland", LAX: "Los Angeles", RNO: "Reno", LAS: "Las Vegas", FAT: "Fresno", SFO: "San Francisco", PHX: "Phoenix",
  SLC: "Salt Lake City", HKG: "Hong Kong", CAN: "Guangzhou", PVG: "Shanghai", SIN: "Singapore", ICN: "Seoul", KUL: "Kuala Lumpur",
  PEN: "Penang", BKK: "Bangkok", ANC: "Anchorage", MEM: "Memphis", HNL: "Honolulu", CDG: "Paris", AFW: "Fort Worth Alliance",
  NRT: "Tokyo Narita", KIX: "Osaka", TPE: "Taipei", CRK: "Clark", SGN: "Ho Chi Minh City", HAN: "Hanoi", CGK: "Jakarta",
  IND: "Indianapolis", ATL: "Atlanta", BUR: "Burbank", CLE: "Cleveland", CLT: "Charlotte", DEN: "Denver", DFW: "Dallas–Fort Worth",
  DTW: "Detroit", DUB: "Dublin", EWR: "Newark", IAD: "Washington Dulles", IAH: "Houston", IST: "Istanbul", JFK: "New York JFK",
  LCK: "Columbus Rickenbacker", LGG: "Liège", LHR: "London Heathrow", MCO: "Orlando", MIA: "Miami", MSP: "Minneapolis",
  ORD: "Chicago O'Hare", PDX: "Portland", PHL: "Philadelphia", PIT: "Pittsburgh", RDU: "Raleigh–Durham", STL: "St. Louis",
  TPA: "Tampa", YYZ: "Toronto", BOS: "Boston", DCA: "Washington Reagan", ELP: "El Paso", FLL: "Fort Lauderdale", ONT: "Ontario, CA",
  SEA: "Seattle", ABE: "Allentown", ABQ: "Albuquerque", ALB: "Albany", ATW: "Appleton", AUS: "Austin", BDL: "Hartford",
  BFM: "Mobile Downtown", BHM: "Birmingham", BMI: "Bloomington", BNA: "Nashville", BOI: "Boise", BTV: "Burlington", BUF: "Buffalo",
  BWI: "Baltimore", CAE: "Columbia", CHA: "Chattanooga", CHS: "Charleston", CID: "Cedar Rapids", COS: "Colorado Springs",
  CPR: "Casper", CVG: "Cincinnati", DAL: "Dallas Love Field", DAY: "Dayton", DJT: "Dallas Executive", DSM: "Des Moines", FAR: "Fargo",
  FNT: "Flint", FSD: "Sioux Falls", FWA: "Fort Wayne", GEG: "Spokane", GJT: "Grand Junction", GRR: "Grand Rapids", GSO: "Greensboro",
  GSP: "Greenville–Spartanburg", GTF: "Great Falls", HRL: "Harlingen", HTS: "Huntington", ICT: "Wichita", ITO: "Hilo",
  JAX: "Jacksonville", LBB: "Lubbock", LFT: "Lafayette", LGA: "New York LaGuardia", LRD: "Laredo", MCI: "Kansas City",
  MDT: "Harrisburg", MHT: "Manchester", MKE: "Milwaukee", MOB: "Mobile", MSN: "Madison", MSY: "New Orleans", OGG: "Maui",
  OKC: "Oklahoma City", OMA: "Omaha", ORF: "Norfolk", PVD: "Providence", PWM: "Portland, ME", RIC: "Richmond", ROA: "Roanoke",
  ROC: "Rochester", RST: "Rochester, MN", RSW: "Fort Myers", SAN: "San Diego", SAT: "San Antonio", SAV: "Savannah",
  SBD: "San Bernardino", SBN: "South Bend", SDF: "Louisville", SGF: "Springfield", SHV: "Shreveport", SJC: "San Jose", SMF: "Sacramento",
  SNA: "Santa Ana", SWF: "Newburgh", SYR: "Syracuse", TLH: "Tallahassee", TUL: "Tulsa", TUS: "Tucson", TYS: "Knoxville",
  BQN: "Aguadilla", SJU: "San Juan", SDQ: "Santo Domingo", GDL: "Guadalajara", MEX: "Mexico City", MTY: "Monterrey", QRO: "Querétaro",
  TLC: "Toluca", GUA: "Guatemala City", SAP: "San Pedro Sula", SJO: "San José, Costa Rica", PTY: "Panama City", BOG: "Bogotá",
  MDE: "Medellín", UIO: "Quito", GRU: "São Paulo", VCP: "Campinas", EZE: "Buenos Aires", SCL: "Santiago", YEG: "Edmonton",
  YYC: "Calgary", YMX: "Montreal Mirabel", YOW: "Ottawa", YUL: "Montreal", YVR: "Vancouver", YWG: "Winnipeg", AMS: "Amsterdam",
  BLL: "Billund", BRU: "Brussels", CGN: "Cologne", DUS: "Düsseldorf", FRA: "Frankfurt", HAJ: "Hanover", LIN: "Milan Linate",
  MXP: "Milan Malpensa", RMS: "Ramstein", STN: "London Stansted", BLR: "Bengaluru", BOM: "Mumbai", DEL: "Delhi", GUM: "Guam",
  HND: "Tokyo Haneda", ITM: "Osaka Itami", PEK: "Beijing", RUH: "Riyadh", SZX: "Shenzhen", XMN: "Xiamen", AKL: "Auckland",
  SYD: "Sydney", JNB: "Johannesburg", NBO: "Nairobi", MDW: "Chicago Midway", DOV: "Dover", MNL: "Manila", DPS: "Bali",
};

/** The city an airport serves, as a pilot says it; the code itself when it isn't known. */
export function cityName(code: string): string {
  const c = code.trim().toUpperCase();
  return CITY_NAMES[c] ?? c;
}
