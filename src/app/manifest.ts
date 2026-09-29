import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Line Select — Bid Line Matching for FedEx Pilots",
    short_name: "Line Select",
    description:
      "Ranks FedEx pilot bid lines against your stated preferences. Independent prototype, not affiliated with FedEx.",
    start_url: "/",
    display: "standalone",
    background_color: "#1c150d",
    theme_color: "#4a3420",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
