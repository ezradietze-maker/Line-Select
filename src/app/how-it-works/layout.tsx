import type { Metadata } from "next";

// The page itself is a client component, which can't name its own tab; this does (see the root layout's template).
export const metadata: Metadata = {
  title: "How This Works",
  description: "How Line Select scores every line in your bid pack from your own bidding story, what the score is and isn't, and where your bid pack goes.",
  alternates: { canonical: "/how-it-works" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
