import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectProcedures,
  RpcProject,
  RpcRequestPriority,
} from "../../bun/rpc-schema";
import { setProjectTreeOpen } from "./sidebar-panels-state";
import {
  DIRECTORY_SUGGESTION_PREFETCH_DELAY_MS,
  DIRECTORY_SUGGESTION_RESULT_CACHE_MAX_ENTRIES,
  DIRECTORY_SUGGESTION_RESULT_CACHE_TTL_MS,
  type DirectorySuggestionResultCacheEntry,
  type PendingSharedRequest,
  type ProjectNodeState,
  awaitAbortableResult,
  createAbortError,
  formatDirectoryPathForInput,
  isAbortError,
  readLruValue,
  upsertProjectList,
  writeLruValue,
} from "./state";

type UseAddProjectFormParams = {
  getProjectState: (projectId: number) => ProjectNodeState;
  homeDirectory: string;
  hydrateProjectRows: (items: RpcProject[]) => void;
  procedures: ProjectProcedures;
  selectProject: (project: RpcProject, worktreePath?: string | null) => void;
  setMobileProjectListOpen: Dispatch<SetStateAction<boolean>>;
  setProjects: Dispatch<SetStateAction<RpcProject[]>>;
  setProjectState: (
    projectId: number,
    update: Partial<ProjectNodeState>,
  ) => void;
  supportsTildePath: boolean;
};

export function useAddProjectForm({
  getProjectState,
  homeDirectory,
  hydrateProjectRows,
  procedures,
  selectProject,
  setMobileProjectListOpen,
  setProjects,
  setProjectState,
  supportsTildePath,
}: UseAddProjectFormParams) {
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [addProjectPath, setAddProjectPath] = useState("");
  const [addProjectError, setAddProjectError] = useState("");
  const [hoveredDirectorySuggestion, setHoveredDirectorySuggestion] = useState<
    string | null
  >(null);
  const [directorySuggestions, setDirectorySuggestions] = useState<string[]>(
    [],
  );
  const [directorySuggestionsLoading, setDirectorySuggestionsLoading] =
    useState(false);
  const [isAddingProject, setIsAddingProject] = useState(false);

  const directorySuggestionPrefetchTimerRef = useRef<number | null>(null);
  const directorySuggestionResultCacheRef = useRef(
    new Map<string, DirectorySuggestionResultCacheEntry>(),
  );
  const directorySuggestionRequestCacheRef = useRef(
    new Map<string, PendingSharedRequest<string[]>>(),
  );
  const directorySuggestionRequestIdRef = useRef(0);
  const directorySuggestionAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const prefetchedDirectorySuggestionQueriesRef = useRef(new Set<string>());

  const resetAddProjectPath = useCallback(
    (nextPath?: string) => {
      setAddProjectPath(
        formatDirectoryPathForInput(
          nextPath ?? homeDirectory,
          homeDirectory,
          supportsTildePath,
        ),
      );
    },
    [homeDirectory, supportsTildePath],
  );

  const seedAddProjectPath = useCallback(
    (nextHomeDirectory: string, nextSupportsTildePath: boolean) => {
      setAddProjectPath(
        (current) =>
          current ||
          formatDirectoryPathForInput(
            nextHomeDirectory,
            nextHomeDirectory,
            nextSupportsTildePath,
          ),
      );
    },
    [],
  );

  const clearDirectorySuggestionPrefetchTimer = useCallback(() => {
    if (directorySuggestionPrefetchTimerRef.current !== null) {
      window.clearTimeout(directorySuggestionPrefetchTimerRef.current);
      directorySuggestionPrefetchTimerRef.current = null;
    }
  }, []);

  const readCachedDirectorySuggestions = useCallback((query: string) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return null;
    }

    const cached = readLruValue(
      directorySuggestionResultCacheRef.current,
      normalizedQuery,
    );
    if (!cached) {
      return null;
    }

    return {
      directories: cached.directories,
      isStale:
        cached.loadedAt + DIRECTORY_SUGGESTION_RESULT_CACHE_TTL_MS < Date.now(),
    };
  }, []);

  const cacheDirectorySuggestions = useCallback(
    (query: string, directories: string[]) => {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        return;
      }

      writeLruValue(
        directorySuggestionResultCacheRef.current,
        normalizedQuery,
        {
          directories,
          loadedAt: Date.now(),
        },
        DIRECTORY_SUGGESTION_RESULT_CACHE_MAX_ENTRIES,
      );
      prefetchedDirectorySuggestionQueriesRef.current.add(normalizedQuery);
    },
    [],
  );

  const abortDirectorySuggestionRequest = useCallback((reason: string) => {
    const controller = directorySuggestionAbortControllerRef.current;
    if (!controller) {
      return;
    }

    directorySuggestionAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

  const fetchDirectorySuggestions = useCallback(
    async (
      query: string,
      options?: {
        forceRefresh?: boolean | undefined;
        priority?: RpcRequestPriority;
        signal?: AbortSignal;
      },
    ): Promise<string[]> => {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        return [];
      }

      const cached = readCachedDirectorySuggestions(normalizedQuery);
      if (cached && !cached.isStale && !options?.forceRefresh) {
        return cached.directories;
      }

      const inFlight =
        directorySuggestionRequestCacheRef.current.get(normalizedQuery);
      if (inFlight) {
        inFlight.waiterCount += 1;
        try {
          return await awaitAbortableResult(
            inFlight.promise,
            options?.signal,
            "Directory suggestion request was aborted.",
          );
        } finally {
          inFlight.waiterCount = Math.max(0, inFlight.waiterCount - 1);
          if (
            inFlight.waiterCount === 0 &&
            directorySuggestionRequestCacheRef.current.get(normalizedQuery) ===
              inFlight
          ) {
            inFlight.controller.abort(
              createAbortError(
                null,
                "Directory suggestion request was aborted.",
              ),
            );
          }
        }
      }

      const controller = new AbortController();
      const pendingRequest: PendingSharedRequest<string[]> = {
        controller,
        promise: Promise.resolve([]),
        waiterCount: 1,
      };
      const request = procedures
        .listDirectorySuggestions(
          { query: normalizedQuery },
          {
            priority: options?.priority ?? "foreground",
            signal: controller.signal,
          },
        )
        .then((result) => {
          cacheDirectorySuggestions(normalizedQuery, result.directories);
          return result.directories;
        })
        .finally(() => {
          directorySuggestionRequestCacheRef.current.delete(normalizedQuery);
        });
      pendingRequest.promise = request;
      directorySuggestionRequestCacheRef.current.set(
        normalizedQuery,
        pendingRequest,
      );

      try {
        return await awaitAbortableResult(
          request,
          options?.signal,
          "Directory suggestion request was aborted.",
        );
      } finally {
        pendingRequest.waiterCount = Math.max(
          0,
          pendingRequest.waiterCount - 1,
        );
        if (
          pendingRequest.waiterCount === 0 &&
          directorySuggestionRequestCacheRef.current.get(normalizedQuery) ===
            pendingRequest
        ) {
          controller.abort(
            createAbortError(null, "Directory suggestion request was aborted."),
          );
        }
      }
    },
    [cacheDirectorySuggestions, procedures, readCachedDirectorySuggestions],
  );

  const prefetchDirectorySuggestions = useCallback(
    async (query: string) => {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        return;
      }
      if (
        prefetchedDirectorySuggestionQueriesRef.current.has(normalizedQuery)
      ) {
        return;
      }

      prefetchedDirectorySuggestionQueriesRef.current.add(normalizedQuery);
      try {
        await fetchDirectorySuggestions(normalizedQuery, {
          priority: "background",
        });
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        prefetchedDirectorySuggestionQueriesRef.current.delete(normalizedQuery);
      }
    },
    [fetchDirectorySuggestions],
  );

  const scheduleDirectorySuggestionPrefetch = useCallback(
    (directory: string) => {
      const prefetchQuery = formatDirectoryPathForInput(
        directory,
        homeDirectory,
        supportsTildePath,
      );
      if (!prefetchQuery.trim()) {
        return;
      }
      if (
        prefetchedDirectorySuggestionQueriesRef.current.has(
          prefetchQuery.trim(),
        )
      ) {
        return;
      }

      clearDirectorySuggestionPrefetchTimer();
      directorySuggestionPrefetchTimerRef.current = window.setTimeout(() => {
        directorySuggestionPrefetchTimerRef.current = null;
        void prefetchDirectorySuggestions(prefetchQuery);
      }, DIRECTORY_SUGGESTION_PREFETCH_DELAY_MS);
    },
    [
      clearDirectorySuggestionPrefetchTimer,
      homeDirectory,
      prefetchDirectorySuggestions,
      supportsTildePath,
    ],
  );

  const closeAddProjectForm = useCallback(() => {
    setAddProjectOpen(false);
    setAddProjectError("");
    resetAddProjectPath();
  }, [resetAddProjectPath]);

  const toggleAddProjectForm = useCallback(() => {
    setAddProjectError("");
    setAddProjectOpen((current) => {
      const nextOpen = !current;
      if (nextOpen && !addProjectPath && homeDirectory) {
        setAddProjectPath(
          formatDirectoryPathForInput(
            homeDirectory,
            homeDirectory,
            supportsTildePath,
          ),
        );
      }
      return nextOpen;
    });
  }, [addProjectPath, homeDirectory, supportsTildePath]);

  const openProjectFromInput = useCallback(
    async (projectPathInput: string) => {
      if (isAddingProject) {
        return;
      }

      const projectPath = projectPathInput.trim();
      if (!projectPath) {
        setAddProjectError("Enter the project folder path.");
        return;
      }

      setIsAddingProject(true);
      setAddProjectError("");
      try {
        const result = await procedures.openProject({ projectPath });
        const existingState = getProjectState(result.project.id);
        setProjects((prev) => upsertProjectList(prev, result.project));
        hydrateProjectRows([result.project]);
        setProjectState(result.project.id, {
          loadingWorktrees: false,
          error: "",
          worktrees: result.worktrees,
          openWorktrees: existingState.openWorktrees,
        });
        setProjectTreeOpen(result.project.path, true);
        selectProject(result.project, result.project.path);
        resetAddProjectPath();
        setAddProjectOpen(false);
        setMobileProjectListOpen(false);
      } catch (error) {
        setAddProjectError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsAddingProject(false);
      }
    },
    [
      getProjectState,
      hydrateProjectRows,
      isAddingProject,
      procedures,
      resetAddProjectPath,
      selectProject,
      setMobileProjectListOpen,
      setProjects,
      setProjectState,
    ],
  );

  const selectDirectorySuggestion = useCallback(
    (directory: string) => {
      const formattedDirectory = formatDirectoryPathForInput(
        directory,
        homeDirectory,
        supportsTildePath,
      );
      setAddProjectError("");
      setHoveredDirectorySuggestion(null);
      setAddProjectPath(formattedDirectory);
    },
    [homeDirectory, supportsTildePath],
  );

  const handleAddProjectPathChange = useCallback((value: string) => {
    setAddProjectError("");
    setHoveredDirectorySuggestion(null);
    setAddProjectPath(value);
  }, []);

  const handleDirectorySuggestionEnter = useCallback(
    (directory: string) => {
      setHoveredDirectorySuggestion(directory);
      scheduleDirectorySuggestionPrefetch(directory);
    },
    [scheduleDirectorySuggestionPrefetch],
  );

  const handleDirectorySuggestionLeave = useCallback(
    (directory: string) => {
      setHoveredDirectorySuggestion((current) =>
        current === directory ? null : current,
      );
      clearDirectorySuggestionPrefetchTimer();
    },
    [clearDirectorySuggestionPrefetchTimer],
  );

  const submitAddProject = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await openProjectFromInput(addProjectPath);
    },
    [addProjectPath, openProjectFromInput],
  );

  const hoveredDirectorySuggestionPath = useMemo(
    () =>
      hoveredDirectorySuggestion
        ? formatDirectoryPathForInput(
            hoveredDirectorySuggestion,
            homeDirectory,
            supportsTildePath,
          )
        : "",
    [homeDirectory, hoveredDirectorySuggestion, supportsTildePath],
  );
  const displayedAddProjectPath =
    hoveredDirectorySuggestionPath || addProjectPath;
  const addProjectInputIsPreviewing = hoveredDirectorySuggestionPath.length > 0;

  useEffect(() => {
    return () => {
      abortDirectorySuggestionRequest(
        "Directory suggestion request was canceled.",
      );
    };
  }, [abortDirectorySuggestionRequest]);

  useEffect(() => {
    if (!addProjectOpen) {
      directorySuggestionRequestIdRef.current += 1;
      abortDirectorySuggestionRequest(
        "Directory suggestion request was cleared.",
      );
      setDirectorySuggestions([]);
      setDirectorySuggestionsLoading(false);
      setHoveredDirectorySuggestion(null);
      clearDirectorySuggestionPrefetchTimer();
      return;
    }

    const query = addProjectPath.trim();
    if (!query) {
      directorySuggestionRequestIdRef.current += 1;
      abortDirectorySuggestionRequest(
        "Directory suggestion request was cleared.",
      );
      setDirectorySuggestions([]);
      setDirectorySuggestionsLoading(false);
      clearDirectorySuggestionPrefetchTimer();
      return;
    }

    const requestId = ++directorySuggestionRequestIdRef.current;
    abortDirectorySuggestionRequest(
      "Directory suggestion request was superseded.",
    );
    const controller = new AbortController();
    directorySuggestionAbortControllerRef.current = controller;
    const cached = readCachedDirectorySuggestions(query);
    if (cached) {
      setDirectorySuggestions(cached.directories);
      setDirectorySuggestionsLoading(cached.isStale);
    } else {
      setDirectorySuggestions([]);
      setDirectorySuggestionsLoading(true);
    }
    void (async () => {
      try {
        const directories = await fetchDirectorySuggestions(query, {
          ...(cached ? { forceRefresh: cached.isStale } : {}),
          priority: "foreground",
          signal: controller.signal,
        });
        if (directorySuggestionRequestIdRef.current === requestId) {
          setDirectorySuggestions(directories);
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        if (directorySuggestionRequestIdRef.current === requestId) {
          setDirectorySuggestions([]);
        }
      } finally {
        if (directorySuggestionAbortControllerRef.current === controller) {
          directorySuggestionAbortControllerRef.current = null;
        }
        if (directorySuggestionRequestIdRef.current === requestId) {
          setDirectorySuggestionsLoading(false);
        }
      }
    })();

    return () => {
      directorySuggestionRequestIdRef.current += 1;
      if (directorySuggestionAbortControllerRef.current === controller) {
        directorySuggestionAbortControllerRef.current = null;
      }
      controller.abort(
        createAbortError(null, "Directory suggestion request was superseded."),
      );
    };
  }, [
    addProjectOpen,
    addProjectPath,
    abortDirectorySuggestionRequest,
    clearDirectorySuggestionPrefetchTimer,
    fetchDirectorySuggestions,
    readCachedDirectorySuggestions,
  ]);

  return {
    addProjectError,
    addProjectInputIsPreviewing,
    addProjectOpen,
    addProjectPath,
    clearDirectorySuggestionPrefetchTimer,
    closeAddProjectForm,
    directorySuggestions,
    directorySuggestionsLoading,
    displayedAddProjectPath,
    handleAddProjectPathChange,
    handleDirectorySuggestionEnter,
    handleDirectorySuggestionLeave,
    hoveredDirectorySuggestion,
    isAddingProject,
    openProjectFromInput,
    prefetchDirectorySuggestions,
    resetAddProjectPath,
    seedAddProjectPath,
    scheduleDirectorySuggestionPrefetch,
    selectDirectorySuggestion,
    submitAddProject,
    toggleAddProjectForm,
  };
}
