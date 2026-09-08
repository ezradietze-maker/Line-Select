"use client";

import { AuthScreen } from "@/components/auth/AuthScreen";
import { useAppState } from "@/lib/app-state";

export default function AuthPage() {
  const { handleAuthenticated, handleContinueAsGuest } = useAppState();
  return <AuthScreen onAuthenticated={handleAuthenticated} onContinueAsGuest={handleContinueAsGuest} />;
}
