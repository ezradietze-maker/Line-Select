import { existsSync, readFileSync } from "node:fs";
import type { PilotModel } from "@/types/pilot-model";

/**
 * The hand-written reference model of the ex-pilot collaborator, built from
 * his own words — the check that scoring v2 ranks well when it's given the
 * right model. It quotes him and says where he lives, so it lives in the
 * gitignored eval cache, not in this public repository.
 */
const FILE = ".cache/eval/expilot-model.json";
export const EXPILOT_MODEL: PilotModel | null = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as PilotModel) : null;
