/**
 * @file src/bun/starvation-harness.ts
 * @description Module for starvation harness.
 */

import { basename, resolve } from "node:path";

import type {
  AppRPCSchema,
  RpcProject,
  RpcRequestPriority,
  RpcWorktree,
} from "./rpc-schema";
import type { RuntimeDiagnosticsSnapshot } from "./runtime-stats";

/**
 * Names of RPC methods available to the harness.
 */

type RpcMethodName = keyof AppRPCSchema["requests"];

/**
 * Parsed command-line options and effective configuration for a run.
 */

export type HarnessOptions = {
  durationMs: number;
  help: boolean;
  httpBudgetMs: number;
  json: boolean;
  port: number;
  projectId: number | null;
  projectPath: string;
  rpcBudgetMs: number;
  rpcPort: number | null;
  rpcUrl: string | null;
  startupBudgetMs: number;
  warmupMs: number;
  workers: number;
  worktreePath: string | null;
};

type TimedResult = {
  durationMs: number;
  label: string;
  ok: boolean;
  status: string;
};

type HttpTimedResult = TimedResult & {
  httpStatus: number;
  url: string;
};

export type StartupSummary = {
  http: HttpTimedResult[];
  rpc: TimedResult[];
  totalDurationMs: number;
};

export type TimingDistribution = {
  count: number;
  maxMs: number | null;
  meanMs: number | null;
  minMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
};

export type PressureSummary = {
  abortedCount: number;
  completedCount: number;
  failedCount: number;
  failureCountByLabel: Record<string, number>;
  timingsByLabel: Record<string, number[]>;
};

export type HarnessReport = {
  budgets: {
    httpBudgetMs: number;
    rpcBudgetMs: number;
    startupBudgetMs: number;
  };
  diagnostics: {
    afterPressure: RuntimeDiagnosticsSnapshot;
    afterWarmup: RuntimeDiagnosticsSnapshot;
    beforeWarmup: RuntimeDiagnosticsSnapshot;
  };
  latency: {
    pressureRpcByLabel: Record<string, TimingDistribution>;
    startupHttpByLabel: Record<string, TimingDistribution>;
    startupRpcByLabel: Record<string, TimingDistribution>;
  };
  pass: boolean;
  pressure: {
    abortedCount: number;
    completedCount: number;
    failedCount: number;
    failureCountByLabel: Record<string, number>;
  };
  startup: StartupSummary;
  target: {
    projectId: number;
    projectName: string;
    publicUrl: string;
    rpcUrl: string;
    worktreePath: string;
  };
};

/**
 * Shape of RPC responses consumed by the harness socket client.
 */

type RpcResponseMessage =
  | {
      type: "response";
      id: number;
      ok: true;
      result: unknown;
    }
  | {
      type: "response";
      id: number;
      ok: false;
      error: string;
    };

type PendingRpcCall = {
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
  timeout: ReturnType<typeof setTimeout> | null;
};

/**
 * Working context tracked across startup, load generation, and cleanup.
 */

type HarnessContext = {
  project: RpcProject;
  projectWasCreated: boolean;
  projectWasInitiallyOpen: boolean;
  worktree: RpcWorktree;
};

const DEFAULT_PORT = 7599;
const DEFAULT_DURATION_MS = 10_000;
const DEFAULT_HTTP_BUDGET_MS = 3_000;
const DEFAULT_RPC_BUDGET_MS = 5_000;
const DEFAULT_STARTUP_BUDGET_MS = 12_000;
const DEFAULT_WARMUP_MS = 300;
const DEFAULT_WORKER_COUNT = 3;

/**
 * Lightweight websocket JSON-RPC request/response client used by the harness.
 */

class RpcHarnessClient {
  private readonly pending = new Map<number, PendingRpcCall>();
  private readonly readyPromise: Promise<void>;
  private closed = false;
  private nextId = 1;
  private readonly socket: WebSocket;
  /**
   * Creates and initializes a new instance.
   * @param url - Request URL.
   */

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error(`Failed to connect to ${url}`));
      };
      const cleanup = () => {
        this.socket.removeEventListener("open", handleOpen);
        this.socket.removeEventListener("error", handleError);
      };
      this.socket.addEventListener("open", handleOpen, { once: true });
      this.socket.addEventListener("error", handleError, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      this.handleMessage(String(event.data));
    });
    this.socket.addEventListener("close", () => {
      this.closed = true;
      for (const [id, pending] of this.pending) {
        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }
        pending.reject(new Error(`RPC socket closed before response ${id}.`));
      }
      this.pending.clear();
    });
  }

  async ready(): Promise<void> {
    await this.readyPromise;
  }

  /**
   * Send one RPC request and await typed response or timeout.
   */

  async call<K extends RpcMethodName>(
    method: K,
    params: AppRPCSchema["requests"][K]["params"],
    options?: {
      priority?: RpcRequestPriority;
      timeoutMs?: number;
    },
  ): Promise<AppRPCSchema["requests"][K]["response"]> {
    await this.ready();
    if (this.closed) {
      throw new Error("RPC socket is closed.");
    }

    const id = this.nextId++;
    const timeoutMs = options?.timeoutMs ?? null;
    const response = new Promise<AppRPCSchema["requests"][K]["response"]>(
      (resolve, reject) => {
        const timeout =
          typeof timeoutMs === "number"
            ? setTimeout(() => {
                this.pending.delete(id);
                reject(
                  new Error(
                    `RPC request ${String(method)} timed out after ${timeoutMs}ms.`,
                  ),
                );
              }, timeoutMs)
            : null;
        this.pending.set(id, {
          reject,
          resolve: (value) =>
            resolve(value as AppRPCSchema["requests"][K]["response"]),
          timeout,
        });
      },
    );

    this.socket.send(
      JSON.stringify({
        id,
        method,
        params,
        priority: options?.priority ?? "default",
        timeoutMs,
        type: "request",
      }),
    );
    return response;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.socket.close();
  }
  /**
   * Handles message.
   * @param raw - Raw payload returned from the subprocess.
   */

  private handleMessage(raw: string): void {
    let parsed: RpcResponseMessage | null = null;
    try {
      parsed = JSON.parse(raw) as RpcResponseMessage;
    } catch {
      return;
    }
    if (!parsed || parsed.type !== "response") {
      return;
    }

    const pending = this.pending.get(parsed.id);
    if (!pending) {
      return;
    }
    this.pending.delete(parsed.id);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    if (parsed.ok) {
      pending.resolve(parsed.result);
      return;
    }
    pending.reject(new Error(parsed.error || "RPC request failed."));
  }
}
/**
 * Parses args.
 * @param argv - CLI arguments passed to the harness command parser.
 */

export function parseArgs(argv: string[]): HarnessOptions {
  const options: HarnessOptions = {
    durationMs: DEFAULT_DURATION_MS,
    help: false,
    httpBudgetMs: DEFAULT_HTTP_BUDGET_MS,
    json: false,
    port: DEFAULT_PORT,
    projectId: null,
    projectPath: process.cwd(),
    rpcBudgetMs: DEFAULT_RPC_BUDGET_MS,
    rpcPort: null,
    rpcUrl: null,
    startupBudgetMs: DEFAULT_STARTUP_BUDGET_MS,
    warmupMs: DEFAULT_WARMUP_MS,
    workers: DEFAULT_WORKER_COUNT,
    worktreePath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (typeof arg !== "string") {
      continue;
    }
    if (!arg.startsWith("--")) {
      continue;
    }
    const [flag, inlineValue] = arg.split("=", 2);
    const nextValue =
      typeof inlineValue === "string" ? inlineValue : argv[index + 1];
    const consumeNext = typeof inlineValue !== "string";
    const readValue = (): string => {
      if (!nextValue) {
        throw new Error(`Missing value for ${flag}`);
      }
      if (consumeNext) {
        index += 1;
      }
      return nextValue;
    };

    switch (flag) {
      case "--help":
        options.help = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--port":
        options.port = parseIntegerOption(flag, readValue(), 1, 65_535);
        break;
      case "--project-id":
        options.projectId = parseIntegerOption(flag, readValue(), 1);
        break;
      case "--project-path":
        options.projectPath = resolve(readValue());
        break;
      case "--rpc-port":
        options.rpcPort = parseIntegerOption(flag, readValue(), 1, 65_535);
        break;
      case "--rpc-url":
        options.rpcUrl = readValue();
        break;
      case "--worktree-path":
        options.worktreePath = resolve(readValue());
        break;
      case "--duration-ms":
        options.durationMs = parseIntegerOption(flag, readValue(), 1);
        break;
      case "--http-budget-ms":
        options.httpBudgetMs = parseIntegerOption(flag, readValue(), 1);
        break;
      case "--rpc-budget-ms":
        options.rpcBudgetMs = parseIntegerOption(flag, readValue(), 1);
        break;
      case "--startup-budget-ms":
        options.startupBudgetMs = parseIntegerOption(flag, readValue(), 1);
        break;
      case "--warmup-ms":
        options.warmupMs = parseIntegerOption(flag, readValue(), 0);
        break;
      case "--workers":
        options.workers = parseIntegerOption(flag, readValue(), 1);
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }

  return options;
}

/**
 * Parse numeric flag values and enforce min/max bounds.
 */

function parseIntegerOption(
  flag: string,
  value: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${flag} must be an integer.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < min || parsed > max) {
    throw new Error(`${flag} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function printHelp(): void {
  console.log(`Usage: bun run src/bun/starvation-harness.ts [options]

Options:
  --port <port>                 Public HTTP server port. Default: ${DEFAULT_PORT}
  --rpc-port <port>             RPC WebSocket port override. Default: autodetect or reuse --port.
  --rpc-url <url>               RPC WebSocket URL override. Example: ws://127.0.0.1:7600/rpc
  --project-id <id>             Existing tracked project id to target.
  --project-path <path>         Project path to target. Default: current working directory.
  --worktree-path <path>        Worktree path to target. Default: inferred from project/worktrees.
  --workers <count>             Background pressure workers. Default: ${DEFAULT_WORKER_COUNT}
  --duration-ms <ms>            Pressure window. Default: ${DEFAULT_DURATION_MS}
  --warmup-ms <ms>              Delay before startup measurement. Default: ${DEFAULT_WARMUP_MS}
  --http-budget-ms <ms>         Per-endpoint HTTP latency budget. Default: ${DEFAULT_HTTP_BUDGET_MS}
  --rpc-budget-ms <ms>          Per-request RPC latency budget. Default: ${DEFAULT_RPC_BUDGET_MS}
  --startup-budget-ms <ms>      Total startup budget. Default: ${DEFAULT_STARTUP_BUDGET_MS}
  --json                        Emit a structured JSON report instead of plain text.
  --help                        Show this help text.
`);
}

/**
 * Promise-based timer utility.
 * @param ms - Delay in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Check for AbortError/TimeoutError values.
 * @param error - Error value to process.
 */
function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Time an HTTP endpoint request and classify latency/outcome.
 */

async function measureHttp(
  baseUrl: string,
  path: string,
  timeoutMs: number,
): Promise<HttpTimedResult> {
  const url = `${baseUrl}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`HTTP request timed out for ${path}`));
  }, timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      headers: {
        "cache-control": "no-store",
      },
      signal: controller.signal,
    });
    const durationMs = Math.max(0, performance.now() - startedAt);
    return {
      durationMs,
      httpStatus: response.status,
      label: path,
      ok: response.ok,
      status: response.ok ? "ok" : `http-${response.status}`,
      url,
    };
  } catch (error) {
    const durationMs = Math.max(0, performance.now() - startedAt);
    return {
      durationMs,
      httpStatus: 0,
      label: path,
      ok: false,
      status: toErrorLabel(error),
      url,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Time an RPC request and return both parsed result and status payload.
 */

async function measureRpc<K extends RpcMethodName>(
  client: RpcHarnessClient,
  label: string,
  method: K,
  params: AppRPCSchema["requests"][K]["params"],
  options: {
    priority?: RpcRequestPriority;
    timeoutMs: number;
  },
): Promise<{
  result: AppRPCSchema["requests"][K]["response"] | null;
  timing: TimedResult;
}> {
  const startedAt = performance.now();
  try {
    const result = await client.call(method, params, options);
    return {
      result,
      timing: {
        durationMs: Math.max(0, performance.now() - startedAt),
        label,
        ok: true,
        status: "ok",
      },
    };
  } catch (error) {
    return {
      result: null,
      timing: {
        durationMs: Math.max(0, performance.now() - startedAt),
        label,
        ok: false,
        status: toErrorLabel(error),
      },
    };
  }
}
/**
 * Build/resolve project and worktree context prior to running measurements.
 */

async function ensureHarnessContext(
  client: RpcHarnessClient,
  options: HarnessOptions,
): Promise<HarnessContext> {
  const projects = await client.call(
    "listProjects",
    {
      includeClosed: true,
    },
    {
      priority: "foreground",
      timeoutMs: options.rpcBudgetMs,
    },
  );
  let project =
    (typeof options.projectId === "number"
      ? projects.find((candidate) => candidate.id === options.projectId)
      : projects.find((candidate) => candidate.path === options.projectPath)) ??
    null;
  const projectWasCreated = project === null;
  const projectWasInitiallyOpen = project?.isOpen === 1;

  const opened = await client.call(
    "openProject",
    {
      name: project?.name ?? basename(options.projectPath),
      projectPath: project?.path ?? options.projectPath,
    },
    {
      priority: "foreground",
      timeoutMs: options.rpcBudgetMs,
    },
  );
  project = opened.project;
  const worktree =
    (options.worktreePath
      ? opened.worktrees.find(
          (candidate) => candidate.path === options.worktreePath,
        )
      : null) ??
    opened.worktrees.find(
      (candidate) =>
        candidate.path === options.projectPath ||
        candidate.path === project.path,
    ) ??
    opened.worktrees[0] ??
    null;
  if (!worktree) {
    throw new Error(`No worktrees available for project ${project.path}.`);
  }

  return {
    project,
    projectWasCreated,
    projectWasInitiallyOpen,
    worktree,
  };
}

/**
 * Continuous worker that repeatedly opens worktree and reads diff/history under load.
 */

async function runPressureWorker(
  client: RpcHarnessClient,
  context: HarnessContext,
  options: HarnessOptions,
  stopSignal: AbortSignal,
): Promise<PressureSummary> {
  const summary: PressureSummary = {
    abortedCount: 0,
    completedCount: 0,
    failedCount: 0,
    failureCountByLabel: {},
    timingsByLabel: {},
  };

  while (!stopSignal.aborted) {
    try {
      const opened = await measureRpc(
        client,
        "openWorktree",
        "openWorktree",
        {
          projectId: context.project.id,
          worktreePath: context.worktree.path,
        },
        {
          priority: "background",
          timeoutMs: options.rpcBudgetMs,
        },
      );
      if (!opened.timing.ok || !opened.result) {
        summary.failedCount += 1;
        summary.failureCountByLabel.openWorktree =
          (summary.failureCountByLabel.openWorktree ?? 0) + 1;
        continue;
      }
      appendDurationSample(
        summary.timingsByLabel,
        "openWorktree",
        opened.timing.durationMs,
      );

      const firstCommit = opened.result.history.entries[0] ?? null;
      if (firstCommit) {
        const diff = await measureRpc(
          client,
          "getWorktreeGitCommitDiff",
          "getWorktreeGitCommitDiff",
          {
            commitHash: firstCommit.hash,
            projectId: context.project.id,
            worktreePath: context.worktree.path,
          },
          {
            priority: "background",
            timeoutMs: options.rpcBudgetMs,
          },
        );
        if (!diff.timing.ok) {
          summary.failedCount += 1;
          summary.failureCountByLabel.getWorktreeGitCommitDiff =
            (summary.failureCountByLabel.getWorktreeGitCommitDiff ?? 0) + 1;
          continue;
        }
        appendDurationSample(
          summary.timingsByLabel,
          "getWorktreeGitCommitDiff",
          diff.timing.durationMs,
        );
      }

      const history = await measureRpc(
        client,
        "listWorktreeGitHistory",
        "listWorktreeGitHistory",
        {
          limit: 20,
          projectId: context.project.id,
          worktreePath: context.worktree.path,
        },
        {
          priority: "background",
          timeoutMs: options.rpcBudgetMs,
        },
      );
      if (!history.timing.ok) {
        summary.failedCount += 1;
        summary.failureCountByLabel.listWorktreeGitHistory =
          (summary.failureCountByLabel.listWorktreeGitHistory ?? 0) + 1;
        continue;
      }
      appendDurationSample(
        summary.timingsByLabel,
        "listWorktreeGitHistory",
        history.timing.durationMs,
      );
      summary.completedCount += 1;
    } catch (error) {
      if (stopSignal.aborted || isAbortError(error)) {
        summary.abortedCount += 1;
        continue;
      }
      summary.failedCount += 1;
    }
  }

  return summary;
}

/**
 * Measure startup path through HTTP and RPC endpoints and return timing summary.
 */

async function measureStartupSequence(
  client: RpcHarnessClient,
  baseUrl: string,
  context: HarnessContext,
  options: HarnessOptions,
): Promise<StartupSummary> {
  const startupStartedAt = performance.now();
  const http = await Promise.all([
    measureHttp(baseUrl, "/health", options.httpBudgetMs),
    measureHttp(baseUrl, "/", options.httpBudgetMs),
    measureHttp(baseUrl, "/index.js", options.httpBudgetMs),
    measureHttp(baseUrl, "/index.css", options.httpBudgetMs),
  ]);

  const rpc: TimedResult[] = [];

  const bootstrap = await measureRpc(
    client,
    "getAppBootstrap",
    "getAppBootstrap",
    {
      selectedProjectId: null,
      selectedWorktreePath: null,
      threadIdHint: null,
    },
    {
      priority: "foreground",
      timeoutMs: options.rpcBudgetMs,
    },
  );
  rpc.push(bootstrap.timing);

  const opened = await measureRpc(
    client,
    "openWorktree",
    "openWorktree",
    {
      projectId: context.project.id,
      worktreePath: context.worktree.path,
    },
    {
      priority: "foreground",
      timeoutMs: options.rpcBudgetMs,
    },
  );
  rpc.push(opened.timing);
  if (!opened.timing.ok) {
    return {
      http,
      rpc,
      totalDurationMs: Math.max(0, performance.now() - startupStartedAt),
    };
  }

  return {
    http,
    rpc,
    totalDurationMs: Math.max(0, performance.now() - startupStartedAt),
  };
}

/**
 * Cleanup created threads/projects from test run, but keep test results authoritative.
 */

async function cleanupHarness(
  client: RpcHarnessClient,
  context: HarnessContext,
): Promise<void> {
  if (context.projectWasCreated) {
    try {
      await client.call(
        "deleteProject",
        { projectId: context.project.id },
        {
          priority: "foreground",
          timeoutMs: 2_000,
        },
      );
    } catch {
      // Ignore cleanup failures.
    }
    return;
  }

  if (!context.projectWasInitiallyOpen) {
    try {
      await client.call(
        "closeProject",
        { projectId: context.project.id },
        {
          priority: "foreground",
          timeoutMs: 2_000,
        },
      );
    } catch {
      // Ignore cleanup failures.
    }
  }
}

/**
 * Normalize unknown error value into stable string label for output.
 * @param error - Error value to process.
 */
function toErrorLabel(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return String(error);
}

function runtimeStatsUrlFromBaseUrl(baseUrl: string): string {
  return `${baseUrl}/health/runtime-stats`;
}

async function readRuntimeDiagnostics(
  baseUrl: string,
  timeoutMs: number,
  options?: {
    reset?: boolean;
  },
): Promise<RuntimeDiagnosticsSnapshot> {
  const reset = options?.reset === true;
  const url = reset
    ? `${runtimeStatsUrlFromBaseUrl(baseUrl)}/reset`
    : runtimeStatsUrlFromBaseUrl(baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(
      new Error(`Runtime diagnostics request timed out for ${url}`),
    );
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      method: reset ? "POST" : "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Runtime diagnostics request failed with status ${response.status} for ${url}.`,
      );
    }

    return (await response.json()) as RuntimeDiagnosticsSnapshot;
  } finally {
    clearTimeout(timeout);
  }
}

function percentileValue(samples: number[], percentile: number): number | null {
  if (samples.length === 0) {
    return null;
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentile * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

export function summarizeDurationSamples(
  samples: number[],
): TimingDistribution {
  if (samples.length === 0) {
    return {
      count: 0,
      maxMs: null,
      meanMs: null,
      minMs: null,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
    };
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const total = sorted.reduce((sum, current) => sum + current, 0);
  return {
    count: sorted.length,
    maxMs: sorted.at(-1) ?? null,
    meanMs: total / sorted.length,
    minMs: sorted[0] ?? null,
    p50Ms: percentileValue(sorted, 0.5),
    p95Ms: percentileValue(sorted, 0.95),
    p99Ms: percentileValue(sorted, 0.99),
  };
}

function appendDurationSample(
  record: Record<string, number[]>,
  label: string,
  durationMs: number,
): void {
  const samples = record[label] ?? [];
  samples.push(durationMs);
  record[label] = samples;
}

function summarizeDurationRecord(
  record: Record<string, number[]>,
): Record<string, TimingDistribution> {
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, samples]) => [label, summarizeDurationSamples(samples)]),
  );
}

function summarizeTimedResultsByLabel(
  results: TimedResult[],
): Record<string, TimingDistribution> {
  const samplesByLabel: Record<string, number[]> = {};
  for (const result of results) {
    appendDurationSample(samplesByLabel, result.label, result.durationMs);
  }
  return summarizeDurationRecord(samplesByLabel);
}

function formatDuration(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(1)}ms`;
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatMemoryUsage(
  memoryUsage: RuntimeDiagnosticsSnapshot["memoryUsage"],
): string {
  return [
    `rss ${formatBytes(memoryUsage.rss)}`,
    `heapUsed ${formatBytes(memoryUsage.heapUsed)}`,
    `heapTotal ${formatBytes(memoryUsage.heapTotal)}`,
    `external ${formatBytes(memoryUsage.external)}`,
  ].join(", ");
}

/**
 * Compose default websocket URL from port.
 * @param port - HTTP server port used by the harness.
 */
function websocketUrlFromPort(port: number): string {
  return `ws://127.0.0.1:${port}/rpc`;
}

/**
 * Parse rpcWebSocketUrl from runtime config when available.
 * @param value - Input value.
 */
function readRpcWebSocketUrl(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  if (!("rpcWebSocketUrl" in value)) {
    return null;
  }
  return typeof value.rpcWebSocketUrl === "string"
    ? value.rpcWebSocketUrl
    : null;
}

/**
 * Extract the injected runtime config from the main HTML page.
 * @param html - HTML content generated for the test page.
 */
function readRuntimeConfigFromHtml(html: string): unknown {
  const match = html.match(/window\.__metidosRuntime=(\{.+?\});<\/script>/s);
  if (!match) {
    return null;
  }
  const runtimeJson = match[1];
  if (!runtimeJson) {
    return null;
  }

  try {
    return JSON.parse(runtimeJson);
  } catch {
    return null;
  }
}

/**
 * Read the public app HTML and try to discover rpcWebSocketUrl.
 */

async function discoverRpcUrl(
  baseUrl: string,
  timeoutMs: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("RPC discovery timed out."));
  }, timeoutMs);

  try {
    const response = await fetch(baseUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }

    return readRpcWebSocketUrl(
      readRuntimeConfigFromHtml(await response.text()),
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolve RPC websocket URL from explicit input, port, or injected runtime discovery.
 */

async function resolveRpcUrl(
  baseUrl: string,
  options: HarnessOptions,
): Promise<string> {
  if (options.rpcUrl) {
    return options.rpcUrl;
  }
  if (typeof options.rpcPort === "number") {
    return websocketUrlFromPort(options.rpcPort);
  }
  const discovered = await discoverRpcUrl(baseUrl, options.httpBudgetMs);
  return discovered ?? websocketUrlFromPort(options.port);
}

/**
 * Combine per-worker pressure counts.
 * @param results - Per-run results collected during the test.
 */
export function summarizePressure(results: PressureSummary[]): PressureSummary {
  const summary: PressureSummary = {
    abortedCount: 0,
    completedCount: 0,
    failedCount: 0,
    failureCountByLabel: {},
    timingsByLabel: {},
  };

  for (const current of results) {
    summary.abortedCount += current.abortedCount;
    summary.completedCount += current.completedCount;
    summary.failedCount += current.failedCount;

    for (const [label, count] of Object.entries(current.failureCountByLabel)) {
      summary.failureCountByLabel[label] =
        (summary.failureCountByLabel[label] ?? 0) + count;
    }
    for (const [label, samples] of Object.entries(current.timingsByLabel)) {
      for (const durationMs of samples) {
        appendDurationSample(summary.timingsByLabel, label, durationMs);
      }
    }
  }

  return summary;
}

function sortNumberRecord(
  record: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function buildHarnessReport(options: {
  baseUrl: string;
  context: HarnessContext;
  diagnostics: {
    afterPressure: RuntimeDiagnosticsSnapshot;
    afterWarmup: RuntimeDiagnosticsSnapshot;
    beforeWarmup: RuntimeDiagnosticsSnapshot;
  };
  pass: boolean;
  pressure: PressureSummary;
  rpcUrl: string;
  startup: StartupSummary;
  startupBudgets: {
    httpBudgetMs: number;
    rpcBudgetMs: number;
    startupBudgetMs: number;
  };
}): HarnessReport {
  return {
    budgets: {
      ...options.startupBudgets,
    },
    diagnostics: options.diagnostics,
    latency: {
      pressureRpcByLabel: summarizeDurationRecord(
        options.pressure.timingsByLabel,
      ),
      startupHttpByLabel: summarizeTimedResultsByLabel(options.startup.http),
      startupRpcByLabel: summarizeTimedResultsByLabel(options.startup.rpc),
    },
    pass: options.pass,
    pressure: {
      abortedCount: options.pressure.abortedCount,
      completedCount: options.pressure.completedCount,
      failedCount: options.pressure.failedCount,
      failureCountByLabel: sortNumberRecord(
        options.pressure.failureCountByLabel,
      ),
    },
    startup: options.startup,
    target: {
      projectId: options.context.project.id,
      projectName: options.context.project.name,
      publicUrl: options.baseUrl,
      rpcUrl: options.rpcUrl,
      worktreePath: options.context.worktree.path,
    },
  };
}

function printTimingDistributionSection(
  title: string,
  distributions: Record<string, TimingDistribution>,
): void {
  console.log(title);
  const entries = Object.entries(distributions);
  if (entries.length === 0) {
    console.log("  (no samples)");
    console.log("");
    return;
  }

  for (const [label, distribution] of entries) {
    console.log(
      `  ${label}: n=${distribution.count} min=${formatDuration(distribution.minMs)} p50=${formatDuration(distribution.p50Ms)} p95=${formatDuration(distribution.p95Ms)} p99=${formatDuration(distribution.p99Ms)} max=${formatDuration(distribution.maxMs)} mean=${formatDuration(distribution.meanMs)}`,
    );
  }
  console.log("");
}

function printHarnessReport(
  report: HarnessReport,
  options: HarnessOptions,
): void {
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("Target");
  console.log(`  public: ${report.target.publicUrl}`);
  console.log(`  rpc: ${report.target.rpcUrl}`);
  console.log(
    `  project: ${report.target.projectName} (#${report.target.projectId})`,
  );
  console.log(`  worktree: ${report.target.worktreePath}`);
  console.log("");

  console.log("Startup HTTP");
  for (const result of report.startup.http) {
    console.log(
      `  ${result.label}: ${result.durationMs.toFixed(1)}ms (${result.status})`,
    );
  }
  console.log("");

  console.log("Startup RPC");
  for (const result of report.startup.rpc) {
    console.log(
      `  ${result.label}: ${result.durationMs.toFixed(1)}ms (${result.status})`,
    );
  }
  console.log("");

  console.log("Pressure");
  console.log(`  completed loops: ${report.pressure.completedCount}`);
  console.log(`  aborted loops: ${report.pressure.abortedCount}`);
  console.log(`  failed loops: ${report.pressure.failedCount}`);
  if (Object.keys(report.pressure.failureCountByLabel).length > 0) {
    console.log("  failures by label:");
    for (const [label, count] of Object.entries(
      report.pressure.failureCountByLabel,
    )) {
      console.log(`    ${label}: ${count}`);
    }
  }
  console.log("");

  console.log(
    `Startup total: ${report.startup.totalDurationMs.toFixed(1)}ms (budget ${report.budgets.startupBudgetMs}ms)`,
  );
  console.log(`Pass: ${report.pass ? "yes" : "no"}`);
  console.log("");

  printTimingDistributionSection(
    "Startup HTTP percentiles",
    report.latency.startupHttpByLabel,
  );
  printTimingDistributionSection(
    "Startup RPC percentiles",
    report.latency.startupRpcByLabel,
  );
  printTimingDistributionSection(
    "Pressure RPC percentiles",
    report.latency.pressureRpcByLabel,
  );

  console.log("Memory snapshots");
  console.log(
    `  before warmup: ${formatMemoryUsage(report.diagnostics.beforeWarmup.memoryUsage)}`,
  );
  console.log(
    `  after warmup: ${formatMemoryUsage(report.diagnostics.afterWarmup.memoryUsage)}`,
  );
  console.log(
    `  after pressure: ${formatMemoryUsage(report.diagnostics.afterPressure.memoryUsage)}`,
  );
  console.log("");

  const runtimeStatsSummary =
    report.diagnostics.afterPressure.runtimeStatsSummary;
  console.log("Runtime stats summary");
  console.log(
    `  rpc: calls=${runtimeStatsSummary.rpc.calls} succeeded=${runtimeStatsSummary.rpc.succeeded} failed=${runtimeStatsSummary.rpc.failed} timedOut=${runtimeStatsSummary.rpc.timedOut} canceled=${runtimeStatsSummary.rpc.canceled} methods=${runtimeStatsSummary.rpc.methodCount} requestBytes=${formatBytes(runtimeStatsSummary.rpc.requestBytes)} responseBytes=${formatBytes(runtimeStatsSummary.rpc.responseBytes)} peak=${formatDuration(runtimeStatsSummary.rpc.peakDurationMs)}`,
  );
  console.log(
    `  websocket pushes: messages=${runtimeStatsSummary.websocketPush.messages} types=${runtimeStatsSummary.websocketPush.typeCount} deliveredClients=${runtimeStatsSummary.websocketPush.deliveredClients} droppedClients=${runtimeStatsSummary.websocketPush.droppedClients} bytes=${formatBytes(runtimeStatsSummary.websocketPush.payloadBytes)}`,
  );
  console.log(
    `  sqlite retry: loopsWithRetry=${runtimeStatsSummary.sqliteRetry.loopsWithRetry} totalRetries=${runtimeStatsSummary.sqliteRetry.totalRetries} exhausted=${runtimeStatsSummary.sqliteRetry.exhaustedLoops} peakRetryCount=${runtimeStatsSummary.sqliteRetry.peakRetryCount} totalBackoff=${formatDuration(runtimeStatsSummary.sqliteRetry.totalBackoffMs)}`,
  );
  console.log(
    `  git history cache: rangeHits=${runtimeStatsSummary.gitCache.historyPage.cacheRangeHit} fetches=${runtimeStatsSummary.gitCache.historyPage.fetches} prefetchWaits=${runtimeStatsSummary.gitCache.historyPage.prefetchWaits} preemptions=${runtimeStatsSummary.gitCache.historyPage.preemptions}`,
  );
  console.log(
    `  git commit diff cache: hits=${runtimeStatsSummary.gitCache.commitDiff.hits} misses=${runtimeStatsSummary.gitCache.commitDiff.misses} pendingReuse=${runtimeStatsSummary.gitCache.commitDiff.pendingReuse} stores=${runtimeStatsSummary.gitCache.commitDiff.stores}`,
  );
}

/**
 * Evaluate whether startup meets configured latency budgets.
 */

function didStartupPass(
  startup: StartupSummary,
  options: HarnessOptions,
): boolean {
  const httpOk = startup.http.every(
    (result) => result.ok && result.durationMs <= options.httpBudgetMs,
  );
  const rpcOk = startup.rpc.every(
    (result) => result.ok && result.durationMs <= options.rpcBudgetMs,
  );
  return httpOk && rpcOk && startup.totalDurationMs <= options.startupBudgetMs;
}

/**
 * End-to-end harness flow: setup, warmup, pressure, startup probe, cleanup.
 */

async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const baseUrl = `http://127.0.0.1:${options.port}`;
  const rpcUrl = await resolveRpcUrl(baseUrl, options);
  const controlClient = new RpcHarnessClient(rpcUrl);
  const pressureClient = new RpcHarnessClient(rpcUrl);
  const startupClient = new RpcHarnessClient(rpcUrl);
  const stopPressureController = new AbortController();

  try {
    const context = await ensureHarnessContext(controlClient, options);
    const beforeWarmup = await readRuntimeDiagnostics(
      baseUrl,
      options.httpBudgetMs,
      {
        reset: true,
      },
    );

    const pressureWorkers = Array.from({ length: options.workers }, () =>
      runPressureWorker(
        pressureClient,
        context,
        options,
        stopPressureController.signal,
      ),
    );
    if (options.warmupMs > 0) {
      await sleep(options.warmupMs);
    }
    const afterWarmup = await readRuntimeDiagnostics(
      baseUrl,
      options.httpBudgetMs,
    );

    const startup = await measureStartupSequence(
      startupClient,
      baseUrl,
      context,
      options,
    );
    stopPressureController.abort();
    const pressure = summarizePressure(await Promise.all(pressureWorkers));
    const afterPressure = await readRuntimeDiagnostics(
      baseUrl,
      options.httpBudgetMs,
    );
    const pass = didStartupPass(startup, options);
    const report = buildHarnessReport({
      baseUrl,
      context,
      diagnostics: {
        afterPressure,
        afterWarmup,
        beforeWarmup,
      },
      pass,
      pressure,
      rpcUrl,
      startup,
      startupBudgets: {
        httpBudgetMs: options.httpBudgetMs,
        rpcBudgetMs: options.rpcBudgetMs,
        startupBudgetMs: options.startupBudgetMs,
      },
    });
    printHarnessReport(report, options);

    await cleanupHarness(controlClient, context);

    if (!pass) {
      process.exitCode = 1;
    }
  } finally {
    stopPressureController.abort();
    controlClient.close();
    pressureClient.close();
    startupClient.close();
  }
}

if (import.meta.main) {
  await main();
}
