/**
 * @file src/bun/project-procedures-config.test.ts
 * @description Test file for project procedure configuration helpers.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAppDatabase, resetResolvedAppDataDirectory } from "./db";
import { codexModelSupportsReasoningEffort } from "./project-procedures/model-catalog";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.JOLT_APP_DATA_DIR;
const originalXaiApiKey = process.env.XAI_API_KEY;

type ProjectProceduresModule = typeof import("./project-procedures");

let projectProcedures: ProjectProceduresModule | null = null;

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

function initializeGitRepository(path: string): void {
  execFileSync("git", ["init"], {
    cwd: path,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: path,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Test User"], {
    cwd: path,
    stdio: "ignore",
  });
  writeFileSync(join(path, "README.md"), "# Test repo\n");
  execFileSync("git", ["add", "."], {
    cwd: path,
    stdio: "ignore",
  });
  execFileSync("git", ["commit", "-m", "init"], {
    cwd: path,
    stdio: "ignore",
  });
}

async function loadProjectProcedures() {
  if (projectProcedures) {
    return projectProcedures;
  }

  closeAppDatabase();
  resetResolvedAppDataDirectory();
  process.env.JOLT_APP_DATA_DIR = createTempDirectory("jolt-procedures-db-");
  projectProcedures = (await import(
    `./project-procedures?project-procedures-config=${Date.now()}`
  )) as ProjectProceduresModule;
  return projectProcedures;
}

beforeAll(async () => {
  await loadProjectProcedures();
});

afterEach(() => {
  projectProcedures?.shutdownProjectPolling();
  if (typeof originalXaiApiKey === "string") {
    process.env.XAI_API_KEY = originalXaiApiKey;
  } else {
    delete process.env.XAI_API_KEY;
  }
});

afterAll(async () => {
  projectProcedures?.shutdownProjectPolling();
  await projectProcedures?.shutdownActiveThreadTurns();
  closeAppDatabase();
  resetResolvedAppDataDirectory();

  if (typeof originalAppDataDir === "string") {
    process.env.JOLT_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.JOLT_APP_DATA_DIR;
  }

  if (typeof originalXaiApiKey === "string") {
    process.env.XAI_API_KEY = originalXaiApiKey;
  } else {
    delete process.env.XAI_API_KEY;
  }

  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("project procedure configuration helpers", () => {
  it("builds a codex config that enforces thread-scoped access controls", async () => {
    const procedures = await loadProjectProcedures();

    expect(
      procedures.buildCodexClientConfig(
        {
          id: 17,
          githubAccess: false,
          agentsAccess: false,
          joltAccess: true,
          projectId: 9,
          worktreePath: "/repo/worktree",
        },
        {
          sessionId: "session-123",
        },
      ),
    ).toMatchObject({
      apps: {
        github: {
          enabled: false,
        },
      },
      developer_instructions: expect.stringContaining(
        "Treat `update_plan`, `request_user_input`, `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, and `close_agent` as unavailable.",
      ),
      features: {
        default_mode_request_user_input: false,
        enable_fanout: false,
        multi_agent: false,
        multi_agent_v2: false,
      },
      mcp_servers: {
        jolt: {
          command: process.execPath,
          env: {
            JOLT_AGENTS_ACCESS: "0",
            JOLT_GITHUB_ACCESS: "0",
            JOLT_JOLT_ACCESS: "1",
            JOLT_PROJECT_ID: "9",
            JOLT_SESSION_ID: "session-123",
            JOLT_THREAD_ID: "17",
            JOLT_WORKTREE_PATH: "/repo/worktree",
          },
        },
      },
    });
  });

  it("builds a sidecar environment with the active session id", async () => {
    const procedures = await loadProjectProcedures();

    expect(
      procedures.buildCodexSidecarEnv(
        {
          id: 17,
          githubAccess: false,
          agentsAccess: false,
          joltAccess: true,
          projectId: 9,
          worktreePath: "/repo/worktree",
        },
        {
          rpcHttpOrigin: "http://127.0.0.1:7599",
          rpcUrl: "ws://127.0.0.1:7599/rpc",
          sessionId: "session-123",
        },
      ),
    ).toEqual({
      JOLT_AGENTS_ACCESS: "0",
      JOLT_GITHUB_ACCESS: "0",
      JOLT_JOLT_ACCESS: "1",
      JOLT_PROJECT_ID: "9",
      JOLT_RPC_HTTP_ORIGIN: "http://127.0.0.1:7599",
      JOLT_RPC_URL: "ws://127.0.0.1:7599/rpc",
      JOLT_SESSION_ID: "session-123",
      JOLT_THREAD_ID: "17",
      JOLT_WORKTREE_PATH: "/repo/worktree",
    });
  });

  it("omits the Jolt sidecar server when Jolt access is disabled", async () => {
    const procedures = await loadProjectProcedures();

    expect(
      procedures.buildCodexClientConfig({
        id: 23,
        githubAccess: true,
        agentsAccess: true,
        joltAccess: false,
        projectId: 11,
        worktreePath: "/repo/other-worktree",
      }),
    ).toEqual({
      apps: {
        github: {
          enabled: true,
        },
      },
      developer_instructions: expect.stringContaining(
        "Treat all `mcp__jolt__*` tools as unavailable.",
      ),
      features: {
        default_mode_request_user_input: true,
        enable_fanout: true,
        multi_agent: true,
        multi_agent_v2: true,
      },
    });
  });

  it("normalizes numeric SQLite-style access flags before building Codex config", async () => {
    const procedures = await loadProjectProcedures();

    expect(
      procedures.buildCodexClientConfig({
        id: 31,
        githubAccess: 0 as unknown as boolean,
        agentsAccess: 1 as unknown as boolean,
        joltAccess: 0 as unknown as boolean,
        projectId: 12,
        worktreePath: "/repo/sqlite-flags",
      }),
    ).toEqual({
      apps: {
        github: {
          enabled: false,
        },
      },
      developer_instructions: expect.stringContaining(
        "Treat all `mcp__jolt__*` tools as unavailable.",
      ),
      features: {
        default_mode_request_user_input: true,
        enable_fanout: true,
        multi_agent: true,
        multi_agent_v2: true,
      },
    });
  });

  it("uses xAI provider settings for xAI model ids", async () => {
    const procedures = await loadProjectProcedures();
    process.env.XAI_API_KEY = "xai-test-key";

    expect(
      procedures.buildCodexClientProviderOptions("grok-code-fast-1"),
    ).toEqual({
      apiKey: "xai-test-key",
      baseUrl: "https://api.x.ai/v1",
    });

    expect(procedures.buildCodexClientProviderOptions("gpt-5.4")).toEqual({});
  });

  it("requires XAI_API_KEY before using xAI model ids", async () => {
    const procedures = await loadProjectProcedures();
    delete process.env.XAI_API_KEY;

    expect(() =>
      procedures.buildCodexClientProviderOptions("grok-4.20-reasoning"),
    ).toThrow(
      'XAI_API_KEY is required to use the xAI model "grok-4.20-reasoning".',
    );
  });

  it("tracks reasoning-effort support per provider model", () => {
    expect(codexModelSupportsReasoningEffort("gpt-5.4")).toBe(true);
    expect(codexModelSupportsReasoningEffort("grok-3-mini")).toBe(true);
    expect(codexModelSupportsReasoningEffort("grok-code-fast-1")).toBe(false);
    expect(codexModelSupportsReasoningEffort("grok-4.20-reasoning")).toBe(
      false,
    );
  });

  it("rejects an aborted active-worktree update before validation completes", async () => {
    const procedures = await loadProjectProcedures();
    const repoPath = createTempDirectory("jolt-active-worktree-repo-");
    initializeGitRepository(repoPath);

    const opened = await procedures.openProjectProcedure({
      name: "Active Worktree Repo",
      projectPath: repoPath,
    });

    await expect(
      procedures.setActiveWorktreeProcedure(
        {
          projectId: opened.project.id,
          worktreePath: repoPath,
        },
        {
          auth: {
            authBypass: true,
            sessionId: null,
          },
          priority: "default",
          signal: AbortSignal.abort(
            new Error("Active worktree update was aborted."),
          ),
          timeoutMs: null,
        },
      ),
    ).rejects.toThrow("Active worktree update was aborted.");
  });
});
