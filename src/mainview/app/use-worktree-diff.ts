import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProjectProcedures,
  RpcProject,
  RpcWorktreeChange,
} from "../../bun/rpc-schema";
import {
  type DiffFilePatchState,
  emptyDiffFilePatchState,
} from "./diff-workspace";
import type { WorktreeNodeState } from "./state";
import { createAbortError, isAbortError } from "./state";

const WORKTREE_DIFF_POLL_INTERVAL_MS = 2_500;

function worktreeChangeMetadataMatches(
  left: RpcWorktreeChange | null,
  right: RpcWorktreeChange | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.path === right.path &&
    left.previousPath === right.previousPath &&
    left.stagedStatus === right.stagedStatus &&
    left.unstagedStatus === right.unstagedStatus
  );
}

/** Parameters controlling worktree snapshot and diff polling behavior. */
type UseWorktreeDiffParams = {
  /** Whether the active worktree is currently opened in the workspace panel. */
  activeSelectedWorktreeOpened: boolean;
  /** Active worktree path selected by the UI. */
  activeSelectedWorktreePath: string | null;
  /** Current changes for the active worktree used to compute default selected file. */
  activeWorktreeChanges: RpcWorktreeChange[];
  /** Whether app is visible; hidden documents pause background polling. */
  isDocumentVisible: boolean;
  /** Active panel mode; diff effects only run in `diff` mode. */
  primaryView: "chat" | "diff" | "tasks";
  /** RPC procedures for fetching snapshot and file diffs. */
  procedures: ProjectProcedures;
  /** Selected worktree change that should render as the focused patch row. */
  selectedDiffFileChange: RpcWorktreeChange | null;
  /** Selected file path currently displayed in the diff viewer. */
  selectedDiffFilePath: string | null;
  /** Selected project for loading worktree data. */
  selectedProject: RpcProject | null;
  /** Setter for selected diff file path state. */
  setSelectedDiffFilePath: Dispatch<SetStateAction<string | null>>;
  /** Merge function for updating per-worktree state in global store. */
  setWorktreeState: (
    projectId: number,
    worktreePath: string,
    update: Partial<WorktreeNodeState>,
  ) => void;
};

/**
 * Manages worktree snapshot polling and selected-file patch fetching for diff view.
 */
export function useWorktreeDiff({
  activeSelectedWorktreeOpened,
  activeSelectedWorktreePath,
  activeWorktreeChanges,
  isDocumentVisible,
  primaryView,
  procedures,
  selectedDiffFileChange,
  selectedDiffFilePath,
  selectedProject,
  setSelectedDiffFilePath,
  setWorktreeState,
}: UseWorktreeDiffParams) {
  const [worktreeDiffError, setWorktreeDiffError] = useState("");
  const [isRefreshingWorktreeSnapshot, setIsRefreshingWorktreeSnapshot] =
    useState(false);
  const [diffFilePatchState, setDiffFilePatchState] =
    useState<DiffFilePatchState>(emptyDiffFilePatchState());

  const diffSnapshotRequestIdRef = useRef(0);
  const diffSnapshotAbortControllerRef = useRef<AbortController | null>(null);
  const diffFilePatchRequestIdRef = useRef(0);
  const diffFilePatchAbortControllerRef = useRef<AbortController | null>(null);
  const diffFilePatchStateRef = useRef(diffFilePatchState);
  const selectedDiffFileChangePath = selectedDiffFileChange?.path ?? null;
  const selectedDiffFilePreviousPath =
    selectedDiffFileChange?.previousPath ?? null;
  const selectedDiffFileStagedStatus =
    selectedDiffFileChange?.stagedStatus ?? null;
  const selectedDiffFileUnstagedStatus =
    selectedDiffFileChange?.unstagedStatus ?? null;

  useEffect(() => {
    // Keep latest patch state in a ref so async callbacks can compare against current state.
    diffFilePatchStateRef.current = diffFilePatchState;
  }, [diffFilePatchState]);

  const abortDiffSnapshotRequest = useCallback((reason: string) => {
    // Cancel any in-flight snapshot request and tag it with a concrete abort reason.
    const controller = diffSnapshotAbortControllerRef.current;
    if (!controller) {
      return;
    }

    diffSnapshotAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

  const abortDiffFilePatchRequest = useCallback((reason: string) => {
    // Cancel any in-flight file patch request and tag it with a concrete abort reason.
    const controller = diffFilePatchAbortControllerRef.current;
    if (!controller) {
      return;
    }

    diffFilePatchAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

  const loadSelectedDiffFilePatch = useCallback(
    async (options?: { background?: boolean }): Promise<void> => {
      // If there is no valid selection, reset patch state deterministically and skip fetch.
      if (
        !selectedProject ||
        !activeSelectedWorktreePath ||
        !selectedDiffFileChangePath
      ) {
        setDiffFilePatchState((current) => {
          const next = emptyDiffFilePatchState(selectedDiffFilePath ?? null);
          return current.path === next.path &&
            current.diffText === next.diffText &&
            current.error === next.error &&
            current.isLoading === next.isLoading
            ? current
            : next;
        });
        return;
      }

      const requestId = ++diffFilePatchRequestIdRef.current;
      // Supersede previous patch loads before starting a new request.
      abortDiffFilePatchRequest("Worktree file diff request was superseded.");
      const controller = new AbortController();
      diffFilePatchAbortControllerRef.current = controller;
      const currentState = diffFilePatchStateRef.current;
      const selectedChange: RpcWorktreeChange = {
        path: selectedDiffFileChangePath,
        previousPath: selectedDiffFilePreviousPath,
        stagedStatus: selectedDiffFileStagedStatus,
        unstagedStatus: selectedDiffFileUnstagedStatus,
      };
      const preserveVisiblePatch =
        options?.background &&
        currentState.path === selectedDiffFileChangePath &&
        currentState.diffText.trim().length > 0 &&
        !currentState.error;
      if (!preserveVisiblePatch) {
        // Replace displayed patch with loading state unless background reuse is safe.
        setDiffFilePatchState((current) => {
          const next = {
            ...emptyDiffFilePatchState(selectedDiffFileChangePath),
            isLoading: true,
          };
          return current.path === next.path &&
            current.diffText === next.diffText &&
            current.error === next.error &&
            current.isLoading === next.isLoading
            ? current
            : next;
        });
      }

      try {
        const result = await procedures.readWorktreeFileDiff(
          {
            change: selectedChange,
            projectId: selectedProject.id,
            worktreePath: activeSelectedWorktreePath,
          },
          {
            priority: "foreground",
            signal: controller.signal,
          },
        );
        if (diffFilePatchRequestIdRef.current !== requestId) {
          return;
        }

        setDiffFilePatchState((current) => {
          // Success path: stash loaded patch and clear any stale error.
          const next = {
            diffText: result.diffText,
            error: "",
            isLoading: false,
            path: result.path,
          };
          return current.path === next.path &&
            current.diffText === next.diffText &&
            current.error === next.error &&
            current.isLoading === next.isLoading
            ? current
            : next;
        });
      } catch (error) {
        // Ignore expected cancellation races; surface other errors for the selected file row.
        if (isAbortError(error)) {
          return;
        }
        if (diffFilePatchRequestIdRef.current !== requestId) {
          return;
        }
        setDiffFilePatchState((current) => ({
          ...(current.path === selectedDiffFileChangePath
            ? current
            : emptyDiffFilePatchState(selectedDiffFileChangePath)),
          error: error instanceof Error ? error.message : String(error),
          isLoading: false,
          path: selectedDiffFileChangePath,
        }));
      } finally {
        if (diffFilePatchAbortControllerRef.current === controller) {
          diffFilePatchAbortControllerRef.current = null;
        }
      }
    },
    [
      abortDiffFilePatchRequest,
      activeSelectedWorktreePath,
      procedures,
      selectedDiffFileChangePath,
      selectedDiffFilePreviousPath,
      selectedDiffFileStagedStatus,
      selectedDiffFileUnstagedStatus,
      selectedDiffFilePath,
      selectedProject,
    ],
  );

  const refreshActiveWorktreeSnapshot = useCallback(
    async (options?: { background?: boolean }) => {
      // Snapshot refresh requires an active/open worktree selection.
      if (
        !selectedProject ||
        !activeSelectedWorktreePath ||
        !activeSelectedWorktreeOpened
      ) {
        return;
      }

      const requestId = ++diffSnapshotRequestIdRef.current;
      // Start from a clean in-flight state and clear stale worktree snapshots.
      abortDiffSnapshotRequest(
        "Worktree diff snapshot request was superseded.",
      );
      const controller = new AbortController();
      diffSnapshotAbortControllerRef.current = controller;
      if (!options?.background) {
        setIsRefreshingWorktreeSnapshot(true);
      }
      if (!options?.background) {
        setWorktreeDiffError("");
      }

      try {
        const snapshot = await procedures.getWorktreeSnapshot(
          {
            projectId: selectedProject.id,
            worktreePath: activeSelectedWorktreePath,
          },
          {
            priority: options?.background ? "background" : "foreground",
            signal: controller.signal,
          },
        );
        if (diffSnapshotRequestIdRef.current !== requestId) {
          return;
        }

        setWorktreeState(selectedProject.id, activeSelectedWorktreePath, {
          error: "",
          loading: false,
          opened: true,
          snapshot,
        });
        setWorktreeDiffError("");

        if (options?.background && selectedDiffFileChangePath) {
          const refreshedSelectedChange =
            snapshot.changes.find(
              (change) => change.path === selectedDiffFileChangePath,
            ) ?? null;
          const currentSelectedChange: RpcWorktreeChange | null = {
            path: selectedDiffFileChangePath,
            previousPath: selectedDiffFilePreviousPath,
            stagedStatus: selectedDiffFileStagedStatus,
            unstagedStatus: selectedDiffFileUnstagedStatus,
          };
          if (
            refreshedSelectedChange &&
            !worktreeChangeMetadataMatches(
              currentSelectedChange,
              refreshedSelectedChange,
            )
          ) {
            // Refresh patch only when the selected change metadata actually changed.
            void loadSelectedDiffFilePatch({
              background: true,
            });
          }
        }
      } catch (error) {
        // Ignore abort races; otherwise record and show the latest error.
        if (isAbortError(error)) {
          return;
        }
        if (diffSnapshotRequestIdRef.current !== requestId) {
          return;
        }
        setWorktreeDiffError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        if (diffSnapshotAbortControllerRef.current === controller) {
          diffSnapshotAbortControllerRef.current = null;
        }
        if (
          diffSnapshotRequestIdRef.current === requestId &&
          !options?.background
        ) {
          setIsRefreshingWorktreeSnapshot(false);
        }
      }
    },
    [
      abortDiffSnapshotRequest,
      activeSelectedWorktreeOpened,
      activeSelectedWorktreePath,
      loadSelectedDiffFilePatch,
      procedures,
      selectedDiffFileChangePath,
      selectedDiffFilePreviousPath,
      selectedDiffFileStagedStatus,
      selectedDiffFileUnstagedStatus,
      selectedProject,
      setWorktreeState,
    ],
  );

  useEffect(() => {
    // Unmount cleanup: invalidate both request channels and abort any active calls.
    return () => {
      diffSnapshotRequestIdRef.current += 1;
      diffFilePatchRequestIdRef.current += 1;
      abortDiffSnapshotRequest("Worktree diff snapshot request was cleared.");
      abortDiffFilePatchRequest("Worktree file diff request was cleared.");
    };
  }, [abortDiffFilePatchRequest, abortDiffSnapshotRequest]);

  useEffect(() => {
    // Close worktree/selection means patch state is stale; clear local view state.
    if (
      selectedProject &&
      activeSelectedWorktreePath &&
      activeSelectedWorktreeOpened
    ) {
      return;
    }

    diffSnapshotRequestIdRef.current += 1;
    diffFilePatchRequestIdRef.current += 1;
    abortDiffSnapshotRequest("Worktree diff snapshot request was cleared.");
    abortDiffFilePatchRequest("Worktree file diff request was cleared.");
    setIsRefreshingWorktreeSnapshot(false);
    setWorktreeDiffError("");
    setSelectedDiffFilePath(null);
    setDiffFilePatchState(emptyDiffFilePatchState());
  }, [
    abortDiffFilePatchRequest,
    abortDiffSnapshotRequest,
    activeSelectedWorktreeOpened,
    activeSelectedWorktreePath,
    setSelectedDiffFilePath,
    selectedProject,
  ]);

  useEffect(() => {
    // Poll snapshot every 2.5s only when in diff view and document is visible.
    if (
      primaryView !== "diff" ||
      !selectedProject ||
      !activeSelectedWorktreePath ||
      !activeSelectedWorktreeOpened ||
      !isDocumentVisible
    ) {
      return;
    }

    void refreshActiveWorktreeSnapshot();
    const timer = window.setInterval(() => {
      void refreshActiveWorktreeSnapshot({
        background: true,
      });
    }, WORKTREE_DIFF_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      diffSnapshotRequestIdRef.current += 1;
      abortDiffSnapshotRequest("Worktree diff snapshot request was cleared.");
      setIsRefreshingWorktreeSnapshot(false);
    };
  }, [
    abortDiffSnapshotRequest,
    activeSelectedWorktreeOpened,
    activeSelectedWorktreePath,
    isDocumentVisible,
    primaryView,
    refreshActiveWorktreeSnapshot,
    selectedProject,
  ]);

  useEffect(() => {
    // Ensure selected file stays valid; default to first change when current selection drops out.
    if (activeWorktreeChanges.length === 0) {
      setSelectedDiffFilePath(null);
      return;
    }

    setSelectedDiffFilePath((current) => {
      if (
        current &&
        activeWorktreeChanges.some((change) => change.path === current)
      ) {
        return current;
      }
      return activeWorktreeChanges[0]?.path ?? null;
    });
  }, [activeWorktreeChanges, setSelectedDiffFilePath]);

  useEffect(() => {
    // Gate patch fetch by active view + selection; cancel when conditions no longer hold.
    if (
      primaryView !== "diff" ||
      !selectedProject ||
      !activeSelectedWorktreePath ||
      !activeSelectedWorktreeOpened ||
      !selectedDiffFileChangePath
    ) {
      diffFilePatchRequestIdRef.current += 1;
      abortDiffFilePatchRequest("Worktree file diff request was cleared.");
      setDiffFilePatchState((current) => {
        const next = emptyDiffFilePatchState(selectedDiffFilePath);
        return current.path === next.path &&
          current.diffText === next.diffText &&
          current.error === next.error &&
          current.isLoading === next.isLoading
          ? current
          : next;
      });
      return;
    }

    void loadSelectedDiffFilePatch();
    return () => {
      diffFilePatchRequestIdRef.current += 1;
      abortDiffFilePatchRequest("Worktree file diff request was cleared.");
    };
  }, [
    abortDiffFilePatchRequest,
    activeSelectedWorktreeOpened,
    activeSelectedWorktreePath,
    loadSelectedDiffFilePatch,
    primaryView,
    selectedDiffFileChangePath,
    selectedDiffFilePath,
    selectedProject,
  ]);

  return {
    diffFilePatchState,
    isRefreshingWorktreeSnapshot,
    loadSelectedDiffFilePatch,
    refreshActiveWorktreeSnapshot,
    worktreeDiffError,
  };
}
