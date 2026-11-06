import type { MetadataRoute } from "next";

/** Search engines may read the public pages; the app's private screens and its API are left out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/results", "/interview", "/preferences", "/logbook", "/inbox", "/trade-board", "/reset-password", "/confirm-preferences"] },
  };
}
