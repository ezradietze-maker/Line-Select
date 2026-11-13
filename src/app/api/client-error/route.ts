import { reportBrowserProblem } from "@/lib/server/alerts";
import { isJsonObject, isText, readJsonBody } from "@/lib/server/json-body";
import { checkRequestLimit, clientIp } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/**
 * A crash in a pilot's browser, reported so the owner hears of it the way they hear of a server failure: counted, in
 * the daily summary, an email on the hour's third. The report is the error and where it happened — never anything the
 * pilot typed or their bid pack. Open to guests, so it's capped per device, and the email counts addresses and carries
 * none of what was sent (`reportBrowserProblem`): one sender can't write the owner's alert, set it off, or use it up. A
 * capped or malformed report is dropped without a word, since nothing waits on the answer.
 */
export async function POST(request: Request) {
  if (!(await checkRequestLimit("client-error", request, 20, 60 * 60)).ok) return new Response(null, { status: 204 });
  const body = await readJsonBody(request, 8_000);
  if (!isJsonObject(body) || !isText(body.message, 500)) return new Response(null, { status: 204 });
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const error = new Error(body.message);
  const stack = text(body.stack, 4_000);
  if (stack) error.stack = stack;
  await reportBrowserProblem(error, { where: text(body.where, 60), page: text(body.page, 200) }, clientIp(request));
  return new Response(null, { status: 204 });
}
