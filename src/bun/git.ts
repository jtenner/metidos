/**
 * @file src/bun/git.ts
 * @description Module for git.
 */

import {
  constants as fsConstants,
  existsSync,
  mkdtempSync,
  realpathSync,
  statSync,
} from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import type {
  RpcGitCommitDiffResult,
  RpcGitHistoryEntry,
  RpcWorktree,
  RpcWorktreeChange,
  RpcWorktreeChangeStatus,
  RpcWorktreeFileContentPage,
  RpcWorktreeGitHistoryResult,
  RpcWorktreeGitHistorySummary,
  RpcWorktreeSnapshot,
} from "./rpc-schema";

const GIT_EXECUTABLE_FALLBACK_DIRECTORIES =
  process.platform === "darwin"
    ? [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/Library/Developer/CommandLineTools/usr/bin",
      ]
    : process.platform === "win32"
      ? [
          "C:\\Program Files\\Git\\cmd",
          "C:\\Program Files\\Git\\bin",
          "C:\\Program Files (x86)\\Git\\cmd",
          "C:\\Program Files (x86)\\Git\\bin",
        ]
      : ["/usr/local/bin", "/usr/bin", "/bin"];
/** Delimiter used by low-level `git log` records before parsing.
 * `\u001f` avoids collisions with ordinary subject/author text.
 */

const GIT_LOG_FIELD_SEPARATOR = "\u001f";
/** Record separator used to split `git log` batches safely. */
const GIT_LOG_RECORD_SEPARATOR = "\u001e";
/** Default file content page size for `readWorktreeFileContentPage`. */

const DEFAULT_WORKTREE_FILE_CONTENT_PAGE_BYTES = 64 * 1024;
/** Hard page-size cap to prevent fetching unbounded file content in one query. */
const MAX_WORKTREE_FILE_CONTENT_PAGE_BYTES = 256 * 1024;
const DEFAULT_GIT_COMMAND_MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_SYNTHETIC_ADD_DIFF_BYTES = 1024 * 1024;
const MAX_SYNTHETIC_ADD_DIFF_BINARY_SCAN_BYTES = 8192;
const MAX_SYNTHETIC_ADD_DIFF_LINES = 5000;

export const DEFAULT_GIT_HISTORY_PAGE_SIZE = 20;

export type GitCommandPriority = "foreground" | "background";

export type GitCommandOptions = {
  maxStdoutBytes?: number | null;
  priority?: GitCommandPriority;
  signal?: AbortSignal | null;
};

type GitCommandQueueTask = {
  abort: (reason: string) => void;
  detachAbortListener: () => void;
  priority: GitCommandPriority;
  reject: (reason?: unknown) => void;
  run: () => void;
  signal: AbortSignal;
  started: boolean;
};

const gitCommandQueueMap = new Map<
  string,
  {
    active: boolean;
    activeTask: GitCommandQueueTask | null;
    backgroundTasks: GitCommandQueueTask[];
    foregroundTasks: GitCommandQueueTask[];
  }
>();
let cachedGitExecutablePath: string | null = null;
let cachedEmptyGitHooksPath: string | null = null;

export function buildGitSpawnEnv(
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  // Keep this environment intentionally small. In particular, do not forward
  // XDG_CONFIG_HOME, XDG_DATA_HOME, or GIT_CONFIG_GLOBAL: Metidos supplies its
  // own safe git configuration below and must not inherit user/global aliases,
  // hooks, or config that can change command behavior.
  const allowedNames = [
    "COMSPEC",
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "PATHEXT",
    "SSH_AUTH_SOCK",
    "SystemRoot",
    "TEMP",
    "TMP",
    "USER",
    "USERNAME",
    "WINDIR",
  ];
  const spawnEnv: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const name of allowedNames) {
    const value = env[name];
    if (typeof value === "string") {
      spawnEnv[name] = value;
    }
  }
  return Object.freeze(spawnEnv);
}

const GIT_SPAWN_ENV = buildGitSpawnEnv(process.env);

function normalizeGitCommandCwd(cwd: string): string {
  const resolved = resolve(cwd);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** Return current UTC timestamp as an ISO string for snapshot metadata. */

function getNow(): string {
  return new Date().toISOString();
}

/**
 * Build a stable `AbortError`-shaped object from either a DOM abort reason
 * or a fallback string, preserving original cause when available.
 * @param reason - Reason for this operation.
 * @param fallbackMessage - Message returned when parsing the error fails.
 */
function createAbortError(reason: unknown, fallbackMessage: string): Error {
  if (reason instanceof Error) {
    return reason;
  }

  const error = new Error(
    typeof reason === "string" && reason.trim() ? reason : fallbackMessage,
    {
      cause: reason,
    },
  );
  if (reason instanceof DOMException && reason.name) {
    error.name = reason.name;
  } else {
    error.name = "AbortError";
  }
  return error;
}

/**
 * Throw an AbortError immediately when the provided signal is already aborted.
 */

function throwIfAborted(
  signal: AbortSignal | null | undefined,
  fallbackMessage: string,
): void {
  if (signal?.aborted) {
    throw createAbortError(signal.reason, fallbackMessage);
  }
}

/** Guard against missing or non-executable paths when resolving git binary. */
function safeIsExecutableFile(path: string): boolean {
  try {
    const stats = statSync(path);
    if (!stats.isFile()) {
      return false;
    }
    return process.platform === "win32" || (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** Return the list of executable names to probe for git on each platform. */

function gitExecutableCandidateNames(): string[] {
  return process.platform === "win32"
    ? ["git.exe", "git.cmd", "git.bat", "git"]
    : ["git"];
}

/** Read PATH with case-tolerant fallback for Windows shell environments. */
function readProcessPathValue(): string {
  return process.env.PATH?.trim() || process.env.Path?.trim() || "";
}

/**
 * Resolve git executable path, preferring previous cached successful location.
 * Falls back across PATH and platform-specific default locations.
 */

function resolveGitExecutablePath(): string {
  if (
    cachedGitExecutablePath &&
    safeIsExecutableFile(cachedGitExecutablePath)
  ) {
    return cachedGitExecutablePath;
  }

  const discoveredGitPath = Bun.which("git");
  if (discoveredGitPath && safeIsExecutableFile(discoveredGitPath)) {
    cachedGitExecutablePath = discoveredGitPath;
    return discoveredGitPath;
  }

  const searchDirectories = [
    ...readProcessPathValue()
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean),
    ...GIT_EXECUTABLE_FALLBACK_DIRECTORIES,
  ];
  const seenDirectories = new Set<string>();

  for (const directory of searchDirectories) {
    if (seenDirectories.has(directory)) {
      continue;
    }
    seenDirectories.add(directory);

    for (const executableName of gitExecutableCandidateNames()) {
      const candidatePath = resolve(directory, executableName);
      if (!safeIsExecutableFile(candidatePath)) {
        continue;
      }
      cachedGitExecutablePath = candidatePath;
      return candidatePath;
    }
  }

  throw new Error(
    "Could not locate the git executable. Ensure git is installed and available on PATH.",
  );
}

/** Return a portable hooksPath override for git commands that must not run hooks. */
function getGitHooksPathOverride(): string {
  if (process.platform === "win32") {
    return "NUL";
  }
  if (cachedEmptyGitHooksPath && existsSync(cachedEmptyGitHooksPath)) {
    return cachedEmptyGitHooksPath;
  }
  cachedEmptyGitHooksPath = mkdtempSync(join(tmpdir(), "metidos-git-hooks-"));
  return cachedEmptyGitHooksPath;
}

/** Normalize git command options into canonical internal values. */
export function normalizeGitCommandOptions(
  options?: GitCommandPriority | GitCommandOptions,
): {
  maxStdoutBytes: number | null;
  priority: GitCommandPriority;
  signal: AbortSignal | null;
} {
  if (options === "foreground" || options === "background") {
    return {
      maxStdoutBytes: DEFAULT_GIT_COMMAND_MAX_STDOUT_BYTES,
      priority: options,
      signal: null,
    };
  }

  return {
    maxStdoutBytes:
      typeof options?.maxStdoutBytes === "number"
        ? Math.max(0, Math.floor(options.maxStdoutBytes))
        : options?.maxStdoutBytes === null
          ? null
          : DEFAULT_GIT_COMMAND_MAX_STDOUT_BYTES,
    priority: options?.priority ?? "foreground",
    signal: options?.signal ?? null,
  };
}

export async function readGitTextStream(
  stream: ReadableStream<Uint8Array> | null,
  options?: {
    maxBytes?: number | null;
    onMaxBytesExceeded?: () => void;
    signal?: AbortSignal | null;
    swallowAbort?: boolean;
  },
): Promise<string> {
  if (!stream) {
    return "";
  }

  if (options?.signal?.aborted) {
    if (options.swallowAbort) {
      return "";
    }
    throw createAbortError(options.signal.reason, "Git command was aborted.");
  }

  const reader = stream.getReader();
  let byteCount = 0;
  const chunks: Uint8Array[] = [];
  let aborted = false;
  const handleAbort = () => {
    aborted = true;
    void reader.cancel(options?.signal?.reason).catch(() => {});
  };

  options?.signal?.addEventListener("abort", handleAbort, {
    once: true,
  });

  const readDecodedText = () => {
    if (byteCount === 0) {
      return "";
    }
    if (chunks.length === 1) {
      return new TextDecoder().decode(chunks[0]);
    }
    const bytes = new Uint8Array(byteCount);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  };

  try {
    while (true) {
      if (aborted) {
        if (options?.swallowAbort) {
          return readDecodedText();
        }
        throw createAbortError(
          options?.signal?.reason,
          "Git command was aborted.",
        );
      }

      const chunk = await reader.read();
      if (chunk.done) {
        if (aborted) {
          if (options?.swallowAbort) {
            return readDecodedText();
          }
          throw createAbortError(
            options?.signal?.reason,
            "Git command was aborted.",
          );
        }
        break;
      }
      byteCount += chunk.value.byteLength;
      if (
        typeof options?.maxBytes === "number" &&
        byteCount > options.maxBytes
      ) {
        options.onMaxBytesExceeded?.();
        throw new Error(
          `git command stdout exceeded ${options.maxBytes} bytes.`,
        );
      }
      if (chunk.value.byteLength > 0) {
        chunks.push(chunk.value);
      }
    }
    return readDecodedText();
  } catch (error) {
    if (aborted && options?.swallowAbort) {
      return readDecodedText();
    }
    if (aborted) {
      throw createAbortError(
        options?.signal?.reason,
        "Git command was aborted.",
      );
    }
    throw error;
  } finally {
    options?.signal?.removeEventListener("abort", handleAbort);
    reader.releaseLock();
  }
}

/**
 * Read-only snapshot for diagnostics and scheduling observability.
 * Counts active and queued jobs across all cwd-scoped queues.
 */

export function getGitSchedulerStats(): {
  activeBackgroundCount: number;
  activeForegroundCount: number;
  queueCount: number;
  queuedBackgroundCount: number;
  queuedForegroundCount: number;
} {
  let activeBackgroundCount = 0;
  let activeForegroundCount = 0;
  let queuedBackgroundCount = 0;
  let queuedForegroundCount = 0;

  for (const queue of gitCommandQueueMap.values()) {
    if (queue.activeTask?.priority === "foreground") {
      activeForegroundCount += 1;
    } else if (queue.activeTask?.priority === "background") {
      activeBackgroundCount += 1;
    }
    queuedForegroundCount += queue.foregroundTasks.length;
    queuedBackgroundCount += queue.backgroundTasks.length;
  }

  return {
    activeBackgroundCount,
    activeForegroundCount,
    queueCount: gitCommandQueueMap.size,
    queuedBackgroundCount,
    queuedForegroundCount,
  };
}

/** Remove a queued task from whichever bucket (foreground/background) currently holds it. */
function removeGitCommandTask(
  queue: {
    backgroundTasks: GitCommandQueueTask[];
    foregroundTasks: GitCommandQueueTask[];
  },
  task: GitCommandQueueTask,
): void {
  const foregroundIndex = queue.foregroundTasks.indexOf(task);
  if (foregroundIndex >= 0) {
    queue.foregroundTasks.splice(foregroundIndex, 1);
    return;
  }

  const backgroundIndex = queue.backgroundTasks.indexOf(task);
  if (backgroundIndex >= 0) {
    queue.backgroundTasks.splice(backgroundIndex, 1);
  }
}

/**
 * Reject a queued task with a normalized abort error.
 * @param task - A function wrapping the current git operation.
 * @param reason - Reason for this operation.
 */
function abortQueuedGitTask(task: GitCommandQueueTask, reason: string): void {
  task.reject(createAbortError(null, reason));
}

/**
 * Cancel active background work for a repository and clear remaining queue entries.
 * Called when a foreground request arrives and must preempt lower-priority tasks.
 * @param reason - Reason for this operation.
 */
function abortBackgroundGitCommands(
  cwd: string,
  queue: {
    active: boolean;
    activeTask: GitCommandQueueTask | null;
    backgroundTasks: GitCommandQueueTask[];
    foregroundTasks: GitCommandQueueTask[];
  },
  reason: string,
): void {
  if (queue.activeTask?.priority === "background") {
    queue.activeTask.abort(reason);
  }

  for (const task of [...queue.backgroundTasks]) {
    removeGitCommandTask(queue, task);
    abortQueuedGitTask(task, reason);
  }

  if (
    !queue.active &&
    queue.activeTask === null &&
    queue.foregroundTasks.length === 0 &&
    queue.backgroundTasks.length === 0
  ) {
    gitCommandQueueMap.delete(cwd);
  }
}

/**
 * Start the next available task for this cwd, honoring foreground-first scheduling.
 * Completed tasks re-trigger scheduling to continue draining queued work.
 * @param cwd - Current working directory.
 */
function scheduleGitCommandQueue(cwd: string): void {
  const queue = gitCommandQueueMap.get(cwd);
  if (!queue || queue.active) {
    return;
  }

  let nextTask =
    queue.foregroundTasks.shift() ?? queue.backgroundTasks.shift() ?? null;
  while (nextTask?.signal?.aborted) {
    nextTask.detachAbortListener();
    nextTask.reject(
      createAbortError(nextTask.signal.reason, "Git command was aborted."),
    );
    nextTask =
      queue.foregroundTasks.shift() ?? queue.backgroundTasks.shift() ?? null;
  }
  if (!nextTask) {
    gitCommandQueueMap.delete(cwd);
    return;
  }

  queue.active = true;
  queue.activeTask = nextTask;
  nextTask.run();
}

/**
 * Enqueue a git command with cancellation-aware execution.
 * Foreground tasks preempt background, with deduplicated queue bookkeeping by cwd.
 */

function enqueueGitCommand<T>(
  cwd: string,
  priority: GitCommandPriority,
  signal: AbortSignal | null,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const queue = gitCommandQueueMap.get(cwd) ?? {
    active: false,
    activeTask: null,
    backgroundTasks: [],
    foregroundTasks: [],
  };
  gitCommandQueueMap.set(cwd, queue);

  return new Promise<T>((resolve, reject) => {
    const taskAbortController = new AbortController();
    const taskSignal = signal
      ? AbortSignal.any([signal, taskAbortController.signal])
      : taskAbortController.signal;
    let settled = false;
    /**
     * Finalizes request handling.
     * @param callback - Callback to invoke.
     */

    const finalize = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      task.detachAbortListener();
      callback();
    };

    const task: GitCommandQueueTask = {
      abort: (reason) => {
        taskAbortController.abort(createAbortError(null, reason));
      },
      detachAbortListener: () => {},
      priority,
      reject: (reason) =>
        finalize(() => {
          reject(reason);
        }),
      run: () => {
        task.started = true;
        void Promise.resolve()
          .then(() => {
            throwIfAborted(task.signal, "Git command was aborted.");
            return run(task.signal);
          })
          .then(
            (value) => {
              finalize(() => {
                resolve(value);
              });
            },
            (error) => {
              finalize(() => {
                reject(error);
              });
            },
          )
          .finally(() => {
            if (queue.activeTask === task) {
              queue.activeTask = null;
            }
            queue.active = false;
            scheduleGitCommandQueue(cwd);
          });
      },
      signal: taskSignal,
      started: false,
    };

    if (task.signal) {
      const handleAbort = () => {
        if (task.started) {
          return;
        }
        removeGitCommandTask(queue, task);
        finalize(() => {
          reject(
            createAbortError(task.signal.reason, "Git command was aborted."),
          );
        });
      };
      task.signal.addEventListener("abort", handleAbort, {
        once: true,
      });
      task.detachAbortListener = () => {
        task.signal.removeEventListener("abort", handleAbort);
      };
    }

    if (task.signal.aborted) {
      finalize(() => {
        reject(
          createAbortError(task.signal.reason, "Git command was aborted."),
        );
      });
      return;
    }

    if (priority === "foreground") {
      queue.foregroundTasks.push(task);
      abortBackgroundGitCommands(
        cwd,
        queue,
        `Foreground git command preempted background work for ${cwd}.`,
      );
    } else {
      queue.backgroundTasks.push(task);
    }
    scheduleGitCommandQueue(cwd);
  });
}

function assertSafeGitCommandArgs(args: readonly string[]): void {
  const [command] = args;
  if (!command || command.startsWith("-")) {
    throw new Error("Git command args must start with an explicit subcommand.");
  }
}

/**
 * Spawn git with normalized options and return raw command output.
 * Command execution is serialized via the scheduler and cancellation-aware.
 */

export async function runGitCommandResult(
  cwd: string,
  args: string[],
  options?: GitCommandPriority | GitCommandOptions,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  // This low-level helper intentionally does not know which project/worktree a
  // cwd should belong to. Public procedures resolve ownership and worktree
  // visibility before calling git helpers, then file-level operations call
  // normalizeGitPath for containment. The scheduler only canonicalizes cwd so
  // commands for the same real repository are serialized together.
  assertSafeGitCommandArgs(args);
  const { maxStdoutBytes, priority, signal } =
    normalizeGitCommandOptions(options);
  const normalizedCwd = normalizeGitCommandCwd(cwd);
  return enqueueGitCommand(
    normalizedCwd,
    priority,
    signal,
    async (taskSignal) => {
      throwIfAborted(signal, "Git command was aborted.");
      throwIfAborted(taskSignal, "Git command was aborted.");
      const gitExecutablePath = resolveGitExecutablePath();
      const stderrAbortController = new AbortController();
      const proc = Bun.spawn({
        cmd: [
          gitExecutablePath,
          "-c",
          `core.hooksPath=${getGitHooksPathOverride()}`,
          "-c",
          "core.fsmonitor=false",
          ...args,
        ],
        cwd: normalizedCwd,
        env: GIT_SPAWN_ENV,
        stdout: "pipe",
        stderr: "pipe",
        signal: taskSignal,
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        readGitTextStream(proc.stdout, {
          maxBytes: maxStdoutBytes,
          onMaxBytesExceeded: () => {
            stderrAbortController.abort(
              createAbortError(
                null,
                "Git stderr collection stopped after stdout overflow.",
              ),
            );
            proc.kill();
          },
        }),
        readGitTextStream(proc.stderr, {
          signal: stderrAbortController.signal,
          swallowAbort: true,
        }),
        proc.exited,
      ]);
      throwIfAborted(signal, "Git command was aborted.");
      throwIfAborted(taskSignal, "Git command was aborted.");

      return {
        exitCode,
        stderr: stderr.length === 0 ? "" : stderr.trim(),
        stdout,
      };
    },
  );
}

/** Build a user-facing message from git exit status and captured stderr. */
function gitCommandFailureMessage(result: {
  exitCode: number;
  stderr: string;
}): string {
  return (
    result.stderr || `git command failed with exit code ${result.exitCode}`
  );
}

/** Detect common "no HEAD yet / empty repository" failures from git history calls. */

function isNoHeadGitHistoryFailure(result: {
  exitCode: number;
  stderr: string;
}): boolean {
  if (result.exitCode === 0) {
    return false;
  }

  const normalizedError = result.stderr.toLowerCase();
  return (
    (normalizedError.includes("ambiguous argument 'head'") &&
      normalizedError.includes("unknown revision or path")) ||
    normalizedError.includes("bad revision 'head'") ||
    normalizedError.includes("bad default revision 'head'") ||
    normalizedError.includes("does not have any commits yet")
  );
}

/**
 * Run git commands used for history reads where an empty/no-HEAD repo
 * should be treated as a valid "no data" state.
 */

async function runGitHistoryCommand(
  cwd: string,
  args: string[],
  options?: GitCommandPriority | GitCommandOptions,
): Promise<string | null> {
  const result = await runGitCommandResult(cwd, args, options);
  if (result.exitCode === 0) {
    return result.stdout.trimEnd();
  }
  if (isNoHeadGitHistoryFailure(result)) {
    return null;
  }
  throw new Error(gitCommandFailureMessage(result));
}

/**
 * Execute git and throw on non-zero exit. Returns trimmed stdout on success.
 */

export async function runGitCommand(
  cwd: string,
  args: string[],
  options?: GitCommandPriority | GitCommandOptions,
): Promise<string> {
  const { exitCode, stderr, stdout } = await runGitCommandResult(
    cwd,
    args,
    options,
  );
  if (exitCode !== 0) {
    throw new Error(stderr || `git command failed with exit code ${exitCode}`);
  }
  return stdout.trimEnd();
}

/** Normalize an absolute worktree-relative git path to slash-delimited relative form. */
export function normalizeGitPath(worktreePath: string, value: string): string {
  const resolvedWorktreePath = resolve(worktreePath);
  const resolvedPath = resolve(resolvedWorktreePath, value);
  assertPathInsideWorktree(resolvedWorktreePath, resolvedPath, value);
  return relative(resolvedWorktreePath, resolvedPath).replace(/\\/g, "/");
}

/**
 * Return true when a path falls outside a root after path normalization.
 * @param rootPath - Root directory path.
 * @param candidatePath - candidatePath path used by candidatePath.
 */
function pathEscapesRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  if (!relativePath) {
    return false;
  }
  return (
    relativePath === ".." ||
    relativePath.split(/[\\/]/).includes("..") ||
    isAbsolute(relativePath)
  );
}

/**
 * Resolve the nearest existing ancestor so symlink escapes are detected
 * even when the final file path does not exist yet.
 * @param path - Filesystem path.
 */
function nearestExistingPath(path: string): string | null {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return current;
}

/**
 * Ensure a path stays within the worktree both lexically and after realpath resolution.
 */

function assertPathInsideWorktree(
  worktreePath: string,
  candidatePath: string,
  originalValue: string,
): void {
  if (pathEscapesRoot(worktreePath, candidatePath)) {
    throw new Error(
      `Path must stay within worktree ${worktreePath}: ${originalValue}`,
    );
  }

  const existingPath = nearestExistingPath(candidatePath);
  if (!existingPath) {
    return;
  }

  let realWorktreePath = worktreePath;
  try {
    realWorktreePath = realpathSync(worktreePath);
  } catch {
    // Fall back to the normalized worktree path if the real path can't be resolved.
  }

  let realCandidatePath = existingPath;
  try {
    realCandidatePath = realpathSync(existingPath);
  } catch {
    return;
  }

  if (pathEscapesRoot(realWorktreePath, realCandidatePath)) {
    throw new Error(
      `Path must stay within worktree ${worktreePath}: ${originalValue}`,
    );
  }
}

/** Split command output into logical lines while normalizing CRLF. */
function splitLines(value: string): string[] {
  if (!value) {
    return [];
  }
  return value.replace(/\r\n/g, "\n").split("\n");
}

/**
 * Build a synthetic add diff for binary/add-only files where `git diff` may be empty.
 * @param path - Filesystem path.
 * @param content - Content read from the repository metadata.
 */
function buildSyntheticAddDiff(path: string, content: string): string {
  const lines = splitLines(content);
  const header = ["--- /dev/null", `+++ b/${path}`];
  if (lines.length === 0) {
    return [...header, "@@ -0,0 +1,0 @@"].join("\n");
  }

  const visibleLines = lines.slice(0, MAX_SYNTHETIC_ADD_DIFF_LINES);
  const omittedLineCount = lines.length - visibleLines.length;
  const diffLines = visibleLines.map((line) => `+${line}`);
  if (omittedLineCount > 0) {
    diffLines.push(
      `+[synthetic add diff truncated: ${omittedLineCount} lines omitted]`,
    );
  }

  return [...header, `@@ -0,0 +1,${diffLines.length} @@`, ...diffLines].join(
    "\n",
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === units[units.length - 1]) {
      return `${value.toFixed(1)} ${unit}`;
    }
    value /= 1024;
  }
  return `${bytes} B`;
}

function buildSyntheticAddPlaceholderDiff(
  path: string,
  message: string,
): string {
  return [
    "--- /dev/null",
    `+++ b/${path}`,
    "@@ -0,0 +1 @@",
    `+${message}`,
  ].join("\n");
}

function gitReadOpenFlags(): number {
  return process.platform === "win32"
    ? fsConstants.O_RDONLY
    : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
}

async function readFileHandleRange(
  handle: FileHandle,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  if (length <= 0) {
    return new Uint8Array();
  }
  const output = new Uint8Array(length);
  let bytesReadTotal = 0;
  while (bytesReadTotal < output.byteLength) {
    const { bytesRead } = await handle.read(
      output,
      bytesReadTotal,
      output.byteLength - bytesReadTotal,
      offset + bytesReadTotal,
    );
    if (bytesRead === 0) {
      break;
    }
    bytesReadTotal += bytesRead;
  }
  return bytesReadTotal === output.byteLength
    ? output
    : output.slice(0, bytesReadTotal);
}

async function withRegularFileSnapshot<T>(
  fullPath: string,
  callback: (input: {
    readRange: (offset: number, length: number) => Promise<Uint8Array>;
    stats: { isFile: () => boolean; size: number };
  }) => Promise<T>,
): Promise<T> {
  const handle = await open(fullPath, gitReadOpenFlags());
  try {
    const stats = await handle.stat();
    return await callback({
      readRange: (offset, length) =>
        readFileHandleRange(handle, offset, length),
      stats,
    });
  } finally {
    await handle.close();
  }
}

function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) {
    return true;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}

/**
 * Build a synthetic delete diff for deleted files when HEAD content must be rendered.
 * @param path - Filesystem path.
 * @param content - Content written into the repository metadata.
 */
function buildSyntheticDeleteDiff(path: string, content: string): string {
  const lines = splitLines(content);
  const header = [`--- a/${path}`, "+++ /dev/null"];
  if (lines.length === 0) {
    return [...header, "@@ -1,0 +0,0 @@"].join("\n");
  }
  return [
    ...header,
    `@@ -1,${lines.length} +0,0 @@`,
    ...lines.map((line) => `-${line}`),
  ].join("\n");
}

/** Async helper for reading bounded text content when synthesizing add diffs. */
async function buildSyntheticAddDiffForFile(
  gitPath: string,
  fullPath: string,
): Promise<string> {
  return await withRegularFileSnapshot(
    fullPath,
    async ({ readRange, stats }) => {
      if (!stats.isFile()) {
        return buildSyntheticAddPlaceholderDiff(
          gitPath,
          "[non-file entry omitted from synthetic diff]",
        );
      }
      if (stats.size > MAX_SYNTHETIC_ADD_DIFF_BYTES) {
        return buildSyntheticAddPlaceholderDiff(
          gitPath,
          `[large file omitted from synthetic diff: ${formatFileSize(stats.size)}]`,
        );
      }

      const binaryScanBytes = await readRange(
        0,
        Math.min(stats.size, MAX_SYNTHETIC_ADD_DIFF_BINARY_SCAN_BYTES),
      );
      if (looksBinary(binaryScanBytes)) {
        return buildSyntheticAddPlaceholderDiff(
          gitPath,
          `[binary file omitted from synthetic diff: ${formatFileSize(stats.size)}]`,
        );
      }

      return buildSyntheticAddDiff(
        gitPath,
        new TextDecoder().decode(await readRange(0, stats.size)),
      );
    },
  );
}

/**
 * History/read methods may be called in empty repos; this handles both.
 */

async function runGitDiffCommandAllowNoHead(
  cwd: string,
  args: string[],
  options?: GitCommandPriority | GitCommandOptions,
): Promise<string | null> {
  const result = await runGitCommandResult(cwd, args, options);
  if (result.exitCode === 0) {
    return result.stdout.trimEnd();
  }
  if (isNoHeadGitHistoryFailure(result)) {
    return null;
  }
  throw new Error(gitCommandFailureMessage(result));
}

/** Join staged/unstaged diff payloads while dropping empty segments. */
function joinDiffSections(sections: Array<string | null | undefined>): string {
  return sections
    .map((section) => section?.trim())
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
}

/**
 * Read diff for a single change request, preferring git diff output when possible.
 */

export async function readFileChangeDiff(
  worktreePath: string,
  changePath: string,
  changeKind: "add" | "delete" | "update",
): Promise<string> {
  const gitPath = normalizeGitPath(worktreePath, changePath);
  const fullPath = resolve(worktreePath, gitPath);

  if (changeKind !== "add") {
    try {
      const diff = await runGitCommand(worktreePath, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--unified=3",
        "--",
        gitPath,
      ]);
      if (diff.trim()) {
        return diff;
      }
    } catch {
      // Fall through to synthetic diff handling below.
    }
  }

  if (changeKind === "add" && existsSync(fullPath)) {
    try {
      return buildSyntheticAddDiffForFile(gitPath, fullPath);
    } catch {
      return `+++ b/${gitPath}\n+[binary or unreadable file added]`;
    }
  }

  if (changeKind === "delete") {
    try {
      const previous = await runGitCommand(worktreePath, [
        "show",
        `HEAD:${gitPath}`,
      ]);
      return buildSyntheticDeleteDiff(gitPath, previous);
    } catch {
      return `--- a/${gitPath}\n-[file deleted]`;
    }
  }

  return "";
}

/**
 * Resolve and build a best-effort diff for one change event.
 * Tries tracked diffs first and falls back to synthetic output when needed.
 */

export async function readWorktreeChangeDiff(
  worktreePath: string,
  change: RpcWorktreeChange,
  options?: GitCommandPriority | GitCommandOptions,
): Promise<string> {
  const path = normalizeGitPath(worktreePath, change.path);
  const previousPath = change.previousPath
    ? normalizeGitPath(worktreePath, change.previousPath)
    : null;
  const pathspecs = [
    ...new Set(
      [path, previousPath].filter(
        (candidate): candidate is string => typeof candidate === "string",
      ),
    ),
  ];
  const diffArgs = [
    "--no-ext-diff",
    "--no-textconv",
    "--unified=3",
    "--find-renames",
    "--find-copies",
    "--binary",
    "--",
    ...pathspecs,
  ];

  const combinedTrackedDiff = await runGitDiffCommandAllowNoHead(
    worktreePath,
    ["diff", "HEAD", ...diffArgs],
    options,
  );
  if (combinedTrackedDiff?.trim()) {
    return combinedTrackedDiff;
  }

  const [stagedDiff, unstagedDiff] = await Promise.all([
    runGitDiffCommandAllowNoHead(
      worktreePath,
      ["diff", "--cached", ...diffArgs],
      options,
    ),
    runGitCommand(worktreePath, ["diff", ...diffArgs], options),
  ]);
  const fallbackDiff = joinDiffSections([stagedDiff, unstagedDiff]);
  if (fallbackDiff) {
    return fallbackDiff;
  }

  const fullPath = resolve(worktreePath, path);
  if (
    change.unstagedStatus === "untracked" ||
    change.stagedStatus === "added" ||
    change.unstagedStatus === "added"
  ) {
    if (existsSync(fullPath)) {
      try {
        return buildSyntheticAddDiffForFile(path, fullPath);
      } catch {
        return `+++ b/${path}\n+[binary or unreadable file added]`;
      }
    }
    return `+++ b/${path}\n+[file added]`;
  }

  if (
    change.stagedStatus === "deleted" ||
    change.unstagedStatus === "deleted"
  ) {
    const deletedPath = previousPath ?? path;
    try {
      const previous = await runGitCommand(
        worktreePath,
        ["show", `HEAD:${deletedPath}`],
        options,
      );
      return buildSyntheticDeleteDiff(deletedPath, previous);
    } catch {
      return `--- a/${deletedPath}\n-[file deleted]`;
    }
  }

  return "";
}

/** Parse `git worktree list --porcelain` output into worktree records. */
function parseWorktreeList(raw: string): RpcWorktree[] {
  if (!raw.trim()) {
    return [];
  }

  const records: RpcWorktree[] = [];
  let current: Partial<RpcWorktree> | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current?.path) {
        records.push(current as RpcWorktree);
      }
      current = {
        path: line.slice("worktree ".length).trim(),
        branch: null,
        head: null,
        bare: false,
        pinnedAt: null,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line === "bare") {
      current.bare = true;
      continue;
    }
    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim();
      continue;
    }
    if (line.startsWith("branch ")) {
      const branchRef = line.slice("branch ".length).trim();
      current.branch = branchRef.startsWith("refs/heads/")
        ? branchRef.slice("refs/heads/".length)
        : branchRef;
    }
  }

  if (current?.path) {
    records.push(current as RpcWorktree);
  }

  return records;
}

/**
 * List linked worktrees via porcelain format and normalize returned paths to abs.
 */

export async function listGitWorktreesForProjectPath(
  projectPath: string,
  options?: GitCommandPriority | GitCommandOptions,
): Promise<RpcWorktree[]> {
  const porcelain = await runGitCommand(
    projectPath,
    ["worktree", "list", "--porcelain"],
    options,
  );
  return parseWorktreeList(porcelain).map((worktree) => ({
    ...worktree,
    path: resolve(projectPath, worktree.path),
  }));
}

/**
 * Read patch lines (`git diff`) for baseline snapshot deltas.
 */

async function readDiff(
  worktreePath: string,
  options?: GitCommandPriority | GitCommandOptions,
): Promise<string[]> {
  const raw = await runGitCommand(
    worktreePath,
    ["diff", "--no-ext-diff", "--no-textconv", "--no-color"],
    options,
  );
  if (!raw.trim()) {
    return [];
  }
  return raw.split(/\r?\n/);
}

/** Map porcelain status char into typed change status expected by RPC types. */

function normalizeWorktreeChangeStatus(
  code: string,
): RpcWorktreeChangeStatus | null {
  switch (code) {
    case "A":
      return "added";
    case "C":
      return "copied";
    case "D":
      return "deleted";
    case "M":
      return "modified";
    case "R":
      return "renamed";
    case "U":
      return "unmerged";
    case "?":
      return "untracked";
    default:
      return null;
  }
}

/** Parse NUL-delimited `git status --porcelain=v1 -z` records into structures. */
function parseWorktreeChanges(raw: string): RpcWorktreeChange[] {
  if (!raw) {
    return [];
  }

  const records = raw.split("\0");
  const changes: RpcWorktreeChange[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) {
      continue;
    }

    const stagedCode = record[0] ?? " ";
    const unstagedCode = record[1] ?? " ";
    const path = record.slice(3);
    if (!path) {
      continue;
    }

    let previousPath: string | null = null;
    if (
      (stagedCode === "R" || stagedCode === "C") &&
      index + 1 < records.length
    ) {
      previousPath = records[index + 1] || null;
      index += 1;
    }

    changes.push({
      path,
      previousPath,
      stagedStatus: normalizeWorktreeChangeStatus(stagedCode),
      unstagedStatus: normalizeWorktreeChangeStatus(unstagedCode),
    });
  }

  return changes.sort((left, right) => {
    if (left.path < right.path) {
      return -1;
    }
    if (left.path > right.path) {
      return 1;
    }
    return 0;
  });
}

function worktreeChangeStatusCode(
  status: RpcWorktreeChangeStatus | null,
): string {
  switch (status) {
    case "added":
      return "A";
    case "copied":
      return "C";
    case "deleted":
      return "D";
    case "modified":
      return "M";
    case "renamed":
      return "R";
    case "unmerged":
      return "U";
    case "untracked":
      return "?";
    case null:
      return " ";
  }
}

function formatWorktreeStatusLine(change: RpcWorktreeChange): string {
  const stagedCode = worktreeChangeStatusCode(change.stagedStatus);
  const unstagedCode = worktreeChangeStatusCode(change.unstagedStatus);
  const path =
    change.previousPath &&
    (change.stagedStatus === "renamed" || change.stagedStatus === "copied")
      ? `${change.previousPath} -> ${change.path}`
      : change.path;
  return `${stagedCode}${unstagedCode} ${path}`;
}

function formatWorktreeStatusLines(changes: RpcWorktreeChange[]): string[] {
  return changes.map(formatWorktreeStatusLine);
}

/** Parse current worktree modifications using porcelain format with rename handling. */

async function readWorktreeChanges(
  worktreePath: string,
  options?: GitCommandPriority | GitCommandOptions,
): Promise<RpcWorktreeChange[]> {
  const raw = await runGitCommand(
    worktreePath,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    options,
  );
  return parseWorktreeChanges(raw);
}

/**
 * Read worktree snapshot pieces in parallel, aborting siblings if any query fails.
 */

export async function readWorktreeSnapshot(
  worktreePath: string,
  options?: GitCommandPriority | GitCommandOptions,
): Promise<Omit<RpcWorktreeSnapshot, "path">> {
  const normalizedOptions = normalizeGitCommandOptions(options);
  const controller = new AbortController();
  const signal = normalizedOptions.signal
    ? AbortSignal.any([normalizedOptions.signal, controller.signal])
    : controller.signal;
  const snapshotOptions: GitCommandOptions = {
    priority: normalizedOptions.priority,
    signal,
  };

  const [changes, diff] = await Promise.all([
    readWorktreeChanges(worktreePath, snapshotOptions),
    readDiff(worktreePath, snapshotOptions),
  ]).catch((error) => {
    controller.abort(createAbortError(null, "Worktree snapshot read failed."));
    throw error;
  });

  return {
    changes,
    diff,
    files: formatWorktreeStatusLines(changes),
    lastUpdatedAt: getNow(),
  };
}

/** Validate/normalize user-provided cursor for chunked file reads. */
function normalizeWorktreeFileContentCursor(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
}

/**
 * Normalize page size with clamp and positive-integer enforcement.
 * @param value - Input value.
 */
function normalizeWorktreeFileContentPageSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_WORKTREE_FILE_CONTENT_PAGE_BYTES;
  }

  return Math.max(
    1,
    Math.min(MAX_WORKTREE_FILE_CONTENT_PAGE_BYTES, Math.floor(value)),
  );
}

/** Heuristic binary detection via NUL byte in retrieved byte chunk. */
function isLikelyBinaryContent(bytes: Uint8Array<ArrayBufferLike>): boolean {
  for (const byte of bytes) {
    if (byte === 0) {
      return true;
    }
  }

  return false;
}

/**
 * Stream-read a fixed-size chunk of a file and return base64 payload metadata.
 */

export async function readWorktreeFileContentPage(
  worktreePath: string,
  filePath: string,
  options?: {
    cursor?: number;
    limitBytes?: number;
    signal?: AbortSignal | null;
  },
): Promise<Omit<RpcWorktreeFileContentPage, "projectId" | "worktreePath">> {
  const signal = options?.signal ?? null;
  throwIfAborted(signal, "Worktree file content read was aborted.");

  const path = normalizeGitPath(worktreePath, filePath);
  const fullPath = resolve(worktreePath, path);
  const cursor = normalizeWorktreeFileContentCursor(options?.cursor);
  const limitBytes = normalizeWorktreeFileContentPageSize(options?.limitBytes);

  let isMissing = true;
  let totalBytes = 0;
  let chunkBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
  try {
    await withRegularFileSnapshot(fullPath, async ({ readRange, stats }) => {
      if (!stats.isFile()) {
        return;
      }
      isMissing = false;
      totalBytes = stats.size;
      if (totalBytes <= 0 || cursor >= totalBytes) {
        return;
      }
      const end = Math.min(totalBytes, cursor + limitBytes);
      chunkBytes = await readRange(cursor, end - cursor);
    });
  } catch {
    return {
      path,
      cursor,
      nextCursor: null,
      totalBytes: 0,
      chunkBase64: "",
      isBinary: false,
      isMissing: true,
    };
  }

  if (isMissing || totalBytes <= 0 || cursor >= totalBytes) {
    return {
      path,
      cursor,
      nextCursor: null,
      totalBytes,
      chunkBase64: "",
      isBinary: false,
      isMissing,
    };
  }

  throwIfAborted(signal, "Worktree file content read was aborted.");
  if (isLikelyBinaryContent(chunkBytes)) {
    return {
      path,
      cursor,
      nextCursor: null,
      totalBytes,
      chunkBase64: "",
      isBinary: true,
      isMissing: false,
    };
  }

  return {
    path,
    cursor,
    nextCursor:
      cursor + chunkBytes.byteLength < totalBytes
        ? cursor + chunkBytes.byteLength
        : null,
    totalBytes,
    chunkBase64: Buffer.from(chunkBytes).toString("base64"),
    isBinary: false,
    isMissing: false,
  };
}

/**
 * Construct a stable base summary object when git history is unavailable.
 */

function emptyGitHistorySummary(
  projectId: number,
  worktreePath: string,
  options?: {
    branch?: string | null;
    headHash?: string | null;
    headShortHash?: string | null;
    lastUpdatedAt?: string;
  },
): RpcWorktreeGitHistorySummary {
  return {
    projectId,
    worktreePath,
    branch: options?.branch ?? null,
    headHash: options?.headHash ?? null,
    headShortHash: options?.headShortHash ?? null,
    lastUpdatedAt: options?.lastUpdatedAt ?? getNow(),
  };
}

/**
 * Parse a single non-decorated log record emitted with known field separators.
 * @param record - Raw git log record.
 */
function parseGitHistoryEntryRecord(record: string): RpcGitHistoryEntry | null {
  const [hash, shortHash, subject, authorName, committedAt] = record.split(
    GIT_LOG_FIELD_SEPARATOR,
  );
  if (!hash || !shortHash) {
    return null;
  }

  return {
    hash,
    shortHash,
    subject: subject || shortHash,
    authorName: authorName || "Unknown",
    committedAt: committedAt || getNow(),
  };
}

/** Parse every non-empty non-decorated entry in a git log payload. */
function parseGitHistoryEntries(raw: string): RpcGitHistoryEntry[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(GIT_LOG_RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map(parseGitHistoryEntryRecord)
    .filter((entry): entry is RpcGitHistoryEntry => entry !== null);
}

/** Return the current branch name without asking git to decorate history output. */
async function readGitCurrentBranch(
  worktreePath: string,
  options?: GitCommandPriority | GitCommandOptions,
): Promise<string | null> {
  const result = await runGitCommandResult(
    worktreePath,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    options,
  );
  if (result.exitCode === 0) {
    return result.stdout.trimEnd() || null;
  }
  if (result.exitCode === 1 && !result.stderr) {
    return null;
  }
  throw new Error(gitCommandFailureMessage(result));
}

function isMissingHeadRevisionFailure(result: {
  exitCode: number;
  stderr: string;
}): boolean {
  if (isNoHeadGitHistoryFailure(result)) {
    return true;
  }
  return (
    result.exitCode !== 0 &&
    result.stderr.toLowerCase().includes("needed a single revision")
  );
}

/** Read HEAD identity using cheap plumbing commands instead of decorated log output. */
async function readGitHistoryHeadSummary(
  projectId: number,
  worktreePath: string,
  lastUpdatedAt: string,
  options?: GitCommandPriority | GitCommandOptions,
): Promise<{
  history: RpcWorktreeGitHistorySummary;
  signature: string;
}> {
  const headResult = await runGitCommandResult(
    worktreePath,
    ["rev-parse", "--verify", "HEAD"],
    options,
  );
  const branch = await readGitCurrentBranch(worktreePath, options);

  if (headResult.exitCode !== 0) {
    if (!isMissingHeadRevisionFailure(headResult)) {
      throw new Error(gitCommandFailureMessage(headResult));
    }
    const history = emptyGitHistorySummary(projectId, worktreePath, {
      branch,
      lastUpdatedAt,
    });
    return {
      history,
      signature: buildGitHistorySignature(history.branch, history.headHash),
    };
  }

  const headHash = headResult.stdout.trimEnd();
  const history = emptyGitHistorySummary(projectId, worktreePath, {
    branch,
    headHash: headHash || null,
    headShortHash: headHash.slice(0, 7) || null,
    lastUpdatedAt,
  });

  return {
    history,
    signature: buildGitHistorySignature(history.branch, history.headHash),
  };
}

/**
 * Compute a compact history signature for cache invalidation comparisons.
 */

function buildGitHistorySignature(
  branch: string | null,
  headHash: string | null,
): string {
  return [branch ?? "", headHash ?? ""].join("\n");
}

/**
 * Convert page-limit request to a bounded positive integer.
 * @param limit - Maximum number of entries returned.
 */
export function normalizeGitHistoryPageLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isInteger(limit)) {
    return DEFAULT_GIT_HISTORY_PAGE_SIZE;
  }
  return Math.min(Math.max(limit, 1), DEFAULT_GIT_HISTORY_PAGE_SIZE);
}

/** Read current HEAD/branch metadata and return history summary plus signature. */
export async function readGitHistorySummary(
  projectId: number,
  worktreePath: string,
  options?: GitCommandPriority | GitCommandOptions,
): Promise<{
  history: RpcWorktreeGitHistorySummary;
  signature: string;
}> {
  const normalizedOptions = normalizeGitCommandOptions(options);
  return readGitHistoryHeadSummary(
    projectId,
    worktreePath,
    getNow(),
    normalizedOptions,
  );
}

/**
 * Fetch a paged list of commit entries and indicate if another page exists.
 */

export async function readGitHistoryPageEntries(
  worktreePath: string,
  offset: number,
  limit: number,
  options?: GitCommandPriority | GitCommandOptions,
): Promise<{
  entries: RpcGitHistoryEntry[];
  nextOffset: number | null;
}> {
  const normalizedOptions = normalizeGitCommandOptions(options);
  const rawEntries = await runGitHistoryCommand(
    worktreePath,
    [
      "log",
      `--skip=${offset}`,
      `--max-count=${limit + 1}`,
      "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cI%x1e",
      "HEAD",
    ],
    normalizedOptions,
  );
  if (rawEntries === null) {
    return {
      entries: [],
      nextOffset: null,
    };
  }
  const parsedEntries = parseGitHistoryEntries(rawEntries);
  const hasMore = parsedEntries.length > limit;

  return {
    entries: hasMore ? parsedEntries.slice(0, limit) : parsedEntries,
    nextOffset: hasMore ? offset + limit : null,
  };
}

/**
 * Read first page of commit history and derive a summary/signature from HEAD.
 */

export async function readGitHistoryFirstPage(
  projectId: number,
  worktreePath: string,
  limit: number,
  options?: GitCommandPriority | GitCommandOptions,
): Promise<{
  history: RpcWorktreeGitHistoryResult;
  summary: RpcWorktreeGitHistorySummary;
  signature: string;
}> {
  const normalizedOptions = normalizeGitCommandOptions(options);
  const lastUpdatedAt = getNow();
  const rawEntries = await runGitHistoryCommand(
    worktreePath,
    [
      "log",
      `--max-count=${limit + 1}`,
      "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cI%x1e",
      "HEAD",
    ],
    normalizedOptions,
  );
  if (rawEntries === null) {
    const { history: summary, signature } = await readGitHistoryHeadSummary(
      projectId,
      worktreePath,
      lastUpdatedAt,
      normalizedOptions,
    );
    return {
      history: {
        ...summary,
        entries: [],
        limit,
        nextOffset: null,
      },
      summary,
      signature,
    };
  }
  const parsedEntries = parseGitHistoryEntries(rawEntries);

  const firstEntry = parsedEntries[0];
  if (!firstEntry) {
    throw new Error(
      "Expected a first git history entry when history is not empty.",
    );
  }
  const hasMore = parsedEntries.length > limit;
  const trimmedEntries = hasMore
    ? parsedEntries.slice(0, limit)
    : parsedEntries;
  const branch = await readGitCurrentBranch(worktreePath, normalizedOptions);
  const summary = emptyGitHistorySummary(projectId, worktreePath, {
    branch,
    headHash: firstEntry.hash,
    headShortHash: firstEntry.shortHash,
    lastUpdatedAt,
  });
  const entries = trimmedEntries;

  return {
    history: {
      ...summary,
      entries,
      limit,
      nextOffset: hasMore ? limit : null,
    },
    summary,
    signature: buildGitHistorySignature(summary.branch, summary.headHash),
  };
}

/**
 * Read full commit metadata + diff with stable field separator framing.
 */

export async function readGitCommitDiffResult(
  projectId: number,
  worktreePath: string,
  commitHash: string,
  options?: GitCommandPriority | GitCommandOptions,
): Promise<RpcGitCommitDiffResult> {
  const raw = await runGitCommand(
    worktreePath,
    [
      "show",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames",
      "--submodule=diff",
      "--unified=3",
      `--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cI${GIT_LOG_RECORD_SEPARATOR}`,
      commitHash,
    ],
    options,
  );
  const separatorIndex = raw.indexOf(GIT_LOG_RECORD_SEPARATOR);
  if (separatorIndex < 0) {
    throw new Error(`Unable to read commit diff: ${commitHash}`);
  }

  const metadataRaw = raw.slice(0, separatorIndex);
  const diffText = raw.slice(separatorIndex + GIT_LOG_RECORD_SEPARATOR.length);
  const commit = parseGitHistoryEntryRecord(metadataRaw);
  if (!commit) {
    throw new Error(`Unable to read commit metadata: ${commitHash}`);
  }

  return {
    projectId,
    worktreePath,
    commit,
    diffText: diffText.replace(/^\r?\n/, ""),
  };
}
