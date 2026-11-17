"use client";

import { useRouter } from "next/navigation";
import { PayCheckScreen } from "@/components/pay/PayCheckScreen";
import { MembershipLocked } from "@/components/membership/MembershipLocked";
import { useAppState } from "@/lib/app-state";
import { hasAccess } from "@/lib/membership";

export default function PayPage() {
  const router = useRouter();
  const { bidPack, handleTrySample, user } = useAppState();
  // No membership: the tool is held back once a pack is in, as Results is. A no-op while `FREE_FOR_ALL` is on.
  if (bidPack && !hasAccess(user)) return <MembershipLocked tool="the Pay check" />;
  return <PayCheckScreen bidPack={bidPack} onGoToUpload={() => router.push("/upload")} onTrySample={handleTrySample} />;
}
