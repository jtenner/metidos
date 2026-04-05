/**
 * @file src/mainview/project-lifecycle.ts
 * @description Module for project lifecycle.
 */

export type ProjectLifecycleRequest = {
  isCurrent: () => boolean;
  projectId: number;
  requestId: number;
};

/**
 * Tracks the newest lifecycle transition requested for each project so late
 * expand/close/worktree-refresh completions can be ignored.
 */
export function createProjectLifecycleRequestTracker(): {
  begin: (projectId: number) => ProjectLifecycleRequest;
  snapshot: (projectId: number) => ProjectLifecycleRequest;
} {
  const requestIds = new Map<number, number>();

  /**
   * Builds request.
   * @param projectId - Project identifier.
   * @param requestId - requestId identifier.
   */
  const buildRequest = (
    projectId: number,
    requestId: number,
  ): ProjectLifecycleRequest => ({
    isCurrent: () => (requestIds.get(projectId) ?? 0) === requestId,
    projectId,
    requestId,
  });

  return {
    begin: (projectId) => {
      const nextRequestId = (requestIds.get(projectId) ?? 0) + 1;
      requestIds.set(projectId, nextRequestId);
      return buildRequest(projectId, nextRequestId);
    },
    snapshot: (projectId) =>
      buildRequest(projectId, requestIds.get(projectId) ?? 0),
  };
}
