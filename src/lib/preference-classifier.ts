import { IMPLICIT_VARIABLES } from "@/lib/implicit-dimensions";

/** The full known taxonomy, explicit and implicit, as plain descriptors for the classifier — it only ever matches against variables that actually exist and have real weights to update. */
const EXPLICIT_DESCRIPTORS = [
  { id: "daysOff", label: "Days off", description: "How many scheduled days off the line has." },
  { id: "tripLength", label: "Trip length", description: "Whether trips run long or short." },
  { id: "departures", label: "Number of separate departures", description: "How many separate times a pilot leaves home for the month." },
  { id: "international", label: "International vs domestic", description: "How much of the flying is international." },
  { id: "reportTime", label: "Report time", description: "Early versus late/evening report times." },
  { id: "creditHours", label: "Credit hours", description: "Total pay/credit hours for the line." },
  { id: "deadheadTolerance", label: "Deadheading", description: "How much riding along as a passenger (not flying) the line has." },
  { id: "hotelFood", label: "Food near the hotel", description: "Restaurants or cafes walkable from the layover hotel." },
  { id: "hotelGym", label: "Hotel gym", description: "Gym access at the layover hotel." },
  { id: "hotelGrocery", label: "Grocery near the hotel", description: "Grocery or pharmacy access near the layover hotel." },
  { id: "hotelQuiet", label: "Room quietness", description: "How quiet the layover hotel room is." },
  { id: "hotelQuality", label: "Overall hotel quality", description: "General hotel comfort/cleanliness/service." },
  { id: "circadianHealth", label: "Circadian health", description: "Time-zone shifts, red-eye/early reports, and rest length that disrupt sleep and body clock." },
];

export function allKnownVariableDescriptors() {
  return [
    ...EXPLICIT_DESCRIPTORS,
    ...IMPLICIT_VARIABLES.map((v) => ({ id: v.id, label: v.label, description: v.description })),
  ];
}

export interface ClassifyResult {
  matchedVariableId: string | null;
  direction: "favors_more" | "favors_less" | null;
  proposedName: string | null;
  proposedDescription: string | null;
}

export async function classifyFreeText(input: {
  freeText: string;
  favoredSummary: string;
  overtakenSummary: string;
}): Promise<ClassifyResult | null> {
  try {
    const res = await fetch("/api/classify-preference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ ...input, variables: allKnownVariableDescriptors() }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ClassifyResult;
  } catch {
    return null;
  }
}

export async function submitCandidateVariable(input: {
  rawQuote: string;
  proposedName: string;
  proposedDescription: string;
  favoredLineNumber: string;
  overtakenLineNumber: string;
}): Promise<boolean> {
  try {
    const res = await fetch("/api/candidate-variables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(input),
    });
    return res.ok;
  } catch {
    return false;
  }
}
