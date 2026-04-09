/**
 * @file src/mainview/app/thread-extension-ui-dialog.tsx
 * @description Browser dialog for Pi extension UI prompts.
 */

import type { FormEvent, JSX } from "react";
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
    <div className="fixed inset-0 z-[111] flex items-center justify-center bg-black/72 px-4 py-6">
      <dialog
        aria-modal="true"
        className="w-full max-w-xl rounded-2xl border border-[#36424b] bg-[#14181b] p-0 text-[#f2f0ef] shadow-2xl shadow-black/50"
        open
      >
        <form className="p-5" onSubmit={onSubmit}>
          <div className="mb-2 font-label text-[11px] uppercase tracking-[0.18em] text-[#8fb5cd]">
            Pi Extension
          </div>
          <div className="mb-2 text-lg font-semibold text-[#f2f0ef]">
            {dialog.title}
          </div>
          {dialog.method === "confirm" ? (
            <div className="mb-5 text-sm leading-6 text-[#b7c8d4]">
              {dialog.message}
            </div>
          ) : dialog.method === "select" ? (
            <div className="mb-5 text-sm leading-6 text-[#b7c8d4]">
              Choose an option to continue.
            </div>
          ) : (
            <div className="mb-5 text-sm leading-6 text-[#b7c8d4]">
              {dialog.method === "editor"
                ? "Review and edit the text before continuing."
                : "Provide a value to continue."}
            </div>
          )}

          {dialog.method === "input" ? (
            <label className="block space-y-2">
              <span className="font-label text-[10px] font-semibold tracking-[0.18em] text-[#89a6ba] uppercase">
                Value
              </span>
              <input
                autoFocus
                className="w-full rounded-xl border border-[#33404a] bg-[#0f1418] px-3 py-3 text-sm text-[#f2f0ef] outline-none transition focus:border-[#6aa6cc]"
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
              <span className="font-label text-[10px] font-semibold tracking-[0.18em] text-[#89a6ba] uppercase">
                Editor
              </span>
              <textarea
                autoFocus
                className="app-scrollbar min-h-[15rem] w-full resize-y rounded-xl border border-[#33404a] bg-[#0f1418] px-3 py-3 text-sm leading-6 text-[#f2f0ef] outline-none transition focus:border-[#6aa6cc]"
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
                <button
                  key={option}
                  className="w-full rounded-xl border border-[#33404a] bg-[#0f1418] px-4 py-3 text-left text-sm text-[#f2f0ef] transition hover:border-[#6aa6cc] hover:bg-[#152028] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={busy}
                  onClick={() => {
                    onConfirm(option);
                  }}
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-xl border border-[#6b3a3a] bg-[#2a1717] px-4 py-3 text-sm text-[#ffb9b9]">
              {error}
            </div>
          ) : null}

          <div className="mt-5 flex items-center justify-between gap-3">
            <div className="text-xs text-[#8094a1]">
              Thread #{dialog.threadId} requested input from a Pi extension.
            </div>
            <div className="flex items-center gap-3">
              <button
                className="rounded-full border border-[#46535c] px-4 py-2 text-sm text-[#d4dee5] transition hover:border-[#6d7b85] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy}
                onClick={onCancel}
                type="button"
              >
                Cancel
              </button>
              {dialog.method === "select" ? null : dialog.method ===
                "confirm" ? (
                <button
                  className="rounded-full bg-[#bdd5e6] px-4 py-2 text-sm font-semibold text-[#0f1418] transition hover:bg-[#d8e6f0] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={busy}
                  type="submit"
                >
                  {busy ? "Working..." : "Confirm"}
                </button>
              ) : (
                <button
                  className="rounded-full bg-[#bdd5e6] px-4 py-2 text-sm font-semibold text-[#0f1418] transition hover:bg-[#d8e6f0] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={busy}
                  type="submit"
                >
                  {busy ? "Working..." : "Continue"}
                </button>
              )}
            </div>
          </div>
        </form>
      </dialog>
    </div>
  );
}
