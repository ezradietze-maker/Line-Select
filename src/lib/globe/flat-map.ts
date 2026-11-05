import type { LatLon } from "@/lib/globe/routes";

/**
 * Drawing on a flat world map (plate carrée): x = longitude + 180, y = 90 − latitude, in a 360 × 180 frame. Great
 * circles become curves broken at the date line; the night side is cut by the real terminator for any instant.
 */

export const MAP_W = 360;
export const MAP_H = 180;

export function project(p: LatLon): [number, number] {
  return [p.lon + 180, 90 - p.lat];
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Points along the great circle from a to b, `n` steps — the shortest way round, as a pilot flies it. */
export function greatCircle(a: LatLon, b: LatLon, n = 64): LatLon[] {
  const toXyz = (p: LatLon) => [Math.cos(rad(p.lat)) * Math.cos(rad(p.lon)), Math.cos(rad(p.lat)) * Math.sin(rad(p.lon)), Math.sin(rad(p.lat))];
  const [A, B] = [toXyz(a), toXyz(b)];
  const omega = Math.acos(Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  if (omega < 1e-9) return [a, b];
  const out: LatLon[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const k1 = Math.sin((1 - t) * omega) / Math.sin(omega);
    const k2 = Math.sin(t * omega) / Math.sin(omega);
    const [x, y, z] = [0, 1, 2].map((j) => k1 * A[j] + k2 * B[j]);
    out.push({ lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) });
  }
  return out;
}

/** An SVG path for a run of points, lifting the pen where it crosses the date line. */
export function pathThrough(points: LatLon[]): string {
  let d = "";
  points.forEach((p, i) => {
    const [x, y] = project(p);
    const jump = i > 0 && Math.abs(p.lon - points[i - 1].lon) > 180;
    d += `${i === 0 || jump ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)} `;
  });
  return d.trim();
}

/** Where the sun is overhead at an instant: its declination and the longitude below it. */
export function subsolarPoint(at: number): LatLon {
  const d = new Date(at);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = (at - start) / 86_400_000;
  const g = ((2 * Math.PI) / 365) * dayOfYear;
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  let lon = -(minutes + eqTime - 720) / 4;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat: deg(decl), lon };
}

/** Whether the sun is up at a place at an instant. */
export function isDaylight(p: LatLon, at: number): boolean {
  const s = subsolarPoint(at);
  const cosZenith = Math.sin(rad(p.lat)) * Math.sin(rad(s.lat)) + Math.cos(rad(p.lat)) * Math.cos(rad(s.lat)) * Math.cos(rad(p.lon - s.lon));
  return cosZenith > -0.0145; // the sun's upper edge on the horizon, with refraction (−0.833°)
}

/** The night side of the map at an instant, as one SVG path: under the terminator, out to the dark pole. */
export function nightPath(at: number): string {
  const s = subsolarPoint(at);
  const tanDecl = Math.tan(rad(s.lat)) || 1e-6;
  const pts: string[] = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    const lat = deg(Math.atan(-Math.cos(rad(lon - s.lon)) / tanDecl));
    const [x, y] = project({ lat, lon });
    pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  // The pole in the dark: south when the sun's north of the equator, north when it's south.
  const poleY = s.lat > 0 ? MAP_H : 0;
  return `M0 ${poleY} L${pts.join(" L")} L${MAP_W} ${poleY} Z`;
}
