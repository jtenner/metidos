/**
 * @file src/bun/pi/extension-ui.ts
 * @description Pi extension UI bridge for Metidos's browser runtime.
 */

import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
} from "@mariozechner/pi-coding-agent";

import type {
  RpcThreadExtensionUiRequest,
  RpcThreadExtensionUiResponse,
} from "../rpc-schema";

type ThreadUiMessageListener = (
  request: RpcThreadExtensionUiRequest,
  sessionId: string | null,
) => boolean | undefined;

type PendingDialogRequest = {
  finish: (value: boolean | string | undefined, dismiss: boolean) => void;
  kind: "confirm" | "editor" | "input" | "select";
};

type CreateDialogRequest = {
  method: PendingDialogRequest["kind"];
  title: string;
  options?: string[];
  message?: string;
  placeholder?: string;
  prefill?: string;
};

const UNSUPPORTED_THEME_RESULT = "Theme changes are not supported in Metidos.";

/**
 * Per-process Pi extension UI bridge used by thread runtimes.
 */
export type PiThreadExtensionUiBridge = {
  bindingsForThread: (
    threadId: number,
    sessionId: string | null,
  ) => {
    uiContext: ExtensionUIContext;
  };
  clearThread: (threadId: number) => void;
  handleResponse: (
    threadId: number,
    response: RpcThreadExtensionUiResponse,
  ) => boolean;
  setMessageListener: (listener: ThreadUiMessageListener | null) => void;
  updateEditorText: (threadId: number, text: string) => void;
};

function isResponseCancelled(
  response: RpcThreadExtensionUiResponse,
): response is Extract<RpcThreadExtensionUiResponse, { cancelled: true }> {
  return "cancelled" in response && response.cancelled === true;
}

function isResponseConfirmed(
  response: RpcThreadExtensionUiResponse,
): response is Extract<RpcThreadExtensionUiResponse, { confirmed: boolean }> {
  return "confirmed" in response && typeof response.confirmed === "boolean";
}

function isResponseValue(
  response: RpcThreadExtensionUiResponse,
): response is Extract<RpcThreadExtensionUiResponse, { value: string }> {
  return "value" in response && typeof response.value === "string";
}

function buildDismissRequest(
  threadId: number,
  requestId: string,
): Extract<RpcThreadExtensionUiRequest, { method: "dismiss_request" }> {
  return {
    threadId,
    requestId,
    method: "dismiss_request",
  };
}

/**
 * Create the shared Pi extension UI bridge.
 */
export function createPiThreadExtensionUiBridge(): PiThreadExtensionUiBridge {
  const pendingRequestsByThread = new Map<
    number,
    Map<string, PendingDialogRequest>
  >();
  const editorTextByThread = new Map<number, string>();
  const sessionIdByThread = new Map<number, string | null>();
  let messageListener: ThreadUiMessageListener | null = null;

  const emitRequest = (request: RpcThreadExtensionUiRequest): boolean => {
    if (!sessionIdByThread.has(request.threadId)) {
      return false;
    }
    return (
      messageListener?.(
        request,
        sessionIdByThread.get(request.threadId) ?? null,
      ) === true
    );
  };

  const dismissRequest = (threadId: number, requestId: string): void => {
    if (messageListener === null) {
      return;
    }
    emitRequest(buildDismissRequest(threadId, requestId));
  };

  const deletePendingRequest = (threadId: number, requestId: string): void => {
    const threadPendingRequests = pendingRequestsByThread.get(threadId);
    if (!threadPendingRequests) {
      return;
    }
    threadPendingRequests.delete(requestId);
    if (threadPendingRequests.size === 0) {
      pendingRequestsByThread.delete(threadId);
    }
  };

  const createDialogPromise = <TValue>(
    threadId: number,
    defaultValue: TValue,
    opts: ExtensionUIDialogOptions | undefined,
    request: CreateDialogRequest,
    parseResponse: (response: RpcThreadExtensionUiResponse) => TValue,
  ): Promise<TValue> => {
    if (opts?.signal?.aborted) {
      return Promise.resolve(defaultValue);
    }

    const requestId = crypto.randomUUID();
    const requestPayload: RpcThreadExtensionUiRequest =
      request.method === "select"
        ? {
            threadId,
            requestId,
            method: "select",
            title: request.title,
            options: request.options ?? [],
            ...(typeof opts?.timeout === "number"
              ? {
                  timeoutMs: opts.timeout,
                }
              : {}),
          }
        : request.method === "confirm"
          ? {
              threadId,
              requestId,
              method: "confirm",
              title: request.title,
              message: request.message ?? "",
              ...(typeof opts?.timeout === "number"
                ? {
                    timeoutMs: opts.timeout,
                  }
                : {}),
            }
          : request.method === "input"
            ? {
                threadId,
                requestId,
                method: "input",
                title: request.title,
                ...(typeof request.placeholder === "string"
                  ? {
                      placeholder: request.placeholder,
                    }
                  : {}),
                ...(typeof opts?.timeout === "number"
                  ? {
                      timeoutMs: opts.timeout,
                    }
                  : {}),
              }
            : {
                threadId,
                requestId,
                method: "editor",
                title: request.title,
                ...(typeof request.prefill === "string"
                  ? {
                      prefill: request.prefill,
                    }
                  : {}),
                ...(typeof opts?.timeout === "number"
                  ? {
                      timeoutMs: opts.timeout,
                    }
                  : {}),
              };

    return new Promise<TValue>((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = (): void => {
        if (opts?.signal) {
          opts.signal.removeEventListener("abort", handleAbort);
        }
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        deletePendingRequest(threadId, requestId);
      };

      const finish = (value: TValue, dismiss: boolean): void => {
        cleanup();
        if (dismiss) {
          dismissRequest(threadId, requestId);
        }
        resolve(value);
      };

      function handleAbort(): void {
        finish(defaultValue, true);
      }

      const threadPendingRequests =
        pendingRequestsByThread.get(threadId) ??
        new Map<string, PendingDialogRequest>();
      threadPendingRequests.set(requestId, {
        finish: (value, dismiss) => {
          finish(
            parseResponse(
              value === undefined
                ? {
                    requestId,
                    cancelled: true,
                  }
                : typeof value === "boolean"
                  ? {
                      requestId,
                      confirmed: value,
                    }
                  : {
                      requestId,
                      value,
                    },
            ),
            dismiss,
          );
        },
        kind: request.method,
      });
      pendingRequestsByThread.set(threadId, threadPendingRequests);

      if (opts?.signal) {
        opts.signal.addEventListener("abort", handleAbort, {
          once: true,
        });
      }
      timeoutId =
        typeof opts?.timeout === "number" && opts.timeout >= 0
          ? setTimeout(() => {
              finish(defaultValue, true);
            }, opts.timeout)
          : null;

      if (opts?.signal?.aborted) {
        finish(defaultValue, true);
        return;
      }

      if (!emitRequest(requestPayload)) {
        finish(defaultValue, false);
      }
    });
  };

  const createUiContext = (threadId: number): ExtensionUIContext => ({
    select: (title, options, opts) =>
      createDialogPromise(
        threadId,
        undefined,
        opts,
        {
          method: "select",
          options,
          title,
        },
        (response) => {
          if (isResponseCancelled(response) || !isResponseValue(response)) {
            return undefined;
          }
          return response.value;
        },
      ),
    confirm: (title, message, opts) =>
      createDialogPromise(
        threadId,
        false,
        opts,
        {
          method: "confirm",
          message,
          title,
        },
        (response) => {
          if (isResponseCancelled(response) || !isResponseConfirmed(response)) {
            return false;
          }
          return response.confirmed;
        },
      ),
    input: (title, placeholder, opts) =>
      createDialogPromise(
        threadId,
        undefined,
        opts,
        {
          method: "input",
          title,
          ...(typeof placeholder === "string"
            ? {
                placeholder,
              }
            : {}),
        },
        (response) => {
          if (isResponseCancelled(response) || !isResponseValue(response)) {
            return undefined;
          }
          return response.value;
        },
      ),
    notify(message, type) {
      emitRequest({
        threadId,
        requestId: crypto.randomUUID(),
        method: "notify",
        message,
        ...(typeof type === "string"
          ? {
              notifyType: type,
            }
          : {}),
      });
    },
    onTerminalInput() {
      return () => undefined;
    },
    setStatus(key, text) {
      emitRequest({
        threadId,
        requestId: crypto.randomUUID(),
        method: "set_status",
        statusKey: key,
        statusText: text ?? null,
      });
    },
    setWorkingMessage(message) {
      emitRequest({
        threadId,
        requestId: crypto.randomUUID(),
        method: "set_working_message",
        message: message ?? null,
      });
    },
    setWorkingVisible(visible) {
      emitRequest({
        threadId,
        requestId: crypto.randomUUID(),
        method: "set_working_visible",
        visible,
      });
    },
    setWorkingIndicator() {
      return;
    },
    setHiddenThinkingLabel(label) {
      emitRequest({
        threadId,
        requestId: crypto.randomUUID(),
        method: "set_hidden_thinking_label",
        label: label ?? null,
      });
    },
    setWidget(key, content, options) {
      if (content !== undefined && !Array.isArray(content)) {
        return;
      }
      emitRequest({
        threadId,
        requestId: crypto.randomUUID(),
        method: "set_widget",
        widgetKey: key,
        widgetLines: content ?? null,
        ...(typeof options?.placement === "string"
          ? {
              widgetPlacement: options.placement,
            }
          : {}),
      });
    },
    setFooter() {
      return;
    },
    setHeader() {
      return;
    },
    setTitle(title) {
      emitRequest({
        threadId,
        requestId: crypto.randomUUID(),
        method: "set_title",
        title,
      });
    },
    async custom<T>() {
      return undefined as T;
    },
    pasteToEditor(text) {
      editorTextByThread.set(
        threadId,
        `${editorTextByThread.get(threadId) ?? ""}${text}`,
      );
      emitRequest({
        threadId,
        requestId: crypto.randomUUID(),
        method: "append_editor_text",
        text,
      });
    },
    setEditorText(text) {
      editorTextByThread.set(threadId, text);
      emitRequest({
        threadId,
        requestId: crypto.randomUUID(),
        method: "set_editor_text",
        text,
      });
    },
    getEditorText() {
      return editorTextByThread.get(threadId) ?? "";
    },
    editor: (
      title: string,
      prefill?: string,
      opts?: ExtensionUIDialogOptions,
    ) =>
      createDialogPromise(
        threadId,
        undefined,
        opts,
        {
          method: "editor",
          title,
          ...(typeof prefill === "string"
            ? {
                prefill,
              }
            : {}),
        },
        (response) => {
          if (isResponseCancelled(response) || !isResponseValue(response)) {
            return undefined;
          }
          return response.value;
        },
      ),
    addAutocompleteProvider() {
      return;
    },
    setEditorComponent() {
      return;
    },
    getEditorComponent() {
      return undefined;
    },
    get theme() {
      return {} as ExtensionUIContext["theme"];
    },
    getAllThemes() {
      return [];
    },
    getTheme() {
      return undefined;
    },
    setTheme() {
      return {
        success: false,
        error: UNSUPPORTED_THEME_RESULT,
      };
    },
    getToolsExpanded() {
      return false;
    },
    setToolsExpanded() {
      return;
    },
  });

  return {
    bindingsForThread(threadId, sessionId) {
      sessionIdByThread.set(threadId, sessionId);
      return {
        uiContext: createUiContext(threadId),
      };
    },
    clearThread(threadId) {
      editorTextByThread.delete(threadId);
      sessionIdByThread.delete(threadId);
      const threadPendingRequests = pendingRequestsByThread.get(threadId);
      if (!threadPendingRequests) {
        return;
      }
      pendingRequestsByThread.delete(threadId);
      for (const pending of threadPendingRequests.values()) {
        pending.finish(undefined, true);
      }
    },
    handleResponse(threadId, response) {
      const threadPendingRequests = pendingRequestsByThread.get(threadId);
      if (!threadPendingRequests) {
        return false;
      }
      const pending = threadPendingRequests.get(response.requestId);
      if (!pending) {
        return false;
      }

      if (isResponseCancelled(response)) {
        pending.finish(undefined, false);
        return true;
      }

      switch (pending.kind) {
        case "confirm":
          pending.finish(
            isResponseConfirmed(response) ? response.confirmed : false,
            false,
          );
          return true;
        case "editor":
        case "input":
        case "select":
          pending.finish(
            isResponseValue(response) ? response.value : undefined,
            false,
          );
          return true;
        default: {
          const exhaustiveKind: never = pending.kind;
          throw new Error(
            `Unhandled extension UI request kind: ${exhaustiveKind}`,
          );
        }
      }
    },
    setMessageListener(listener) {
      messageListener = listener;
    },
    updateEditorText(threadId, text) {
      editorTextByThread.set(threadId, text);
    },
  };
}
