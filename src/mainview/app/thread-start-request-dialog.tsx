/**
 * @file src/mainview/app/thread-start-request-dialog.tsx
 * @description Dialog for approving externally requested thread starts.
 */

import { type JSX, useId } from "react";
import { AppButton } from "../controls/button";

type ThreadStartRequestAccessEntry = {
  label: string;
  value: string;
};

type ThreadStartRequestDialogProps = {
  accessEntries: ThreadStartRequestAccessEntry[];
  busy: boolean;
  error: string;
  open: boolean;
  projectLabel: string;
  prompt: string;
  queueLabel: string;
  worktreePath: string;
  onApprove: () => void;
  onDismiss: () => void;
};

/**
 * Modal review surface for externally requested thread creation.
 */
export function ThreadStartRequestDialog({
  accessEntries,
  busy,
  error,
  open,
  projectLabel,
  prompt,
  queueLabel,
  worktreePath,
  onApprove,
  onDismiss,
}: ThreadStartRequestDialogProps): JSX.Element | null {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const describedBy = error ? `${descriptionId} ${errorId}` : descriptionId;

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6">
      <AppButton
        unstyled
        aria-label="Dismiss new thread request"
        className="absolute inset-0 bg-black/60"
        disabled={busy}
        onClick={onDismiss}
        type="button"
      />
      <dialog
        aria-describedby={describedBy}
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-xl border border-border-default bg-surface-1 p-5 text-text-primary shadow-overlay"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || busy) {
            return;
          }
          event.preventDefault();
          onDismiss();
        }}
        open
      >
        <div className="mb-2 font-label text-[11px] uppercase tracking-[0.1em] text-accent">
          New Thread Request
        </div>
        <div
          className="mb-2 text-lg font-semibold text-text-primary"
          id={titleId}
        >
          Create a thread for this workspace?
        </div>
        <div className="mb-4 text-sm text-text-secondary" id={descriptionId}>
          Review the requested workspace, initial prompt, and access settings
          before creating and opening the new thread.
        </div>
        <div className="mb-4 text-sm text-text-secondary">{projectLabel}</div>
        <div className="mb-4 border border-border-subtle bg-bg-canvas px-4 py-3">
          <div className="mb-1 font-label text-[10px] uppercase tracking-[0.1em] text-accent">
            Workspace
          </div>
          <div className="break-all font-mono text-sm text-text-secondary">
            {worktreePath}
          </div>
        </div>
        <div className="mb-4 border border-border-subtle bg-bg-canvas px-4 py-3">
          <div className="mb-1 font-label text-[10px] uppercase tracking-[0.1em] text-accent">
            Initial Prompt
          </div>
          <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm text-text-secondary">
            {prompt}
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-2 text-xs text-text-muted">
          {accessEntries.map((entry) => (
            <span
              className="border border-border-default px-3 py-1"
              key={entry.label}
            >
              {entry.label}: {entry.value}
            </span>
          ))}
        </div>
        {error ? (
          <div
            className="mb-4 border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-text"
            id={errorId}
          >
            {error}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-text-faint">{queueLabel}</div>
          <div className="flex items-center gap-3">
            <AppButton
              buttonStyle="secondary"
              disabled={busy}
              onClick={onDismiss}
            >
              Dismiss
            </AppButton>
            <AppButton
              buttonStyle="primary"
              disabled={busy}
              onClick={onApprove}
            >
              {busy ? "Creating..." : "Create Thread"}
            </AppButton>
          </div>
        </div>
      </dialog>
    </div>
  );
}
