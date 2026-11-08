import { NextResponse } from "next/server";
import { currentBidMonth } from "@/lib/contract/phases";
import { sectionView } from "@/lib/contract/section-view";

export const runtime = "nodejs";

/** One section's words for the viewer. No model involved, and nothing here but the contract's own public text. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("bidMonth");
  const view = sectionView(url.searchParams.get("id") ?? "", month && /^20\d{2}-(0[1-9]|1[0-2])$/.test(month) ? month : currentBidMonth());
  if (!view) return NextResponse.json({ error: "There's no such section." }, { status: 404 });
  return NextResponse.json(view);
}
