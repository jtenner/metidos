import type { JSX } from "react";
import type {
  RpcProject,
  RpcWorktreeChange,
  RpcWorktreeChangeStatus,
} from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import { DiffViewer } from "./message-ui";
import { formatPathForDisplay } from "./state";

export type DiffFilePatchState = {
  diffText: string;
  error: string;
  isLoading: boolean;
  path: string | null;
};

export type DiffFileTreeNode = {
  change: RpcWorktreeChange | null;
  children: DiffFileTreeNode[];
  key: string;
  label: string;
  path: string | null;
};

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

    let level = root;
    let currentPath = "";
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (!segment) {
        continue;
      }
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;
      const existing = level.get(segment);
      if (existing) {
        if (isLeaf) {
          existing.path = change.path;
          existing.change = change;
        }
        level = existing.children;
        continue;
      }

      const node: MutableNode = {
        change: isLeaf ? change : null,
        children: new Map<string, MutableNode>(),
        key: currentPath,
        label: segment,
        path: isLeaf ? change.path : null,
      };
      level.set(segment, node);
      level = node.children;
    }
  }

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

function summarizeDiffText(diffText: string): {
  additions: number;
  deletions: number;
  hunks: number;
} {
  let additions = 0;
  let deletions = 0;
  let hunks = 0;

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("@@")) {
      hunks += 1;
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return {
    additions,
    deletions,
    hunks,
  };
}

function worktreeChangeStatusLabel(status: RpcWorktreeChangeStatus): string {
  switch (status) {
    case "added":
      return "Added";
    case "copied":
      return "Copied";
    case "deleted":
      return "Deleted";
    case "modified":
      return "Modified";
    case "renamed":
      return "Renamed";
    case "unmerged":
      return "Conflict";
    case "untracked":
      return "Untracked";
  }
}

function worktreeChangeStatusClassName(
  status: RpcWorktreeChangeStatus,
): string {
  switch (status) {
    case "added":
    case "copied":
    case "untracked":
      return "border-[#244833] bg-[#12251a] text-[#9fe2b1]";
    case "deleted":
      return "border-[#5c2030] bg-[#2c1117] text-[#ff9db0]";
    case "renamed":
      return "border-[#365062] bg-[#16212a] text-[#b7d0e1]";
    case "unmerged":
      return "border-[#6a4b1f] bg-[#2f2312] text-[#f0d79a]";
    case "modified":
      return "border-[#31404a] bg-[#182025] text-[#cfe0eb]";
  }
}

function ChangeStatusBadge({
  label,
  status,
}: {
  label: string;
  status: RpcWorktreeChangeStatus | null;
}): JSX.Element | null {
  if (!status) {
    return null;
  }

  return (
    <span
      className={`border px-2 py-0.5 font-label text-[9px] uppercase tracking-[0.16em] ${worktreeChangeStatusClassName(
        status,
      )}`}
    >
      {label} {worktreeChangeStatusLabel(status)}
    </span>
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
  const renderNodes = (
    currentNodes: DiffFileTreeNode[],
    depth = 0,
  ): JSX.Element[] =>
    currentNodes.map((node) => {
      const path = node.path;

      if (path === null) {
        return (
          <div key={node.key}>
            <div
              className="flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-[#6f7b83]"
              style={{
                paddingLeft: `${12 + depth * 14}px`,
              }}
            >
              {materialSymbol("folder", "text-sm")}
              <span>{node.label}</span>
            </div>
            <div>{renderNodes(node.children, depth + 1)}</div>
          </div>
        );
      }

      return (
        <button
          type="button"
          key={node.key}
          className={`flex w-full items-center justify-between gap-3 border-l px-3 py-2 text-left transition-colors ${
            selectedDiffFilePath === path
              ? "border-[#7eadce] bg-[#182026]"
              : "border-transparent hover:bg-[#171d21]"
          }`}
          style={{
            paddingLeft: `${12 + depth * 14}px`,
          }}
          onClick={() => {
            onSelectedDiffFilePathChange(path);
          }}
        >
          <div className="min-w-0">
            <div className="truncate font-mono text-[13px] text-[#f2f0ef]">
              {node.label}
            </div>
            <div className="truncate text-[11px] text-[#8f9aa2]">{path}</div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <ChangeStatusBadge
              label="Index"
              status={node.change?.stagedStatus ?? null}
            />
            <ChangeStatusBadge
              label="Worktree"
              status={node.change?.unstagedStatus ?? null}
            />
          </div>
        </button>
      );
    });

  return <>{renderNodes(nodes)}</>;
}

type DiffWorkspaceProps = {
  activeSelectedWorktreeFolder: string;
  activeSelectedWorktreeOpened: boolean;
  activeSelectedWorktreePath: string | null;
  activeWorktreeChanges: RpcWorktreeChange[];
  diffFilePatchState: DiffFilePatchState;
  diffFileTree: DiffFileTreeNode[];
  hasActiveWorktreeSnapshot: boolean;
  homeDirectory: string;
  isRefreshingWorktreeSnapshot: boolean;
  onRefresh: () => void;
  onSelectedDiffFilePathChange: (path: string) => void;
  refreshDisabled: boolean;
  selectedDiffFileChange: RpcWorktreeChange | null;
  selectedDiffFilePath: string | null;
  selectedProject: RpcProject | null;
  supportsTildePath: boolean;
  variant: "desktop" | "mobile";
  worktreeDiffError: string;
};

export function DiffWorkspace({
  activeSelectedWorktreeFolder,
  activeSelectedWorktreeOpened,
  activeSelectedWorktreePath,
  activeWorktreeChanges,
  diffFilePatchState,
  diffFileTree,
  hasActiveWorktreeSnapshot,
  homeDirectory,
  isRefreshingWorktreeSnapshot,
  onRefresh,
  onSelectedDiffFilePathChange,
  refreshDisabled,
  selectedDiffFileChange,
  selectedDiffFilePath,
  selectedProject,
  supportsTildePath,
  variant,
  worktreeDiffError,
}: DiffWorkspaceProps): JSX.Element {
  const mobile = variant === "mobile";
  const diffStats = summarizeDiffText(diffFilePatchState.diffText);

  const selectorContent =
    !selectedProject || !activeSelectedWorktreePath ? (
      <div className="border border-[#252f36] bg-[#12181c] px-4 py-4 text-sm text-[#8f9aa2]">
        Select a project worktree first.
      </div>
    ) : !activeSelectedWorktreeOpened ? (
      <div className="border border-[#252f36] bg-[#12181c] px-4 py-4 text-sm text-[#8f9aa2]">
        Open this worktree from the Projects panel to inspect its live diff.
      </div>
    ) : isRefreshingWorktreeSnapshot && !hasActiveWorktreeSnapshot ? (
      <div className="border border-[#283239] bg-[#151b20] px-4 py-4 text-sm text-[#d4e4ef]">
        Loading worktree diff...
      </div>
    ) : worktreeDiffError && !hasActiveWorktreeSnapshot ? (
      <div className="border border-[#5c2030] bg-[#2c1117] px-4 py-4 text-sm text-[#ff9db0]">
        {worktreeDiffError}
      </div>
    ) : activeWorktreeChanges.length === 0 ? (
      <div className="border border-[#244833] bg-[#12251a] px-4 py-4 text-sm text-[#9fe2b1]">
        Worktree clean. No staged or unstaged changes.
      </div>
    ) : (
      <div
        className={`overflow-hidden border border-[#252f36] bg-[#0f1417] ${
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

  const contentBody = !selectedDiffFileChange ? (
    <div className="border border-[#252f36] bg-[#12181c] px-4 py-4 text-sm text-[#8f9aa2]">
      Select a changed file to inspect its focused diff.
    </div>
  ) : diffFilePatchState.error ? (
    <div className="border border-[#5c2030] bg-[#2c1117] px-4 py-4 text-sm text-[#ff9db0]">
      {diffFilePatchState.error}
    </div>
  ) : diffFilePatchState.isLoading ? (
    <div className="border border-[#283239] bg-[#151b20] px-4 py-4 text-sm text-[#d4e4ef]">
      Loading focused diff...
    </div>
  ) : !diffFilePatchState.diffText.trim() ? (
    <div className="border border-[#31404a] bg-[#12181c] px-4 py-4 text-sm text-[#cfe0eb]">
      No focused diff is available for this change right now.
    </div>
  ) : (
    <DiffViewer
      className={mobile ? "" : "h-full"}
      diffText={diffFilePatchState.diffText}
      viewportClassName={mobile ? "max-h-[48vh]" : "h-full"}
    />
  );

  return (
    <div
      className={
        mobile
          ? "flex min-h-0 flex-1 flex-col gap-4"
          : "flex min-h-0 flex-1 overflow-hidden"
      }
    >
      <div
        className={
          mobile
            ? "shrink-0"
            : "flex h-full w-[21rem] shrink-0 flex-col border-r border-[#262626] bg-[#121518]"
        }
      >
        <div className={mobile ? "" : "border-b border-[#262626] px-4 py-4"}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-label text-[10px] uppercase tracking-[0.18em] text-[#8fb5cd]">
                Worktree Diff
              </div>
              <div className="mt-2 text-sm font-semibold text-[#f2f0ef]">
                {activeSelectedWorktreeFolder}
              </div>
              <div className="mt-1 text-xs text-[#8f9aa2]">
                {selectedProject
                  ? formatPathForDisplay(
                      activeSelectedWorktreePath ?? "",
                      homeDirectory,
                      supportsTildePath,
                    )
                  : "No worktree selected"}
              </div>
            </div>
            <button
              type="button"
              className="border border-[#31404a] bg-[#182025] px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-[#cfe0eb] transition-colors hover:bg-[#1e2a31] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onRefresh}
              disabled={refreshDisabled}
            >
              {isRefreshingWorktreeSnapshot ? "Syncing" : "Refresh"}
            </button>
          </div>
          {worktreeDiffError && hasActiveWorktreeSnapshot ? (
            <div className="mt-3 border border-[#5c2030] bg-[#2c1117] px-3 py-2 text-xs text-[#ff9db0]">
              {worktreeDiffError}
            </div>
          ) : null}
        </div>
        <div
          className={mobile ? "" : "min-h-0 flex-1 overflow-hidden px-3 py-3"}
        >
          {selectorContent}
        </div>
      </div>
      <div
        className={
          mobile
            ? "flex min-h-0 flex-1 flex-col gap-4"
            : "flex min-w-0 flex-1 flex-col overflow-hidden"
        }
      >
        <div
          className={
            mobile
              ? "border border-[#252f36] bg-[#12181c] px-4 py-4"
              : "border-b border-[#262626] bg-[#101417] px-6 py-5"
          }
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-label text-[10px] uppercase tracking-[0.18em] text-[#8fb5cd]">
                Selected File
              </div>
              <div className="mt-2 truncate font-mono text-sm text-[#f2f0ef]">
                {selectedDiffFileChange?.path ?? "No file selected"}
              </div>
              {selectedDiffFileChange?.previousPath ? (
                <div className="mt-1 truncate text-xs text-[#8f9aa2]">
                  Previously {selectedDiffFileChange.previousPath}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <ChangeStatusBadge
                label="Index"
                status={selectedDiffFileChange?.stagedStatus ?? null}
              />
              <ChangeStatusBadge
                label="Worktree"
                status={selectedDiffFileChange?.unstagedStatus ?? null}
              />
              {selectedDiffFileChange && diffFilePatchState.diffText.trim() ? (
                <span className="border border-[#31404a] bg-[#182025] px-2 py-0.5 font-label text-[9px] uppercase tracking-[0.16em] text-[#8f9aa2]">
                  {diffStats.hunks} {diffStats.hunks === 1 ? "Hunk" : "Hunks"}
                </span>
              ) : null}
            </div>
          </div>
          {selectedDiffFileChange && diffFilePatchState.diffText.trim() ? (
            <div className="mt-3 text-xs text-[#6f7b83]">
              {diffStats.additions} additions · {diffStats.deletions} deletions
            </div>
          ) : null}
        </div>
        <div className={mobile ? "min-h-0" : "min-h-0 flex-1 px-6 py-6"}>
          {contentBody}
        </div>
      </div>
    </div>
  );
}
