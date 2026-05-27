import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSyntheticSourceInfo,
  SessionManager,
  type Skill,
} from "@mariozechner/pi-coding-agent";
import { buildSystemPrompt } from "../../../node_modules/@mariozechner/pi-coding-agent/dist/core/system-prompt";
import { resetResolvedAppDataDirectory } from "../db";
import { createPiThreadExtensionUiBridge } from "./extension-ui";
import type { PiGitHubToolHost } from "./github-tools";
import type { PiMetidosToolHost } from "./metidos/tools";
import type { PluginPromptInjectionRegistrationForThread } from "../plugin/sidecar-manager";
import {
  buildPiAgentDirectoryPath,
  buildPiPromptWithPluginInjections,
  buildPiRuntimeCurrentDateTimePromptLine,
  buildPiThreadSessionDirectoryPath,
  createPiThreadRuntime,
  filterProjectScopedPiSkills,
  PI_THREAD_RUNTIME_TEST_PROVIDER_ENV,
  PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE,
  resolvePiThinkingLevel,
  resolveThreadScopedPath,
} from "./thread-runtime";
import { buildPiThreadToolPolicy } from "./thread-tool-policy";

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
  listCrons: async () => [],
  listProjectWorktrees: async () => [],
  listProjects: async () => [],
  listThreads: async () => [],
  newCron: async () => {
    throw new Error("newCron should not run in this test.");
  },
  notifyUser: async () => ({
    deliveryId: 1,
    message: "Notification queued.",
    status: "delivered",
  }),
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
  "metidos_list_permissions",
  "list_crons",
  "show_cron",
  "new_cron",
  "update_cron",
  "model_providers",
  "models_query",
  "new_thread",
  "update_plan",
  "delegate_task",
];

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
      permissions: [],
    }),
  ).toEqual({
    activeToolNames: ["read", "ls", "find", "grep", "edit", "write"],
    allowBash: false,
    allowUnsafeModeEscalation: false,
    runtimePromptLine:
      "Unsafe mode is disabled. Bash is unavailable. Use the installed worktree-scoped file/search tools instead. new_thread requests user approval before creating child threads, including unsafe ones; unsafe child cron jobs remain unavailable.",
  });
  expect(
    buildPiThreadToolPolicy({
      permissions: ["metidos:unsafe"],
    }),
  ).toEqual({
    activeToolNames: ["read", "bash", "ls", "find", "grep", "edit", "write"],
    allowBash: true,
    allowUnsafeModeEscalation: true,
    runtimePromptLine:
      "Unsafe mode is enabled. Bash is available, and Metidos tools may create unsafe child threads or cron jobs. Stay within the workspace unless the user explicitly asks for broader host access.",
  });
});

test("buildPiRuntimeCurrentDateTimePromptLine formats the user's time in the effective timezone", () => {
  expect(
    buildPiRuntimeCurrentDateTimePromptLine(
      "America/New_York",
      new Date("2026-05-01T02:30:00.000Z"),
    ),
  ).toBe(
    "The current user's time is Thursday, April 30, 2026 at 10:30:00 PM EDT (America/New_York).",
  );
});

test("plugin prompt injections are prepended to the user prompt", async () => {
  const calls: string[] = [];
  const manager = {
    listPromptInjectionRegistrationsForThread: () => [
      {
        directoryName: "alpha_plugin",
        inject: "alpha",
        pluginId: "alpha_plugin",
        promptHandle: "prompt:alpha",
        timeoutMs: 5_000,
      },
      {
        directoryName: "beta_plugin",
        inject: "beta",
        pluginId: "beta_plugin",
        promptHandle: "prompt:beta",
        timeoutMs: 5_000,
      },
    ],
    invokePromptInjection: async ({
      prompt,
      registration,
    }: {
      prompt: string;
      registration: PluginPromptInjectionRegistrationForThread;
    }) => {
      calls.push(`${registration.inject}:${prompt}`);
      return `[${registration.inject} inject]`;
    },
  };

  const prompt = await buildPiPromptWithPluginInjections({
    pluginSidecarManager: manager as never,
    prompt: "[user message]",
    thread: {
      id: 1,
      model: "test:model",
      permissions: ["alpha_plugin:context", "beta_plugin:context"],
      piSessionFile: null,
      projectId: 2,
      reasoningEffort: "medium",
      worktreePath: "/repo",
    },
  });

  expect(calls).toEqual(["alpha:[user message]", "beta:[user message]"]);
  expect(prompt).toBe("[alpha inject]\n[beta inject]\n[user message]");
});

test("patched Pi system prompt leaves date injection to Metidos", () => {
  const prompt = buildSystemPrompt({
    appendSystemPrompt: buildPiRuntimeCurrentDateTimePromptLine(
      "America/New_York",
      new Date("2026-05-01T02:30:00.000Z"),
    ),
    cwd: "/repo",
    selectedTools: ["read"],
    toolSnippets: {
      read: "Read file contents",
    },
  });

  expect(prompt).toContain(
    "The current user's time is Thursday, April 30, 2026 at 10:30:00 PM EDT (America/New_York).",
  );
  expect(prompt).not.toContain("\nCurrent date:");
  expect(prompt.endsWith("\nCurrent working directory: /repo")).toBe(true);
});

test("resolveThreadScopedPath rejects symlink escapes from the worktree", () => {
  const worktreePath = mkdtempSync(
    join(tmpdir(), "metidos-pi-thread-runtime-ws-"),
  );
  const outsidePath = mkdtempSync(
    join(tmpdir(), "metidos-pi-thread-runtime-out-"),
  );

  try {
    mkdirSync(join(worktreePath, "src"));
    mkdirSync(join(worktreePath, "nested"));
    writeFileSync(join(worktreePath, "src", "inside.txt"), "inside", "utf8");
    writeFileSync(join(outsidePath, "secret.txt"), "secret", "utf8");
    symlinkSync(outsidePath, join(worktreePath, "linked-outside"), "dir");
    symlinkSync(
      join(worktreePath, "nested"),
      join(worktreePath, "linked-inside"),
      "dir",
    );
    symlinkSync(
      outsidePath,
      join(worktreePath, "nested", "linked-outside"),
      "dir",
    );
    symlinkSync(
      join(outsidePath, "missing.txt"),
      join(worktreePath, "broken-outside-link"),
    );

    expect(resolveThreadScopedPath(worktreePath, "src/inside.txt")).toBe(
      join(worktreePath, "src", "inside.txt"),
    );
    expect(resolveThreadScopedPath(worktreePath, "src/new-file.txt")).toBe(
      join(worktreePath, "src", "new-file.txt"),
    );
    expect(() => resolveThreadScopedPath(worktreePath, "..\\evil.txt")).toThrow(
      "Path is outside the current workspace root",
    );
    expect(() =>
      resolveThreadScopedPath(worktreePath, "src\\..\\evil.txt"),
    ).toThrow("Path is outside the current workspace root");
    expect(() =>
      resolveThreadScopedPath(worktreePath, "linked-outside/secret.txt"),
    ).toThrow("Path is outside the current workspace root");
    expect(() =>
      resolveThreadScopedPath(worktreePath, "linked-outside/new-file.txt"),
    ).toThrow("Path is outside the current workspace root");
    expect(() =>
      resolveThreadScopedPath(
        worktreePath,
        "linked-inside/linked-outside/secret.txt",
      ),
    ).toThrow("Path is outside the current workspace root");
    expect(() =>
      resolveThreadScopedPath(worktreePath, "broken-outside-link"),
    ).toThrow("Path is outside the current workspace root");
  } finally {
    rmSync(worktreePath, {
      force: true,
      recursive: true,
    });
    rmSync(outsidePath, {
      force: true,
      recursive: true,
    });
  }
});

test("filterProjectScopedPiSkills keeps only skills inside the worktree", () => {
  const worktreePath = "/repo";
  const projectSkill: Skill = {
    name: "project-skill",
    description: "Project-local skill",
    filePath: "/repo/.pi/skills/project-skill/SKILL.md",
    baseDir: "/repo/.pi/skills/project-skill",
    disableModelInvocation: false,
    sourceInfo: createSyntheticSourceInfo(
      "/repo/.pi/skills/project-skill/SKILL.md",
      { source: "sdk" },
    ),
  };
  const globalSkill: Skill = {
    name: "global-skill",
    description: "Global skill",
    filePath: "/home/test/.pi/agent/skills/global-skill/SKILL.md",
    baseDir: "/home/test/.pi/agent/skills/global-skill",
    disableModelInvocation: false,
    sourceInfo: createSyntheticSourceInfo(
      "/home/test/.pi/agent/skills/global-skill/SKILL.md",
      { source: "sdk" },
    ),
  };
  const skills = [projectSkill, globalSkill];

  expect(filterProjectScopedPiSkills(worktreePath, skills)).toEqual([
    projectSkill,
  ]);
});

test("filterProjectScopedPiSkills rejects skill paths through worktree symlinks", () => {
  const worktreePath = mkdtempSync(
    join(tmpdir(), "metidos-pi-thread-runtime-ws-"),
  );
  const outsidePath = mkdtempSync(
    join(tmpdir(), "metidos-pi-thread-runtime-out-"),
  );

  try {
    mkdirSync(join(outsidePath, "skills", "escaped-skill"), {
      recursive: true,
    });
    const escapedSkillPath = join(
      outsidePath,
      "skills",
      "escaped-skill",
      "SKILL.md",
    );
    writeFileSync(escapedSkillPath, "# escaped skill\n", "utf8");
    symlinkSync(outsidePath, join(worktreePath, "linked-outside"), "dir");

    const projectSkill: Skill = {
      name: "escaped-skill",
      description: "Escaped skill",
      filePath: join(
        worktreePath,
        "linked-outside",
        "skills",
        "escaped-skill",
        "SKILL.md",
      ),
      baseDir: join(worktreePath, "linked-outside", "skills", "escaped-skill"),
      disableModelInvocation: false,
      sourceInfo: createSyntheticSourceInfo(escapedSkillPath, {
        source: "sdk",
      }),
    };

    expect(filterProjectScopedPiSkills(worktreePath, [projectSkill])).toEqual(
      [],
    );
  } finally {
    rmSync(worktreePath, {
      force: true,
      recursive: true,
    });
    rmSync(outsidePath, {
      force: true,
      recursive: true,
    });
  }
});

test("resolvePiThinkingLevel maps provider-specific reasoning controls", () => {
  expect(
    resolvePiThinkingLevel("mistral:magistral-medium-latest", "minimal"),
  ).toBe("off");
  expect(
    resolvePiThinkingLevel("mistral:magistral-medium-latest", "high"),
  ).toBe("high");
  expect(resolvePiThinkingLevel("zai:glm-5", "medium")).toBe("high");
  expect(resolvePiThinkingLevel("xai:grok-4-1-fast", "minimal")).toBe(
    "minimal",
  );
  expect(resolvePiThinkingLevel("openai:gpt-5.4", "minimal")).toBe("minimal");
});

test("creates deterministic Pi runtime directories and tool suites", async () => {
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
        id: 17,
        model: "gpt-5.4",
        permissions: [
          "metidos:agents",
          "metidos:crons",
          "metidos:github",
          "metidos:threads",
          "metidos:web-search",
        ],
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
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
      EXPECTED_SAFE_RUNTIME_TOOL_NAMES,
    );
    expect(safeRuntime.session.extensionRunner).toBeDefined();

    safeRuntime.session.dispose();

    const unsafeRuntime = await createPiThreadRuntime(
      {
        id: 18,
        model: "gpt-5.4",
        permissions: ["metidos:unsafe", "metidos:web-search"],
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
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

test("metidos:git installs the local git tool suite into safe runtimes", async () => {
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
        id: 18_001,
        model: "gpt-5.4",
        permissions: ["metidos:git", "metidos:web-search"],
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        worktreePath: workspaceDir,
      },
      {
        appDataDir,
      },
    );

    try {
      expect(runtime.session.getActiveToolNames()).toContain("git_status");
      expect(runtime.session.getActiveToolNames()).toContain("git_log");
      expect(runtime.session.getActiveToolNames()).toContain("git_commit");
      expect(runtime.session.systemPrompt).toContain(
        "Local Git CLI tools are installed in this runtime: git_status, git_diff, git_log, git_add, git_commit, git_switch, and related worktree-scoped git_* helpers.",
      );
    } finally {
      runtime.session.dispose();
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

test("metidos:sqlite installs the project-scoped sqlite tool into safe runtimes", async () => {
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
        id: 18_002,
        model: "gpt-5.4",
        permissions: ["metidos:sqlite", "metidos:web-search"],
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        worktreePath: workspaceDir,
      },
      {
        appDataDir,
      },
    );

    try {
      expect(runtime.session.getActiveToolNames()).toContain("sqlite");
      expect(runtime.session.systemPrompt).toContain(
        "Project-scoped SQLite tools are installed in this runtime: sqlite. Use them for SQLite queries against database files inside the current workspace.",
      );
    } finally {
      runtime.session.dispose();
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

test("metidos:webserver installs the project-scoped web server tool suite into safe runtimes", async () => {
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
        id: 18_003,
        model: "gpt-5.4",
        permissions: ["metidos:webserver"],
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        worktreePath: workspaceDir,
      },
      {
        appDataDir,
      },
    );

    try {
      expect(runtime.session.getActiveToolNames()).toContain("web_server_host");
      expect(runtime.session.getActiveToolNames()).toContain("web_server_stop");
      expect(runtime.session.getActiveToolNames()).toContain("web_server_list");
      expect(runtime.session.systemPrompt).toContain(
        "Project-scoped WebServer tools are installed in this runtime: web_server_host, web_server_stop, and web_server_list.",
      );
    } finally {
      runtime.session.dispose();
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

test("native permission strings independently gate runtime tool families", async () => {
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

    const cases: Array<{
      absent?: string[];
      expected: string[];
      permission: string;
    }> = [
      {
        expected: ["web_search", "web_fetch"],
        permission: "metidos:web-search",
      },
      { expected: ["web_server_host"], permission: "metidos:webserver" },
      { expected: ["github_repo"], permission: "metidos:github" },
      { expected: ["git_status"], permission: "metidos:git" },
      { expected: ["sqlite"], permission: "metidos:sqlite" },
      {
        expected: ["lancedb_upsert", "lancedb_query", "lancedb_delete"],
        permission: "metidos:lancedb",
      },
      {
        expected: ["update_plan", "delegate_task"],
        permission: "metidos:agents",
      },
      { expected: ["list_calendars"], permission: "metidos:calendar" },
      { expected: ["notify_user"], permission: "metidos:notifications" },
      {
        absent: ["list_crons", "new_cron"],
        expected: ["new_thread"],
        permission: "metidos:threads",
      },
      {
        absent: ["new_thread"],
        expected: ["list_crons", "new_cron"],
        permission: "metidos:crons",
      },
      { expected: ["bash"], permission: "metidos:unsafe" },
    ];

    for (const [index, item] of cases.entries()) {
      const runtime = await createPiThreadRuntime(
        {
          id: 30_000 + index,
          model: "gpt-5.4",
          permissions: [item.permission],
          piSessionFile: null,
          projectId: 1,
          reasoningEffort: "medium",
          worktreePath: workspaceDir,
        },
        {
          appDataDir,
          githubToolHost: piGitHubToolHostStub,
          metidosToolHost: piMetidosToolHostStub,
        },
      );
      try {
        const activeToolNames = runtime.session.getActiveToolNames();
        for (const toolName of item.expected) {
          expect(activeToolNames).toContain(toolName);
        }
        for (const toolName of item.absent ?? []) {
          expect(activeToolNames).not.toContain(toolName);
        }
      } finally {
        runtime.session.dispose();
      }
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
    const targetSessionManager = SessionManager.create(
      workspaceDir,
      buildPiThreadSessionDirectoryPath(22, appDataDir),
    );
    targetSessionManager.appendMessage({
      api: "openai-responses",
      content: [
        {
          text: "persisted session target",
          type: "text",
        },
      ],
      model: "gpt-5.4",
      provider: "openai",
      role: "assistant",
      stopReason: "stop",
      timestamp: Date.now(),
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 0,
          output: 0,
          total: 0,
        },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    });
    const initialSessionFile = targetSessionManager.getSessionFile();
    if (!initialSessionFile) {
      throw new Error("Expected the target session to be persisted.");
    }

    const alternateSessionManager = SessionManager.create(
      workspaceDir,
      buildPiThreadSessionDirectoryPath(22, appDataDir),
    );
    alternateSessionManager.appendMessage({
      api: "openai-responses",
      content: [
        {
          text: "newer alternate session",
          type: "text",
        },
      ],
      model: "gpt-5.4",
      provider: "openai",
      role: "assistant",
      stopReason: "stop",
      timestamp: Date.now(),
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 0,
          output: 0,
          total: 0,
        },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    });
    const alternateSessionFile = alternateSessionManager.getSessionFile();

    expect(alternateSessionFile).not.toBe(initialSessionFile);

    const reopenedRuntime = await createPiThreadRuntime(
      {
        id: 22,
        model: "gpt-5.4",
        permissions: ["metidos:web-search"],
        piSessionFile: initialSessionFile,
        projectId: 1,
        reasoningEffort: "medium",
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
