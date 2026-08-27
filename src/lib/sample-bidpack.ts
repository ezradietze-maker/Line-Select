import type { BidPack, Trip } from "@/types/bidpack";

/**
 * A hand-built, entirely fictional bid pack for anyone exploring Line
 * Select without their own bid pack PDF in hand — used only by the "Try a
 * sample" path on the upload screen, never mixed with a real upload.
 *
 * This is NOT real FedEx pairing data reused as a demo (that would still be
 * the company's actual scheduling data, even without any pilot names on
 * it) — every trip below is fabricated from scratch. The one place real
 * data sneaks in on purpose is hotel names: they're real, well-known hotels
 * near each airport, so the Hotel Ratings screen has something genuine to
 * look up instead of an empty state.
 *
 * The local/GMT time pairs on every leg are hand-verified to be internally
 * consistent (same real-world instant, correct airport UTC offset) so the
 * circadian scoring in lib/circadian.ts runs on this exactly the way it
 * would on real bid pack data, not a shortcut.
 */

const tripA: Trip = {
  id: "sample-A",
  pairingNumber: "501",
  days: 2,
  layoverCities: ["LAX"],
  layoverDetails: [{ city: "LAX", hotelName: "Hilton Los Angeles Airport" }],
  reportTime: "afternoon",
  international: false,
  deadheadLegs: 0,
  creditHours: 7.5,
  landings: 2,
  tafbHours: 28.75,
  departures: 2,
  schedule: [
    {
      reportTimeLocal: "1400",
      startMinutes: 0,
      legs: [
        {
          flightNumber: "101",
          equipment: "77",
          isDeadhead: false,
          depAirport: "MEM",
          depTimeLocal: "1500",
          depTimeGmt: "2000",
          arrAirport: "LAX",
          arrTimeLocal: "1630",
          arrTimeGmt: "2330",
          blockHours: 3.5,
          startMinutes: 60,
          endMinutes: 270,
        },
      ],
      layover: {
        city: "LAX",
        hotelName: "Hilton Los Angeles Airport",
        transportToHotel: "SAMPLE SHUTTLE",
        transportFromHotel: "SAMPLE SHUTTLE",
        hours: 20,
        startMinutes: 270,
        endMinutes: 1470,
      },
    },
    {
      reportTimeLocal: "1230",
      startMinutes: 1470,
      legs: [
        {
          flightNumber: "102",
          equipment: "77",
          isDeadhead: false,
          depAirport: "LAX",
          depTimeLocal: "1315",
          depTimeGmt: "2015",
          arrAirport: "MEM",
          arrTimeLocal: "1845",
          arrTimeGmt: "2345",
          blockHours: 3.5,
          startMinutes: 1515,
          endMinutes: 1725,
        },
      ],
      layover: null,
    },
  ],
};

/** The "bad" one on purpose: a large eastward shift, a report inside the Window of Circadian Low on both ends, and a layover under the 8-hour severe-rest threshold — a real, demonstrable low score, not a fabricated one. */
const tripB: Trip = {
  id: "sample-B",
  pairingNumber: "502",
  days: 2,
  layoverCities: ["CDG"],
  layoverDetails: [{ city: "CDG", hotelName: "Hilton Paris Charles De Gaulle Airport" }],
  reportTime: "early",
  international: true,
  deadheadLegs: 0,
  creditHours: 18,
  landings: 2,
  tafbHours: 26.75,
  departures: 2,
  schedule: [
    {
      reportTimeLocal: "0300",
      startMinutes: 0,
      legs: [
        {
          flightNumber: "205",
          equipment: "77",
          isDeadhead: false,
          depAirport: "MEM",
          depTimeLocal: "0400",
          depTimeGmt: "0900",
          arrAirport: "CDG",
          arrTimeLocal: "2000",
          arrTimeGmt: "1800",
          blockHours: 9,
          startMinutes: 60,
          endMinutes: 600,
        },
      ],
      layover: {
        city: "CDG",
        hotelName: "Hilton Paris Charles De Gaulle Airport",
        transportToHotel: "SAMPLE SHUTTLE",
        transportFromHotel: "SAMPLE SHUTTLE",
        hours: 7,
        startMinutes: 600,
        endMinutes: 1020,
      },
    },
    {
      reportTimeLocal: "0300",
      startMinutes: 1020,
      legs: [
        {
          flightNumber: "206",
          equipment: "77",
          isDeadhead: false,
          depAirport: "CDG",
          depTimeLocal: "0345",
          depTimeGmt: "0145",
          arrAirport: "MEM",
          arrTimeLocal: "0545",
          arrTimeGmt: "1045",
          blockHours: 9,
          startMinutes: 1065,
          endMinutes: 1605,
        },
      ],
      layover: null,
    },
  ],
};

/** A long westward trip with real rest — the contrast case: a big trip that still scores well because the shift runs the easier direction and the layover is a real 24 hours. */
const tripC: Trip = {
  id: "sample-C",
  pairingNumber: "503",
  days: 3,
  layoverCities: ["HNL"],
  layoverDetails: [{ city: "HNL", hotelName: "Hilton Hawaiian Village Waikiki Beach Resort" }],
  reportTime: "afternoon",
  international: false,
  deadheadLegs: 0,
  creditHours: 18,
  landings: 2,
  tafbHours: 44,
  departures: 2,
  schedule: [
    {
      reportTimeLocal: "1100",
      startMinutes: 0,
      legs: [
        {
          flightNumber: "310",
          equipment: "77",
          isDeadhead: false,
          depAirport: "MEM",
          depTimeLocal: "1200",
          depTimeGmt: "1700",
          arrAirport: "HNL",
          arrTimeLocal: "1600",
          arrTimeGmt: "0200",
          blockHours: 9,
          startMinutes: 60,
          endMinutes: 600,
        },
      ],
      layover: {
        city: "HNL",
        hotelName: "Hilton Hawaiian Village Waikiki Beach Resort",
        transportToHotel: "SAMPLE SHUTTLE",
        transportFromHotel: "SAMPLE SHUTTLE",
        hours: 24,
        startMinutes: 600,
        endMinutes: 2040,
      },
    },
    {
      reportTimeLocal: "1600",
      startMinutes: 2040,
      legs: [
        {
          flightNumber: "311",
          equipment: "77",
          isDeadhead: false,
          depAirport: "HNL",
          depTimeLocal: "1700",
          depTimeGmt: "0300",
          arrAirport: "MEM",
          arrTimeLocal: "0700",
          arrTimeGmt: "1200",
          blockHours: 9,
          startMinutes: 2100,
          endMinutes: 2640,
        },
      ],
      layover: null,
    },
  ],
};

function sumTrips(trips: Trip[]) {
  return {
    totalCreditHours: trips.reduce((s, t) => s + t.creditHours, 0),
    totalTafbHours: trips.reduce((s, t) => s + t.tafbHours, 0),
    totalLandings: trips.reduce((s, t) => s + t.landings, 0),
    totalDepartures: trips.reduce((s, t) => s + t.departures, 0),
  };
}

function buildLine(lineNumber: string, daysOff: number, trips: Trip[]) {
  return {
    id: `sample-line-${lineNumber}`,
    lineNumber,
    trips,
    daysOff,
    estimated: false,
    ...sumTrips(trips),
  };
}

export const SAMPLE_BID_PACK: BidPack = {
  id: "sample-bidpack",
  month: "SAMPLE",
  base: "MEM",
  aircraft: "B777",
  seat: "CAP",
  bidPeriodDays: 28,
  lines: [
    buildLine("9001", 24, [tripA]),
    buildLine("9002", 24, [tripB]),
    buildLine("9003", 23, [tripC]),
    buildLine("9004", 20, [tripA, tripB]),
    buildLine("9005", 19, [tripA, tripC]),
    buildLine("9006", 18, [tripB, tripC]),
  ],
};
