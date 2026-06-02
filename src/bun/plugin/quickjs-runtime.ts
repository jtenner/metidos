/**
 * @file src/bun/plugin/quickjs-runtime.ts
 * @description Restricted QuickJS execution boundary for Plugin System v1 sidecars.
 */

import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import type { PluginEntrypointBuildResult } from "./entrypoint-build";
import {
  executePluginHostCalendarEventsOperation,
  executePluginHostEmbeddingsOperation,
  executePluginHostFetchOperation,
  executePluginHostFsOperation,
  executePluginHostLanceDbOperation,
  executePluginHostLogOperation,
  executePluginHostNotificationSendOperation,
  executePluginHostSqliteOperation,
  executePluginHostTerminalOperation,
  executePluginHostWebSocketOperation,
} from "./host-capabilities";
import {
  hostErrorCode,
  installQuickJsHostOperation,
} from "./quickjs-host-bridge";
import { pluginJavaScriptBootstrapSource } from "./plugin-api-runtime";
import type {
  PluginRuntimeApiOptions,
  PluginRuntimeCalendarEventsCaller,
  PluginRuntimeCallbackInput,
  PluginRuntimeFsCaller,
  PluginRuntimeInstance,
  PluginRuntimeLogger,
  PluginRuntimeNotificationSender,
  PluginRuntimeOptions,
  PluginRuntimeResult,
  PluginRuntimeSqliteCaller,
  PluginRuntimeTerminalCaller,
  PluginRuntimeWebSocketCaller,
} from "./plugin-runtime-contract";
import { createSubsystemLogger } from "../logging";
import { executePluginStructuredDataOperation } from "./host-structured-data";

const logger = createSubsystemLogger("Plugin QuickJS Runtime");

const require = createRequire(import.meta.url);
const quickjsPackage = require("@tootallnate/quickjs-emscripten") as {
  getQuickJS: () => Promise<QuickJSWasmModule>;
  shouldInterruptAfterDeadline: (
    deadline: Date | number,
  ) => QuickJSInterruptHandler;
};

export const DEFAULT_PLUGIN_QUICKJS_STARTUP_TIMEOUT_MS = 60_000;
export const DEFAULT_PLUGIN_QUICKJS_MEMORY_LIMIT_BYTES = 128 * 1024 * 1024;
const DEFAULT_PLUGIN_QUICKJS_STACK_SIZE_BYTES = 1024 * 1024;

type QuickJSInterruptHandler = (...args: unknown[]) => boolean;

type QuickJSHandle = {
  dispose: () => void;
};

type QuickJSDeferredPromise = {
  handle: QuickJSHandle;
  resolve: (value: QuickJSHandle) => void;
  reject: (value: QuickJSHandle) => void;
  settled: Promise<unknown>;
};

type QuickJSVmResult =
  | { error: QuickJSHandle; value?: never }
  | { error?: never; value: QuickJSHandle };

type QuickJSContext = {
  dispose: () => void;
  dump: (handle: QuickJSHandle) => unknown;
  evalCode: (
    code: string,
    filename?: string,
    options?: { type?: "global" | "module" },
  ) => QuickJSVmResult;
  global: QuickJSHandle;
  newFunction: (
    name: string,
    fn: (...args: QuickJSHandle[]) => QuickJSHandle,
  ) => QuickJSHandle;
  newPromise: () => QuickJSDeferredPromise;
  newString: (value: string) => QuickJSHandle;
  resolvePromise: (handle: QuickJSHandle) => Promise<QuickJSVmResult>;
  setProp: (target: QuickJSHandle, key: string, value: QuickJSHandle) => void;
  unwrapResult: (result: QuickJSVmResult) => QuickJSHandle;
};

type QuickJSExecutePendingJobsResult =
  | { error: QuickJSHandle; value?: never }
  | { error?: never; value: number };

type QuickJSRuntime = {
  dispose: () => void;
  executePendingJobs: (
    maxJobsToExecute?: number,
  ) => QuickJSExecutePendingJobsResult;
  hasPendingJob: () => boolean;
  newContext: () => QuickJSContext;
  setInterruptHandler: (handler: QuickJSInterruptHandler) => void;
  setMaxStackSize: (stackSize: number) => void;
  setMemoryLimit: (limitBytes: number) => void;
};

type QuickJSWasmModule = {
  newRuntime: () => QuickJSRuntime;
};

export type PluginQuickJsRuntimeNotificationSender =
  PluginRuntimeNotificationSender;
export type PluginQuickJsRuntimeCalendarEventsCaller =
  PluginRuntimeCalendarEventsCaller;
export type PluginQuickJsRuntimeTerminalCaller = PluginRuntimeTerminalCaller;
export type PluginQuickJsRuntimeSqliteCaller = PluginRuntimeSqliteCaller;
export type PluginQuickJsRuntimeLogger = PluginRuntimeLogger;
export type PluginQuickJsRuntimeFsCaller = PluginRuntimeFsCaller;
export type PluginQuickJsRuntimeWebSocketCaller = PluginRuntimeWebSocketCaller;
export type PluginQuickJsRuntimeApiOptions = PluginRuntimeApiOptions;
export type PluginQuickJsRuntimeOptions = PluginRuntimeOptions;
export type PluginQuickJsRuntimeCallbackInput = PluginRuntimeCallbackInput;
export type PluginQuickJsRuntimeInstance = PluginRuntimeInstance;
export type PluginQuickJsRuntimeResult = PluginRuntimeResult;

export class PluginQuickJsRuntimeError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : options);
    this.name = "PluginQuickJsRuntimeError";
  }
}

type PluginQuickJsHostMetadata = {
  context: unknown | null;
  deadlineMs: number | null;
};

type PluginQuickJsHostMetadataProvider = () => PluginQuickJsHostMetadata;

function currentPluginQuickJsHostMetadata(input: {
  getHostMetadata: PluginQuickJsHostMetadataProvider;
}): PluginQuickJsHostMetadata {
  return input.getHostMetadata();
}

function dumpQuickJsHostArg(input: {
  args: QuickJSHandle[];
  context: { dump: (handle: QuickJSHandle) => unknown };
  index: number;
}): unknown {
  const handle = input.args[input.index];
  return handle ? input.context.dump(handle) : undefined;
}

function dumpQuickJsHostArgOr(input: {
  args: QuickJSHandle[];
  context: { dump: (handle: QuickJSHandle) => unknown };
  fallback: unknown;
  index: number;
}): unknown {
  const handle = input.args[input.index];
  return handle ? input.context.dump(handle) : input.fallback;
}

export { createMetidosPluginApiBuildPlugin } from "./plugin-api-runtime";

function jsonForQuickJs(value: unknown): string {
  return (JSON.stringify(value) ?? "null").replaceAll("<", "\\u003c");
}

function structuredDataHostPayload(input: {
  code?: unknown;
  message?: string;
  name?: string;
  result?: unknown;
}): string {
  if (input.message) {
    return JSON.stringify({
      error: {
        code: input.code ?? "plugin_structured_data_error",
        message: input.message,
        name: input.name ?? "PluginStructuredDataError",
      },
    });
  }
  return JSON.stringify({ result: input.result });
}

function installPluginStructuredDataHostFunction(input: {
  context: QuickJSContext;
}): void {
  const hostStructuredDataOperation = input.context.newFunction(
    "__metidosHostStructuredDataOperation",
    (operationHandle, inputHandle) => {
      const operation = input.context.dump(operationHandle);
      const request = inputHandle ? input.context.dump(inputHandle) : null;
      try {
        return input.context.newString(
          structuredDataHostPayload({
            result: executePluginStructuredDataOperation({
              createError: (message) => new PluginQuickJsRuntimeError(message),
              operation,
              payload: request,
            }),
          }),
        );
      } catch (error) {
        return input.context.newString(
          structuredDataHostPayload({
            code: hostErrorCode(error),
            message: error instanceof Error ? error.message : String(error),
            name:
              error instanceof Error ? error.name : "PluginStructuredDataError",
          }),
        );
      }
    },
  );
  input.context.setProp(
    input.context.global,
    "__metidosHostStructuredDataOperation",
    hostStructuredDataOperation,
  );
  hostStructuredDataOperation.dispose();
}

function installPluginFetchHostFunction(input: {
  context: QuickJSContext;
  pluginApi: PluginQuickJsRuntimeApiOptions;
  runtime: QuickJSRuntime;
}): void {
  installQuickJsHostOperation<{ options: unknown; url: unknown }, unknown>({
    context: input.context,
    errorName: "PluginFetchError",
    execute: ({ options, url }) =>
      executePluginHostFetchOperation({
        createError: (message) => new PluginQuickJsRuntimeError(message),
        metadata: { context: null, deadlineMs: null },
        options,
        pluginApi: input.pluginApi,
        url,
      }),
    globalName: "__metidosHostFetch",
    readRequest: ({ args, context }) => ({
      options: dumpQuickJsHostArgOr({ args, context, fallback: {}, index: 1 }),
      url: dumpQuickJsHostArg({ args, context, index: 0 }),
    }),
    runtime: input.runtime,
    serializeSuccess: (response) => JSON.stringify({ ok: true, response }),
  });
}

function installPluginWebSocketHostFunction(input: {
  context: QuickJSContext;
  getHostMetadata: PluginQuickJsHostMetadataProvider;
  pluginApi: PluginQuickJsRuntimeApiOptions;
  runtime: QuickJSRuntime;
}): void {
  installQuickJsHostOperation<{ operation: unknown; params: unknown }, unknown>(
    {
      context: input.context,
      errorName: "PluginWebSocketError",
      execute: ({ operation, params }) =>
        executePluginHostWebSocketOperation({
          createError: (message) => new PluginQuickJsRuntimeError(message),
          metadata: currentPluginQuickJsHostMetadata(input),
          operation,
          params,
          pluginApi: input.pluginApi,
        }),
      globalName: "__metidosHostWebSocketOperation",
      readRequest: ({ args, context }) => ({
        operation: dumpQuickJsHostArg({ args, context, index: 0 }),
        params: dumpQuickJsHostArgOr({ args, context, fallback: {}, index: 1 }),
      }),
      runtime: input.runtime,
    },
  );
}

function pluginBytesHostPayload(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { __metidosBytesBase64: Buffer.from(value).toString("base64") };
  }
  if (value instanceof ArrayBuffer) {
    return { __metidosBytesBase64: Buffer.from(value).toString("base64") };
  }
  return value;
}

function installPluginFsHostFunction(input: {
  context: QuickJSContext;
  getHostMetadata: PluginQuickJsHostMetadataProvider;
  pluginApi: PluginQuickJsRuntimeApiOptions;
  runtime: QuickJSRuntime;
}): void {
  installQuickJsHostOperation<{ operation: unknown; params: unknown }, unknown>(
    {
      context: input.context,
      errorName: "PluginFsError",
      execute: ({ operation, params }) =>
        executePluginHostFsOperation({
          createError: (message) => new PluginQuickJsRuntimeError(message),
          metadata: currentPluginQuickJsHostMetadata(input),
          operation,
          params,
          pluginApi: input.pluginApi,
        }),
      globalName: "__metidosHostFsOperation",
      readRequest: ({ args, context }) => ({
        operation: dumpQuickJsHostArg({ args, context, index: 0 }),
        params: dumpQuickJsHostArgOr({ args, context, fallback: {}, index: 1 }),
      }),
      runtime: input.runtime,
      serializeSuccess: (result) =>
        JSON.stringify({ ok: true, result: pluginBytesHostPayload(result) }),
    },
  );
}

function installPluginCalendarEventsHostFunction(input: {
  context: QuickJSContext;
  getHostMetadata: PluginQuickJsHostMetadataProvider;
  pluginApi: PluginQuickJsRuntimeApiOptions;
  runtime: QuickJSRuntime;
}): void {
  installQuickJsHostOperation<{ operation: unknown; params: unknown }, unknown>(
    {
      context: input.context,
      errorName: "PluginCalendarEventsError",
      execute: ({ operation, params }) =>
        executePluginHostCalendarEventsOperation({
          createError: (message) => new PluginQuickJsRuntimeError(message),
          metadata: currentPluginQuickJsHostMetadata(input),
          operation,
          params,
          pluginApi: input.pluginApi,
        }),
      globalName: "__metidosHostCalendarEventsOperation",
      readRequest: ({ args, context }) => ({
        operation: dumpQuickJsHostArg({ args, context, index: 0 }),
        params: dumpQuickJsHostArgOr({ args, context, fallback: {}, index: 1 }),
      }),
      runtime: input.runtime,
    },
  );
}

function installPluginTerminalHostFunction(input: {
  context: QuickJSContext;
  getHostMetadata: PluginQuickJsHostMetadataProvider;
  pluginApi: PluginQuickJsRuntimeApiOptions;
  runtime: QuickJSRuntime;
}): void {
  installQuickJsHostOperation<{ operation: unknown; params: unknown }, unknown>(
    {
      context: input.context,
      errorName: "PluginTerminalError",
      execute: ({ operation, params }) =>
        executePluginHostTerminalOperation({
          createError: (message) => new PluginQuickJsRuntimeError(message),
          metadata: currentPluginQuickJsHostMetadata(input),
          operation,
          params,
          pluginApi: input.pluginApi,
        }),
      globalName: "__metidosHostTerminalOperation",
      readRequest: ({ args, context }) => ({
        operation: dumpQuickJsHostArg({ args, context, index: 0 }),
        params: dumpQuickJsHostArgOr({ args, context, fallback: {}, index: 1 }),
      }),
      runtime: input.runtime,
    },
  );
}

function installPluginSqliteHostFunction(input: {
  context: QuickJSContext;
  getHostMetadata: PluginQuickJsHostMetadataProvider;
  pluginApi: PluginQuickJsRuntimeApiOptions;
  runtime: QuickJSRuntime;
}): void {
  installQuickJsHostOperation<{ operation: unknown; params: unknown }, unknown>(
    {
      context: input.context,
      errorName: "PluginSqliteError",
      execute: ({ operation, params }) =>
        executePluginHostSqliteOperation({
          createError: (message) => new PluginQuickJsRuntimeError(message),
          metadata: currentPluginQuickJsHostMetadata(input),
          operation,
          params,
          pluginApi: input.pluginApi,
        }),
      globalName: "__metidosHostSqliteOperation",
      readRequest: ({ args, context }) => ({
        operation: dumpQuickJsHostArg({ args, context, index: 0 }),
        params: dumpQuickJsHostArgOr({ args, context, fallback: {}, index: 1 }),
      }),
      runtime: input.runtime,
    },
  );
}

function installPluginLanceDbHostFunction(input: {
  context: QuickJSContext;
  getHostMetadata: PluginQuickJsHostMetadataProvider;
  pluginApi: PluginQuickJsRuntimeApiOptions;
  runtime: QuickJSRuntime;
}): void {
  installQuickJsHostOperation<
    { operation: unknown; request: unknown },
    unknown
  >({
    context: input.context,
    errorName: "PluginLanceDbError",
    execute: ({ operation, request }) =>
      executePluginHostLanceDbOperation({
        createError: (message) => new PluginQuickJsRuntimeError(message),
        metadata: currentPluginQuickJsHostMetadata(input),
        operation,
        params: request,
        pluginApi: input.pluginApi,
      }),
    globalName: "__metidosHostLanceDbOperation",
    readRequest: ({ args, context }) => ({
      operation: dumpQuickJsHostArg({ args, context, index: 0 }),
      request: dumpQuickJsHostArg({ args, context, index: 1 }),
    }),
    runtime: input.runtime,
  });
}

function installPluginEmbeddingsHostFunction(input: {
  context: QuickJSContext;
  getHostMetadata: PluginQuickJsHostMetadataProvider;
  pluginApi: PluginQuickJsRuntimeApiOptions;
  runtime: QuickJSRuntime;
}): void {
  installQuickJsHostOperation<{ request: unknown }, unknown>({
    context: input.context,
    errorName: "PluginEmbeddingsError",
    execute: ({ request }) =>
      executePluginHostEmbeddingsOperation({
        createError: (message) => new PluginQuickJsRuntimeError(message),
        metadata: currentPluginQuickJsHostMetadata(input),
        params: request,
        pluginApi: input.pluginApi,
      }),
    globalName: "__metidosHostEmbeddingsOperation",
    readRequest: ({ args, context }) => ({
      request: dumpQuickJsHostArg({ args, context, index: 0 }),
    }),
    runtime: input.runtime,
  });
}

function installPluginLogHostFunction(input: {
  context: QuickJSContext;
  getHostMetadata: PluginQuickJsHostMetadataProvider;
  pluginApi: PluginQuickJsRuntimeApiOptions;
  runtime: QuickJSRuntime;
}): void {
  installQuickJsHostOperation<{ request: unknown }, unknown>({
    context: input.context,
    errorName: "PluginLogError",
    execute: ({ request }) =>
      executePluginHostLogOperation({
        createError: (message) => new PluginQuickJsRuntimeError(message),
        metadata: currentPluginQuickJsHostMetadata(input),
        params: request,
        pluginApi: input.pluginApi,
      }),
    globalName: "__metidosHostLog",
    readRequest: ({ args, context }) => ({
      request: dumpQuickJsHostArg({ args, context, index: 0 }),
    }),
    runtime: input.runtime,
  });
}

function installPluginNotificationHostFunction(input: {
  context: QuickJSContext;
  getHostMetadata: PluginQuickJsHostMetadataProvider;
  pluginApi: PluginQuickJsRuntimeApiOptions;
  runtime: QuickJSRuntime;
}): void {
  installQuickJsHostOperation<{ request: unknown }, unknown>({
    context: input.context,
    errorName: "PluginNotificationError",
    execute: ({ request }) =>
      executePluginHostNotificationSendOperation({
        createError: (message) => new PluginQuickJsRuntimeError(message),
        metadata: currentPluginQuickJsHostMetadata(input),
        pluginApi: input.pluginApi,
        request,
      }),
    globalName: "__metidosHostNotificationSend",
    readRequest: ({ args, context }) => ({
      request: dumpQuickJsHostArg({ args, context, index: 0 }),
    }),
    runtime: input.runtime,
  });
}

function runtimeFailure(input: {
  cause?: unknown;
  message: string;
}): PluginQuickJsRuntimeError {
  return new PluginQuickJsRuntimeError(input.message, {
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });
}

function quickJsErrorMessage(context: QuickJSContext, error: QuickJSHandle) {
  const dumped = context.dump(error);
  if (dumped && typeof dumped === "object" && "message" in dumped) {
    const message = (dumped as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      const name = (dumped as { name?: unknown }).name;
      return typeof name === "string" && name.length > 0
        ? `${name}: ${message}`
        : message;
    }
  }
  return typeof dumped === "string" ? dumped : JSON.stringify(dumped);
}

function assertQuickJsDeadline(deadlineMs: number, message: string): void {
  if (Date.now() > deadlineMs) {
    throw runtimeFailure({ message });
  }
}

function unwrapQuickJsResult(
  context: QuickJSContext,
  result: QuickJSVmResult,
  message: string,
): QuickJSHandle {
  if ("error" in result) {
    const errorMessage = quickJsErrorMessage(context, result.error);
    result.error.dispose();
    throw runtimeFailure({ message: `${message}: ${errorMessage}` });
  }
  return result.value;
}

const MAX_ENTRYPOINT_EXPORT_REWRITE_SOURCE_BYTES = 5 * 1024 * 1024;

const SUPPORTED_ENTRYPOINT_EXPORT_MESSAGE =
  "Supported plugin QuickJS entrypoint exports are `export default ...` and `export { value as default }` after bundling to plain JavaScript.";

function assertSupportedEntrypointExportSyntax(source: string): void {
  // QuickJS starts plugin entrypoints from a script wrapper, not as native ES modules.
  // Keep the rewrite surface intentionally small so unsupported module styles fail with
  // an author-facing diagnostic instead of a generic QuickJS syntax/reference error.
  if (
    /(?:^|[;\r\n])\s*export\s+(?:async\s+)?(?:const|let|var|function|class|type|interface|enum|namespace|\*)\b/.test(
      source,
    )
  ) {
    throw runtimeFailure({
      message: `Unsupported plugin QuickJS entrypoint export syntax. ${SUPPORTED_ENTRYPOINT_EXPORT_MESSAGE}`,
    });
  }

  if (
    /(?:^|[;\r\n])\s*(?:module\.exports|exports\.[A-Za-z_$][\w$]*)\s*=/.test(
      source,
    )
  ) {
    throw runtimeFailure({
      message: `Unsupported CommonJS plugin QuickJS entrypoint export syntax. ${SUPPORTED_ENTRYPOINT_EXPORT_MESSAGE}`,
    });
  }
}

export function rewriteEntrypointExports(source: string): string {
  if (
    Buffer.byteLength(source, "utf8") >
    MAX_ENTRYPOINT_EXPORT_REWRITE_SOURCE_BYTES
  ) {
    throw runtimeFailure({
      message:
        "Plugin QuickJS entrypoint source is too large to rewrite exports safely.",
    });
  }

  assertSupportedEntrypointExportSyntax(source);

  // The QuickJS runtime executes plugin entrypoints from a script wrapper instead of
  // loading native ES modules. This rewrite intentionally supports only the two
  // forms emitted by the plugin bundler for QuickJS entrypoints: an expression
  // default export and an export-list default alias. Other ESM/CommonJS export
  // styles are rejected above so plugin authors get a stable diagnostic instead
  // of a wrapper-time syntax error.
  let transformed = source.replace(
    /export\s*\{([\s\S]*?)\};?/g,
    (_match, specifiers: string) => {
      const defaultSpecifier = specifiers
        .split(",")
        .map((specifier) => specifier.trim())
        .find((specifier) => /\bas\s+default\b/.test(specifier));
      if (!defaultSpecifier) {
        return "";
      }
      const localName = defaultSpecifier.split(/\s+as\s+/)[0]?.trim();
      return localName
        ? `globalThis.__metidosDefaultExport = ${localName};`
        : "";
    },
  );
  transformed = transformed.replace(
    /export\s+default\s+([^;]+);?/g,
    "globalThis.__metidosDefaultExport = $1;",
  );
  return transformed;
}

function wrapEntrypointForAsyncSetup(source: string): string {
  return `
(async () => {
${rewriteEntrypointExports(source)}
  return globalThis.__metidosDefaultExport ?? globalThis.__metidosDefinedPlugin ?? null;
})()
`;
}

function wrapCallbackInvocation(input: {
  callbackInvocationToken: string;
  callback: PluginQuickJsRuntimeCallbackInput;
}): string {
  return `
(async () => {
  return await globalThis.__metidosInvokePluginCallback(
    ${jsonForQuickJs(input.callbackInvocationToken)},
    ${jsonForQuickJs(input.callback.handle)},
    ${jsonForQuickJs(input.callback.args)},
    ${jsonForQuickJs(input.callback.deadlineMs)},
  );
})()
`;
}

async function resolveQuickJsPromise(
  runtime: QuickJSRuntime,
  context: QuickJSContext,
  promiseHandle: QuickJSHandle,
  input: {
    deadlineMs: number;
    jobFailureMessage: string;
    rejectionMessage: string;
    timeoutMessage: string;
  },
): Promise<QuickJSHandle> {
  const promise = context.resolvePromise(promiseHandle);
  promiseHandle.dispose();

  while (runtime.hasPendingJob()) {
    assertQuickJsDeadline(input.deadlineMs, input.timeoutMessage);
    const jobsResult = runtime.executePendingJobs();
    if ("error" in jobsResult) {
      const errorMessage = quickJsErrorMessage(context, jobsResult.error);
      jobsResult.error.dispose();
      throw runtimeFailure({
        message: `${input.jobFailureMessage}: ${errorMessage}`,
      });
    }
  }

  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    const remainingMs = Math.max(0, input.deadlineMs - Date.now());
    timeoutTimer = setTimeout(() => {
      reject(runtimeFailure({ message: input.timeoutMessage }));
    }, remainingMs);
    timeoutTimer.unref?.();
  });

  try {
    const resolved = await Promise.race([promise, timeout]);
    return unwrapQuickJsResult(context, resolved, input.rejectionMessage);
  } finally {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }
  }
}

export async function startPluginQuickJsRuntime(
  buildResult: PluginEntrypointBuildResult,
  options: PluginQuickJsRuntimeOptions = {},
): Promise<PluginQuickJsRuntimeInstance> {
  if (buildResult.language === "python") {
    throw new PluginQuickJsRuntimeError(
      "Python plugin entrypoints require the Python runtime and cannot run in the QuickJS JavaScript sandbox.",
    );
  }
  const quickjs = await quickjsPackage.getQuickJS();
  const runtime = quickjs.newRuntime();
  const context = runtime.newContext();
  const startupTimeoutMs =
    options.startupTimeoutMs ?? DEFAULT_PLUGIN_QUICKJS_STARTUP_TIMEOUT_MS;
  const startupDeadlineMs = Date.now() + startupTimeoutMs;
  const callbackInvocationToken = randomBytes(32).toString("hex");
  const startupTimeoutMessage = `Plugin QuickJS setup timed out after ${startupTimeoutMs} ms.`;
  let activeHostMetadata: PluginQuickJsHostMetadata = {
    context: null,
    deadlineMs: null,
  };
  let disposed = false;
  const getHostMetadata = (): PluginQuickJsHostMetadata => activeHostMetadata;

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    const cleanupErrors: unknown[] = [];
    try {
      const cleanupResult = context.evalCode(
        "globalThis.__metidosDefaultExport = undefined; globalThis.__metidosDefinedPlugin = undefined;",
        "metidos-plugin-cleanup.js",
      );
      if ("value" in cleanupResult) {
        cleanupResult.value.dispose();
      } else {
        cleanupResult.error.dispose();
      }
    } catch (error) {
      // Best-effort guest cleanup; log diagnostics without masking the original
      // setup/callback error that triggered disposal.
      cleanupErrors.push(error);
    }
    try {
      context.dispose();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      runtime.dispose();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      logger.warning({
        errors: cleanupErrors.map((error) =>
          error instanceof Error ? error.message : String(error),
        ),
        message: "Plugin QuickJS runtime cleanup completed with errors.",
      });
    }
  };

  try {
    runtime.setMemoryLimit(
      options.memoryLimitBytes ?? DEFAULT_PLUGIN_QUICKJS_MEMORY_LIMIT_BYTES,
    );
    runtime.setMaxStackSize(DEFAULT_PLUGIN_QUICKJS_STACK_SIZE_BYTES);
    runtime.setInterruptHandler(
      quickjsPackage.shouldInterruptAfterDeadline(startupDeadlineMs),
    );

    installPluginStructuredDataHostFunction({ context });
    installPluginFetchHostFunction({
      context,
      pluginApi: options.pluginApi ?? {},
      runtime,
    });
    installPluginWebSocketHostFunction({
      context,
      getHostMetadata,
      pluginApi: options.pluginApi ?? {},
      runtime,
    });
    installPluginFsHostFunction({
      context,
      getHostMetadata,
      pluginApi: options.pluginApi ?? {},
      runtime,
    });
    installPluginCalendarEventsHostFunction({
      context,
      getHostMetadata,
      pluginApi: options.pluginApi ?? {},
      runtime,
    });
    installPluginTerminalHostFunction({
      context,
      getHostMetadata,
      pluginApi: options.pluginApi ?? {},
      runtime,
    });
    installPluginSqliteHostFunction({
      context,
      getHostMetadata,
      pluginApi: options.pluginApi ?? {},
      runtime,
    });
    installPluginLanceDbHostFunction({
      context,
      getHostMetadata,
      pluginApi: options.pluginApi ?? {},
      runtime,
    });
    installPluginEmbeddingsHostFunction({
      context,
      getHostMetadata,
      pluginApi: options.pluginApi ?? {},
      runtime,
    });
    installPluginLogHostFunction({
      context,
      getHostMetadata,
      pluginApi: options.pluginApi ?? {},
      runtime,
    });
    installPluginNotificationHostFunction({
      context,
      getHostMetadata,
      pluginApi: options.pluginApi ?? {},
      runtime,
    });

    assertQuickJsDeadline(startupDeadlineMs, startupTimeoutMessage);
    const bootstrapResult = context.evalCode(
      pluginJavaScriptBootstrapSource({
        callbackInvocationToken,
        ...(options.pluginApi === undefined
          ? {}
          : { pluginApi: options.pluginApi }),
      }),
      "metidos-plugin-bootstrap.js",
    );
    unwrapQuickJsResult(
      context,
      bootstrapResult,
      "Plugin QuickJS bootstrap failed",
    ).dispose();

    assertQuickJsDeadline(startupDeadlineMs, startupTimeoutMessage);
    const setupResult = context.evalCode(
      wrapEntrypointForAsyncSetup(buildResult.source),
      buildResult.entrypointPath,
    );
    const setupPromise = unwrapQuickJsResult(
      context,
      setupResult,
      "Plugin QuickJS setup failed",
    );
    const resolvedSetup = await resolveQuickJsPromise(
      runtime,
      context,
      setupPromise,
      {
        deadlineMs: startupDeadlineMs,
        jobFailureMessage: "Plugin QuickJS setup job failed",
        rejectionMessage: "Plugin QuickJS setup promise rejected",
        timeoutMessage: startupTimeoutMessage,
      },
    );
    const dumpedSetup = context.dump(resolvedSetup);
    resolvedSetup.dispose();

    return {
      dispose,
      invokeCallback: async (input) => {
        if (disposed) {
          throw runtimeFailure({
            message: "Plugin QuickJS runtime is disposed.",
          });
        }
        runtime.setInterruptHandler(
          quickjsPackage.shouldInterruptAfterDeadline(input.deadlineMs),
        );
        assertQuickJsDeadline(
          input.deadlineMs,
          `${input.label} timed out before execution started.`,
        );
        activeHostMetadata = {
          context: input.args[0] ?? null,
          deadlineMs: input.deadlineMs,
        };
        try {
          const callbackResult = context.evalCode(
            wrapCallbackInvocation({
              callback: input,
              callbackInvocationToken,
            }),
            `metidos-plugin-callback-${input.handle}.js`,
          );
          const callbackPromise = unwrapQuickJsResult(
            context,
            callbackResult,
            `${input.label} failed`,
          );
          const resolvedCallback = await resolveQuickJsPromise(
            runtime,
            context,
            callbackPromise,
            {
              deadlineMs: input.deadlineMs,
              jobFailureMessage: `${input.label} job failed`,
              rejectionMessage: `${input.label} promise rejected`,
              timeoutMessage: `${input.label} timed out.`,
            },
          );
          const dumpedCallback = context.dump(resolvedCallback);
          resolvedCallback.dispose();
          return dumpedCallback;
        } finally {
          activeHostMetadata = {
            context: null,
            deadlineMs: null,
          };
        }
      },
      setupResult: dumpedSetup,
    };
  } catch (error) {
    dispose();
    if (error instanceof PluginQuickJsRuntimeError) {
      throw error;
    }
    throw runtimeFailure({
      cause: error,
      message: `Plugin QuickJS runtime failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export async function executePluginQuickJsRuntime(
  buildResult: PluginEntrypointBuildResult,
  options: PluginQuickJsRuntimeOptions = {},
): Promise<PluginQuickJsRuntimeResult> {
  const runtime = await startPluginQuickJsRuntime(buildResult, options);
  try {
    return { setupResult: runtime.setupResult };
  } finally {
    runtime.dispose();
  }
}
