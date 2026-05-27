/**
 * @file src/bun/plugin/quickjs-host-bridge.test.ts
 * @description Focused tests for internal QuickJS host-operation bridge behavior.
 */

import { describe, expect, it } from "bun:test";

import {
  installQuickJsHostOperation,
  type QuickJSHostBridgeContext,
  type QuickJSHostBridgeHandle,
  type QuickJSHostBridgeRuntime,
} from "./quickjs-host-bridge";

type TestHandle = QuickJSHostBridgeHandle & {
  disposed: boolean;
  value: unknown;
};

type TestPromise = {
  handle: TestHandle;
  resolvedPayload: string | null;
  settled: Promise<unknown>;
};

function createHandle(value: unknown): TestHandle {
  return {
    disposed: false,
    dispose() {
      this.disposed = true;
    },
    value,
  };
}

function createBridgeHarness(
  input: {
    executePendingJobs?: () => ReturnType<
      QuickJSHostBridgeRuntime["executePendingJobs"]
    >;
  } = {},
) {
  let installedFunction:
    | ((...args: QuickJSHostBridgeHandle[]) => QuickJSHostBridgeHandle)
    | null = null;
  let installedHandle: TestHandle | null = null;
  const stringHandles: TestHandle[] = [];
  const promises: TestPromise[] = [];
  let pendingJobDrainCount = 0;
  const context: QuickJSHostBridgeContext = {
    dump: (handle) => (handle as TestHandle).value,
    global: createHandle("global"),
    newFunction: (_name, fn) => {
      installedFunction = fn;
      installedHandle = createHandle(fn);
      return installedHandle;
    },
    newPromise: () => {
      let settle: (() => void) | null = null;
      const promise: TestPromise = {
        handle: createHandle("promise"),
        resolvedPayload: null,
        settled: new Promise((resolve) => {
          settle = () => resolve(undefined);
        }),
      };
      promises.push(promise);
      return {
        handle: promise.handle,
        reject: () => {
          settle?.();
        },
        resolve: (handle) => {
          promise.resolvedPayload = String((handle as TestHandle).value);
          settle?.();
        },
        settled: promise.settled,
      };
    },
    newString: (value) => {
      const handle = createHandle(value);
      stringHandles.push(handle);
      return handle;
    },
    setProp: (_target, _key, value) => {
      if (!installedHandle) {
        throw new Error("Host function handle was not created.");
      }
      expect(value).toBe(installedHandle);
    },
  };
  const runtime: QuickJSHostBridgeRuntime = {
    executePendingJobs: () => {
      pendingJobDrainCount += 1;
      return input.executePendingJobs?.() ?? { value: 0 };
    },
  };
  return {
    context,
    get installedFunction() {
      if (!installedFunction) {
        throw new Error("Host function was not installed.");
      }
      return installedFunction;
    },
    get installedHandle() {
      if (!installedHandle) {
        throw new Error("Host function handle was not created.");
      }
      return installedHandle;
    },
    get pendingJobDrainCount() {
      return pendingJobDrainCount;
    },
    promises,
    runtime,
    stringHandles,
  };
}

async function flushBridgeMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("installQuickJsHostOperation", () => {
  it("installs a host global and resolves successful operations with disposed string handles", async () => {
    const harness = createBridgeHarness();

    installQuickJsHostOperation({
      context: harness.context,
      errorName: "PluginTestError",
      execute: ({ value }: { value: unknown }) => ({ echoed: value }),
      globalName: "__metidosHostTest",
      readRequest: ({ args, context }) => {
        const [firstArg] = args;
        return { value: firstArg ? context.dump(firstArg) : undefined };
      },
      runtime: harness.runtime,
    });

    expect(harness.installedHandle.disposed).toBe(true);
    const returnedHandle = harness.installedFunction(createHandle("hello"));
    expect(harness.promises).toHaveLength(1);
    const [promise] = harness.promises;
    if (!promise) {
      throw new Error("Host promise was not created.");
    }
    expect(returnedHandle).toBe(promise.handle);

    await flushBridgeMicrotasks();

    expect(JSON.parse(promise.resolvedPayload ?? "null")).toEqual({
      ok: true,
      result: { echoed: "hello" },
    });
    expect(harness.stringHandles).toHaveLength(1);
    expect(harness.stringHandles[0]?.disposed).toBe(true);
    expect(harness.pendingJobDrainCount).toBe(1);
  });

  it("normalizes thrown host errors with fallback metadata and drains pending jobs", async () => {
    const harness = createBridgeHarness();
    const error = new Error("boom") as Error & { code: string };
    error.name = "SpecificHostError";
    error.code = "specific_code";

    installQuickJsHostOperation({
      context: harness.context,
      errorName: "PluginTestError",
      execute: () => {
        throw error;
      },
      globalName: "__metidosHostTest",
      readRequest: () => ({}),
      runtime: harness.runtime,
    });

    harness.installedFunction();
    await flushBridgeMicrotasks();

    expect(JSON.parse(harness.promises[0]?.resolvedPayload ?? "null")).toEqual({
      error: {
        code: "specific_code",
        message: "boom",
        name: "SpecificHostError",
      },
      ok: false,
    });
    expect(harness.stringHandles[0]?.disposed).toBe(true);
    expect(harness.pendingJobDrainCount).toBe(1);
  });

  it("normalizes rejected host promises with the configured fallback error name", async () => {
    const harness = createBridgeHarness();

    installQuickJsHostOperation({
      context: harness.context,
      errorName: "PluginRejectedError",
      execute: () => Promise.reject("rejected by host"),
      globalName: "__metidosHostTest",
      readRequest: () => ({}),
      runtime: harness.runtime,
    });

    harness.installedFunction();
    await flushBridgeMicrotasks();

    expect(JSON.parse(harness.promises[0]?.resolvedPayload ?? "null")).toEqual({
      error: {
        message: "rejected by host",
        name: "PluginRejectedError",
      },
      ok: false,
    });
    expect(harness.stringHandles[0]?.disposed).toBe(true);
    expect(harness.pendingJobDrainCount).toBe(1);
  });

  it("preserves structured error codes from rejected host promises", async () => {
    const harness = createBridgeHarness();
    const error = new Error("quota exceeded") as Error & { code: string };
    error.name = "PluginQuotaError";
    error.code = "plugin_quota_exceeded";

    installQuickJsHostOperation({
      context: harness.context,
      errorName: "PluginRejectedError",
      execute: () => Promise.reject(error),
      globalName: "__metidosHostTest",
      readRequest: () => ({}),
      runtime: harness.runtime,
    });

    harness.installedFunction();
    await flushBridgeMicrotasks();

    expect(JSON.parse(harness.promises[0]?.resolvedPayload ?? "null")).toEqual({
      error: {
        code: "plugin_quota_exceeded",
        message: "quota exceeded",
        name: "PluginQuotaError",
      },
      ok: false,
    });
    expect(harness.stringHandles[0]?.disposed).toBe(true);
    expect(harness.pendingJobDrainCount).toBe(1);
  });

  it("normalizes unavailable host operation errors without changing public payload shape", async () => {
    const harness = createBridgeHarness();
    const error = new Error("Plugin fs host API is unavailable.");
    error.name = "PluginQuickJsRuntimeError";

    installQuickJsHostOperation({
      context: harness.context,
      errorName: "PluginFsError",
      execute: () => {
        throw error;
      },
      globalName: "__metidosHostFsOperation",
      readRequest: () => ({}),
      runtime: harness.runtime,
    });

    harness.installedFunction();
    await flushBridgeMicrotasks();

    expect(JSON.parse(harness.promises[0]?.resolvedPayload ?? "null")).toEqual({
      error: {
        message: "Plugin fs host API is unavailable.",
        name: "PluginQuickJsRuntimeError",
      },
      ok: false,
    });
    expect(harness.stringHandles[0]?.disposed).toBe(true);
    expect(harness.pendingJobDrainCount).toBe(1);
  });

  it("supports capability-specific success payload serializers", async () => {
    const harness = createBridgeHarness();

    installQuickJsHostOperation({
      context: harness.context,
      errorName: "PluginTestError",
      execute: () => new Uint8Array([1, 2, 3]),
      globalName: "__metidosHostTest",
      readRequest: () => ({}),
      runtime: harness.runtime,
      serializeSuccess: (result) =>
        JSON.stringify({ ok: true, response: Array.from(result) }),
    });

    harness.installedFunction();
    await flushBridgeMicrotasks();

    expect(JSON.parse(harness.promises[0]?.resolvedPayload ?? "null")).toEqual({
      ok: true,
      response: [1, 2, 3],
    });
    expect(harness.stringHandles[0]?.disposed).toBe(true);
    expect(harness.pendingJobDrainCount).toBe(1);
  });

  it("converts oversized success payloads into bounded host errors", async () => {
    const harness = createBridgeHarness();

    installQuickJsHostOperation({
      context: harness.context,
      errorName: "PluginTestError",
      execute: () => "too large",
      globalName: "__metidosHostTest",
      readRequest: () => ({}),
      runtime: harness.runtime,
      serializeSuccess: () => "x".repeat(8 * 1024 * 1024 + 1),
    });

    harness.installedFunction();
    await flushBridgeMicrotasks();

    expect(JSON.parse(harness.promises[0]?.resolvedPayload ?? "null")).toEqual({
      error: {
        code: "quickjs_host_payload_too_large",
        message: "QuickJS host bridge payload exceeded 8388608 bytes.",
        name: "Error",
      },
      ok: false,
    });
    expect(harness.stringHandles[0]?.disposed).toBe(true);
    expect(harness.pendingJobDrainCount).toBe(1);
  });

  it("disposes QuickJS job errors raised while draining host promise continuations", async () => {
    const jobError = createHandle({ message: "job failed" });
    const harness = createBridgeHarness({
      executePendingJobs: () => ({ error: jobError }),
    });

    installQuickJsHostOperation({
      context: harness.context,
      errorName: "PluginTestError",
      execute: () => ({ ok: true }),
      globalName: "__metidosHostTest",
      readRequest: () => ({}),
      runtime: harness.runtime,
    });

    harness.installedFunction();
    await flushBridgeMicrotasks();

    expect(jobError.disposed).toBe(true);
    expect(harness.pendingJobDrainCount).toBe(1);
  });

  it("swallows pending-job drain failures after host promise settlement", async () => {
    const harness = createBridgeHarness({
      executePendingJobs: () => {
        throw new Error("drain failed");
      },
    });

    installQuickJsHostOperation({
      context: harness.context,
      errorName: "PluginTestError",
      execute: () => ({ ok: true }),
      globalName: "__metidosHostTest",
      readRequest: () => ({}),
      runtime: harness.runtime,
    });

    harness.installedFunction();
    await flushBridgeMicrotasks();

    expect(JSON.parse(harness.promises[0]?.resolvedPayload ?? "null")).toEqual({
      ok: true,
      result: { ok: true },
    });
    expect(harness.stringHandles[0]?.disposed).toBe(true);
    expect(harness.pendingJobDrainCount).toBe(1);
  });
});
