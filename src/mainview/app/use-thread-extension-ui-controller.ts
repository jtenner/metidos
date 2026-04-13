/**
 * @file src/mainview/app/use-thread-extension-ui-controller.ts
 * @description Extracted Pi extension UI controller for App.tsx.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectProcedures,
  RpcThreadExtensionUiRequest,
} from "../../bun/rpc-schema";
import {
  readChatComposerDraft,
  setChatComposerDraft,
} from "../controls/chat-composer-control";
import {
  dismissThreadExtensionUiDialog,
  dismissThreadExtensionUiNotification,
  EMPTY_THREAD_EXTENSION_UI_STORE,
  listThreadExtensionUiStatuses,
  listThreadExtensionUiWidgets,
  readThreadExtensionUiState,
  reduceThreadExtensionUiStore,
} from "../thread-extension-ui";
import { APP_TITLE, THREAD_EXTENSION_UI_EVENT_NAME } from "./state";

type ThreadExtensionUiProcedures = Pick<
  ProjectProcedures,
  "respondThreadExtensionUi" | "updateThreadExtensionEditor"
>;

type UseThreadExtensionUiControllerParams = {
  activeScreenTitle: string;
  initialChatInput: string;
  procedures: ThreadExtensionUiProcedures;
  selectedThreadId: number | null;
};

/**
 * Keep Pi extension prompts, notifications, editor sync, and title overrides
 * scoped to one controller hook instead of App.tsx.
 */
export function useThreadExtensionUiController({
  activeScreenTitle,
  initialChatInput,
  procedures,
  selectedThreadId,
}: UseThreadExtensionUiControllerParams) {
  const [threadExtensionUiStore, setThreadExtensionUiStore] = useState(
    EMPTY_THREAD_EXTENSION_UI_STORE,
  );
  const [threadExtensionUiDialogDraft, setThreadExtensionUiDialogDraft] =
    useState("");
  const [threadExtensionUiDialogBusy, setThreadExtensionUiDialogBusy] =
    useState(false);
  const [threadExtensionUiDialogError, setThreadExtensionUiDialogError] =
    useState("");
  const threadExtensionUiNotificationTimeoutsRef = useRef(
    new Map<string, number>(),
  );
  const selectedThreadIdRef = useRef<number | null>(selectedThreadId);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  const activeThreadExtensionUiState = useMemo(
    () => readThreadExtensionUiState(threadExtensionUiStore, selectedThreadId),
    [selectedThreadId, threadExtensionUiStore],
  );
  const activeThreadExtensionStatuses = useMemo(
    () => listThreadExtensionUiStatuses(activeThreadExtensionUiState),
    [activeThreadExtensionUiState],
  );
  const activeThreadExtensionWidgetsAbove = useMemo(
    () =>
      listThreadExtensionUiWidgets(activeThreadExtensionUiState, "aboveEditor"),
    [activeThreadExtensionUiState],
  );
  const activeThreadExtensionWidgetsBelow = useMemo(
    () =>
      listThreadExtensionUiWidgets(activeThreadExtensionUiState, "belowEditor"),
    [activeThreadExtensionUiState],
  );
  const currentThreadExtensionUiDialog =
    threadExtensionUiStore.dialogs[0] ?? null;

  const syncThreadExtensionEditor = useCallback(
    (threadId: number | null, text: string): void => {
      if (threadId === null) {
        return;
      }
      void procedures
        .updateThreadExtensionEditor({
          threadId,
          text,
        })
        .catch((error) => {
          console.error("Failed to sync Pi extension editor text", error);
        });
    },
    [procedures],
  );

  const respondToCurrentThreadExtensionUiDialog = useCallback(
    async (value: boolean | string | undefined) => {
      const dialog = currentThreadExtensionUiDialog;
      if (!dialog) {
        return;
      }

      setThreadExtensionUiDialogBusy(true);
      setThreadExtensionUiDialogError("");
      try {
        const response =
          typeof value === "boolean"
            ? {
                requestId: dialog.requestId,
                confirmed: value,
              }
            : typeof value === "string"
              ? {
                  requestId: dialog.requestId,
                  value,
                }
              : {
                  requestId: dialog.requestId,
                  cancelled: true as const,
                };
        await procedures.respondThreadExtensionUi({
          threadId: dialog.threadId,
          response,
        });
        setThreadExtensionUiStore((current) =>
          dismissThreadExtensionUiDialog(current, dialog.requestId),
        );
        setThreadExtensionUiDialogDraft("");
      } catch (error) {
        setThreadExtensionUiDialogError(
          error instanceof Error ? error.message : String(error),
        );
        return;
      } finally {
        setThreadExtensionUiDialogBusy(false);
      }
    },
    [currentThreadExtensionUiDialog, procedures],
  );

  const dismissNotification = useCallback((notificationId: string): void => {
    setThreadExtensionUiStore((current) =>
      dismissThreadExtensionUiNotification(current, notificationId),
    );
  }, []);

  useEffect(() => {
    const dialog = currentThreadExtensionUiDialog;
    setThreadExtensionUiDialogError("");
    setThreadExtensionUiDialogBusy(false);
    if (!dialog) {
      setThreadExtensionUiDialogDraft("");
      return;
    }
    if (dialog.method === "editor") {
      setThreadExtensionUiDialogDraft(dialog.prefill ?? "");
      return;
    }
    if (dialog.method === "input") {
      setThreadExtensionUiDialogDraft("");
      return;
    }
    setThreadExtensionUiDialogDraft("");
  }, [currentThreadExtensionUiDialog]);

  useEffect(() => {
    const handleThreadExtensionUiEvent = (event: Event): void => {
      const request = (event as CustomEvent<RpcThreadExtensionUiRequest>)
        .detail;
      setThreadExtensionUiStore((current) =>
        reduceThreadExtensionUiStore(current, request),
      );

      if (selectedThreadIdRef.current !== request.threadId) {
        return;
      }

      if (request.method === "set_editor_text") {
        setChatComposerDraft(request.text);
        return;
      }
      if (request.method === "append_editor_text") {
        setChatComposerDraft(
          `${readChatComposerDraft(initialChatInput)}${request.text}`,
        );
      }
    };

    window.addEventListener(
      THREAD_EXTENSION_UI_EVENT_NAME,
      handleThreadExtensionUiEvent,
    );
    return () => {
      window.removeEventListener(
        THREAD_EXTENSION_UI_EVENT_NAME,
        handleThreadExtensionUiEvent,
      );
    };
  }, [initialChatInput]);

  useEffect(() => {
    const activeNotificationIds = new Set(
      threadExtensionUiStore.notifications.map(
        (notification) => notification.id,
      ),
    );
    for (const notification of threadExtensionUiStore.notifications) {
      if (
        threadExtensionUiNotificationTimeoutsRef.current.has(notification.id)
      ) {
        continue;
      }
      const timeoutId = window.setTimeout(() => {
        setThreadExtensionUiStore((current) =>
          dismissThreadExtensionUiNotification(current, notification.id),
        );
        threadExtensionUiNotificationTimeoutsRef.current.delete(
          notification.id,
        );
      }, 4_500);
      threadExtensionUiNotificationTimeoutsRef.current.set(
        notification.id,
        timeoutId,
      );
    }
    for (const [
      notificationId,
      timeoutId,
    ] of threadExtensionUiNotificationTimeoutsRef.current) {
      if (activeNotificationIds.has(notificationId)) {
        continue;
      }
      window.clearTimeout(timeoutId);
      threadExtensionUiNotificationTimeoutsRef.current.delete(notificationId);
    }
  }, [threadExtensionUiStore.notifications]);

  useEffect(() => {
    return () => {
      for (const timeoutId of threadExtensionUiNotificationTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      threadExtensionUiNotificationTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    syncThreadExtensionEditor(
      selectedThreadId,
      readChatComposerDraft(initialChatInput),
    );
  }, [initialChatInput, selectedThreadId, syncThreadExtensionEditor]);

  useEffect(() => {
    const nextDocumentTitle =
      activeThreadExtensionUiState?.title?.trim() || activeScreenTitle;
    document.title = nextDocumentTitle
      ? `${nextDocumentTitle} · ${APP_TITLE}`
      : APP_TITLE;
  }, [activeScreenTitle, activeThreadExtensionUiState?.title]);

  return {
    activeThreadExtensionStatuses,
    activeThreadExtensionUiState,
    activeThreadExtensionWidgetsAbove,
    activeThreadExtensionWidgetsBelow,
    currentThreadExtensionUiDialog,
    dismissNotification,
    respondToCurrentThreadExtensionUiDialog,
    syncThreadExtensionEditor,
    threadExtensionUiDialogBusy,
    threadExtensionUiDialogDraft,
    threadExtensionUiDialogError,
    threadExtensionUiNotifications: threadExtensionUiStore.notifications,
    updateThreadExtensionUiDialogDraft: setThreadExtensionUiDialogDraft,
  };
}
