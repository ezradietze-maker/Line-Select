import Link from "next/link";
import { HowItWorksContent } from "@/components/results/HowItWorks";
import { PageHeader } from "@/components/ui/PageHeader";

export default function HowItWorksPage() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow="Line Select"
        title="How this works"
        description={
          <>
            What the score is, what it isn&rsquo;t, and where your bid pack goes. Rather watch how to use it?{" "}
            <Link href="/tutorial" className="font-medium text-accent underline decoration-dotted underline-offset-4">
              See the tutorial
            </Link>
            .
          </>
        }
      />
      <div className="panel-glass mt-8 p-5 sm:p-7">
        {/* Straight under the page title here; in the sidebar dialog they sit under its h2. */}
        <HowItWorksContent headingLevel="h2" />
      </div>
    </div>
  );
}
