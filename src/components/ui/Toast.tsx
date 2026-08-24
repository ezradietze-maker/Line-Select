"use client";

export interface ToastItem {
  id: string;
  title: string;
  body: string;
}

interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  onClick: (id: string) => void;
}

/** A stack of transient notifications pinned to the bottom-right of the viewport. */
export function ToastStack({ toasts, onDismiss, onClick }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-start gap-2 rounded-xl border border-border bg-surface-raised p-4 shadow-elevated-lg animate-fade-in"
        >
          <button
            type="button"
            onClick={() => onClick(toast.id)}
            className="flex-1 text-left"
          >
            <div className="text-sm font-semibold text-ink">{toast.title}</div>
            <div className="mt-0.5 text-sm text-ink-muted">{toast.body}</div>
          </button>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            className="shrink-0 rounded-md p-1 text-ink-faint hover:bg-black/[0.05] hover:text-ink"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
