/**
 * @file src/mainview/app/use-project-worktree-controller.ts
 * @description Project/worktree loading and open-state controller extraction.
 */

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type {
  ProjectProcedures,
  RpcProject,
  RpcThread,
  RpcWorktree,
  RpcWorktreeGitHistoryResult,
} from "../../bun/rpc-schema";
import { runRollbackSafeProjectClose } from "../project-close";
import { createProjectLifecycleRequestTracker } from "../project-lifecycle";
import { shouldUseCachedProjectWorktrees } from "../project-worktree-refresh";
import {
  buildMainviewShellOpenedWorktreeHydration,
  buildMainviewShellProjectWorktreeHydration,
  resolveMainviewShellActiveWorktreeHydrationTarget,
  shouldMainviewShellEnsureActiveWorktree,
} from "./mainview-shell-state";
import {
  type ProjectNodeState,
  type WorktreeNodeState,
  type WorktreeStateMap,
  worktreeKey,
} from "./project-worktree-state";
import { setProjectTreeOpen } from "./sidebar-panels-state";

type ProjectWorktreeRequestCacheEntry = {
  lifecycleRequestId: number;
  promise: Promise<RpcWorktree[]>;
};

type ProjectWorktreeControllerProcedures = Pick<
  ProjectProcedures,
  "closeProject" | "listProjectWorktrees" | "openProject" | "openWorktree"
>;

export type ProjectWorktreeControllerProps = {
  activeSelectedWorktreePath: string | null;
  getProjectState: (projectId: number) => ProjectNodeState;
  getWorktreeState: (
    projectId: number,
    worktreePath: string,
  ) => WorktreeNodeState;
  primeGitHistoryResult: (history: RpcWorktreeGitHistoryResult) => void;
  procedures: ProjectWorktreeControllerProcedures;
  selectProject: (project: RpcProject, worktreePath?: string | null) => void;
  selectedProject: RpcProject | null;
  selectedProjectIdRef: MutableRefObject<number | null>;
  selectedThread: RpcThread | null;
  selectedThreadIdRef: MutableRefObject<number | null>;
  selectedWorktreePathRef: MutableRefObject<string | null>;
  sessionStateReady: boolean;
  setProjectState: (
    projectId: number,
    update: Partial<ProjectNodeState>,
  ) => void;
  setSelectedWorktreePath: Dispatch<SetStateAction<string | null>>;
  setThreadsError: Dispatch<SetStateAction<string>>;
  setWorktreeState: (
    projectId: number,
    worktreePath: string,
    update: Partial<WorktreeNodeState>,
  ) => void;
  setWorktreeStates: Dispatch<SetStateAction<WorktreeStateMap>>;
  upsertProject: (project: RpcProject) => void;
};

export function useProjectWorktreeController({
  activeSelectedWorktreePath,
  getProjectState,
  getWorktreeState,
  primeGitHistoryResult,
  procedures,
  selectProject,
  selectedProject,
  selectedProjectIdRef,
  selectedThread,
  selectedThreadIdRef,
  selectedWorktreePathRef,
  sessionStateReady,
  setProjectState,
  setSelectedWorktreePath,
  setThreadsError,
  setWorktreeState,
  setWorktreeStates,
  upsertProject,
}: ProjectWorktreeControllerProps) {
  const projectWorktreeRequestCacheRef = useRef(
    new Map<number, ProjectWorktreeRequestCacheEntry>(),
  );
  const worktreeToggleRequestIdRef = useRef(new Map<string, number>());
  const projectLifecycleRequestTracker = useMemo(
    () => createProjectLifecycleRequestTracker(),
    [],
  );

  useEffect(
    () => () => {
      projectWorktreeRequestCacheRef.current.clear();
      worktreeToggleRequestIdRef.current.clear();
    },
    [],
  );

  const beginWorktreeToggleRequest = useCallback(
    (projectId: number, worktreePath: string) => {
      const key = worktreeKey(projectId, worktreePath);
      const nextRequestId =
        (worktreeToggleRequestIdRef.current.get(key) ?? 0) + 1;
      worktreeToggleRequestIdRef.current.set(key, nextRequestId);
      return {
        key,
        requestId: nextRequestId,
      };
    },
    [],
  );

  const isCurrentWorktreeToggleRequest = useCallback(
    (key: string, requestId: number): boolean =>
      worktreeToggleRequestIdRef.current.get(key) === requestId,
    [],
  );

  const finishWorktreeToggleRequest = useCallback(
    (key: string, requestId: number): void => {
      if (worktreeToggleRequestIdRef.current.get(key) === requestId) {
        worktreeToggleRequestIdRef.current.delete(key);
      }
    },
    [],
  );

  const clearProjectWorktreeToggleRequests = useCallback(
    (projectId: number) => {
      const keyPrefix = `${projectId}::`;
      for (const key of [...worktreeToggleRequestIdRef.current.keys()]) {
        if (key.startsWith(keyPrefix)) {
          worktreeToggleRequestIdRef.current.delete(key);
        }
      }
    },
    [],
  );

  const beginProjectLifecycleRequest = useCallback(
    (projectId: number) => {
      projectWorktreeRequestCacheRef.current.delete(projectId);
      return projectLifecycleRequestTracker.begin(projectId);
    },
    [projectLifecycleRequestTracker],
  );

  const clearProjectLifecycleRequest = useCallback(
    (projectId: number): void => {
      projectWorktreeRequestCacheRef.current.delete(projectId);
      projectLifecycleRequestTracker.clear(projectId);
    },
    [projectLifecycleRequestTracker],
  );

  const snapshotProjectLifecycleRequest = useCallback(
    (projectId: number) => projectLifecycleRequestTracker.snapshot(projectId),
    [projectLifecycleRequestTracker],
  );

  const requestProjectWorktrees = useCallback(
    async (projectId: number): Promise<RpcWorktree[]> => {
      const lifecycleRequest = snapshotProjectLifecycleRequest(projectId);
      const existing = projectWorktreeRequestCacheRef.current.get(projectId);
      if (
        existing &&
        existing.lifecycleRequestId === lifecycleRequest.requestId
      ) {
        return existing.promise;
      }

      const requestEntry: ProjectWorktreeRequestCacheEntry = {
        lifecycleRequestId: lifecycleRequest.requestId,
        promise: procedures
          .listProjectWorktrees({ projectId })
          .then((result) => {
            if (!lifecycleRequest.isCurrent()) {
              return result.worktrees;
            }
            setProjectState(
              projectId,
              buildMainviewShellProjectWorktreeHydration(result.worktrees),
            );
            return result.worktrees;
          })
          .catch((error) => {
            if (lifecycleRequest.isCurrent()) {
              setProjectState(projectId, {
                loadingWorktrees: false,
                error: error instanceof Error ? error.message : String(error),
              });
            }
            throw error;
          })
          .finally(() => {
            if (
              projectWorktreeRequestCacheRef.current.get(projectId) ===
              requestEntry
            ) {
              projectWorktreeRequestCacheRef.current.delete(projectId);
            }
          }),
      };
      projectWorktreeRequestCacheRef.current.set(projectId, requestEntry);
      return requestEntry.promise;
    },
    [procedures, setProjectState, snapshotProjectLifecycleRequest],
  );

  const loadProjectWorktrees = useCallback(
    async (
      projectId: number,
      loadOptions?: {
        backgroundRefresh?: boolean;
        preferCached?: boolean;
      },
    ): Promise<RpcWorktree[]> => {
      const current = getProjectState(projectId);
      if (shouldUseCachedProjectWorktrees(current, loadOptions)) {
        setProjectState(projectId, {
          loadingWorktrees: false,
          error: "",
        });
        if (loadOptions?.backgroundRefresh) {
          void requestProjectWorktrees(projectId).catch(() => {
            // Keep rendering cached worktrees if the background refresh fails.
          });
        }
        return current.worktreePaths
          .map((path) => current.worktreeByPath[path])
          .filter((worktree): worktree is RpcWorktree => Boolean(worktree));
      }

      setProjectState(projectId, {
        loadingWorktrees: true,
        error: "",
      });
      return requestProjectWorktrees(projectId);
    },
    [getProjectState, requestProjectWorktrees, setProjectState],
  );

  const ensureWorktreeOpen = useCallback(
    async (projectId: number, worktreePath: string) => {
      const target = getWorktreeState(projectId, worktreePath);
      if (target.loading || target.opened) {
        return;
      }

      const { key, requestId } = beginWorktreeToggleRequest(
        projectId,
        worktreePath,
      );
      setWorktreeState(projectId, worktreePath, {
        loading: true,
        opened: true,
        error: "",
      });

      try {
        const result = await procedures.openWorktree({
          projectId,
          worktreePath,
        });
        if (!isCurrentWorktreeToggleRequest(key, requestId)) {
          return;
        }
        primeGitHistoryResult(result.history);
        setWorktreeState(projectId, worktreePath, {
          loading: false,
          opened: true,
          snapshot: result.worktree,
          error: "",
        });
        const currentProjectState = getProjectState(projectId);
        setProjectState(
          projectId,
          buildMainviewShellOpenedWorktreeHydration({
            currentProjectState,
            worktreePath,
            worktrees: result.worktrees,
          }),
        );
      } catch (error) {
        if (!isCurrentWorktreeToggleRequest(key, requestId)) {
          return;
        }
        setWorktreeState(projectId, worktreePath, {
          loading: false,
          opened: false,
          snapshot: undefined,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        finishWorktreeToggleRequest(key, requestId);
      }
    },
    [
      beginWorktreeToggleRequest,
      finishWorktreeToggleRequest,
      getProjectState,
      getWorktreeState,
      isCurrentWorktreeToggleRequest,
      primeGitHistoryResult,
      procedures,
      setProjectState,
      setWorktreeState,
    ],
  );

  const refreshProject = useCallback(
    async (project: RpcProject, expanded: boolean) => {
      const lifecycleRequest = beginProjectLifecycleRequest(project.id);
      const current = getProjectState(project.id);
      const hasCachedWorktrees = shouldUseCachedProjectWorktrees(current);
      if (expanded) {
        setProjectTreeOpen(project.path, true);
      }
      setProjectState(project.id, {
        loadingWorktrees: expanded && !hasCachedWorktrees,
        error: "",
      });

      if (!expanded) {
        await runRollbackSafeProjectClose({
          closeProject: async () => {
            await procedures.closeProject({ projectId: project.id });
          },
          commitLocalClose: () => {
            if (!lifecycleRequest.isCurrent()) {
              return;
            }
            clearProjectWorktreeToggleRequests(project.id);
            clearProjectLifecycleRequest(project.id);
            setWorktreeStates((prev) => {
              const next = { ...prev } satisfies WorktreeStateMap;
              const keyPrefix = `${project.id}::`;
              for (const key of Object.keys(next)) {
                if (key.startsWith(keyPrefix)) {
                  delete next[key];
                }
              }
              return next;
            });
            setProjectState(project.id, {
              openWorktrees: new Set(),
              loadingWorktrees: false,
              error: "",
            });
            upsertProject({
              ...project,
              isOpen: 0,
            });
            setProjectTreeOpen(project.path, false);
            if (selectedProjectIdRef.current === project.id) {
              selectedWorktreePathRef.current = project.path;
              setSelectedWorktreePath(project.path);
            }
          },
          onCloseError: (error) => {
            if (!lifecycleRequest.isCurrent()) {
              return;
            }
            setProjectState(project.id, {
              loadingWorktrees: false,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        });
        return;
      }

      if (hasCachedWorktrees) {
        if (!selectedProjectIdRef.current) {
          selectProject(project);
        }
        void procedures
          .openProject({
            projectPath: project.path,
            name: project.name,
          })
          .then((result) => {
            if (!lifecycleRequest.isCurrent()) {
              return;
            }
            upsertProject(result.project);
            setProjectState(
              project.id,
              buildMainviewShellProjectWorktreeHydration(result.worktrees),
            );
          })
          .catch((error) => {
            if (!lifecycleRequest.isCurrent()) {
              return;
            }
            setProjectState(project.id, {
              loadingWorktrees: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return;
      }

      try {
        const result = await procedures.openProject({
          projectPath: project.path,
          name: project.name,
        });
        if (!lifecycleRequest.isCurrent()) {
          return;
        }
        upsertProject(result.project);
        setProjectState(
          project.id,
          buildMainviewShellProjectWorktreeHydration(result.worktrees),
        );
        if (!selectedProjectIdRef.current) {
          selectProject(project);
        }
      } catch (error) {
        if (!lifecycleRequest.isCurrent()) {
          return;
        }
        setProjectState(project.id, {
          loadingWorktrees: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [
      beginProjectLifecycleRequest,
      clearProjectLifecycleRequest,
      clearProjectWorktreeToggleRequests,
      getProjectState,
      procedures,
      selectProject,
      selectedProjectIdRef,
      selectedWorktreePathRef,
      setProjectState,
      setSelectedWorktreePath,
      setWorktreeStates,
      upsertProject,
    ],
  );

  useEffect(() => {
    const targetWorkspace = resolveMainviewShellActiveWorktreeHydrationTarget({
      activeSelectedWorktreePath,
      getWorktreeState,
      selectedProject,
      selectedThread,
      sessionStateReady,
    });
    if (!targetWorkspace) {
      return;
    }

    void (async () => {
      if (!targetWorkspace.projectOpen) {
        try {
          const openedProject = await procedures.openProject(
            {
              projectPath: targetWorkspace.projectPath,
              name: targetWorkspace.projectName,
            },
            {
              priority: "foreground",
            },
          );
          if (selectedThreadIdRef.current !== targetWorkspace.threadId) {
            return;
          }
          upsertProject(openedProject.project);
          setProjectState(
            openedProject.project.id,
            buildMainviewShellProjectWorktreeHydration(openedProject.worktrees),
          );
        } catch (error) {
          if (selectedThreadIdRef.current === targetWorkspace.threadId) {
            setThreadsError(
              error instanceof Error ? error.message : String(error),
            );
          }
          return;
        }
      }

      if (selectedThreadIdRef.current !== targetWorkspace.threadId) {
        return;
      }

      if (
        !shouldMainviewShellEnsureActiveWorktree(
          getProjectState(targetWorkspace.projectId),
        )
      ) {
        return;
      }

      await ensureWorktreeOpen(
        targetWorkspace.projectId,
        targetWorkspace.worktreePath,
      );
    })();
  }, [
    activeSelectedWorktreePath,
    ensureWorktreeOpen,
    getProjectState,
    getWorktreeState,
    procedures,
    selectedProject,
    selectedThread,
    selectedThreadIdRef,
    sessionStateReady,
    setProjectState,
    setThreadsError,
    upsertProject,
  ]);

  return {
    ensureWorktreeOpen,
    loadProjectWorktrees,
    refreshProject,
  };
}
