import type { ParseBidPackResult, ParseProgress } from "@/lib/pdf-parser/types";

export type StreamMessage =
  | ({ type: "progress" } & ParseProgress)
  | { type: "result"; result: ParseBidPackResult }
  | { type: "error"; error: string };

/**
 * Splits newline-delimited JSON as it arrives in arbitrary chunks: returns
 * every complete message, plus the unfinished tail to prepend to the next
 * chunk. A line that isn't valid JSON is skipped rather than ending the read.
 */
export function splitNdjson(buffer: string): { messages: StreamMessage[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  const messages: StreamMessage[] = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    try {
      messages.push(JSON.parse(part) as StreamMessage);
    } catch {
      // A malformed line can't be a result; ignore it and keep reading.
    }
  }
  return { messages, rest };
}

/**
 * Uploads a bid pack and resolves with the parse result, calling
 * `onProgress` with each real progress event the server streams on the way
 * (see `/api/parse-bidpack`). Falls back to a plain JSON response if that's
 * what comes back. Rejects with a message fit to show a pilot.
 */
export async function uploadBidPack(file: File, onProgress: (progress: ParseProgress) => void): Promise<ParseBidPackResult> {
  const body = new FormData();
  body.append("file", file);
  let res: Response;
  try {
    res = await fetch("/api/parse-bidpack", { method: "POST", body, headers: { Accept: "application/x-ndjson" } });
  } catch {
    throw new Error("Couldn't reach the server to parse this file. Check your connection and try again.");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? "Something went wrong while uploading this file.");
  }

  if (!res.headers.get("content-type")?.includes("ndjson") || !res.body) {
    return (await res.json()) as ParseBidPackResult;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const { messages, rest } = splitNdjson(done ? `${buffer}\n` : buffer);
    buffer = rest;
    for (const m of messages) {
      if (m.type === "progress") onProgress(m);
      else if (m.type === "result") return m.result;
      else if (m.type === "error") throw new Error(m.error);
    }
    if (done) break;
  }
  throw new Error("The connection closed before the bid pack finished reading. Try again.");
}
