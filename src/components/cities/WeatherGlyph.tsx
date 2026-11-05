import type { Sky } from "@/lib/weather-client";

const CLOUD = "M5.6 15h9.2a3.1 3.1 0 0 0 .2-6.2A4.6 4.6 0 0 0 6.2 9.6 2.7 2.7 0 0 0 5.6 15Z";

function Sun({ x = 10, y = 10, r = 3.6 }: { x?: number; y?: number; r?: number }) {
  return (
    <g>
      <g className="wx-rays">
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          return (
            <line
              key={i}
              x1={x + Math.cos(a) * (r + 1.6)}
              y1={y + Math.sin(a) * (r + 1.6)}
              x2={x + Math.cos(a) * (r + 3.2)}
              y2={y + Math.sin(a) * (r + 3.2)}
              stroke="var(--color-accent)"
              strokeWidth={1.3}
              strokeLinecap="round"
            />
          );
        })}
      </g>
      <circle cx={x} cy={y} r={r} fill="var(--color-accent)" />
    </g>
  );
}

function Moon({ x = 10, y = 10, s = 1 }: { x?: number; y?: number; s?: number }) {
  return <path transform={`translate(${x} ${y}) scale(${s})`} d="M1.6-5.4a5.6 5.6 0 1 0 3.9 8.4A4.6 4.6 0 0 1 1.6-5.4Z" fill="var(--color-ink-muted)" />;
}

function Cloud({ drift = true }: { drift?: boolean }) {
  return <path className={drift ? "wx-cloud" : ""} d={CLOUD} fill="var(--color-surface-raised)" stroke="var(--color-ink-muted)" strokeWidth={1.2} strokeLinejoin="round" />;
}

/**
 * The sky at a city right now, small and moving: the sun's rays turning (or the moon, after dark), a cloud drifting,
 * rain and snow falling out of it, a flash of lightning, fog sliding by. Still under reduced motion.
 */
export function WeatherGlyph({ sky, isDay, className = "h-5 w-5" }: { sky: Sky; isDay: boolean; className?: string }) {
  const fall = (kind: "rain" | "snow", count: number) =>
    Array.from({ length: count }, (_, i) => {
      const x = 7 + i * (count === 2 ? 5 : 3);
      return kind === "rain" ? (
        <line key={i} className="wx-fall" style={{ animationDelay: `${i * 0.35}s` }} x1={x} y1={15.8} x2={x - 0.8} y2={18} stroke="var(--color-ink-muted)" strokeWidth={1.2} strokeLinecap="round" />
      ) : (
        <circle key={i} className="wx-fall-slow" style={{ animationDelay: `${i * 0.8}s` }} cx={x} cy={16.6} r={0.9} fill="var(--color-ink-muted)" />
      );
    });
  return (
    <svg viewBox="0 0 20 20" className={`shrink-0 overflow-visible ${className}`} aria-hidden>
      {sky === "clear" && (isDay ? <Sun /> : <Moon />)}
      {sky === "partly" && (
        <>
          {isDay ? <Sun x={7} y={7} r={2.8} /> : <Moon x={7.5} y={7} s={0.75} />}
          <Cloud />
        </>
      )}
      {sky === "cloudy" && (
        <>
          <path d="M8.5 9.5a4 4 0 0 1 7.4-1.2 2.6 2.6 0 0 1 .9 5" fill="none" stroke="var(--color-ink-faint)" strokeWidth={1.1} strokeLinecap="round" />
          <Cloud />
        </>
      )}
      {sky === "fog" &&
        [7, 10.5, 14].map((y, i) => (
          <line key={y} className="wx-fog" style={{ animationDelay: `${i * 0.6}s` }} x1={3 + (i % 2) * 2} y1={y} x2={17 - (i % 2) * 2} y2={y} stroke="var(--color-ink-muted)" strokeWidth={1.4} strokeLinecap="round" />
        ))}
      {(sky === "drizzle" || sky === "rain") && (
        <>
          <Cloud drift={false} />
          {fall("rain", sky === "rain" ? 3 : 2)}
        </>
      )}
      {sky === "snow" && (
        <>
          <Cloud drift={false} />
          {fall("snow", 3)}
        </>
      )}
      {sky === "storm" && (
        <>
          <Cloud drift={false} />
          <path className="wx-flash" d="M10.6 14.6 8.8 17.4h2l-1.2 2.4" fill="none" stroke="var(--color-accent)" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}
