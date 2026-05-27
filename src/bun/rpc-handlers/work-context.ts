import type { RpcRequestHandlerMap } from "../rpc-transport";

export type WorkContextRpcHandlerMap = Pick<
  RpcRequestHandlerMap,
  | "closeProject"
  | "closeWorktree"
  | "createWorktree"
  | "deleteProject"
  | "focusContext"
  | "getHomeDirectory"
  | "getWorktreeGitCommitDiff"
  | "getWorktreeSnapshot"
  | "listDirectorySuggestions"
  | "listProjectFavicons"
  | "listProjectSkills"
  | "listProjectWorktrees"
  | "listProjects"
  | "listWorktreeGitHistory"
  | "openProject"
  | "openProjectsBatch"
  | "openWorktree"
  | "openWorktreesBatch"
  | "readWorktreeFileContentPage"
  | "readWorktreeFileDiff"
  | "setActiveWorktree"
  | "setWorktreePinned"
>;

type WorkContextRpcProcedureDependencies = {
  [Method in keyof WorkContextRpcHandlerMap as `${Method}Procedure`]: WorkContextRpcHandlerMap[Method];
};

export type WorkContextRpcHandlerDependencies = Omit<
  WorkContextRpcProcedureDependencies,
  "getHomeDirectoryProcedure"
> & {
  getHomeDirectoryProcedure: (
    context: Parameters<WorkContextRpcHandlerMap["getHomeDirectory"]>[1],
  ) => ReturnType<WorkContextRpcHandlerMap["getHomeDirectory"]>;
};

export function createWorkContextRpcHandlers({
  closeProjectProcedure,
  closeWorktreeProcedure,
  createWorktreeProcedure,
  deleteProjectProcedure,
  focusContextProcedure,
  getHomeDirectoryProcedure,
  getWorktreeGitCommitDiffProcedure,
  getWorktreeSnapshotProcedure,
  listDirectorySuggestionsProcedure,
  listProjectFaviconsProcedure,
  listProjectSkillsProcedure,
  listProjectWorktreesProcedure,
  listProjectsProcedure,
  listWorktreeGitHistoryProcedure,
  openProjectProcedure,
  openProjectsBatchProcedure,
  openWorktreeProcedure,
  openWorktreesBatchProcedure,
  readWorktreeFileContentPageProcedure,
  readWorktreeFileDiffProcedure,
  setActiveWorktreeProcedure,
  setWorktreePinnedProcedure,
}: WorkContextRpcHandlerDependencies): WorkContextRpcHandlerMap {
  return {
    getHomeDirectory: (_params, context) => getHomeDirectoryProcedure(context),
    listDirectorySuggestions: (params, context) =>
      listDirectorySuggestionsProcedure(params, context),
    listProjects: (params, context) => listProjectsProcedure(params, context),
    listProjectFavicons: (params, context) =>
      listProjectFaviconsProcedure(params, context),
    openProject: (params, context) => openProjectProcedure(params, context),
    openProjectsBatch: (params, context) =>
      openProjectsBatchProcedure(params, context),
    openWorktreesBatch: (params, context) =>
      openWorktreesBatchProcedure(params, context),
    closeProject: (params, context) => closeProjectProcedure(params, context),
    deleteProject: (params, context) => deleteProjectProcedure(params, context),
    listProjectWorktrees: (params, context) =>
      listProjectWorktreesProcedure(params, context),
    createWorktree: (params, context) =>
      createWorktreeProcedure(params, context),
    openWorktree: (params, context) => openWorktreeProcedure(params, context),
    getWorktreeSnapshot: (params, context) =>
      getWorktreeSnapshotProcedure(params, context),
    listProjectSkills: (params, context) =>
      listProjectSkillsProcedure(params, context),
    readWorktreeFileContentPage: (params, context) =>
      readWorktreeFileContentPageProcedure(params, context),
    readWorktreeFileDiff: (params, context) =>
      readWorktreeFileDiffProcedure(params, context),
    setActiveWorktree: (params, context) =>
      setActiveWorktreeProcedure(params, context),
    focusContext: (params, context) => focusContextProcedure(params, context),
    listWorktreeGitHistory: (params, context) =>
      listWorktreeGitHistoryProcedure(params, context),
    getWorktreeGitCommitDiff: (params, context) =>
      getWorktreeGitCommitDiffProcedure(params, context),
    closeWorktree: (params, context) => closeWorktreeProcedure(params, context),
    setWorktreePinned: (params, context) =>
      setWorktreePinnedProcedure(params, context),
  };
}
