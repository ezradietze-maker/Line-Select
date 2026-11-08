import type { MetadataRoute } from "next";

/**
 * Search engines may read the public pages; the app's private screens and its API are left out. The calendar feed is
 * the exception: Google Calendar obeys robots.txt when it fetches a subscription, and refuses a blocked one. Its links
 * can't be guessed, and each response says noindex.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/api/calendar/"], disallow: ["/api/", "/results", "/interview", "/preferences", "/logbook", "/inbox", "/trade-board", "/reset-password", "/confirm-preferences"] },
  };
}
