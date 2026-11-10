import { CONTRACT_WORDS } from "./contract-words";
import { NODES, ancestorsOf, changedInside, childrenOf, contractNode, fullText, sectionPath, versionText } from "./index";
import { applicabilityOf } from "./phases";
import type { ContractNode } from "./types";

/** Keyword search over the contract's pieces, with the pilot's words translated into the contract's (BM25, hand-rolled: no paid or hosted search). */

const STOP = new Set(
  "a an and are as at be been but by can could did do does for from get got had has have how i if in into is it its just me my of on or our shall should so than that the their them then there they this to under up was we were what when where which who why will with would you your about any some whats hows whens wheres whos im ive id ill dont doesnt didnt cant wont isnt arent".split(" "),
);

const stem = (w: string): string => {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ied")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
};

export function tokens(text: string): string[] {
  return (text.toLowerCase().replace(/[’']/g, "").match(/[a-z0-9]+(?:[-/][a-z0-9]+)*/g) ?? []).filter((t) => !STOP.has(t)).map(stem);
}

interface Doc {
  node: ContractNode;
  tf: Map<string, number>;
  length: number;
  haystack: string;
}

const K1 = 1.2;
const B = 0.6;
const TITLE_WEIGHT = 3;

let built: { docs: Doc[]; df: Map<string, number>; avg: number } | null = null;

function index() {
  if (built) return built;
  const docs: Doc[] = [];
  const df = new Map<string, number>();
  let total = 0;
  for (const node of NODES) {
    const words = `${node.text} ${node.old ?? ""}`;
    const titles = [...ancestorsOf(node.id), node].flatMap((n) => (n.parent && n.title ? [n.title] : []));
    const all = [...tokens(words), ...titles.flatMap((t) => Array<string[]>(TITLE_WEIGHT).fill(tokens(t)).flat())];
    if (!all.length) continue;
    const tf = new Map<string, number>();
    for (const t of all) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    total += all.length;
    docs.push({ node, tf, length: all.length, haystack: `${words} ${titles.join(" ")}`.toLowerCase() });
  }
  built = { docs, df, avg: total / docs.length };
  return built;
}

/** The question's words with their contract equivalents; a term from the contract's own word is worth less than the pilot's. */
export function expandQuestion(question: string): { terms: Map<string, number>; phrases: string[] } {
  const terms = new Map<string, number>();
  const add = (t: string, w: number) => terms.set(t, Math.max(terms.get(t) ?? 0, w));
  const phrases: string[] = [];
  const raw = question.toLowerCase().replace(/[’']/g, "").match(/[a-z0-9]+(?:[-/][a-z0-9]+)*/g) ?? [];
  for (const word of raw) {
    if (!STOP.has(word)) add(stem(word), 1);
    const also = CONTRACT_WORDS[word];
    if (also) {
      for (const phrase of also) {
        phrases.push(phrase);
        for (const t of tokens(phrase)) add(t, 0.7);
      }
    }
  }
  for (let i = 0; i + 1 < raw.length; i++) {
    if (!STOP.has(raw[i]) && !STOP.has(raw[i + 1])) phrases.push(`${raw[i]} ${raw[i + 1]}`);
  }
  return { terms, phrases };
}

export interface Hit {
  id: string;
  score: number;
}

export function searchPieces(question: string, limit = 40): Hit[] {
  const { docs, df, avg } = index();
  const { terms, phrases } = expandQuestion(question);
  const hits: Hit[] = [];
  for (const d of docs) {
    let score = 0;
    for (const [t, weight] of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 1;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += weight * idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (d.length / avg))));
    }
    if (!score) continue;
    for (const p of phrases) if (d.haystack.includes(p)) score += 2.5;
    hits.push({ id: d.node.id, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** A passage the model reads: a piece at about the "25.E.6" level with all it holds, or a smaller one when that's too long. */
const MAX_PASSAGE_CHARS = 7000;

function passageFor(id: string): string {
  const chain = [...ancestorsOf(id), contractNode(id)!].filter((n) => n.parent);
  // Section › letter › number is the level pilots cite. Go deeper only until the passage fits.
  let pick = chain[Math.min(1, chain.length - 1)] ?? contractNode(id)!;
  for (const n of chain.slice(1)) {
    pick = n;
    if (fullText(n.id).length <= MAX_PASSAGE_CHARS) break;
  }
  return pick.id;
}

/** The words the search looks for, as the pilot wrote them, then the contract's own: for showing the search at work. */
export function searchWords(question: string, limit = 6): string[] {
  const raw = (question.replace(/[’']/g, "").match(/[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*/g) ?? []).filter((w) => !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w));
  const contract = raw.flatMap((w) => CONTRACT_WORDS[w.toLowerCase()] ?? []);
  const seen = new Set<string>();
  return [...raw, ...contract].filter((w) => !seen.has(w.toLowerCase()) && !!seen.add(w.toLowerCase())).slice(0, limit);
}

/** A follow-up leans on what came before: "what about for reserves?" says little alone. */
export interface EarlierContext {
  question: string;
  /** Where the last answer's quotes came from. They're read first. */
  sections: string[];
}

/** How much the earlier question counts against the one being asked. */
const EARLIER_WEIGHT = 0.35;

export function retrievePassages(question: string, budgetChars: number, earlier?: EarlierContext): { passages: string[]; hits: Hit[] } {
  const hits = searchPieces(question);
  const scores = new Map<string, number>();
  for (const [i, h] of hits.entries()) {
    const p = passageFor(h.id);
    // The best piece counts in full, others a little: a section that matches in several places beats one lucky line.
    scores.set(p, Math.max(scores.get(p) ?? 0, h.score) + (scores.has(p) ? h.score * 0.15 : 0) + (i === 0 ? 0.01 : 0));
  }
  if (earlier) {
    for (const h of searchPieces(earlier.question, 20)) {
      const p = passageFor(h.id);
      scores.set(p, Math.max(scores.get(p) ?? 0, h.score * EARLIER_WEIGHT));
    }
  }
  const pinned = (earlier?.sections ?? []).flatMap((s) => (contractNode(s) ? [passageFor(s)] : [])).slice(0, 2);
  const ranked = [...new Set([...pinned, ...[...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)])];
  const passages: string[] = [];
  let used = 0;
  for (const id of ranked) {
    if (passages.some((p) => id.startsWith(`${p}.`))) continue;
    const size = fullText(id).length * (changedInside(id) ? 1.4 : 1);
    if (used + size > budgetChars && passages.length) continue;
    passages.push(id);
    used += size;
  }
  return { passages, hits };
}

/** A passage as the model sees it: each piece on its own line, its id and any notes in the square brackets and only the contract's words after them; the 2015 wording beside any that changed. */
export function renderPassage(id: string, bidMonth: string): string {
  const lines: string[] = [];
  const scheduled = (n: ContractNode) => {
    const a = n.changed ? applicabilityOf(n.id, bidMonth) : null;
    return a?.kind === "scheduled" ? a : null;
  };
  const when = (n: ContractNode) => {
    const a = scheduled(n);
    if (!a) return "";
    if (a.manual) return ` | in force since June 29, 2026, applied by hand until automated by ${a.startsLabel}`;
    return a.inForce ? ` | in force for this bid period, since ${a.startsLabel}` : ` | not in force yet for this bid period: starts by ${a.startsLabel}; the 2015 wording applies until then`;
  };
  // A 2015 line can hold a whole deleted paragraph, such as First Fly's old 75% limit under 25.M.6.b.iv. Saying it has
  // been replaced keeps the model from reading a deleted rule as the current one.
  const was = (n: ContractNode) => {
    const a = scheduled(n);
    if (!a) return "2015 wording";
    return a.manual || a.inForce ? "2015 wording | replaced: no longer the rule" : "2015 wording | still the rule for this bid period";
  };
  const walk = (n: ContractNode) => {
    const now = n.text;
    if (now) lines.push(`[${n.id}${when(n)}] ${now}`);
    // Every line of it, or a deleted paragraph further down reads as unmarked, and as the current rule.
    if (n.changed && versionText(n, "2015").trim() && versionText(n, "2015") !== now) {
      for (const line of versionText(n, "2015").split("\n")) if (line.trim()) lines.push(`[${n.id} | ${was(n)}] ${line}`);
    }
    for (const c of childrenOf(n.id)) walk(c);
  };
  const node = contractNode(id);
  if (!node) return "";
  walk(node);
  return `<passage section="${id}" heading="${sectionPath(id)}" page="${node.page}">\n${lines.join("\n")}\n</passage>`;
}
