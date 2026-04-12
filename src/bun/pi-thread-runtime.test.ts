import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { resetResolvedAppDataDirectory } from "./db";
import { createPiThreadExtensionUiBridge } from "./pi-extension-ui";
import type { PiGitHubToolHost } from "./pi-github-tools";
import type { PiMetidosToolHost } from "./pi-metidos-tools";
import { usesPiNativeWebSearch } from "./pi-native-web-search";
import {
  buildPiAgentDirectoryPath,
  buildPiThreadSessionDirectoryPath,
  buildPiThreadToolPolicy,
  createPiThreadRuntime,
  PI_THREAD_RUNTIME_TEST_PROVIDER_ALL_PROVIDERS_PROBE,
  PI_THREAD_RUNTIME_TEST_PROVIDER_ENV,
  PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE,
  resolvePiThinkingLevel,
  runPiDelegatedTask,
} from "./pi-thread-runtime";
import { buildModelCatalog } from "./project-procedures/model-catalog";
import { buildPiModelsJsonPath } from "./project-procedures/ollama-provider-config";

const originalPiRuntimeTestProvider =
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV];
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
const originalCodexHome = process.env.CODEX_HOME;
const piGitHubToolHostStub: PiGitHubToolHost = {
  getIssue: async () => {
    throw new Error("getIssue should not run in this test.");
  },
  getPullRequest: async () => {
    throw new Error("getPullRequest should not run in this test.");
  },
  getPullRequestChecks: async () => {
    throw new Error("getPullRequestChecks should not run in this test.");
  },
  getPullRequestDiff: async () => {
    throw new Error("getPullRequestDiff should not run in this test.");
  },
  getRepositoryContext: async () => {
    throw new Error("getRepositoryContext should not run in this test.");
  },
};
const piMetidosToolHostStub: PiMetidosToolHost = {
  createThread: async () => {
    throw new Error("createThread should not run in this test.");
  },
  focusContext: async () => {
    throw new Error("focusContext should not run in this test.");
  },
  listCrons: async () => [],
  listProjectWorktrees: async () => [],
  listProjects: async () => [],
  listThreads: async () => [],
  newCron: async () => {
    throw new Error("newCron should not run in this test.");
  },
  requestThreadStart: async () => {
    throw new Error("requestThreadStart should not run in this test.");
  },
  sendThreadMessage: async () => {
    throw new Error("sendThreadMessage should not run in this test.");
  },
  updateCron: async () => {
    throw new Error("updateCron should not run in this test.");
  },
  updateThreadMetadata: async () => {
    throw new Error("updateThreadMetadata should not run in this test.");
  },
};
const EXPECTED_SAFE_RUNTIME_TOOL_NAMES: string[] = [
  "read",
  "ls",
  "find",
  "grep",
  "edit",
  "write",
  "web_search",
  "web_fetch",
  "github_repo",
  "github_issue",
  "github_pr",
  "github_pr_checks",
  "github_pr_diff",
  "update_thread",
  "list_threads",
  "run_untrusted_js",
  "set_context",
  "list_crons",
  "new_cron",
  "update_cron",
  "new_thread",
  "update_plan",
  "delegate_task",
];

function expectedSafeRuntimeToolNamesForModel(options: {
  nativeWebSearch: boolean;
}): string[] {
  if (options.nativeWebSearch) {
    return EXPECTED_SAFE_RUNTIME_TOOL_NAMES.filter(
      (name) => name !== "web_search" && name !== "web_fetch",
    );
  }
  return EXPECTED_SAFE_RUNTIME_TOOL_NAMES;
}

function collectAssistantText(
  runtime: Awaited<ReturnType<typeof createPiThreadRuntime>>,
) {
  let text = "";
  const unsubscribe = runtime.session.subscribe((event) => {
    if (
      event.type !== "message_update" ||
      event.assistantMessageEvent.type !== "text_delta"
    ) {
      return;
    }
    text += event.assistantMessageEvent.delta ?? "";
  });
  return {
    getText: () => text,
    unsubscribe,
  };
}

function extractProbeField(
  reply: string,
  fieldName: "promptTools" | "tools",
): string {
  const match = reply.match(new RegExp(`\\b${fieldName}=([^\\s]+)`, "u"));
  return match?.[1] ?? "";
}

function writeOllamaModelsJson(appDataDir: string): void {
  const modelsJsonPath = buildPiModelsJsonPath(appDataDir);
  mkdirSync(dirname(modelsJsonPath), { recursive: true });
  writeFileSync(
    modelsJsonPath,
    JSON.stringify(
      {
        providers: {
          ollama: {
            api: "openai-completions",
            apiKey: "ollama",
            baseUrl: "http://localhost:11434/v1",
            compat: {
              supportsDeveloperRole: false,
              supportsReasoningEffort: false,
            },
            models: [
              {
                id: "qwen2.5-coder:7b",
              },
            ],
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

afterEach(() => {
  resetResolvedAppDataDirectory();
  if (typeof originalAppDataDir === "string") {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.METIDOS_APP_DATA_DIR;
  }
  if (typeof originalPiRuntimeTestProvider === "string") {
    process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
      originalPiRuntimeTestProvider;
  } else {
    delete process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV];
  }
  if (typeof originalCodexHome === "string") {
    process.env.CODEX_HOME = originalCodexHome;
  } else {
    delete process.env.CODEX_HOME;
  }
});

test("buildPiThreadToolPolicy disables bash and unsafe child escalation in safe mode", () => {
  expect(
    buildPiThreadToolPolicy({
      unsafeMode: 0,
    }),
  ).toEqual({
    allowBash: false,
    allowUnsafeModeEscalation: false,
    runtimePromptLine:
      "Unsafe mode is disabled. Bash is unavailable. Use the installed worktree-scoped file/search tools instead, and do not create unsafe child threads or cron jobs.",
  });
  expect(
    buildPiThreadToolPolicy({
      unsafeMode: 1,
    }),
  ).toEqual({
    allowBash: true,
    allowUnsafeModeEscalation: true,
    runtimePromptLine:
      "Unsafe mode is enabled. Bash is available, and Metidos tools may create unsafe child threads or cron jobs. Stay within the workspace unless the user explicitly asks for broader host access.",
  });
});

test("resolvePiThinkingLevel maps binary providers to Instant versus Thinking", () => {
  expect(
    resolvePiThinkingLevel("mistral:magistral-medium-latest", "minimal"),
  ).toBe("off");
  expect(
    resolvePiThinkingLevel("mistral:magistral-medium-latest", "high"),
  ).toBe("high");
  expect(resolvePiThinkingLevel("zai:glm-5", "medium")).toBe("high");
  expect(resolvePiThinkingLevel("openai:gpt-5.4", "minimal")).toBe("minimal");
});

test("creates deterministic Pi sessions and resumes them for the same thread", async () => {
  const appDataDir = mkdtempSync(
    join(tmpdir(), "metidos-pi-thread-runtime-app-"),
  );
  const codexHomeDir = mkdtempSync(join(tmpdir(), "metidos-codex-home-"));
  const workspaceDir = mkdtempSync(
    join(tmpdir(), "metidos-pi-thread-runtime-ws-"),
  );
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
    PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE;

  try {
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    process.env.CODEX_HOME = codexHomeDir;
    const safeRuntime = await createPiThreadRuntime(
      {
        agentsAccess: true,
        githubAccess: true,
        id: 17,
        metidosAccess: true,
        model: "gpt-5.4",
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        unsafeMode: 0,
        webSearchAccess: true,
        worktreePath: workspaceDir,
      },
      {
        appDataDir,
        extensionUiBridge: createPiThreadExtensionUiBridge(),
        githubToolHost: piGitHubToolHostStub,
        metidosToolHost: piMetidosToolHostStub,
      },
    );

    expect(safeRuntime.sessionDirectory).toBe(
      buildPiThreadSessionDirectoryPath(17, appDataDir),
    );
    expect(safeRuntime.session.getActiveToolNames()).toEqual(
      expectedSafeRuntimeToolNamesForModel({
        nativeWebSearch: usesPiNativeWebSearch(safeRuntime.model),
      }),
    );
    expect(safeRuntime.session.extensionRunner).toBeDefined();

    const streamed = collectAssistantText(safeRuntime);
    await safeRuntime.session.prompt("resume-safe-runtime");
    streamed.unsubscribe();

    expect(streamed.getText()).toContain("pi-runtime-probe");
    expect(streamed.getText()).toContain("resume-safe-runtime");

    const initialSessionId = safeRuntime.session.sessionId;
    const initialSessionFile = safeRuntime.session.sessionFile;
    safeRuntime.session.dispose();

    const resumedRuntime = await createPiThreadRuntime(
      {
        agentsAccess: true,
        githubAccess: true,
        id: 17,
        metidosAccess: true,
        model: "gpt-5.4",
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        unsafeMode: 0,
        webSearchAccess: true,
        worktreePath: workspaceDir,
      },
      {
        appDataDir,
        githubToolHost: piGitHubToolHostStub,
        metidosToolHost: piMetidosToolHostStub,
      },
    );

    expect(resumedRuntime.session.sessionId).toBe(initialSessionId);
    expect(resumedRuntime.session.sessionFile).toBe(initialSessionFile);
    resumedRuntime.session.dispose();

    const unsafeRuntime = await createPiThreadRuntime(
      {
        agentsAccess: false,
        githubAccess: false,
        id: 18,
        metidosAccess: false,
        model: "gpt-5.4",
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        unsafeMode: 1,
        webSearchAccess: true,
        worktreePath: workspaceDir,
      },
      {
        appDataDir,
      },
    );

    expect(unsafeRuntime.session.getActiveToolNames()).toEqual([
      "read",
      "bash",
      "ls",
      "find",
      "grep",
      "edit",
      "write",
      "web_search",
      "web_fetch",
    ]);
    unsafeRuntime.session.dispose();
  } finally {
    rmSync(appDataDir, {
      force: true,
      recursive: true,
    });
    rmSync(codexHomeDir, {
      force: true,
      recursive: true,
    });
    rmSync(workspaceDir, {
      force: true,
      recursive: true,
    });
  }
});

test("every provider runtime exposes Metidos, GitHub, and agent tools to the model context", async () => {
  const appDataDir = mkdtempSync(
    join(tmpdir(), "metidos-pi-thread-runtime-app-"),
  );
  const codexHomeDir = mkdtempSync(join(tmpdir(), "metidos-codex-home-"));
  const workspaceDir = mkdtempSync(
    join(tmpdir(), "metidos-pi-thread-runtime-ws-"),
  );
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
    PI_THREAD_RUNTIME_TEST_PROVIDER_ALL_PROVIDERS_PROBE;

  try {
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    process.env.CODEX_HOME = codexHomeDir;
    writeOllamaModelsJson(appDataDir);
    resetResolvedAppDataDirectory();

    const sampleModelByProvider = new Map<string, string>();
    for (const model of buildModelCatalog().models) {
      if (model.id === "ollama:__setup__") {
        continue;
      }
      if (!sampleModelByProvider.has(model.providerId)) {
        sampleModelByProvider.set(model.providerId, model.id);
      }
    }

    expect(sampleModelByProvider.has("ollama")).toBeTrue();
    expect(sampleModelByProvider.has("openai")).toBeTrue();
    expect(sampleModelByProvider.has("openai-codex")).toBeTrue();

    let threadId = 10_000;
    for (const modelId of sampleModelByProvider.values()) {
      const runtime = await createPiThreadRuntime(
        {
          agentsAccess: true,
          githubAccess: true,
          id: threadId,
          metidosAccess: true,
          model: modelId,
          piSessionFile: null,
          projectId: 1,
          reasoningEffort: "medium",
          unsafeMode: 0,
          webSearchAccess: true,
          worktreePath: workspaceDir,
        },
        {
          appDataDir,
          githubToolHost: piGitHubToolHostStub,
          metidosToolHost: piMetidosToolHostStub,
        },
      );

      try {
        const expectedToolNames = expectedSafeRuntimeToolNamesForModel({
          nativeWebSearch: usesPiNativeWebSearch(runtime.model),
        });
        expect(runtime.session.getActiveToolNames()).toEqual(expectedToolNames);
        expect(runtime.session.systemPrompt).toContain(
          "Agent coordination tools are installed in this runtime: update_plan and delegate_task.",
        );
        expect(runtime.session.systemPrompt).toContain(
          "GitHub-native tools are installed in this runtime: github_repo, github_issue, github_pr, github_pr_checks, and github_pr_diff.",
        );
        expect(runtime.session.systemPrompt).toContain(
          "Metidos-native tools are installed in this runtime: update_thread, list_threads, run_untrusted_js, set_context, list_crons, new_cron, update_cron, and new_thread.",
        );

        const streamed = collectAssistantText(runtime);
        await runtime.session.prompt("provider-tool-visibility-check");
        streamed.unsubscribe();

        expect(
          new Set(extractProbeField(streamed.getText(), "tools").split(",")),
        ).toEqual(new Set(expectedToolNames));
        expect(extractProbeField(streamed.getText(), "promptTools")).toBe(
          "agents,github,metidos",
        );
      } finally {
        runtime.session.dispose();
      }
      threadId += 1;
    }
  } finally {
    rmSync(appDataDir, {
      force: true,
      recursive: true,
    });
    rmSync(codexHomeDir, {
      force: true,
      recursive: true,
    });
    rmSync(workspaceDir, {
      force: true,
      recursive: true,
    });
  }
});

test("keeps the explicit OpenAI Codex provider instead of silently normalizing back to plain OpenAI", async () => {
  const appDataDir = mkdtempSync(
    join(tmpdir(), "metidos-pi-thread-runtime-app-"),
  );
  const codexHomeDir = mkdtempSync(join(tmpdir(), "metidos-codex-home-"));
  const workspaceDir = mkdtempSync(
    join(tmpdir(), "metidos-pi-thread-runtime-ws-"),
  );
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
    PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE;

  try {
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    process.env.CODEX_HOME = codexHomeDir;

    const runtime = await createPiThreadRuntime(
      {
        agentsAccess: false,
        githubAccess: false,
        id: 19,
        metidosAccess: false,
        model: "openai-codex:gpt-5.4",
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        unsafeMode: 0,
        webSearchAccess: true,
        worktreePath: workspaceDir,
      },
      {
        appDataDir,
      },
    );

    expect(runtime.model.provider).toBe("openai-codex");
    expect(`${runtime.model.provider}:${runtime.model.id}`).toBe(
      "openai-codex:gpt-5.4",
    );
    expect(usesPiNativeWebSearch(runtime.model)).toBeTrue();
    expect(runtime.session.getActiveToolNames()).not.toContain("web_search");
    expect(runtime.session.getActiveToolNames()).not.toContain("web_fetch");
    expect(runtime.session.systemPrompt).toContain(
      "Provider-native web search is enabled for this runtime through the OpenAI Codex Responses API.",
    );
    runtime.session.dispose();
  } finally {
    rmSync(appDataDir, {
      force: true,
      recursive: true,
    });
    rmSync(codexHomeDir, {
      force: true,
      recursive: true,
    });
    rmSync(workspaceDir, {
      force: true,
      recursive: true,
    });
  }
});

test("rewires xAI models onto Responses API so native web search can be enabled", async () => {
  const appDataDir = mkdtempSync(
    join(tmpdir(), "metidos-pi-thread-runtime-app-"),
  );
  const codexHomeDir = mkdtempSync(join(tmpdir(), "metidos-codex-home-"));
  const workspaceDir = mkdtempSync(
    join(tmpdir(), "metidos-pi-thread-runtime-ws-"),
  );

  try {
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    process.env.CODEX_HOME = codexHomeDir;

    const runtime = await createPiThreadRuntime(
      {
        agentsAccess: false,
        githubAccess: false,
        id: 20,
        metidosAccess: false,
        model: "xai:grok-4-1-fast",
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        unsafeMode: 0,
        webSearchAccess: true,
        worktreePath: workspaceDir,
      },
      {
        appDataDir,
      },
    );

    expect(runtime.model.provider).toBe("xai");
    expect(runtime.model.api).toBe("openai-responses");
    expect(usesPiNativeWebSearch(runtime.model)).toBeTrue();
    expect(runtime.session.getActiveToolNames()).not.toContain("web_search");
    expect(runtime.session.getActiveToolNames()).not.toContain("web_fetch");
    expect(runtime.session.systemPrompt).toContain(
      "Provider-native web search is enabled for this runtime through the xAI Responses API.",
    );
    runtime.session.dispose();
  } finally {
    rmSync(appDataDir, {
      force: true,
      recursive: true,
    });
    rmSync(codexHomeDir, {
      force: true,
      recursive: true,
    });
    rmSync(workspaceDir, {
      force: true,
      recursive: true,
    });
  }
});

test("reopens the persisted Pi session file instead of the most recent session", async () => {
  const appDataDir = mkdtempSync(
    join(tmpdir(), "metidos-pi-thread-runtime-app-"),
  );
  const codexHomeDir = mkdtempSync(join(tmpdir(), "metidos-codex-home-"));
  const workspaceDir = mkdtempSync(
    join(tmpdir(), "metidos-pi-thread-runtime-ws-"),
  );
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
    PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE;

  try {
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    process.env.CODEX_HOME = codexHomeDir;
    const initialRuntime = await createPiThreadRuntime(
      {
        agentsAccess: false,
        githubAccess: false,
        id: 21,
        metidosAccess: false,
        model: "gpt-5.4",
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        unsafeMode: 0,
        webSearchAccess: true,
        worktreePath: workspaceDir,
      },
      {
        appDataDir,
      },
    );

    await initialRuntime.session.prompt("persisted-session-target");
    const initialSessionFile = initialRuntime.session.sessionFile;
    initialRuntime.session.dispose();

    if (!initialSessionFile) {
      throw new Error(
        "Expected the initial Pi runtime to persist a session file.",
      );
    }

    const alternateSessionManager = SessionManager.create(
      workspaceDir,
      buildPiThreadSessionDirectoryPath(21, appDataDir),
    );
    alternateSessionManager.appendMessage({
      content: [
        {
          text: "newer alternate session",
          type: "text",
        },
      ],
      role: "user",
      timestamp: Date.now(),
    });
    const alternateSessionFile = alternateSessionManager.getSessionFile();

    expect(alternateSessionFile).not.toBe(initialSessionFile);

    const reopenedRuntime = await createPiThreadRuntime(
      {
        agentsAccess: false,
        githubAccess: false,
        id: 21,
        metidosAccess: false,
        model: "gpt-5.4",
        piSessionFile: initialSessionFile,
        projectId: 1,
        reasoningEffort: "medium",
        unsafeMode: 0,
        webSearchAccess: true,
        worktreePath: workspaceDir,
      },
      {
        appDataDir,
      },
    );

    expect(reopenedRuntime.agentDirectory).toBe(
      buildPiAgentDirectoryPath(appDataDir),
    );
    expect(reopenedRuntime.session.sessionFile).toBe(initialSessionFile);
    reopenedRuntime.session.dispose();
  } finally {
    rmSync(appDataDir, {
      force: true,
      recursive: true,
    });
    rmSync(codexHomeDir, {
      force: true,
      recursive: true,
    });
    rmSync(workspaceDir, {
      force: true,
      recursive: true,
    });
  }
});

test("runPiDelegatedTask executes an isolated child session without agent recursion", async () => {
  const appDataDir = mkdtempSync(join(tmpdir(), "metidos-pi-delegate-app-"));
  const codexHomeDir = mkdtempSync(join(tmpdir(), "metidos-codex-home-"));
  const workspaceDir = mkdtempSync(join(tmpdir(), "metidos-pi-delegate-ws-"));
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
    PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE;

  try {
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    process.env.CODEX_HOME = codexHomeDir;
    const result = await runPiDelegatedTask(
      {
        agentsAccess: true,
        githubAccess: false,
        id: 23,
        metidosAccess: false,
        model: "gpt-5.4",
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        unsafeMode: 0,
        webSearchAccess: true,
        worktreePath: workspaceDir,
      },
      {
        model: null,
        reasoningEffort: "low",
        task: "delegate-safe-runtime",
      },
      {
        appDataDir,
      },
    );

    expect(result.outputText).toContain("pi-runtime-probe");
    expect(result.outputText).toContain("delegate-safe-runtime");
    expect(result.reasoningEffort).toBe("low");
    expect(result.activeToolNames).toEqual([
      "read",
      "ls",
      "find",
      "grep",
      "edit",
      "write",
      "web_search",
      "web_fetch",
    ]);
  } finally {
    rmSync(appDataDir, {
      force: true,
      recursive: true,
    });
    rmSync(codexHomeDir, {
      force: true,
      recursive: true,
    });
    rmSync(workspaceDir, {
      force: true,
      recursive: true,
    });
  }
});
