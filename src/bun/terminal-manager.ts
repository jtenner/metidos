/**
 * @file src/bun/terminal-manager.ts
 * @description In-memory PTY terminal session manager for Metidos terminals.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, delimiter, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerWebSocket } from "bun";
import { RE2 } from "re2-wasm";
import { normalizePath, pathIsWithinRoot } from "./project-procedures/shared";
import {
  createTokenBucketRateLimiter,
  type TokenBucketRateLimiter,
} from "./token-bucket-rate-limit";
import type {
  RpcCreateTerminalRequest,
  RpcTerminal,
  RpcTerminalConnectionInfo,
  RpcTerminalSettings,
  RpcTerminalStatus,
} from "./rpc-schema";

const MIN_REPLAY_BUFFER_BYTES = 64 * 1024;
const DEFAULT_REPLAY_BUFFER_BYTES = 5 * 1024 * 1024;
const MAX_REPLAY_BUFFER_BYTES = 16 * 1024 * 1024;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
// The bridge process only proxies a host-owned PTY. Shutdown first sends SIGTERM and
// then uses this short fallback SIGKILL window so a broken bridge cannot keep the
// terminal session alive after the manager has decided to close it. This may end
// the proxy abruptly, but the force-kill path below still gives the child PTY its
// longer normal shutdown window.
const TERMINAL_BRIDGE_FALLBACK_KILL_DELAY_MS = 100;
const TERMINAL_FORCE_KILL_DELAY_MS = 2_000;
const TERMINAL_SOCKET_FLUSH_INTERVAL_MS = 16;
const TERMINAL_PTY_BRIDGE_PATH = fileURLToPath(
  new URL("./terminal-pty-bridge.cjs", import.meta.url),
);
const TEXT_ENCODER = new TextEncoder();
const TERMINAL_PONG_MESSAGE = JSON.stringify({ type: "pong" });
const TERMINAL_INPUT_MAX_BYTES = 64 * 1024;
const TERMINAL_MIN_COLS = 10;
const TERMINAL_MAX_COLS = 500;
const TERMINAL_MIN_ROWS = 5;
const TERMINAL_MAX_ROWS = 200;
const TERMINAL_GREP_PATTERN_MAX_LENGTH = 256;
const TERMINAL_GREP_LINE_SCAN_MAX_LENGTH = 4096;
const TERMINAL_RETAINED_LINE_CAP = 50_000;
const TERMINAL_GREP_SCAN_TIMEOUT_MS = 50;
const TERMINAL_GREP_DEADLINE_CHECK_LINE_INTERVAL = 25;
const TERMINAL_BUFFER_COMPACTION_HEAD_MINIMUM = 128;
const TERMINAL_TITLE_MAX_LENGTH = 80;
const TERMINAL_VIEW_DEFAULT_LINE_COUNT = 200;
const TERMINAL_VIEW_MAX_LINE_COUNT = 1_000;
const TERMINAL_GREP_DEFAULT_MATCH_LIMIT = 20;
const TERMINAL_GREP_MAX_MATCH_LIMIT = 100;
const TERMINAL_SOCKET_CLOSE_NORMAL = 1000;
const TERMINAL_SOCKET_CLOSE_POLICY_VIOLATION = 1008;
const TERMINAL_SOCKET_CLOSE_UNSUPPORTED_DATA = 1003;
const DEFAULT_MAX_TERMINALS_PER_OWNER = 8;
const DEFAULT_MAX_GLOBAL_TERMINALS = 32;
const DEFAULT_EXITED_TERMINAL_IDLE_TTL_MS = 30 * 60 * 1000;
// Terminal websocket messages are interactive control-plane events (input,
// resize, ping) rather than bulk PTY output. The default allows short typing or
// paste bursts while sustaining 60 messages/second per authenticated
// session+terminal socket scope; larger transfer workloads should use normal
// shell tools inside the PTY instead of websocket frame floods. The bounded
// bucket count caps memory if many sockets repeatedly hit the limiter.
const DEFAULT_TERMINAL_SOCKET_MESSAGE_RATE_LIMIT_CAPACITY = 120;
const DEFAULT_TERMINAL_SOCKET_MESSAGE_RATE_LIMIT_REFILL_TOKENS = 60;
const DEFAULT_TERMINAL_SOCKET_MESSAGE_RATE_LIMIT_REFILL_INTERVAL_MS = 1_000;
const DEFAULT_TERMINAL_SOCKET_MESSAGE_RATE_LIMIT_MAX_BUCKETS = 4_096;

export type TerminalWebSocketData = {
  isAdmin: boolean;
  sessionId: string | null;
  stepUpValidUntil: string | null;
  userId: number | null;
  username: string | null;
  terminalId: string;
};

type TerminalSocket = ServerWebSocket<TerminalWebSocketData>;

type TerminalSocketCloseOptions = {
  terminatePtys?: boolean;
};

type TerminalClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: unknown; rows: unknown }
  | { type: "ping" };

type ManagedPtyExitEvent = {
  exitCode: number | undefined;
  signal: number | string | null | undefined;
};

type ManagedPty = {
  kill: (signal?: NodeJS.Signals) => void;
  onData: (listener: (data: string) => void) => void;
  onExit: (listener: (event: ManagedPtyExitEvent) => void) => void;
  resize: (cols: number, rows: number) => void;
  write: (data: string) => void;
};

type BridgeMessage =
  | { type: "data"; data?: unknown }
  | { type: "error"; message?: unknown }
  | { type: "exit"; exitCode?: unknown; signal?: unknown };

class BridgeManagedPty implements ManagedPty {
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<
    (event: ManagedPtyExitEvent) => void
  >();
  private exited = false;
  private stdoutBuffer = "";

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.handleStdout(chunk);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.emitData(`\r\nTerminal bridge: ${chunk}`);
    });
    child.stdin.on("error", () => {
      // Broken stdin means the bridge is already exiting or gone; shutdown
      // fallback below still handles final cleanup.
    });
    child.on("exit", (code, signal) => {
      if (this.exited) {
        return;
      }
      this.emitExit({
        exitCode: typeof code === "number" ? code : undefined,
        signal: signal ?? null,
      });
    });
    child.on("error", () => {
      this.emitData(
        "\r\nTerminal bridge failed before the shell was ready. Check terminal settings and Node.js availability.\r\n",
      );
      this.emitExit({ exitCode: 1, signal: null });
    });
  }

  onData(listener: (data: string) => void): void {
    this.dataListeners.add(listener);
  }

  onExit(listener: (event: ManagedPtyExitEvent) => void): void {
    this.exitListeners.add(listener);
  }

  write(data: string): void {
    this.send({ type: "input", data });
  }

  resize(cols: number, rows: number): void {
    this.send({ type: "resize", cols, rows });
  }

  kill(signal?: NodeJS.Signals): void {
    const requestedSignal = signal ?? "SIGTERM";
    this.send({ type: "kill", signal: requestedSignal });
    // Prefer the bridge protocol so node-pty reports the child exit and the
    // bridge exits normally. If the bridge stops reading or ignores the request,
    // close stdin and then signal the proxy process as a bounded fallback.
    const fallbackTimer = safeSetTimeout(() => {
      if (this.exited) {
        return;
      }
      if (!this.child.stdin.destroyed) {
        this.child.stdin.end();
      }
      if (!this.child.killed) {
        this.child.kill(requestedSignal === "SIGKILL" ? "SIGKILL" : "SIGTERM");
      }
      const forceTimer = safeSetTimeout(() => {
        if (!this.exited) {
          this.child.kill("SIGKILL");
        }
      }, TERMINAL_BRIDGE_FALLBACK_KILL_DELAY_MS);
      forceTimer.unref?.();
    }, TERMINAL_BRIDGE_FALLBACK_KILL_DELAY_MS);
    fallbackTimer.unref?.();
  }

  private send(message: Record<string, unknown>): void {
    if (this.exited || this.child.stdin.destroyed) {
      return;
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (!line.trim()) {
        continue;
      }
      let message: BridgeMessage;
      try {
        message = JSON.parse(line) as BridgeMessage;
      } catch {
        this.emitData(line);
        continue;
      }
      this.handleBridgeMessage(message);
    }
  }

  private handleBridgeMessage(message: BridgeMessage): void {
    if (message.type === "data") {
      this.emitData(typeof message.data === "string" ? message.data : "");
      return;
    }
    if (message.type === "error") {
      this.emitData(
        "\r\nTerminal bridge reported an internal error. Check terminal settings, selected worktree, and shell availability.\r\n",
      );
      return;
    }
    if (message.type === "exit") {
      this.emitExit({
        exitCode:
          typeof message.exitCode === "number" ? message.exitCode : undefined,
        signal:
          typeof message.signal === "number" ||
          typeof message.signal === "string"
            ? message.signal
            : null,
      });
    }
  }

  private emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  private emitExit(event: ManagedPtyExitEvent): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    for (const listener of this.exitListeners) {
      listener(event);
    }
  }
}

function safeSetTimeout(
  listener: () => void,
  delayMs: number,
): ReturnType<typeof setTimeout> {
  return setTimeout(listener, delayMs);
}

type TerminalOutputSegment = {
  byteLength: number;
  text: string;
};

type TerminalLineEntry = {
  byteLength: number;
  text: string;
};

type TerminalGrepMatcher = {
  test: (line: string) => boolean;
};

export class TerminalOutputBuffer {
  private byteLength = 0;
  private headIndex = 0;
  // Tracks retained clean-line bytes independently from raw output segments so
  // grep/search line indexes are pruned under the same replay-buffer cap.
  private lineByteLength = 0;
  private lineEntries: TerminalLineEntry[] = [{ byteLength: 0, text: "" }];
  private lineHeadIndex = 0;
  // Retained PTY output is an append-only logical stream with a movable head
  // index. Trimming advances the head instead of shifting arrays on every
  // chunk, and periodic compaction keeps old segment references bounded.
  private segments: TerminalOutputSegment[] = [];

  constructor(private readonly maxBytes: number) {}

  append(text: string): void {
    if (!text) {
      return;
    }
    let segmentText = text;
    let segmentByteLength = encodedSize(segmentText);
    if (this.maxBytes > 0 && segmentByteLength > this.maxBytes) {
      segmentText = trimStringToMaxBytes(segmentText, this.maxBytes);
      segmentByteLength = encodedSize(segmentText);
    }
    this.segments.push({
      byteLength: segmentByteLength,
      text: segmentText,
    });
    this.byteLength += segmentByteLength;
    this.appendLineEntries(segmentText);
    // Keep both raw replay text and derived clean-line search indexes under
    // the configured replay byte cap. This bounds memory and avoids rebuilding
    // the full terminal transcript for line views or grep on every append.
    this.trimToMaxBytes();
    this.trimLineEntriesToMaxBytes();
  }

  toString(): string {
    if (this.headIndex >= this.segments.length) {
      return "";
    }
    return this.segments
      .slice(this.headIndex)
      .map((segment) => segment.text)
      .join("");
  }

  cleanLineCount(): number {
    return Math.max(0, this.lineEntries.length - this.lineHeadIndex);
  }

  cleanLines(offset: number, count: number): string[] {
    if (count <= 0) {
      return [];
    }
    const start = this.lineHeadIndex + Math.max(0, Math.floor(offset));
    const end = Math.min(this.lineEntries.length, start + Math.floor(count));
    const lines: string[] = [];
    for (let index = start; index < end; index += 1) {
      lines.push(stripAnsi(this.lineEntries[index]?.text ?? ""));
    }
    return lines;
  }

  grepCleanLines(
    matcher: TerminalGrepMatcher,
    maxMatches: number,
    onDeadlineCheck: (lineIndex: number) => void,
  ): string[] {
    const matches: string[] = [];
    const start = this.lineHeadIndex;
    for (let index = start; index < this.lineEntries.length; index += 1) {
      const visibleLineNumber = index - start + 1;
      if (
        (visibleLineNumber - 1) % TERMINAL_GREP_DEADLINE_CHECK_LINE_INTERVAL ===
        0
      ) {
        onDeadlineCheck(visibleLineNumber);
      }
      const line = stripAnsi(this.lineEntries[index]?.text ?? "");
      if (matcher.test(line.slice(0, TERMINAL_GREP_LINE_SCAN_MAX_LENGTH))) {
        matches.push(`${visibleLineNumber}: ${line}`);
        if (matches.length >= maxMatches) {
          break;
        }
      }
    }
    return matches;
  }

  private appendLineEntries(text: string): void {
    let current = this.lineEntries[this.lineEntries.length - 1];
    if (!current) {
      current = { byteLength: 0, text: "" };
      this.lineEntries.push(current);
    }
    const parts = text.split("\n");
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? "";
      if (index > 0) {
        if (current.text.endsWith("\r")) {
          const nextText = current.text.slice(0, -1);
          this.lineByteLength -= current.byteLength;
          current.text = nextText;
          current.byteLength = encodedSize(nextText);
          this.lineByteLength += current.byteLength;
        }
        current = { byteLength: 0, text: "" };
        this.lineEntries.push(current);
      }
      if (part) {
        this.lineByteLength -= current.byteLength;
        current.text += part;
        current.byteLength = encodedSize(current.text);
        this.lineByteLength += current.byteLength;
      }
    }
    this.compactLineEntries();
  }

  private trimLineEntriesToMaxBytes(): void {
    if (this.maxBytes <= 0) {
      return;
    }
    while (
      (this.lineByteLength > this.maxBytes ||
        this.cleanLineCount() > TERMINAL_RETAINED_LINE_CAP) &&
      this.lineHeadIndex < this.lineEntries.length
    ) {
      const entry = this.lineEntries[this.lineHeadIndex];
      if (!entry) {
        break;
      }
      const overflowBytes = Math.max(0, this.lineByteLength - this.maxBytes);
      if (
        this.cleanLineCount() > TERMINAL_RETAINED_LINE_CAP ||
        entry.byteLength <= overflowBytes
      ) {
        this.lineByteLength -= entry.byteLength;
        this.lineHeadIndex += 1;
        continue;
      }
      const keptText = trimStringToMaxBytes(
        entry.text,
        entry.byteLength - overflowBytes,
      );
      const keptByteLength = encodedSize(keptText);
      this.lineByteLength =
        this.lineByteLength - entry.byteLength + keptByteLength;
      this.lineEntries[this.lineHeadIndex] = {
        byteLength: keptByteLength,
        text: keptText,
      };
      break;
    }
    this.compactLineEntries();
  }

  private compactLineEntries(): void {
    if (
      this.lineHeadIndex > TERMINAL_BUFFER_COMPACTION_HEAD_MINIMUM &&
      this.lineHeadIndex * 2 > this.lineEntries.length
    ) {
      this.lineEntries = this.lineEntries.slice(this.lineHeadIndex);
      this.lineHeadIndex = 0;
    }
  }

  private trimToMaxBytes(): void {
    // This loop only touches the trimmed head segments. If a single oversized
    // chunk arrives it is pre-trimmed in append(), so normal PTY appends do not
    // repeatedly scan or copy the entire retained buffer.
    if (this.maxBytes <= 0) {
      return;
    }
    while (
      this.byteLength > this.maxBytes &&
      this.headIndex < this.segments.length
    ) {
      const segment = this.segments[this.headIndex];
      if (!segment) {
        break;
      }
      const overflowBytes = this.byteLength - this.maxBytes;
      if (segment.byteLength <= overflowBytes) {
        this.byteLength -= segment.byteLength;
        this.headIndex += 1;
        continue;
      }
      const keptText = trimStringToMaxBytes(
        segment.text,
        segment.byteLength - overflowBytes,
      );
      const keptByteLength = encodedSize(keptText);
      this.byteLength = this.byteLength - segment.byteLength + keptByteLength;
      this.segments[this.headIndex] = {
        byteLength: keptByteLength,
        text: keptText,
      };
      break;
    }
    if (
      this.headIndex > TERMINAL_BUFFER_COMPACTION_HEAD_MINIMUM &&
      this.headIndex * 2 > this.segments.length
    ) {
      this.segments = this.segments.slice(this.headIndex);
      this.headIndex = 0;
    }
  }
}

type TerminalSession = {
  command: string | null;
  createdAt: string;
  createdFromThreadId: number | null;
  ownerSessionId: string | null;
  cwd: string;
  exitCode: number | null;
  exitSignal: string | null;
  projectId: number;
  projectName: string;
  ptyProcess: ManagedPty | null;
  replayBufferBytes: number;
  rows: number;
  cols: number;
  outputBuffer: TerminalOutputBuffer;
  pendingSocketOutput: string;
  socketFlushTimer: ReturnType<typeof setTimeout> | null;
  sockets: Set<TerminalSocket>;
  status: RpcTerminalStatus;
  terminalId: string;
  terminalIndex: number;
  title: string;
  updatedAt: string;
  worktreeFolder: string;
  worktreePath: string;
  closeTimer: ReturnType<typeof setTimeout> | null;
  exitedCleanupTimer: ReturnType<typeof setTimeout> | null;
  waitingForKeyToClose: boolean;
};

export type TerminalCreateInput = RpcCreateTerminalRequest & {
  ownerSessionId?: string | null;
  projectName: string;
  settings: RpcTerminalSettings;
};

export type TerminalAccessScope = {
  createdFromThreadId?: number | null;
  ownerSessionId?: string | null;
};

export function terminalOwnerSessionKeyForThread(threadId: number): string {
  return `thread:${threadId}`;
}

// Plugin-created terminals are scoped to the agent thread, not to a browser
// session. That keeps terminals resumable by the same thread after UI/session
// churn while still denying access from unrelated threads. The canonical owner
// key is deterministic and non-secret; authorization depends on matching the
// server-stored thread identity, not on callers presenting an unguessable token.
function assertTerminalAccess(
  session: TerminalSession,
  access?: TerminalAccessScope,
): void {
  if (!access) {
    return;
  }

  if (
    typeof access.ownerSessionId === "string" &&
    access.ownerSessionId.length > 0 &&
    session.ownerSessionId === access.ownerSessionId
  ) {
    return;
  }

  if (
    typeof access.createdFromThreadId === "number" &&
    Number.isInteger(access.createdFromThreadId) &&
    session.createdFromThreadId === access.createdFromThreadId
  ) {
    return;
  }

  if (
    typeof access.createdFromThreadId === "number" &&
    Number.isInteger(access.createdFromThreadId) &&
    session.ownerSessionId ===
      terminalOwnerSessionKeyForThread(access.createdFromThreadId)
  ) {
    return;
  }

  throw new Error("Terminal access is denied for the current context.");
}

function nowIso(): string {
  return new Date().toISOString();
}

function assertSafeTerminalGrepPattern(pattern: string): void {
  if (pattern.length > TERMINAL_GREP_PATTERN_MAX_LENGTH) {
    throw new Error(
      `Terminal grep pattern must be ${TERMINAL_GREP_PATTERN_MAX_LENGTH} characters or fewer.`,
    );
  }
}

export function createSafeTerminalGrepRegex(
  pattern: string,
  ignoreCase = false,
): TerminalGrepMatcher {
  assertSafeTerminalGrepPattern(pattern);
  try {
    return new RE2(pattern, ignoreCase ? "iu" : "u");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Terminal grep pattern is not supported by RE2: ${message}`,
    );
  }
}

function encodedSize(text: string): number {
  return TEXT_ENCODER.encode(text).byteLength;
}

function trimStringToMaxBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || encodedSize(text) <= maxBytes) {
    return text;
  }

  let start = Math.max(0, text.length - maxBytes);
  let next = text.slice(start);
  while (next.length > 0 && encodedSize(next) > maxBytes) {
    start += Math.max(1, Math.ceil((encodedSize(next) - maxBytes) / 2));
    next = text.slice(start);
  }
  return next;
}

function stripAnsi(text: string): string {
  return typeof Bun.stripANSI === "function" ? Bun.stripANSI(text) : text;
}

export function buildCleanTerminalBuffer(
  rawBuffer: string,
  replayBufferBytes: number,
): string {
  return trimStringToMaxBytes(stripAnsi(rawBuffer), replayBufferBytes);
}

function normalizeReplayBytes(value: number | null | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return DEFAULT_REPLAY_BUFFER_BYTES;
  }
  return Math.max(
    MIN_REPLAY_BUFFER_BYTES,
    Math.min(Math.floor(value), MAX_REPLAY_BUFFER_BYTES),
  );
}

function normalizeTitle(
  title: string | null | undefined,
  command: string | null,
): string {
  const trimmed = title?.trim();
  if (trimmed) {
    return trimmed.slice(0, TERMINAL_TITLE_MAX_LENGTH);
  }
  if (command?.trim()) {
    return command.trim().slice(0, TERMINAL_TITLE_MAX_LENGTH);
  }
  return "shell";
}

function resolveConfiguredShell(settings: RpcTerminalSettings): string | null {
  const configured = settings.defaultShell.trim();
  return configured || null;
}

function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    if (process.platform !== "win32") {
      accessSync(path, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function resolveShellCandidateNames(command: string): string[] {
  if (process.platform !== "win32" || /\.[^\\/]+$/.test(command)) {
    return [command];
  }
  const extensions = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim())
    .filter((extension) => extension.length > 0);
  return [command, ...extensions.map((extension) => `${command}${extension}`)];
}

function resolveShellExecutable(shell: string): string | null {
  const trimmed = shell.trim();
  if (!trimmed) {
    return null;
  }
  if (isAbsolute(trimmed)) {
    return isExecutableFile(trimmed)
      ? normalizePath(realpathSync(trimmed))
      : null;
  }
  if (hasPathSeparator(trimmed)) {
    return null;
  }
  const pathEntries = (process.env.PATH || "")
    .split(delimiter)
    .filter((entry) => entry.length > 0);
  for (const entry of pathEntries) {
    for (const candidateName of resolveShellCandidateNames(trimmed)) {
      const candidate = resolve(entry, candidateName);
      if (isExecutableFile(candidate)) {
        return normalizePath(realpathSync(candidate));
      }
    }
  }
  return null;
}

function resolveAutomaticShell(): string {
  const candidates =
    process.platform === "win32"
      ? [process.env.ComSpec, "powershell.exe", "pwsh.exe", "cmd.exe"]
      : [
          process.env.SHELL,
          "/bin/bash",
          "/usr/bin/bash",
          "/bin/sh",
          "/usr/bin/sh",
          "bash",
          "sh",
        ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const resolved = resolveShellExecutable(candidate);
    if (resolved) {
      return resolved;
    }
  }
  throw new Error("No available terminal shell was found in this runtime.");
}

function resolveShell(settings: RpcTerminalSettings): string {
  const configured = resolveConfiguredShell(settings);
  if (configured) {
    const resolved = resolveShellExecutable(configured);
    if (resolved) {
      return resolved;
    }
    throw new Error(
      "Configured terminal default shell is not available in this runtime. Check the terminal settings shell path or leave it blank to auto-detect a shell.",
    );
  }
  return resolveAutomaticShell();
}

function resolvePosixShellCommandArgs(
  shell: string,
  command: string,
): string[] {
  const shellName = basename(shell).toLowerCase();
  return shellName === "dash" || shellName === "sh"
    ? ["-c", command]
    : ["-lc", command];
}

export function resolveShellSpawn(
  command: string | null,
  settings: RpcTerminalSettings,
): {
  file: string;
  args: string[];
} {
  // Terminal sessions are an intentional shell execution boundary: callers that
  // can create terminals already have workspace terminal authority. Keep the
  // command as shell input so quoted user commands behave like an interactive
  // terminal would; authorization is enforced before createTerminal reaches here.
  const shell = resolveShell(settings);
  if (!command) {
    return { file: shell, args: [] };
  }
  if (process.platform === "win32") {
    const lower = basename(shell).toLowerCase();
    if (
      lower.includes("powershell") ||
      lower === "pwsh.exe" ||
      lower === "pwsh"
    ) {
      return { file: shell, args: ["-NoLogo", "-Command", command] };
    }
    return { file: shell, args: ["/d", "/s", "/c", command] };
  }
  return { file: shell, args: resolvePosixShellCommandArgs(shell, command) };
}

let loggedCustomNodeBinary: string | null = null;
let loggedDefaultNodeBinary: string | null = null;

function assertTerminalNodeBinarySecurity(
  resolved: string,
  label: string,
): string {
  const stat = statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`${label} must point to an executable file.`);
  }
  try {
    accessSync(resolved, constants.X_OK);
  } catch {
    throw new Error(`${label} must point to an executable file.`);
  }
  if ((stat.mode & 0o022) !== 0) {
    throw new Error(`${label} must not be writable by group or other users.`);
  }
  if (process.platform !== "win32") {
    // PTY bridge startup only trusts operator-controlled Node binaries: the
    // current user may replace their own binary, while root-owned package
    // manager installs are accepted when they are not group/world writable.
    const effectiveUserId = process.geteuid?.();
    if (
      typeof effectiveUserId === "number" &&
      stat.uid !== 0 &&
      stat.uid !== effectiveUserId
    ) {
      throw new Error(`${label} must be owned by root or the current user.`);
    }
  }
  return resolved;
}

function resolveConfiguredTerminalNodeBinary(configured: string): string {
  // Terminal binary resolution runs during PTY startup and in tests without a
  // request/runtime logger. Stderr warnings are limited to executable paths the
  // local operator configured or that PATH already exposes.
  if (!isAbsolute(configured)) {
    throw new Error("METIDOS_NODE_BINARY must be an absolute path.");
  }
  const resolved = normalizePath(realpathSync(configured));
  assertTerminalNodeBinarySecurity(resolved, "METIDOS_NODE_BINARY");
  if (loggedCustomNodeBinary !== resolved) {
    console.warn(`Using custom METIDOS_NODE_BINARY for terminals: ${resolved}`);
    loggedCustomNodeBinary = resolved;
  }
  return resolved;
}

function findNodeBinaryOnPath(pathValue: string | undefined): string | null {
  const candidateNames = process.platform === "win32" ? ["node.exe"] : ["node"];
  for (const entry of (pathValue ?? "").split(delimiter)) {
    const directory = entry.trim();
    if (!directory || !isAbsolute(directory)) {
      continue;
    }
    for (const candidateName of candidateNames) {
      const candidatePath = resolve(directory, candidateName);
      try {
        accessSync(candidatePath, constants.X_OK);
        return candidatePath;
      } catch {
        // Try the next PATH entry.
      }
    }
  }
  return null;
}

function assertDefaultNodeDirectorySecurity(resolved: string): void {
  if (process.platform === "win32") {
    return;
  }
  const directory = normalizePath(realpathSync(dirname(resolved)));
  const stat = statSync(directory);
  if ((stat.mode & 0o022) !== 0) {
    throw new Error(
      "Resolved terminal node binary directory must not be writable by group or other users. Set METIDOS_NODE_BINARY to an absolute Node.js executable path to override.",
    );
  }
  const effectiveUserId = process.geteuid?.();
  if (
    typeof effectiveUserId === "number" &&
    stat.uid !== 0 &&
    stat.uid !== effectiveUserId
  ) {
    throw new Error(
      "Resolved terminal node binary directory must be owned by root or the current user. Set METIDOS_NODE_BINARY to an absolute Node.js executable path to override.",
    );
  }
}

function resolveDefaultTerminalNodeBinary(): string {
  const discovered = findNodeBinaryOnPath(process.env.PATH);
  if (!discovered) {
    throw new Error(
      "Unable to resolve a terminal Node.js binary from PATH. Set METIDOS_NODE_BINARY to an absolute Node.js executable path.",
    );
  }
  const resolved = normalizePath(realpathSync(discovered));
  assertTerminalNodeBinarySecurity(resolved, "Resolved terminal node binary");
  assertDefaultNodeDirectorySecurity(resolved);
  if (loggedDefaultNodeBinary !== resolved) {
    // Same stderr-only rationale as configured terminal binaries: this path is
    // already executable via PATH and helps diagnose PTY startup failures.
    console.warn(`Using resolved Node.js binary for terminals: ${resolved}`);
    loggedDefaultNodeBinary = resolved;
  }
  return resolved;
}

export function resolveTerminalNodeBinary(): string {
  const configured = process.env.METIDOS_NODE_BINARY?.trim();
  if (configured) {
    return resolveConfiguredTerminalNodeBinary(configured);
  }
  return resolveDefaultTerminalNodeBinary();
}

// Terminal sessions inherit only shell usability variables by default. Do not
// broaden this to prefix-based copying: dynamic linker controls (LD_*, DYLD_*),
// runtime hooks (NODE_OPTIONS), and provider/app secrets must stay out unless a
// local operator explicitly opts in through METIDOS_TERMINAL_EXTRA_ENV_ALLOWLIST.
const TERMINAL_ENV_ALLOWLIST = new Set([
  "COLORTERM",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
]);
const WINDOWS_TERMINAL_ENV_ALLOWLIST = new Set([
  "APPDATA",
  "ComSpec",
  "LOCALAPPDATA",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
]);
// The PTY bridge gets an even smaller environment because it only needs enough
// context to locate Node and create the child process. The user-facing terminal
// environment is passed separately in the bounded bridge config.
const TERMINAL_BRIDGE_ENV_ALLOWLIST = new Set([
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "TMPDIR",
  "USER",
]);
const WINDOWS_TERMINAL_BRIDGE_ENV_ALLOWLIST = new Set([
  "ComSpec",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
]);
const TERMINAL_EXTRA_ENV_ALLOWLIST_ENV = "METIDOS_TERMINAL_EXTRA_ENV_ALLOWLIST";
const TERMINAL_SENSITIVE_ENV_KEY_PATTERN =
  /(?:API|AUTH|CREDENTIAL|KEY|PASSWORD|SECRET|TOKEN)/iu;

function warnIfTerminalExtraEnvLooksSensitive(key: string): void {
  // This operator-facing warning deliberately uses stderr because environment
  // construction is a low-level terminal helper. It logs only the variable name,
  // not the value that may contain a credential.
  if (!TERMINAL_SENSITIVE_ENV_KEY_PATTERN.test(key)) {
    return;
  }
  console.warn(
    `${TERMINAL_EXTRA_ENV_ALLOWLIST_ENV} exposes sensitive-looking environment variable ${key} to terminal sessions. Prefer plugin settings or scoped credentials instead.`,
  );
}

function parseTerminalExtraEnvAllowlist(base: NodeJS.ProcessEnv): string[] {
  const raw = base[TERMINAL_EXTRA_ENV_ALLOWLIST_ENV];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return [];
  }
  return raw
    .split(",")
    .map((key) => key.trim())
    .filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .map((key) => {
      warnIfTerminalExtraEnvLooksSensitive(key);
      return key;
    });
}

function pickEnvironment(
  base: NodeJS.ProcessEnv,
  allowlist: Iterable<string>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowlist) {
    const value = base[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }
  return env;
}

export function buildTerminalEnvironment(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const allowlist = new Set(TERMINAL_ENV_ALLOWLIST);
  if (process.platform === "win32") {
    for (const key of WINDOWS_TERMINAL_ENV_ALLOWLIST) {
      allowlist.add(key);
    }
  }
  for (const key of parseTerminalExtraEnvAllowlist(base)) {
    allowlist.add(key);
  }
  Object.assign(env, pickEnvironment(base, allowlist));
  return {
    ...env,
    COLORTERM: env.COLORTERM || "truecolor",
    TERM: env.TERM || "xterm-256color",
  };
}

export function buildTerminalBridgeEnvironment(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowlist = new Set(TERMINAL_BRIDGE_ENV_ALLOWLIST);
  if (process.platform === "win32") {
    for (const key of WINDOWS_TERMINAL_BRIDGE_ENV_ALLOWLIST) {
      allowlist.add(key);
    }
  }
  return pickEnvironment(base, allowlist);
}

export function formatTerminalStartupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.startsWith("Configured terminal default shell") ||
    message.startsWith("No available terminal shell") ||
    message.startsWith("METIDOS_NODE_BINARY") ||
    message.startsWith("Unable to resolve a terminal Node.js binary") ||
    message.startsWith("Resolved terminal node binary")
  ) {
    return message;
  }
  return "Terminal startup failed before the shell was ready. Check terminal settings, the selected worktree, and configured Node.js/shell availability.";
}

function spawnManagedPty(options: {
  args: string[];
  cols: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
  file: string;
  name: string;
  rows: number;
}): ManagedPty {
  const encodedConfig = Buffer.from(JSON.stringify(options), "utf8").toString(
    "base64",
  );
  const child = spawn(resolveTerminalNodeBinary(), [TERMINAL_PTY_BRIDGE_PATH], {
    env: buildTerminalBridgeEnvironment(),
  });
  child.stdin.write(`${encodedConfig}\n`);
  return new BridgeManagedPty(child);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function coercePositiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && typeof value === "number" && value > 0
    ? value
    : fallback;
}

function readNonNegativeIntegerEnv(name: string, fallback: number): number {
  // Terminal limit configuration is parsed before TerminalManager has a
  // subsystem logger, so malformed local env overrides are reported on stderr.
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.warn(
      `Ignoring invalid ${name}=${JSON.stringify(raw)}; expected a non-negative integer.`,
    );
    return fallback;
  }
  return parsed;
}

export type TerminalLimitConfig = {
  exitedIdleTtlMs: number;
  maxGlobalTerminals: number;
  maxTerminalsPerOwner: number;
};

export type TerminalSocketMessageRateLimitConfig = {
  capacity: number;
  maxBuckets: number;
  refillIntervalMs: number;
  refillTokens: number;
};

export type TerminalAbuseControlConfig = {
  socketMessageRateLimit: TerminalSocketMessageRateLimitConfig;
};

export type TerminalProcessMetrics = {
  closing: number;
  exited: number;
  globalSessions: number;
  owners: number;
  running: number;
  starting: number;
};

export function readTerminalLimitConfigFromEnv(): TerminalLimitConfig {
  return {
    exitedIdleTtlMs: readNonNegativeIntegerEnv(
      "METIDOS_TERMINAL_EXITED_IDLE_TTL_MS",
      DEFAULT_EXITED_TERMINAL_IDLE_TTL_MS,
    ),
    maxGlobalTerminals: readNonNegativeIntegerEnv(
      "METIDOS_TERMINAL_MAX_GLOBAL",
      DEFAULT_MAX_GLOBAL_TERMINALS,
    ),
    maxTerminalsPerOwner: readNonNegativeIntegerEnv(
      "METIDOS_TERMINAL_MAX_PER_OWNER",
      DEFAULT_MAX_TERMINALS_PER_OWNER,
    ),
  };
}

export function readTerminalAbuseControlConfigFromEnv(): TerminalAbuseControlConfig {
  return {
    socketMessageRateLimit: {
      capacity: readNonNegativeIntegerEnv(
        "METIDOS_TERMINAL_SOCKET_MESSAGE_RATE_LIMIT_CAPACITY",
        DEFAULT_TERMINAL_SOCKET_MESSAGE_RATE_LIMIT_CAPACITY,
      ),
      maxBuckets: readNonNegativeIntegerEnv(
        "METIDOS_TERMINAL_SOCKET_MESSAGE_RATE_LIMIT_MAX_BUCKETS",
        DEFAULT_TERMINAL_SOCKET_MESSAGE_RATE_LIMIT_MAX_BUCKETS,
      ),
      refillIntervalMs: readNonNegativeIntegerEnv(
        "METIDOS_TERMINAL_SOCKET_MESSAGE_RATE_LIMIT_REFILL_INTERVAL_MS",
        DEFAULT_TERMINAL_SOCKET_MESSAGE_RATE_LIMIT_REFILL_INTERVAL_MS,
      ),
      refillTokens: readNonNegativeIntegerEnv(
        "METIDOS_TERMINAL_SOCKET_MESSAGE_RATE_LIMIT_REFILL_TOKENS",
        DEFAULT_TERMINAL_SOCKET_MESSAGE_RATE_LIMIT_REFILL_TOKENS,
      ),
    },
  };
}

export function createTerminalSocketMessageRateLimiter(
  config: TerminalSocketMessageRateLimitConfig,
): TokenBucketRateLimiter {
  return createTokenBucketRateLimiter(config);
}

function isTerminalClientMessage(
  value: unknown,
): value is TerminalClientMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return type === "input" || type === "resize" || type === "ping";
}

export function normalizeTerminalInputData(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return Buffer.byteLength(value, "utf8") <= TERMINAL_INPUT_MAX_BYTES
    ? value
    : null;
}

export function normalizeTerminalResizeDimensions(
  message: { cols?: unknown; rows?: unknown },
  fallback: { cols: number; rows: number },
): { cols: number; rows: number } {
  return {
    cols: clampInteger(
      coercePositiveInteger(message.cols, fallback.cols),
      TERMINAL_MIN_COLS,
      TERMINAL_MAX_COLS,
    ),
    rows: clampInteger(
      coercePositiveInteger(message.rows, fallback.rows),
      TERMINAL_MIN_ROWS,
      TERMINAL_MAX_ROWS,
    ),
  };
}

function toRpcTerminal(session: TerminalSession): RpcTerminal {
  return {
    command: session.command,
    cols: session.cols,
    createdAt: session.createdAt,
    createdFromThreadId: session.createdFromThreadId,
    cwd: session.cwd,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    projectId: session.projectId,
    projectName: session.projectName,
    rows: session.rows,
    status: session.status,
    terminalId: session.terminalId,
    terminalIndex: session.terminalIndex,
    title: session.title,
    updatedAt: session.updatedAt,
    worktreeFolder: session.worktreeFolder,
    worktreePath: session.worktreePath,
  };
}

export class TerminalManager {
  private readonly limitConfig: TerminalLimitConfig;
  private readonly socketMessageRateLimiter: TokenBucketRateLimiter;
  private sessions = new Map<string, TerminalSession>();
  private terminalOrder: Array<string | undefined> = [];
  private terminalChangedListeners = new Set<(terminal: RpcTerminal) => void>();

  constructor(
    limitConfig: TerminalLimitConfig = readTerminalLimitConfigFromEnv(),
    abuseControlConfig: TerminalAbuseControlConfig = readTerminalAbuseControlConfigFromEnv(),
  ) {
    this.limitConfig = limitConfig;
    this.socketMessageRateLimiter = createTerminalSocketMessageRateLimiter(
      abuseControlConfig.socketMessageRateLimit,
    );
  }

  onTerminalChanged(listener: (terminal: RpcTerminal) => void): () => void {
    this.terminalChangedListeners.add(listener);
    return () => {
      this.terminalChangedListeners.delete(listener);
    };
  }

  private emitChanged(session: TerminalSession): void {
    const terminal = toRpcTerminal(session);
    for (const listener of this.terminalChangedListeners) {
      listener(terminal);
    }
  }

  getProcessMetrics(): TerminalProcessMetrics {
    let closing = 0;
    let exited = 0;
    let running = 0;
    let starting = 0;
    for (const session of this.sessions.values()) {
      if (session.status === "closing") {
        closing += 1;
      } else if (session.status === "exited" || session.status === "error") {
        exited += 1;
      } else if (session.status === "running") {
        running += 1;
      } else if (session.status === "starting") {
        starting += 1;
      }
    }
    return {
      closing,
      exited,
      globalSessions: this.sessions.size,
      owners: this.sessions.size > 0 ? 1 : 0,
      running,
      starting,
    };
  }

  private nextTerminalIndex(terminalId: string): number {
    const index = this.terminalOrder.length;
    this.terminalOrder.push(terminalId);
    return index;
  }

  private normalizeCwd(input: TerminalCreateInput): string {
    const root = normalizePath(input.worktreePath);
    const requested = input.cwd?.trim() || input.dir?.trim() || root;
    const resolved = normalizePath(resolve(root, requested));
    const realRoot = existsSync(root)
      ? normalizePath(realpathSync(root))
      : root;
    const realRequested = existsSync(resolved)
      ? normalizePath(realpathSync(resolved))
      : resolved;
    // Current deployments are single-local-operator, so containment within the
    // selected worktree is the terminal cwd boundary. Before enabling true
    // multi-user deployments, add ownership/ACL checks for realRoot and
    // realRequested so one local account cannot plant another user's cwd.
    if (!pathIsWithinRoot(realRoot, realRequested)) {
      throw new Error(
        "Terminal directory must stay inside the selected worktree.",
      );
    }
    return realRequested;
  }

  private pruneExpiredExitedSessions(nowMs = Date.now()): void {
    if (this.limitConfig.exitedIdleTtlMs === 0) {
      for (const session of [...this.sessions.values()]) {
        if (session.status === "exited" || session.status === "error") {
          this.removeSession(session);
        }
      }
      return;
    }
    for (const session of [...this.sessions.values()]) {
      if (
        (session.status === "exited" || session.status === "error") &&
        Date.parse(session.updatedAt) + this.limitConfig.exitedIdleTtlMs <=
          nowMs
      ) {
        this.removeSession(session);
      }
    }
  }

  private auditTerminalRefusal(reason: "global" | "app"): void {
    // Refusals are useful during overload/debugging even when no request logger
    // is available. The payload contains bounded counters and configured limits,
    // not terminal input/output or environment values.
    console.warn("Terminal creation refused by configured session cap.", {
      limitConfig: this.limitConfig,
      metrics: this.getProcessMetrics(),
      reason,
    });
  }

  private enforceTerminalCaps(): void {
    this.pruneExpiredExitedSessions();
    if (this.sessions.size >= this.limitConfig.maxGlobalTerminals) {
      this.auditTerminalRefusal("global");
      throw new Error(
        "Global terminal limit reached. Close a terminal and try again.",
      );
    }
    if (this.sessions.size >= this.limitConfig.maxTerminalsPerOwner) {
      this.auditTerminalRefusal("app");
      throw new Error(
        "App terminal limit reached. Close a terminal and try again.",
      );
    }
  }

  createTerminal(input: TerminalCreateInput): RpcTerminal {
    this.enforceTerminalCaps();
    const terminalId = randomUUID();
    const now = nowIso();
    const command = input.command?.trim() || null;
    const cwd = this.normalizeCwd(input);
    const replayBufferBytes = normalizeReplayBytes(
      input.settings.replayBufferBytes,
    );
    const session: TerminalSession = {
      command,
      cols: coercePositiveInteger(input.cols, DEFAULT_COLS),
      closeTimer: null,
      createdAt: now,
      exitedCleanupTimer: null,
      createdFromThreadId: input.createdFromThreadId ?? null,
      ownerSessionId: input.ownerSessionId ?? null,
      cwd,
      exitCode: null,
      exitSignal: null,
      projectId: input.projectId,
      projectName: input.projectName,
      ptyProcess: null,
      replayBufferBytes,
      rows: coercePositiveInteger(input.rows, DEFAULT_ROWS),
      outputBuffer: new TerminalOutputBuffer(replayBufferBytes),
      pendingSocketOutput: "",
      socketFlushTimer: null,
      sockets: new Set(),
      status: "starting",
      terminalId,
      terminalIndex: this.nextTerminalIndex(terminalId),
      title: normalizeTitle(input.title, command),
      updatedAt: now,
      waitingForKeyToClose: false,
      worktreeFolder: basename(input.worktreePath),
      worktreePath: input.worktreePath,
    };
    this.sessions.set(terminalId, session);
    this.spawn(session, input.settings);
    this.emitChanged(session);
    return toRpcTerminal(session);
  }

  private spawn(session: TerminalSession, settings: RpcTerminalSettings): void {
    try {
      const spawnConfig = resolveShellSpawn(session.command, settings);
      const env = buildTerminalEnvironment();
      if (process.platform !== "win32") {
        env.SHELL = spawnConfig.file;
      }
      session.ptyProcess = spawnManagedPty({
        args: spawnConfig.args,
        cols: session.cols,
        cwd: session.cwd,
        env,
        file: spawnConfig.file,
        name: "xterm-256color",
        rows: session.rows,
      });
      session.status = "running";
      session.updatedAt = nowIso();
      session.ptyProcess.onData((data) => {
        this.appendOutput(session, data);
      });
      session.ptyProcess.onExit((event) => {
        this.handleExit(session, event.exitCode, event.signal ?? null);
      });
    } catch (error) {
      session.status = "error";
      session.updatedAt = nowIso();
      this.appendOutput(
        session,
        `\r\nFailed to start terminal: ${formatTerminalStartupError(error)}\r\n`,
      );
      this.scheduleExitedCleanup(session);
    }
  }

  private appendOutput(session: TerminalSession, data: string): void {
    session.outputBuffer.append(data);
    session.updatedAt = nowIso();
    if (session.sockets.size === 0) {
      return;
    }
    session.pendingSocketOutput += data;
    if (session.socketFlushTimer !== null) {
      return;
    }
    session.socketFlushTimer = setTimeout(() => {
      this.flushSocketOutput(session);
    }, TERMINAL_SOCKET_FLUSH_INTERVAL_MS);
  }

  private flushSocketOutput(session: TerminalSession): void {
    if (session.socketFlushTimer !== null) {
      clearTimeout(session.socketFlushTimer);
      session.socketFlushTimer = null;
    }
    if (session.pendingSocketOutput.length === 0) {
      return;
    }
    const data = session.pendingSocketOutput;
    session.pendingSocketOutput = "";
    const message = JSON.stringify({ type: "output", data });
    for (const socket of session.sockets) {
      try {
        socket.send(message);
      } catch {
        // close handler will detach stale sockets.
      }
    }
  }

  private retainedRawOutput(session: TerminalSession): string {
    return session.outputBuffer.toString();
  }

  private handleExit(
    session: TerminalSession,
    exitCode: number | undefined,
    signal: number | string | null,
  ): void {
    if (session.closeTimer !== null) {
      clearTimeout(session.closeTimer);
      session.closeTimer = null;
    }
    session.ptyProcess = null;
    session.status = "exited";
    session.exitCode = typeof exitCode === "number" ? exitCode : null;
    session.exitSignal = signal === null ? null : String(signal);
    session.waitingForKeyToClose = true;
    const label = `Exited code ${session.exitCode ?? 0}. Press any key to close this terminal...`;
    this.appendOutput(session, `\r\n${label}`);
    this.scheduleExitedCleanup(session);
    this.emitChanged(session);
  }

  private scheduleExitedCleanup(session: TerminalSession): void {
    if (session.exitedCleanupTimer !== null) {
      clearTimeout(session.exitedCleanupTimer);
    }
    session.exitedCleanupTimer = setTimeout(() => {
      const current = this.sessions.get(session.terminalId);
      if (
        current === session &&
        (session.status === "exited" || session.status === "error")
      ) {
        this.removeSession(session);
      }
    }, this.limitConfig.exitedIdleTtlMs);
    session.exitedCleanupTimer.unref?.();
  }

  listTerminals(access?: TerminalAccessScope): RpcTerminal[] {
    return this.terminalOrder
      .flatMap((id) => {
        if (!id) {
          return [];
        }
        const session = this.sessions.get(id);
        return session ? [session] : [];
      })
      .filter((session) => {
        if (!access) {
          return true;
        }
        try {
          assertTerminalAccess(session, access);
          return true;
        } catch {
          return false;
        }
      })
      .map(toRpcTerminal);
  }

  resolveTerminalByIndex(terminalIndex: number): TerminalSession {
    const terminalId = this.terminalOrder[terminalIndex];
    const session = terminalId ? this.sessions.get(terminalId) : undefined;
    if (!session) {
      throw new Error(`Terminal ${terminalIndex} was not found.`);
    }
    return session;
  }

  getTerminal(terminalId: string): RpcTerminal {
    const session = this.sessions.get(terminalId);
    if (!session) {
      throw new Error("Terminal was not found.");
    }
    return toRpcTerminal(session);
  }

  renameTerminal(terminalId: string, title: string): RpcTerminal {
    const session = this.sessions.get(terminalId);
    if (!session) {
      throw new Error("Terminal was not found.");
    }
    const normalized = title.trim();
    if (!normalized) {
      throw new Error("Terminal title cannot be empty.");
    }
    session.title = normalized.slice(0, TERMINAL_TITLE_MAX_LENGTH);
    session.updatedAt = nowIso();
    this.emitChanged(session);
    return toRpcTerminal(session);
  }

  closeTerminal(terminalId: string): RpcTerminal {
    const session = this.sessions.get(terminalId);
    if (!session) {
      throw new Error("Terminal was not found.");
    }
    const terminal = toRpcTerminal(session);
    this.closeSession(session, false);
    return terminal;
  }

  killTerminalByIndex(
    terminalIndex: number,
    access?: TerminalAccessScope,
  ): void {
    const session = this.resolveTerminalByIndex(terminalIndex);
    assertTerminalAccess(session, access);
    this.closeSession(session, false);
  }

  private closeSession(session: TerminalSession, fromKeypress: boolean): void {
    if (
      session.status === "exited" ||
      session.waitingForKeyToClose ||
      fromKeypress
    ) {
      this.removeSession(session);
      return;
    }
    session.status = "closing";
    session.updatedAt = nowIso();
    this.emitChanged(session);
    try {
      session.ptyProcess?.kill();
    } catch {
      // Fall through to forced removal timer.
    }
    if (session.closeTimer !== null) {
      clearTimeout(session.closeTimer);
    }
    session.closeTimer = setTimeout(() => {
      try {
        session.ptyProcess?.kill("SIGKILL");
      } catch {
        // Best effort; remove the session either way.
      }
      this.removeSession(session);
    }, TERMINAL_FORCE_KILL_DELAY_MS);
  }

  private removeSession(session: TerminalSession): void {
    if (session.closeTimer !== null) {
      clearTimeout(session.closeTimer);
      session.closeTimer = null;
    }
    if (session.exitedCleanupTimer !== null) {
      clearTimeout(session.exitedCleanupTimer);
      session.exitedCleanupTimer = null;
    }
    try {
      session.ptyProcess?.kill();
    } catch {
      // Already gone.
    }
    this.flushSocketOutput(session);
    for (const socket of session.sockets) {
      try {
        socket.close(TERMINAL_SOCKET_CLOSE_NORMAL, "Terminal closed.");
      } catch {
        // Ignore stale sockets.
      }
    }
    session.sockets.clear();
    this.sessions.delete(session.terminalId);
    if (this.terminalOrder[session.terminalIndex] === session.terminalId) {
      this.terminalOrder[session.terminalIndex] = undefined;
      while (
        this.terminalOrder.length > 0 &&
        this.terminalOrder.at(-1) === undefined
      ) {
        this.terminalOrder.pop();
      }
    }
    this.emitChanged(session);
  }

  private socketMessageRateLimitKey(socket: TerminalSocket): string {
    return `${socket.data.sessionId ?? "no-session"}:${socket.data.terminalId}`;
  }

  private allowSocketMessage(socket: TerminalSocket): boolean {
    return this.socketMessageRateLimiter.hit(
      this.socketMessageRateLimitKey(socket),
    ).allowed;
  }

  private socketCanAccessSession(
    session: TerminalSession | undefined,
    socket: TerminalSocket,
  ): session is TerminalSession {
    // Terminal WebSockets are scoped to the authenticated session id captured
    // during the upgrade. A socket may only attach to PTYs owned by that exact
    // session, so an operator cannot reuse a valid WebSocket ticket/session to
    // connect to another browser session's terminal by guessing its terminalId.
    return (
      !!session &&
      typeof socket.data.sessionId === "string" &&
      typeof session.ownerSessionId === "string" &&
      session.ownerSessionId.length > 0 &&
      socket.data.sessionId === session.ownerSessionId
    );
  }

  connectSocket(socket: TerminalSocket): void {
    const session = this.sessions.get(socket.data.terminalId);
    if (!this.socketCanAccessSession(session, socket)) {
      socket.close(
        TERMINAL_SOCKET_CLOSE_POLICY_VIOLATION,
        "Terminal not authorized.",
      );
      return;
    }
    this.flushSocketOutput(session);
    session.sockets.add(socket);
    socket.send(
      JSON.stringify({ type: "ready", terminal: toRpcTerminal(session) }),
    );
    const replayBuffer = this.retainedRawOutput(session);
    if (replayBuffer) {
      socket.send(JSON.stringify({ type: "replay", data: replayBuffer }));
    }
  }

  disconnectSocket(socket: TerminalSocket): void {
    const session = this.sessions.get(socket.data.terminalId);
    if (!this.socketCanAccessSession(session, socket)) {
      return;
    }
    session.sockets.delete(socket);
    if (session.sockets.size === 0) {
      this.clearPendingSocketOutput(session);
    }
  }

  closeSocketsForSession(
    sessionId: string,
    reason: string,
    options: TerminalSocketCloseOptions = {},
  ): number {
    return this.closeMatchingSockets(
      (socket) => socket.data.sessionId === sessionId,
      reason,
      options,
    );
  }

  closeSocketsForUser(
    userId: number,
    reason: string,
    options: TerminalSocketCloseOptions = {},
  ): number {
    return this.closeMatchingSockets(
      (socket) => socket.data.userId === userId,
      reason,
      options,
    );
  }

  private closeMatchingSockets(
    matches: (socket: TerminalSocket) => boolean,
    reason: string,
    options: TerminalSocketCloseOptions,
  ): number {
    let closedCount = 0;
    const sessionsToTerminate = new Set<TerminalSession>();
    for (const session of this.sessions.values()) {
      let sessionChanged = false;
      for (const socket of [...session.sockets]) {
        if (!matches(socket)) {
          continue;
        }
        session.sockets.delete(socket);
        sessionChanged = true;
        closedCount += 1;
        try {
          socket.close(TERMINAL_SOCKET_CLOSE_POLICY_VIOLATION, reason);
        } catch {
          // Ignore stale socket close failures.
        }
      }
      if (!sessionChanged) {
        continue;
      }
      if (options.terminatePtys) {
        sessionsToTerminate.add(session);
        continue;
      }
      if (session.sockets.size === 0) {
        this.clearPendingSocketOutput(session);
      }
    }
    for (const session of sessionsToTerminate) {
      this.closeSession(session, false);
    }
    return closedCount;
  }

  private clearPendingSocketOutput(session: TerminalSession): void {
    if (session.socketFlushTimer !== null) {
      clearTimeout(session.socketFlushTimer);
      session.socketFlushTimer = null;
    }
    session.pendingSocketOutput = "";
  }

  handleSocketMessage(
    socket: TerminalSocket,
    rawMessage: string | Buffer,
  ): void {
    const session = this.sessions.get(socket.data.terminalId);
    if (!this.socketCanAccessSession(session, socket)) {
      socket.close(
        TERMINAL_SOCKET_CLOSE_POLICY_VIOLATION,
        "Terminal not authorized.",
      );
      return;
    }
    if (!this.allowSocketMessage(socket)) {
      socket.close(
        TERMINAL_SOCKET_CLOSE_POLICY_VIOLATION,
        "Terminal message rate limit exceeded.",
      );
      return;
    }
    const text =
      typeof rawMessage === "string" ? rawMessage : rawMessage.toString();
    let parsedMessage: unknown;
    try {
      parsedMessage = JSON.parse(text) as unknown;
    } catch {
      socket.close(
        TERMINAL_SOCKET_CLOSE_UNSUPPORTED_DATA,
        "Invalid terminal message.",
      );
      return;
    }
    if (!isTerminalClientMessage(parsedMessage)) {
      socket.close(
        TERMINAL_SOCKET_CLOSE_UNSUPPORTED_DATA,
        "Unsupported terminal message.",
      );
      return;
    }
    const message = parsedMessage;
    if (message.type === "ping") {
      socket.send(TERMINAL_PONG_MESSAGE);
      return;
    }
    if (message.type === "resize") {
      const { cols, rows } = normalizeTerminalResizeDimensions(message, {
        cols: session.cols,
        rows: session.rows,
      });
      session.cols = cols;
      session.rows = rows;
      session.updatedAt = nowIso();
      try {
        session.ptyProcess?.resize(cols, rows);
      } catch {
        // Some exited/closing processes cannot resize.
      }
      this.emitChanged(session);
      return;
    }
    if (message.type === "input") {
      const inputData = normalizeTerminalInputData(message.data);
      if (inputData === null) {
        socket.close(
          TERMINAL_SOCKET_CLOSE_UNSUPPORTED_DATA,
          "Invalid terminal input.",
        );
        return;
      }
      if (session.waitingForKeyToClose || session.status === "exited") {
        this.closeSession(session, true);
        return;
      }
      session.ptyProcess?.write(inputData);
      return;
    }
    socket.close(
      TERMINAL_SOCKET_CLOSE_UNSUPPORTED_DATA,
      "Unsupported terminal message.",
    );
  }

  terminalConnectionInfo(terminalId: string): RpcTerminalConnectionInfo {
    return {
      terminalId,
      webSocketPath: `/terminal/${encodeURIComponent(terminalId)}`,
    };
  }

  viewTerminal(
    terminalIndex: number,
    lineOffset = 0,
    lineCount = TERMINAL_VIEW_DEFAULT_LINE_COUNT,
    access?: TerminalAccessScope,
  ): string {
    const session = this.resolveTerminalByIndex(terminalIndex);
    assertTerminalAccess(session, access);
    const safeOffset = Math.max(0, Math.floor(lineOffset));
    const safeCount = Math.max(
      1,
      Math.min(Math.floor(lineCount), TERMINAL_VIEW_MAX_LINE_COUNT),
    );
    const selected = session.outputBuffer.cleanLines(safeOffset, safeCount);
    const totalLines = session.outputBuffer.cleanLineCount();
    return [
      `Terminal ${session.terminalIndex} — ${session.title}`,
      `Status: ${session.status}`,
      `Workspace: ${session.projectName} · ${session.worktreeFolder}`,
      `Command: ${session.command ?? ""}`,
      `Showing lines ${selected.length > 0 ? safeOffset + 1 : safeOffset}-${safeOffset + selected.length} of ${totalLines} retained lines.`,
      "",
      selected.join("\n"),
    ].join("\n");
  }

  grepTerminal(
    terminalIndex: number,
    pattern: string,
    ignoreCase = false,
    maxMatches = TERMINAL_GREP_DEFAULT_MATCH_LIMIT,
    access?: TerminalAccessScope,
  ): string {
    const session = this.resolveTerminalByIndex(terminalIndex);
    assertTerminalAccess(session, access);
    const regex = createSafeTerminalGrepRegex(pattern, ignoreCase);
    const cap = Math.max(
      1,
      Math.min(Math.floor(maxMatches), TERMINAL_GREP_MAX_MATCH_LIMIT),
    );
    const deadline = Date.now() + TERMINAL_GREP_SCAN_TIMEOUT_MS;
    const matches = session.outputBuffer.grepCleanLines(regex, cap, () => {
      if (Date.now() > deadline) {
        throw new Error(
          "Terminal grep timed out while scanning retained output. Narrow the pattern or reduce retained output.",
        );
      }
    });
    if (matches.length === 0) {
      return `No matches for ${JSON.stringify(pattern)} in terminal ${terminalIndex}.`;
    }
    return [
      `Terminal ${session.terminalIndex} — ${session.title}`,
      `${matches.length} matches for ${JSON.stringify(pattern)}:`,
      "",
      ...matches,
    ].join("\n");
  }
}

export const terminalManager = new TerminalManager();
