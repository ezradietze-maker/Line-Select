import type { Metadata } from "next";

// The page itself is a client component, which can't name its own tab; this does (see the root layout's template).
export const metadata: Metadata = {
  title: "What's new",
  description: "What's changed in Line Select lately, newest first.",
  alternates: { canonical: "/whats-new" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
