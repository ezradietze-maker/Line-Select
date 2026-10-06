import { HowItWorksContent } from "@/components/results/HowItWorks";
import { PageHeader } from "@/components/ui/PageHeader";

export default function HowItWorksPage() {
  return (
    <div className="mx-auto w-full max-w-2xl animate-fade-in">
      <PageHeader
        eyebrow="Line Select"
        title="How this works"
        description="What the score is, what it isn’t, and where your bid pack goes."
      />
      <div className="panel-glass mt-8 p-5 sm:p-7">
        <HowItWorksContent />
      </div>
    </div>
  );
}
