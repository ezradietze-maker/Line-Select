import { NextResponse } from "next/server";
import { getJson, incrementCounter, setJson } from "@/lib/server/kv";
import { clientIp, deviceIdFrom } from "@/lib/server/rate-limit";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL_MS = 2000;
const MAX_COPIES = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A paid call the browser may send twice: when a phone drops its connection mid-request (a hotel's Wi-Fi, the tab put
 * in the background), the first copy has usually reached the server and runs to the end — billed — and the browser
 * sends it again once the connection is back. Each copy carries the same request id (`X-Request-Id`): a finished
 * answer is handed back as it was, and a copy arriving while the first is still running waits for it, up to `waitMs`,
 * instead of paying for the same answer twice. Without an id, or once the first copy failed, it simply runs.
 */
export async function onceForRequest(request: Request, waitMs: number, run: () => Promise<Response>): Promise<Response> {
  return once(request, waitMs, async (remember) => {
    const res = await run();
    try {
      await remember(res.status, res.ok ? await res.clone().json() : null);
    } catch {
      // Kept or not, this copy's answer still goes back.
    }
    return res;
  });
}

/**
 * The same, for a route that streams its progress: `run` returns the stream at once and calls `remember` with the final
 * reply when it has one, so a copy sent after a dropped connection gets that reply as plain JSON. `run` must then finish
 * whether or not anyone is still reading the stream.
 */
export function onceForStream(request: Request, waitMs: number, run: (remember: Remember) => Promise<Response>): Promise<Response> {
  return once(request, waitMs, run);
}

export type Remember = (status: number, body: unknown) => Promise<void>;

async function once(request: Request, waitMs: number, run: (remember: Remember) => Promise<Response>): Promise<Response> {
  const id = request.headers.get("x-request-id");
  if (!id || !ID.test(id)) return run(async () => {});
  // The id is the browser's own pick: tied to the route and to whoever sent it (their device, else their address), so
  // an id seen elsewhere can't fetch someone else's answer.
  const sender = deviceIdFrom(request) ?? clientIp(request);
  const key = `line-select:replay:${new URL(request.url).pathname}:${sender}:${id}`;
  const answer = async () => {
    const r = await getJson<{ status: number; body: unknown }>(`${key}:reply`);
    return r ? NextResponse.json(r.body, { status: r.status }) : null;
  };
  const remember: Remember = async (status, body) => {
    if (status >= 200 && status < 300) await setJson(`${key}:reply`, { status, body }, { ttlSeconds: 15 * 60 });
    else await setJson(`${key}:failed`, 1, { ttlSeconds: 5 * 60 });
  };
  try {
    const ready = await answer();
    if (ready) return ready;
    const claims = await incrementCounter(`${key}:claim`, Math.ceil(waitMs / 1000) + 60);
    // A real resend is the second copy, now and then a third. More than that is someone holding functions open on
    // one id without ever reaching the rate limits, which only the run itself checks.
    if (claims > MAX_COPIES) return NextResponse.json({ error: "Too many requests — please slow down and try again shortly." }, { status: 429 });
    if (claims > 1) {
      for (let waited = 0; waited < waitMs; waited += POLL_MS) {
        await sleep(POLL_MS);
        const done = await answer();
        if (done) return done;
        if (await getJson<number>(`${key}:failed`)) return run(remember);
      }
      // Still not back: the first copy is running long or was cut off. Running again now would only be cut off too.
      return NextResponse.json({ error: "That's taking longer than usual. Try again in a moment." }, { status: 503 });
    }
  } catch {
    // The store being unreachable never stops the call itself.
  }
  return run(remember).catch(async (e) => {
    await setJson(`${key}:failed`, 1, { ttlSeconds: 5 * 60 }).catch(() => {});
    throw e;
  });
}
