"use client";

import { Suspense } from "react";
import { CitiesScreen } from "@/components/cities/CitiesScreen";
import { useAppState } from "@/lib/app-state";

function Cities() {
  const { bidPack, profile } = useAppState();
  return <CitiesScreen bidPack={bidPack} profile={profile} />;
}

export default function CitiesPage() {
  // The open city lives in the address (?city=HNL), and useSearchParams needs a Suspense boundary.
  return (
    <Suspense>
      <Cities />
    </Suspense>
  );
}
