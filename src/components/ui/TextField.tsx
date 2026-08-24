import type { InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function TextField({ label, error, id, className = "", ...props }: TextFieldProps) {
  const inputId = id ?? `field-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={inputId}
        {...props}
        aria-invalid={!!error}
        className={`w-full rounded-md border bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40 ${
          error ? "border-danger" : "border-border-strong"
        } ${className}`}
      />
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}
