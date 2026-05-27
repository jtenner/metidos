import { expect, test } from "bun:test";
import type { RpcThreadExtensionUiRequest } from "../rpc-schema";
import { createPiThreadExtensionUiBridge } from "./extension-ui";

test("Pi extension UI dialogs fall back to defaults when no browser listener is connected", async () => {
  const bridge = createPiThreadExtensionUiBridge();
  const ui = bridge.bindingsForThread(7, null).uiContext;
  if (!ui) {
    throw new Error("Expected a UI context binding.");
  }

  await expect(ui.confirm("Confirm", "Continue?")).resolves.toBeFalse();
  await expect(ui.input("Input")).resolves.toBeUndefined();
  await expect(ui.select("Pick", ["a", "b"])).resolves.toBeUndefined();
  await expect(ui.editor("Edit", "draft")).resolves.toBeUndefined();
});

test("Pi extension UI dialogs round-trip browser responses through the bridge", async () => {
  const bridge = createPiThreadExtensionUiBridge();
  const pendingRequests: Array<{ method: string; requestId: string }> = [];
  bridge.setMessageListener((request) => {
    pendingRequests.push({
      method: request.method,
      requestId: request.requestId,
    });
    return true;
  });
  const ui = bridge.bindingsForThread(11, null).uiContext;
  if (!ui) {
    throw new Error("Expected a UI context binding.");
  }

  expect(
    bridge.handleResponse(11, {
      requestId: "missing",
      cancelled: true,
    }),
  ).toBeFalse();

  const confirmPromise2 = ui.confirm("Confirm", "Continue?");
  const inputPromise2 = ui.input("Input", "Value");
  const selectPromise2 = ui.select("Select", ["Alpha", "Beta"]);
  const editorPromise2 = ui.editor("Editor", "prefill");

  const confirmRequest = pendingRequests.find(
    (request) => request.method === "confirm",
  );
  const inputRequest = pendingRequests.find(
    (request) => request.method === "input",
  );
  const selectRequest = pendingRequests.find(
    (request) => request.method === "select",
  );
  const editorRequest = pendingRequests.find(
    (request) => request.method === "editor",
  );

  if (!confirmRequest || !inputRequest || !selectRequest || !editorRequest) {
    throw new Error("Expected all prompt requests to be emitted.");
  }

  expect(
    bridge.handleResponse(11, {
      requestId: confirmRequest.requestId,
      confirmed: true,
    }),
  ).toBeTrue();
  expect(
    bridge.handleResponse(11, {
      requestId: inputRequest.requestId,
      value: "typed value",
    }),
  ).toBeTrue();
  expect(
    bridge.handleResponse(11, {
      requestId: selectRequest.requestId,
      value: "Beta",
    }),
  ).toBeTrue();
  expect(
    bridge.handleResponse(11, {
      requestId: editorRequest.requestId,
      value: "edited text",
    }),
  ).toBeTrue();

  await expect(confirmPromise2).resolves.toBeTrue();
  await expect(inputPromise2).resolves.toBe("typed value");
  await expect(selectPromise2).resolves.toBe("Beta");
  await expect(editorPromise2).resolves.toBe("edited text");
});

test("Pi extension UI requests carry session metadata to the browser listener", () => {
  const bridge = createPiThreadExtensionUiBridge();
  const deliveries: Array<{ method: string; sessionId: string | null }> = [];
  bridge.setMessageListener((request, sessionId) => {
    deliveries.push({ method: request.method, sessionId });
    return true;
  });

  const ui = bridge.bindingsForThread(9, "session-212").uiContext;
  ui.notify("Owned message", "info");

  expect(deliveries).toEqual([{ method: "notify", sessionId: "session-212" }]);
});

test("Pi extension UI dialogs resolve synchronous listener responses", async () => {
  const bridge = createPiThreadExtensionUiBridge();
  bridge.setMessageListener((request) => {
    if (request.method === "input") {
      expect(
        bridge.handleResponse(request.threadId, {
          requestId: request.requestId,
          value: "inline value",
        }),
      ).toBeTrue();
    }
    return true;
  });
  const ui = bridge.bindingsForThread(13, null).uiContext;
  if (!ui) {
    throw new Error("Expected a UI context binding.");
  }

  await expect(ui.input("Input")).resolves.toBe("inline value");
});

test("Pi extension UI editor dialogs forward options into request payloads", async () => {
  const bridge = createPiThreadExtensionUiBridge();
  const editorRequests: Extract<
    RpcThreadExtensionUiRequest,
    { method: "editor" }
  >[] = [];
  bridge.setMessageListener((request) => {
    if (request.method === "editor") {
      editorRequests.push(request);
      queueMicrotask(() => {
        bridge.handleResponse(request.threadId, {
          requestId: request.requestId,
          value: "edited with opts",
        });
      });
    }
    return true;
  });
  const ui = bridge.bindingsForThread(14, null).uiContext;
  if (!ui) {
    throw new Error("Expected a UI context binding.");
  }

  const editor = ui.editor as (
    title: string,
    prefill?: string,
    opts?: { timeout?: number },
  ) => Promise<string | undefined>;
  await expect(editor("Editor", "prefill", { timeout: 1234 })).resolves.toBe(
    "edited with opts",
  );
  expect(editorRequests[0]?.timeoutMs).toBe(1234);
});

test("Pi extension UI bridge tracks editor text and emits browser update events", () => {
  const bridge = createPiThreadExtensionUiBridge();
  const requests: string[] = [];
  bridge.setMessageListener((request) => {
    requests.push(request.method);
    return true;
  });
  const ui = bridge.bindingsForThread(5, null).uiContext;
  if (!ui) {
    throw new Error("Expected a UI context binding.");
  }

  bridge.updateEditorText(5, "seed");
  expect(ui.getEditorText()).toBe("seed");

  ui.setEditorText("hello");
  expect(ui.getEditorText()).toBe("hello");

  ui.pasteToEditor(" world");
  expect(ui.getEditorText()).toBe("hello world");

  ui.setStatus("branch", "main");
  ui.setWidget("summary", ["line one", "line two"]);
  ui.setWorkingMessage("Indexing workspace");
  ui.setWorkingVisible(false);
  ui.setHiddenThinkingLabel("Pi trace");
  ui.setTitle("Extension title");
  ui.notify("Heads up", "warning");

  expect(requests).toEqual([
    "set_editor_text",
    "append_editor_text",
    "set_status",
    "set_widget",
    "set_working_message",
    "set_working_visible",
    "set_hidden_thinking_label",
    "set_title",
    "notify",
  ]);
});
