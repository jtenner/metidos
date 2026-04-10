/**
 * @file src/bun/project-procedures-config.test.ts
 * @description Test file for Pi-era project procedure configuration helpers.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAppDatabase, resetResolvedAppDataDirectory } from "./db";
import {
  buildModelCatalog,
  codexModelSupportsReasoningEffort,
  resolveCodexModel,
} from "./project-procedures/model-catalog";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.JOLT_APP_DATA_DIR;
const originalCodexHome = process.env.CODEX_HOME;

type ProjectProceduresModule = typeof import("./project-procedures");

let projectProcedures: ProjectProceduresModule | null = null;
let isolatedCodexHome = "";

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

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function createJwt(payload: Record<string, unknown>): string {
  return [
    encodeBase64Url(JSON.stringify({ alg: "none", typ: "JWT" })),
    encodeBase64Url(JSON.stringify(payload)),
    "signature",
  ].join(".");
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
  isolatedCodexHome = createTempDirectory("jolt-codex-home-");
  process.env.CODEX_HOME = isolatedCodexHome;
  await loadProjectProcedures();
});

afterEach(() => {
  projectProcedures?.shutdownProjectPolling();
  process.env.CODEX_HOME = isolatedCodexHome;
  const piAuthPath = process.env.JOLT_APP_DATA_DIR
    ? join(process.env.JOLT_APP_DATA_DIR, "pi-agent", "auth.json")
    : null;
  if (piAuthPath && existsSync(piAuthPath)) {
    writeFileSync(piAuthPath, "{}", "utf8");
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
  if (typeof originalCodexHome === "string") {
    process.env.CODEX_HOME = originalCodexHome;
  } else {
    delete process.env.CODEX_HOME;
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
  it("builds a Pi-backed model catalog with canonical provider-qualified ids", () => {
    const catalog = buildModelCatalog();

    expect(catalog.defaultModel).toBe("openai:gpt-5.4");
    expect(catalog.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: "OpenAI API",
          id: "openai:gpt-5.4",
          label: "GPT-5.4",
          modelId: "gpt-5.4",
          providerAvailable: true,
          providerAvailabilityNote: null,
          providerId: "openai",
          providerLabel: "OpenAI API",
          supportsReasoningEffort: true,
        }),
        expect.objectContaining({
          group: "OpenAI Codex",
          id: "openai-codex:gpt-5.4",
          label: "GPT-5.4",
          modelId: "gpt-5.4",
          providerAvailable: false,
          providerAvailabilityNote:
            "Requires OpenAI Codex sign-in in Settings.",
          providerId: "openai-codex",
          providerLabel: "OpenAI Codex",
          supportsReasoningEffort: true,
        }),
        expect.objectContaining({
          group: "Anthropic",
          id: expect.stringMatching(/^anthropic:/u),
          providerId: "anthropic",
        }),
        expect.objectContaining({
          group: "xAI",
          id: expect.stringMatching(/^xai:/u),
          providerId: "xai",
        }),
      ]),
    );
  });

  it("prefers openai-codex for raw GPT ids when Codex auth is available", () => {
    const codexHome = createTempDirectory("jolt-codex-home-");
    const accessToken = createJwt({
      exp: 1_950_000_000,
    });
    writeFileSync(
      join(codexHome, "auth.json"),
      JSON.stringify(
        {
          auth_mode: "chatgpt",
          tokens: {
            access_token: accessToken,
            account_id: "acct_live",
            refresh_token: "refresh_live",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;

    const catalog = buildModelCatalog();
    const codexModel = catalog.models.find(
      (model) => model.id === "openai-codex:gpt-5.4",
    );

    expect(catalog.defaultModel).toBe("openai-codex:gpt-5.4");
    expect(codexModel).toEqual(
      expect.objectContaining({
        providerAvailable: true,
        providerAvailabilityNote: null,
      }),
    );
    expect(resolveCodexModel("gpt-5.4")).toBe("openai-codex:gpt-5.4");
    expect(resolveCodexModel("openai:gpt-5.4")).toBe("openai:gpt-5.4");
    expect(resolveCodexModel("openai-codex:gpt-5.4")).toBe(
      "openai-codex:gpt-5.4",
    );
  });

  it("keeps OpenAI API as the default when the Codex auth file exists but is unusable", () => {
    const codexHome = createTempDirectory("jolt-codex-home-");
    writeFileSync(
      join(codexHome, "auth.json"),
      JSON.stringify(
        {
          auth_mode: "chatgpt",
          tokens: {
            access_token: createJwt({
              exp: 1_950_000_000,
            }),
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    process.env.CODEX_HOME = codexHome;

    const catalog = buildModelCatalog();
    const codexModel = catalog.models.find(
      (model) => model.id === "openai-codex:gpt-5.4",
    );

    expect(catalog.defaultModel).toBe("openai:gpt-5.4");
    expect(codexModel).toEqual(
      expect.objectContaining({
        providerAvailable: false,
        providerAvailabilityNote: "Requires OpenAI Codex sign-in in Settings.",
      }),
    );
    expect(resolveCodexModel("gpt-5.4")).toBe("openai:gpt-5.4");
  });

  it("canonicalizes legacy raw model ids and alias ids through the Pi catalog", () => {
    expect(resolveCodexModel("gpt-5.4")).toBe("openai:gpt-5.4");
    expect(resolveCodexModel("openai:gpt-5.4")).toBe("openai:gpt-5.4");
    expect(resolveCodexModel("grok-code-fast-1")).toBe("xai:grok-code-fast-1");
    expect(resolveCodexModel("grok-4.20-reasoning")).toBe(
      "xai:grok-4.20-0309-reasoning",
    );
  });

  it("tracks reasoning-effort support per provider model", () => {
    expect(codexModelSupportsReasoningEffort("gpt-5.4")).toBe(true);
    expect(codexModelSupportsReasoningEffort("grok-3-mini")).toBe(true);
    expect(codexModelSupportsReasoningEffort("grok-code-fast-1")).toBe(true);
    expect(codexModelSupportsReasoningEffort("grok-4.20-reasoning")).toBe(true);
  });

  it("fails empty assistant completions instead of fabricating a reply", async () => {
    const procedures = await loadProjectProcedures();

    expect(() =>
      procedures.requireAssistantResponseText("", "grok-4.20-reasoning"),
    ).toThrow(
      "Thread run completed without returning an assistant response. The xAI provider may have stopped after reasoning without emitting a final answer or tool call.",
    );
    expect(procedures.requireAssistantResponseText("  ok  ", "gpt-5.4")).toBe(
      "ok",
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

  it("falls back to cached worktrees when foreground git preempts active-worktree validation", async () => {
    const procedures = await loadProjectProcedures();
    const repoPath = createTempDirectory("jolt-active-worktree-preempt-repo-");
    initializeGitRepository(repoPath);

    const opened = await procedures.openProjectProcedure({
      name: "Active Worktree Repo",
      projectPath: repoPath,
    });

    const selectionPromise = procedures.setActiveWorktreeProcedure({
      projectId: opened.project.id,
      worktreePath: repoPath,
    });

    await expect(
      procedures.listProjectWorktreesProcedure({
        projectId: opened.project.id,
      }),
    ).resolves.toEqual({
      project: expect.objectContaining({
        id: opened.project.id,
      }),
      worktrees: expect.arrayContaining([
        expect.objectContaining({
          path: repoPath,
        }),
      ]),
    });

    await expect(selectionPromise).resolves.toEqual({
      success: true,
      projectId: opened.project.id,
      worktreePath: repoPath,
    });
  });
});
