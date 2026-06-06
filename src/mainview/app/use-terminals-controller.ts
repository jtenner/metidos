/**
 * @file src/mainview/app/use-terminals-controller.ts
 * @description Client-side terminal list/selection controller.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectProcedures,
  RpcCreateTerminalRequest,
  RpcTerminal,
} from "../../bun/rpc-schema";
import {
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
} from "./browser-storage";

export type InteractionMode = "chat" | "terminal";

const SELECTED_TERMINAL_KEY = "metidos:terminal:selected-id";
const INTERACTION_MODE_KEY = "metidos:interaction-mode";
const CHAT_DRAFT_KEY_PREFIX = "metidos:thread:";
export const CHAT_DRAFT_PERSIST_DEBOUNCE_MS = 300;

type PendingChatDraftWrite = {
  draft: string;
  timerId: number;
};

const pendingChatDraftWrites = new Map<number, PendingChatDraftWrite>();

function readInteractionMode(): InteractionMode {
  if (typeof window === "undefined") {
    return "chat";
  }
  return window.localStorage.getItem(INTERACTION_MODE_KEY) === "terminal"
    ? "terminal"
    : "chat";
}

function writeInteractionMode(mode: InteractionMode): void {
  if (typeof window === "undefined") {
    return;
  }
  safeLocalStorageSetItem(
    INTERACTION_MODE_KEY,
    mode,
    "terminal-interaction-mode",
  );
}

function readSelectedTerminalId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(SELECTED_TERMINAL_KEY) || null;
}

function writeSelectedTerminalId(terminalId: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  if (terminalId) {
    safeLocalStorageSetItem(
      SELECTED_TERMINAL_KEY,
      terminalId,
      "selected-terminal",
    );
    return;
  }
  safeLocalStorageRemoveItem(SELECTED_TERMINAL_KEY, "selected-terminal");
}

export function chatDraftStorageKey(threadId: number): string {
  return `${CHAT_DRAFT_KEY_PREFIX}${threadId}:chat-draft`;
}

export function readPersistedChatDraft(threadId: number | null): string {
  if (typeof window === "undefined" || threadId === null) {
    return "";
  }
  return window.localStorage.getItem(chatDraftStorageKey(threadId)) ?? "";
}

export function writePersistedChatDraft(
  threadId: number | null,
  draft: string,
): void {
  if (typeof window === "undefined" || threadId === null) {
    return;
  }
  safeLocalStorageSetItem(
    chatDraftStorageKey(threadId),
    draft,
    "thread-chat-draft",
  );
}

export function flushPendingPersistedChatDraftWrites(): void {
  if (typeof window === "undefined") {
    pendingChatDraftWrites.clear();
    return;
  }

  for (const [threadId, pendingWrite] of pendingChatDraftWrites) {
    window.clearTimeout(pendingWrite.timerId);
    writePersistedChatDraft(threadId, pendingWrite.draft);
  }
  pendingChatDraftWrites.clear();
}

export function schedulePersistedChatDraftWrite(
  threadId: number | null,
  draft: string,
): void {
  if (typeof window === "undefined" || threadId === null) {
    return;
  }

  const pendingWrite = pendingChatDraftWrites.get(threadId);
  if (pendingWrite) {
    window.clearTimeout(pendingWrite.timerId);
  }

  const timerId = window.setTimeout(() => {
    pendingChatDraftWrites.delete(threadId);
    writePersistedChatDraft(threadId, draft);
  }, CHAT_DRAFT_PERSIST_DEBOUNCE_MS);

  pendingChatDraftWrites.set(threadId, { draft, timerId });
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPendingPersistedChatDraftWrites);
  window.addEventListener("beforeunload", flushPendingPersistedChatDraftWrites);
}

export function resolveSelectedTerminalId(
  selectedTerminalId: string | null,
  terminals: RpcTerminal[],
): string | null {
  if (
    selectedTerminalId &&
    terminals.some((terminal) => terminal.terminalId === selectedTerminalId)
  ) {
    return selectedTerminalId;
  }
  return terminals.at(-1)?.terminalId ?? null;
}

export async function loadVisibleTerminalsForUser({
  isAdmin,
  listTerminals,
}: {
  isAdmin: boolean;
  listTerminals: ProjectProcedures["listTerminals"];
}): Promise<RpcTerminal[]> {
  if (!isAdmin) {
    return [];
  }
  return await listTerminals(undefined, { priority: "background" });
}

export function resolveInteractionModeAfterTerminalRefresh({
  interactionMode,
  terminals,
}: {
  interactionMode: InteractionMode;
  terminals: RpcTerminal[];
}): InteractionMode {
  if (terminals.length === 0 && interactionMode === "terminal") {
    return "chat";
  }
  return interactionMode;
}

export function buildCreateTerminalRequest({
  activeProjectId,
  activeThreadId,
  activeWorktreePath,
  isAdmin,
  options,
  selectedTerminalId,
  terminals,
}: {
  activeProjectId: number | null;
  activeThreadId: number | null;
  activeWorktreePath: string | null;
  isAdmin: boolean;
  options?: {
    copyActive?: boolean;
    command?: string;
    title?: string;
  };
  selectedTerminalId: string | null;
  terminals: RpcTerminal[];
}): RpcCreateTerminalRequest | null {
  if (!isAdmin) {
    return null;
  }
  const activeTerminal = terminals.find(
    (terminal) => terminal.terminalId === selectedTerminalId,
  );
  const projectId =
    options?.copyActive && activeTerminal
      ? activeTerminal.projectId
      : activeProjectId;
  const worktreePath =
    options?.copyActive && activeTerminal
      ? activeTerminal.worktreePath
      : activeWorktreePath;
  if (projectId === null || !worktreePath) {
    return null;
  }
  return {
    command: options?.command ?? null,
    createdFromThreadId: activeThreadId,
    projectId,
    ...(options?.title ? { title: options.title } : {}),
    worktreePath,
  };
}

export function useTerminalsController({
  activeProjectId,
  activeThreadId,
  activeWorktreePath,
  isAdmin,
  procedures,
}: {
  activeProjectId: number | null;
  activeThreadId: number | null;
  activeWorktreePath: string | null;
  isAdmin: boolean;
  procedures: ProjectProcedures;
}) {
  const [terminals, setTerminals] = useState<RpcTerminal[]>([]);
  const [selectedTerminalId, setSelectedTerminalIdState] = useState<
    string | null
  >(() => readSelectedTerminalId());
  const [interactionMode, setInteractionModeState] = useState<InteractionMode>(
    () => readInteractionMode(),
  );
  const [error, setError] = useState("");
  const mountedRef = useRef(false);
  const refreshRequestIdRef = useRef(0);
  const renameRequestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshRequestIdRef.current += 1;
      renameRequestIdRef.current += 1;
    };
  }, []);

  const refreshTerminals = useCallback(async (): Promise<RpcTerminal[]> => {
    refreshRequestIdRef.current += 1;
    const requestId = refreshRequestIdRef.current;
    if (!isAdmin) {
      if (mountedRef.current && requestId === refreshRequestIdRef.current) {
        setTerminals([]);
      }
      return [];
    }
    try {
      const result = await loadVisibleTerminalsForUser({
        isAdmin,
        listTerminals: procedures.listTerminals,
      });
      if (mountedRef.current && requestId === refreshRequestIdRef.current) {
        setTerminals(result);
      }
      return result;
    } catch (refreshError) {
      if (mountedRef.current && requestId === refreshRequestIdRef.current) {
        setError(
          refreshError instanceof Error
            ? refreshError.message
            : String(refreshError),
        );
      }
      return [];
    }
  }, [isAdmin, procedures]);

  useEffect(() => {
    void refreshTerminals().then((result) => {
      if (!mountedRef.current) {
        return;
      }
      const currentInteractionMode = readInteractionMode();
      const nextInteractionMode = resolveInteractionModeAfterTerminalRefresh({
        interactionMode: currentInteractionMode,
        terminals: result,
      });
      if (nextInteractionMode !== currentInteractionMode) {
        setInteractionModeState(nextInteractionMode);
        writeInteractionMode(nextInteractionMode);
      }
    });
  }, [refreshTerminals]);

  useEffect(() => {
    if (!selectedTerminalId || terminals.length === 0) {
      return;
    }
    const next = resolveSelectedTerminalId(selectedTerminalId, terminals);
    if (next !== selectedTerminalId) {
      setSelectedTerminalIdState(next);
      writeSelectedTerminalId(next);
    }
  }, [selectedTerminalId, terminals]);

  const setSelectedTerminalId = useCallback(
    (terminalId: string | null): void => {
      setSelectedTerminalIdState(terminalId);
      writeSelectedTerminalId(terminalId);
    },
    [],
  );

  const setInteractionMode = useCallback((mode: InteractionMode): void => {
    setInteractionModeState(mode);
    writeInteractionMode(mode);
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    const handleTerminalChanged = (event: CustomEvent<RpcTerminal>): void => {
      const terminal = event.detail;
      if (terminal.createdFromThreadId === activeThreadId) {
        setSelectedTerminalId(terminal.terminalId);
        setInteractionMode("terminal");
      }
      void refreshTerminals();
    };
    window.addEventListener("metidos:terminal-changed", handleTerminalChanged);
    return () => {
      window.removeEventListener(
        "metidos:terminal-changed",
        handleTerminalChanged,
      );
    };
  }, [
    isAdmin,
    refreshTerminals,
    setSelectedTerminalId,
    setInteractionMode,
    activeThreadId,
  ]);

  const createTerminal = useCallback(
    async (options?: {
      copyActive?: boolean;
      command?: string;
      title?: string;
    }) => {
      const request = buildCreateTerminalRequest({
        activeProjectId,
        activeThreadId,
        activeWorktreePath,
        isAdmin,
        ...(options === undefined ? {} : { options }),
        selectedTerminalId,
        terminals,
      });
      if (!request) {
        return null;
      }
      const result = await procedures.createTerminal(request);
      const next = await refreshTerminals();
      const terminal =
        next.find(
          (candidate) => candidate.terminalId === result.terminal.terminalId,
        ) ?? result.terminal;
      setSelectedTerminalId(terminal.terminalId);
      setInteractionMode("terminal");
      return terminal;
    },
    [
      activeProjectId,
      activeThreadId,
      activeWorktreePath,
      isAdmin,
      procedures,
      refreshTerminals,
      selectedTerminalId,
      setInteractionMode,
      setSelectedTerminalId,
      terminals,
    ],
  );

  const closeTerminal = useCallback(
    async (terminal: RpcTerminal): Promise<void> => {
      await procedures.closeTerminal({ terminalId: terminal.terminalId });
      await refreshTerminals();
    },
    [procedures, refreshTerminals],
  );

  const renameTerminal = useCallback(
    async (terminalId: string, title: string): Promise<void> => {
      renameRequestIdRef.current += 1;
      const requestId = renameRequestIdRef.current;
      if (mountedRef.current) {
        setTerminals((current) =>
          current.map((terminal) =>
            terminal.terminalId === terminalId
              ? { ...terminal, title }
              : terminal,
          ),
        );
      }
      try {
        await procedures.renameTerminal({ terminalId, title });
      } catch (renameError) {
        if (mountedRef.current && requestId === renameRequestIdRef.current) {
          setError(
            renameError instanceof Error
              ? renameError.message
              : String(renameError),
          );
        }
      } finally {
        if (mountedRef.current && requestId === renameRequestIdRef.current) {
          await refreshTerminals();
        }
      }
    },
    [procedures, refreshTerminals],
  );

  const selectedTerminal = useMemo(
    () =>
      terminals.find(
        (terminal) => terminal.terminalId === selectedTerminalId,
      ) ??
      terminals[0] ??
      null,
    [selectedTerminalId, terminals],
  );

  return {
    closeTerminal,
    createTerminal,
    error,
    interactionMode,
    refreshTerminals,
    renameTerminal,
    selectedTerminal,
    selectedTerminalId: selectedTerminal?.terminalId ?? null,
    setInteractionMode,
    setSelectedTerminalId,
    terminals,
  };
}
