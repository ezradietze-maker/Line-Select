import { NextResponse } from "next/server";

/**
 * Refuses a request another website's page sent. Signing in or up needs no cookie, so SameSite cookies don't stop it:
 * a form on any site can post the attacker's email and password to the sign-in route (a text/plain body that happens
 * to parse as JSON), the browser keeps the session cookie it gets back, and the pilot then uploads their pack and
 * answers the interview inside the attacker's account. Browsers say where a request came from — `Sec-Fetch-Site`, or
 * failing that `Origin` — and anything from elsewhere is turned away. A request with neither isn't from a browser page.
 */
export function crossSiteRefusal(request: Request): NextResponse | null {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none" ? null : refuse();
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    return new URL(origin).host === new URL(request.url).host ? null : refuse();
  } catch {
    return refuse();
  }
}

function refuse(): NextResponse {
  return NextResponse.json({ error: "That request came from another site." }, { status: 403 });
}
