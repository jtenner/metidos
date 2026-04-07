/**
 * @file src/bun/vm2-runner-worker.ts
 * @description Worker entrypoint for vm2-backed untrusted JavaScript execution.
 */

import {
  buildVm2RequireOptions,
  buildVm2Sandbox,
  formatVm2ConsoleEvent,
  formatVm2Value,
  patchVm2SetupSandboxReadFileSync,
  type Vm2ConsoleLevel,
  type Vm2ExecutionReport,
  type Vm2WorkerRequest,
} from "./vm2-runner";

patchVm2SetupSandboxReadFileSync();

const { NodeVM } = await import("vm2");

type Vm2ConsoleEventPayload = {
  level: Vm2ConsoleLevel;
  args: unknown[];
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function makeErrorSummary(error: unknown): {
  message: string;
  name: string;
  stack: string | null;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack ?? null,
    };
  }

  return {
    message: String(error),
    name: "Error",
    stack: null,
  };
}

self.addEventListener(
  "message",
  async (event: MessageEvent<Vm2WorkerRequest>) => {
    const request = event.data;
    const startedAt = Date.now();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const events: Vm2ExecutionReport["events"] = [];

    const postConsoleEvent = (payload: Vm2ConsoleEventPayload): void => {
      const consoleEvent = formatVm2ConsoleEvent(payload.level, payload.args);
      events.push(consoleEvent);
      if (consoleEvent.stream === "stdout") {
        stdout.push(consoleEvent.text);
      } else {
        stderr.push(consoleEvent.text);
      }
      postMessage({
        event: consoleEvent,
        type: "console",
      });
    };

    try {
      const vm = new NodeVM({
        argv: [],
        compiler: "typescript",
        console: "redirect",
        eval: false,
        require: buildVm2RequireOptions(request.worktreePath),
        sandbox: buildVm2Sandbox(),
        strict: true,
        timeout: request.timeoutMs,
        wasm: false,
      });

      for (const level of [
        "debug",
        "dir",
        "error",
        "info",
        "log",
        "trace",
        "warn",
      ] as const) {
        vm.on(`console.${level}`, (...args: unknown[]) => {
          postConsoleEvent({ args, level });
        });
      }

      const result = vm.run(request.code, {
        filename: request.filename,
        strict: true,
        wrapper: "commonjs",
      });
      const resolvedResult = isPromiseLike(result) ? await result : result;
      const report: Vm2ExecutionReport = {
        durationMs: Date.now() - startedAt,
        ok: true,
        resultText: formatVm2Value(resolvedResult),
        stderr,
        stdout,
        timeoutMs: request.timeoutMs,
        events,
      };
      postMessage({
        report,
        type: "done",
      });
    } catch (error) {
      const report: Vm2ExecutionReport = {
        durationMs: Date.now() - startedAt,
        error: makeErrorSummary(error),
        ok: false,
        resultText: null,
        stderr,
        stdout,
        timeoutMs: request.timeoutMs,
        timedOut: false,
        events,
      };
      postMessage({
        report,
        type: "done",
      });
    }
  },
);
