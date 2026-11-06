export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Answers "the server is reachable" for `lib/connection.ts` while the app is offline. Touches nothing; costs nothing. */
export function GET() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
