import { describe, expect, it } from "vitest";
import { sameDatesLastYear, skyOf, summarizeWeather, toCurrent } from "@/lib/weather-client";

describe("layover weather", () => {
  it("takes the bid month's dates a year earlier", () => {
    expect(sameDatesLastYear("2026-09-28", 28)).toEqual({ from: "2025-09-28", to: "2025-10-25" });
  });

  it("averages highs and lows and counts wet and snowy days", () => {
    const s = summarizeWeather([
      { date: "2025-10-01", highF: 70, lowF: 50, precipIn: 0, snowIn: 0 },
      { date: "2025-10-02", highF: 60, lowF: 41, precipIn: 0.3, snowIn: 0 },
      { date: "2025-10-03", highF: 35, lowF: 28, precipIn: 0.2, snowIn: 1.1 },
      { date: "2025-10-04", highF: null, lowF: null, precipIn: null, snowIn: null },
    ])!;
    expect(s).toMatchObject({ from: "2025-10-01", to: "2025-10-03", avgHighF: 55, avgLowF: 40, wetDays: 2, snowDays: 1, days: 3 });
    expect(summarizeWeather([])).toBeNull();
  });

  it("reads the sky from a WMO code and the conditions now from a reply", () => {
    expect([0, 2, 3, 45, 53, 63, 75, 81, 86, 95].map(skyOf)).toEqual(["clear", "partly", "cloudy", "fog", "drizzle", "rain", "snow", "rain", "snow", "storm"]);
    expect(toCurrent({ current: { temperature_2m: 63.6, weather_code: 61, is_day: 0 } })).toEqual({ tempF: 64, sky: "rain", isDay: false });
    expect(toCurrent({ current: { temperature_2m: null, weather_code: 0, is_day: 1 } })).toBeNull();
    expect(toCurrent({})).toBeNull();
  });
});
