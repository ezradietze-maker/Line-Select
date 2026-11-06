import { NextResponse } from "next/server";
import { isJsonObject } from "@/lib/server/json-body";
import { isLearnerOff, loadActiveModel, rollBackModel, setLearnerOff, type ModelKind } from "@/lib/server/learning-store";
import { secretMatches } from "@/lib/server/secret";

export const runtime = "nodejs";

const KINDS: ModelKind[] = ["brain", "forecast-prior", "forecast-calibration", "interview"];

function authorized(request: Request): boolean {
  return secretMatches(request.headers.get("x-admin-key"), process.env.ADMIN_API_KEY);
}

/**
 * Admin-only control of what the fleet learning puts to use, without a deploy:
 *
 *   GET  /api/admin/learning                                   each learner: on or off, and the version in use
 *   POST /api/admin/learning {"kind":"brain","action":"off"}   stop using it now (its learning keeps running)
 *   POST /api/admin/learning {"kind":"brain","action":"on"}    use it again
 *   POST /api/admin/learning {"kind":"brain","action":"undo"}  go back to the version before the one in use
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const learners = await Promise.all(
    KINDS.map(async (kind) => {
      const off = await isLearnerOff(kind);
      const active = off ? null : await loadActiveModel(kind, { fresh: true });
      return { kind, off, inUse: active?.version ?? null };
    })
  );
  return NextResponse.json({ learners }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body: unknown = await request.json().catch(() => null);
  if (!isJsonObject(body) || !KINDS.includes(body.kind as ModelKind) || !["off", "on", "undo"].includes(body.action as string)) {
    return NextResponse.json({ error: `Send {"kind": one of ${KINDS.join(", ")}, "action": "off" | "on" | "undo"}.` }, { status: 400 });
  }
  const kind = body.kind as ModelKind;
  if (body.action === "undo") {
    const result = await rollBackModel(kind);
    return NextResponse.json(result ? { kind, undone: result } : { kind, error: "There's no earlier version to go back to." }, { status: result ? 200 : 409 });
  }
  await setLearnerOff(kind, body.action === "off");
  return NextResponse.json({ kind, off: body.action === "off" });
}
