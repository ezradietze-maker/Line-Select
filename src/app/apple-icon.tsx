import { ImageResponse } from "next/og";
import { iconMarkup } from "@/lib/icon-svg";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(iconMarkup(180), size);
}
