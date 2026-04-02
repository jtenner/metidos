import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProjectProcedures,
  RpcProject,
  RpcWorktreeChange,
} from "../../bun/rpc-schema";
import {
  type DiffFileContentState,
  decodeBase64Bytes,
  emptyDiffFileContentState,
} from "./diff-workspace";
import type { WorktreeNodeState } from "./state";
import { createAbortError, isAbortError } from "./state";

const WORKTREE_DIFF_POLL_INTERVAL_MS = 2_500;
const WORKTREE_FILE_CONTENT_PAGE_BYTES = 64 * 1024;

type UseWorktreeDiffParams = {
  activeSelectedWorktreeOpened: boolean;
  activeSelectedWorktreePath: string | null;
  activeWorktreeChanges: RpcWorktreeChange[];
  isDocumentVisible: boolean;
  primaryView: "chat" | "diff";
  procedures: ProjectProcedures;
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
  selectedDiffFilePath,
  selectedProject,
  setSelectedDiffFilePath,
  setWorktreeState,
}: UseWorktreeDiffParams) {
  const [worktreeDiffError, setWorktreeDiffError] = useState("");
  const [isRefreshingWorktreeSnapshot, setIsRefreshingWorktreeSnapshot] =
    useState(false);
  const [diffFileContentState, setDiffFileContentState] =
    useState<DiffFileContentState>(emptyDiffFileContentState());

  const diffSnapshotRequestIdRef = useRef(0);
  const diffSnapshotAbortControllerRef = useRef<AbortController | null>(null);
  const diffFileContentRequestIdRef = useRef(0);
  const diffFileContentAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const diffFileContentDecoderRef = useRef<TextDecoder | null>(null);

  const abortDiffSnapshotRequest = useCallback((reason: string) => {
    const controller = diffSnapshotAbortControllerRef.current;
    if (!controller) {
      return;
    }

    diffSnapshotAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

  const abortDiffFileContentRequest = useCallback((reason: string) => {
    const controller = diffFileContentAbortControllerRef.current;
    if (!controller) {
      return;
    }

    diffFileContentAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

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
      procedures,
      selectedProject,
      setWorktreeState,
    ],
  );

  const loadDiffFileContentPage = useCallback(
    async (
      path: string,
      options?: {
        cursor?: number;
        reset?: boolean;
      },
    ): Promise<void> => {
      if (!selectedProject || !activeSelectedWorktreePath) {
        return;
      }

      const requestId = ++diffFileContentRequestIdRef.current;
      abortDiffFileContentRequest(
        "Worktree file content request was superseded.",
      );
      const controller = new AbortController();
      diffFileContentAbortControllerRef.current = controller;
      const reset = options?.reset ?? false;
      const cursor = reset ? 0 : Math.max(0, options?.cursor ?? 0);

      if (reset) {
        diffFileContentDecoderRef.current = new TextDecoder();
        setDiffFileContentState({
          ...emptyDiffFileContentState(path),
          isLoadingInitial: true,
        });
      } else {
        setDiffFileContentState((current) =>
          current.path === path
            ? {
                ...current,
                error: "",
                isLoadingMore: true,
              }
            : {
                ...emptyDiffFileContentState(path),
                isLoadingInitial: true,
              },
        );
      }

      try {
        const page = await procedures.readWorktreeFileContentPage(
          {
            cursor,
            limitBytes: WORKTREE_FILE_CONTENT_PAGE_BYTES,
            path,
            projectId: selectedProject.id,
            worktreePath: activeSelectedWorktreePath,
          },
          {
            priority: "foreground",
            signal: controller.signal,
          },
        );
        if (diffFileContentRequestIdRef.current !== requestId) {
          return;
        }

        let decodedChunk = "";
        let loadedBytes = page.nextCursor ?? page.totalBytes;
        if (!page.isBinary && !page.isMissing) {
          const decoder =
            reset || !diffFileContentDecoderRef.current
              ? new TextDecoder()
              : diffFileContentDecoderRef.current;
          diffFileContentDecoderRef.current = decoder;
          const bytes = decodeBase64Bytes(page.chunkBase64);
          decodedChunk = decoder.decode(bytes, {
            stream: page.nextCursor !== null,
          });
          if (page.nextCursor === null) {
            decodedChunk += decoder.decode();
          }
          loadedBytes = page.cursor + bytes.length;
        }

        setDiffFileContentState((current) => {
          const base =
            reset || current.path !== path
              ? emptyDiffFileContentState(path)
              : current;
          return {
            chunks: decodedChunk ? [...base.chunks, decodedChunk] : base.chunks,
            error: "",
            isBinary: page.isBinary,
            isLoadingInitial: false,
            isLoadingMore: false,
            isMissing: page.isMissing,
            loadedBytes,
            nextCursor: page.nextCursor,
            path,
            totalBytes: page.totalBytes,
          };
        });
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        if (diffFileContentRequestIdRef.current !== requestId) {
          return;
        }
        setDiffFileContentState((current) => ({
          ...(current.path === path
            ? current
            : emptyDiffFileContentState(path)),
          error: error instanceof Error ? error.message : String(error),
          isLoadingInitial: false,
          isLoadingMore: false,
          path,
        }));
      } finally {
        if (diffFileContentAbortControllerRef.current === controller) {
          diffFileContentAbortControllerRef.current = null;
        }
      }
    },
    [
      abortDiffFileContentRequest,
      activeSelectedWorktreePath,
      procedures,
      selectedProject,
    ],
  );

  const loadSelectedDiffFileContent = useCallback(async (): Promise<void> => {
    if (!selectedDiffFilePath) {
      diffFileContentDecoderRef.current = null;
      setDiffFileContentState(emptyDiffFileContentState());
      return;
    }

    await loadDiffFileContentPage(selectedDiffFilePath, {
      reset: true,
    });
  }, [loadDiffFileContentPage, selectedDiffFilePath]);

  const loadMoreDiffFileContent = useCallback(async (): Promise<void> => {
    if (
      !selectedDiffFilePath ||
      diffFileContentState.path !== selectedDiffFilePath ||
      diffFileContentState.nextCursor === null ||
      diffFileContentState.isLoadingInitial ||
      diffFileContentState.isLoadingMore
    ) {
      return;
    }

    await loadDiffFileContentPage(selectedDiffFilePath, {
      cursor: diffFileContentState.nextCursor,
    });
  }, [diffFileContentState, loadDiffFileContentPage, selectedDiffFilePath]);

  useEffect(() => {
    return () => {
      diffSnapshotRequestIdRef.current += 1;
      diffFileContentRequestIdRef.current += 1;
      abortDiffSnapshotRequest("Worktree diff snapshot request was cleared.");
      abortDiffFileContentRequest("Worktree file content request was cleared.");
    };
  }, [abortDiffFileContentRequest, abortDiffSnapshotRequest]);

  useEffect(() => {
    if (
      selectedProject &&
      activeSelectedWorktreePath &&
      activeSelectedWorktreeOpened
    ) {
      return;
    }

    diffSnapshotRequestIdRef.current += 1;
    diffFileContentRequestIdRef.current += 1;
    diffFileContentDecoderRef.current = null;
    abortDiffSnapshotRequest("Worktree diff snapshot request was cleared.");
    abortDiffFileContentRequest("Worktree file content request was cleared.");
    setIsRefreshingWorktreeSnapshot(false);
    setWorktreeDiffError("");
    setSelectedDiffFilePath(null);
    setDiffFileContentState(emptyDiffFileContentState());
  }, [
    abortDiffFileContentRequest,
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
      !selectedDiffFilePath
    ) {
      diffFileContentRequestIdRef.current += 1;
      diffFileContentDecoderRef.current = null;
      abortDiffFileContentRequest("Worktree file content request was cleared.");
      setDiffFileContentState(emptyDiffFileContentState(selectedDiffFilePath));
      return;
    }

    void loadSelectedDiffFileContent();
    return () => {
      diffFileContentRequestIdRef.current += 1;
      diffFileContentDecoderRef.current = null;
      abortDiffFileContentRequest("Worktree file content request was cleared.");
    };
  }, [
    abortDiffFileContentRequest,
    activeSelectedWorktreeOpened,
    activeSelectedWorktreePath,
    loadSelectedDiffFileContent,
    primaryView,
    selectedDiffFilePath,
    selectedProject,
  ]);

  return {
    diffFileContentState,
    isRefreshingWorktreeSnapshot,
    loadMoreDiffFileContent,
    loadSelectedDiffFileContent,
    refreshActiveWorktreeSnapshot,
    worktreeDiffError,
  };
}
