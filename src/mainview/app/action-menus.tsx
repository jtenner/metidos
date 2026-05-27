/**
 * @file src/mainview/app/action-menus.tsx
 * @description Module for action menus.
 */

import {
  type FormEvent,
  type JSX,
  type RefObject,
  useEffect,
  useRef,
} from "react";
import type { RpcProject, RpcThread, RpcWorktree } from "../../bun/rpc-schema";
import { AppButton } from "../controls/button";
import { materialSymbol } from "../controls/icons";
import {
  createPointReference,
  ModalDialogSurface,
  PopoverSurface,
} from "../controls/popover";
import { formatPathForDisplay } from "./path-display-state";
import type {
  ProjectActionMenuState,
  ThreadActionMenuState,
} from "./thread-ui-state";

/**
 * Props for the project action popover anchored to a project row.
 */
type ProjectActionMenuProps = {
  error: string;
  homeDirectory: string;
  hiddenWorktreePath: string;
  hiddenWorktrees: RpcWorktree[];
  isOpeningHiddenWorktree: boolean;
  menu: ProjectActionMenuState | null;
  onClose: () => void;
  onDeleteProject: () => void;
  onHiddenWorktreePathChange: (value: string) => void;
  onOpenDeleteProject: () => void;
  onOpenHiddenWorktree: () => void;
  project: RpcProject | null;
  projectActionMenuRef: RefObject<HTMLDivElement | null>;
  supportsTildePath: boolean;
  worktreePinBusyPath: string | null;
};

/**
 * Project action menu plus the centered project delete confirmation.
 */
export function ProjectActionMenu({
  error,
  homeDirectory,
  hiddenWorktreePath,
  hiddenWorktrees,
  isOpeningHiddenWorktree,
  menu,
  onClose,
  onDeleteProject,
  onHiddenWorktreePathChange,
  onOpenDeleteProject,
  onOpenHiddenWorktree,
  project,
  projectActionMenuRef,
  supportsTildePath,
  worktreePinBusyPath,
}: ProjectActionMenuProps): JSX.Element | null {
  const deleteCancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (menu?.mode !== "delete") {
      return;
    }

    deleteCancelButtonRef.current?.focus();
  }, [menu]);

  // Hide when menu anchor/state is unavailable or target project no longer exists.
  if (!menu || !project) {
    return null;
  }

  const deleteDialogTitleId = `project-delete-dialog-title-${project.id}`;
  const deleteDialogDescriptionId = `project-delete-dialog-description-${project.id}`;
  const projectMenuTitleId = `project-actions-title-${project.id}`;
  const projectMenuDescriptionId = `project-actions-description-${project.id}`;

  if (menu.mode === "delete") {
    return (
      <ModalDialogSurface
        aria-describedby={deleteDialogDescriptionId}
        aria-labelledby={deleteDialogTitleId}
        backdropLabel={`Close delete confirmation for ${project.name}`}
        className="relative w-full max-w-sm border border-border-default bg-surface-1 p-4 text-text-primary"
        initialFocusRef={deleteCancelButtonRef}
        onRequestClose={onClose}
        open={true}
        ref={projectActionMenuRef}
      >
        <h2
          className="text-sm font-semibold text-text-primary"
          id={deleteDialogTitleId}
        >
          Remove project?
        </h2>
        <p
          className="mt-2 text-sm leading-6 text-text-primary"
          id={deleteDialogDescriptionId}
        >
          Are you sure you want to remove this project from the project list?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <AppButton
            buttonStyle="secondary"
            className="min-w-20"
            onClick={onClose}
            ref={deleteCancelButtonRef}
            type="button"
          >
            No
          </AppButton>
          <AppButton
            buttonStyle="error"
            className="min-w-20"
            onClick={onDeleteProject}
            type="button"
          >
            Yes
          </AppButton>
        </div>
        {error ? (
          <div className="mt-3 border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-text">
            {error}
          </div>
        ) : null}
      </ModalDialogSurface>
    );
  }

  const reference = createPointReference({
    x: menu.x,
    y: menu.y,
  });

  return (
    <PopoverSurface
      aria-describedby={projectMenuDescriptionId}
      aria-labelledby={projectMenuTitleId}
      className="z-[90] max-h-[min(32rem,calc(100vh-24px))] w-80 select-none overflow-y-auto border border-border-default bg-surface-overlay shadow-overlay backdrop-blur-xl"
      offsetPx={0}
      onRequestClose={onClose}
      open={true}
      placement="bottom-start"
      reference={reference}
      ref={projectActionMenuRef}
      surfaceMode="nonmodal-dialog"
    >
      <p className="sr-only" id={projectMenuDescriptionId}>
        Project actions for {project.name}.
      </p>
      <div className="border-b border-border-subtle bg-surface-2 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="font-label text-[10px] uppercase tracking-[0.1em] text-accent"
              id={projectMenuTitleId}
            >
              Project Actions
            </div>
            <div className="truncate text-sm font-semibold text-text-primary">
              {project.name}
            </div>
            <div className="truncate text-[11px] text-text-muted">
              {formatPathForDisplay(
                project.path,
                homeDirectory,
                supportsTildePath,
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <AppButton
              unstyled
              type="button"
              className="flex h-7 w-7 items-center justify-center border border-danger-border bg-danger-surface text-danger-text transition-opacity hover:opacity-90"
              onClick={onOpenDeleteProject}
              aria-label={`Remove ${project.name}`}
              title="Remove project"
            >
              {materialSymbol("delete", "text-[19px]")}
            </AppButton>
            <AppButton
              unstyled
              type="button"
              className="flex h-7 w-7 items-center justify-center border border-border-default bg-surface-2 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
              onClick={onClose}
              aria-label="Close project actions"
            >
              {materialSymbol("close", "text-[15px]")}
            </AppButton>
          </div>
        </div>
      </div>
      {error ? (
        <>
          {/* Render a compact error strip so failed worktree actions stay visible without replacing controls. */}
          <div className="border-b border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-text">
            {error}
          </div>
        </>
      ) : null}
      {hiddenWorktrees.length > 0 ? (
        <div className="border-t border-border-subtle bg-surface-2 px-3 py-3">
          <label
            className="block text-[10px] font-label uppercase tracking-[0.1em] text-accent"
            htmlFor="open-hidden-worktree"
          >
            Open Subproject
          </label>
          <div className="mt-2 flex items-center gap-2">
            <select
              id="open-hidden-worktree"
              className="min-w-0 flex-1 border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-focus-ring"
              value={hiddenWorktreePath}
              onChange={(event) => {
                onHiddenWorktreePathChange(event.currentTarget.value);
              }}
            >
              {hiddenWorktrees.map((worktree) => {
                const displayPath = formatPathForDisplay(
                  worktree.path,
                  homeDirectory,
                  supportsTildePath,
                );
                const label = worktree.branch?.trim()
                  ? `${displayPath} · ${worktree.branch}`
                  : displayPath;
                return (
                  <option key={worktree.path} value={worktree.path}>
                    {label}
                  </option>
                );
              })}
            </select>
            <AppButton
              buttonStyle="primary"
              disabled={
                isOpeningHiddenWorktree ||
                worktreePinBusyPath !== null ||
                !hiddenWorktreePath
              }
              onClick={onOpenHiddenWorktree}
            >
              {isOpeningHiddenWorktree ? "Opening" : "Open"}
            </AppButton>
          </div>
        </div>
      ) : null}
    </PopoverSurface>
  );
}

/**
 * Props for the thread action popover anchored to a thread row.
 */
type ThreadActionMenuProps = {
  error: string;
  homeDirectory: string;
  menu: ThreadActionMenuState | null;
  onClose: () => void;
  onDeleteThread: () => void;
  onSummaryChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTitleChange: (value: string) => void;
  onTogglePinned: () => void;
  supportsTildePath: boolean;
  thread: RpcThread | null;
  threadActionBusy: "rename" | "pin" | "delete" | null;
  threadActionMenuRef: RefObject<HTMLDivElement | null>;
  threadRenameSummary: string;
  threadRenameTitle: string;
};

/**
 * Renders thread-specific controls for rename, pin/unpin, and delete actions.
 */
export function ThreadActionMenu({
  error,
  homeDirectory,
  menu,
  onClose,
  onDeleteThread,
  onSummaryChange,
  onSubmit,
  onTitleChange,
  onTogglePinned,
  supportsTildePath,
  thread,
  threadActionBusy,
  threadActionMenuRef,
  threadRenameSummary,
  threadRenameTitle,
}: ThreadActionMenuProps): JSX.Element | null {
  const renameTitleInputRef = useRef<HTMLInputElement | null>(null);

  // Guard against invalid menu state when the selected thread is removed.
  if (!menu || !thread) {
    return null;
  }

  const threadMenuTitleId = `thread-actions-title-${thread.id}`;
  const threadMenuDescriptionId = `thread-actions-description-${thread.id}`;

  return (
    <PopoverSurface
      aria-describedby={threadMenuDescriptionId}
      aria-labelledby={threadMenuTitleId}
      className="z-[95] w-80 select-none overflow-hidden border border-border-default bg-surface-overlay shadow-overlay backdrop-blur-xl"
      initialFocusRef={renameTitleInputRef}
      offsetPx={0}
      onRequestClose={onClose}
      open={true}
      placement="bottom-start"
      reference={createPointReference({
        x: menu.x,
        y: menu.y,
      })}
      ref={threadActionMenuRef}
      surfaceMode="nonmodal-dialog"
    >
      <p className="sr-only" id={threadMenuDescriptionId}>
        Actions for thread {thread.title}.
      </p>
      <div className="border-b border-border-subtle bg-surface-2 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="font-label text-[10px] uppercase tracking-[0.1em] text-accent"
              id={threadMenuTitleId}
            >
              Thread Actions
            </div>
            <div className="truncate text-sm font-semibold text-text-primary">
              {thread.title}
            </div>
            <div className="truncate text-[11px] text-text-muted">
              {formatPathForDisplay(
                thread.worktreePath,
                homeDirectory,
                supportsTildePath,
              )}
            </div>
          </div>
          <AppButton
            unstyled
            type="button"
            className="flex h-7 w-7 items-center justify-center border border-border-default bg-surface-2 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
            onClick={onClose}
            aria-label="Close thread actions"
          >
            {materialSymbol("close", "text-[15px]")}
          </AppButton>
        </div>
      </div>
      {error ? (
        <>
          {/* Thread-level errors are shown inline so retry actions stay available. */}
          <div className="border-b border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-text">
            {error}
          </div>
        </>
      ) : null}
      <form
        className="border-b border-border-subtle bg-surface-2 px-3 py-3"
        onSubmit={onSubmit}
      >
        <label
          className="block text-[10px] font-label uppercase tracking-[0.1em] text-accent"
          htmlFor="thread-rename-title"
        >
          Rename Thread
        </label>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="thread-rename-title"
            className="min-w-0 flex-1 select-text border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-faint focus:border-focus-ring"
            ref={renameTitleInputRef}
            value={threadRenameTitle}
            onChange={(event) => {
              onTitleChange(event.currentTarget.value);
            }}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <label
          className="mt-3 block text-[10px] font-label uppercase tracking-[0.1em] text-accent"
          htmlFor="thread-rename-summary"
        >
          Thread Summary
        </label>
        <textarea
          id="thread-rename-summary"
          className="mt-2 min-h-[5.5rem] w-full select-text border border-border-default bg-surface-1 px-3 py-2 text-sm leading-6 text-text-primary outline-none transition-colors placeholder:text-text-faint focus:border-focus-ring"
          placeholder="Optional desktop hover summary."
          value={threadRenameSummary}
          onChange={(event) => {
            onSummaryChange(event.currentTarget.value);
          }}
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck={true}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="text-[11px] text-text-muted">
            Shown as a desktop hover popover. Leave blank to clear it.
          </div>
          {/* Disable submit while any thread action is in progress. */}
          <AppButton
            buttonStyle="primary"
            type="submit"
            disabled={threadActionBusy !== null}
          >
            {threadActionBusy === "rename" ? "Saving" : "Save"}
          </AppButton>
        </div>
      </form>
      <div className="flex justify-end gap-2 border-t border-border-subtle px-3 py-3">
        <AppButton
          unstyled
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center border border-border-default bg-surface-2 text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onTogglePinned}
          disabled={threadActionBusy !== null}
          aria-label={thread.pinnedAt ? "Unpin thread" : "Pin thread"}
          title={thread.pinnedAt ? "Unpin thread" : "Pin thread"}
        >
          {materialSymbol("push_pin", "text-[19px]", {
            filled: Boolean(thread.pinnedAt),
          })}
        </AppButton>
        <AppButton
          unstyled
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center border border-danger-border bg-danger-surface text-danger-text transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onDeleteThread}
          disabled={threadActionBusy !== null}
          aria-label="Delete thread"
          title="Delete thread"
        >
          {materialSymbol("delete", "text-[19px]")}
        </AppButton>
      </div>
    </PopoverSurface>
  );
}
