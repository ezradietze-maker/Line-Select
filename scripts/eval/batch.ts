import Anthropic from "@anthropic-ai/sdk";
import { routeStructuredCalls, structuredParams, structuredResult, type BrainUsage, type StructuredCallOptions } from "@/lib/brain/llm";

/**
 * Evaluation runs through the Message Batches API, at half the price of the same calls made one by one. Nobody waits on
 * an evaluation's answers, so it can take the batch's minutes instead of seconds: the brain re-reading the ex-pilot's
 * interview, paired brain reads, the interviewer replayed on recorded turns.
 *
 * The tasks run the app's own code unchanged — `buildPilotModel`, `nextInterviewStep` — with every structured call they
 * make collected (`routeStructuredCalls`) and sent together, round by round: a task that makes another call after the
 * first comes back (a retry, a second step) goes in the next round. The requests are built by the same function the app
 * uses (`structuredParams`), so a batched read is the same read; only the price differs.
 *
 * `cacheFresh` also marks the per-call part of each request for caching — for many reads of one interview, where every
 * request is the same and later ones can read the earlier ones' cache (best effort inside a batch).
 */

interface Pending {
  id: string;
  opts: StructuredCallOptions;
  resolve: (r: { data: unknown; usage: BrainUsage }) => void;
  reject: (e: Error) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The Batches API's half price. */
const BATCH_PRICE = 0.5;

export async function batched<R>(
  tasks: (() => Promise<R>)[],
  options: { cacheFresh?: boolean; pollMs?: number; quietMs?: number; log?: (line: string) => void } = {}
): Promise<{ results: PromiseSettledResult<R>[]; spend: number; rounds: number }> {
  const client = new Anthropic();
  const log = options.log ?? ((l: string) => console.log(l));
  const queue: Pending[] = [];
  let next = 0;
  let spend = 0;
  let rounds = 0;
  routeStructuredCalls(<T>(opts: StructuredCallOptions) => new Promise<{ data: T; usage: BrainUsage }>((resolve, reject) => queue.push({ id: `c${next++}`, opts, resolve: resolve as Pending["resolve"], reject })));
  let settled = false;
  const all = Promise.allSettled(tasks.map((t) => t())).finally(() => {
    settled = true;
  });
  try {
    for (;;) {
      // Wait until every running task has made its next call (the queue stops growing), or all are done.
      let last = -1;
      for (;;) {
        await sleep(options.quietMs ?? 1500);
        if (settled || (queue.length > 0 && queue.length === last)) break;
        last = queue.length;
      }
      if (!queue.length) break;
      const round = queue.splice(0);
      rounds++;
      const requests = round.map((p) => {
        // Server-side fallbacks aren't taken by the Batches API; nothing here uses a model that needs them.
        const params: Record<string, unknown> = { ...structuredParams(p.opts, { cacheFresh: options.cacheFresh }) };
        delete params.betas;
        delete params.fallbacks;
        return { custom_id: p.id, params: params as unknown as Anthropic.Beta.Messages.BatchCreateParams.Request["params"] };
      });
      const batch = await client.beta.messages.batches.create({ requests });
      log(`  [batch round ${rounds}: ${round.length} call${round.length === 1 ? "" : "s"}, ${batch.id}]`);
      const started = Date.now();
      for (;;) {
        const b = await client.beta.messages.batches.retrieve(batch.id);
        if (b.processing_status === "ended") break;
        await sleep(options.pollMs ?? 20_000);
      }
      const byId = new Map(round.map((p) => [p.id, p]));
      for await (const r of await client.beta.messages.batches.results(batch.id)) {
        const p = byId.get(r.custom_id);
        if (!p) continue;
        byId.delete(r.custom_id);
        if (r.result.type !== "succeeded") {
          p.reject(new Error(`batched call ${r.result.type}`));
          continue;
        }
        try {
          const out = structuredResult(r.result.message, Date.now() - started, BATCH_PRICE);
          spend += out.usage.costUsd;
          p.resolve(out);
        } catch (e) {
          p.reject(e as Error);
        }
      }
      for (const p of byId.values()) p.reject(new Error("batched call missing from the results"));
      if (settled) break;
    }
  } finally {
    routeStructuredCalls(null);
  }
  return { results: await all, spend, rounds };
}
