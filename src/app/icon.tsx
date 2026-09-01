import { ImageResponse } from "next/og";
import { iconMarkup } from "@/lib/icon-svg";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(iconMarkup(32), size);
}
