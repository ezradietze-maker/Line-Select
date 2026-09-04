import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_Condensed, Public_Sans } from "next/font/google";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Body copy — repoints the existing --font-sans variable, so every call
// site that already reads it (the `body` rule in globals.css, any bare
// `font-sans` utility) gets this face with zero changes elsewhere.
const publicSans = Public_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Headers only — opt-in via the `font-display` utility (see Heading.tsx),
// never the implicit body default, so headings read distinctly from prose.
const plexCondensed = IBM_Plex_Sans_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Line Select — Bid Line Matching for FedEx Pilots",
  description:
    "An independent prototype that ranks FedEx pilot bid lines against your stated preferences. Not affiliated with or endorsed by FedEx.",
};

export const viewport: Viewport = {
  themeColor: "#1c3d5c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${publicSans.variable} ${plexCondensed.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        {/* Applies a saved theme override before first paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
