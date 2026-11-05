/**
 * Sunrise and sunset anywhere, any day — the NOAA solar calculator's equations (low-precision version), good to a
 * minute or two away from the poles. No network: a layover city's daylight comes from its coordinates alone.
 */

const RAD = Math.PI / 180;

/** Sunrise and sunset (ms, UTC) on the given UTC calendar date at a place; null for polar day or night. */
export function sunTimes(dateUtc: Date, lat: number, lon: number): { sunrise: number; sunset: number } | null {
  const y = dateUtc.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const dayOfYear = Math.floor((Date.UTC(y, dateUtc.getUTCMonth(), dateUtc.getUTCDate()) - start) / 86_400_000) + 1;
  // Fractional year, in radians, at noon.
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  // The sun's center 0.833° below the horizon: refraction and the disc's radius.
  const cosHa = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
  if (cosHa < -1 || cosHa > 1) return null;
  const ha = Math.acos(cosHa) / RAD;
  const midnight = Date.UTC(y, dateUtc.getUTCMonth(), dateUtc.getUTCDate());
  const minutes = (m: number) => midnight + m * 60_000;
  return { sunrise: minutes(720 - 4 * (lon + ha) - eqTime), sunset: minutes(720 - 4 * (lon - ha) - eqTime) };
}

/** Hours of daylight from a sunrise and sunset. */
export function daylightHours(t: { sunrise: number; sunset: number }): number {
  return (t.sunset - t.sunrise) / 3_600_000;
}
