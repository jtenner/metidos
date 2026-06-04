/**
 * @file src/mainview/app/diff-workspace.tsx
 * @description Module for diff workspace.
 */

import type { JSX, ReactNode } from "react";
import { AppButton } from "../controls/button";
import type { RpcProject, RpcWorktreeChange } from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import { useDynamicCssVariablesClassName } from "../dynamic-css-variables";
import { useDiffParseResult } from "./diff-parsing-client";
import { DiffViewer } from "./message-ui";

export type DiffFilePatchState = {
  diffText: string;
  error: string;
  isLoading: boolean;
  path: string | null;
};

/**
 * Tree node used by the diff file navigator.
 * `path === null` indicates a directory entry.
 */
export type DiffFileTreeNode = {
  change: RpcWorktreeChange | null;
  children: DiffFileTreeNode[];
  key: string;
  label: string;
  path: string | null;
};

/**
 * Build an initial empty patch state for a specific file path.
 */
export function emptyDiffFilePatchState(
  path: string | null = null,
): DiffFilePatchState {
  return {
    diffText: "",
    error: "",
    isLoading: false,
    path,
  };
}

/**
 * Builds diff file tree grouped by full containing directory paths.
 * @param changes - changes argument for buildDiffFileTree.
 */
export function buildDiffFileTree(
  changes: RpcWorktreeChange[],
): DiffFileTreeNode[] {
  type MutableNode = {
    change: RpcWorktreeChange | null;
    children: Map<string, MutableNode>;
    key: string;
    label: string;
    path: string | null;
  };

  const root = new Map<string, MutableNode>();

  for (const change of changes) {
    const segments = change.path.split("/").filter(Boolean);
    if (segments.length === 0) {
      continue;
    }

    const fileName = segments.at(-1);
    if (!fileName) {
      continue;
    }

    const directoryPath = segments.slice(0, -1).join("/");
    const fileNode: MutableNode = {
      change,
      children: new Map<string, MutableNode>(),
      key: change.path,
      label: fileName,
      path: change.path,
    };

    if (!directoryPath) {
      root.set(change.path, fileNode);
      continue;
    }

    const directoryNode = root.get(directoryPath) ?? {
      change: null,
      children: new Map<string, MutableNode>(),
      key: directoryPath,
      label: directoryPath,
      path: null,
    };
    directoryNode.children.set(change.path, fileNode);
    root.set(directoryPath, directoryNode);
  }

  // Materialize map-backed tree into deterministic arrays:
  // directories before files, both sorted lexicographically by label.
  /**
   * Materializes node data into view objects.
   * @param nodes - Structured nodes.
   */
  const materialize = (nodes: Map<string, MutableNode>): DiffFileTreeNode[] =>
    [...nodes.values()]
      .sort((left, right) => {
        const leftIsDirectory = left.path === null;
        const rightIsDirectory = right.path === null;
        if (leftIsDirectory !== rightIsDirectory) {
          return leftIsDirectory ? -1 : 1;
        }
        return left.label.localeCompare(right.label);
      })
      .map((node) => ({
        change: node.change,
        children: materialize(node.children),
        key: node.key,
        label: node.label,
        path: node.path,
      }));

  return materialize(root);
}

/**
 * Performs DiffFileTree operation.
 * @param nodes - Structured nodes.
 * @param onSelectedDiffFilePathChange - onSelectedDiffFilePathChange path used by DiffFileTree.
 * @param selectedDiffFilePath - selectedDiffFilePath path used by DiffFileTree.
 */
function DiffTreeDirectoryRow({
  children,
  depth,
}: {
  children: ReactNode;
  depth: number;
}): JSX.Element {
  const className = useDynamicCssVariablesClassName(
    {
      "--diff-tree-indent": `${12 + depth * 14}px`,
    },
    {
      className:
        "diff-tree-indented-row flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-[0.1em] text-text-muted",
      prefix: "diff-tree-directory-vars",
    },
  );
  return <div className={className}>{children}</div>;
}

function DiffTreeFileButton({
  children,
  depth,
  isSelected,
  onClick,
}: {
  children: ReactNode;
  depth: number;
  isSelected: boolean;
  onClick: () => void;
}): JSX.Element {
  const className = useDynamicCssVariablesClassName(
    {
      "--diff-tree-indent": `${12 + depth * 14}px`,
    },
    {
      className: `diff-tree-indented-row flex w-full items-center justify-between gap-3 border-l px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-[-1px] ${
        isSelected
          ? "border-accent bg-surface-2"
          : "border-transparent hover:bg-surface-2"
      }`,
      prefix: "diff-tree-file-vars",
    },
  );
  return (
    <AppButton
      unstyled
      type="button"
      aria-current={isSelected ? "true" : undefined}
      className={className}
      onClick={onClick}
    >
      {children}
    </AppButton>
  );
}

function DiffFileTree({
  nodes,
  onSelectedDiffFilePathChange,
  selectedDiffFilePath,
}: {
  nodes: DiffFileTreeNode[];
  onSelectedDiffFilePathChange: (path: string) => void;
  selectedDiffFilePath: string | null;
}): JSX.Element {
  // Recursive renderer that increases left padding by depth for visual hierarchy.
  /**
   * Renders nodes.
   * @param currentNodes - currentNodes argument for renderNodes.
   * @param depth - depth argument for renderNodes.
   */
  const renderNodes = (
    currentNodes: DiffFileTreeNode[],
    depth = 0,
  ): JSX.Element[] =>
    currentNodes.map((node) => {
      const path = node.path;

      if (path === null) {
        // Directory nodes only render as labels and recurse into children.
        return (
          <div key={node.key}>
            <DiffTreeDirectoryRow depth={depth}>
              {materialSymbol("folder", "text-sm")}
              <span>{node.label}</span>
            </DiffTreeDirectoryRow>
            <div>{renderNodes(node.children, depth + 1)}</div>
          </div>
        );
      }

      return (
        <DiffTreeFileButton
          key={node.key}
          depth={depth}
          isSelected={selectedDiffFilePath === path}
          onClick={() => {
            // Clicking a leaf file updates the selected diff path for focused viewer.
            onSelectedDiffFilePathChange(path);
          }}
        >
          <div className="min-w-0">
            <div className="truncate font-mono text-[13px] text-text-primary">
              {node.label}
            </div>
            <div className="truncate text-[12px] text-text-muted">{path}</div>
          </div>
        </DiffTreeFileButton>
      );
    });

  return <>{renderNodes(nodes)}</>;
}

type DiffWorkspaceProps = {
  activeSelectedWorktreeFolder: string;
  activeSelectedWorktreeName: string;
  activeSelectedWorktreeOpened: boolean;
  activeSelectedWorktreePath: string | null;
  activeWorktreeChanges: RpcWorktreeChange[];
  diffFilePatchState: DiffFilePatchState;
  diffFileTree: DiffFileTreeNode[];
  gitInitializationError: string;
  gitInitializationState: "idle" | "initializing";
  hasActiveWorktreeSnapshot: boolean;
  isRefreshingWorktreeSnapshot: boolean;
  nonGitRepositoryDeclined: boolean;
  onDeclineGitInitialization: () => void;
  onInitializeGitRepository: () => void;
  onRefresh: () => void;
  onSelectedDiffFilePathChange: (path: string) => void;
  refreshDisabled: boolean;
  selectedDiffFileChange: RpcWorktreeChange | null;
  selectedDiffFilePath: string | null;
  selectedProject: RpcProject | null;
  variant: "desktop" | "mobile";
  worktreeDiffError: string;
};

export function isNonGitRepositoryDiffError(error: string): boolean {
  const normalized = error.toLowerCase();
  return (
    normalized.includes("not a git repository") ||
    normalized.includes("must be run in a work tree") ||
    normalized.includes("worktree not found for project")
  );
}

function diffWorkspaceIds(variant: "desktop" | "mobile") {
  return {
    navigatorHeadingId: `diff-workspace-${variant}-navigator-heading`,
    navigatorRegionId: `diff-workspace-${variant}-navigator-region`,
    viewerHeadingId: `diff-workspace-${variant}-viewer-heading`,
    viewerRegionId: `diff-workspace-${variant}-viewer-region`,
  };
}

/**
 * Worktree diff workspace with file navigation and focused diff viewer.
 * Left column lists changed files, right column displays selected-file metadata and diff.
 */
export function DiffWorkspace({
  activeSelectedWorktreeFolder,
  activeSelectedWorktreeName,
  activeSelectedWorktreeOpened,
  activeSelectedWorktreePath,
  activeWorktreeChanges,
  diffFilePatchState,
  diffFileTree,
  gitInitializationError,
  gitInitializationState,
  hasActiveWorktreeSnapshot,
  isRefreshingWorktreeSnapshot,
  nonGitRepositoryDeclined,
  onDeclineGitInitialization,
  onInitializeGitRepository,
  onRefresh,
  onSelectedDiffFilePathChange,
  refreshDisabled,
  selectedDiffFileChange,
  selectedDiffFilePath,
  selectedProject,
  variant,
  worktreeDiffError,
}: DiffWorkspaceProps): JSX.Element {
  const mobile = variant === "mobile";
  const parsedDiffState = useDiffParseResult(diffFilePatchState.diffText);
  const diffStats = parsedDiffState.result.summary;
  const ids = diffWorkspaceIds(variant);
  const shouldShowNonGitRepositoryState = Boolean(
    worktreeDiffError &&
      !hasActiveWorktreeSnapshot &&
      isNonGitRepositoryDiffError(worktreeDiffError),
  );

  // Left panel renders a single fallback/content state using ordered branches.
  const selectorContent =
    !selectedProject || !activeSelectedWorktreePath ? (
      <div className="border border-border-subtle bg-surface-1 px-4 py-4 text-sm text-text-muted">
        Select a project worktree first.
      </div>
    ) : !activeSelectedWorktreeOpened ? (
      <div className="border border-border-subtle bg-surface-1 px-4 py-4 text-sm text-text-muted">
        Open this worktree from the Projects panel to inspect its live diff.
      </div>
    ) : nonGitRepositoryDeclined && !hasActiveWorktreeSnapshot ? (
      <div className="border border-border-default bg-surface-1 px-4 py-4 text-sm text-text-secondary">
        This is not a git repo, cannot display diff.
      </div>
    ) : shouldShowNonGitRepositoryState ? (
      <div className="border border-border-default bg-surface-1 px-4 py-4 text-sm text-text-secondary">
        <p className="text-text-primary">
          Would you like to make this project {selectedProject.name} a git repo?
        </p>
        {gitInitializationError ? (
          <p className="mt-2 text-xs text-danger-text">
            {gitInitializationError}
          </p>
        ) : null}
        <div className="mt-3 flex items-center gap-2">
          <AppButton
            type="button"
            buttonStyle="primary"
            onClick={onInitializeGitRepository}
            disabled={gitInitializationState === "initializing"}
          >
            {gitInitializationState === "initializing" ? "Initializing" : "Yes"}
          </AppButton>
          <AppButton
            type="button"
            buttonStyle="muted"
            onClick={onDeclineGitInitialization}
            disabled={gitInitializationState === "initializing"}
          >
            No
          </AppButton>
        </div>
      </div>
    ) : isRefreshingWorktreeSnapshot && !hasActiveWorktreeSnapshot ? (
      <div className="border border-border-default bg-surface-2 px-4 py-4 text-sm text-text-secondary">
        Loading worktree diff...
      </div>
    ) : worktreeDiffError && !hasActiveWorktreeSnapshot ? (
      <div className="border border-danger-border bg-danger-surface px-4 py-4 text-sm text-danger-text">
        {worktreeDiffError}
      </div>
    ) : activeWorktreeChanges.length === 0 ? (
      <div className="border border-success-border bg-success-surface px-4 py-4 text-sm text-success-text">
        Worktree clean. No staged or unstaged changes.
      </div>
    ) : (
      <div
        className={`overflow-hidden border border-border-subtle bg-bg-canvas ${
          mobile ? "" : "h-full"
        }`}
      >
        <div
          className={`app-scrollbar overflow-y-auto py-2 ${
            mobile ? "max-h-[22rem]" : "h-full"
          }`}
        >
          <DiffFileTree
            nodes={diffFileTree}
            onSelectedDiffFilePathChange={onSelectedDiffFilePathChange}
            selectedDiffFilePath={selectedDiffFilePath}
          />
        </div>
      </div>
    );

  // Right panel only renders diff content when the focused file selection is valid.
  const contentBody = !selectedDiffFileChange ? (
    <div className="border border-border-subtle bg-surface-1 px-4 py-4 text-sm text-text-muted">
      Select a changed file to inspect its focused diff.
    </div>
  ) : diffFilePatchState.error ? (
    <div className="border border-danger-border bg-danger-surface px-4 py-4 text-sm text-danger-text">
      {diffFilePatchState.error}
    </div>
  ) : diffFilePatchState.isLoading ? (
    <div className="border border-border-default bg-surface-2 px-4 py-4 text-sm text-text-secondary">
      Loading focused diff...
    </div>
  ) : !diffFilePatchState.diffText.trim() ? (
    <div className="border border-border-default bg-surface-1 px-4 py-4 text-sm text-text-secondary">
      No focused diff is available for this change right now.
    </div>
  ) : (
    <DiffViewer
      className={mobile ? "" : "h-full"}
      diffText={diffFilePatchState.diffText}
      parsedDiffState={parsedDiffState}
      scrollable={!mobile}
      {...(!mobile ? { viewportClassName: "h-full" } : {})}
    />
  );

  return (
    <div
      className={
        mobile ? "flex flex-col gap-4" : "flex min-h-0 flex-1 overflow-hidden"
      }
    >
      {/* Desktop layout fixes the tree column width to keep diff text from reflowing. */}
      <section
        aria-labelledby={ids.navigatorHeadingId}
        className={
          mobile
            ? "shrink-0"
            : "flex h-full w-[21rem] shrink-0 flex-col border-r border-border-subtle bg-bg-canvas"
        }
      >
        <div
          className={mobile ? "" : "border-b border-border-subtle px-4 py-4"}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2
                id={ids.navigatorHeadingId}
                className="font-label text-[11px] uppercase tracking-[0.1em] text-accent"
              >
                Worktree Diff
              </h2>
              <div className="mt-2 truncate text-sm font-semibold text-text-primary">
                {selectedProject
                  ? activeSelectedWorktreeName || activeSelectedWorktreeFolder
                  : "No worktree selected"}
                {selectedProject ? (
                  <span className="font-normal text-text-muted">
                    {" - "}
                    {activeSelectedWorktreeFolder}
                  </span>
                ) : null}
              </div>
            </div>
            {/* Keep refresh disabled to avoid overlapping snapshot refresh requests. */}
            <AppButton
              type="button"
              buttonStyle="muted"
              className="font-label text-[11px] uppercase tracking-[0.1em]"
              onClick={onRefresh}
              disabled={refreshDisabled}
            >
              {isRefreshingWorktreeSnapshot ? "Syncing" : "Refresh"}
            </AppButton>
          </div>
          {worktreeDiffError &&
          hasActiveWorktreeSnapshot &&
          !isNonGitRepositoryDiffError(worktreeDiffError) ? (
            <div className="mt-3 border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-text">
              {worktreeDiffError}
            </div>
          ) : null}
        </div>
        <section
          id={ids.navigatorRegionId}
          aria-labelledby={ids.navigatorHeadingId}
          className={mobile ? "" : "min-h-0 flex-1 overflow-hidden px-3 py-3"}
        >
          {selectorContent}
        </section>
      </section>
      <section
        aria-labelledby={ids.viewerHeadingId}
        className={
          mobile
            ? "flex flex-col gap-4"
            : "flex min-w-0 flex-1 flex-col overflow-hidden"
        }
      >
        <div
          className={
            mobile
              ? "border border-border-subtle bg-surface-1 px-4 py-4"
              : "border-b border-border-subtle bg-bg-canvas px-6 py-5"
          }
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2
                id={ids.viewerHeadingId}
                className="font-label text-[11px] uppercase tracking-[0.1em] text-accent"
              >
                Selected File
              </h2>
              <div className="mt-2 truncate font-mono text-sm text-text-primary">
                {selectedDiffFileChange?.path ?? "No file selected"}
              </div>
              {selectedDiffFileChange?.previousPath ? (
                <div className="mt-1 truncate text-[12px] text-text-muted">
                  Previously {selectedDiffFileChange.previousPath}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {selectedDiffFileChange && diffFilePatchState.diffText.trim() ? (
                parsedDiffState.isLoading ? (
                  <span className="border border-border-default bg-surface-2 px-2 py-1 font-label text-[10px] uppercase tracking-[0.1em] text-text-muted">
                    Preparing
                  </span>
                ) : (
                  <span className="border border-border-default bg-surface-2 px-2 py-1 font-label text-[10px] uppercase tracking-[0.1em] text-text-muted">
                    {diffStats.hunks} {diffStats.hunks === 1 ? "Hunk" : "Hunks"}
                  </span>
                )
              ) : null}
            </div>
          </div>
          {selectedDiffFileChange && diffFilePatchState.diffText.trim() ? (
            <div className="mt-3 text-[11px] text-text-muted">
              {parsedDiffState.isLoading
                ? "Preparing diff statistics..."
                : `${diffStats.additions} additions · ${diffStats.deletions} deletions`}
            </div>
          ) : null}
        </div>
        <section
          id={ids.viewerRegionId}
          aria-labelledby={ids.viewerHeadingId}
          className={mobile ? "" : "min-h-0 flex-1 px-6 py-6"}
        >
          {contentBody}
        </section>
      </section>
    </div>
  );
}
