import { describe, expect, it } from "vitest";
import { exchangesProblem, MAX_ANSWER, MAX_EXCHANGES, readExchanges } from "@/lib/server/brain-input";

const ex = (answers: string[]) => answers.map((answer, turn) => ({ turn, question: turn === 0 ? "Walk us through your whole bidding process, start to finish, in your own words." : `How many legs a day is too many for you? (q${turn})`, answer }));

describe("an interview the brain routes refuse", () => {
  it("says which answer is too long, and by how much", () => {
    const long = ex(["My story.", "Two legs.", "x".repeat(12_500)]);
    expect(readExchanges(long)).toBeNull();
    expect(exchangesProblem(long)).toBe("Your answer to “How many legs a day is too many for you? (q2)” is too long: 12,500 characters, and one answer can be up to 12,000. Go back and shorten it.");
  });

  it("names the story when it's the story", () => {
    expect(exchangesProblem(ex(["x".repeat(MAX_ANSWER + 1)]))).toMatch(/^Your story is too long: 12,001 characters/);
  });

  it("shortens a long question to its start, without the line pair's note for the model", () => {
    const e = [{ turn: 3, question: `${"Which of these two lines would you bid higher, given everything you said about weekends".padEnd(80, ".")} [Line 2041 vs Line 2007: days off against pay]`, answer: "y".repeat(MAX_ANSWER + 1) }];
    const said = exchangesProblem(e)!;
    expect(said).toMatch(/^Your answer to “Which of these two lines would you bid higher, given…” is too long/);
    expect(said).not.toContain("Line 2041");
  });

  it("says when there are too many answers", () => {
    expect(exchangesProblem(ex(Array.from({ length: MAX_EXCHANGES + 1 }, () => "ok")))).toMatch(/more answers than one read can take/);
  });

  it("leaves the plain refusal to anything else", () => {
    expect(exchangesProblem(ex(["fine", "fine"]))).toBeNull();
    expect(exchangesProblem("junk")).toBeNull();
    expect(exchangesProblem([null])).toBeNull();
  });

  it("still takes an answer right at the limit", () => {
    expect(readExchanges(ex(["story", "z".repeat(MAX_ANSWER)]))).toHaveLength(2);
  });
});
