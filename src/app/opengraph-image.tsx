import { ImageResponse } from "next/og";
import { iconMarkup } from "@/lib/icon-svg";

/**
 * The card a shared link shows in a group chat or on social — the mark, the
 * promise, and the independence notice, in the app's night-cockpit colors,
 * with a few great-circle routes drawn across it. Built once at build time.
 */
export const alt = "Line Select — find the FedEx bid line that actually fits how you want to fly";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#f4e9d8";
const MUTED = "#b9a88f";
const ACCENT = "#e3a04f";
const BG1 = "#211810";
const BG2 = "#120d08";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: `radial-gradient(circle at 80% 20%, ${BG1} 0%, ${BG2} 70%)`,
          color: INK,
          fontFamily: "sans-serif",
        }}
      >
        {/* Routes: arcs from a hub, like the landing page's globe. */}
        <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: "absolute", left: 0, top: 0 }}>
          <g fill="none" stroke={ACCENT} strokeLinecap="round">
            <path d="M 1010 520 Q 1040 260 1150 120" strokeOpacity="0.55" strokeWidth="3" />
            <path d="M 1010 520 Q 960 300 900 90" strokeOpacity="0.35" strokeWidth="3" />
            <path d="M 1010 520 Q 1120 420 1170 330" strokeOpacity="0.45" strokeWidth="3" />
            <path d="M 1010 520 Q 1100 560 1180 590" strokeOpacity="0.25" strokeWidth="3" />
          </g>
          <g fill={ACCENT}>
            <circle cx="1010" cy="520" r="9" />
            <circle cx="1150" cy="120" r="6" fillOpacity="0.8" />
            <circle cx="900" cy="90" r="6" fillOpacity="0.6" />
            <circle cx="1170" cy="330" r="6" fillOpacity="0.7" />
            <circle cx="1180" cy="590" r="6" fillOpacity="0.5" />
          </g>
        </svg>

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            {iconMarkup(76)}
            <div style={{ display: "flex", fontSize: 40, fontWeight: 700, letterSpacing: -0.5 }}>
              <span>Line&nbsp;</span>
              <span style={{ color: ACCENT }}>Select</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", maxWidth: 820 }}>
            <div style={{ display: "flex", flexDirection: "column", fontSize: 74, lineHeight: 1.04, letterSpacing: -1.5 }}>
              <span>Find the line that</span>
              <span>actually fits</span>
              <span style={{ color: ACCENT }}>how you want to fly.</span>
            </div>
            <div style={{ display: "flex", marginTop: 26, fontSize: 28, lineHeight: 1.35, color: MUTED, maxWidth: 760 }}>
              Upload your FedEx bid pack, say what matters, and every line is scored against you — with the reason why.
            </div>
          </div>

          <div style={{ display: "flex", fontSize: 20, letterSpacing: 3, textTransform: "uppercase", color: MUTED }}>
            Independent prototype · Not affiliated with FedEx
          </div>
        </div>
      </div>
    ),
    size
  );
}
