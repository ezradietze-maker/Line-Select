import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { AVOIDED } from "@/lib/brain/pilot-words";

/**
 * Everything a pilot can read is in the bid pack's words or the ex-pilot's (`pilot-words.ts`): this reads every string in
 * the app's source for the words that are in neither, so one can't creep back in. A string this finds is either reworded,
 * or it's one of the few places below where the word belongs.
 */

/** Files a pilot never reads, or whose every word is for the model or the machine. */
const NOT_READ: RegExp[] = [
  /\.test\.tsx?$/,
  /^src\/app\/api\//, // Server routes; what they say to a pilot is checked below by name.
  /^src\/lib\/server\//,
  /^src\/lib\/pdf-parser\//, // Reads the pack; says nothing.
  /^src\/lib\/globe\//,
  /^src\/lib\/brain\/pilot-words\.ts$/, // The list itself.
  // The old interview, which nothing reaches any more.
  /^src\/lib\/interview-(?:prompt|topics|turn-service|engine)\.ts$/,
  // Prompts: the phrases a pilot may say, there so the model understands them. What the model writes is checked as it's written.
  /^src\/lib\/brain\/(?:build-model|interviewer|ask-pack|pack-brief|pilot-facts|swap-reason|fix-words|quick-brief)\.ts$/,
];

/** Strings where the word is right, and why. */
const RIGHT_HERE: { file: RegExp; word: string; why: string }[] = [
  { file: /^src\/lib\/contract\/contract-words\.ts$/, word: "base", why: "the contract's own terms: base hotel standby, base airport standby" },
  { file: /^src\/lib\/brain\/describe\.ts$/, word: "weighted", why: "a unit's name in code, turned into \"hours in cities you like\" before it's shown" },
  { file: /^src\/lib\/metrics\/catalog\.ts$/, word: "weighted", why: "a unit's name in code, turned into \"hours in cities you like\" before it's shown" },
  { file: /^src\/lib\/scoring-v2\/trip-score\.ts$/, word: "weighted", why: "a unit's name in code" },
  { file: /^src\/lib\/metrics\/home-travel\.ts$/, word: "base", why: "an id in code: where a trip starts, never shown" },
  { file: /^src\/lib\/profile-edits\.ts$/, word: "dealbreaker", why: "a severity value in code, never shown" },
  { file: /^src\/lib\/brain\/interview-examples\.ts$/, word: "joins from", why: "quoted as the question the ex-pilot said had the wrong words" },
  { file: /^src\/lib\/brain\/interview-examples\.ts$/, word: "layover value", why: "quoted as the question the ex-pilot couldn't answer" },
  { file: /^src\/lib\/brain\/interview-examples\.ts$/, word: "big blocks", why: "a pilot's own words, said back to him in a their-words example — allowed because he said them" },
  { file: /^src\/lib\/brain\/question-review\.ts$/, word: "big blocks", why: "quoted to the reviewer as the clumsy wording to send back" },
  { file: /^src\/lib\/brain\/question-review\.ts$/, word: "no real night", why: "quoted to the reviewer as app wording to send back" },
  { file: /^src\/lib\/brain\/question-review\.ts$/, word: "duties through the night", why: "quoted to the reviewer as app wording to send back" },
  { file: /^src\/lib\/brain\/review-examples\.ts$/, word: "big blocks", why: "the owner's flagged questions, quoted as what to send back" },
  { file: /^src\/lib\/brain\/review-examples\.ts$/, word: "no real night", why: "the owner's flagged questions, quoted as what to send back" },
  { file: /^src\/lib\/brain\/review-examples\.ts$/, word: "duties through the night", why: "the owner's flagged questions, quoted as what to send back" },
  { file: /^src\/lib\/vips-presend\.ts$/, word: "dealbreaker", why: "a check's id in code, never shown" },
  { file: /^src\/lib\/brain\/dealbreakers\.ts$/, word: "dealbreaker", why: "how the question opened before Nov 2026, so a saved interview still reads as having asked it" },
  { file: /^src\/lib\/open-time\/engine\.ts$/, word: "base", why: "an id in code (open-time-base), never shown" },
  { file: /^src\/lib\/(?:phase-in|vacation-slide)\.ts$/, word: "buffer", why: "the contract's rule ids (buffer-after, buffer-before), never shown" },
];

/** JSX attributes and object keys that hold code, not words. */
const CODE_ATTRIBUTES = new Set(["className", "d", "viewBox", "fill", "stroke", "href", "src", "id", "key", "type", "role", "style", "transform", "points", "strokeLinecap", "strokeLinejoin", "fontFamily", "rel", "target", "autoComplete", "inputMode", "name", "htmlFor"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every string in a file: literals, templates with their blanks marked, and JSX text. */
function stringsIn(path: string): { line: number; text: string }[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: { line: number; text: string }[] = [];
  const add = (n: ts.Node, text: string) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean) found.push({ line: source.getLineAndCharacterOfPosition(n.getStart()).line + 1, text: clean });
  };
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n) || ts.isTypeNode(n)) return;
    if (ts.isJsxAttribute(n) && (CODE_ATTRIBUTES.has(n.name.getText()) || /ClassName$/.test(n.name.getText()))) return;
    // Comparing to a string, or indexing by one, is code ("base" as a key), not words.
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.operatorToken.kind)) return;
    if (ts.isElementAccessExpression(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n, n.text);
    else if (ts.isTemplateExpression(n)) add(n, n.head.text + n.templateSpans.map((s) => `{…}${s.literal.text}`).join(""));
    else if (ts.isJsxText(n)) add(n, n.text);
    ts.forEachChild(n, visit);
  };
  visit(source);
  return found;
}

describe("the words the app says", () => {
  it("are the pack's or the ex-pilot's, everywhere a pilot reads them", () => {
    const wrong: string[] = [];
    for (const file of ["src/components", "src/app", "src/lib", "src/types"].flatMap(sourceFiles).map((f) => f.replace(/\\/g, "/"))) {
      if (NOT_READ.some((r) => r.test(file))) continue;
      for (const { line, text } of stringsIn(file))
        for (const a of AVOIDED) {
          const m = text.match(a.phrase);
          if (!m || RIGHT_HERE.some((r) => r.file.test(file) && m[0].toLowerCase().includes(r.word))) continue;
          wrong.push(`${file}:${line} "${m[0]}" — say ${a.say}`);
        }
    }
    expect(wrong).toEqual([]);
  }, 60_000);

  it("catches a short label on its own, not just a sentence", () => {
    // The day labels on the calendar said just "red-eye", and the Tools clock just "base".
    expect(AVOIDED.find((a) => a.name === "red-eye")?.phrase.test("red-eye")).toBe(true);
    expect(AVOIDED.find((a) => a.name === "base")?.phrase.test("base")).toBe(true);
  });
});
