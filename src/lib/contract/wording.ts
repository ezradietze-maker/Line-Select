import type { Applicability, ContractVersion } from "./types";

/**
 * When a quoted rule applies, in a sentence. "By" because the Implementation LOA's dates are the latest the Company can
 * implement a change, not the only day it can: CBA 2026 Implementation LOA, Appendix A.
 */
export function appliesLine(applies: Applicability, version: ContractVersion): string {
  switch (applies.kind) {
    case "unchanged":
      return "Same wording as the 2015 contract.";
    // The Implementation LOA gives the Agreement "a general effective date of June 29, 2026"; Appendix A only sets later
    // dates for the changes it lists. A change it doesn't list takes the general date.
    case "unlisted":
      return version === "2015"
        ? "The 2015 wording. It was replaced on June 29, 2026, the Agreement's general effective date: the implementation chart doesn't give this change a later date."
        : "In force since June 29, 2026, the Agreement's general effective date: the implementation chart doesn't give this change a later date.";
    case "mixed":
      return `Parts of this change at different times: ${applies.phases.map((p) => `Phase ${p.phase}, ${p.startsLabel} (${p.refs.slice(0, 4).join(", ")}${p.refs.length > 4 ? "…" : ""})`).join("; ")}.`;
    case "scheduled": {
      const note = applies.note ? ` Chart note: ${applies.note}.` : "";
      const phase = `Phase ${applies.phase}`;
      if (version === "2015") {
        if (applies.manual) return `The 2015 wording. The change has been in force since June 29, 2026, applied by hand until it's automated, by ${applies.startsLabel} (${phase}).${note}`;
        return applies.inForce ? `The 2015 wording. It was replaced under ${phase}, by ${applies.startsLabel}.${note}` : `The 2015 wording, which applies until the change starts, by ${applies.startsLabel} (${phase}).${note}`;
      }
      if (applies.manual) return `In force since June 29, 2026, applied by hand until it's automated, by ${applies.startsLabel} (${phase}).${note}`;
      if (applies.phase === 1) return `In force since June 29, 2026 (${phase}).${note}`;
      return applies.inForce ? `In force for this bid period: it started by ${applies.startsLabel} (${phase}).${note}` : `Not yet: starts by ${applies.startsLabel} (${phase}). Until then the 2015 wording applies.${note}`;
    }
  }
}

/** The same, in a few words, for the line that shows the box working it out. */
export function appliesShort(applies: Applicability): string {
  switch (applies.kind) {
    case "unchanged":
      return "same wording as 2015";
    case "unlisted":
      return "in force since June 29, 2026, the general effective date";
    case "mixed":
      return "parts change at different times";
    case "scheduled":
      if (applies.manual) return "in force, applied by hand for now";
      if (applies.phase === 1) return "in force since June 29, 2026";
      return applies.inForce ? "in force for this bid period" : `starts by ${applies.startsLabel}`;
  }
}
