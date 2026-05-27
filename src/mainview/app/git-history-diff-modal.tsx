/**
 * @file src/mainview/app/git-history-diff-modal.tsx
 * @description Lazy-loaded commit diff modal for git history entries.
 */

import type { JSX } from "react";
import { AppButton } from "../controls/button";
import { materialSymbol } from "../controls/icons";
import { formatGitHistoryTimestamp } from "./date-format";
import type { GitHistoryModalState } from "./git-history-state";
import { DiffViewer } from "./message-ui";

/**
 * Renders the GitHistoryDiffModal component.
 * @param state - Current state value.
 * @param onClose - onClose value.
 */
export function GitHistoryDiffModal({
  state,
  onClose,
}: {
  state: GitHistoryModalState;
  onClose: () => void;
}): JSX.Element {
  const dialogTitleId = `git-history-modal-title-${state.entry.hash}`;
  const dialogDescriptionId = `git-history-modal-description-${state.entry.hash}`;
  const dialogBodyId = `git-history-modal-body-${state.entry.hash}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <AppButton
        unstyled
        aria-label="Close commit diff"
        className="absolute inset-0 bg-black/65"
        onClick={onClose}
        type="button"
      />
      <dialog
        aria-describedby={dialogDescriptionId}
        aria-labelledby={dialogTitleId}
        aria-modal="true"
        className="relative mx-auto my-auto flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden border border-border-default bg-bg-canvas p-0 shadow-overlay"
        open
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-subtle bg-surface-1 px-4 py-4">
          <div className="min-w-0">
            <div className="font-label text-[10px] uppercase tracking-[0.1em] text-accent">
              Commit Diff
            </div>
            <div
              className="mt-1 truncate text-sm font-semibold text-text-primary"
              id={dialogTitleId}
            >
              {state.entry.subject}
            </div>
            <div
              className="mt-1 text-[11px] text-text-muted"
              id={dialogDescriptionId}
            >
              {state.entry.shortHash} · {state.entry.authorName} ·{" "}
              {formatGitHistoryTimestamp(state.entry.committedAt)}
            </div>
          </div>
          <AppButton
            unstyled
            type="button"
            aria-label="Close commit diff"
            className="flex h-8 w-8 shrink-0 items-center justify-center border border-border-default bg-surface-2 text-text-secondary transition-colors hover:bg-hover-surface hover:text-text-primary"
            onClick={onClose}
          >
            {materialSymbol("close", "text-[15px]")}
          </AppButton>
        </div>
        <div
          className="app-scrollbar flex-1 overflow-auto px-4 py-4"
          id={dialogBodyId}
        >
          {state.loading ? (
            <div className="border border-border-default bg-surface-2 px-3 py-3 text-sm text-text-secondary">
              Loading diff...
            </div>
          ) : state.error ? (
            <div className="border border-danger-border bg-danger-surface px-3 py-3 text-sm text-danger-text">
              {state.error}
            </div>
          ) : (
            <DiffViewer diffText={state.diffText} />
          )}
        </div>
      </dialog>
    </div>
  );
}
