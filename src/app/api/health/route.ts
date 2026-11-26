import { checkHealth } from "@/lib/server/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * For an outside uptime monitor (UptimeRobot, Better Stack): 200 while the server, Redis and Postgres answer, 503 when
 * one doesn't, with which (`lib/server/health.ts`). Says nothing a stranger could use: no versions, settings or errors.
 *
 *   GET /api/health
 */
export async function GET() {
  const health = await checkHealth();
  return Response.json(health, { status: health.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
