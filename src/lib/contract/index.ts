import data from "./cba-2026.json";
import type { ChartRow, ContractDoc, ContractNode, ContractVersion } from "./types";

/**
 * The 2026 FedEx–ALPA agreement, as numbered pieces (built by scripts/contract/build-index.ts from the agreement's PDF).
 * Server code only: it's over a megabyte of text. The public document holds the sections the 2026 deal changed; the
 * sections it left alone (seniority, grievances and so on) aren't in it.
 */
export const NODES = data.nodes as ContractNode[];
export const DOCS = data.docs as ContractDoc[];
export const CHART = data.chart as ChartRow[];

const byId = new Map(NODES.map((n) => [n.id, n]));
const childrenById = new Map<string, ContractNode[]>();
for (const n of NODES) {
  if (!n.parent) continue;
  const list = childrenById.get(n.parent);
  if (list) list.push(n);
  else childrenById.set(n.parent, [n]);
}

export const contractNode = (id: string): ContractNode | undefined => byId.get(id);
export const childrenOf = (id: string): ContractNode[] => childrenById.get(id) ?? [];

/**
 * The piece a written section number means, however it's punctuated: "Section 25.E.6.", "12.C.2.d.i(c)", "12.C.2.d.i.c".
 * Undefined when there's no such piece — which is what makes an invented number fail.
 */
export function findNode(raw: string): ContractNode | undefined {
  const id = raw
    .trim()
    .replace(/^(?:CBA\s+\d{4}\s+)?(?:Section\s+)?/i, "")
    .replace(/\.+$/, "")
    .replace(/([^.])\(/g, "$1.(");
  const direct = byId.get(id);
  if (direct) return direct;
  // A last step written without its brackets, or brackets the piece doesn't have.
  const steps = id.split(".");
  const last = steps[steps.length - 1];
  const bracketed = /^[a-z0-9]+$/.test(last) ? [...steps.slice(0, -1), `(${last})`].join(".") : null;
  if (bracketed && byId.has(bracketed)) return byId.get(bracketed);
  const bare = /^\(.*\)$/.test(last) ? [...steps.slice(0, -1), last.slice(1, -1)].join(".") : null;
  return bare ? byId.get(bare) : undefined;
}

export function versionText(node: ContractNode, version: ContractVersion): string {
  return version === "2015" && node.changed ? (node.old ?? "") : node.text;
}

/** A piece's words with everything under it, each with its marker, as it reads in the contract. */
export function fullText(id: string, version: ContractVersion = "2026"): string {
  const node = byId.get(id);
  if (!node) return "";
  const own = versionText(node, version);
  const under = childrenOf(id).map((c) => `${c.marker} ${fullText(c.id, version)}`.trim());
  return [own, ...under].filter(Boolean).join(" ");
}

/** Whether a piece, or anything under it, reads differently from 2015. */
export function changedInside(id: string): boolean {
  const node = byId.get(id);
  return !!node && (node.changed || childrenOf(id).some((c) => changedInside(c.id)));
}

export function ancestorsOf(id: string): ContractNode[] {
  const chain: ContractNode[] = [];
  for (let n = byId.get(id); n?.parent; ) {
    n = byId.get(n.parent);
    if (n) chain.unshift(n);
  }
  return chain;
}

/** "Bid Period Processing › Secondary Working Window (SWW)", from the headings above and at a piece. */
export function sectionPath(id: string): string {
  const node = byId.get(id);
  if (!node) return "";
  const titles = [...ancestorsOf(id), node].filter((n) => n.parent).flatMap((n) => (n.title ? [n.title] : []));
  return titles.join(" › ") || DOCS.find((d) => d.id === node.doc)?.title || "";
}

export const coveredParts = (): string[] => DOCS.map((d) => d.title);
