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
  const { ready, bidPack, user } = useAppState();
  const prefilled = useSearchParams().get("q") ?? "";
  // Not before it's known who's asking: a question asked while the account was still loading was wiped when it did,
  // its paid answer lost, and the chat saved under the guest's key.
  if (!ready) return null;
  return <ContractScreen key={`${user?.id ?? "guest"}|${prefilled}`} bidPack={bidPack} userId={user?.id ?? null} prefilled={prefilled} />;
}
