import type { Metadata } from "next";

// The page itself is a client component, which can't name its own tab; this does (see the root layout's template).
export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Line Select does with your bid pack, your interview and your account: what stays on your device, what reaches its server, and which providers see what.",
  alternates: { canonical: "/privacy" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
