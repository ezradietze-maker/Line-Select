import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, SITE_URL } from "@/lib/site-pages";

/** The pages anyone can read, for search engines: the landing page and the ones that read the same to everyone. */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", ...PUBLIC_PAGES].map((path) => ({ url: path === "/" ? SITE_URL : `${SITE_URL}${path}` }));
}
