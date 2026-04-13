import { describe, expect, it } from "bun:test";

import {
  createPiMetidosTools,
  type PiMetidosToolHost,
  type PiMetidosToolScope,
} from "./pi-metidos-tools";
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
  getRuntimeStatsSnapshot,
  getRuntimeStatsSummary,
  resetRuntimeStats,
} from "./runtime-stats";

const NOW = "2026-04-09T12:00:00.000Z";

function makeScope(
  overrides: Partial<PiMetidosToolScope> = {},
): PiMetidosToolScope {
  return {
    allowUnsafeModeEscalation: false,
    projectIdContext: 7,
    threadIdContext: 11,
    worktreePathContext: "/repo/alpha/feature-a",
    ...overrides,
  };
}

function makeProject(input?: Partial<RpcProject>): RpcProject {
  return {
    createdAt: NOW,
    id: 7,
    isOpen: 1,
    lastOpenedAt: NOW,
    name: "Alpha",
    path: "/repo/alpha",
    updatedAt: NOW,
    ...input,
  };
}

function makeWorktree(input?: Partial<RpcWorktree>): RpcWorktree {
  return {
    bare: false,
    branch: "feature-a",
    head: "abc123",
    path: "/repo/alpha/feature-a",
    pinnedAt: null,
    ...input,
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
    createdAt: NOW,
    githubAccess: false,
    id: 11,
    metidosAccess: true,
    lastRunAt: NOW,
    model: "openai:gpt-5.4",
    piLeafEntryId: null,
    piSessionFile: null,
    piSessionId: null,
    pinnedAt: null,
    projectId: 7,
    reasoningEffort: "medium",
    webSearchAccess: true,
    runStatus: {
      error: null,
      hasUnreadError: false,
      startedAt: null,
      state: "idle",
      updatedAt: NOW,
    },
    summary: null,
    title: "Current Thread",
    unsafeMode: false,
    updatedAt: NOW,
    usage: null,
    worktreePath: "/repo/alpha/feature-a",
    ...input,
  };
}

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
    createdAt: NOW,
    deletedAt: null,
    description: "Nightly report",
    enabled: 1,
    githubAccess: false,
    id: 3,
    metidosAccess: true,
    lastRunDate: null,
    lastRunStatus: null,
    model: "openai:gpt-5.4",
    nextRunDate: null,
    projectId: 7,
    prompt: "Summarize changes",
    reasoningEffort: "medium",
    schedule: "0 0 * * *",
    title: "Nightly report",
    unsafeMode: false,
    updatedAt: NOW,
    webSearchAccess: true,
    worktreePath: "/repo/alpha/feature-a",
    ...input,
  };
}

function makeThreadStartRequest(
  input?: Partial<RpcThreadStartRequest>,
): RpcThreadStartRequest {
  return {
    agentsAccess: false,
    autoStart: true,
    createdAt: NOW,
    githubAccess: false,
    input: "Do work",
    metidosAccess: true,
    model: null,
    pinned: null,
    pinnedAt: null,
    projectId: 7,
    projectPath: "/repo/alpha",
    reasoningEffort: null,
    requestId: "req-1",
    summary: null,
    threadId: null,
    title: null,
    unsafeMode: false,
    webSearchAccess: true,
    worktreePath: "/repo/alpha/feature-a",
    ...input,
  };
}

function makeInitTaskGraphResult(
  input?: Partial<RpcInitTaskGraphResult>,
): RpcInitTaskGraphResult {
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
      config: "/repo/alpha/feature-a/.metidos/tasks/config.toml",
      items: "/repo/alpha/feature-a/.metidos/tasks/items",
      root: "/repo/alpha/feature-a/.metidos/tasks",
      tags: null,
      types: null,
    },
    status: {
      config: "created",
      items: "created",
      root: "created",
      tags: "skipped",
      types: "skipped",
    },
    ...input,
  };
}

function makeValidateTaskGraphResult(
  input?: Partial<RpcValidateTaskGraphResult>,
): RpcValidateTaskGraphResult {
  return {
    errors: [],
    findings: [],
    ok: true,
    root: "/repo/alpha/feature-a/.metidos/tasks",
    validatedTaskIds: [
      "tg-01jv6xbw5g7k1n4r6v8x2z5cde",
      "tg-01jv6xcy6h8m2p5s7w9z3b6dfg",
    ],
    warnings: [],
    ...input,
  };
}

function makeNormalizeTaskGraphResult(
  input?: Partial<RpcNormalizeTaskGraphResult>,
): RpcNormalizeTaskGraphResult {
  return {
    changedFiles: [],
    normalizedTaskIds: [
      "tg-01jv6xbw5g7k1n4r6v8x2z5cde",
      "tg-01jv6xcy6h8m2p5s7w9z3b6dfg",
    ],
    root: "/repo/alpha/feature-a/.metidos/tasks",
    unchangedFiles: [],
    ...input,
  };
}

function createHost(
  overrides: Partial<PiMetidosToolHost> = {},
): PiMetidosToolHost {
  return {
    capabilities: {
      taskGraphAdmin: false,
    },
    createThread: async () => makeThreadDetail(),
    focusContext: async () =>
      ({
        projectId: 7,
        projectName: "Alpha",
        projectPath: "/repo/alpha",
        threadId: null,
        worktreePath: "/repo/alpha/feature-a",
      }) satisfies RpcContextFocusChanged,
    listCrons: async () => [],
    listProjectWorktrees: async () => [makeWorktree()],
    listProjects: async () => [makeProject()],
    listThreads: async () => [makeThread()],
    initTaskGraph: async () => makeInitTaskGraphResult(),
    newCron: async () => makeCron(),
    normalizeTaskGraph: async () => makeNormalizeTaskGraphResult(),
    requestThreadStart: async () => makeThreadStartRequest(),
    sendThreadMessage: async () => makeThreadDetail(),
    updateCron: async () => makeCron(),
    updateThreadMetadata: async () => makeThread(),
    validateTaskGraph: async () => makeValidateTaskGraphResult(),
    ...overrides,
  };
}

function getTool(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
  name: string,
) {
  const tool = createPiMetidosTools(scope, host).find(
    (entry) => entry.name === name,
  );
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}

async function executeTool(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
  name: string,
  rawArgs: unknown,
) {
  const tool = getTool(scope, host, name);
  const args = tool.prepareArguments ? tool.prepareArguments(rawArgs) : rawArgs;
  return tool.execute("call-1", args as never, undefined, async () => {}, {
    cwd: scope.worktreePathContext,
  } as never);
}

function resultText(result: Awaited<ReturnType<typeof executeTool>>): string {
  const firstContent = result.content[0];
  if (!firstContent || firstContent.type !== "text") {
    throw new Error("Expected a text tool result.");
  }
  return firstContent.text;
}

function requireValue<T>(value: T): NonNullable<T> {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
  if (value === null || typeof value === "undefined") {
    throw new Error("Expected value to be present.");
  }
  return value as NonNullable<T>;
}

function expectDeepEqual(actual: unknown, expected: unknown): void {
  expect(actual).toEqual(expected);
}

describe("createPiMetidosTools", () => {
  it("updates thread metadata while ignoring in-thread access toggles", async () => {
    const scope = makeScope();
    let receivedParams: Record<string, unknown> | null = null;
    const host = createHost({
      updateThreadMetadata: async (params) => {
        receivedParams = params;
        return makeThread({
          id: 11,
          pinnedAt: NOW,
          summary: "Fresh summary",
          title: "Renamed Thread",
        });
      },
    });

    const result = await executeTool(scope, host, "update_thread", {
      githubAccess: "true",
      pinned: "true",
      summary: " Fresh summary ",
      threadId: "11",
      title: "Renamed Thread",
    });

    expectDeepEqual(requireValue(receivedParams), {
      pinned: true,
      summary: "Fresh summary",
      threadId: 11,
      title: "Renamed Thread",
    });
    expect(resultText(result)).toBe(
      "Updated thread 11. Ignored in-thread access changes.",
    );
    expect(result.details).toEqual({
      ignoredAccessFields: ["githubAccess"],
      pinned: true,
      summary: "Fresh summary",
      threadId: 11,
      title: "Renamed Thread",
    });
  });

  it("lists threads in a resolved project workspace", async () => {
    const scope = makeScope();
    const host = createHost({
      listProjectWorktrees: async ({ projectId }) =>
        projectId === 7
          ? [
              makeWorktree({
                branch: "main",
                path: "/repo/alpha",
              }),
              makeWorktree({
                branch: "feature-a",
                path: "/repo/alpha/feature-a",
              }),
            ]
          : [],
      listThreads: async () => [
        makeThread({
          id: 11,
          pinnedAt: NOW,
          summary: "Implements the runtime",
          title: "Pi Runtime",
          worktreePath: "/repo/alpha/feature-a",
        }),
        makeThread({
          id: 12,
          title: "Wrong Workspace",
          worktreePath: "/repo/alpha",
        }),
        makeThread({
          id: 13,
          projectId: 9,
          title: "Other Project",
          worktreePath: "/repo/other",
        }),
      ],
    });

    const result = await executeTool(scope, host, "list_threads", {
      projectName: "Alpha",
      workspaceName: "feature-a",
    });

    expect(resultText(result)).toContain("Threads for Alpha / feature-a:");
    expect(resultText(result)).toContain(
      "- [11] Pi Runtime (feature-a · /repo/alpha/feature-a) [pinned] - Implements the runtime",
    );
    expect(result.details).toEqual({
      projectId: 7,
      projectName: "Alpha",
      projectPath: "/repo/alpha",
      threads: [
        {
          pinned: true,
          projectId: 7,
          projectName: "Alpha",
          projectPath: "/repo/alpha",
          runState: "idle",
          summary: "Implements the runtime",
          threadId: 11,
          title: "Pi Runtime",
          updatedAt: NOW,
          workspaceName: "feature-a",
          workspacePath: "/repo/alpha/feature-a",
        },
      ],
      workspaceName: "feature-a",
      workspacePath: "/repo/alpha/feature-a",
    });
  });

  it("runs task graph admin tools with structured results when the runtime allows them", async () => {
    const scope = makeScope();
    let initCall: { params: unknown; worktreePath: string } | null = null;
    let validateCall: { params: unknown; worktreePath: string } | null = null;
    let normalizeCall: { params: unknown; worktreePath: string } | null = null;
    const warning = {
      code: "doc_task_without_docs_for",
      field: null,
      message: "Docs tasks should usually declare docs_for links.",
      path: "/repo/alpha/feature-a/.metidos/tasks/items/tg-01jv6xcy6h8m2p5s7w9z3b6dfg/task.toml",
      relatedTaskId: null,
      severity: "warning" as const,
      taskId: "tg-01jv6xcy6h8m2p5s7w9z3b6dfg",
    };
    const host = createHost({
      capabilities: {
        taskGraphAdmin: true,
      },
      initTaskGraph: async (params, worktreePath) => {
        initCall = { params, worktreePath };
        return makeInitTaskGraphResult({
          status: {
            config: "created",
            items: "created",
            root: "existing",
            tags: "created",
            types: "skipped",
          },
        });
      },
      normalizeTaskGraph: async (params, worktreePath) => {
        normalizeCall = { params, worktreePath };
        return makeNormalizeTaskGraphResult({
          changedFiles: [
            {
              changed: true,
              fileKind: "task_toml",
              path: "/repo/alpha/feature-a/.metidos/tasks/items/tg-01jv6xcy6h8m2p5s7w9z3b6dfg/task.toml",
              taskId: "tg-01jv6xcy6h8m2p5s7w9z3b6dfg",
            },
          ],
          normalizedTaskIds: ["tg-01jv6xcy6h8m2p5s7w9z3b6dfg"],
        });
      },
      validateTaskGraph: async (params, worktreePath) => {
        validateCall = { params, worktreePath };
        return makeValidateTaskGraphResult({
          findings: [warning],
          validatedTaskIds: ["tg-01jv6xcy6h8m2p5s7w9z3b6dfg"],
          warnings: [warning],
        });
      },
    });

    const init = await executeTool(scope, host, "init_task_graph", {
      createTagsRegistry: true,
      idPrefix: " tg ",
      strictTypes: true,
    });
    const validate = await executeTool(scope, host, "validate_task_graph", {
      taskIds: ["tg-01jv6xcy6h8m2p5s7w9z3b6dfg"],
    });
    const normalize = await executeTool(scope, host, "normalize_task_graph", {
      taskIds: ["tg-01jv6xcy6h8m2p5s7w9z3b6dfg"],
    });

    expectDeepEqual(requireValue(initCall), {
      params: {
        createTagsRegistry: true,
        idPrefix: "tg",
        strictTypes: true,
      },
      worktreePath: scope.worktreePathContext,
    });
    expect(resultText(init)).toBe(
      "Task graph init finished at /repo/alpha/feature-a/.metidos/tasks (3 created, 1 existing, 1 skipped).",
    );
    expect(init.details).toEqual(
      makeInitTaskGraphResult({
        status: {
          config: "created",
          items: "created",
          root: "existing",
          tags: "created",
          types: "skipped",
        },
      }),
    );

    expectDeepEqual(requireValue(validateCall), {
      params: {
        taskIds: ["tg-01jv6xcy6h8m2p5s7w9z3b6dfg"],
      },
      worktreePath: scope.worktreePathContext,
    });
    expect(resultText(validate)).toBe(
      "Task graph validation completed at /repo/alpha/feature-a/.metidos/tasks with 0 error(s) and 1 warning(s).",
    );
    expect(validate.details).toEqual(
      makeValidateTaskGraphResult({
        findings: [warning],
        validatedTaskIds: ["tg-01jv6xcy6h8m2p5s7w9z3b6dfg"],
        warnings: [warning],
      }),
    );

    expectDeepEqual(requireValue(normalizeCall), {
      params: {
        taskIds: ["tg-01jv6xcy6h8m2p5s7w9z3b6dfg"],
      },
      worktreePath: scope.worktreePathContext,
    });
    expect(resultText(normalize)).toBe(
      "Normalized task graph at /repo/alpha/feature-a/.metidos/tasks; rewrote 1 file(s).",
    );
    expect(normalize.details).toEqual(
      makeNormalizeTaskGraphResult({
        changedFiles: [
          {
            changed: true,
            fileKind: "task_toml",
            path: "/repo/alpha/feature-a/.metidos/tasks/items/tg-01jv6xcy6h8m2p5s7w9z3b6dfg/task.toml",
            taskId: "tg-01jv6xcy6h8m2p5s7w9z3b6dfg",
          },
        ],
        normalizedTaskIds: ["tg-01jv6xcy6h8m2p5s7w9z3b6dfg"],
      }),
    );
  });

  it("blocks task graph admin tools when the runtime policy disables them", async () => {
    const scope = makeScope();
    const host = createHost();

    await expect(
      executeTool(scope, host, "init_task_graph", {}),
    ).rejects.toThrow(
      "Task graph admin tools are disabled for this runtime. This thread cannot initialize, validate, or normalize the repository task graph.",
    );
    await expect(
      executeTool(scope, host, "validate_task_graph", {}),
    ).rejects.toThrow(
      "Task graph admin tools are disabled for this runtime. This thread cannot initialize, validate, or normalize the repository task graph.",
    );
    await expect(
      executeTool(scope, host, "normalize_task_graph", {}),
    ).rejects.toThrow(
      "Task graph admin tools are disabled for this runtime. This thread cannot initialize, validate, or normalize the repository task graph.",
    );
  });

  it("normalizes admin-tool inputs before calling the host", async () => {
    const scope = makeScope();
    let initCall: { params: unknown; worktreePath: string } | null = null;
    let validateCall: { params: unknown; worktreePath: string } | null = null;
    let normalizeCall: { params: unknown; worktreePath: string } | null = null;
    const host = createHost({
      capabilities: {
        taskGraphAdmin: true,
      },
      initTaskGraph: async (params, worktreePath) => {
        initCall = { params, worktreePath };
        return makeInitTaskGraphResult();
      },
      normalizeTaskGraph: async (params, worktreePath) => {
        normalizeCall = { params, worktreePath };
        return makeNormalizeTaskGraphResult();
      },
      validateTaskGraph: async (params, worktreePath) => {
        validateCall = { params, worktreePath };
        return makeValidateTaskGraphResult();
      },
    });

    await executeTool(scope, host, "init_task_graph", {
      idPrefix: "  next-prefix  ",
    });
    await executeTool(scope, host, "validate_task_graph", {
      taskIds: [
        " tg-01jv6xcy6h8m2p5s7w9z3b6dfg ",
        "",
        "tg-01jv6xcy6h8m2p5s7w9z3b6dfg",
        "  tg-01jv6x6kh5z8y4v9m2c3d7pqra",
      ],
    });
    await executeTool(scope, host, "normalize_task_graph", {
      taskIds: [
        "",
        " tg-01jv6x6kh5z8y4v9m2c3d7pqra ",
        "tg-01jv6x6kh5z8y4v9m2c3d7pqra",
      ],
    });

    expectDeepEqual(requireValue(initCall), {
      params: {
        idPrefix: "next-prefix",
      },
      worktreePath: scope.worktreePathContext,
    });
    expectDeepEqual(requireValue(validateCall), {
      params: {
        taskIds: [
          "tg-01jv6xcy6h8m2p5s7w9z3b6dfg",
          "tg-01jv6x6kh5z8y4v9m2c3d7pqra",
        ],
      },
      worktreePath: scope.worktreePathContext,
    });
    expectDeepEqual(requireValue(normalizeCall), {
      params: {
        taskIds: ["tg-01jv6x6kh5z8y4v9m2c3d7pqra"],
      },
      worktreePath: scope.worktreePathContext,
    });

    await expect(
      executeTool(scope, host, "init_task_graph", {
        idPrefix: "   ",
      }),
    ).rejects.toThrow("idPrefix must not be empty.");
  });

  it("focuses the UI context through the direct host callback", async () => {
    const scope = makeScope();
    let focused: Record<string, unknown> | null = null;
    const host = createHost({
      focusContext: async (params) => {
        focused = params;
        return {
          projectId: 7,
          projectName: "Alpha",
          projectPath: "/repo/alpha",
          threadId: null,
          worktreePath: "/repo/alpha/feature-a",
        };
      },
    });

    const result = await executeTool(scope, host, "set_context", {
      project: "Alpha",
      workspace: "feature-a",
    });

    expectDeepEqual(requireValue(focused), {
      projectId: 7,
      worktreePath: "/repo/alpha/feature-a",
    });
    expect(resultText(result)).toBe("Focused Alpha / feature-a.");
    expect(result.details).toEqual({
      projectId: 7,
      projectName: "Alpha",
      projectPath: "/repo/alpha",
      threadId: null,
      worktreePath: "/repo/alpha/feature-a",
    });
  });

  it("creates a start request instead of immediately creating a new thread when autoStart is enabled", async () => {
    const scope = makeScope();
    let requestParams: Record<string, unknown> | null = null;
    const host = createHost({
      requestThreadStart: async (params) => {
        requestParams = params;
        return makeThreadStartRequest({
          input: params.input,
          model: params.model ?? null,
          reasoningEffort: params.reasoningEffort ?? null,
        });
      },
    });

    const result = await executeTool(scope, host, "new_thread", {
      autoStart: "true",
      input: "Do work",
      model: "openai:gpt-5.4",
      reasoningEffort: "high",
    });

    expectDeepEqual(requireValue(requestParams), {
      agentsAccess: null,
      autoStart: true,
      githubAccess: null,
      input: "Do work",
      metidosAccess: null,
      model: "openai:gpt-5.4",
      projectId: 7,
      reasoningEffort: "high",
      unsafeMode: null,
      webSearchAccess: null,
      worktreePath: scope.worktreePathContext,
    });
    expect(resultText(result)).toBe(
      `Requested permission to start a thread for ${scope.worktreePathContext}.`,
    );
    expect(result.details).toEqual({
      agentsAccess: false,
      autoStart: true,
      createdAt: NOW,
      error: null,
      githubAccess: false,
      hasUnreadError: null,
      input: "Do work",
      metidosAccess: true,
      lastRunAt: null,
      model: "openai:gpt-5.4",
      pinned: null,
      pinnedAt: null,
      projectId: 7,
      projectPath: "/repo/alpha",
      reasoningEffort: "high",
      requestId: "req-1",
      runState: null,
      status: null,
      summary: null,
      threadId: null,
      title: null,
      unsafeMode: false,
      webSearchAccess: true,
      worktreePath: "/repo/alpha/feature-a",
    });
  });

  it("creates and starts a new thread immediately when autoStart is not requested", async () => {
    const scope = makeScope({
      allowUnsafeModeEscalation: true,
    });
    let createdParams: Record<string, unknown> | null = null;
    let messageParams: Record<string, unknown> | null = null;
    const host = createHost({
      createThread: async (params) => {
        createdParams = params;
        return makeThreadDetail({
          thread: makeThread({
            id: 44,
            projectId: params.projectId,
            worktreePath: params.worktreePath,
          }),
        });
      },
      sendThreadMessage: async (params) => {
        messageParams = params;
        return makeThreadDetail({
          thread: makeThread({
            id: params.threadId,
            projectId: 7,
            runStatus: {
              error: null,
              hasUnreadError: false,
              startedAt: NOW,
              state: "working",
              updatedAt: NOW,
            },
            worktreePath: scope.worktreePathContext,
          }),
        });
      },
    });

    const result = await executeTool(scope, host, "new_thread", {
      githubAccess: "true",
      input: "Ship it",
      unsafeMode: "true",
    });

    expectDeepEqual(requireValue(createdParams), {
      githubAccess: true,
      projectId: 7,
      unsafeMode: true,
      worktreePath: scope.worktreePathContext,
    });
    expectDeepEqual(requireValue(messageParams), {
      input: "Ship it",
      threadId: 44,
    });
    expect(resultText(result)).toBe("Started thread 44 (Turning).");
    expect(result.details).toMatchObject({
      input: "Ship it",
      projectId: 7,
      runState: "working",
      status: "Turning",
      threadId: 44,
      unsafeMode: true,
      worktreePath: scope.worktreePathContext,
    });
  });

  it("blocks unsafe child thread creation from a safe thread", async () => {
    const scope = makeScope();
    const host = createHost();

    await expect(
      executeTool(scope, host, "new_thread", {
        input: "Ship it",
        unsafeMode: "true",
      }),
    ).rejects.toThrow(
      "Unsafe mode is disabled for the current thread. This thread cannot create or update unsafe child threads or cron jobs.",
    );
  });

  it("creates and updates cron jobs through the direct host callbacks", async () => {
    const scope = makeScope();
    let createdParams: Record<string, unknown> | null = null;
    let updatedParams: Record<string, unknown> | null = null;
    const host = createHost({
      newCron: async (params) => {
        createdParams = params;
        return makeCron({
          description: params.description ?? "Nightly",
          id: 9,
          schedule: params.schedule,
          title: params.title ?? "Nightly",
          worktreePath: params.worktreePath,
        });
      },
      updateCron: async (params) => {
        updatedParams = params;
        return makeCron({
          enabled: params.enabled === true ? 1 : 0,
          id: params.cronJobId,
          title: params.title ?? "Nightly",
        });
      },
    });

    const created = await executeTool(scope, host, "new_cron", {
      description: "  Nightly summary  ",
      enabled: "true",
      prompt: " Summarize the repo ",
      schedule: "0 0 * * *",
      title: " Nightly Summary ",
    });
    const updated = await executeTool(scope, host, "update_cron", {
      cronJobId: "9",
      enabled: "false",
      title: " Retitled Cron ",
    });

    expectDeepEqual(requireValue(createdParams), {
      description: "Nightly summary",
      enabled: true,
      projectId: 7,
      prompt: "Summarize the repo",
      schedule: "0 0 * * *",
      title: "Nightly Summary",
      worktreePath: scope.worktreePathContext,
    });
    expectDeepEqual(requireValue(updatedParams), {
      cronJobId: 9,
      enabled: false,
      title: "Retitled Cron",
    });
    expect(resultText(created)).toBe(
      `Created cron job 9 in ${scope.worktreePathContext}.`,
    );
    expect(resultText(updated)).toBe("Updated cron job 9.");
  });

  it("blocks unsafe cron creation and escalation from a safe thread", async () => {
    const scope = makeScope();
    const host = createHost();

    await expect(
      executeTool(scope, host, "new_cron", {
        prompt: "Summarize the repo",
        schedule: "0 0 * * *",
        unsafeMode: "true",
      }),
    ).rejects.toThrow(
      "Unsafe mode is disabled for the current thread. This thread cannot create or update unsafe child threads or cron jobs.",
    );

    await expect(
      executeTool(scope, host, "update_cron", {
        cronJobId: "9",
        unsafeMode: "true",
      }),
    ).rejects.toThrow(
      "Unsafe mode is disabled for the current thread. This thread cannot create or update unsafe child threads or cron jobs.",
    );
  });

  it("records per-tool, unsafe-mode, and sandbox telemetry through the Metidos tool wrapper", async () => {
    resetRuntimeStats();
    const safeScope = makeScope();
    const unsafeScope = makeScope({
      allowUnsafeModeEscalation: true,
    });
    const host = createHost();

    const failedSandbox = await executeTool(
      safeScope,
      host,
      "run_untrusted_js",
      {
        code: 'throw new Error("boom")',
      },
    );
    const timedOutSandbox = await executeTool(
      safeScope,
      host,
      "run_untrusted_js",
      {
        code: "while (true) {}",
        timeoutMs: 10,
      },
    );
    await executeTool(safeScope, host, "list_crons", {});
    await executeTool(unsafeScope, host, "new_thread", {
      input: "Ship it",
      unsafeMode: "true",
    });
    await expect(
      executeTool(safeScope, host, "new_cron", {
        prompt: "Summarize the repo",
        schedule: "0 0 * * *",
        unsafeMode: "true",
      }),
    ).rejects.toThrow(
      "Unsafe mode is disabled for the current thread. This thread cannot create or update unsafe child threads or cron jobs.",
    );

    expect(resultText(failedSandbox)).toContain("Sandbox failed");
    expect(resultText(timedOutSandbox)).toContain("Sandbox timed out");

    const snapshot = getRuntimeStatsSnapshot();
    expect(snapshot.metidosTools.byTool.run_untrusted_js).toMatchObject({
      calls: 2,
      failed: 0,
      succeeded: 2,
    });
    expect(snapshot.metidosTools.byTool.list_crons).toMatchObject({
      calls: 1,
      failed: 0,
      succeeded: 1,
    });
    expect(snapshot.metidosTools.byTool.new_thread).toMatchObject({
      calls: 1,
      failed: 0,
      succeeded: 1,
    });
    expect(snapshot.metidosTools.byTool.new_cron).toMatchObject({
      calls: 1,
      failed: 1,
      succeeded: 0,
    });
    expect(snapshot.metidosTools.unsafeModeRequests).toEqual({
      byTool: {
        new_cron: {
          allowed: 0,
          blocked: 1,
          requested: 1,
        },
        new_thread: {
          allowed: 1,
          blocked: 0,
          requested: 1,
        },
      },
      totals: {
        allowed: 1,
        blocked: 1,
        requested: 2,
      },
    });
    expect(snapshot.metidosTools.sandbox).toEqual({
      calls: 2,
      failed: 1,
      succeeded: 0,
      timedOut: 1,
    });

    const summary = getRuntimeStatsSummary();
    expect(summary.metidosTools.toolCount).toBe(4);
    expect(summary.metidosTools.unsafeModeToolCount).toBe(2);
    expect(summary.metidosTools.byTool.new_cron).toEqual(
      snapshot.metidosTools.byTool.new_cron,
    );
    expect(summary.metidosTools.sandbox).toEqual(snapshot.metidosTools.sandbox);
  });
});
