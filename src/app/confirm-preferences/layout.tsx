import type { Metadata } from "next";

// The page itself is a client component, which can't name its own tab; this does (see the root layout's template).
export const metadata: Metadata = { title: "Confirm Preferences" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
