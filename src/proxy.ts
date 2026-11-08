import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE, deviceCookieValue, deviceIdOf } from "@/lib/device-cookie";

/**
 * Gives each browser a random device id on its first page visit, so limits on the open routes count per device
 * (`checkRequestLimit`) and pilots sharing a crew room's or hotel's Wi-Fi don't share one budget. It identifies a
 * browser, not a person, and carries nothing else. Pages only; API calls and build files pass straight through.
 */
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  // Missing, or not one this server signed (made up, or from before ids were signed): a fresh one.
  if (!deviceIdOf(request.cookies.get(DEVICE_COOKIE)?.value)) {
    response.cookies.set(DEVICE_COOKIE, deviceCookieValue(crypto.randomUUID()), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 400 * 24 * 60 * 60,
    });
  }
  return response;
}

export const config = {
  // Every page request; not API routes, build output, images or the files at the root (icons, the worker, robots).
  matcher: ["/((?!api|_next/static|_next/image|.*\\.[a-z0-9]+$).*)"],
};
