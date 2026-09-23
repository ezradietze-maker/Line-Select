"use client";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

interface ConfirmModalProps {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Styles the confirm button as the dangerous action it is, so it can't be mistaken for the safe default. */
  destructive?: boolean;
  /** An optional third route out for someone who clicked the trigger meaning something milder — e.g. "upload a new pack instead" rather than deleting everything. */
  alternative?: { label: string; onClick: () => void };
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  alternative,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="space-y-4 text-sm leading-relaxed text-ink-muted">{children}</div>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
        <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        {alternative && (
          <Button variant="secondary" onClick={alternative.onClick}>
            {alternative.label}
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </Modal>
  );
}
