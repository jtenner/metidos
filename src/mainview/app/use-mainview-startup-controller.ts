/**
 * @file src/mainview/app/use-mainview-startup-controller.ts
 * @description Startup restore controller for mainview project/worktree/thread state.
 */

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type {
  ProjectProcedures,
  RpcModelCatalog,
  RpcPluginAccessGroupOption,
  RpcProject,
  RpcThread,
  RpcThreadPermissionDescriptor,
  RpcWorktree,
  RpcWorktreeGitHistoryResult,
} from "../../bun/rpc-schema";
import { buildLoadedProjectWorktreesState } from "../project-worktree-refresh";
import {
  closeProjectsForStartupRestore,
  collectStartupRestoreProjectIds,
  reconcileStartupProjectRestore,
} from "../startup-project-restore";
import {
  filterStartupWorktreeRestoreRequests,
  reconcileStartupSelectedWorktreePath,
} from "../startup-worktree-restore";
import {
  consumeMainviewHtmlBootstrapPayload,
  isMainviewHtmlBootstrapStale,
} from "./html-bootstrap";
import { formatDirectoryPathForInput } from "./path-display-state";
import type { PersistedMainviewState } from "./persisted-mainview-state";
import { pickInitialThread } from "./persisted-thread-state";
import {
  buildProjectWorktreeIndex,
  defaultProjectState,
  type ProjectNodeState,
  type ProjectStateMap,
  projectStateWorktrees,
  type WorktreeNodeState,
  worktreeKey,
} from "./project-worktree-state";
import {
  readSidebarPanelsSnapshot,
  setProjectTreeOpen,
} from "./sidebar-panels-state";
import { createThreadStore, threadStoreItems } from "./thread-store";
import type { OpenThreadOptions } from "./thread-ui-state";

type MainviewStartupBootstrapResult = Awaited<
  ReturnType<ProjectProcedures["getAppBootstrap"]>
>;

type MainviewStartupBootstrapRequest = {
  procedures: Pick<ProjectProcedures, "getAppBootstrap">;
  persistedState: Pick<
    PersistedMainviewState,
    "selectedProjectId" | "selectedWorktreePath" | "selectedThreadId"
  >;
};

export async function loadMainviewStartupBootstrap({
  procedures,
  persistedState,
}: MainviewStartupBootstrapRequest): Promise<MainviewStartupBootstrapResult> {
  const bootstrapParams = {
    selectedProjectId: persistedState.selectedProjectId,
    selectedWorktreePath: persistedState.selectedWorktreePath,
    threadIdHint: persistedState.selectedThreadId,
  };
  const inlineBootstrap = consumeMainviewHtmlBootstrapPayload();
  const bootstrapResult =
    inlineBootstrap?.data ??
    (await procedures.getAppBootstrap(bootstrapParams, {
      priority: "foreground",
    }));
  if (inlineBootstrap && isMainviewHtmlBootstrapStale(inlineBootstrap)) {
    void procedures.getAppBootstrap(bootstrapParams, {
      priority: "background",
    });
  }
  return bootstrapResult;
}

type MainviewStartupControllerProps = {
  applyModelCatalog: (modelCatalog: RpcModelCatalog) => void;
  getProjectState: (projectId: number) => ProjectNodeState;
  hydrateProjectRows: (items: RpcProject[]) => void;
  initialMainviewState: PersistedMainviewState;
  openThread: (threadId: number, options?: OpenThreadOptions) => Promise<void>;
  prefetchDirectorySuggestions: (query: string) => Promise<void>;
  primeGitHistoryResult: (history: RpcWorktreeGitHistoryResult) => void;
  procedures: ProjectProcedures;
  replaceProjects: (items: RpcProject[]) => void;
  replaceThreads: (items: RpcThread[]) => void;
  seedAddProjectPath: (
    nextHomeDirectory: string,
    nextSupportsTildePath: boolean,
  ) => void;
  selectedProjectIdRef: MutableRefObject<number | null>;
  selectedWorktreePathRef: MutableRefObject<string | null>;
  setAvailablePluginAccessGroups: Dispatch<
    SetStateAction<RpcPluginAccessGroupOption[]>
  >;
  setAvailableThreadPermissionDescriptors: Dispatch<
    SetStateAction<RpcThreadPermissionDescriptor[]>
  >;
  setHomeDirectory: Dispatch<SetStateAction<string>>;
  setProjectState: (
    projectId: number,
    update: Partial<ProjectNodeState>,
  ) => void;
  setProjectStates: Dispatch<SetStateAction<ProjectStateMap>>;
  setSelectedProjectId: Dispatch<SetStateAction<number | null>>;
  setSelectedWorktreePath: Dispatch<SetStateAction<string | null>>;
  setSessionStateReady: Dispatch<SetStateAction<boolean>>;
  setSupportsTildePath: Dispatch<SetStateAction<boolean>>;
  setThreadsError: Dispatch<SetStateAction<string>>;
  setWorktreeState: (
    projectId: number,
    worktreePath: string,
    update: Partial<WorktreeNodeState>,
  ) => void;
};

function isThreadNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("Thread not found:");
}

export function useMainviewStartupController({
  applyModelCatalog,
  getProjectState,
  hydrateProjectRows,
  initialMainviewState,
  openThread,
  prefetchDirectorySuggestions,
  primeGitHistoryResult,
  procedures,
  replaceProjects,
  replaceThreads,
  seedAddProjectPath,
  selectedProjectIdRef,
  selectedWorktreePathRef,
  setAvailablePluginAccessGroups,
  setAvailableThreadPermissionDescriptors,
  setHomeDirectory,
  setProjectState,
  setProjectStates,
  setSelectedProjectId,
  setSelectedWorktreePath,
  setSessionStateReady,
  setSupportsTildePath,
  setThreadsError,
  setWorktreeState,
}: MainviewStartupControllerProps): void {
  const initializedRef = useRef(false);
  const initializeRef = useRef<(() => Promise<void>) | null>(null);

  const initialize = useCallback(async () => {
    const persistedState = initialMainviewState;
    const initiallyOpenProjectTreePaths =
      readSidebarPanelsSnapshot().openProjectPaths;

    try {
      const bootstrapResult = await loadMainviewStartupBootstrap({
        persistedState,
        procedures,
      });
      const {
        homeDirectory: homeDirectoryResult,
        modelCatalog,
        pluginAccessGroups,
        threadPermissionDescriptors,
        projects: loadedProjects,
        pinnedWorktrees,
        threadDetail: bootstrapThreadDetail,
        threads: loadedThreads,
      } = bootstrapResult;
      let startupThreads = threadStoreItems(createThreadStore(loadedThreads));
      const initialThread = pickInitialThread(startupThreads, persistedState);
      const initialProjectId =
        initialThread?.projectId ?? persistedState.selectedProjectId ?? null;
      const restoredOpenProjectIds = collectStartupRestoreProjectIds({
        initialProjectId,
        initialThreadProjectId: initialThread?.projectId ?? null,
        initiallyOpenProjectTreePaths,
        loadedProjects,
        openWorktrees: persistedState.openWorktrees,
        selectedProjectId: persistedState.selectedProjectId,
      });
      const startupProjects = closeProjectsForStartupRestore(loadedProjects);
      const initialThreadProject =
        initialThread === null
          ? undefined
          : startupProjects.find(
              (project) => project.id === initialThread.projectId,
            );
      const initialProject =
        initialThreadProject ??
        startupProjects.find(
          (project) => project.id === persistedState.selectedProjectId,
        ) ??
        startupProjects[0] ??
        null;
      const initialWorktreePath =
        initialThread?.worktreePath ??
        (initialProject === null
          ? null
          : initialProject.id === persistedState.selectedProjectId &&
              persistedState.selectedWorktreePath
            ? persistedState.selectedWorktreePath
            : initialProject.path);

      replaceProjects(startupProjects);
      replaceThreads(startupThreads);
      applyModelCatalog(modelCatalog);
      setAvailablePluginAccessGroups(pluginAccessGroups);
      setAvailableThreadPermissionDescriptors(threadPermissionDescriptors);
      hydrateProjectRows(loadedProjects);
      if (pinnedWorktrees.length > 0) {
        setProjectStates((prev) => {
          const next = { ...prev } satisfies ProjectStateMap;
          const pinnedByProjectId = new Map<number, RpcWorktree[]>();
          for (const entry of pinnedWorktrees) {
            const worktrees = pinnedByProjectId.get(entry.projectId) ?? [];
            worktrees.push(entry.worktree);
            pinnedByProjectId.set(entry.projectId, worktrees);
          }

          for (const [projectId, worktrees] of pinnedByProjectId) {
            const current = next[projectId] ?? defaultProjectState();
            const indexedPinnedWorktrees = buildProjectWorktreeIndex(worktrees);
            next[projectId] = {
              ...current,
              worktreeByPath: {
                ...current.worktreeByPath,
                ...indexedPinnedWorktrees.worktreeByPath,
              },
              worktreePaths: Array.from(
                new Set([
                  ...current.worktreePaths,
                  ...indexedPinnedWorktrees.worktreePaths,
                ]),
              ),
            };
          }
          return next;
        });
      }
      setHomeDirectory(homeDirectoryResult.homeDirectory);
      setSupportsTildePath(homeDirectoryResult.supportsTildePath);
      seedAddProjectPath(
        homeDirectoryResult.homeDirectory,
        homeDirectoryResult.supportsTildePath,
      );
      selectedProjectIdRef.current = initialProject?.id ?? null;
      selectedWorktreePathRef.current = initialWorktreePath;
      setSelectedProjectId(initialProject?.id ?? null);
      setSelectedWorktreePath(initialWorktreePath);

      const startupDirectoryPrefetchQuery =
        homeDirectoryResult.supportsTildePath
          ? "~/"
          : formatDirectoryPathForInput(
              homeDirectoryResult.homeDirectory,
              homeDirectoryResult.homeDirectory,
              homeDirectoryResult.supportsTildePath,
            );
      void prefetchDirectorySuggestions(startupDirectoryPrefetchQuery);

      const startupWorktreesToOpen = new Map<
        string,
        {
          projectId: number;
          worktreePath: string;
        }
      >();
      for (const entry of persistedState.openWorktrees) {
        if (!restoredOpenProjectIds.has(entry.projectId)) {
          continue;
        }
        startupWorktreesToOpen.set(
          worktreeKey(entry.projectId, entry.worktreePath),
          entry,
        );
      }
      if (initialThread) {
        startupWorktreesToOpen.set(
          worktreeKey(initialThread.projectId, initialThread.worktreePath),
          {
            projectId: initialThread.projectId,
            worktreePath: initialThread.worktreePath,
          },
        );
      }

      await Promise.resolve();

      const initialThreadOpenPromise = initialThread
        ? openThread(initialThread.id, {
            detailPromise:
              bootstrapThreadDetail?.thread.id === initialThread.id
                ? Promise.resolve(bootstrapThreadDetail)
                : procedures
                    .getThread(
                      {
                        threadId: initialThread.id,
                      },
                      {
                        priority: "foreground",
                      },
                    )
                    .catch((error) => {
                      if (isThreadNotFoundError(error)) {
                        startupThreads = startupThreads.filter(
                          (thread) => thread.id !== initialThread.id,
                        );
                        replaceThreads(startupThreads);
                      }
                      throw error;
                    }),
          })
        : null;

      const restoredProjects = startupProjects.filter((project) =>
        restoredOpenProjectIds.has(project.id),
      );

      for (const project of restoredProjects) {
        setProjectState(project.id, {
          loadingWorktrees:
            initiallyOpenProjectTreePaths.has(project.path) &&
            projectStateWorktrees(getProjectState(project.id)).length === 0,
          error: "",
        });
      }

      let startupProjectsAfterRestore = startupProjects;
      const restoredProjectWorktreesById = new Map<number, RpcWorktree[]>();
      const preliminaryWorktreesToRestore =
        filterStartupWorktreeRestoreRequests(
          [...startupWorktreesToOpen.values()],
          restoredOpenProjectIds,
        );
      const restoredOpenWorktreesPromise =
        preliminaryWorktreesToRestore.length > 0
          ? procedures.openWorktreesBatch(
              {
                worktrees: preliminaryWorktreesToRestore,
              },
              {
                priority: "foreground",
              },
            )
          : Promise.resolve([]);
      if (restoredProjects.length > 0) {
        const restoredProjectResults = await procedures.openProjectsBatch(
          {
            projects: restoredProjects.map((project) => ({
              projectId: project.id,
              projectPath: project.path,
              name: project.name,
            })),
          },
          {
            priority: "foreground",
          },
        );
        const reconciledRestore = reconcileStartupProjectRestore({
          allowSelectedProjectFallback: initialThread === null,
          projects: startupProjects,
          results: restoredProjectResults,
          selectedProjectId: selectedProjectIdRef.current,
          selectedWorktreePath: selectedWorktreePathRef.current,
        });
        startupProjectsAfterRestore = reconciledRestore.projects;
        replaceProjects(reconciledRestore.projects);
        for (const path of reconciledRestore.failedProjectPaths) {
          setProjectTreeOpen(path, false);
        }
        if (
          reconciledRestore.selectedProjectId !==
            selectedProjectIdRef.current ||
          reconciledRestore.selectedWorktreePath !==
            selectedWorktreePathRef.current
        ) {
          selectedProjectIdRef.current = reconciledRestore.selectedProjectId;
          selectedWorktreePathRef.current =
            reconciledRestore.selectedWorktreePath;
          setSelectedProjectId(reconciledRestore.selectedProjectId);
          setSelectedWorktreePath(reconciledRestore.selectedWorktreePath);
        }
        for (const result of restoredProjectResults) {
          if (result.ok) {
            restoredProjectWorktreesById.set(
              result.project.id,
              result.worktrees,
            );
            setProjectState(
              result.project.id,
              buildLoadedProjectWorktreesState(result.worktrees),
            );
            continue;
          }

          setProjectState(result.projectId, {
            loadingWorktrees: false,
            error: result.error,
          });
        }
      }

      const confirmedRestoredOpenProjectIds = new Set(
        startupProjectsAfterRestore
          .filter((project) => project.isOpen === 1)
          .map((project) => project.id),
      );
      const restoredOpenWorktrees = (await restoredOpenWorktreesPromise).filter(
        (result) => confirmedRestoredOpenProjectIds.has(result.projectId),
      );

      for (const result of restoredOpenWorktrees) {
        if (result.ok) {
          setProjectState(
            result.projectId,
            buildLoadedProjectWorktreesState(result.worktrees),
          );
          primeGitHistoryResult(result.history);
          setWorktreeState(result.projectId, result.worktreePath, {
            loading: false,
            opened: true,
            snapshot: result.worktree,
            error: "",
          });
          continue;
        }

        setWorktreeState(result.projectId, result.worktreePath, {
          loading: false,
          opened: false,
          snapshot: undefined,
          error: result.error,
        });
      }

      if (restoredOpenWorktrees.some((result) => result.ok)) {
        setProjectStates((prev) => {
          const next = { ...prev } satisfies ProjectStateMap;
          for (const result of restoredOpenWorktrees) {
            if (!result.ok) {
              continue;
            }
            const current = next[result.projectId] ?? defaultProjectState();
            next[result.projectId] = {
              ...current,
              openWorktrees: new Set([
                ...current.openWorktrees,
                result.worktreePath,
              ]),
            };
          }
          return next;
        });
      }

      const selectedProjectAfterRestore =
        selectedProjectIdRef.current === null
          ? null
          : (startupProjectsAfterRestore.find(
              (project) => project.id === selectedProjectIdRef.current,
            ) ?? null);
      const selectedProjectWorktreesAfterRestore =
        selectedProjectAfterRestore === null
          ? []
          : (restoredProjectWorktreesById.get(selectedProjectAfterRestore.id) ??
            projectStateWorktrees(
              getProjectState(selectedProjectAfterRestore.id),
            ));
      const reconciledSelectedWorktreePath =
        reconcileStartupSelectedWorktreePath({
          allowFallback: initialThread === null,
          project: selectedProjectAfterRestore,
          restoredOpenWorktrees,
          selectedWorktreePath: selectedWorktreePathRef.current,
          worktrees: selectedProjectWorktreesAfterRestore,
        });
      if (reconciledSelectedWorktreePath !== selectedWorktreePathRef.current) {
        selectedWorktreePathRef.current = reconciledSelectedWorktreePath;
        setSelectedWorktreePath(reconciledSelectedWorktreePath);
      }

      if (initialThread) {
        await initialThreadOpenPromise;
        return;
      }
    } catch (error) {
      setThreadsError(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionStateReady(true);
    }
  }, [
    applyModelCatalog,
    getProjectState,
    hydrateProjectRows,
    initialMainviewState,
    openThread,
    prefetchDirectorySuggestions,
    primeGitHistoryResult,
    procedures,
    replaceProjects,
    replaceThreads,
    seedAddProjectPath,
    selectedProjectIdRef,
    selectedWorktreePathRef,
    setAvailablePluginAccessGroups,
    setAvailableThreadPermissionDescriptors,
    setHomeDirectory,
    setProjectState,
    setProjectStates,
    setSelectedProjectId,
    setSelectedWorktreePath,
    setSessionStateReady,
    setSupportsTildePath,
    setThreadsError,
    setWorktreeState,
  ]);

  useEffect(() => {
    initializeRef.current = initialize;
  }, [initialize]);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }

    initializedRef.current = true;
    void initializeRef.current?.();
  }, []);
}
