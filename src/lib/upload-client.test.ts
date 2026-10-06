import { describe, expect, it } from "vitest";
import { splitNdjson } from "@/lib/upload-client";

describe("splitNdjson", () => {
  it("returns complete lines and keeps an unfinished one for the next chunk", () => {
    const { messages, rest } = splitNdjson('{"type":"progress","stage":"pairings","pairings":769}\n{"type":"progr');
    expect(messages).toEqual([{ type: "progress", stage: "pairings", pairings: 769 }]);
    expect(rest).toBe('{"type":"progr');
  });

  it("reassembles a message split across chunks", () => {
    const first = splitNdjson('{"type":"progress","stage":"lines",');
    const second = splitNdjson(`${first.rest}"lines":667}\n`);
    expect(first.messages).toEqual([]);
    expect(second.messages).toEqual([{ type: "progress", stage: "lines", lines: 667 }]);
    expect(second.rest).toBe("");
  });

  it("skips a malformed line instead of giving up on the stream", () => {
    const { messages } = splitNdjson('not json\n{"type":"error","error":"x"}\n');
    expect(messages).toEqual([{ type: "error", error: "x" }]);
  });
});
