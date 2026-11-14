import { apiFetch } from "@/lib/shown-account";
import { reportConnectionLost, waitForConnection } from "@/lib/connection";
import { splitNdjson } from "@/lib/upload-client";
import type { HistoryTurn } from "./ask";
import type { ContractAnswer } from "./types";

/** The browser's side of the chat: the working as it happens, then the checked answer. */

type Message = { type: "step"; text: string } | { type: "answer"; answer: ContractAnswer } | { type: "error"; error: string };

const WAIT_FOR_CONNECTION_MS = 3 * 60 * 1000;
const TIMEOUT_MS = 70_000;

export interface AskBody {
  question: string;
  history?: HistoryTurn[];
  facts?: string;
  bidMonth?: string;
}

/** Reads one reply: a stream of steps, or plain JSON when this is a resend of a question the server already answered. */
async function readReply(res: Response, onStep: (text: string) => void): Promise<ContractAnswer | "dropped"> {
  if (!res.headers.get("content-type")?.includes("ndjson") || !res.body) {
    const json = (await res.json().catch(() => ({}))) as { answer?: ContractAnswer; error?: string };
    // Out of questions for today: asking again won't help, and the chat doesn't offer to.
    if (res.status === 429) throw Object.assign(new Error(json.error ?? "That's today's questions used up."), { final: true });
    if (!res.ok || !json.answer) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json.answer;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      return "dropped";
    }
    buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
    const { messages, rest } = splitNdjson<Message>(chunk.done ? `${buffer}\n` : buffer);
    buffer = rest;
    for (const m of messages) {
      if (m.type === "step") onStep(m.text);
      else if (m.type === "answer") return m.answer;
      else if (m.type === "error") throw new Error(m.error);
    }
    if (chunk.done) return "dropped";
  }
}

/**
 * A dropped connection waits and sends the same request id again: the server finishes what it started and hands that
 * answer back, so the question isn't paid for twice.
 */
export async function askTheContract(body: AskBody, onStep: (text: string) => void): Promise<ContractAnswer> {
  const requestId = crypto.randomUUID();
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let reply: ContractAnswer | "dropped";
    try {
      const res = await apiFetch("/api/contract/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", "X-Request-Id": requestId },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      reply = await readReply(res, onStep);
    } catch (e) {
      if (ctrl.signal.aborted) throw new Error("That took too long to come back. Try again.");
      if (e instanceof TypeError) reply = "dropped"; // fetch itself failed: no connection
      else throw e;
    } finally {
      clearTimeout(timer);
    }
    if (reply !== "dropped") return reply;
    reportConnectionLost();
    onStep("The connection dropped. Waiting for it to come back…");
    if (attempt >= 3 || !(await waitForConnection(WAIT_FOR_CONNECTION_MS))) throw new Error("Couldn’t reach Line Select. Check your connection and try again.");
  }
}
