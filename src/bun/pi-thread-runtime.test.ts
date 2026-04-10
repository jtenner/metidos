import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { createPiThreadExtensionUiBridge } from "./pi-extension-ui";
import type { PiGitHubToolHost } from "./pi-github-tools";
import type { PiJoltToolHost } from "./pi-jolt-tools";
import {
  buildPiAgentDirectoryPath,
  buildPiThreadSessionDirectoryPath,
  buildPiThreadToolPolicy,
  createPiThreadRuntime,
  PI_THREAD_RUNTIME_TEST_PROVIDER_ENV,
  PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE,
  runPiDelegatedTask,
} from "./pi-thread-runtime";

const originalPiRuntimeTestProvider =
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV];
const originalAppDataDir = process.env.JOLT_APP_DATA_DIR;
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
const piJoltToolHostStub: PiJoltToolHost = {
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

afterEach(() => {
  if (typeof originalAppDataDir === "string") {
    process.env.JOLT_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.JOLT_APP_DATA_DIR;
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
      "Unsafe mode is enabled. Bash is available, and Jolt tools may create unsafe child threads or cron jobs. Stay within the workspace unless the user explicitly asks for broader host access.",
  });
});

test("creates deterministic Pi sessions and resumes them for the same thread", async () => {
  const appDataDir = mkdtempSync(join(tmpdir(), "jolt-pi-thread-runtime-app-"));
  const codexHomeDir = mkdtempSync(join(tmpdir(), "jolt-codex-home-"));
  const workspaceDir = mkdtempSync(
    join(tmpdir(), "jolt-pi-thread-runtime-ws-"),
  );
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
    PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE;

  try {
    process.env.JOLT_APP_DATA_DIR = appDataDir;
    process.env.CODEX_HOME = codexHomeDir;
    const safeRuntime = await createPiThreadRuntime(
      {
        agentsAccess: true,
        githubAccess: true,
        id: 17,
        joltAccess: true,
        model: "gpt-5.4",
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        unsafeMode: 0,
        worktreePath: workspaceDir,
      },
      {
        appDataDir,
        extensionUiBridge: createPiThreadExtensionUiBridge(),
        githubToolHost: piGitHubToolHostStub,
        joltToolHost: piJoltToolHostStub,
      },
    );

    expect(safeRuntime.sessionDirectory).toBe(
      buildPiThreadSessionDirectoryPath(17, appDataDir),
    );
    expect(safeRuntime.session.getActiveToolNames()).toEqual([
      "read",
      "ls",
      "find",
      "grep",
      "edit",
      "write",
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
    ]);
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
        joltAccess: true,
        model: "gpt-5.4",
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        unsafeMode: 0,
        worktreePath: workspaceDir,
      },
      {
        appDataDir,
        githubToolHost: piGitHubToolHostStub,
        joltToolHost: piJoltToolHostStub,
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
        joltAccess: false,
        model: "gpt-5.4",
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        unsafeMode: 1,
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

test("keeps the explicit OpenAI Codex provider instead of silently normalizing back to plain OpenAI", async () => {
  const appDataDir = mkdtempSync(join(tmpdir(), "jolt-pi-thread-runtime-app-"));
  const codexHomeDir = mkdtempSync(join(tmpdir(), "jolt-codex-home-"));
  const workspaceDir = mkdtempSync(
    join(tmpdir(), "jolt-pi-thread-runtime-ws-"),
  );
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
    PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE;

  try {
    process.env.JOLT_APP_DATA_DIR = appDataDir;
    process.env.CODEX_HOME = codexHomeDir;

    const runtime = await createPiThreadRuntime(
      {
        agentsAccess: false,
        githubAccess: false,
        id: 19,
        joltAccess: false,
        model: "openai-codex:gpt-5.4",
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        unsafeMode: 0,
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
  const appDataDir = mkdtempSync(join(tmpdir(), "jolt-pi-thread-runtime-app-"));
  const codexHomeDir = mkdtempSync(join(tmpdir(), "jolt-codex-home-"));
  const workspaceDir = mkdtempSync(
    join(tmpdir(), "jolt-pi-thread-runtime-ws-"),
  );
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
    PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE;

  try {
    process.env.JOLT_APP_DATA_DIR = appDataDir;
    process.env.CODEX_HOME = codexHomeDir;
    const initialRuntime = await createPiThreadRuntime(
      {
        agentsAccess: false,
        githubAccess: false,
        id: 21,
        joltAccess: false,
        model: "gpt-5.4",
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        unsafeMode: 0,
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
        joltAccess: false,
        model: "gpt-5.4",
        piSessionFile: initialSessionFile,
        projectId: 1,
        reasoningEffort: "medium",
        unsafeMode: 0,
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
  const appDataDir = mkdtempSync(join(tmpdir(), "jolt-pi-delegate-app-"));
  const codexHomeDir = mkdtempSync(join(tmpdir(), "jolt-codex-home-"));
  const workspaceDir = mkdtempSync(join(tmpdir(), "jolt-pi-delegate-ws-"));
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
    PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE;

  try {
    process.env.JOLT_APP_DATA_DIR = appDataDir;
    process.env.CODEX_HOME = codexHomeDir;
    const result = await runPiDelegatedTask(
      {
        agentsAccess: true,
        githubAccess: false,
        id: 23,
        joltAccess: false,
        model: "gpt-5.4",
        piSessionFile: null,
        projectId: 1,
        reasoningEffort: "medium",
        unsafeMode: 0,
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
