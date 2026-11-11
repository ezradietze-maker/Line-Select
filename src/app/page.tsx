import type { Metadata } from "next";
import { LandingPage } from "@/components/welcome/LandingPage";

// The page's own canonical address. Set here, not in the root layout: there, every screen would inherit it and name
// the landing page as its own address.
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function RootPage() {
  return <LandingPage />;
}
