import { beforeEach, describe, expect, it } from "bun:test";
import type { RpcCalendarEvent } from "../../calendar/types";
import { AuthServiceError } from "../../auth/service";
import type {
  AppRPCSchema,
  RpcCronJob,
  RpcModelCatalog,
  RpcPluginInventory,
  RpcPluginInventoryPlugin,
  RpcProject,
  RpcTerminal,
  RpcThread,
  RpcThreadDetail,
  RpcThreadStartRequest,
  RpcWorktree,
} from "../../rpc-schema";
import {
  getRuntimeStatsSnapshot,
  getRuntimeStatsSummary,
  resetRuntimeStats,
} from "../../runtime-stats";
import { resetMetidosToolBudgetsForTests } from "./shared";
import {
  createPiMetidosTools,
  type PiMetidosToolHost,
  type PiMetidosToolScope,
} from "./tools";

const NOW = "2026-04-09T12:00:00.000Z";

const DEFAULT_SCOPE_PERMISSIONS = [
  "metidos:calendar",
  "metidos:crons",
  "metidos:git",
  "metidos:github",
  "metidos:notifications",
  "metidos:threads",
  "notes:read",
];

function makeScope(
  overrides: Partial<PiMetidosToolScope> = {},
): PiMetidosToolScope {
  return {
    allowUnsafeModeEscalation: false,
    metidosAccessEnabled: true,
    permissionsContext: DEFAULT_SCOPE_PERMISSIONS,
    modelContext: "openai:gpt-5.4",
    projectIdContext: 7,
    reasoningEffortContext: "medium",
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

function makeTerminal(input?: Partial<RpcTerminal>): RpcTerminal {
  return {
    cols: 80,
    command: null,
    createdAt: NOW,
    createdFromThreadId: 11,
    cwd: "/repo/alpha/feature-a",
    exitCode: null,
    exitSignal: null,
    projectId: 7,
    projectName: "Alpha",
    rows: 24,
    status: "running",
    terminalId: "terminal-1",
    terminalIndex: 0,
    title: "Shell",
    updatedAt: NOW,
    worktreeFolder: "feature-a",
    worktreePath: "/repo/alpha/feature-a",
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

function makePlugin(
  input: Partial<RpcPluginInventoryPlugin> & {
    pluginId: string | null;
  },
): RpcPluginInventoryPlugin {
  const { pluginId, ...overrides } = input;
  return {
    adminActions: [],
    approvedReviewHash: null,
    currentReviewHash: null,
    dataUsage: {
      bytes: 0,
      files: 0,
      scannedAt: NOW,
      unavailableReason: null,
    },
    description: "Plugin tools",
    directoryName: pluginId ?? "plugin",
    folderPath: `/plugins/${pluginId ?? "plugin"}`,
    group: "Active",
    hasRootNodeModules: false,
    lifecycle: { state: "active" },
    lifecycleMessage: null,
    manifest: {
      access: [],
      crons: [],
      env: [],
      files: { read: [], write: [] },
      gc: null,
      metidosApiVersion: "1",
      network: null,
      notificationProviders: [],
      oauthProviders: [],
      permissions: [],
      piAuth: [],
      providers: [],
      settings: [],
      storageDefaults: null,
      telemetry: true,
    } as unknown as RpcPluginInventoryPlugin["manifest"],
    name: pluginId,
    pluginId,
    reviewWarnings: [],
    status: "enabled",
    structurallyValid: true,
    validationErrors: [],
    version: "1.0.0",
    ...overrides,
  } as RpcPluginInventoryPlugin;
}

function makePluginInventory(
  plugins: RpcPluginInventoryPlugin[],
): RpcPluginInventory {
  return {
    groups: [],
    issues: [],
    plugins,
    pluginsDirectoryExists: true,
    pluginsDirectoryPath: "/plugins",
    scannedAt: NOW,
  };
}

function makeModelCatalog(input?: Partial<RpcModelCatalog>): RpcModelCatalog {
  return {
    defaultModel: "openai-codex:gpt-5.4",
    defaultReasoningEffort: "medium",
    models: [
      {
        contextWindowTokens: 128000,
        deprecated: false,
        group: "OpenAI Codex",
        id: "openai-codex:gpt-5.4",
        isPlaceholder: false,
        label: "GPT 5.4",
        modelId: "gpt-5.4",
        providerAvailable: true,
        providerAvailabilityNote: null,
        providerId: "openai-codex",
        providerLabel: "OpenAI Codex",
        summary:
          "Provider: OpenAI Codex. Model ID: gpt-5.4. Supports thinking level control.",
        supportsEmbeddings: false,
        supportsImageInput: true,
        supportsReasoningEffort: true,
        supportedReasoningEfforts: [
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
        ],
      },
      {
        contextWindowTokens: 64000,
        deprecated: false,
        group: "Plugin Provider",
        id: "plugin/provider/default/local-model",
        isPlaceholder: false,
        label: "Local Model",
        modelId: "local-model",
        providerAvailable: true,
        providerAvailabilityNote: null,
        providerId: "plugin/provider/default",
        providerLabel: "Plugin Provider",
        summary:
          "Provider: Plugin Provider. Model ID: local-model. No thinking-level control.",
        supportsEmbeddings: false,
        supportsImageInput: false,
        supportsReasoningEffort: false,
        supportedReasoningEfforts: [],
      },
    ],
    reasoningEfforts: [
      { id: "minimal", label: "Minimal" },
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
    ],
    ...input,
  };
}

function makeCalendarEvent(
  input?: Partial<RpcCalendarEvent>,
): RpcCalendarEvent {
  return {
    allDay: false,
    calendarId: 1,
    createdAt: NOW,
    createdByUserId: 1,
    createdByUsername: "owner",
    deletedAt: null,
    description: "",
    endAt: "2026-04-30T14:30:00.000Z",
    endDate: null,
    id: 22,
    location: "",
    recurrenceRule: null,
    recurrenceSummary: "Does not repeat",
    reminders: [],
    sourceType: "local",
    startAt: "2026-04-30T14:00:00.000Z",
    startDate: null,
    timezone: "America/New_York",
    title: "Planning",
    updatedAt: NOW,
    updatedByUserId: 1,
    updatedByUsername: "owner",
    version: 3,
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

function createHost(
  overrides: Partial<PiMetidosToolHost> = {},
): PiMetidosToolHost {
  return {
    createThread: async () => makeThreadDetail(),
    getModelCatalog: async () => makeModelCatalog(),
    listCrons: async () => [],
    listProjectWorktrees: async () => [makeWorktree()],
    listProjects: async () => [makeProject()],
    listThreads: async () => [makeThread()],
    newCron: async () => makeCron(),
    requestThreadStart: async () => makeThreadStartRequest(),
    sendThreadMessage: async () => makeThreadDetail(),
    updateCron: async () => makeCron(),
    updateThreadMetadata: async () => makeThread(),
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return {
    promise,
    reject,
    resolve,
  };
}

async function nextMicrotask(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForCondition(
  description: string,
  predicate: () => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await nextMicrotask();
    await Bun.sleep(1);
  }
  throw new Error(`Timed out waiting for ${description}.`);
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
  beforeEach(() => {
    resetRuntimeStats();
    resetMetidosToolBudgetsForTests();
  });

  it("lists native permissions without plugins", async () => {
    const result = await executeTool(
      makeScope({ metidosAccessEnabled: false }),
      createHost(),
      "metidos_list_permissions",
      {},
    );

    expect(resultText(result)).toContain("## Metidos native tools: metidos");
    expect(resultText(result)).toContain(
      '- "metidos:web-search": Current-information web search/fetch capability.',
    );
    expect(resultText(result)).not.toContain('- "weather:');
    expect((result.details as { diagnostics: string[] }).diagnostics).toEqual(
      [],
    );
  });

  it("lists plugin permissions after native permissions in deterministic order", async () => {
    const host = createHost({
      getPluginInventory: async () =>
        makePluginInventory([
          makePlugin({
            description: "Zulu tools",
            manifest: {
              access: [
                {
                  description: "Zulu beta access.",
                  id: "beta",
                  name: "Beta",
                  tools: [
                    {
                      description: "Run beta",
                      name: "z_beta",
                      timeoutMs: null,
                    },
                  ],
                },
                {
                  description: "Zulu alpha access.",
                  id: "alpha",
                  name: "Alpha",
                  tools: [
                    {
                      description: "Run alpha",
                      name: "z_alpha",
                      timeoutMs: null,
                    },
                  ],
                },
              ],
            } as RpcPluginInventoryPlugin["manifest"],
            name: "Zulu",
            pluginId: "zulu",
          }),
          makePlugin({
            description: "Alpha tools",
            manifest: {
              access: [
                {
                  description: "Weather forecast access.",
                  id: "weather",
                  name: "Weather",
                  tools: [
                    {
                      description: "Forecast",
                      name: "forecast",
                      timeoutMs: null,
                    },
                  ],
                },
              ],
            } as RpcPluginInventoryPlugin["manifest"],
            name: "Alpha",
            pluginId: "alpha",
          }),
        ]),
    });

    const result = await executeTool(
      makeScope(),
      host,
      "metidos_list_permissions",
      {},
    );
    const text = resultText(result);

    expect(text.indexOf("## Metidos native tools: metidos")).toBeLessThan(
      text.indexOf("## Alpha tools: alpha"),
    );
    expect(text.indexOf("## Alpha tools: alpha")).toBeLessThan(
      text.indexOf("## Zulu tools: zulu"),
    );
    expect(text).toContain(
      '## Alpha tools: alpha\n- "alpha:weather": Weather forecast access.',
    );
    expect(text).toContain(
      '## Zulu tools: zulu\n- "zulu:alpha": Zulu alpha access.\n- "zulu:beta": Zulu beta access.',
    );
    expect(text).not.toContain('## Metidos native tools: metidos\n- "weather:');
  });

  it("omits malformed plugin permission descriptors and keeps native output", async () => {
    const host = createHost({
      getPluginInventory: async () =>
        makePluginInventory([
          makePlugin({
            description: "Broken tools",
            manifest: {
              access: [
                {
                  description: "Broken access.",
                  id: "Bad:Access",
                  name: "Broken",
                  tools: [
                    {
                      description: "Run broken",
                      name: "broken",
                      timeoutMs: null,
                    },
                  ],
                },
              ],
            } as RpcPluginInventoryPlugin["manifest"],
            name: "Broken",
            pluginId: "broken",
          }),
        ]),
    });

    const result = await executeTool(
      makeScope(),
      host,
      "metidos_list_permissions",
      {},
    );

    const details = result.details as { diagnostics: string[] };
    expect(resultText(result)).toContain("## Metidos native tools: metidos");
    expect(resultText(result)).not.toContain("## Broken tools: broken");
    expect(Array.isArray(details.diagnostics)).toBe(true);
    expect(details.diagnostics.length).toBe(1);
  });

  it("creates terminals only after resolving the directory inside the selected worktree", async () => {
    const scope = makeScope({ unsafeModeEnabled: true });
    let receivedParams: Record<string, unknown> | null = null;
    const host = createHost({
      createTerminal: async (params) => {
        receivedParams = params;
        return makeTerminal({
          cwd: params.dir ?? scope.worktreePathContext,
          title: params.title ?? "Shell",
        });
      },
    });

    const result = await executeTool(scope, host, "new_terminal", {
      command: " bun test ",
      dir: "packages/app",
      title: " Tests ",
    });

    expect(resultText(result)).toBe(
      'Created terminal "Tests" in Alpha · feature-a.',
    );
    expectDeepEqual(requireValue(receivedParams), {
      command: "bun test",
      createdFromThreadId: 11,
      dir: "/repo/alpha/feature-a/packages/app",
      projectId: 7,
      title: "Tests",
      worktreePath: "/repo/alpha/feature-a",
    });
  });

  it("rejects Pi-native terminal directories outside the selected worktree", async () => {
    const scope = makeScope({ unsafeModeEnabled: true });
    let createTerminalCalled = false;
    const host = createHost({
      createTerminal: async () => {
        createTerminalCalled = true;
        return makeTerminal();
      },
    });

    await expect(
      executeTool(scope, host, "new_terminal", { dir: "../other-worktree" }),
    ).rejects.toThrow(
      "Terminal directory must stay inside the selected worktree.",
    );
    await expect(
      executeTool(scope, host, "new_terminal", { dir: "/repo/alpha/other" }),
    ).rejects.toThrow(
      "Terminal directory must stay inside the selected worktree.",
    );
    expect(createTerminalCalled).toBe(false);
  });

  it("sanitizes host failure messages from Pi-native terminal tools", async () => {
    const scope = makeScope({ unsafeModeEnabled: true });
    const leakedHostError =
      "node-pty spawn failed in /home/jtenner/private with OPENAI_API_KEY=sk-test-secret and impl terminal-99";
    const host = createHost({
      createTerminal: async () => {
        throw new Error(leakedHostError);
      },
      grepTerminal: async () => {
        throw new Error(leakedHostError);
      },
      killTerminal: async () => {
        throw new Error(leakedHostError);
      },
      listTerminals: async () => {
        throw new Error(leakedHostError);
      },
      viewTerminal: async () => {
        throw new Error(leakedHostError);
      },
    });

    const cases: Array<{
      args: unknown;
      expectedMessage: string;
      name: string;
    }> = [
      {
        args: { command: "bun test" },
        expectedMessage:
          "Terminal creation failed. Check the terminal workspace for details.",
        name: "new_terminal",
      },
      {
        args: {},
        expectedMessage:
          "Terminal list failed. Check the terminal workspace for details.",
        name: "list_terminals",
      },
      {
        args: { terminalIndex: 0 },
        expectedMessage:
          "Terminal close failed. Check the terminal workspace for details.",
        name: "kill_terminal",
      },
      {
        args: { terminalIndex: 0 },
        expectedMessage:
          "Terminal view failed. Check the terminal workspace for details.",
        name: "view_terminal",
      },
      {
        args: { pattern: "secret", terminalIndex: 0 },
        expectedMessage:
          "Terminal search failed. Check the terminal workspace for details.",
        name: "grep_terminal",
      },
    ];

    for (const testCase of cases) {
      try {
        await executeTool(scope, host, testCase.name, testCase.args);
        throw new Error(`Expected ${testCase.name} to fail.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toBe(testCase.expectedMessage);
        expect(message).not.toContain("/home/jtenner/private");
        expect(message).not.toContain("OPENAI_API_KEY");
        expect(message).not.toContain("sk-test-secret");
        expect(message).not.toContain("node-pty");
        expect(message).not.toContain("terminal-99");
      }
    }
  });

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

  it("lists calendars as a markdown table when calendar access is enabled", async () => {
    const scope = makeScope({ calendarAccessEnabled: true });
    const host = createHost({
      createCalendarEvent: async () => {
        throw new Error("not used");
      },
      getCalendarBootstrap: async () => ({
        calendars: [
          {
            color: "#111111",
            createdAt: NOW,
            effectiveColor: "#111111",
            id: 1,
            isPublic: false,
            notificationChannels: ["in_app"],
            notificationsEnabled: true,
            ownerUserId: 1,
            ownerUsername: "owner",
            permission: "owner",
            publicSlug: null,
            sourceType: "local",
            title: "Personal",
            updatedAt: NOW,
            visible: true,
          },
        ],
        externalCalendars: [
          {
            color: "#222222",
            consecutiveFailures: 0,
            createdAt: NOW,
            enabled: true,
            id: 2,
            lastError: null,
            lastErrorAt: null,
            lastFetchedAt: null,
            lastSuccessAt: null,
            notificationMode: "default",
            notificationsEnabled: false,
            ownerUserId: 1,
            refreshIntervalMinutes: 30,
            sourceType: "external_ics",
            title: "Holidays",
            updatedAt: NOW,
            url: "https://example.com/holidays.ics",
            visible: true,
          },
        ],
      }),
      listCalendarOccurrences: async () => [],
    });

    const result = await executeTool(scope, host, "list_calendars", {});

    expect(resultText(result)).toContain(
      "| Id | Source type | Title | Permission |",
    );
    expect(resultText(result)).toContain("| 1 | local | Personal | owner |");
    expect(resultText(result)).toContain(
      "| 2 | external_ics | Holidays | read |",
    );
  });

  it("does not expose calendar creation to agents", () => {
    const scope = makeScope({ calendarAccessEnabled: true });

    expect(() => getTool(scope, createHost(), "new_calendar")).toThrow(
      "Tool not found: new_calendar",
    );
  });

  it("modifies calendar events through calendar access", async () => {
    const scope = makeScope({ calendarAccessEnabled: true });
    let receivedParams: Record<string, unknown> | null = null;
    const host = createHost({
      updateCalendarEvent: async (params) => {
        receivedParams = params;
        return makeCalendarEvent({
          id: params.eventId,
          title: params.title ?? "Planning",
          version: 4,
        });
      },
    });

    const result = await executeTool(scope, host, "modify_calendar_event", {
      eventId: "22",
      expectedVersion: "3",
      occurrenceStart: "2026-04-30T14:00:00.000Z",
      scope: "whole_series",
      title: "Planning updated",
    });

    expectDeepEqual(requireValue(receivedParams), {
      eventId: 22,
      expectedVersion: 3,
      occurrenceStart: "2026-04-30T14:00:00.000Z",
      scope: "whole_series",
      title: "Planning updated",
    });
    expect(resultText(result)).toBe(
      "Modified calendar event 22: Planning updated.",
    );
  });

  it("omits null optional calendar filters before validation", () => {
    const scope = makeScope({ calendarAccessEnabled: true });
    const host = createHost({
      createCalendarEvent: async () => {
        throw new Error("unused");
      },
      getCalendarBootstrap: async () => ({
        calendars: [],
        externalCalendars: [],
      }),
      listCalendarOccurrences: async () => [],
    });
    const tool = getTool(scope, host, "list_calendar_events");

    expectDeepEqual(
      tool.prepareArguments?.({
        calendarId: null,
        end: "2026-04-30T23:59:59-04:00",
        start: "2026-04-30T00:00:00-04:00",
        timezone: "America/New_York",
      }),
      {
        end: "2026-04-30T23:59:59-04:00",
        start: "2026-04-30T00:00:00-04:00",
        timezone: "America/New_York",
      },
    );
  });

  it("does not install calendar tools without calendar access", () => {
    expect(() => getTool(makeScope(), createHost(), "list_calendars")).toThrow(
      "Tool not found: list_calendars",
    );
  });

  it("always installs update_thread even without Metidos access", () => {
    const scope = makeScope({ metidosAccessEnabled: false });
    const host = createHost();

    expect(getTool(scope, host, "update_thread").name).toBe("update_thread");
  });

  it("splits Metidos thread and cron tools by access group", () => {
    const host = createHost();
    const threadOnlyScope = makeScope({
      metidosAccessEnabled: false,
      threadsAccessEnabled: true,
      cronsAccessEnabled: false,
    });
    const cronOnlyScope = makeScope({
      metidosAccessEnabled: false,
      threadsAccessEnabled: false,
      cronsAccessEnabled: true,
    });

    expect(getTool(threadOnlyScope, host, "new_thread").name).toBe(
      "new_thread",
    );
    expect(getTool(threadOnlyScope, host, "model_providers").name).toBe(
      "model_providers",
    );
    expect(getTool(threadOnlyScope, host, "models_query").name).toBe(
      "models_query",
    );
    expect(() => getTool(threadOnlyScope, host, "new_cron")).toThrow(
      "Tool not found: new_cron",
    );

    expect(getTool(cronOnlyScope, host, "list_crons").name).toBe("list_crons");
    expect(getTool(cronOnlyScope, host, "new_cron").name).toBe("new_cron");
    expect(getTool(cronOnlyScope, host, "model_providers").name).toBe(
      "model_providers",
    );
    expect(getTool(cronOnlyScope, host, "models_query").name).toBe(
      "models_query",
    );
  });

  it("lists model providers as a markdown table for thread or cron access", async () => {
    const result = await executeTool(
      makeScope({ metidosAccessEnabled: false, threadsAccessEnabled: true }),
      createHost(),
      "model_providers",
      {},
    );
    const text = resultText(result);

    expect(text).toContain(
      "| Provider id | Label | Models | Available | Note |",
    );
    expect(text).toContain("| openai-codex | OpenAI Codex | 1 | yes |  |");
    expect(text).toContain(
      "| plugin/provider/default | Plugin Provider | 1 | yes |  |",
    );
  });

  it("searches models by exact provider and returns start-ready model arguments", async () => {
    const result = await executeTool(
      makeScope({ metidosAccessEnabled: false, cronsAccessEnabled: true }),
      createHost(),
      "models_query",
      { provider: "plugin/provider/default", query: "local" },
    );
    const text = resultText(result);

    expect(text).toContain(
      "| Model argument | Label | Provider | Provider model id | Reasoning efforts | Context tokens | Available |",
    );
    expect(text).toContain(
      "| plugin/provider/default/local-model | Local Model | plugin/provider/default | local-model | no | 64000 | yes |",
    );
    expect(text).not.toContain("openai-codex:gpt-5.4");
  });

  it("rejects non-exact model provider ids", async () => {
    await expect(
      executeTool(
        makeScope({ metidosAccessEnabled: false, threadsAccessEnabled: true }),
        createHost(),
        "models_query",
        { provider: "Plugin Provider", query: "local" },
      ),
    ).rejects.toThrow(
      "Model provider not found: Plugin Provider. Call model_providers and copy an exact Provider id.",
    );
  });

  it("keeps update_thread visible while hiding Metidos management tools for calendar-only access", () => {
    const scope = makeScope({
      calendarAccessEnabled: true,
      metidosAccessEnabled: false,
    });
    const host = createHost({
      createCalendarEvent: async () => {
        throw new Error("not used");
      },
      getCalendarBootstrap: async () => ({
        calendars: [],
        externalCalendars: [],
      }),
      listCalendarOccurrences: async () => [],
    });

    expect(getTool(scope, host, "list_calendars").name).toBe("list_calendars");
    expect(getTool(scope, host, "update_thread").name).toBe("update_thread");
    expect(() => getTool(scope, host, "new_cron")).toThrow(
      "Tool not found: new_cron",
    );
    expect(() => getTool(scope, host, "model_providers")).toThrow(
      "Tool not found: model_providers",
    );
  });

  it("surfaces authenticated-operator failures from Pi-native calendar host callbacks", async () => {
    const scope = makeScope({ calendarAccessEnabled: true });
    const authError = new AuthServiceError(
      "session_required",
      "A valid authenticated session is required for calendar access.",
    );
    const host = createHost({
      createCalendarEvent: async () => {
        throw authError;
      },
      getCalendarBootstrap: async () => {
        throw authError;
      },
      listCalendarOccurrences: async () => {
        throw authError;
      },
      updateCalendarEvent: async () => {
        throw authError;
      },
    });
    const cases: Array<{
      args: unknown;
      name: string;
    }> = [
      { args: {}, name: "list_calendars" },
      {
        args: {
          end: "2026-04-30T23:59:59.000Z",
          start: "2026-04-30T00:00:00.000Z",
        },
        name: "list_calendar_events",
      },
      {
        args: { occurrenceId: "local:22:2026-04-30T14:00:00.000Z" },
        name: "show_calendar_event",
      },
      {
        args: {
          calendarId: 1,
          endAt: "2026-04-30T14:30:00.000Z",
          startAt: "2026-04-30T14:00:00.000Z",
          timezone: "America/New_York",
          title: "Planning",
        },
        name: "new_calendar_event",
      },
      {
        args: { eventId: 22, title: "Planning updated" },
        name: "modify_calendar_event",
      },
    ];

    expect.assertions(cases.length * 3);
    for (const { args, name } of cases) {
      try {
        await executeTool(scope, host, name, args);
      } catch (error) {
        expect(error, name).toBeInstanceOf(AuthServiceError);
        expect((error as AuthServiceError).code, name).toBe("session_required");
        expect((error as AuthServiceError).message, name).toBe(
          "A valid authenticated session is required for calendar access.",
        );
      }
    }
  });

  it("creates and starts a new safe child thread immediately from a safe thread", async () => {
    const scope = makeScope();
    let createdParams: Record<string, unknown> | null = null;
    let messageParams: Record<string, unknown> | null = null;
    const host = createHost({
      createThread: async (params) => {
        createdParams = params;
        return makeThreadDetail({
          thread: makeThread({
            id: 44,
            projectId: params.projectId,
            reasoningEffort: params.reasoningEffort ?? "medium",
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
      input: "Do work",
      model: "openai:gpt-5.4",
      reasoningEffort: "high",
    });

    expectDeepEqual(requireValue(createdParams), {
      model: "openai:gpt-5.4",
      permissions: DEFAULT_SCOPE_PERMISSIONS,
      projectId: 7,
      reasoningEffort: "high",
      worktreePath: scope.worktreePathContext,
    });
    expectDeepEqual(requireValue(messageParams), {
      input: "Do work",
      threadId: 44,
    });
    expect(resultText(result)).toBe("Started thread 44 (Turning).");
    expect(result.details).toMatchObject({
      autoStart: null,
      input: "Do work",
      model: "openai:gpt-5.4",
      projectId: 7,
      reasoningEffort: "high",
      runState: "working",
      status: "Turning",
      threadId: 44,
      requestedPermissions: DEFAULT_SCOPE_PERMISSIONS,
      worktreePath: scope.worktreePathContext,
    });
  });

  it("resolves omitted new_thread project/worktree targeting from the current tracked worktree", async () => {
    const scope = makeScope({
      projectIdContext: 1,
      worktreePathContext: "/repo/alpha/feature-a",
    });
    let createdParams: Record<string, unknown> | null = null;
    const host = createHost({
      createThread: async (params) => {
        createdParams = params;
        return makeThreadDetail({
          thread: makeThread({
            id: 46,
            projectId: params.projectId,
            worktreePath: params.worktreePath,
          }),
        });
      },
      listProjectWorktrees: async (params) => {
        if (params.projectId === 1) {
          throw new Error("Project not currently tracked: 1");
        }
        return [makeWorktree({ path: "/repo/alpha/feature-a" })];
      },
      listProjects: async () => [makeProject({ id: 7, path: "/repo/alpha" })],
      sendThreadMessage: async (params) =>
        makeThreadDetail({
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
            worktreePath: "/repo/alpha/feature-a",
          }),
        }),
    });

    await executeTool(scope, host, "new_thread", {
      input: "Use default target",
    });

    expect(requireValue(createdParams)).toMatchObject({
      projectId: 7,
      worktreePath: "/repo/alpha/feature-a",
    });
  });

  it("inherits the current thread model and reasoning when new_thread omits them", async () => {
    const scope = makeScope({
      modelContext: "openai:gpt-5.5",
      reasoningEffortContext: "high",
    });
    let createdParams: Record<string, unknown> | null = null;
    const host = createHost({
      createThread: async (params) => {
        createdParams = params;
        return makeThreadDetail({
          thread: makeThread({
            id: 45,
            model: params.model ?? scope.modelContext ?? "openai:gpt-5.5",
            projectId: params.projectId,
            reasoningEffort: params.reasoningEffort ?? "medium",
            worktreePath: params.worktreePath,
          }),
        });
      },
      sendThreadMessage: async (params) =>
        makeThreadDetail({
          thread: makeThread({
            id: params.threadId,
            model: scope.modelContext ?? "openai:gpt-5.5",
            projectId: 7,
            reasoningEffort: scope.reasoningEffortContext ?? "high",
            runStatus: {
              error: null,
              hasUnreadError: false,
              startedAt: NOW,
              state: "working",
              updatedAt: NOW,
            },
            worktreePath: scope.worktreePathContext,
          }),
        }),
    });

    const result = await executeTool(scope, host, "new_thread", {
      input: "Do inherited work",
    });

    expectDeepEqual(requireValue(createdParams), {
      model: "openai:gpt-5.5",
      permissions: DEFAULT_SCOPE_PERMISSIONS,
      projectId: 7,
      reasoningEffort: "high",
      worktreePath: scope.worktreePathContext,
    });
    expect(result.details).toMatchObject({
      input: "Do inherited work",
      model: "openai:gpt-5.5",
      reasoningEffort: "high",
      threadId: 45,
    });
  });

  it("lets safe threads request approval for unsafe child threads", async () => {
    const scope = makeScope();
    let requestParams: Record<string, unknown> | null = null;
    const host = createHost({
      requestThreadStart: async (params) => {
        requestParams = params;
        return makeThreadStartRequest({
          autoStart: params.autoStart ?? null,
          input: params.input,
          permissions: params.permissions ?? null,
          unsafeMode: params.permissions?.includes("metidos:unsafe") ?? false,
        });
      },
    });

    const result = await executeTool(scope, host, "new_thread", {
      input: "Ship it",
      permissions: ["metidos:unsafe"],
    });

    expectDeepEqual(requireValue(requestParams), {
      autoStart: true,
      input: "Ship it",
      model: scope.modelContext,
      permissions: ["metidos:unsafe"],
      projectId: 7,
      reasoningEffort: scope.reasoningEffortContext,
      worktreePath: scope.worktreePathContext,
    });
    expect(resultText(result)).toBe(
      `Requested permission to start a thread for ${scope.worktreePathContext}.`,
    );
    expect(result.details).toMatchObject({
      autoStart: true,
      input: "Ship it",
      threadId: null,
      permissions: ["metidos:unsafe"],
      worktreePath: scope.worktreePathContext,
    });
  });

  it("requests approval when a child thread asks for permissions the current thread lacks", async () => {
    const scope = makeScope({
      allowUnsafeModeEscalation: true,
      permissionsContext: ["metidos:threads"],
    });
    let created = false;
    let requestParams: Record<string, unknown> | null = null;
    const host = createHost({
      createThread: async () => {
        created = true;
        return makeThreadDetail();
      },
      requestThreadStart: async (params) => {
        requestParams = params;
        return makeThreadStartRequest({
          autoStart: params.autoStart ?? null,
          input: params.input,
          permissions: params.permissions ?? null,
        });
      },
    });

    const result = await executeTool(scope, host, "new_thread", {
      input: "Ship it",
      permissions: ["metidos:github"],
    });

    expect(created).toBeFalse();
    expectDeepEqual(requireValue(requestParams), {
      autoStart: true,
      input: "Ship it",
      model: scope.modelContext,
      permissions: ["metidos:github"],
      projectId: 7,
      reasoningEffort: scope.reasoningEffortContext,
      worktreePath: scope.worktreePathContext,
    });
    expect(resultText(result)).toBe(
      `Requested permission to start a thread for ${scope.worktreePathContext}.`,
    );
  });

  it("creates and starts a new thread immediately when an unsafe thread does not request approval", async () => {
    const scope = makeScope({
      allowUnsafeModeEscalation: true,
      permissionsContext: [...DEFAULT_SCOPE_PERMISSIONS, "metidos:unsafe"],
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
      input: "Ship it",
      permissions: ["metidos:github", "metidos:unsafe"],
    });

    expectDeepEqual(requireValue(createdParams), {
      model: scope.modelContext,
      permissions: ["metidos:github", "metidos:unsafe"],
      projectId: 7,
      reasoningEffort: scope.reasoningEffortContext,
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
      requestedPermissions: ["metidos:github", "metidos:unsafe"],
      worktreePath: scope.worktreePathContext,
    });
  });

  it("lets unsafe threads request approval explicitly with autoStart", async () => {
    const scope = makeScope({
      allowUnsafeModeEscalation: true,
    });
    let created = false;
    let requestParams: Record<string, unknown> | null = null;
    const host = createHost({
      createThread: async () => {
        created = true;
        return makeThreadDetail();
      },
      requestThreadStart: async (params) => {
        requestParams = params;
        return makeThreadStartRequest({
          autoStart: params.autoStart ?? null,
          input: params.input,
          permissions: params.permissions ?? null,
          unsafeMode: params.permissions?.includes("metidos:unsafe") ?? false,
        });
      },
    });

    const result = await executeTool(scope, host, "new_thread", {
      autoStart: "true",
      input: "Ship it",
      permissions: ["metidos:unsafe"],
    });

    expect(created).toBeFalse();
    expectDeepEqual(requireValue(requestParams), {
      autoStart: true,
      input: "Ship it",
      model: scope.modelContext,
      permissions: ["metidos:unsafe"],
      projectId: 7,
      reasoningEffort: scope.reasoningEffortContext,
      worktreePath: scope.worktreePathContext,
    });
    expect(resultText(result)).toBe(
      `Requested permission to start a thread for ${scope.worktreePathContext}.`,
    );
    expect(result.details).toMatchObject({
      autoStart: true,
      input: "Ship it",
      threadId: null,
      permissions: ["metidos:unsafe"],
      worktreePath: scope.worktreePathContext,
    });
  });

  it("passes normalized permission arrays through thread and cron tools", async () => {
    const scope = makeScope({ allowUnsafeModeEscalation: true });
    let threadParams: Record<string, unknown> | null = null;
    let cronCreateParams: Record<string, unknown> | null = null;
    let cronUpdateParams: Record<string, unknown> | null = null;
    const host = createHost({
      createThread: async (params) => {
        threadParams = params;
        return makeThreadDetail({
          thread: makeThread({ id: 46, permissions: params.permissions ?? [] }),
        });
      },
      getPluginInventory: async () =>
        makePluginInventory([
          makePlugin({
            manifest: {
              ...makePlugin({ pluginId: "notes" }).manifest,
              access: [
                {
                  description: "Read notes",
                  id: "read",
                  name: "Note read",
                  tools: [
                    {
                      description: "Read note records",
                      name: "notes_read",
                      timeoutMs: null,
                    },
                  ],
                },
              ],
            },
            pluginId: "notes",
          }),
        ]),
      newCron: async (params) => {
        cronCreateParams = params;
        return makeCron({ id: 10, permissions: params.permissions ?? [] });
      },
      updateCron: async (params) => {
        cronUpdateParams = params;
        return makeCron({
          id: params.cronJobId,
          permissions: params.permissions ?? [],
        });
      },
    });

    await executeTool(scope, host, "new_thread", {
      input: "Do permissioned work",
      permissions: ["notes:read", "metidos:git", "metidos:git"],
    });
    await executeTool(scope, host, "new_cron", {
      permissions: ["metidos:threads", "notes:read", "notes:read"],
      prompt: "Run note sync",
      schedule: "0 0 * * *",
    });
    await executeTool(scope, host, "update_cron", {
      cronJobId: "10",
      permissions: [],
    });

    expect(threadParams).toMatchObject({
      permissions: ["metidos:git", "notes:read"],
    });
    expect(cronCreateParams).toMatchObject({
      permissions: ["metidos:threads", "notes:read"],
    });
    expect(cronUpdateParams).toMatchObject({ permissions: [] });

    await expect(
      executeTool(scope, host, "new_thread", {
        input: "Bad permission",
        permissions: ["notes:write"],
      }),
    ).rejects.toThrow("Call metidos_list_permissions");
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

  it("describes cron jobs in the list_crons tool output", async () => {
    const scope = makeScope();
    const host = createHost({
      listCrons: async () => [
        makeCron({
          id: 3,
          nextRunDate: Date.parse("2026-04-10T00:00:00.000Z"),
          prompt:
            "Summarize repo changes, call out failing tests, and propose the next cleanup slice.",
          title: "Nightly report",
          worktreePath: "/repo/alpha/feature-a",
        }),
        makeCron({
          enabled: 0,
          id: 4,
          lastRunStatus: "Completed",
          nextRunDate: null,
          prompt: "Refresh release notes draft",
          schedule: "30 9 * * 1-5",
          title: "Morning release notes",
          worktreePath: "/repo/alpha/release",
        }),
      ],
    });

    const result = await executeTool(scope, host, "list_crons", {});

    expect(resultText(result)).toBe(
      [
        "Cron jobs (2):",
        "- [3] Nightly report (0 0 * * * · enabled · /repo/alpha/feature-a · next 2026-04-10T00:00:00.000Z) - Summarize repo changes, call out failing tests, and propose the next cleanup slice.",
        "- [4] Morning release notes (30 9 * * 1-5 · disabled · /repo/alpha/release · last Completed) - Refresh release notes draft",
      ].join("\n"),
    );
    expect(result.details).toMatchObject({
      cronJobs: [
        {
          cronJobId: 3,
          schedule: "0 0 * * *",
          title: "Nightly report",
        },
        {
          cronJobId: 4,
          enabled: 0,
          lastRunStatus: "Completed",
          schedule: "30 9 * * 1-5",
          title: "Morning release notes",
        },
      ],
    });
  });

  it("returns a clear empty-state message when no cron jobs exist", async () => {
    const scope = makeScope();
    const host = createHost({
      listCrons: async () => [],
    });

    const result = await executeTool(scope, host, "list_crons", {});

    expect(resultText(result)).toBe("No cron jobs found.");
    expect(result.details).toEqual({
      cronJobs: [],
    });
  });

  it("shows one cron job with the full prompt and current settings", async () => {
    const scope = makeScope();
    const prompt = [
      "Summarize repository changes since the last run.",
      "Call out failing tests.",
      "Propose the next cleanup slice.",
    ].join("\n");
    const host = createHost({
      listCrons: async () => [
        makeCron({
          agentsAccess: true,
          description: "Nightly repo maintenance and summary",
          githubAccess: true,
          gitAccess: true,
          id: 7,
          lastRunDate: Date.parse("2026-04-08T23:00:00.000Z"),
          lastRunStatus: "Completed",
          nextRunDate: Date.parse("2026-04-09T23:00:00.000Z"),
          prompt,
          schedule: "0 23 * * *",
          title: "Nightly maintenance",
        }),
      ],
    });

    const result = await executeTool(scope, host, "show_cron", {
      cronJobId: "7",
    });

    expect(resultText(result)).toBe(
      [
        "Cron job 7:",
        "title: Nightly maintenance",
        "description: Nightly repo maintenance and summary",
        "projectId: 7",
        `worktreePath: ${scope.worktreePathContext}`,
        "schedule: 0 23 * * *",
        "enabled: true",
        "model: openai:gpt-5.4",
        "reasoningEffort: medium",
        "permissions: []",
        "lastRunDate: 2026-04-08T23:00:00.000Z",
        "lastRunStatus: Completed",
        "nextRunDate: 2026-04-09T23:00:00.000Z",
        `createdAt: ${NOW}`,
        `updatedAt: ${NOW}`,
        "prompt:",
        "Summarize repository changes since the last run.",
        "Call out failing tests.",
        "Propose the next cleanup slice.",
      ].join("\n"),
    );
    expect(result.details).toMatchObject({
      cronJob: {
        cronJobId: 7,
        permissions: [],
        prompt,
        schedule: "0 23 * * *",
        title: "Nightly maintenance",
      },
    });
  });

  it("fails show_cron when the requested cron job is missing", async () => {
    const scope = makeScope();
    const host = createHost({
      listCrons: async () => [makeCron({ id: 3 })],
    });

    await expect(
      executeTool(scope, host, "show_cron", {
        cronJobId: "7",
      }),
    ).rejects.toThrow("Cron job not found: 7");
  });

  it("blocks unsafe cron creation and escalation from a safe thread", async () => {
    const scope = makeScope();
    const host = createHost();

    await expect(
      executeTool(scope, host, "new_cron", {
        permissions: ["metidos:unsafe"],
        prompt: "Summarize the repo",
        schedule: "0 0 * * *",
      }),
    ).rejects.toThrow(
      "Unsafe mode is disabled for the current thread. This thread cannot create or update unsafe child threads or cron jobs.",
    );

    await expect(
      executeTool(scope, host, "update_cron", {
        cronJobId: "9",
        permissions: ["metidos:unsafe"],
      }),
    ).rejects.toThrow(
      "Unsafe mode is disabled for the current thread. This thread cannot create or update unsafe child threads or cron jobs.",
    );
  });

  it("queues a bounded number of thread and cron mutations before failing loudly", async () => {
    const scope = makeScope();
    const launches: Array<{
      deferred: ReturnType<typeof createDeferred<RpcCronJob>>;
      params: AppRPCSchema["requests"]["newCron"]["params"];
    }> = [];
    const host = createHost({
      newCron: async (params) => {
        const deferred = createDeferred<RpcCronJob>();
        launches.push({
          deferred,
          params,
        });
        return deferred.promise;
      },
    });

    const first = executeTool(scope, host, "new_cron", {
      prompt: "Cron 1",
      schedule: "0 0 * * *",
      title: "Cron 1",
    });
    const second = executeTool(scope, host, "new_cron", {
      prompt: "Cron 2",
      schedule: "0 1 * * *",
      title: "Cron 2",
    });
    const third = executeTool(scope, host, "new_cron", {
      prompt: "Cron 3",
      schedule: "0 2 * * *",
      title: "Cron 3",
    });
    const fourth = executeTool(scope, host, "new_cron", {
      prompt: "Cron 4",
      schedule: "0 3 * * *",
      title: "Cron 4",
    });
    const fifthFailure = executeTool(scope, host, "new_cron", {
      prompt: "Cron 5",
      schedule: "0 4 * * *",
      title: "Cron 5",
    }).catch((error) => error);

    await waitForCondition(
      "two active cron launches",
      () => launches.length === 2,
    );
    const fifthError = await fifthFailure;
    expect(fifthError).toBeInstanceOf(Error);
    expect((fifthError as Error).message).toContain(
      "Metidos child-thread and cron mutations are saturated.",
    );

    const firstLaunch = requireValue(launches[0]);
    firstLaunch.deferred.resolve(
      makeCron({
        id: 101,
        schedule: firstLaunch.params.schedule,
        title: firstLaunch.params.title ?? "Cron 1",
        worktreePath: firstLaunch.params.worktreePath,
      }),
    );
    await waitForCondition(
      "third queued cron launch",
      () => launches.length === 3,
    );

    const secondLaunch = requireValue(launches[1]);
    secondLaunch.deferred.resolve(
      makeCron({
        id: 102,
        schedule: secondLaunch.params.schedule,
        title: secondLaunch.params.title ?? "Cron 2",
        worktreePath: secondLaunch.params.worktreePath,
      }),
    );
    await waitForCondition(
      "fourth queued cron launch",
      () => launches.length === 4,
    );

    const thirdLaunch = requireValue(launches[2]);
    const fourthLaunch = requireValue(launches[3]);
    thirdLaunch.deferred.resolve(
      makeCron({
        id: 103,
        schedule: thirdLaunch.params.schedule,
        title: thirdLaunch.params.title ?? "Cron 3",
        worktreePath: thirdLaunch.params.worktreePath,
      }),
    );
    fourthLaunch.deferred.resolve(
      makeCron({
        id: 104,
        schedule: fourthLaunch.params.schedule,
        title: fourthLaunch.params.title ?? "Cron 4",
        worktreePath: fourthLaunch.params.worktreePath,
      }),
    );

    await Promise.all([first, second, third, fourth]);

    const mutationBudget =
      getRuntimeStatsSnapshot().metidosTools.budgets?.byBudget
        .thread_cron_mutations;
    expect(mutationBudget).toMatchObject({
      activeCount: 0,
      completedCalls: 4,
      peakActiveCount: 2,
      peakPendingCount: 2,
      pendingCount: 0,
      queuedCalls: 2,
      saturationEvents: 1,
      startedCalls: 4,
    });
  });

  it("keeps unsafe child mutations serialized even when safe mutation capacity remains", async () => {
    const scope = makeScope({
      allowUnsafeModeEscalation: true,
    });
    const launches: Array<{
      deferred: ReturnType<typeof createDeferred<RpcCronJob>>;
      params: AppRPCSchema["requests"]["newCron"]["params"];
    }> = [];
    const host = createHost({
      newCron: async (params) => {
        const deferred = createDeferred<RpcCronJob>();
        launches.push({
          deferred,
          params,
        });
        return deferred.promise;
      },
    });

    const firstUnsafe = executeTool(scope, host, "new_cron", {
      permissions: ["metidos:unsafe"],
      prompt: "Unsafe cron",
      schedule: "*/5 * * * *",
      title: "Unsafe cron",
    });

    await waitForCondition(
      "first unsafe cron launch",
      () => launches.length === 1,
    );

    await expect(
      executeTool(scope, host, "new_cron", {
        permissions: ["metidos:unsafe"],
        prompt: "Unsafe cron 2",
        schedule: "*/10 * * * *",
        title: "Unsafe cron 2",
      }),
    ).rejects.toThrow("Unsafe child-thread and cron mutations are saturated.");

    const safeCron = executeTool(scope, host, "new_cron", {
      prompt: "Safe cron",
      schedule: "*/15 * * * *",
      title: "Safe cron",
    });
    await waitForCondition(
      "safe cron launch beside unsafe cron",
      () => launches.length === 2,
    );

    const unsafeLaunch = requireValue(launches[0]);
    const safeLaunch = requireValue(launches[1]);
    unsafeLaunch.deferred.resolve(
      makeCron({
        id: 201,
        schedule: unsafeLaunch.params.schedule,
        title: unsafeLaunch.params.title ?? "Unsafe cron",
        unsafeMode: true,
        worktreePath: unsafeLaunch.params.worktreePath,
      }),
    );
    safeLaunch.deferred.resolve(
      makeCron({
        id: 202,
        schedule: safeLaunch.params.schedule,
        title: safeLaunch.params.title ?? "Safe cron",
        unsafeMode: false,
        worktreePath: safeLaunch.params.worktreePath,
      }),
    );

    await Promise.all([firstUnsafe, safeCron]);

    const unsafeBudget =
      getRuntimeStatsSnapshot().metidosTools.budgets?.byBudget
        .unsafe_child_operations;
    expect(unsafeBudget).toMatchObject({
      activeCount: 0,
      completedCalls: 1,
      peakActiveCount: 1,
      peakPendingCount: 0,
      pendingCount: 0,
      queuedCalls: 0,
      saturationEvents: 1,
      startedCalls: 1,
    });
  });

  it("records per-tool and unsafe-mode telemetry through the Metidos tool wrapper", async () => {
    const safeScope = makeScope();
    const unsafeScope = makeScope({
      allowUnsafeModeEscalation: true,
    });
    const host = createHost();

    await executeTool(safeScope, host, "list_crons", {});
    await executeTool(unsafeScope, host, "new_thread", {
      input: "Ship it",
      permissions: ["metidos:unsafe"],
    });
    await expect(
      executeTool(safeScope, host, "new_cron", {
        permissions: ["metidos:unsafe"],
        prompt: "Summarize the repo",
        schedule: "0 0 * * *",
      }),
    ).rejects.toThrow(
      "Unsafe mode is disabled for the current thread. This thread cannot create or update unsafe child threads or cron jobs.",
    );

    const snapshot = getRuntimeStatsSnapshot();
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

    const summary = getRuntimeStatsSummary();
    expect(summary.metidosTools.toolCount).toBe(3);
    expect(summary.metidosTools.unsafeModeToolCount).toBe(2);
    expect(summary.metidosTools.byTool.new_cron).toEqual(
      snapshot.metidosTools.byTool.new_cron,
    );
    expect(summary.metidosTools.budgets?.budgetCount).toBe(2);
  });
});
