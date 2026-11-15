"use client";

import { useRouter } from "next/navigation";
import { PayCheckScreen } from "@/components/pay/PayCheckScreen";
import { useAppState } from "@/lib/app-state";

export default function PayPage() {
  const router = useRouter();
  const { bidPack, handleTrySample } = useAppState();
  return <PayCheckScreen bidPack={bidPack} onGoToUpload={() => router.push("/upload")} onTrySample={handleTrySample} />;
}
