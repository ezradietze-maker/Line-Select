import { NextResponse } from "next/server";
import { getJson, incrementCounter, setJson } from "@/lib/server/kv";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL_MS = 2000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A paid call the browser may send twice: when a phone drops its connection mid-request (a hotel's Wi-Fi, the tab put
 * in the background), the first copy has usually reached the server and runs to the end — billed — and the browser
 * sends it again once the connection is back. Each copy carries the same request id (`X-Request-Id`): a finished
 * answer is handed back as it was, and a copy arriving while the first is still running waits for it, up to `waitMs`,
 * instead of paying for the same answer twice. Without an id, or once the first copy failed, it simply runs.
 */
export async function onceForRequest(request: Request, waitMs: number, run: () => Promise<Response>): Promise<Response> {
  const id = request.headers.get("x-request-id");
  if (!id || !ID.test(id)) return run();
  const key = `line-select:replay:${id}`;
  const answer = async () => {
    const r = await getJson<{ status: number; body: unknown }>(`${key}:reply`);
    return r ? NextResponse.json(r.body, { status: r.status }) : null;
  };
  try {
    const ready = await answer();
    if (ready) return ready;
    if ((await incrementCounter(`${key}:claim`, Math.ceil(waitMs / 1000) + 60)) > 1) {
      for (let waited = 0; waited < waitMs; waited += POLL_MS) {
        await sleep(POLL_MS);
        const done = await answer();
        if (done) return done;
        if (await getJson<number>(`${key}:failed`)) break;
      }
    }
  } catch {
    // The store being unreachable never stops the call itself.
  }
  const res = await run();
  try {
    if (res.ok) await setJson(`${key}:reply`, { status: res.status, body: await res.clone().json() }, { ttlSeconds: 15 * 60 });
    else await setJson(`${key}:failed`, 1, { ttlSeconds: 5 * 60 });
  } catch {
    // Kept or not, this copy's answer still goes back.
  }
  return res;
}
