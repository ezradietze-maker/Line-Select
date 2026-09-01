import { ImageResponse } from "next/og";
import { iconMarkup } from "@/lib/icon-svg";

export async function GET() {
  return new ImageResponse(iconMarkup(192), { width: 192, height: 192 });
}
