import { expect, test } from "bun:test";

import {
  dismissThreadExtensionUiNotification,
  EMPTY_THREAD_EXTENSION_UI_STORE,
  listThreadExtensionUiStatuses,
  listThreadExtensionUiWidgets,
  readThreadExtensionUiState,
  reduceThreadExtensionUiStore,
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

  expect(store.dialogs).toHaveLength(1);
  const state = readThreadExtensionUiState(store, 7);
  expect(state?.editorText).toBe("hello world");
  expect(state?.hiddenThinkingLabel).toBe("Pi trace");
  expect(state?.workingMessage).toBe("Indexing workspace");
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
