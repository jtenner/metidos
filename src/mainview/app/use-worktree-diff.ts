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

type UseWorktreeDiffParams = {
  activeSelectedWorktreeOpened: boolean;
  activeSelectedWorktreePath: string | null;
  activeWorktreeChanges: RpcWorktreeChange[];
  isDocumentVisible: boolean;
  primaryView: "chat" | "diff";
  procedures: ProjectProcedures;
  selectedDiffFileChange: RpcWorktreeChange | null;
  selectedDiffFilePath: string | null;
  selectedProject: RpcProject | null;
  setSelectedDiffFilePath: Dispatch<SetStateAction<string | null>>;
  setWorktreeState: (
    projectId: number,
    worktreePath: string,
    update: Partial<WorktreeNodeState>,
  ) => void;
};

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
    diffFilePatchStateRef.current = diffFilePatchState;
  }, [diffFilePatchState]);

  const abortDiffSnapshotRequest = useCallback((reason: string) => {
    const controller = diffSnapshotAbortControllerRef.current;
    if (!controller) {
      return;
    }

    diffSnapshotAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

  const abortDiffFilePatchRequest = useCallback((reason: string) => {
    const controller = diffFilePatchAbortControllerRef.current;
    if (!controller) {
      return;
    }

    diffFilePatchAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

  const loadSelectedDiffFilePatch = useCallback(
    async (options?: {
      background?: boolean;
    }): Promise<void> => {
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
      if (
        !selectedProject ||
        !activeSelectedWorktreePath ||
        !activeSelectedWorktreeOpened
      ) {
        return;
      }

      const requestId = ++diffSnapshotRequestIdRef.current;
      abortDiffSnapshotRequest(
        "Worktree diff snapshot request was superseded.",
      );
      const controller = new AbortController();
      diffSnapshotAbortControllerRef.current = controller;
      setIsRefreshingWorktreeSnapshot(true);
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
          void loadSelectedDiffFilePatch({
            background: true,
          });
        }
      } catch (error) {
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
        if (diffSnapshotRequestIdRef.current === requestId) {
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
      selectedProject,
      setWorktreeState,
    ],
  );

  useEffect(() => {
    return () => {
      diffSnapshotRequestIdRef.current += 1;
      diffFilePatchRequestIdRef.current += 1;
      abortDiffSnapshotRequest("Worktree diff snapshot request was cleared.");
      abortDiffFilePatchRequest("Worktree file diff request was cleared.");
    };
  }, [abortDiffFilePatchRequest, abortDiffSnapshotRequest]);

  useEffect(() => {
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
