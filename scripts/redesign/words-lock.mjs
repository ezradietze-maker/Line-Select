// Compares two `capture.mjs` runs and fails if the words on any page changed. The redesign is cosmetic only, so the
// expected result is zero differences.
//
//   node scripts/redesign/words-lock.mjs .cache/redesign/before/words.json .cache/redesign/after/words.json
import { readFileSync } from "node:fs";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("usage: words-lock.mjs <before/words.json> <after/words.json>");
  process.exit(2);
}
// Two things depend on when a page was captured rather than on the page: live weather on Cities (the temperature and
// the sky word from lib/weather-client.ts's SKY_WORDS are dropped, since a run where the weather service was slow shows
// none; the words around them are still compared) and the "new things" hint on What's new, which depends on which
// pages that run had already visited.
const WEATHER = /-?\d+ \| °[FC] \| · \| (?:Clear|Partly cloudy|Overcast|Fog|Drizzle|Rain|Snow|Thunderstorms) \| /g;
const mask = (words) =>
  Object.fromEntries(
    Object.entries(words).map(([k, v]) => [
      k,
      v.replace(WEATHER, "").replace("(new things since you last looked) | ", ""),
    ]),
  );
const before = mask(JSON.parse(readFileSync(beforePath, "utf8")));
const after = mask(JSON.parse(readFileSync(afterPath, "utf8")));

function firstDifference(a, b) {
  const x = a.split(" | "), y = b.split(" | ");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return { at: i, before: x.slice(i, i + 3).join(" | "), after: y.slice(i, i + 3).join(" | ") };
  }
  return null;
}

let failures = 0;
for (const key of Object.keys(before)) {
  if (!(key in after)) { console.log(`MISSING  ${key}`); failures++; continue; }
  if (before[key] === after[key]) continue;
  failures++;
  const d = firstDifference(before[key], after[key]);
  console.log(`CHANGED  ${key}\n  before: ${d?.before}\n  after:  ${d?.after}`);
}
console.log(failures ? `\n${failures} page(s) changed words.` : `\nWords lock holds: ${Object.keys(before).length} page captures identical.`);
process.exit(failures ? 1 : 0);
