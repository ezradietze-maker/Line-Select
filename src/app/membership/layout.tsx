import type { Metadata } from "next";

// The page is a client component and can't name its own tab; this does (see the root layout's template).
export const metadata: Metadata = { title: "Membership" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
