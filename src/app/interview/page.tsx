"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BrainInterview } from "@/components/interview/BrainInterview";
import { useAppState } from "@/lib/app-state";

/** The story-driven interview (the pilot brain). The earlier topic-by-topic interview is retired. */
export default function InterviewPage() {
  const router = useRouter();
  const { bidPack, profile, user, interviewKey, handleBrainInterviewComplete } = useAppState();

  useEffect(() => {
    if (!bidPack) router.replace("/upload");
  }, [bidPack, router]);

  if (!bidPack) return null;

  return (
    <>
      {/* The page's name for a screen reader's heading list: each step shows its own question as the big heading. */}
      <h1 className="sr-only">Interview</h1>
      {/* One interview per pack: a pack that changes under it (the account's newer one, shown once a load that had only
          this device's copy hears from the server) starts that pack's own, rather than saving this one's answers as its draft. */}
      <BrainInterview key={`${interviewKey}:${bidPack.id}`} bidPack={bidPack} onComplete={handleBrainInterviewComplete} priorProfile={profile} userId={user?.id ?? null} />
    </>
  );
}
