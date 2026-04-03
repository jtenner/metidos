import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectProcedures,
  RpcProject,
  RpcRequestPriority,
} from "../../bun/rpc-schema";
import { setProjectTreeOpen } from "./sidebar-panels-state";
import {
  awaitAbortableResult,
  createAbortError,
  DIRECTORY_SUGGESTION_PREFETCH_DELAY_MS,
  DIRECTORY_SUGGESTION_RESULT_CACHE_MAX_ENTRIES,
  DIRECTORY_SUGGESTION_RESULT_CACHE_TTL_MS,
  type DirectorySuggestionResultCacheEntry,
  formatDirectoryPathForInput,
  isAbortError,
  type PendingSharedRequest,
  type ProjectNodeState,
  readLruValue,
  upsertProjectList,
  writeLruValue,
} from "./state";

type UseAddProjectFormParams = {
  /** Returns open/workspace state for a given project id. */
  getProjectState: (projectId: number) => ProjectNodeState;
  /** Path that represents the user home directory. */
  homeDirectory: string;
  /** Rehydrate project rows after opening a new project. */
  hydrateProjectRows: (items: RpcProject[]) => void;
  /** RPC endpoint collection used for lookup and mutation operations. */
  procedures: ProjectProcedures;
  /** Select active project/worktree after a successful open action. */
  selectProject: (project: RpcProject, worktreePath?: string | null) => void;
  /** Controls whether the mobile project list panel is visible. */
  setMobileProjectListOpen: Dispatch<SetStateAction<boolean>>;
  /** Updates the global project list state. */
  setProjects: Dispatch<SetStateAction<RpcProject[]>>;
  /** Applies project detail updates after opening project worktrees. */
  setProjectState: (
    projectId: number,
    update: Partial<ProjectNodeState>,
  ) => void;
  /** If enabled, input/output path formatting uses `~` shorthand. */
  supportsTildePath: boolean;
};

/**
 * Manages add-project form state, including directory suggestion querying,
 * abortable prefetch/cache behavior, and opening project side effects.
 */
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
    // Avoid stale debounced prefetch when query changes or UI is closed.
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

      // Write normalized directory responses into bounded LRU cache and remember prefetches.
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
    // Cancel the active abort controller so downstream awaiters resolve with abort.
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
      // Return fresh cached results when available; otherwise fetch with dedupe/sharing.
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
        // Reuse shared in-flight request and keep waiter counts balanced.
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
      // Background prefetches skip empty/duplicate queries and allow failures to be retried.
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
      // Normalize the directory and debounce prefetch to avoid aggressive querying.
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
    // Close form and clear transient add-form state.
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
      // Ignore form submits while previous add request is in progress.
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
        // Hydrate project rows and select the project immediately after open.
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
      // Committing a hovered suggestion directly fills the input and clears preview.
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
    // Manual edits always cancel hover preview so input text is authoritative.
    setAddProjectError("");
    setHoveredDirectorySuggestion(null);
    setAddProjectPath(value);
  }, []);

  const handleDirectorySuggestionEnter = useCallback(
    (directory: string) => {
      // Track hover for preview and start prefetch while the user dwells.
      setHoveredDirectorySuggestion(directory);
      scheduleDirectorySuggestionPrefetch(directory);
    },
    [scheduleDirectorySuggestionPrefetch],
  );

  const handleDirectorySuggestionLeave = useCallback(
    (directory: string) => {
      // Only clear hover when the same row loses hover; also cancel pending prefetch.
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
    // Cleanup any pending network request on unmount.
    return () => {
      abortDirectorySuggestionRequest(
        "Directory suggestion request was canceled.",
      );
    };
  }, [abortDirectorySuggestionRequest]);

  useEffect(() => {
    // Suggestion lifecycle: reset when form/query closes, otherwise fetch and track request IDs.
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
