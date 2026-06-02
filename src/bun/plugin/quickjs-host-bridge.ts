/**
 * @file src/bun/plugin/quickjs-host-bridge.ts
 * @description Internal QuickJS host-operation bridge helpers for Plugin System v1 runtime capabilities.
 */

const MAX_QUICKJS_HOST_BRIDGE_PAYLOAD_BYTES = 8 * 1024 * 1024;
const TEXT_ENCODER = new TextEncoder();

export type QuickJSHostBridgeHandle = {
  dispose: () => void;
};

export type QuickJSHostBridgeDeferredPromise = {
  handle: QuickJSHostBridgeHandle;
  resolve: (value: QuickJSHostBridgeHandle) => void;
  reject: (value: QuickJSHostBridgeHandle) => void;
  settled: Promise<unknown>;
};

export type QuickJSHostBridgeExecutePendingJobsResult =
  | { error: QuickJSHostBridgeHandle; value?: never }
  | { error?: never; value: number };

export type QuickJSHostBridgeContext = {
  dump: (handle: QuickJSHostBridgeHandle) => unknown;
  global: QuickJSHostBridgeHandle;
  newFunction: (
    name: string,
    fn: (...args: QuickJSHostBridgeHandle[]) => QuickJSHostBridgeHandle,
  ) => QuickJSHostBridgeHandle;
  newPromise: () => QuickJSHostBridgeDeferredPromise;
  newString: (value: string) => QuickJSHostBridgeHandle;
  setProp: (
    target: QuickJSHostBridgeHandle,
    key: string,
    value: QuickJSHostBridgeHandle,
  ) => void;
};

export type QuickJSHostBridgeRuntime = {
  executePendingJobs: () => QuickJSHostBridgeExecutePendingJobsResult;
};

export type QuickJSHostOperationInput<TRequest, TResult> = {
  context: QuickJSHostBridgeContext;
  errorName: string;
  execute: (request: TRequest) => Promise<TResult> | TResult;
  globalName: string;
  readRequest: (input: {
    args: QuickJSHostBridgeHandle[];
    context: QuickJSHostBridgeContext;
  }) => TRequest;
  runtime: QuickJSHostBridgeRuntime;
  serializeSuccess?: (result: TResult) => string;
};

export function hostErrorCode(error: unknown): unknown {
  return error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}

export function pluginHostErrorPayload(input: {
  code?: unknown;
  message: string;
  name: string;
}): string {
  return JSON.stringify({
    error: {
      ...(typeof input.code === "string" ? { code: input.code } : {}),
      message: input.message,
      name: input.name,
    },
    ok: false,
  });
}

export function drainQuickJsHostPendingJobs(input: {
  runtime: QuickJSHostBridgeRuntime;
}): void {
  try {
    const jobsResult = input.runtime.executePendingJobs();
    if ("error" in jobsResult) {
      jobsResult.error.dispose();
    }
  } catch {
    // Host promise continuations are fire-and-forget; callback invocation drains
    // pending jobs synchronously and reports controlled plugin diagnostics.
  }
}

function defaultQuickJsHostSuccessPayload<TResult>(result: TResult): string {
  return JSON.stringify({ ok: true, result });
}

function quickJsHostFailurePayload(
  error: unknown,
  fallbackName: string,
): string {
  return pluginHostErrorPayload({
    code: hostErrorCode(error),
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : fallbackName,
  });
}

function assertQuickJsHostPayloadSize(payload: string): void {
  const byteLength = TEXT_ENCODER.encode(payload).byteLength;
  if (byteLength > MAX_QUICKJS_HOST_BRIDGE_PAYLOAD_BYTES) {
    throw Object.assign(
      new Error(
        `QuickJS host bridge payload exceeded ${MAX_QUICKJS_HOST_BRIDGE_PAYLOAD_BYTES} bytes.`,
      ),
      { code: "quickjs_host_payload_too_large" },
    );
  }
}

function resolveQuickJsHostPromise(input: {
  context: QuickJSHostBridgeContext;
  errorName: string;
  payload: string;
  promise: QuickJSHostBridgeDeferredPromise;
}): void {
  try {
    assertQuickJsHostPayloadSize(input.payload);
    const handle = input.context.newString(input.payload);
    input.promise.resolve(handle);
    handle.dispose();
  } catch (error) {
    const handle = input.context.newString(
      quickJsHostFailurePayload(error, input.errorName),
    );
    input.promise.resolve(handle);
    handle.dispose();
  }
}

export function installQuickJsHostOperation<TRequest, TResult>(
  input: QuickJSHostOperationInput<TRequest, TResult>,
): void {
  // Host capability bindings are intentionally plain global functions because
  // the generated plugin bootstrap calls them by name from the guest realm.
  // Guest code may shadow or replace these properties later, but that only
  // sabotages that plugin's own `metidos` API calls: authorization, parameter
  // validation, path/network policy, and resource limits are enforced again by
  // the host-side `execute` implementation below. Do not treat the presence or
  // identity of a guest-visible global as an authorization boundary.
  const hostFunction = input.context.newFunction(
    input.globalName,
    (...args) => {
      const request = input.readRequest({ args, context: input.context });
      const promise = input.context.newPromise();
      Promise.resolve()
        .then(() => input.execute(request))
        .then(
          input.serializeSuccess ?? defaultQuickJsHostSuccessPayload<TResult>,
        )
        .catch((error: unknown) =>
          quickJsHostFailurePayload(error, input.errorName),
        )
        .then((payload) => {
          resolveQuickJsHostPromise({
            context: input.context,
            errorName: input.errorName,
            payload,
            promise,
          });
        });
      void promise.settled.then(() => {
        drainQuickJsHostPendingJobs(input);
      });
      return promise.handle;
    },
  );
  input.context.setProp(input.context.global, input.globalName, hostFunction);
  hostFunction.dispose();
}
