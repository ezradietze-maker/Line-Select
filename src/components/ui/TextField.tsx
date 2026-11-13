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
        // The error is read out with the field, not only seen under it.
        aria-describedby={error ? `${inputId}-error` : props["aria-describedby"]}
        // The edge and the ring both hold 3:1 against the page: the old border-strong edge and 40% ring were too faint to find.
        className={`w-full rounded-[4px] border bg-panel px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint transition-colors focus:border-[var(--color-focus-ring)] focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)] ${
          error ? "border-danger" : "border-field-edge"
        } ${className}`}
      />
      {error && (
        <p id={`${inputId}-error`} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
