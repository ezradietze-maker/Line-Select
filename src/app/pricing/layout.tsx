import type { Metadata } from "next";

// The page itself is a client component, which can't name its own tab; this does (see the root layout's template).
export const metadata: Metadata = {
  title: "Pricing",
  description: "Line Select membership: one of 15 free spots, or Pro at $20/month with your first month free. Every line ranked, the bid forecast, Strategies, the Trade Board and more.",
  alternates: { canonical: "/pricing" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
