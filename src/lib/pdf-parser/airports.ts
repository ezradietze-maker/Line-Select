/**
 * Curated set of US domestic airport/city codes. Anything NOT in this list
 * is treated as international. This is a heuristic, not an authoritative
 * lookup — it covers the airports FedEx pilots actually see in mainland US
 * pairings (major hubs, cargo-relevant fields, common layover cities) but
 * will misclassify obscure or newly-added codes. Good enough for scoring
 * purposes; not a source of truth for anything safety-related.
 */
export const US_DOMESTIC_CODES = new Set([
  "OAK", "SFO", "LAX", "ONT", "SAN", "SMF", "SJC", "BUR", "LGB", "PSP",
  "SEA", "PDX", "BOI", "GEG", "PSC",
  "LAS", "RNO", "SLC", "PHX", "TUS", "ABQ", "ELP",
  "DEN", "COS",
  "DFW", "IAH", "AUS", "SAT", "MSY", "OKC", "TUL",
  "ORD", "MDW", "MSP", "STL", "MCI", "OMA", "DSM", "MKE", "IND", "CVG", "CMH", "CLE", "DTW", "GRR", "FWA", "SBN",
  "ATL", "MIA", "FLL", "MCO", "TPA", "JAX", "RSW", "PBI", "SAV", "CHS", "RDU", "CLT", "GSO", "GSP", "BNA", "MEM",
  "BHM", "HSV",
  "JFK", "LGA", "EWR", "BOS", "PHL", "PIT", "BWI", "IAD", "DCA", "RIC", "ALB", "SYR", "ROC", "BUF", "PWM", "PVD",
  "SDF", "CAK", "TYS", "GNV",
  "ANC", "FAI", "HNL", "OGG", "KOA", "LIH",
  "GTF", "STL", "BFM", "GJT", "HTS", "MHT", "SWF", "MSY", "PIA", "BMI", "MLI", "CID", "DBQ", "SGF", "JLN", "FSM",
  "LBB", "MAF", "AMA", "ABI", "SPS", "TYR", "LFT", "SHV", "BTR", "MOB", "PNS", "DHN", "MGM", "AGS", "AVL", "FAY",
  "MYR", "ILM", "ECP", "VPS", "TLH", "GNV", "MLB", "PGD", "SRQ", "EYW",
  "BIS", "FAR", "SUX", "FSD", "RAP", "CYS", "COD", "JAC", "BZN", "MSO", "HLN", "GTF", "IDA", "TWF", "BOI",
  "RIC", "ORF", "PHF", "ROA", "LYH", "CHO",
  "DAY", "TOL", "FNT", "LAN", "AZO", "BTL",
  "ITH", "ELM", "BGM", "AVP", "MDT", "ABE", "ISP", "HPN", "ALB",
  "SAF", "GUC", "EGE", "ASE", "HDN", "MTJ",
  "OAJ", "EWN", "FAY", "RDU",
  "PIT", "ERI", "AOO", "IPT",
]);

export function isInternationalCity(code: string): boolean {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{3,4}$/.test(normalized)) return false;
  return !US_DOMESTIC_CODES.has(normalized);
}
