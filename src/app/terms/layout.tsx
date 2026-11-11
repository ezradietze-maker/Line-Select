import type { Metadata } from "next";

// The page itself is a client component, which can't name its own tab; this does (see the root layout's template).
export const metadata: Metadata = {
  title: "Terms",
  description: "Line Select's Terms of Service: an independent planning aid for FedEx pilots, not affiliated with FedEx, and not a source to bid from unchecked.",
  alternates: { canonical: "/terms" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
