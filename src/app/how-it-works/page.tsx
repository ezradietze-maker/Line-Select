import { HowItWorksContent } from "@/components/results/HowItWorks";
import { Heading } from "@/components/ui/Heading";

export default function HowItWorksPage() {
  return (
    <div className="mx-auto w-full max-w-2xl animate-fade-in">
      <Heading as="h1" className="text-2xl text-ink sm:text-3xl">
        How this works
      </Heading>
      <div className="mt-6">
        <HowItWorksContent />
      </div>
    </div>
  );
}
