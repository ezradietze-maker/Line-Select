import { NextResponse } from "next/server";
import { commuteGroupOf, seniorityBandOf, type Cohort } from "@/lib/learning/cohort";
import { decideInterviewPolicy, resolveCohort, type InterviewModel } from "@/lib/learning/interview-learning";
import { loadActiveModel } from "@/lib/server/learning-store";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const code = (v: string | null, max: number) => (v && /^[A-Za-z0-9]{1,12}$/.test(v) && v.length <= max ? v.toUpperCase() : null);

/**
 * What the fleet has learned that applies to one pilot about to be
 * interviewed: which questions their group answers so consistently that
 * the answer can be assumed (shown to them, changeable), what was predicted
 * for every other one (checked against their real answer afterward), and
 * where pilots like them differ most. No model yet means an empty plan —
 * the interview simply asks everything, as it always has.
 */
export async function GET(request: Request) {
  const { ok } = await checkRateLimit("interview-policy", clientIp(request), 30, 60 * 60);
  if (!ok) return rateLimitedResponse();
  const q = new URL(request.url).searchParams;
  const base = code(q.get("base"), 6);
  const aircraft = code(q.get("aircraft"), 8);
  const seat = code(q.get("seat"), 4);
  if (!base || !aircraft || !seat) return NextResponse.json({ error: "Missing base, aircraft or seat." }, { status: 400 });
  const commuter = q.get("commuter");
  const percentile = Number(q.get("percentile"));
  const cohort: Cohort = {
    base,
    aircraft,
    seat,
    commute: commuteGroupOf(commuter === "1" ? true : commuter === "0" ? false : null),
    seniority: seniorityBandOf(q.has("percentile") && Number.isFinite(percentile) ? percentile : null),
  };

  const model = await loadActiveModel<InterviewModel>("interview").catch(() => null);
  if (!model) return NextResponse.json({ version: null, groupSize: 0, assume: [], predictions: {}, focus: [], productiveTopics: [], quietTopics: [], targets: {} });

  const resolved = resolveCohort(model.payload, cohort);
  const policy = decideInterviewPolicy(resolved, model.payload.corrections, Math.random);
  const assume = Object.values(policy.decisions)
    .filter((d) => d.action === "assume")
    .map((d) => ({ dim: d.dim, bucket: d.prediction, share: resolved.dims[d.dim].consensus, support: resolved.dims[d.dim].support, typicalStrength: resolved.dims[d.dim].typicalStrength }));
  // A prediction is recorded for every dimension with real support, so every real answer checks the model.
  const predictions = Object.fromEntries(
    Object.values(policy.decisions)
      .filter((d) => resolved.dims[d.dim].support >= 10)
      .map((d) => [d.dim, d.prediction])
  );
  return NextResponse.json({
    version: policy.version,
    groupSize: policy.groupSize,
    assume,
    predictions,
    focus: policy.focus,
    productiveTopics: policy.productiveTopics,
    quietTopics: policy.quietTopics,
    targets: policy.targets,
  });
}
