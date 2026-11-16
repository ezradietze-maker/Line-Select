import type { Metadata } from "next";

// The page itself is a client component, which can't name its own tab; this does (see the root layout's template).
export const metadata: Metadata = {
  title: "Tutorial",
  description: "How to use Line Select, one feature at a time: a narrated video in short chapters.",
  alternates: { canonical: "/tutorial" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
