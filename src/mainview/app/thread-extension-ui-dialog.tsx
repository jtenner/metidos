/**
 * @file src/mainview/app/thread-extension-ui-dialog.tsx
 * @description Browser dialog for Pi extension UI prompts.
 */

import { useId, useRef, type FormEvent, type JSX } from "react";
import { AppButton } from "../controls/button";
import { ModalDialogSurface } from "../controls/popover";
import type { ThreadExtensionUiDialog as ThreadExtensionUiDialogState } from "../thread-extension-ui";

type ThreadExtensionUiDialogProps = {
  busy: boolean;
  dialog: ThreadExtensionUiDialogState | null;
  error: string;
  onCancel: () => void;
  onConfirm: (value: boolean | string | undefined) => void;
  onDraftChange: (value: string) => void;
  value: string;
};

/**
 * Render the active Pi extension prompt dialog.
 */
export function ThreadExtensionUiDialog({
  busy,
  dialog,
  error,
  onCancel,
  onConfirm,
  onDraftChange,
  value,
}: ThreadExtensionUiDialogProps): JSX.Element | null {
  const titleId = useId();
  const descriptionId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  if (!dialog) {
    return null;
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (dialog.method === "confirm") {
      onConfirm(true);
      return;
    }
    onConfirm(value);
  };

  return (
    <ModalDialogSurface
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      backdropLabel="Cancel extension prompt"
      className="w-full max-w-xl rounded-md border border-border-default bg-bg-canvas p-0 text-text-primary shadow-overlay"
      initialFocusRef={dialog.method === "editor" ? editorRef : inputRef}
      onRequestClose={() => {
        if (!busy) {
          onCancel();
        }
      }}
      open={true}
      overlayClassName="fixed inset-0 z-[111] flex items-center justify-center px-4 py-6"
      restoreFocus={true}
    >
      <form className="p-5" onSubmit={onSubmit}>
        <div className="mb-2 font-label text-[11px] uppercase tracking-[0.1em] text-accent">
          Pi Extension
        </div>
        <div
          className="mb-2 text-base font-semibold text-text-primary"
          id={titleId}
        >
          {dialog.title}
        </div>
        {dialog.method === "confirm" ? (
          <div
            className="mb-5 text-sm leading-6 text-text-muted"
            id={descriptionId}
          >
            {dialog.message}
          </div>
        ) : dialog.method === "select" ? (
          <div
            className="mb-5 text-sm leading-6 text-text-muted"
            id={descriptionId}
          >
            Choose an option to continue.
          </div>
        ) : (
          <div
            className="mb-5 text-sm leading-6 text-text-muted"
            id={descriptionId}
          >
            {dialog.method === "editor"
              ? "Review and edit the text before continuing."
              : "Provide a value to continue."}
          </div>
        )}

        {dialog.method === "input" ? (
          <label className="block space-y-2">
            <span className="font-label text-[10px] font-semibold tracking-[0.1em] text-text-faint uppercase">
              Value
            </span>
            <input
              aria-label="Value"
              className="w-full rounded-sm border border-border-default bg-surface-2 px-3 py-2 text-sm text-text-primary outline-none transition focus:border-focus-ring"
              name="thread-extension-input"
              ref={inputRef}
              onChange={(event) => {
                onDraftChange(event.currentTarget.value);
              }}
              placeholder={dialog.placeholder ?? ""}
              type="text"
              value={value}
            />
          </label>
        ) : null}

        {dialog.method === "editor" ? (
          <label className="block space-y-2">
            <span className="font-label text-[10px] font-semibold tracking-[0.1em] text-text-faint uppercase">
              Editor
            </span>
            <textarea
              className="app-scrollbar min-h-[15rem] w-full resize-y rounded-sm border border-border-default bg-surface-2 px-3 py-2 text-sm leading-6 text-text-primary outline-none transition focus:border-focus-ring"
              name="thread-extension-editor"
              ref={editorRef}
              onChange={(event) => {
                onDraftChange(event.currentTarget.value);
              }}
              value={value}
            />
          </label>
        ) : null}

        {dialog.method === "select" ? (
          <div className="grid gap-2">
            {dialog.options.map((option) => (
              <AppButton
                unstyled
                key={option}
                className="w-full rounded-sm border border-border-default bg-surface-2 px-4 py-2 text-left text-sm text-text-primary transition hover:border-accent hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy}
                onClick={() => {
                  onConfirm(option);
                }}
                type="button"
              >
                {option}
              </AppButton>
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-sm border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-text">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="text-xs text-text-faint">
            Thread #{dialog.threadId} requested input from a Pi extension.
          </div>
          <div className="flex items-center gap-3">
            <AppButton
              unstyled
              className="rounded-sm border border-border-default px-4 py-2 text-sm text-text-secondary transition hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              Cancel
            </AppButton>
            {dialog.method === "select" ? null : dialog.method === "confirm" ? (
              <AppButton
                unstyled
                className="rounded-sm bg-accent-strong px-4 py-2 text-sm font-semibold text-bg-app transition hover:bg-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy}
                type="submit"
              >
                {busy ? "Working..." : "Confirm"}
              </AppButton>
            ) : (
              <AppButton
                unstyled
                className="rounded-sm bg-accent-strong px-4 py-2 text-sm font-semibold text-bg-app transition hover:bg-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy}
                type="submit"
              >
                {busy ? "Working..." : "Continue"}
              </AppButton>
            )}
          </div>
        </div>
      </form>
    </ModalDialogSurface>
  );
}
