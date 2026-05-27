/**
 * @file src/mainview/app/use-mainview-shell-controller.ts
 * @description React shell controller that owns Mainview navigation state, refs, and persistence wiring.
 */

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { RpcThreadMessage } from "../../bun/rpc-schema";
import type { MainviewPrimaryView } from "../thread-workspace-selection";
import {
  buildPersistedMainviewShellState,
  commitMainviewShellNavigationUpdate,
  createMainviewShellState,
  createPersistedMainviewShellStateWriter,
  type MainviewShellNavigationUpdate,
  type MainviewShellState,
  type PersistedMainviewShellStateWriter,
} from "./mainview-shell-state";
import {
  patchPersistedMainviewState,
  readPersistedMainviewState,
  type PersistedMainviewState,
} from "./persisted-mainview-state";
import type { ProjectStateMap } from "./project-worktree-state";

export type MainviewShellPersistenceInputs = {
  pendingThreadModel: string;
  pendingThreadPermissions: string[];
  pendingThreadReasoningEffort: string;
  sidebarSearchQuery: string;
};

export type MainviewShellControllerState = {
  completedThreadIndicatorIds: Set<number>;
  mainviewShellState: MainviewShellState;
  mobileNavigationIndicator: "none" | "working" | "completed";
  primaryView: MainviewPrimaryView;
  selectedProjectId: number | null;
  selectedThreadId: number | null;
  selectedWorktreePath: string | null;
  sessionStateReady: boolean;
  sidebarCollapsed: boolean;
};

export type MainviewShellControllerRefs = {
  selectedProjectIdRef: MutableRefObject<number | null>;
  selectedThreadIdRef: MutableRefObject<number | null>;
  selectedWorktreePathRef: MutableRefObject<string | null>;
  sidebarCollapsedRef: MutableRefObject<boolean>;
};

export type MainviewShellControllerSetters = {
  setCompletedThreadIndicatorIds: Dispatch<SetStateAction<Set<number>>>;
  setMobileNavigationIndicator: Dispatch<
    SetStateAction<"none" | "working" | "completed">
  >;
  setSessionStateReady: Dispatch<SetStateAction<boolean>>;
};

export type MainviewShellControllerCommands = {
  commitShellNavigationUpdate: (update: MainviewShellNavigationUpdate) => void;
  flushPersistedMainviewStateWrite: () => void;
  handleSidebarCollapsedChange: (collapsed: boolean) => void;
  setPrimaryViewForNavigation: Dispatch<SetStateAction<MainviewPrimaryView>>;
  setSelectedProjectIdForNavigation: Dispatch<SetStateAction<number | null>>;
  setSelectedThreadIdForNavigation: Dispatch<SetStateAction<number | null>>;
  setSelectedWorktreePathForNavigation: Dispatch<SetStateAction<string | null>>;
  setThreadMessagesForNavigation: Dispatch<SetStateAction<RpcThreadMessage[]>>;
};

export type UseMainviewShellControllerOptions = {
  initialMainviewState: PersistedMainviewState;
  persistenceInputs: MainviewShellPersistenceInputs;
  projectStates: ProjectStateMap;
  setThreadMessages: Dispatch<SetStateAction<RpcThreadMessage[]>>;
};

export type UseMainviewShellControllerResult = {
  commands: MainviewShellControllerCommands;
  refs: MainviewShellControllerRefs;
  setters: MainviewShellControllerSetters;
  state: MainviewShellControllerState;
};

export function useInitialMainviewState(): PersistedMainviewState {
  const initialMainviewStateRef = useRef<PersistedMainviewState | null>(null);
  if (!initialMainviewStateRef.current) {
    initialMainviewStateRef.current = readPersistedMainviewState();
  }
  return initialMainviewStateRef.current;
}

export function useMainviewShellController({
  initialMainviewState,
  persistenceInputs,
  projectStates,
  setThreadMessages,
}: UseMainviewShellControllerOptions): UseMainviewShellControllerResult {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    initialMainviewState.sidebarCollapsed,
  );
  const sidebarCollapsedRef = useRef(initialMainviewState.sidebarCollapsed);
  const [mobileNavigationIndicator, setMobileNavigationIndicator] = useState<
    "none" | "working" | "completed"
  >("none");
  const [completedThreadIndicatorIds, setCompletedThreadIndicatorIds] =
    useState(() => new Set<number>());
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    initialMainviewState.selectedProjectId,
  );
  const [selectedWorktreePath, setSelectedWorktreePath] = useState<
    string | null
  >(initialMainviewState.selectedWorktreePath);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(
    initialMainviewState.selectedThreadId,
  );
  const [sessionStateReady, setSessionStateReady] = useState(false);
  const [primaryView, setPrimaryView] = useState<MainviewPrimaryView>("chat");

  const persistedMainviewStateWriterRef =
    useRef<PersistedMainviewShellStateWriter | null>(null);
  if (persistedMainviewStateWriterRef.current === null) {
    persistedMainviewStateWriterRef.current =
      createPersistedMainviewShellStateWriter();
  }

  const selectedThreadIdRef = useRef<number | null>(null);
  const selectedProjectIdRef = useRef<number | null>(
    initialMainviewState.selectedProjectId,
  );
  const selectedWorktreePathRef = useRef<string | null>(
    initialMainviewState.selectedWorktreePath,
  );
  const [, startNavigationTransition] = useTransition();

  const flushPersistedMainviewStateWrite = useCallback((): void => {
    persistedMainviewStateWriterRef.current?.flush();
  }, []);

  const schedulePersistedMainviewStateWrite = useCallback(
    (nextState: PersistedMainviewState): void => {
      persistedMainviewStateWriterRef.current?.schedule(nextState);
    },
    [],
  );

  useEffect(() => {
    return () => {
      persistedMainviewStateWriterRef.current?.dispose();
      persistedMainviewStateWriterRef.current = null;
    };
  }, []);

  const handleSidebarCollapsedChange = useCallback(
    (collapsed: boolean): void => {
      sidebarCollapsedRef.current = collapsed;
      setSidebarCollapsed(collapsed);
      // Keep in sync with persisted layout state so reloads restore preference.
      patchPersistedMainviewState({
        sidebarCollapsed: collapsed,
      });
    },
    [],
  );

  const commitShellNavigationUpdate = useCallback(
    (update: MainviewShellNavigationUpdate): void => {
      startNavigationTransition(() => {
        commitMainviewShellNavigationUpdate(update, {
          refs: {
            selectedProjectIdRef,
            selectedThreadIdRef,
            selectedWorktreePathRef,
          },
          setters: {
            setPrimaryView,
            setSelectedProjectId,
            setSelectedThreadId,
            setSelectedWorktreePath,
          },
        });
      });
    },
    [],
  );

  const setSelectedProjectIdForNavigation = useCallback(
    (value: SetStateAction<number | null>) => {
      commitShellNavigationUpdate({ selectedProjectId: value });
    },
    [commitShellNavigationUpdate],
  );
  const setSelectedWorktreePathForNavigation = useCallback(
    (value: SetStateAction<string | null>) => {
      commitShellNavigationUpdate({ selectedWorktreePath: value });
    },
    [commitShellNavigationUpdate],
  );
  const setSelectedThreadIdForNavigation = useCallback(
    (value: SetStateAction<number | null>) => {
      commitShellNavigationUpdate({ selectedThreadId: value });
    },
    [commitShellNavigationUpdate],
  );
  const setThreadMessagesForNavigation = useCallback(
    (value: SetStateAction<RpcThreadMessage[]>) => {
      startNavigationTransition(() => {
        setThreadMessages(value);
      });
    },
    [setThreadMessages],
  );
  const setPrimaryViewForNavigation = useCallback(
    (value: SetStateAction<MainviewPrimaryView>) => {
      commitShellNavigationUpdate({ primaryView: value });
    },
    [commitShellNavigationUpdate],
  );

  const mainviewShellState = useMemo(
    () =>
      createMainviewShellState({
        primaryView,
        projectStates,
        selectedProjectId,
        selectedThreadId,
        selectedWorktreePath,
        sessionStateReady,
      }),
    [
      primaryView,
      projectStates,
      selectedProjectId,
      selectedThreadId,
      selectedWorktreePath,
      sessionStateReady,
    ],
  );

  const persistedMainviewState = useMemo<PersistedMainviewState | null>(
    () =>
      buildPersistedMainviewShellState(mainviewShellState, {
        chatInput: "",
        pendingThreadModel: persistenceInputs.pendingThreadModel,
        pendingThreadPermissions: persistenceInputs.pendingThreadPermissions,
        pendingThreadReasoningEffort:
          persistenceInputs.pendingThreadReasoningEffort,
        sidebarCollapsed,
        sidebarSearchQuery: persistenceInputs.sidebarSearchQuery,
      }),
    [
      mainviewShellState,
      persistenceInputs.pendingThreadModel,
      persistenceInputs.pendingThreadPermissions,
      persistenceInputs.pendingThreadReasoningEffort,
      persistenceInputs.sidebarSearchQuery,
      sidebarCollapsed,
    ],
  );

  useEffect(() => {
    if (persistedMainviewState === null) {
      return;
    }

    schedulePersistedMainviewStateWrite(persistedMainviewState);
  }, [persistedMainviewState, schedulePersistedMainviewStateWrite]);

  useEffect(() => {
    if (!sessionStateReady) {
      return;
    }

    const flushPendingPersistedState = (): void => {
      flushPersistedMainviewStateWrite();
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState !== "visible") {
        flushPersistedMainviewStateWrite();
      }
    };

    window.addEventListener("beforeunload", flushPendingPersistedState);
    window.addEventListener("pagehide", flushPendingPersistedState);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", flushPendingPersistedState);
      window.removeEventListener("pagehide", flushPendingPersistedState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushPersistedMainviewStateWrite();
    };
  }, [flushPersistedMainviewStateWrite, sessionStateReady]);

  return {
    commands: {
      commitShellNavigationUpdate,
      flushPersistedMainviewStateWrite,
      handleSidebarCollapsedChange,
      setPrimaryViewForNavigation,
      setSelectedProjectIdForNavigation,
      setSelectedThreadIdForNavigation,
      setSelectedWorktreePathForNavigation,
      setThreadMessagesForNavigation,
    },
    refs: {
      selectedProjectIdRef,
      selectedThreadIdRef,
      selectedWorktreePathRef,
      sidebarCollapsedRef,
    },
    setters: {
      setCompletedThreadIndicatorIds,
      setMobileNavigationIndicator,
      setSessionStateReady,
    },
    state: {
      completedThreadIndicatorIds,
      mainviewShellState,
      mobileNavigationIndicator,
      primaryView,
      selectedProjectId,
      selectedThreadId,
      selectedWorktreePath,
      sessionStateReady,
      sidebarCollapsed,
    },
  };
}
