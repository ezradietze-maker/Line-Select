import { ancestorsOf, childrenOf, contractNode, findNode, sectionPath } from "./index";
import { applicabilityOf } from "./phases";
import type { ContractNode, SectionView } from "./types";

/** One section for the viewer: the piece with everything under it, in contract order. */
export function sectionView(rawId: string, bidMonth: string): SectionView | null {
  const node = findNode(rawId);
  if (!node) return null;
  const pieces: SectionView["pieces"] = [];
  const base = ancestorsOf(node.id).length;
  const withoutTitle = (n: ContractNode, text: string) => (n.title && text.startsWith(n.title) ? text.slice(n.title.length).trim() : text);
  const walk = (n: ContractNode) => {
    pieces.push({
      id: n.id,
      marker: n.marker,
      depth: ancestorsOf(n.id).length - base,
      ...(n.title ? { title: n.title } : {}),
      text: withoutTitle(n, n.text),
      ...(n.changed && n.old ? { old: withoutTitle(n, n.old) } : {}),
    });
    for (const c of childrenOf(n.id)) walk(c);
  };
  walk(node);
  return { section: node.id, path: sectionPath(node.id), page: node.page, pageEnd: pieces.reduce((a, p) => Math.max(a, contractNode(p.id)?.pageEnd ?? a), node.pageEnd), applies: applicabilityOf(node.id, bidMonth), pieces };
}
