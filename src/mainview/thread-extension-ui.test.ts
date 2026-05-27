import { expect, test } from "bun:test";
import { shouldSyncThreadExtensionEditor } from "./app/use-thread-extension-ui-controller";
import {
  dismissThreadExtensionUiNotification,
  EMPTY_THREAD_EXTENSION_UI_STORE,
  listThreadExtensionUiStatuses,
  listThreadExtensionUiWidgets,
  readThreadExtensionUiState,
  reduceThreadExtensionUiStore,
  THREAD_EXTENSION_UI_NOTIFICATION_MAX_ENTRIES,
  THREAD_EXTENSION_UI_THREAD_STATE_MAX_ENTRIES,
} from "./thread-extension-ui";

test("reduces Pi extension dialog, status, widget, and editor events into browser state", () => {
  let store = EMPTY_THREAD_EXTENSION_UI_STORE;
  store = reduceThreadExtensionUiStore(store, {
    method: "select",
    options: ["Alpha", "Beta"],
    requestId: "req-1",
    threadId: 7,
    title: "Choose one",
  });
  store = reduceThreadExtensionUiStore(store, {
    method: "set_status",
    requestId: "status-1",
    statusKey: "branch",
    statusText: "main",
    threadId: 7,
  });
  store = reduceThreadExtensionUiStore(store, {
    method: "set_widget",
    requestId: "widget-1",
    threadId: 7,
    widgetKey: "summary",
    widgetLines: ["line one", "line two"],
    widgetPlacement: "belowEditor",
  });
  store = reduceThreadExtensionUiStore(store, {
    method: "set_editor_text",
    requestId: "editor-1",
    text: "hello",
    threadId: 7,
  });
  store = reduceThreadExtensionUiStore(store, {
    method: "append_editor_text",
    requestId: "editor-2",
    text: " world",
    threadId: 7,
  });
  store = reduceThreadExtensionUiStore(store, {
    label: "Pi trace",
    method: "set_hidden_thinking_label",
    requestId: "thinking-1",
    threadId: 7,
  });
  store = reduceThreadExtensionUiStore(store, {
    message: "Indexing workspace",
    method: "set_working_message",
    requestId: "working-1",
    threadId: 7,
  });
  store = reduceThreadExtensionUiStore(store, {
    method: "set_working_visible",
    requestId: "working-visible-1",
    threadId: 7,
    visible: false,
  });

  expect(store.dialogs).toHaveLength(1);
  const state = readThreadExtensionUiState(store, 7);
  expect(state?.editorText).toBe("hello world");
  expect(state?.hiddenThinkingLabel).toBe("Pi trace");
  expect(state?.workingMessage).toBe("Indexing workspace");
  expect(state?.workingVisible).toBe(false);
  expect(listThreadExtensionUiStatuses(state)).toEqual([
    {
      key: "branch",
      text: "main",
    },
  ]);
  expect(listThreadExtensionUiWidgets(state, "belowEditor")).toEqual([
    {
      key: "summary",
      lines: ["line one", "line two"],
      placement: "belowEditor",
    },
  ]);
});

test("notifications can be added and dismissed", () => {
  let store = reduceThreadExtensionUiStore(EMPTY_THREAD_EXTENSION_UI_STORE, {
    message: "Heads up",
    method: "notify",
    notifyType: "warning",
    requestId: "note-1",
    threadId: 3,
  });

  expect(store.notifications).toEqual([
    {
      id: "note-1",
      message: "Heads up",
      threadId: 3,
      type: "warning",
    },
  ]);

  store = dismissThreadExtensionUiNotification(store, "note-1");
  expect(store.notifications).toHaveLength(0);
});

test("extension UI thread state is bounded while preserving the active update", () => {
  let store = EMPTY_THREAD_EXTENSION_UI_STORE;
  for (
    let threadId = 1;
    threadId <= THREAD_EXTENSION_UI_THREAD_STATE_MAX_ENTRIES + 1;
    threadId += 1
  ) {
    store = reduceThreadExtensionUiStore(store, {
      method: "set_status",
      requestId: `status-${threadId}`,
      statusKey: "status",
      statusText: `thread-${threadId}`,
      threadId,
    });
  }

  expect(Object.keys(store.threads)).toHaveLength(
    THREAD_EXTENSION_UI_THREAD_STATE_MAX_ENTRIES,
  );
  expect(readThreadExtensionUiState(store, 1)?.statuses.status).toBeUndefined();
  expect(
    readThreadExtensionUiState(
      store,
      THREAD_EXTENSION_UI_THREAD_STATE_MAX_ENTRIES + 1,
    )?.statuses.status,
  ).toBe(`thread-${THREAD_EXTENSION_UI_THREAD_STATE_MAX_ENTRIES + 1}`);
});

test("extension UI notifications are bounded", () => {
  let store = EMPTY_THREAD_EXTENSION_UI_STORE;
  for (
    let notificationId = 1;
    notificationId <= THREAD_EXTENSION_UI_NOTIFICATION_MAX_ENTRIES + 1;
    notificationId += 1
  ) {
    store = reduceThreadExtensionUiStore(store, {
      message: `Notification ${notificationId}`,
      method: "notify",
      requestId: `note-${notificationId}`,
      threadId: 3,
    });
  }

  expect(store.notifications).toHaveLength(
    THREAD_EXTENSION_UI_NOTIFICATION_MAX_ENTRIES,
  );
  expect(store.notifications[0]?.id).toBe("note-2");
  expect(store.notifications.at(-1)?.id).toBe(
    `note-${THREAD_EXTENSION_UI_NOTIFICATION_MAX_ENTRIES + 1}`,
  );
});

test("extension editor sync only targets persisted thread ids", () => {
  expect(shouldSyncThreadExtensionEditor(null)).toBe(false);
  expect(shouldSyncThreadExtensionEditor(-1)).toBe(false);
  expect(shouldSyncThreadExtensionEditor(0)).toBe(false);
  expect(shouldSyncThreadExtensionEditor(7)).toBe(true);
});
