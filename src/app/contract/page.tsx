"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ContractScreen } from "@/components/contract/ContractScreen";
import { useAppState } from "@/lib/app-state";

export default function ContractPage() {
  // useSearchParams needs a Suspense boundary or the whole route opts out of static rendering.
  return (
    <Suspense fallback={null}>
      <ContractPageContent />
    </Suspense>
  );
}

function ContractPageContent() {
  const { bidPack, user } = useAppState();
  const prefilled = useSearchParams().get("q") ?? "";
  return <ContractScreen key={prefilled} bidPack={bidPack} userId={user?.id ?? null} prefilled={prefilled} />;
}
