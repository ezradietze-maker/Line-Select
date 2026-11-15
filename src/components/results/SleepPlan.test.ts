import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RestPlan } from "@/components/results/SleepPlan";
import type { LayoverSleepPlan } from "@/lib/sleep-plan";

const plan: LayoverSleepPlan = {
  dutyIndex: 0,
  city: "ANC",
  inHotel: 600,
  wakeBy: 1500,
  localOffset: -480,
  bodyOffset: -300,
  awakeHours: 14,
  blocks: [{ kind: "sleep", start: 700, end: 1180, title: "Sleep", why: "Your body's night.", ease: 0.8, startLocal: "22:30", endLocal: "06:30" }],
  totalSleepHours: 8,
  quality: "good",
  summary: "Sleep 22:30–06:30",
  bodyClockNote: "Your body clock is 3 h ahead of local time.",
  inHotelLocal: "20:50",
  wakeByLocal: "11:50",
  ribbon: [],
  ticks: [],
};

describe("the rest plan", () => {
  it("marks its times as the layover city's own, so under the Zulu toggle they aren't read as Zulu", () => {
    const text = renderToStaticMarkup(createElement(RestPlan, { plans: [plan] })).replace(/<[^>]+>/g, "");
    expect(text).toContain("In the hotel 20:50L");
    expect(text).toContain("Up by 11:50L");
    expect(text).toContain("22:30–06:30L Sleep");
  });
});
