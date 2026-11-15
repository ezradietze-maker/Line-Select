import Link from "next/link";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

/** A refused action's own words (`accessRefusal` on the server: no membership), with the way to one under them. */
export function MembershipRefusal({ message, className = "" }: { message: string; className?: string }) {
  return (
    <ErrorBanner className={className}>
      <p>{message}</p>
      <Link href="/membership" className="mt-2 inline-block font-medium underline decoration-dotted underline-offset-4 hover:opacity-80">
        See membership options
      </Link>
    </ErrorBanner>
  );
}
