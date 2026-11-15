import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({ back: true }));
vi.mock("@/lib/connection", () => ({ reportConnectionLost: vi.fn(), waitForConnection: vi.fn(async () => connection.back) }));

const { askTheContract } = await import("./client");

const ANSWER = { found: false, answer: "Not found in the contract sections we have.", closest: [], covered: [] };
const encoder = new TextEncoder();

function streamed(lines: unknown[], thenDrop = false): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines) controller.enqueue(encoder.encode(`${JSON.stringify(l)}\n`));
      if (!thenDrop) controller.close();
    },
    // Dropped once what was sent has been read.
    pull(controller) {
      if (thenDrop) controller.error(new Error("connection lost"));
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  connection.back = true;
  vi.stubGlobal("fetch", fetchMock);
});

describe("the chat's connection to the server", () => {
  it("passes on each step, in order, then returns the answer", async () => {
    fetchMock.mockResolvedValue(streamed([{ type: "step", text: "one" }, { type: "step", text: "two" }, { type: "answer", answer: ANSWER }]));
    const steps: string[] = [];
    expect(await askTheContract({ question: "q" }, (s) => steps.push(s))).toEqual(ANSWER);
    expect(steps).toEqual(["one", "two"]);
    expect(fetchMock.mock.calls[0][1].headers.Accept).toContain("ndjson");
  });

  it("after a dropped connection, resends with the same id and takes the kept reply, so it isn't paid for twice", async () => {
    fetchMock.mockResolvedValueOnce(streamed([{ type: "step", text: "one" }], true)).mockResolvedValueOnce(Response.json({ answer: ANSWER }));
    const steps: string[] = [];
    expect(await askTheContract({ question: "q" }, (s) => steps.push(s))).toEqual(ANSWER);
    const ids = fetchMock.mock.calls.map((c) => c[1].headers["X-Request-Id"]);
    expect(ids[0]).toBe(ids[1]);
    expect(steps).toEqual(["one", "The connection dropped. Waiting for it to come back…"]);
  });

  it("treats a stream that ends without an answer as dropped", async () => {
    fetchMock.mockResolvedValueOnce(streamed([{ type: "step", text: "one" }])).mockResolvedValueOnce(Response.json({ answer: ANSWER }));
    expect(await askTheContract({ question: "q" }, () => {})).toEqual(ANSWER);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up when the connection never comes back", async () => {
    connection.back = false;
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(askTheContract({ question: "q" }, () => {})).rejects.toThrow("Check your connection");
  });

  it("shows the server's reason for turning a question down, without retrying", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "That's today's questions for guests. Sign in to ask more.", final: true }, { status: 429 }));
    await expect(askTheContract({ question: "q" }, () => {})).rejects.toMatchObject({ message: expect.stringContaining("Sign in"), final: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves Try again on a limit that passes in a few minutes, so the question can be sent again", async () => {
    for (const error of ["Too many requests — please slow down and try again shortly.", "You've got a few AI requests running already. Try again when one finishes — everything you've done is saved."]) {
      fetchMock.mockResolvedValueOnce(Response.json({ error }, { status: 429 }));
      const refused = await askTheContract({ question: "q" }, () => {}).catch((e: Error & { final?: boolean }) => e);
      expect(refused).toMatchObject({ message: error });
      expect((refused as { final?: boolean }).final).toBeFalsy();
    }
  });

  it("shows an error from the stream, without retrying", async () => {
    fetchMock.mockResolvedValue(streamed([{ type: "error", error: "Couldn't answer that just now." }]));
    await expect(askTheContract({ question: "q" }, () => {})).rejects.toThrow("Couldn't answer");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
