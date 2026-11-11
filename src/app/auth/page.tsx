"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthScreen, authModeFor } from "@/components/auth/AuthScreen";
import { useAppState } from "@/lib/app-state";

export default function AuthPage() {
  // Reading the address needs a boundary of its own; the shell shows the mark here until saved state loads anyway.
  return (
    <Suspense fallback={null}>
      <AuthPageView />
    </Suspense>
  );
}

function AuthPageView() {
  const { handleAuthenticated, handleContinueAsGuest } = useAppState();
  // "?view=forgot" (from the reset page's link) opens on that view rather than signing in.
  const view = useSearchParams().get("view");
  return <AuthScreen onAuthenticated={handleAuthenticated} onContinueAsGuest={handleContinueAsGuest} initialMode={authModeFor(view)} />;
}
