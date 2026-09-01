import { ImageResponse } from "next/og";
import { iconMarkup } from "@/lib/icon-svg";

export async function GET() {
  return new ImageResponse(iconMarkup(512), { width: 512, height: 512 });
}
