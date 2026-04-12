/**
 * @file src/mainview/app/action-menus.tsx
 * @description Module for action menus.
 */

import type { FormEvent, JSX, RefObject } from "react";
import type { RpcProject, RpcThread, RpcWorktree } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import {
  formatPathForDisplay,
  type ProjectActionMenuState,
  type ThreadActionMenuState,
} from "./state";

/**
 * Props for the project action popover anchored to a project row.
 */
type ProjectActionMenuProps = {
  error: string;
  homeDirectory: string;
  hiddenWorktreePath: string;
  hiddenWorktrees: RpcWorktree[];
  isCreatingWorktree: boolean;
  isOpeningHiddenWorktree: boolean;
  menu: ProjectActionMenuState | null;
  newWorktreeName: string;
  onClose: () => void;
  onDeleteProject: () => void;
  onHiddenWorktreePathChange: (value: string) => void;
  onNewWorktreeNameChange: (value: string) => void;
  onOpenHiddenWorktree: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  project: RpcProject | null;
  projectActionMenuRef: RefObject<HTMLDivElement | null>;
  supportsTildePath: boolean;
  worktreePinBusyPath: string | null;
};

/**
 * Floating project action menu with project deletion and subproject creation.
 */
export function ProjectActionMenu({
  error,
  homeDirectory,
  hiddenWorktreePath,
  hiddenWorktrees,
  isCreatingWorktree,
  isOpeningHiddenWorktree,
  menu,
  newWorktreeName,
  onClose,
  onDeleteProject,
  onHiddenWorktreePathChange,
  onNewWorktreeNameChange,
  onOpenHiddenWorktree,
  onSubmit,
  project,
  projectActionMenuRef,
  supportsTildePath,
  worktreePinBusyPath,
}: ProjectActionMenuProps): JSX.Element | null {
  // Hide when menu anchor/state is unavailable or target project no longer exists.
  if (!menu || !project) {
    return null;
  }

  return (
    <div
      className="fixed z-[90] max-h-[min(32rem,calc(100vh-24px))] w-80 select-none overflow-y-auto border border-[#35414a] bg-[#13181b]/96 shadow-[0_18px_42px_rgba(0,0,0,0.58)] backdrop-blur-xl"
      ref={projectActionMenuRef}
      style={{
        left: menu.x,
        top: menu.y,
      }}
    >
      <div className="border-b border-[#2b343b] bg-[#181f24] px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
              Project Actions
            </div>
            <div className="truncate text-sm font-semibold text-[#f2f0ef]">
              {project.name}
            </div>
            <div className="truncate text-[11px] text-[#8f9aa2]">
              {formatPathForDisplay(
                project.path,
                homeDirectory,
                supportsTildePath,
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center border border-[#5c2030] bg-[#2c1117] text-[#ff8ca0] transition-colors hover:bg-[#39161f] hover:text-[#ffd1d8]"
              onClick={onDeleteProject}
              aria-label={`Remove ${project.name}`}
              title="Remove Project"
            >
              {materialSymbol("delete", "text-[18px]")}
            </button>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center border border-[#303940] bg-[#1a2025] text-[#acb8c1] transition-colors hover:bg-[#242d33] hover:text-[#f2f0ef]"
              onClick={onClose}
              aria-label="Close project actions"
            >
              ×
            </button>
          </div>
        </div>
      </div>
      {error ? (
        <>
          {/* Render a compact error strip so failed worktree actions stay visible without replacing controls. */}
          <div className="border-b border-[#3a2230] bg-[#27151d] px-3 py-2 text-xs text-[#ff7e93]">
            {error}
          </div>
        </>
      ) : null}
      <form
        className="border-t border-[#2b343b] bg-[#171d21] px-3 py-3"
        onSubmit={onSubmit}
      >
        <label
          className="block text-[10px] font-label uppercase tracking-widest text-[#98b9d0]"
          htmlFor="new-worktree-name"
        >
          New Subproject
        </label>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="new-worktree-name"
            className="min-w-0 flex-1 select-text border border-[#3b474f] bg-[#12171b] px-3 py-2 text-sm text-[#f2f0ef] outline-none transition-colors placeholder:text-[#727e86] focus:border-[#99bed9]"
            placeholder="feature/new-subproject"
            value={newWorktreeName}
            onChange={(event) => {
              onNewWorktreeNameChange(event.currentTarget.value);
            }}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {/* Disable while submission is in progress to prevent duplicate create-worktree requests. */}
          <button
            className="bg-[#f2f0ef] px-3 py-2 font-label text-[10px] font-bold uppercase tracking-wider text-[#181818] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={
              isCreatingWorktree ||
              isOpeningHiddenWorktree ||
              worktreePinBusyPath !== null
            }
            type="submit"
          >
            {isCreatingWorktree ? "Creating" : "Create"}
          </button>
        </div>
        <div className="mt-2 text-xs text-[#828d94]">
          Creates a new branch and sibling subproject folder.
        </div>
      </form>
      {hiddenWorktrees.length > 0 ? (
        <div className="border-t border-[#2b343b] bg-[#171d21] px-3 py-3">
          <label
            className="block text-[10px] font-label uppercase tracking-widest text-[#98b9d0]"
            htmlFor="open-hidden-worktree"
          >
            Open Subproject
          </label>
          <div className="mt-2 flex items-center gap-2">
            <select
              id="open-hidden-worktree"
              className="min-w-0 flex-1 border border-[#3b474f] bg-[#12171b] px-3 py-2 text-sm text-[#f2f0ef] outline-none transition-colors focus:border-[#99bed9]"
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
            <button
              type="button"
              className="bg-[#f2f0ef] px-3 py-2 font-label text-[10px] font-bold uppercase tracking-wider text-[#181818] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={
                isCreatingWorktree ||
                isOpeningHiddenWorktree ||
                worktreePinBusyPath !== null ||
                !hiddenWorktreePath
              }
              onClick={onOpenHiddenWorktree}
            >
              {isOpeningHiddenWorktree ? "Opening" : "Open"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
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
  // Guard against invalid menu state when the selected thread is removed.
  if (!menu || !thread) {
    return null;
  }

  return (
    <div
      className="fixed z-[95] w-80 select-none overflow-hidden border border-[#35414a] bg-[#13181b]/96 shadow-[0_18px_42px_rgba(0,0,0,0.58)] backdrop-blur-xl"
      ref={threadActionMenuRef}
      style={{
        left: menu.x,
        top: menu.y,
      }}
    >
      <div className="border-b border-[#2b343b] bg-[#181f24] px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
              Thread Actions
            </div>
            <div className="truncate text-sm font-semibold text-[#f2f0ef]">
              {thread.title}
            </div>
            <div className="truncate text-[11px] text-[#8f9aa2]">
              {formatPathForDisplay(
                thread.worktreePath,
                homeDirectory,
                supportsTildePath,
              )}
            </div>
          </div>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center border border-[#303940] bg-[#1a2025] text-[#acb8c1] transition-colors hover:bg-[#242d33] hover:text-[#f2f0ef]"
            onClick={onClose}
            aria-label="Close thread actions"
          >
            ×
          </button>
        </div>
      </div>
      {error ? (
        <>
          {/* Thread-level errors are shown inline so retry actions stay available. */}
          <div className="border-b border-[#3a2230] bg-[#27151d] px-3 py-2 text-xs text-[#ff7e93]">
            {error}
          </div>
        </>
      ) : null}
      <form
        className="border-b border-[#2b343b] bg-[#171d21] px-3 py-3"
        onSubmit={onSubmit}
      >
        <label
          className="block text-[10px] font-label uppercase tracking-widest text-[#98b9d0]"
          htmlFor="thread-rename-title"
        >
          Rename Thread
        </label>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="thread-rename-title"
            className="min-w-0 flex-1 select-text border border-[#3b474f] bg-[#12171b] px-3 py-2 text-sm text-[#f2f0ef] outline-none transition-colors placeholder:text-[#727e86] focus:border-[#99bed9]"
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
          className="mt-3 block text-[10px] font-label uppercase tracking-widest text-[#98b9d0]"
          htmlFor="thread-rename-summary"
        >
          Thread Summary
        </label>
        <textarea
          id="thread-rename-summary"
          className="mt-2 min-h-[5.5rem] w-full select-text border border-[#3b474f] bg-[#12171b] px-3 py-2 text-sm leading-6 text-[#f2f0ef] outline-none transition-colors placeholder:text-[#727e86] focus:border-[#99bed9]"
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
          <div className="text-[11px] text-[#828d94]">
            Shown as a desktop hover popover. Leave blank to clear it.
          </div>
          {/* Disable submit while any thread action is in progress. */}
          <button
            type="submit"
            className="bg-[#f2f0ef] px-3 py-2 font-label text-[10px] font-bold uppercase tracking-wider text-[#181818] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={threadActionBusy !== null}
          >
            {threadActionBusy === "rename" ? "Saving" : "Save"}
          </button>
        </div>
      </form>
      <div className="flex justify-end gap-2 border-t border-[#2b343b] px-3 py-3">
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#31404a] bg-[#182025] text-[#dfebf3] transition-colors hover:bg-[#1f282f] disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onTogglePinned}
          disabled={threadActionBusy !== null}
          aria-label={thread.pinnedAt ? "Unpin thread" : "Pin thread"}
          title={thread.pinnedAt ? "Unpin thread" : "Pin thread"}
        >
          {materialSymbol("push_pin", "text-[18px]", {
            filled: Boolean(thread.pinnedAt),
          })}
        </button>
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#5c2030] bg-[#2c1117] text-[#ff9db0] transition-colors hover:bg-[#39161f] disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onDeleteThread}
          disabled={threadActionBusy !== null}
          aria-label="Delete thread"
          title="Delete thread"
        >
          {materialSymbol("delete", "text-[18px]")}
        </button>
      </div>
    </div>
  );
}
