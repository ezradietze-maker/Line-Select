import type { ReactNode } from "react";
import { Heading } from "@/components/ui/Heading";

interface PageHeaderProps {
  /** A mono context line above the title — usually the loaded pack ("MEM · B767 · FO · OCT26"). */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons on the right (below the title on a phone). */
  actions?: ReactNode;
  /** Anything that belongs to the header itself — badges, a readout strip. */
  children?: ReactNode;
  className?: string;
}

/**
 * Every screen's opening: what it is, where you are, what you can do —
 * in one consistent order, so moving between screens never means
 * re-learning where the title and the main action live.
 */
export function PageHeader({ eyebrow, title, description, actions, children, className = "" }: PageHeaderProps) {
  return (
    <header className={className}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-accent">{eyebrow}</div>}
          <Heading as="h1" className={`text-3xl tracking-tight text-ink sm:text-4xl ${eyebrow ? "mt-1.5" : ""}`}>
            {title}
          </Heading>
          {description && <div className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** "MEM · B767 · FO · OCT26" — the pack a screen is about, when one is loaded. */
export function packEyebrow(pack: { base: string; aircraft: string; seat: string; month: string } | null | undefined): string | undefined {
  return pack ? `${pack.base} · ${pack.aircraft} · ${pack.seat} · ${pack.month}` : undefined;
}
