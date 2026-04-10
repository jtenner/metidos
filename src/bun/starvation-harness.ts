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

/**
 * Names of RPC methods available to the harness.
 */

type RpcMethodName = keyof AppRPCSchema["requests"];

/**
 * Parsed command-line options and effective configuration for a run.
 */

type HarnessOptions = {
  durationMs: number;
  help: boolean;
  httpBudgetMs: number;
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

type StartupSummary = {
  http: HttpTimedResult[];
  rpc: TimedResult[];
  totalDurationMs: number;
};

type PressureSummary = {
  abortedCount: number;
  completedCount: number;
  failedCount: number;
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

function parseArgs(argv: string[]): HarnessOptions {
  const options: HarnessOptions = {
    durationMs: DEFAULT_DURATION_MS,
    help: false,
    httpBudgetMs: DEFAULT_HTTP_BUDGET_MS,
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
 * Measure duration of an async callback.
 */

async function timed<T>(
  _label: string,
  callback: () => Promise<T>,
): Promise<{ durationMs: number; value: T }> {
  const startedAt = performance.now();
  const value = await callback();
  return {
    durationMs: Math.max(0, performance.now() - startedAt),
    value,
  };
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
  try {
    const { durationMs, value } = await timed(label, () =>
      client.call(method, params, options),
    );
    return {
      result: value,
      timing: {
        durationMs,
        label,
        ok: true,
        status: "ok",
      },
    };
  } catch (error) {
    return {
      result: null,
      timing: {
        durationMs: 0,
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
  };

  while (!stopSignal.aborted) {
    try {
      const opened = await client.call(
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
      if (opened.history.entries[0]) {
        await client.call(
          "getWorktreeGitCommitDiff",
          {
            commitHash: opened.history.entries[0].hash,
            projectId: context.project.id,
            worktreePath: context.worktree.path,
          },
          {
            priority: "background",
            timeoutMs: options.rpcBudgetMs,
          },
        );
      }
      await client.call(
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
function summarizePressure(results: PressureSummary[]): PressureSummary {
  return results.reduce(
    (summary, current) => ({
      abortedCount: summary.abortedCount + current.abortedCount,
      completedCount: summary.completedCount + current.completedCount,
      failedCount: summary.failedCount + current.failedCount,
    }),
    {
      abortedCount: 0,
      completedCount: 0,
      failedCount: 0,
    } satisfies PressureSummary,
  );
}

/**
 * Print structured startup and pressure summary lines to stdout.
 */

function printStartupSummary(
  startup: StartupSummary,
  pressure: PressureSummary,
  context: HarnessContext,
  options: HarnessOptions,
  baseUrl: string,
  rpcUrl: string,
): void {
  console.log("Target");
  console.log(`  public: ${baseUrl}`);
  console.log(`  rpc: ${rpcUrl}`);
  console.log(`  project: ${context.project.name} (#${context.project.id})`);
  console.log(`  worktree: ${context.worktree.path}`);
  console.log("");
  console.log("HTTP");
  for (const result of startup.http) {
    console.log(
      `  ${result.label}: ${result.durationMs.toFixed(1)}ms (${result.status})`,
    );
  }
  console.log("");
  console.log("RPC");
  for (const result of startup.rpc) {
    console.log(
      `  ${result.label}: ${result.durationMs.toFixed(1)}ms (${result.status})`,
    );
  }
  console.log("");
  console.log("Pressure");
  console.log(`  workers: ${options.workers}`);
  console.log(`  completed loops: ${pressure.completedCount}`);
  console.log(`  aborted loops: ${pressure.abortedCount}`);
  console.log(`  failed loops: ${pressure.failedCount}`);
  console.log("");
  console.log(
    `Startup total: ${startup.totalDurationMs.toFixed(1)}ms (budget ${options.startupBudgetMs}ms)`,
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

    const startup = await measureStartupSequence(
      startupClient,
      baseUrl,
      context,
      options,
    );
    stopPressureController.abort();
    const pressure = summarizePressure(await Promise.all(pressureWorkers));
    printStartupSummary(startup, pressure, context, options, baseUrl, rpcUrl);

    await cleanupHarness(controlClient, context);

    if (!didStartupPass(startup, options)) {
      process.exitCode = 1;
    }
  } finally {
    stopPressureController.abort();
    controlClient.close();
    pressureClient.close();
    startupClient.close();
  }
}

await main();
