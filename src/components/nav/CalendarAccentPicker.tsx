"use client";

import { useEffect, useState } from "react";
import {
  CALENDAR_ACCENT_PRESETS,
  applyCalendarAccent,
  getStoredCalendarAccent,
  setStoredCalendarAccent,
} from "@/lib/calendar-theme";

/** A small swatch row for personalizing the calendar views' "Flying" accent color — additive on top of the existing design system, never touching the rest of the app's palette. */
export function CalendarAccentPicker() {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const stored = getStoredCalendarAccent();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(stored);
    applyCalendarAccent(stored);
  }, []);

  function choose(value: string | null) {
    setSelected(value);
    setStoredCalendarAccent(value);
  }

  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Calendar accent color">
      {CALENDAR_ACCENT_PRESETS.map((preset) => (
        <button
          key={preset.label}
          type="button"
          role="radio"
          aria-checked={selected === preset.value}
          title={preset.label}
          onClick={() => choose(preset.value)}
          className={`h-5 w-5 shrink-0 rounded-full border-2 transition-transform hover:scale-110 ${
            selected === preset.value ? "border-ink" : "border-transparent"
          }`}
          style={{ backgroundColor: preset.value ?? "var(--color-brand)" }}
        >
          <span className="sr-only">{preset.label}</span>
        </button>
      ))}
    </div>
  );
}
