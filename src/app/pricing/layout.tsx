import type { Metadata } from "next";

// The page itself is a client component, which can't name its own tab; this does (see the root layout's template).
export const metadata: Metadata = {
  title: "Pricing",
  description: "Line Select is free today: every line in your bid pack ranked for you, the bid forecast, Strategies, the Trade Board and calendar export.",
  alternates: { canonical: "/pricing" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
