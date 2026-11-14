"use client";

import { useState, type ClipboardEvent } from "react";

/** Said under a box when what was pasted into it ran past the most it takes. */
export const PASTE_CUT_NOTICE = "That’s as long as this box takes, so the end of what you pasted was cut off.";

/**
 * Whether pasting `pasted` over the selected part of a box's `value` runs past `max`. Line breaks counted as the box
 * keeps them: one character each, however the copied text wrote them.
 */
export function pasteRunsOver(value: string, selected: number, pasted: string, max: number | undefined): boolean {
  return max !== undefined && value.length - selected + pasted.replace(/\r\n?/g, "\n").length > max;
}

/**
 * A box with a limit keeps only what fits of a paste. The rest went without a word: "0 characters left", in small
 * type, was all a pilot pasting a story written elsewhere saw of a page or more gone from its end. `cut` is true from
 * such a paste until the box is shortened below its limit.
 */
export function usePasteLimit(maxLength: number | undefined) {
  const [cut, setCut] = useState(false);
  return {
    cut,
    onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const box = e.currentTarget;
      if (pasteRunsOver(box.value, box.selectionEnd - box.selectionStart, e.clipboardData.getData("text"), maxLength)) setCut(true);
    },
    /** For every change to the box: shortened, the notice goes. */
    changed: (next: string) => {
      if (cut && maxLength !== undefined && next.length < maxLength) setCut(false);
    },
  };
}
