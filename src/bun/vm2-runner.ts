/**
 * @file src/bun/vm2-runner.ts
 * @description Shared helpers for the vm2-backed untrusted JavaScript runner.
 */

import { Buffer } from "node:buffer";
import fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

/** Default sandbox timeout in milliseconds. */
export const VM2_DEFAULT_TIMEOUT_MS = 60_000;

/** Built-in modules allowed inside the NodeVM sandbox. */
export const VM2_SAFE_BUILTINS = Object.freeze([
  "assert",
  "buffer",
  "crypto",
  "events",
  "fs",
  "os",
  "path",
  "perf_hooks",
  "querystring",
  "stream",
  "string_decoder",
  "timers",
  "url",
  "util",
  "zlib",
] as const);

export type Vm2ConsoleLevel =
  | "debug"
  | "dir"
  | "error"
  | "info"
  | "log"
  | "trace"
  | "warn";

type Vm2ConsoleStream = "stderr" | "stdout";

export type Vm2ConsoleEvent = {
  args: string[];
  level: Vm2ConsoleLevel;
  stream: Vm2ConsoleStream;
  text: string;
};

export type Vm2Failure = {
  message: string;
  name: string;
  stack: string | null;
};

export type Vm2SuccessfulExecution = {
  durationMs: number;
  ok: true;
  resultText: string | null;
  stderr: string[];
  stdout: string[];
  timeoutMs: number;
  events: Vm2ConsoleEvent[];
};

export type Vm2FailedExecution = {
  durationMs: number;
  error: Vm2Failure;
  ok: false;
  resultText: string | null;
  stderr: string[];
  stdout: string[];
  timeoutMs: number;
  timedOut: boolean;
  events: Vm2ConsoleEvent[];
};

export type Vm2ExecutionReport = Vm2SuccessfulExecution | Vm2FailedExecution;

export type Vm2WorkerRequest = {
  code: string;
  filename: string;
  timeoutMs: number;
  worktreePath: string;
};

type Vm2WorkerConsoleMessage = {
  event: Vm2ConsoleEvent;
  type: "console";
};

type Vm2WorkerDoneMessage = {
  report: Vm2ExecutionReport;
  type: "done";
};

type Vm2WorkerMessage = Vm2WorkerConsoleMessage | Vm2WorkerDoneMessage;

let vm2SandboxPatchApplied = false;
type Vm2Function = (...args: unknown[]) => unknown;

/**
 * Freeze an object graph recursively.
 * @param value - Input value.
 * @param seen - Internal cycle guard.
 */
function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value === "function") {
    return value;
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    return value;
  }

  seen.add(objectValue);
  Object.freeze(objectValue);

  const prototype = Object.getPrototypeOf(objectValue);
  const shouldRecurse =
    Array.isArray(value) ||
    prototype === Object.prototype ||
    prototype === null;
  if (!shouldRecurse) {
    return value;
  }

  for (const key of Reflect.ownKeys(objectValue)) {
    const child = Reflect.get(objectValue, key);
    deepFreeze(child, seen);
  }
  return value;
}

/**
 * Read a path-like value as a string.
 * @param value - Path-like input.
 */
function readPathLike(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof URL) {
    return fileURLToPath(value);
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).toString("utf8");
  }
  throw new TypeError("Path must be a string, Buffer, typed array, or URL.");
}

/**
 * Resolve a path against the active worktree.
 * @param value - Path-like input.
 * @param worktreePath - Worktree root path.
 */
function resolveWorktreePath(value: unknown, worktreePath: string): string {
  const rawPath = readPathLike(value).trim();
  if (!rawPath) {
    throw new Error("Path is required.");
  }
  return resolve(worktreePath, rawPath);
}

/**
 * Ensure a resolved path remains inside the current worktree.
 * @param resolvedPath - Already resolved path.
 * @param worktreePath - Worktree root path.
 */
function assertWritableResolvedPath(
  resolvedPath: string,
  worktreePath: string,
): void {
  const worktreeRoot = resolve(worktreePath);
  const relativePath = relative(worktreeRoot, resolvedPath);
  if (
    relativePath &&
    (relativePath.startsWith("..") || isAbsolute(relativePath))
  ) {
    throw new Error(
      `Sandbox writes must stay within the current worktree: ${worktreeRoot}`,
    );
  }
}

/**
 * Parse the flags argument from fs.open-like calls.
 * @param value - Flags or options input.
 */
function readOpenFlags(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const flags = record.flags ?? record.flag;
  if (typeof flags === "string" || typeof flags === "number") {
    return flags;
  }
  return null;
}

/**
 * Determine whether an open call requests write access.
 * @param value - Flags or options input.
 */
function isWriteOpenRequest(value: unknown): boolean {
  const flags = readOpenFlags(value);
  if (flags === null) {
    return false;
  }
  if (typeof flags === "number") {
    return (
      (flags &
        (fs.constants.O_WRONLY |
          fs.constants.O_RDWR |
          fs.constants.O_CREAT |
          fs.constants.O_TRUNC |
          fs.constants.O_APPEND |
          fs.constants.O_EXCL)) !==
      0
    );
  }
  return !/^(r|rs|sr)$/.test(flags.trim());
}

/**
 * Build a concise preview string for a sandbox value.
 * @param value - Input value.
 * @param options - Formatting options.
 */
function formatPreview(
  value: unknown,
  options?: { quoteStrings?: boolean; multiline?: boolean },
): string {
  let preview: string;

  switch (typeof value) {
    case "string":
      preview = options?.quoteStrings ? JSON.stringify(value) : value;
      break;
    case "number":
    case "boolean":
    case "bigint":
      preview = String(value);
      break;
    case "undefined":
      preview = "undefined";
      break;
    case "symbol":
      preview = value.toString();
      break;
    case "function":
      preview = `[Function${value.name ? `: ${value.name}` : ""}]`;
      break;
    default:
      preview = inspect(value, {
        breakLength: 120,
        colors: false,
        compact: true,
        customInspect: false,
        depth: 4,
        getters: false,
      });
      break;
  }

  return options?.multiline === false
    ? preview.replace(/\r?\n/g, "\\n")
    : preview;
}

/**
 * Build a console event payload from vm2 event arguments.
 * @param level - Console event level.
 * @param args - Console arguments.
 */
function buildConsoleEvent(
  level: Vm2ConsoleLevel,
  args: unknown[],
): Vm2ConsoleEvent {
  const stream: Vm2ConsoleStream =
    level === "error" || level === "trace" || level === "warn"
      ? "stderr"
      : "stdout";
  const argsText = args.map((arg) =>
    formatPreview(arg, { quoteStrings: false }),
  );
  const text = argsText.length
    ? `[console.${level}] ${argsText.join(" ")}`
    : `[console.${level}]`;

  return {
    args: argsText,
    level,
    stream,
    text: formatPreview(text, { multiline: false }),
  };
}

/**
 * Build a normalized error summary.
 * @param error - Input error.
 */
function summarizeError(error: unknown): Vm2Failure {
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

/**
 * Patch vm2's setup script so Bun can construct a NodeVM.
 *
 * Bun marks one of the globals that vm2 rewires as read-only during setup, which
 * prevents the stock script from completing. Wrapping those assignments keeps the
 * sandbox behavior intact while avoiding the Bun-specific failure.
 */
export function patchVm2SetupSandboxReadFileSync(): void {
  if (vm2SandboxPatchApplied) {
    return;
  }
  vm2SandboxPatchApplied = true;

  const originalReadFileSync = fs.readFileSync;
  const vm2SetupPathFragment = "vm2/lib/setup-sandbox.js";
  const search = [
    "global.Proxy = proxiedProxy;",
    "global.Function = proxiedFunction;",
    "global.eval = new LocalProxy(localEval, EvalHandler);",
  ].join("\n");
  const replacement = [
    "try {",
    "\tglobal.Proxy = proxiedProxy;",
    "\tglobal.Function = proxiedFunction;",
    "\tglobal.eval = new LocalProxy(localEval, EvalHandler);",
    "} catch {}",
  ].join("\n");

  fs.readFileSync = function patchedReadFileSync(
    path: Parameters<typeof fs.readFileSync>[0],
    ...rest: unknown[]
  ) {
    const result = Reflect.apply(originalReadFileSync, fs, [path, ...rest]);

    if (typeof path !== "string" || !path.includes(vm2SetupPathFragment)) {
      return result;
    }

    const source =
      typeof result === "string"
        ? result
        : Buffer.from(
            (result as ArrayBufferView).buffer,
            (result as ArrayBufferView).byteOffset,
            (result as ArrayBufferView).byteLength,
          ).toString("utf8");

    return source.includes(search)
      ? source.replace(search, replacement)
      : source;
  } as typeof fs.readFileSync;
}

/**
 * Build the object exposed as `Bun` in the sandbox.
 * @param none - No arguments.
 */
export function buildVm2BunSandbox(): Record<string, unknown> {
  return deepFreeze({
    TOML: Bun.TOML,
    color: Bun.color,
    deflateSync: Bun.deflateSync,
    gunzipSync: Bun.gunzipSync,
    gzipSync: Bun.gzipSync,
    inflateSync: Bun.inflateSync,
    markdown: Bun.markdown,
    nanoseconds: Bun.nanoseconds,
    semver: Bun.semver,
    sleep: Bun.sleep,
    zstdCompress: Bun.zstdCompress,
    zstdCompressSync: Bun.zstdCompressSync,
    zstdDecompress: Bun.zstdDecompress,
    zstdDecompressSync: Bun.zstdDecompressSync,
  });
}

/**
 * Build the frozen top-level sandbox object.
 * @param none - No arguments.
 */
export function buildVm2Sandbox(): Record<string, unknown> {
  return deepFreeze({
    Bun: buildVm2BunSandbox(),
  });
}

/**
 * Build a fs module mock that only allows writes within the worktree root.
 * @param worktreePath - Worktree root path.
 */
export function buildVm2FsMock(worktreePath: string): Record<string, unknown> {
  const worktreeRoot = resolve(worktreePath);
  const fsReceiver = {
    ...fs,
    promises: { ...fsPromises },
  } as Record<string, unknown>;
  const promisesReceiver = fsReceiver.promises as Record<string, unknown>;
  const wrappedFs = {
    ...fsReceiver,
    promises: { ...promisesReceiver },
  } as Record<string, unknown>;
  const wrappedPromises = wrappedFs.promises as Record<string, unknown>;

  const wrapMethod = <T extends (...args: unknown[]) => unknown>(
    method: T,
    receiver: unknown,
    before?: (args: unknown[]) => void,
  ): T =>
    function wrappedMethod(this: unknown, ...args: unknown[]): unknown {
      before?.(args);
      return Reflect.apply(method, receiver, args as never);
    } as T;

  const resolvePath = (value: unknown): string => {
    return resolveWorktreePath(value, worktreeRoot);
  };

  const assertWritePath = (value: unknown): string => {
    const resolvedPath = resolvePath(value);
    assertWritableResolvedPath(resolvedPath, worktreeRoot);
    return resolvedPath;
  };

  const wrapWritablePathMethod = <T extends (...args: unknown[]) => unknown>(
    method: T,
    receiver: unknown,
    pathIndexes: number[],
  ): T =>
    wrapMethod(method, receiver, (args) => {
      for (const index of pathIndexes) {
        if (typeof args[index] !== "undefined") {
          args[index] = assertWritePath(args[index]);
        }
      }
    });

  const wrapReadablePathMethod = <T extends (...args: unknown[]) => unknown>(
    method: T,
    receiver: unknown,
    pathIndexes: number[],
  ): T =>
    wrapMethod(method, receiver, (args) => {
      for (const index of pathIndexes) {
        if (typeof args[index] !== "undefined") {
          args[index] = resolvePath(args[index]);
        }
      }
    });

  const wrapOpenMethod = <T extends (...args: unknown[]) => unknown>(
    method: T,
    receiver: unknown,
  ): T =>
    wrapMethod(method, receiver, (args) => {
      if (typeof args[0] !== "undefined") {
        args[0] = resolvePath(args[0]);
      }
      if (isWriteOpenRequest(args[1])) {
        assertWritableResolvedPath(args[0] as string, worktreeRoot);
      }
    });

  const wrapCreateWriteStreamMethod = <
    T extends (...args: unknown[]) => unknown,
  >(
    method: T,
    receiver: unknown,
  ): T => wrapWritablePathMethod(method, receiver, [0]);

  const wrapAppendFileMethod = <T extends (...args: unknown[]) => unknown>(
    method: T,
    receiver: unknown,
  ): T => wrapWritablePathMethod(method, receiver, [0]);

  const wrapCopyFileMethod = <T extends (...args: unknown[]) => unknown>(
    method: T,
    receiver: unknown,
  ): T =>
    wrapMethod(method, receiver, (args) => {
      if (typeof args[0] !== "undefined") {
        args[0] = resolvePath(args[0]);
      }
      if (typeof args[1] !== "undefined") {
        args[1] = assertWritePath(args[1]);
      }
    });

  const wrapRenameMethod = <T extends (...args: unknown[]) => unknown>(
    method: T,
    receiver: unknown,
  ): T =>
    wrapMethod(method, receiver, (args) => {
      if (typeof args[0] !== "undefined") {
        args[0] = assertWritePath(args[0]);
      }
      if (typeof args[1] !== "undefined") {
        args[1] = assertWritePath(args[1]);
      }
    });

  const wrapSinglePathWriteMethod = <T extends (...args: unknown[]) => unknown>(
    method: T,
    receiver: unknown,
  ): T => wrapWritablePathMethod(method, receiver, [0]);

  const wrapHardLinkMethod = <T extends (...args: unknown[]) => unknown>(
    method: T,
    receiver: unknown,
  ): T =>
    wrapMethod(method, receiver, (args) => {
      if (typeof args[0] !== "undefined") {
        args[0] = resolvePath(args[0]);
      }
      if (typeof args[1] !== "undefined") {
        args[1] = assertWritePath(args[1]);
      }
    });

  const wrapSoftLinkMethod = <T extends (...args: unknown[]) => unknown>(
    method: T,
    receiver: unknown,
  ): T =>
    wrapMethod(method, receiver, (args) => {
      if (typeof args[0] !== "undefined") {
        args[0] = resolvePath(args[0]);
      }
      if (typeof args[1] !== "undefined") {
        args[1] = assertWritePath(args[1]);
      }
    });

  const topLevelWrappers: Array<
    [string, (method: Vm2Function) => Vm2Function]
  > = [
    ["access", (method) => wrapReadablePathMethod(method, fsReceiver, [0])],
    ["accessSync", (method) => wrapReadablePathMethod(method, fsReceiver, [0])],
    ["appendFile", (method) => wrapAppendFileMethod(method, fsReceiver)],
    ["appendFileSync", (method) => wrapAppendFileMethod(method, fsReceiver)],
    ["chmod", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["chmodSync", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["chown", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["chownSync", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["copyFile", (method) => wrapCopyFileMethod(method, fsReceiver)],
    ["copyFileSync", (method) => wrapCopyFileMethod(method, fsReceiver)],
    ["cp", (method) => wrapCopyFileMethod(method, fsReceiver)],
    ["cpSync", (method) => wrapCopyFileMethod(method, fsReceiver)],
    [
      "createReadStream",
      (method) => wrapReadablePathMethod(method, fsReceiver, [0]),
    ],
    [
      "createWriteStream",
      (method) => wrapCreateWriteStreamMethod(method, fsReceiver),
    ],
    ["existsSync", (method) => wrapReadablePathMethod(method, fsReceiver, [0])],
    ["link", (method) => wrapHardLinkMethod(method, fsReceiver)],
    ["linkSync", (method) => wrapHardLinkMethod(method, fsReceiver)],
    ["lchown", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["lchownSync", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["mkdir", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["mkdirSync", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["mkdtemp", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["mkdtempSync", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["open", (method) => wrapOpenMethod(method, fsReceiver)],
    ["openSync", (method) => wrapOpenMethod(method, fsReceiver)],
    ["opendir", (method) => wrapReadablePathMethod(method, fsReceiver, [0])],
    [
      "opendirSync",
      (method) => wrapReadablePathMethod(method, fsReceiver, [0]),
    ],
    ["rename", (method) => wrapRenameMethod(method, fsReceiver)],
    ["renameSync", (method) => wrapRenameMethod(method, fsReceiver)],
    ["rm", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["rmSync", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["rmdir", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["rmdirSync", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["readFile", (method) => wrapReadablePathMethod(method, fsReceiver, [0])],
    [
      "readFileSync",
      (method) => wrapReadablePathMethod(method, fsReceiver, [0]),
    ],
    ["readdir", (method) => wrapReadablePathMethod(method, fsReceiver, [0])],
    [
      "readdirSync",
      (method) => wrapReadablePathMethod(method, fsReceiver, [0]),
    ],
    ["readlink", (method) => wrapReadablePathMethod(method, fsReceiver, [0])],
    [
      "readlinkSync",
      (method) => wrapReadablePathMethod(method, fsReceiver, [0]),
    ],
    ["realpath", (method) => wrapReadablePathMethod(method, fsReceiver, [0])],
    [
      "realpathSync",
      (method) => wrapReadablePathMethod(method, fsReceiver, [0]),
    ],
    ["stat", (method) => wrapReadablePathMethod(method, fsReceiver, [0])],
    ["statSync", (method) => wrapReadablePathMethod(method, fsReceiver, [0])],
    ["lstat", (method) => wrapReadablePathMethod(method, fsReceiver, [0])],
    ["lstatSync", (method) => wrapReadablePathMethod(method, fsReceiver, [0])],
    ["symlink", (method) => wrapSoftLinkMethod(method, fsReceiver)],
    ["symlinkSync", (method) => wrapSoftLinkMethod(method, fsReceiver)],
    ["truncate", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["truncateSync", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["utimes", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["utimesSync", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["lutimes", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["lutimesSync", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    ["writeFile", (method) => wrapSinglePathWriteMethod(method, fsReceiver)],
    [
      "writeFileSync",
      (method) => wrapSinglePathWriteMethod(method, fsReceiver),
    ],
  ];

  for (const [name, wrapper] of topLevelWrappers) {
    const method = wrappedFs[name];
    if (typeof method === "function") {
      wrappedFs[name] = wrapper(method as Vm2Function);
    }
  }

  const promisesWrappers: Array<
    [string, (method: Vm2Function) => Vm2Function]
  > = [
    [
      "access",
      (method) => wrapReadablePathMethod(method, promisesReceiver, [0]),
    ],
    ["appendFile", (method) => wrapAppendFileMethod(method, promisesReceiver)],
    ["chmod", (method) => wrapSinglePathWriteMethod(method, promisesReceiver)],
    ["chown", (method) => wrapSinglePathWriteMethod(method, promisesReceiver)],
    ["copyFile", (method) => wrapCopyFileMethod(method, promisesReceiver)],
    ["cp", (method) => wrapCopyFileMethod(method, promisesReceiver)],
    ["link", (method) => wrapHardLinkMethod(method, promisesReceiver)],
    ["lchown", (method) => wrapSinglePathWriteMethod(method, promisesReceiver)],
    ["mkdir", (method) => wrapSinglePathWriteMethod(method, promisesReceiver)],
    [
      "mkdtemp",
      (method) => wrapSinglePathWriteMethod(method, promisesReceiver),
    ],
    ["open", (method) => wrapOpenMethod(method, promisesReceiver)],
    [
      "opendir",
      (method) => wrapReadablePathMethod(method, promisesReceiver, [0]),
    ],
    ["rename", (method) => wrapRenameMethod(method, promisesReceiver)],
    ["rm", (method) => wrapSinglePathWriteMethod(method, promisesReceiver)],
    ["rmdir", (method) => wrapSinglePathWriteMethod(method, promisesReceiver)],
    [
      "readFile",
      (method) => wrapReadablePathMethod(method, promisesReceiver, [0]),
    ],
    [
      "readdir",
      (method) => wrapReadablePathMethod(method, promisesReceiver, [0]),
    ],
    [
      "readlink",
      (method) => wrapReadablePathMethod(method, promisesReceiver, [0]),
    ],
    [
      "realpath",
      (method) => wrapReadablePathMethod(method, promisesReceiver, [0]),
    ],
    ["stat", (method) => wrapReadablePathMethod(method, promisesReceiver, [0])],
    [
      "lstat",
      (method) => wrapReadablePathMethod(method, promisesReceiver, [0]),
    ],
    ["symlink", (method) => wrapSoftLinkMethod(method, promisesReceiver)],
    [
      "truncate",
      (method) => wrapSinglePathWriteMethod(method, promisesReceiver),
    ],
    ["utimes", (method) => wrapSinglePathWriteMethod(method, promisesReceiver)],
    [
      "lutimes",
      (method) => wrapSinglePathWriteMethod(method, promisesReceiver),
    ],
    [
      "writeFile",
      (method) => wrapSinglePathWriteMethod(method, promisesReceiver),
    ],
  ];

  for (const [name, wrapper] of promisesWrappers) {
    const method = wrappedPromises[name];
    if (typeof method === "function") {
      wrappedPromises[name] = wrapper(method as Vm2Function);
    }
  }

  return deepFreeze(wrappedFs);
}

/**
 * Build vm2 require options for the current worktree.
 * @param worktreePath - Worktree root path.
 */
export function buildVm2RequireOptions(
  worktreePath: string,
): Record<string, unknown> {
  const worktreeRoot = resolve(worktreePath);
  return deepFreeze({
    builtin: [...VM2_SAFE_BUILTINS],
    external: [],
    import: [...VM2_SAFE_BUILTINS],
    mock: {
      fs: buildVm2FsMock(worktreeRoot),
    },
    root: [worktreeRoot],
    strict: true,
  });
}

/**
 * Format a sandbox value for tool output.
 * @param value - Input value.
 */
export function formatVm2Value(value: unknown): string {
  return formatPreview(value, { quoteStrings: true });
}

/**
 * Format a console event for transport to the MCP tool output.
 * @param level - Console event level.
 * @param args - Console event arguments.
 */
export function formatVm2ConsoleEvent(
  level: Vm2ConsoleLevel,
  args: unknown[],
): Vm2ConsoleEvent {
  return buildConsoleEvent(level, args);
}

/**
 * Build a sandbox execution report suitable for MCP output.
 * @param options - Execution options.
 */
export async function runUntrustedJavaScriptInVm2(options: {
  code: string;
  filename?: string;
  timeoutMs?: number;
  worktreePath?: string;
}): Promise<Vm2ExecutionReport> {
  const startedAt = Date.now();
  const timeoutMs = normalizeVm2TimeoutMs(options.timeoutMs);
  const worktreePath = options.worktreePath?.trim() || process.cwd();
  const filename = options.filename?.trim() || "sandbox.ts";
  const events: Vm2ConsoleEvent[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];

  try {
    const worker = new Worker(
      new URL("./vm2-runner-worker.ts", import.meta.url),
      {
        type: "module",
      },
    );

    return await new Promise<Vm2ExecutionReport>((resolve) => {
      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const workerClosed = new Promise<void>((closeResolve) => {
        worker.addEventListener(
          "close",
          () => {
            closeResolve();
          },
          { once: true },
        );
      });

      const finish = (
        report: Vm2ExecutionReport,
        waitForClose = true,
      ): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        worker.onmessage = null;
        worker.onerror = null;
        const resolveReport = (): void => {
          if (!waitForClose) {
            resolve(report);
            return;
          }
          void workerClosed.then(() => {
            resolve(report);
          });
        };

        try {
          const termination = worker.terminate() as unknown;
          if (
            termination &&
            typeof (termination as { then?: unknown }).then === "function"
          ) {
            void (termination as Promise<unknown>)
              .catch(() => {
                // Ignore worker shutdown errors; the report already captures the run outcome.
              })
              .finally(() => {
                resolveReport();
              });
            return;
          }
        } catch {
          // Ignore worker shutdown errors; the report already captures the run outcome.
        }

        resolveReport();
      };

      worker.onmessage = (event: MessageEvent<Vm2WorkerMessage>) => {
        const message = event.data;
        if (!message || typeof message !== "object" || !("type" in message)) {
          return;
        }

        if (message.type === "console") {
          events.push(message.event);
          if (message.event.stream === "stdout") {
            stdout.push(message.event.text);
          } else {
            stderr.push(message.event.text);
          }
          return;
        }

        if (message.type === "done") {
          finish(message.report);
        }
      };

      worker.onerror = (event: ErrorEvent) => {
        finish({
          durationMs: Date.now() - startedAt,
          error: {
            message: event.message || "vm2 worker failed.",
            name: event.error instanceof Error ? event.error.name : "Error",
            stack:
              event.error instanceof Error ? (event.error.stack ?? null) : null,
          },
          ok: false,
          resultText: null,
          stderr,
          stdout,
          timeoutMs,
          timedOut: false,
          events,
        });
      };

      worker.postMessage({
        code: options.code,
        filename,
        timeoutMs,
        worktreePath,
      } satisfies Vm2WorkerRequest);

      timeoutHandle = setTimeout(() => {
        finish(
          {
            durationMs: Date.now() - startedAt,
            error: {
              message: `Sandbox timed out after ${timeoutMs}ms.`,
              name: "TimeoutError",
              stack: null,
            },
            ok: false,
            resultText: null,
            stderr,
            stdout,
            timeoutMs,
            timedOut: true,
            events,
          },
          false,
        );
      }, timeoutMs);
    });
  } catch (error) {
    return {
      durationMs: Date.now() - startedAt,
      error: summarizeError(error),
      ok: false,
      resultText: null,
      stderr,
      stdout,
      timeoutMs,
      timedOut: false,
      events,
    };
  }
}

/**
 * Format an execution report for the MCP tool output.
 * @param report - Execution report.
 */
export function formatVm2ExecutionReportText(
  report: Vm2ExecutionReport,
): string {
  const lines: string[] = [];
  lines.push(
    report.ok
      ? `Sandbox completed in ${report.durationMs}ms.`
      : report.timedOut
        ? `Sandbox timed out after ${report.durationMs}ms.`
        : `Sandbox failed in ${report.durationMs}ms.`,
  );

  if (report.stdout.length > 0) {
    lines.push("", "stdout:");
    lines.push(...report.stdout);
  }

  if (report.stderr.length > 0) {
    lines.push("", "stderr:");
    lines.push(...report.stderr);
  }

  if (report.ok) {
    lines.push("", `result: ${report.resultText ?? "undefined"}`);
  } else {
    lines.push("", `error: ${report.error.name}: ${report.error.message}`);
    if (report.error.stack) {
      lines.push("", report.error.stack);
    }
  }

  return lines.join("\n");
}

function normalizeVm2TimeoutMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return VM2_DEFAULT_TIMEOUT_MS;
  }
  return Math.max(1, Math.floor(value));
}
