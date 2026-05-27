/**
 * @file src/mainview/controls/confirm-dialog.tsx
 * @description Shared confirmation dialog.
 */

import type { JSX } from "react";
import { useId, useRef } from "react";
import { AppButton } from "./button";
import { ModalDialogSurface } from "./popover";

export type ConfirmDialogProps = {
  cancelLabel?: string;
  confirmLabel?: string;
  details?: string | undefined;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title?: string;
};

export function ConfirmDialog({
  cancelLabel = "Cancel",
  confirmLabel = "Ok",
  details,
  message,
  onCancel,
  onConfirm,
  open,
  title = "Confirm",
}: ConfirmDialogProps): JSX.Element {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;

  return (
    <ModalDialogSurface
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      backdropLabel={cancelLabel}
      className="w-full max-w-sm border border-border-default bg-surface-overlay p-4 text-text-primary shadow-overlay"
      initialFocusRef={cancelButtonRef}
      onRequestClose={onCancel}
      open={open}
      restoreFocus={true}
    >
      <div className="text-sm font-semibold text-text-primary" id={titleId}>
        {title}
      </div>
      <div
        className="mt-3 text-sm leading-6 text-text-secondary"
        id={descriptionId}
      >
        {message}
      </div>
      {details ? (
        <div className="mt-2 truncate border border-border-subtle bg-surface-1 px-2 py-2 text-xs text-text-muted">
          {details}
        </div>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <AppButton
          buttonStyle="secondary"
          onClick={onCancel}
          ref={cancelButtonRef}
        >
          {cancelLabel}
        </AppButton>
        <AppButton buttonStyle="error" onClick={onConfirm}>
          {confirmLabel}
        </AppButton>
      </div>
    </ModalDialogSurface>
  );
}
