/**
 * Core project entity and project/worktree topology shapes.
 */
export type RpcProject = {
  id: number;
  path: string;
  name: string;
  isOpen: 1 | 0;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  faviconDataUrl?: string | null;
};

export type RpcProjectFavicon = {
  projectId: number;
  dataUrl: string | null;
};

export type RpcWorktree = {
  path: string;
  branch: string | null;
  head: string | null;
  bare: boolean;
  pinnedAt: string | null;
};

export type RpcWorktreeChangeStatus =
  | "added"
  | "copied"
  | "deleted"
  | "modified"
  | "renamed"
  | "unmerged"
  | "untracked";

export type RpcWorktreeChange = {
  path: string;
  previousPath: string | null;
  stagedStatus: RpcWorktreeChangeStatus | null;
  unstagedStatus: RpcWorktreeChangeStatus | null;
};

export type RpcWorktreeSnapshot = {
  path: string;
  changes: RpcWorktreeChange[];
  diff: string[];
  files: string[];
  lastUpdatedAt: string;
};

export type RpcWorktreeFileDiff = {
  projectId: number;
  worktreePath: string;
  path: string;
  diffText: string;
};

export type RpcProjectWorktreesResult = {
  hiddenWorktrees: RpcWorktree[];
  project: RpcProject;
  worktrees: RpcWorktree[];
};

export type RpcOpenProjectRequest = {
  createIfMissing?: boolean;
  initGitIfNeeded?: boolean;
  name?: string | null;
  pinWorktree?: boolean;
  projectPath: string;
};

export type RpcOpenProjectsBatchRequestItem = RpcOpenProjectRequest & {
  projectId: number;
};

export type RpcOpenProjectsBatchResultItem =
  | {
      ok: true;
      projectId: number;
      project: RpcProject;
      worktrees: RpcWorktree[];
    }
  | {
      ok: false;
      projectId: number;
      error: string;
    };

export type RpcOpenWorktreeRequest = {
  projectId: number;
  worktreePath: string;
};

export type RpcOpenWorktreesBatchResultItem =
  | ({
      ok: true;
    } & RpcOpenWorktreeRequest &
      RpcOpenWorktreeResult)
  | ({
      ok: false;
    } & RpcOpenWorktreeRequest & {
        error: string;
      });

export type RpcOpenWorktreeResult = {
  worktree: RpcWorktreeSnapshot;
  history: RpcWorktreeGitHistoryResult;
  project: RpcProject;
  worktrees: RpcWorktree[];
};

export type RpcSetActiveWorktreeResult = {
  success: boolean;
  projectId: number | null;
  worktreePath: string | null;
};

export type RpcHomeDirectoryResult = {
  homeDirectory: string;
  supportsTildePath: boolean;
};

export type RpcDirectorySuggestionsResult = {
  directories: string[];
};

export type RpcProjectSkill = {
  name: string;
  description: string | null;
};

export type RpcCreateWorktreeResult = RpcProjectWorktreesResult & {
  worktreePath: string;
};

export type RpcWorktreeGitHistoryChanged = {
  projectId: number;
  worktreePath: string;
};

export type RpcContextFocusChanged = {
  projectId: number;
  projectPath: string;
  projectName: string;
  worktreePath: string;
  threadId: number | null;
};

export type RpcGitHistoryEntry = {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  committedAt: string;
};

export type RpcWorktreeGitHistorySummary = {
  projectId: number;
  worktreePath: string;
  branch: string | null;
  headHash: string | null;
  headShortHash: string | null;
  lastUpdatedAt: string;
};

export type RpcWorktreeGitHistoryResult = RpcWorktreeGitHistorySummary & {
  entries: RpcGitHistoryEntry[];
  limit: number;
  nextOffset: number | null;
};

export type RpcGitCommitDiffResult = {
  projectId: number;
  worktreePath: string;
  commit: RpcGitHistoryEntry;
  diffText: string;
};

export type RpcWorktreeFileContentPage = {
  projectId: number;
  worktreePath: string;
  path: string;
  cursor: number;
  nextCursor: number | null;
  totalBytes: number;
  chunkBase64: string;
  isBinary: boolean;
  isMissing: boolean;
};
