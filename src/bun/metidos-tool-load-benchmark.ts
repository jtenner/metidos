/**
 * @file src/bun/metidos-tool-load-benchmark.ts
 * @description Repeatable synthetic benchmark for bounded Metidos tool paths.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import {
  createPiMetidosTools,
  type PiMetidosToolHost,
} from "./pi-metidos-tools";
import {
  type PiMetidosToolScope,
  resetMetidosToolBudgets,
  textToolResult,
  withMetidosToolTelemetry,
} from "./pi-metidos-tools-shared";
import type {
  RpcContextFocusChanged,
  RpcCronJob,
  RpcInitTaskGraphResult,
  RpcNormalizeTaskGraphResult,
  RpcProject,
  RpcThread,
  RpcThreadDetail,
  RpcThreadStartRequest,
  RpcValidateTaskGraphResult,
  RpcWorktree,
} from "./rpc-schema";
import {
  getRuntimeStatsSummary,
  type RuntimeStatsSummary,
  recordMetidosSandboxRun,
  resetRuntimeStats,
} from "./runtime-stats";
import {
  summarizeDurationSamples,
  type TimingDistribution,
} from "./starvation-harness";

const DEFAULT_BENCHMARK_CONCURRENCY = 4;
const DEFAULT_BENCHMARK_HOLD_MS = 20;
const DEFAULT_BENCHMARK_ITERATIONS = 12;
const BENCHMARK_PROJECT_ID = 7;
const BENCHMARK_THREAD_ID = 11;
const BENCHMARK_WORKTREE_PATH = "/repo/alpha/feature-a";
const BENCHMARK_PROJECT_PATH = "/repo/alpha";
const BENCHMARK_REFERENCE_TIME = "2026-04-12T20:30:00.000Z";
const BENCHMARK_CRON_CREATED_AT = "2026-04-12T20:31:00.000Z";
const BENCHMARK_CRON_UPDATED_AT = "2026-04-12T20:45:00.000Z";
const BENCHMARK_THREAD_CREATED_AT = "2026-04-12T20:32:00.000Z";
const BENCHMARK_THREAD_UPDATED_AT = "2026-04-12T20:45:00.000Z";
const BENCHMARK_THREAD_LAST_RUN_AT = "2026-04-12T20:46:00.000Z";
const BENCHMARK_NEW_CRON_SCHEDULE = "15 6 13 4 *";
const BENCHMARK_UPDATED_CRON_SCHEDULE = "45 18 14 4 *";
const BENCHMARK_NEW_CRON_NEXT_RUN_AT = "2026-04-13T06:15:00.000Z";
const BENCHMARK_UPDATED_CRON_NEXT_RUN_AT = "2026-04-14T18:45:00.000Z";

type BenchmarkScenarioName =
  | "new_thread_safe"
  | "new_thread_unsafe"
  | "new_cron_safe"
  | "new_cron_unsafe"
  | "update_cron_safe"
  | "update_cron_unsafe"
  | "run_untrusted_js";

type BenchmarkScenarioFamily =
  | "new_thread"
  | "new_cron"
  | "update_cron"
  | "run_untrusted_js";

type BenchmarkScenarioDefinition = {
  family: BenchmarkScenarioFamily;
  name: BenchmarkScenarioName;
  schedule: string | null;
  toolName: string;
  unsafeMode: boolean;
};

export type MetidosToolLoadBenchmarkOptions = {
  concurrency: number;
  help: boolean;
  holdMs: number;
  iterations: number;
  json: boolean;
};

export type MetidosToolLoadBenchmarkComparison = {
  family: Exclude<BenchmarkScenarioFamily, "run_untrusted_js">;
  safeCompleted: number;
  safeFailed: number;
  safeSaturationCount: number;
  safeScenario: BenchmarkScenarioName;
  unsafeCompleted: number;
  unsafeFailed: number;
  unsafeSaturationCount: number;
  unsafeScenario: BenchmarkScenarioName;
};

export type MetidosToolLoadBenchmarkScenarioReport = {
  attempts: number;
  completed: number;
  failed: number;
  failureCountByLabel: Record<string, number>;
  family: BenchmarkScenarioFamily;
  latency: TimingDistribution;
  metidosTools: RuntimeStatsSummary["metidosTools"];
  name: BenchmarkScenarioName;
  referenceTime: string;
  saturationCount: number;
  schedule: string | null;
  toolName: string;
  unsafeMode: boolean;
};

export type MetidosToolLoadBenchmarkReport = {
  collectedAt: string;
  comparisons: MetidosToolLoadBenchmarkComparison[];
  options: {
    concurrency: number;
    holdMs: number;
    iterations: number;
  };
  referenceTime: string;
  scenarios: MetidosToolLoadBenchmarkScenarioReport[];
};

const BENCHMARK_SCENARIOS: readonly BenchmarkScenarioDefinition[] = [
  {
    family: "new_thread",
    name: "new_thread_safe",
    schedule: null,
    toolName: "new_thread",
    unsafeMode: false,
  },
  {
    family: "new_thread",
    name: "new_thread_unsafe",
    schedule: null,
    toolName: "new_thread",
    unsafeMode: true,
  },
  {
    family: "new_cron",
    name: "new_cron_safe",
    schedule: BENCHMARK_NEW_CRON_SCHEDULE,
    toolName: "new_cron",
    unsafeMode: false,
  },
  {
    family: "new_cron",
    name: "new_cron_unsafe",
    schedule: BENCHMARK_NEW_CRON_SCHEDULE,
    toolName: "new_cron",
    unsafeMode: true,
  },
  {
    family: "update_cron",
    name: "update_cron_safe",
    schedule: BENCHMARK_UPDATED_CRON_SCHEDULE,
    toolName: "update_cron",
    unsafeMode: false,
  },
  {
    family: "update_cron",
    name: "update_cron_unsafe",
    schedule: BENCHMARK_UPDATED_CRON_SCHEDULE,
    toolName: "update_cron",
    unsafeMode: true,
  },
  {
    family: "run_untrusted_js",
    name: "run_untrusted_js",
    schedule: null,
    toolName: "run_untrusted_js",
    unsafeMode: false,
  },
] as const;

function parseIntegerOption(
  flag: string,
  value: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${flag} must be an integer.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < min || parsed > max) {
    throw new Error(`${flag} must be between ${min} and ${max}.`);
  }
  return parsed;
}

export function parseArgs(argv: string[]): MetidosToolLoadBenchmarkOptions {
  const options: MetidosToolLoadBenchmarkOptions = {
    concurrency: DEFAULT_BENCHMARK_CONCURRENCY,
    help: false,
    holdMs: DEFAULT_BENCHMARK_HOLD_MS,
    iterations: DEFAULT_BENCHMARK_ITERATIONS,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (typeof arg !== "string" || !arg.startsWith("--")) {
      continue;
    }
    const [flag, inlineValue] = arg.split("=", 2);
    const consumeNext = typeof inlineValue !== "string";
    const nextValue =
      typeof inlineValue === "string" ? inlineValue : argv[index + 1];
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
      case "--concurrency":
        options.concurrency = parseIntegerOption(flag, readValue(), 1);
        break;
      case "--hold-ms":
        options.holdMs = parseIntegerOption(flag, readValue(), 1);
        break;
      case "--iterations":
        options.iterations = parseIntegerOption(flag, readValue(), 1);
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`Usage: bun run src/bun/metidos-tool-load-benchmark.ts [options]

Options:
  --concurrency <count>         Concurrent benchmark workers. Default: ${DEFAULT_BENCHMARK_CONCURRENCY}
  --hold-ms <ms>                Synthetic host/tool hold duration. Default: ${DEFAULT_BENCHMARK_HOLD_MS}
  --iterations <count>          Attempts per scenario. Default: ${DEFAULT_BENCHMARK_ITERATIONS}
  --json                        Emit a structured JSON report instead of plain text.
  --help                        Show this help text.
`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeErrorLabel(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return String(error);
}

function sortNumberRecord(
  record: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function buildScope(unsafeModeAllowed: boolean): PiMetidosToolScope {
  return {
    allowUnsafeModeEscalation: unsafeModeAllowed,
    projectIdContext: BENCHMARK_PROJECT_ID,
    threadIdContext: BENCHMARK_THREAD_ID,
    worktreePathContext: BENCHMARK_WORKTREE_PATH,
  };
}

function makeProject(): RpcProject {
  return {
    createdAt: BENCHMARK_REFERENCE_TIME,
    id: BENCHMARK_PROJECT_ID,
    isOpen: 1,
    lastOpenedAt: BENCHMARK_REFERENCE_TIME,
    name: "Alpha",
    path: BENCHMARK_PROJECT_PATH,
    updatedAt: BENCHMARK_REFERENCE_TIME,
  };
}

function makeWorktree(): RpcWorktree {
  return {
    bare: false,
    branch: "feature-a",
    head: "abc123",
    path: BENCHMARK_WORKTREE_PATH,
    pinnedAt: null,
  };
}

function makeThread(input?: Partial<RpcThread>): RpcThread {
  return {
    agentsAccess: false,
    compaction: {
      estimatedTriggerSource: "heuristic",
      estimatedTriggerTokens: 1000,
      inferredCount: 0,
      lastInferredAfterInputTokens: null,
      lastInferredAt: null,
      lastInferredBeforeInputTokens: null,
      maxObservedInputTokens: null,
    },
    createdAt: BENCHMARK_THREAD_CREATED_AT,
    githubAccess: false,
    id: BENCHMARK_THREAD_ID,
    lastRunAt: BENCHMARK_THREAD_LAST_RUN_AT,
    metidosAccess: true,
    model: "openai:gpt-5.4",
    piLeafEntryId: null,
    piSessionFile: null,
    piSessionId: null,
    pinnedAt: null,
    projectId: BENCHMARK_PROJECT_ID,
    reasoningEffort: "medium",
    runStatus: {
      error: null,
      hasUnreadError: false,
      startedAt: BENCHMARK_THREAD_REFERENCE_STARTED_AT,
      state: "working",
      updatedAt: BENCHMARK_THREAD_UPDATED_AT,
    },
    summary: null,
    title: "Benchmark Thread",
    unsafeMode: false,
    updatedAt: BENCHMARK_THREAD_UPDATED_AT,
    usage: null,
    webSearchAccess: true,
    worktreePath: BENCHMARK_WORKTREE_PATH,
    ...input,
  };
}

const BENCHMARK_THREAD_REFERENCE_STARTED_AT = "2026-04-12T20:46:00.000Z";

function makeThreadDetail(input?: Partial<RpcThreadDetail>): RpcThreadDetail {
  return {
    messages: [],
    nextCursor: null,
    thread: makeThread(),
    ...input,
  };
}

function makeCron(input?: Partial<RpcCronJob>): RpcCronJob {
  return {
    agentsAccess: false,
    createdAt: BENCHMARK_CRON_CREATED_AT,
    deletedAt: null,
    description: "Benchmark cron",
    enabled: 1,
    githubAccess: false,
    id: 1,
    lastRunDate: Date.parse(BENCHMARK_REFERENCE_TIME),
    lastRunStatus: "Completed",
    metidosAccess: true,
    model: "openai:gpt-5.4",
    nextRunDate: Date.parse(BENCHMARK_NEW_CRON_NEXT_RUN_AT),
    projectId: BENCHMARK_PROJECT_ID,
    prompt: "Benchmark prompt",
    reasoningEffort: "medium",
    schedule: BENCHMARK_NEW_CRON_SCHEDULE,
    title: "Benchmark cron",
    unsafeMode: false,
    updatedAt: BENCHMARK_CRON_UPDATED_AT,
    webSearchAccess: true,
    worktreePath: BENCHMARK_WORKTREE_PATH,
    ...input,
  };
}

function makeThreadStartRequest(): RpcThreadStartRequest {
  return {
    agentsAccess: false,
    autoStart: false,
    createdAt: BENCHMARK_REFERENCE_TIME,
    githubAccess: false,
    input: "Benchmark prompt",
    metidosAccess: true,
    model: "openai:gpt-5.4",
    pinned: null,
    pinnedAt: null,
    projectId: BENCHMARK_PROJECT_ID,
    projectPath: BENCHMARK_PROJECT_PATH,
    reasoningEffort: "medium",
    requestId: "benchmark-request",
    summary: null,
    threadId: null,
    title: null,
    unsafeMode: false,
    webSearchAccess: true,
    worktreePath: BENCHMARK_WORKTREE_PATH,
  };
}

function makeInitTaskGraphResult(): RpcInitTaskGraphResult {
  return {
    config: {
      bodyFormat: "markdown",
      defaults: {
        priority: "p2",
        status: "open",
        type: "task",
      },
      idPrefix: "tg",
      schema: "metidos.task-graph/v2",
      strictTags: false,
      strictTypes: false,
    },
    paths: {
      config: `${BENCHMARK_WORKTREE_PATH}/.metidos/tasks/config.toml`,
      items: `${BENCHMARK_WORKTREE_PATH}/.metidos/tasks/items`,
      root: `${BENCHMARK_WORKTREE_PATH}/.metidos/tasks`,
      tags: null,
      types: null,
    },
    status: {
      config: "existing",
      items: "existing",
      root: "existing",
      tags: "skipped",
      types: "skipped",
    },
  };
}

function makeValidateTaskGraphResult(): RpcValidateTaskGraphResult {
  return {
    errors: [],
    findings: [],
    ok: true,
    root: `${BENCHMARK_WORKTREE_PATH}/.metidos/tasks`,
    validatedTaskIds: [],
    warnings: [],
  };
}

function makeNormalizeTaskGraphResult(): RpcNormalizeTaskGraphResult {
  return {
    changedFiles: [],
    normalizedTaskIds: [],
    root: `${BENCHMARK_WORKTREE_PATH}/.metidos/tasks`,
    unchangedFiles: [],
  };
}

function createBenchmarkHost(holdMs: number): PiMetidosToolHost {
  let nextThreadId = 100;
  let nextCronId = 200;

  return {
    capabilities: {
      taskGraphAdmin: false,
    },
    createThread: async (params) => {
      await delay(holdMs);
      nextThreadId += 1;
      return makeThreadDetail({
        thread: makeThread({
          id: nextThreadId,
          projectId: params.projectId,
          unsafeMode: params.unsafeMode ?? false,
          worktreePath: params.worktreePath,
        }),
      });
    },
    focusContext: async () => {
      await delay(holdMs);
      return {
        projectId: BENCHMARK_PROJECT_ID,
        projectName: "Alpha",
        projectPath: BENCHMARK_PROJECT_PATH,
        threadId: null,
        worktreePath: BENCHMARK_WORKTREE_PATH,
      } satisfies RpcContextFocusChanged;
    },
    initTaskGraph: async () => {
      await delay(holdMs);
      return makeInitTaskGraphResult();
    },
    listCrons: async () => {
      await delay(holdMs);
      return [makeCron()];
    },
    listProjects: async () => {
      await delay(holdMs);
      return [makeProject()];
    },
    listProjectWorktrees: async () => {
      await delay(holdMs);
      return [makeWorktree()];
    },
    listThreads: async () => {
      await delay(holdMs);
      return [makeThread()];
    },
    newCron: async (params) => {
      await delay(holdMs);
      nextCronId += 1;
      return makeCron({
        description: params.description ?? "Benchmark cron",
        id: nextCronId,
        nextRunDate: Date.parse(BENCHMARK_NEW_CRON_NEXT_RUN_AT),
        prompt: params.prompt,
        schedule: params.schedule,
        title: params.title ?? "Benchmark cron",
        unsafeMode: params.unsafeMode ?? false,
        worktreePath: params.worktreePath,
      });
    },
    normalizeTaskGraph: async () => {
      await delay(holdMs);
      return makeNormalizeTaskGraphResult();
    },
    requestThreadStart: async () => {
      await delay(holdMs);
      return makeThreadStartRequest();
    },
    sendThreadMessage: async (params) => {
      await delay(holdMs);
      return makeThreadDetail({
        thread: makeThread({
          id: params.threadId,
          runStatus: {
            error: null,
            hasUnreadError: false,
            startedAt: BENCHMARK_THREAD_REFERENCE_STARTED_AT,
            state: "working",
            updatedAt: BENCHMARK_THREAD_UPDATED_AT,
          },
          worktreePath: BENCHMARK_WORKTREE_PATH,
        }),
      });
    },
    updateCron: async (params) => {
      await delay(holdMs);
      return makeCron({
        enabled: params.enabled === false ? 0 : 1,
        id: params.cronJobId,
        nextRunDate: Date.parse(BENCHMARK_UPDATED_CRON_NEXT_RUN_AT),
        schedule: params.schedule ?? BENCHMARK_UPDATED_CRON_SCHEDULE,
        title: params.title ?? "Updated benchmark cron",
        unsafeMode: params.unsafeMode ?? false,
        updatedAt: BENCHMARK_CRON_UPDATED_AT,
      });
    },
    updateThreadMetadata: async () => {
      await delay(holdMs);
      return makeThread();
    },
    validateTaskGraph: async () => {
      await delay(holdMs);
      return makeValidateTaskGraphResult();
    },
  };
}

function getTool(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
  toolName: string,
): ToolDefinition {
  const tool = createPiMetidosTools(scope, host).find(
    (entry) => entry.name === toolName,
  );
  if (!tool) {
    throw new Error(`Metidos tool not found for benchmark: ${toolName}`);
  }
  return tool;
}

function createSyntheticSandboxTool(holdMs: number): ToolDefinition {
  return withMetidosToolTelemetry(
    defineTool({
      description: "Synthetic run_untrusted_js benchmark tool",
      execute: async () => {
        await delay(holdMs);
        recordMetidosSandboxRun({
          outcome: "succeeded",
        });
        return textToolResult("Synthetic sandbox benchmark completed.", {
          ok: true,
          timedOut: false,
        });
      },
      label: "Run Untrusted JS",
      name: "run_untrusted_js",
      parameters: Type.Object({}),
    }),
  );
}

async function executeScenarioAttempt(
  scenario: BenchmarkScenarioDefinition,
  options: MetidosToolLoadBenchmarkOptions,
  attemptIndex: number,
): Promise<void> {
  if (scenario.name === "run_untrusted_js") {
    const tool = createSyntheticSandboxTool(options.holdMs);
    await tool.execute(
      `benchmark-${scenario.name}-${attemptIndex}`,
      {},
      undefined,
      async () => {},
      {
        cwd: BENCHMARK_WORKTREE_PATH,
      } as never,
    );
    return;
  }

  const scope = buildScope(scenario.unsafeMode);
  const host = createBenchmarkHost(options.holdMs);
  const tool = getTool(scope, host, scenario.toolName);
  const rawArgs =
    scenario.toolName === "new_thread"
      ? {
          input: `Benchmark prompt ${attemptIndex + 1}`,
          ...(scenario.unsafeMode ? { unsafeMode: true } : {}),
        }
      : scenario.toolName === "new_cron"
        ? {
            prompt: `Benchmark cron prompt ${attemptIndex + 1}`,
            schedule: scenario.schedule ?? BENCHMARK_NEW_CRON_SCHEDULE,
            title: `Benchmark cron ${attemptIndex + 1}`,
            ...(scenario.unsafeMode ? { unsafeMode: true } : {}),
          }
        : {
            cronJobId: 1,
            enabled: attemptIndex % 2 === 0,
            schedule: scenario.schedule ?? BENCHMARK_UPDATED_CRON_SCHEDULE,
            title: `Updated benchmark cron ${attemptIndex + 1}`,
            ...(scenario.unsafeMode ? { unsafeMode: true } : {}),
          };
  const args = tool.prepareArguments ? tool.prepareArguments(rawArgs) : rawArgs;
  await tool.execute(
    `benchmark-${scenario.name}-${attemptIndex}`,
    args as never,
    undefined,
    async () => {},
    {
      cwd: BENCHMARK_WORKTREE_PATH,
    } as never,
  );
}

async function runScenario(
  scenario: BenchmarkScenarioDefinition,
  options: MetidosToolLoadBenchmarkOptions,
): Promise<MetidosToolLoadBenchmarkScenarioReport> {
  resetMetidosToolBudgets();
  resetRuntimeStats();

  let nextAttempt = 0;
  const failureCountByLabel: Record<string, number> = {};
  const timings: number[] = [];
  let completed = 0;
  let failed = 0;
  let saturationCount = 0;
  const workerCount = Math.max(
    1,
    Math.min(options.concurrency, options.iterations),
  );

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const attemptIndex = nextAttempt;
      nextAttempt += 1;
      if (attemptIndex >= options.iterations) {
        return;
      }

      const startedAt = performance.now();
      try {
        await executeScenarioAttempt(scenario, options, attemptIndex);
        timings.push(Math.max(0, performance.now() - startedAt));
        completed += 1;
      } catch (error) {
        failed += 1;
        const label = normalizeErrorLabel(error);
        failureCountByLabel[label] = (failureCountByLabel[label] ?? 0) + 1;
        if (label.includes("saturated")) {
          saturationCount += 1;
        }
      }
    }
  });

  await Promise.all(workers);

  return {
    attempts: options.iterations,
    completed,
    failed,
    failureCountByLabel: sortNumberRecord(failureCountByLabel),
    family: scenario.family,
    latency: summarizeDurationSamples(timings),
    metidosTools: getRuntimeStatsSummary().metidosTools,
    name: scenario.name,
    referenceTime: BENCHMARK_REFERENCE_TIME,
    saturationCount,
    schedule: scenario.schedule,
    toolName: scenario.toolName,
    unsafeMode: scenario.unsafeMode,
  };
}

function buildComparisons(
  scenarios: MetidosToolLoadBenchmarkScenarioReport[],
): MetidosToolLoadBenchmarkComparison[] {
  const byName = new Map(
    scenarios.map((scenario) => [scenario.name, scenario] as const),
  );
  const pairs: Array<
    [
      Exclude<BenchmarkScenarioFamily, "run_untrusted_js">,
      BenchmarkScenarioName,
      BenchmarkScenarioName,
    ]
  > = [
    ["new_thread", "new_thread_safe", "new_thread_unsafe"],
    ["new_cron", "new_cron_safe", "new_cron_unsafe"],
    ["update_cron", "update_cron_safe", "update_cron_unsafe"],
  ];

  return pairs.map(([family, safeName, unsafeName]) => {
    const safeScenario = byName.get(safeName);
    const unsafeScenario = byName.get(unsafeName);
    if (!safeScenario || !unsafeScenario) {
      throw new Error(`Missing benchmark scenario pair for ${family}.`);
    }
    return {
      family,
      safeCompleted: safeScenario.completed,
      safeFailed: safeScenario.failed,
      safeSaturationCount: safeScenario.saturationCount,
      safeScenario: safeScenario.name,
      unsafeCompleted: unsafeScenario.completed,
      unsafeFailed: unsafeScenario.failed,
      unsafeSaturationCount: unsafeScenario.saturationCount,
      unsafeScenario: unsafeScenario.name,
    };
  });
}

export async function runMetidosToolLoadBenchmark(
  options: MetidosToolLoadBenchmarkOptions,
): Promise<MetidosToolLoadBenchmarkReport> {
  const scenarios: MetidosToolLoadBenchmarkScenarioReport[] = [];
  for (const scenario of BENCHMARK_SCENARIOS) {
    scenarios.push(await runScenario(scenario, options));
  }

  return {
    collectedAt: new Date().toISOString(),
    comparisons: buildComparisons(scenarios),
    options: {
      concurrency: options.concurrency,
      holdMs: options.holdMs,
      iterations: options.iterations,
    },
    referenceTime: BENCHMARK_REFERENCE_TIME,
    scenarios,
  };
}

function formatFailureCountByLabel(record: Record<string, number>): string {
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return "none";
  }
  return entries.map(([label, count]) => `${label}: ${count}`).join(", ");
}

function formatBudgetSummary(
  metidosTools: RuntimeStatsSummary["metidosTools"],
): string {
  const budgets = metidosTools.budgets?.byBudget ?? {};
  const entries = Object.entries(budgets);
  if (entries.length === 0) {
    return "none";
  }

  return entries
    .map(
      ([budgetName, budget]) =>
        `${budgetName}=started:${budget.startedCalls},queued:${budget.queuedCalls},completed:${budget.completedCalls},saturation:${budget.saturationEvents},peakActive:${budget.peakActiveCount},peakPending:${budget.peakPendingCount}`,
    )
    .join(" | ");
}

function printReport(
  report: MetidosToolLoadBenchmarkReport,
  options: MetidosToolLoadBenchmarkOptions,
): void {
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("Metidos Tool Load Benchmark");
  console.log(`  collectedAt: ${report.collectedAt}`);
  console.log(`  referenceTime: ${report.referenceTime}`);
  console.log(
    `  iterations=${report.options.iterations} concurrency=${report.options.concurrency} holdMs=${report.options.holdMs}`,
  );
  console.log("");

  for (const scenario of report.scenarios) {
    console.log(`${scenario.name}`);
    console.log(
      `  tool=${scenario.toolName} unsafe=${scenario.unsafeMode ? "yes" : "no"} schedule=${scenario.schedule ?? "n/a"}`,
    );
    console.log(
      `  attempts=${scenario.attempts} completed=${scenario.completed} failed=${scenario.failed} saturations=${scenario.saturationCount}`,
    );
    console.log(
      `  latency: n=${scenario.latency.count} min=${scenario.latency.minMs?.toFixed(1) ?? "n/a"}ms p50=${scenario.latency.p50Ms?.toFixed(1) ?? "n/a"}ms p95=${scenario.latency.p95Ms?.toFixed(1) ?? "n/a"}ms p99=${scenario.latency.p99Ms?.toFixed(1) ?? "n/a"}ms max=${scenario.latency.maxMs?.toFixed(1) ?? "n/a"}ms mean=${scenario.latency.meanMs?.toFixed(1) ?? "n/a"}ms`,
    );
    console.log(
      `  failures: ${formatFailureCountByLabel(scenario.failureCountByLabel)}`,
    );
    console.log(
      `  metidos budgets: ${formatBudgetSummary(scenario.metidosTools)}`,
    );
    console.log("");
  }

  console.log("Safe vs unsafe comparisons");
  for (const comparison of report.comparisons) {
    console.log(
      `  ${comparison.family}: safe completed=${comparison.safeCompleted}, failed=${comparison.safeFailed}, saturation=${comparison.safeSaturationCount}; unsafe completed=${comparison.unsafeCompleted}, failed=${comparison.unsafeFailed}, saturation=${comparison.unsafeSaturationCount}`,
    );
  }
}

if (import.meta.main) {
  const options = parseArgs(Bun.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    printReport(await runMetidosToolLoadBenchmark(options), options);
  }
}
