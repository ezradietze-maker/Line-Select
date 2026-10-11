import type { Judgment } from "./judge";

export const TIER_VALUE = { A: 5, B: 4, C: 3, D: 2, E: 1 } as const;

/** Spearman rank correlation between a system's order and the judge's tiers (ties share average ranks). */
export function spearman(order: string[], tiers: Judgment["tiers"]): number {
  const lines = order.filter((l) => tiers[l]);
  const n = lines.length;
  const sysRank = new Map(lines.map((l, i) => [l, i + 1]));
  const byTier = [...lines].sort((a, b) => TIER_VALUE[tiers[b]] - TIER_VALUE[tiers[a]]);
  const judgeRank = new Map<string, number>();
  let i = 0;
  while (i < byTier.length) {
    let j = i;
    while (j < byTier.length && tiers[byTier[j]] === tiers[byTier[i]]) j++;
    const avg = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) judgeRank.set(byTier[k], avg);
    i = j;
  }
  const d2 = lines.reduce((s, l) => s + (sysRank.get(l)! - judgeRank.get(l)!) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

export interface Scorecard {
  name: string;
  spearman: number;
  top10InAorB: number;
  poorOrWorseInTop15: number;
  top10Overlap: number;
}

export function scorecard(name: string, order: string[], j: Judgment): Scorecard {
  const top10 = order.slice(0, 10);
  const good = top10.filter((l) => j.tiers[l] === "A" || j.tiers[l] === "B").length;
  const disasters = order.slice(0, 15).filter((l) => j.tiers[l] === "E" || j.tiers[l] === "D").length;
  const judgeTop = new Set(j.top.slice(0, 10).map((t) => t.line));
  const overlap = top10.filter((l) => judgeTop.has(l)).length;
  return { name, spearman: +spearman(order, j.tiers).toFixed(3), top10InAorB: good, poorOrWorseInTop15: disasters, top10Overlap: overlap };
}

const LABEL_RANK = { top: 3, fine: 2, never: 1 } as const;

/**
 * Agreement with a real pilot's own verdicts: of every pair of lines they put in different groups (top / fine /
 * never), the share the ranking orders the same way.
 */
export function pilotAgreement(order: string[], labels: Record<string, keyof typeof LABEL_RANK>): { pairs: number; agree: number; share: number } {
  const lines = Object.keys(labels).filter((l) => order.includes(l));
  let pairs = 0;
  let agree = 0;
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i];
      const b = lines[j];
      const d = LABEL_RANK[labels[a]] - LABEL_RANK[labels[b]];
      if (d === 0) continue;
      pairs++;
      if (Math.sign(order.indexOf(b) - order.indexOf(a)) === Math.sign(d)) agree++;
    }
  return { pairs, agree, share: pairs ? +(agree / pairs).toFixed(3) : NaN };
}
