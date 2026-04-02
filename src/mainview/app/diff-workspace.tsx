import type { JSX, RefObject, UIEvent } from "react";
import type {
  RpcProject,
  RpcWorktreeChange,
  RpcWorktreeChangeStatus,
} from "../../bun/rpc-schema";
import { materialSymbol } from "../controls/icons";
import { formatPathForDisplay } from "./state";

export type DiffFileContentState = {
  chunks: string[];
  error: string;
  isBinary: boolean;
  isLoadingInitial: boolean;
  isLoadingMore: boolean;
  isMissing: boolean;
  loadedBytes: number;
  nextCursor: number | null;
  path: string | null;
  totalBytes: number;
};

export type DiffFileTreeNode = {
  change: RpcWorktreeChange | null;
  children: DiffFileTreeNode[];
  key: string;
  label: string;
  path: string | null;
};

export function emptyDiffFileContentState(
  path: string | null = null,
): DiffFileContentState {
  return {
    chunks: [],
    error: "",
    isBinary: false,
    isLoadingInitial: false,
    isLoadingMore: false,
    isMissing: false,
    loadedBytes: 0,
    nextCursor: null,
    path,
    totalBytes: 0,
  };
}

export function decodeBase64Bytes(value: string): Uint8Array {
  if (!value) {
    return new Uint8Array(0);
  }

  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  desktopDiffContentScrollRef: RefObject<HTMLDivElement | null>;
  diffFileContentState: DiffFileContentState;
  diffFileTree: DiffFileTreeNode[];
  hasActiveWorktreeSnapshot: boolean;
  homeDirectory: string;
  isRefreshingWorktreeSnapshot: boolean;
  mobileDiffContentScrollRef: RefObject<HTMLDivElement | null>;
  onDesktopDiffContentScroll: (event: UIEvent<HTMLDivElement>) => void;
  onMobileDiffContentScroll: (event: UIEvent<HTMLDivElement>) => void;
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
  desktopDiffContentScrollRef,
  diffFileContentState,
  diffFileTree,
  hasActiveWorktreeSnapshot,
  homeDirectory,
  isRefreshingWorktreeSnapshot,
  mobileDiffContentScrollRef,
  onDesktopDiffContentScroll,
  onMobileDiffContentScroll,
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
          className={`overflow-y-auto py-2 hide-scrollbar ${
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
      Select a changed file to inspect its current contents.
    </div>
  ) : diffFileContentState.error ? (
    <div className="border border-[#5c2030] bg-[#2c1117] px-4 py-4 text-sm text-[#ff9db0]">
      {diffFileContentState.error}
    </div>
  ) : diffFileContentState.isLoadingInitial ? (
    <div className="border border-[#283239] bg-[#151b20] px-4 py-4 text-sm text-[#d4e4ef]">
      Streaming file contents...
    </div>
  ) : diffFileContentState.isMissing ? (
    <div className="border border-[#31404a] bg-[#12181c] px-4 py-4 text-sm text-[#cfe0eb]">
      This file no longer exists in the working tree. The diff entry is still
      listed because the change is active.
    </div>
  ) : diffFileContentState.isBinary ? (
    <div className="border border-[#31404a] bg-[#12181c] px-4 py-4 text-sm text-[#cfe0eb]">
      Binary file preview unavailable.
    </div>
  ) : (
    <div
      className={`overflow-hidden border border-[#252f36] bg-[#0c1114] ${
        mobile ? "" : "h-full"
      }`}
    >
      <div
        ref={mobile ? mobileDiffContentScrollRef : desktopDiffContentScrollRef}
        className={`app-scrollbar overflow-auto ${
          mobile ? "max-h-[48vh]" : "h-full"
        }`}
        onScroll={
          mobile ? onMobileDiffContentScroll : onDesktopDiffContentScroll
        }
      >
        {diffFileContentState.chunks.length > 0 ? (
          <pre className="min-w-full whitespace-pre-wrap break-words px-4 py-4 font-mono text-[12px] leading-6 text-[#d4dde4]">
            {diffFileContentState.chunks.map((chunk, index) => (
              <span className="contents" key={`${index}-${chunk.length}`}>
                {chunk}
              </span>
            ))}
          </pre>
        ) : (
          <div className="px-4 py-4 text-sm text-[#8f9aa2]">Empty file.</div>
        )}
        {diffFileContentState.isLoadingMore ? (
          <div className="border-t border-[#252f36] px-4 py-3 text-xs text-[#8f9aa2]">
            Loading more...
          </div>
        ) : diffFileContentState.nextCursor !== null ? (
          <div className="border-t border-[#252f36] px-4 py-3 text-xs text-[#6f7b83]">
            Scroll to load more
          </div>
        ) : null}
      </div>
    </div>
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
              {selectedDiffFileChange ? (
                <span className="border border-[#31404a] bg-[#182025] px-2 py-0.5 font-label text-[9px] uppercase tracking-[0.16em] text-[#8f9aa2]">
                  {formatFileSize(diffFileContentState.totalBytes)}
                </span>
              ) : null}
            </div>
          </div>
          {selectedDiffFileChange &&
          !diffFileContentState.isBinary &&
          !diffFileContentState.isMissing ? (
            <div className="mt-3 text-xs text-[#6f7b83]">
              Loaded {formatFileSize(diffFileContentState.loadedBytes)} of{" "}
              {formatFileSize(diffFileContentState.totalBytes)}
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
