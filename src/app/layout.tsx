import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Overpass, Overpass_Mono } from "next/font/google";
import { AppShell } from "@/components/app/AppShell";
import { CrashReporting } from "@/components/CrashReporting";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { SITE_URL } from "@/lib/site-pages";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Body copy — Atkinson Hyperlegible Next, drawn by the Braille Institute for low-vision reading: letters that could
// be mistaken for one another (I l 1, O 0) are shaped apart. It repoints the existing --font-sans variable, so every
// call site that already reads it (the `body` rule in globals.css, any bare `font-sans` utility) gets this face with
// zero changes elsewhere. All three faces are variable, so one file covers every weight.
const atkinson = Atkinson_Hyperlegible_Next({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Headers only — opt-in via the `font-display` utility (see Heading.tsx), never the implicit body default, so
// headings read distinctly from prose. Overpass is drawn from Highway Gothic, the lettering of US road and airfield
// signs.
const overpass = Overpass({
  variable: "--font-display",
  subsets: ["latin"],
});

// Times, numbers and the pack's own tokens only — never labels or headings.
const overpassMono = Overpass_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // What each page's canonical link and the share card's image are built on: the site's real address, never a
  // deployment's own vercel.app one.
  metadataBase: new URL(SITE_URL),
  // Each screen names its own tab ("My Rankings · Line Select") — see the small layout.tsx beside each page.
  title: { default: "Line Select — Bid Line Matching for FedEx Pilots", template: "%s · Line Select" },
  description:
    "An independent prototype that ranks FedEx pilot bid lines against your stated preferences. Not affiliated with or endorsed by FedEx.",
  // A shared link shows the big card from app/opengraph-image.tsx.
  openGraph: { siteName: "Line Select", type: "website" },
  twitter: { card: "summary_large_image" },
};

// The phone's browser bar matches the page behind it — the sidebar's color in
// each scheme — the navy night sky over either page.
export const viewport: Viewport = {
  // Lets the phone tab bar sit flush to the bottom edge and pad itself clear of the home indicator (env(safe-area-inset-bottom)).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0a1120" },
    { media: "(prefers-color-scheme: dark)", color: "#060b16" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${atkinson.variable} ${overpass.variable} ${overpassMono.variable} h-full antialiased`}
    >
      <head>
        {/* Applies a saved theme override before first paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        <ServiceWorkerRegistration />
        <CrashReporting />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
