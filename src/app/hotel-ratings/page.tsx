"use client";

import { HotelRatingsScreen } from "@/components/hotels/HotelRatingsScreen";
import { useAppState } from "@/lib/app-state";

export default function HotelRatingsPage() {
  const { bidPack, profile } = useAppState();
  return <HotelRatingsScreen bidPack={bidPack} profile={profile} />;
}
