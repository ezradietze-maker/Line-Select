/**
 * Airport code -> IANA timezone, for converting a leg's real Zulu timestamp
 * into local wall-clock time at either end. Seeded with every code this
 * project's bid packs (real and sample) actually use; extend this table
 * whenever a new airport code shows up in real data rather than guessing at
 * a zone from the code alone — an unlisted code should fail honestly (see
 * `timezoneForAirport`), not silently default to somewhere wrong.
 */
export const AIRPORT_TIMEZONES: Record<string, string> = {
  OAK: "America/Los_Angeles",
  LAX: "America/Los_Angeles",
  RNO: "America/Los_Angeles",
  LAS: "America/Los_Angeles",
  FAT: "America/Los_Angeles",
  SFO: "America/Los_Angeles",
  PHX: "America/Phoenix",
  SLC: "America/Denver",
  HKG: "Asia/Hong_Kong",
  CAN: "Asia/Shanghai",
  PVG: "Asia/Shanghai",
  SIN: "Asia/Singapore",
  ICN: "Asia/Seoul",
  KUL: "Asia/Kuala_Lumpur",
  PEN: "Asia/Kuala_Lumpur",
  BKK: "Asia/Bangkok",
  ANC: "America/Anchorage",
  MEM: "America/Chicago",
  HNL: "Pacific/Honolulu",
  CDG: "Europe/Paris",
  AFW: "America/Chicago",
  NRT: "Asia/Tokyo",
  KIX: "Asia/Tokyo",
  TPE: "Asia/Taipei",
  CRK: "Asia/Manila",
  SGN: "Asia/Ho_Chi_Minh",
  HAN: "Asia/Ho_Chi_Minh",
  CGK: "Asia/Jakarta",
  IND: "America/Indiana/Indianapolis",
  ATL: "America/New_York",
  BUR: "America/Los_Angeles",
  CLE: "America/New_York",
  CLT: "America/New_York",
  DEN: "America/Denver",
  DFW: "America/Chicago",
  DTW: "America/New_York",
  DUB: "Europe/Dublin",
  EWR: "America/New_York",
  IAD: "America/New_York",
  IAH: "America/Chicago",
  IST: "Europe/Istanbul",
  JFK: "America/New_York",
  LCK: "America/New_York",
  LGG: "Europe/Brussels",
  LHR: "Europe/London",
  MCO: "America/New_York",
  MIA: "America/New_York",
  MSP: "America/Chicago",
  ORD: "America/Chicago",
  PDX: "America/Los_Angeles",
  PHL: "America/New_York",
  PIT: "America/New_York",
  RDU: "America/New_York",
  STL: "America/Chicago",
  TPA: "America/New_York",
  YYZ: "America/Toronto",
  BOS: "America/New_York",
  DCA: "America/New_York",
  ELP: "America/Denver",
  FLL: "America/New_York",
  ONT: "America/Los_Angeles",
  SEA: "America/Los_Angeles",
};

/** Null (not a guess) when the code isn't in the table yet — see the module doc for why that's the honest default. */
export function timezoneForAirport(code: string): string | null {
  return AIRPORT_TIMEZONES[code] ?? null;
}
