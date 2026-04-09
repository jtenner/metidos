/**
 * @file src/mainview/thread-extension-ui.ts
 * @description Client-side Pi extension UI state helpers.
 */

import type { RpcThreadExtensionUiRequest } from "../bun/rpc-schema";

type ThreadWidgetPlacement = "aboveEditor" | "belowEditor";

export type ThreadExtensionUiDialog = Extract<
  RpcThreadExtensionUiRequest,
  {
    method: "confirm" | "editor" | "input" | "select";
  }
>;

export type ThreadExtensionUiNotification = {
  id: string;
  message: string;
  threadId: number;
  type: "error" | "info" | "warning";
};

export type ThreadExtensionUiWidget = {
  key: string;
  lines: string[];
  placement: ThreadWidgetPlacement;
};

export type ThreadExtensionUiState = {
  editorText: string;
  hiddenThinkingLabel: string | null;
  statuses: Record<string, string>;
  title: string | null;
  widgets: Record<string, ThreadExtensionUiWidget>;
  workingMessage: string | null;
};

export type ThreadExtensionUiStore = {
  dialogs: ThreadExtensionUiDialog[];
  notifications: ThreadExtensionUiNotification[];
  threads: Record<number, ThreadExtensionUiState>;
};

const DEFAULT_THREAD_EXTENSION_UI_STATE: ThreadExtensionUiState = {
  editorText: "",
  hiddenThinkingLabel: null,
  statuses: {},
  title: null,
  widgets: {},
  workingMessage: null,
};

export const EMPTY_THREAD_EXTENSION_UI_STORE: ThreadExtensionUiStore = {
  dialogs: [],
  notifications: [],
  threads: {},
};

function readThreadState(
  store: ThreadExtensionUiStore,
  threadId: number,
): ThreadExtensionUiState {
  return store.threads[threadId] ?? DEFAULT_THREAD_EXTENSION_UI_STATE;
}

function writeThreadState(
  store: ThreadExtensionUiStore,
  threadId: number,
  nextThreadState: ThreadExtensionUiState,
): ThreadExtensionUiStore {
  return {
    ...store,
    threads: {
      ...store.threads,
      [threadId]: nextThreadState,
    },
  };
}

/**
 * Apply a pushed Pi extension UI event to browser state.
 */
export function reduceThreadExtensionUiStore(
  store: ThreadExtensionUiStore,
  event: RpcThreadExtensionUiRequest,
): ThreadExtensionUiStore {
  switch (event.method) {
    case "confirm":
    case "editor":
    case "input":
    case "select":
      if (
        store.dialogs.some((dialog) => dialog.requestId === event.requestId)
      ) {
        return store;
      }
      return {
        ...store,
        dialogs: [...store.dialogs, event],
      };
    case "dismiss_request":
      return {
        ...store,
        dialogs: store.dialogs.filter(
          (dialog) => dialog.requestId !== event.requestId,
        ),
      };
    case "notify":
      return {
        ...store,
        notifications: [
          ...store.notifications,
          {
            id: event.requestId,
            message: event.message,
            threadId: event.threadId,
            type: event.notifyType ?? "info",
          },
        ],
      };
    case "set_status": {
      const threadState = readThreadState(store, event.threadId);
      const nextStatuses = {
        ...threadState.statuses,
      };
      if (event.statusText === null) {
        delete nextStatuses[event.statusKey];
      } else {
        nextStatuses[event.statusKey] = event.statusText;
      }
      return writeThreadState(store, event.threadId, {
        ...threadState,
        statuses: nextStatuses,
      });
    }
    case "set_widget": {
      const threadState = readThreadState(store, event.threadId);
      const nextWidgets = {
        ...threadState.widgets,
      };
      if (event.widgetLines === null) {
        delete nextWidgets[event.widgetKey];
      } else {
        nextWidgets[event.widgetKey] = {
          key: event.widgetKey,
          lines: event.widgetLines,
          placement: event.widgetPlacement ?? "aboveEditor",
        };
      }
      return writeThreadState(store, event.threadId, {
        ...threadState,
        widgets: nextWidgets,
      });
    }
    case "set_title":
      return writeThreadState(store, event.threadId, {
        ...readThreadState(store, event.threadId),
        title: event.title,
      });
    case "set_editor_text":
      return writeThreadState(store, event.threadId, {
        ...readThreadState(store, event.threadId),
        editorText: event.text,
      });
    case "append_editor_text": {
      const threadState = readThreadState(store, event.threadId);
      return writeThreadState(store, event.threadId, {
        ...threadState,
        editorText: `${threadState.editorText}${event.text}`,
      });
    }
    case "set_working_message":
      return writeThreadState(store, event.threadId, {
        ...readThreadState(store, event.threadId),
        workingMessage: event.message,
      });
    case "set_hidden_thinking_label":
      return writeThreadState(store, event.threadId, {
        ...readThreadState(store, event.threadId),
        hiddenThinkingLabel: event.label,
      });
  }

  return store;
}

export function dismissThreadExtensionUiDialog(
  store: ThreadExtensionUiStore,
  requestId: string,
): ThreadExtensionUiStore {
  return {
    ...store,
    dialogs: store.dialogs.filter((dialog) => dialog.requestId !== requestId),
  };
}

export function dismissThreadExtensionUiNotification(
  store: ThreadExtensionUiStore,
  notificationId: string,
): ThreadExtensionUiStore {
  return {
    ...store,
    notifications: store.notifications.filter(
      (notification) => notification.id !== notificationId,
    ),
  };
}

export function listThreadExtensionUiStatuses(
  state: ThreadExtensionUiState | null | undefined,
): Array<{
  key: string;
  text: string;
}> {
  if (!state) {
    return [];
  }
  return Object.entries(state.statuses)
    .map(([key, text]) => ({
      key,
      text,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function listThreadExtensionUiWidgets(
  state: ThreadExtensionUiState | null | undefined,
  placement: ThreadWidgetPlacement,
): ThreadExtensionUiWidget[] {
  if (!state) {
    return [];
  }
  return Object.values(state.widgets)
    .filter((widget) => widget.placement === placement)
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function readThreadExtensionUiState(
  store: ThreadExtensionUiStore,
  threadId: number | null,
): ThreadExtensionUiState | null {
  if (threadId === null) {
    return null;
  }
  return readThreadState(store, threadId);
}
