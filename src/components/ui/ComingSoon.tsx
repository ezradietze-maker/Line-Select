interface ComingSoonProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
}

export function ComingSoon({ icon, title, description, children }: ComingSoonProps) {
  return (
    <div className="mx-auto w-full max-w-lg animate-fade-in text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        {icon}
      </div>
      <h1 className="mt-5 text-2xl font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{description}</p>
      <span className="mt-5 inline-flex items-center rounded-full border border-border-strong px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
        Coming soon
      </span>
      {children && <div className="mt-6 text-left">{children}</div>}
    </div>
  );
}
