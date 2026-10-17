import type { CityMark } from "@/types/preferences";

/**
 * How the pilot feels about a layover city, in one glyph beside its code: a filled heart for a city they love, an open
 * one for a city they like, an amber cross for one they dislike and a red one for a city they avoid.
 */
export function CityMarkGlyph({ mark }: { mark: CityMark | null | undefined }) {
  switch (mark) {
    case "love":
      return <span className="text-good" aria-label="a city you love">♥</span>;
    case "like":
      return <span className="text-good" aria-label="a city you like">♡</span>;
    case "dislike":
      return <span className="text-warn" aria-label="a city you dislike">✕</span>;
    case "avoid":
      return <span className="font-semibold text-danger" aria-label="a city you avoid">✕</span>;
    default:
      return null;
  }
}
