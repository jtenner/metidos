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
  resetPiCodexAuthTestOverrides,
  setPiCodexAuthTestOverrides,
} from "./pi-codex-auth";
import {
  buildModelCatalog,
  codexModelSupportsReasoningEffort,
  resolveCodexModel,
} from "./project-procedures/model-catalog";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
const originalCodexHome = process.env.CODEX_HOME;
const PROVIDER_ENV_DEFAULTS = {
  ANTHROPIC_API_KEY: "test-anthropic-key",
  AWS_ACCESS_KEY_ID: "AKIA_TEST_KEY",
  AWS_REGION: "us-east-1",
  AWS_SECRET_ACCESS_KEY: "test-bedrock-secret",
  AZURE_OPENAI_API_KEY: "test-azure-key",
  AZURE_OPENAI_BASE_URL: "https://example.openai.azure.com",
  GEMINI_API_KEY: "test-google-key",
  GOOGLE_CLOUD_API_KEY: "test-vertex-key",
  GROQ_API_KEY: "test-groq-key",
  KIMI_API_KEY: "test-kimi-key",
  MINIMAX_API_KEY: "test-minimax-key",
  MISTRAL_API_KEY: "test-mistral-key",
  OPENAI_API_KEY: "test-openai-key",
  OPENROUTER_API_KEY: "test-openrouter-key",
  XAI_API_KEY: "test-xai-key",
  ZAI_API_KEY: "test-zai-key",
} satisfies Record<string, string>;
const PROVIDER_ENV_NAMES = [
  ...Object.keys(PROVIDER_ENV_DEFAULTS),
  "ANTHROPIC_OAUTH_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_PROFILE",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AZURE_OPENAI_RESOURCE_NAME",
  "GCLOUD_PROJECT",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_CLOUD_PROJECT",
] as const;
const originalProviderEnv = new Map<string, string | undefined>(
  PROVIDER_ENV_NAMES.map((name) => [name, process.env[name]]),
);

type ProjectProceduresModule = typeof import("./project-procedures");

let projectProcedures: ProjectProceduresModule | null = null;
let isolatedCodexHome = "";

function applyDefaultProviderEnv(): void {
  for (const name of PROVIDER_ENV_NAMES) {
    delete process.env[name];
  }
  for (const [name, value] of Object.entries(PROVIDER_ENV_DEFAULTS)) {
    process.env[name] = value;
  }
}

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

function writeCodexAuthFile(codexHome: string): void {
  writeFileSync(
    join(codexHome, "auth.json"),
    JSON.stringify(
      {
        auth_mode: "chatgpt",
        tokens: {
          access_token: createJwt({
            exp: 1_950_000_000,
          }),
          account_id: "acct_live",
          refresh_token: "refresh_live",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

function clearPiAuthFile(): void {
  const piAuthPath = process.env.METIDOS_APP_DATA_DIR
    ? join(process.env.METIDOS_APP_DATA_DIR, "pi-agent", "auth.json")
    : null;
  if (piAuthPath && existsSync(piAuthPath)) {
    writeFileSync(piAuthPath, "{}", "utf8");
  }
}

async function loadProjectProcedures() {
  if (projectProcedures) {
    return projectProcedures;
  }

  closeAppDatabase();
  resetResolvedAppDataDirectory();
  process.env.METIDOS_APP_DATA_DIR = createTempDirectory(
    "metidos-procedures-db-",
  );
  projectProcedures = (await import(
    `./project-procedures?project-procedures-config=${Date.now()}`
  )) as ProjectProceduresModule;
  return projectProcedures;
}

beforeAll(async () => {
  applyDefaultProviderEnv();
  isolatedCodexHome = createTempDirectory("metidos-codex-home-");
  process.env.CODEX_HOME = isolatedCodexHome;
  setPiCodexAuthTestOverrides({
    codexCliStatus: () => ({
      detail: "Not logged in",
      status: "not_logged_in",
    }),
  });
  await loadProjectProcedures();
});

afterEach(() => {
  projectProcedures?.shutdownProjectPolling();
  applyDefaultProviderEnv();
  process.env.CODEX_HOME = isolatedCodexHome;
  setPiCodexAuthTestOverrides({
    codexCliStatus: () => ({
      detail: "Not logged in",
      status: "not_logged_in",
    }),
  });
  const piAuthPath = process.env.METIDOS_APP_DATA_DIR
    ? join(process.env.METIDOS_APP_DATA_DIR, "pi-agent", "auth.json")
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
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.METIDOS_APP_DATA_DIR;
  }
  if (typeof originalCodexHome === "string") {
    process.env.CODEX_HOME = originalCodexHome;
  } else {
    delete process.env.CODEX_HOME;
  }
  for (const [name, value] of originalProviderEnv) {
    if (typeof value === "string") {
      process.env[name] = value;
    } else {
      delete process.env[name];
    }
  }

  resetPiCodexAuthTestOverrides();

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
    const modelIds = new Set(catalog.models.map((model) => model.id));

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
            "OpenAI Codex is not setup. Please use the codex cli to login using 'file' authentication.",
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
          group: "Kimi Coding",
          id: "kimi-coding:k2p5",
          providerId: "kimi-coding",
        }),
        expect.objectContaining({
          group: "Z.AI",
          id: "zai:glm-5.1",
          providerId: "zai",
        }),
        expect.objectContaining({
          group: "xAI",
          id: expect.stringMatching(/^xai:/u),
          providerId: "xai",
        }),
      ]),
    );
    expect(
      catalog.models.filter((model) => model.providerId === "openai"),
    ).toHaveLength(5);
    expect(
      catalog.models.filter((model) => model.providerId === "openai-codex"),
    ).toHaveLength(5);
    expect(
      catalog.models.filter((model) => model.providerId === "anthropic"),
    ).toHaveLength(5);
    expect(
      catalog.models.filter((model) => model.providerId === "kimi-coding"),
    ).toHaveLength(2);
    expect(
      catalog.models.filter((model) => model.providerId === "minimax"),
    ).toHaveLength(2);
    expect(
      catalog.models.filter((model) => model.providerId === "openrouter"),
    ).toHaveLength(5);
    expect(
      catalog.models.filter((model) => model.providerId === "zai"),
    ).toHaveLength(5);
    expect(modelIds.has("anthropic:claude-opus-4-1")).toBe(false);
    expect(modelIds.has("openai:gpt-4.1")).toBe(false);
    expect(modelIds.has("google:gemini-1.5-pro")).toBe(false);
    expect(modelIds.has("openrouter:qwen/qwen3.6-plus")).toBe(true);
    expect(modelIds.has("zai:glm-5.1")).toBe(true);
    expect(modelIds.has("kimi-coding:k2p5")).toBe(true);
    expect(modelIds.has("xai:grok-3-mini")).toBe(false);
  });

  it("marks providers disabled when their required setup env is missing", () => {
    const scenarios = [
      {
        providerId: "amazon-bedrock",
        unset: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
        note: "Amazon Bedrock is not setup. Please add your key to the env variable AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (or AWS_PROFILE / AWS_BEARER_TOKEN_BEDROCK).",
      },
      {
        providerId: "anthropic",
        unset: ["ANTHROPIC_API_KEY"],
        note: "Anthropic is not setup. Please add your key to the env variable ANTHROPIC_API_KEY.",
      },
      {
        providerId: "azure-openai-responses",
        unset: ["AZURE_OPENAI_API_KEY"],
        note: "Azure OpenAI is not setup. Please add your key to the env variable AZURE_OPENAI_API_KEY and AZURE_OPENAI_BASE_URL (or AZURE_OPENAI_RESOURCE_NAME).",
      },
      {
        providerId: "google",
        unset: ["GEMINI_API_KEY"],
        note: "Google is not setup. Please add your key to the env variable GEMINI_API_KEY.",
      },
      {
        providerId: "google-vertex",
        unset: ["GOOGLE_CLOUD_API_KEY"],
        note: "Google Vertex is not setup. Please add your key to the env variable GOOGLE_CLOUD_API_KEY (or GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION).",
      },
      {
        providerId: "groq",
        unset: ["GROQ_API_KEY"],
        note: "Groq is not setup. Please add your key to the env variable GROQ_API_KEY.",
      },
      {
        providerId: "kimi-coding",
        unset: ["KIMI_API_KEY"],
        note: "Kimi Coding is not setup. Please add your key to the env variable KIMI_API_KEY.",
      },
      {
        providerId: "minimax",
        unset: ["MINIMAX_API_KEY"],
        note: "MiniMax is not setup. Please add your key to the env variable MINIMAX_API_KEY.",
      },
      {
        providerId: "mistral",
        unset: ["MISTRAL_API_KEY"],
        note: "Mistral is not setup. Please add your key to the env variable MISTRAL_API_KEY.",
      },
      {
        providerId: "openai",
        unset: ["OPENAI_API_KEY"],
        note: "OpenAI API is not setup. Please add your key to the env variable OPENAI_API_KEY.",
      },
      {
        providerId: "openrouter",
        unset: ["OPENROUTER_API_KEY"],
        note: "OpenRouter is not setup. Please add your key to the env variable OPENROUTER_API_KEY.",
      },
      {
        providerId: "xai",
        unset: ["XAI_API_KEY"],
        note: "xAI is not setup. Please add your key to the env variable XAI_API_KEY.",
      },
      {
        providerId: "zai",
        unset: ["ZAI_API_KEY"],
        note: "Z.AI is not setup. Please add your key to the env variable ZAI_API_KEY.",
      },
    ] as const;

    for (const scenario of scenarios) {
      applyDefaultProviderEnv();
      for (const variableName of scenario.unset) {
        delete process.env[variableName];
      }

      const disabledProviderModels = buildModelCatalog().models.filter(
        (model) => model.providerId === scenario.providerId,
      );

      expect(disabledProviderModels.length).toBeGreaterThan(0);
      expect(disabledProviderModels).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            providerAvailabilityNote: scenario.note,
            providerAvailable: false,
            providerId: scenario.providerId,
          }),
        ]),
      );
    }
  });

  it("prefers openai-codex for raw GPT ids when Codex auth is available", () => {
    const codexHome = createTempDirectory("metidos-codex-home-");
    writeCodexAuthFile(codexHome);
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
    const codexHome = createTempDirectory("metidos-codex-home-");
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
        providerAvailabilityNote:
          "OpenAI Codex is not setup. Please use the codex cli to login using 'file' authentication.",
      }),
    );
    expect(resolveCodexModel("gpt-5.4")).toBe("openai:gpt-5.4");
  });

  it("uses file-auth guidance for unavailable Codex providers", () => {
    const codexHome = createTempDirectory("metidos-codex-home-");
    process.env.CODEX_HOME = codexHome;
    setPiCodexAuthTestOverrides({
      codexCliStatus: () => ({
        detail: "Logged in using ChatGPT",
        status: "logged_in_chatgpt",
      }),
    });

    const catalog = buildModelCatalog();
    const codexModel = catalog.models.find(
      (model) => model.id === "openai-codex:gpt-5.4",
    );

    expect(codexModel).toEqual(
      expect.objectContaining({
        providerAvailable: false,
        providerAvailabilityNote:
          "OpenAI Codex is not setup. Please use the codex cli to login using 'file' authentication.",
      }),
    );
  });

  it("canonicalizes legacy raw model ids and alias ids through the Pi catalog", () => {
    expect(resolveCodexModel("gpt-5.4")).toBe("openai:gpt-5.4");
    expect(resolveCodexModel("openai:gpt-5.4")).toBe("openai:gpt-5.4");
    expect(resolveCodexModel("grok-code-fast-1")).toBe("xai:grok-code-fast-1");
    expect(resolveCodexModel("grok-4.20-reasoning")).toBe(
      "xai:grok-4.20-0309-reasoning",
    );
  });

  it("tracks reasoning-effort support per curated provider model", () => {
    expect(codexModelSupportsReasoningEffort("gpt-5.4")).toBe(true);
    expect(codexModelSupportsReasoningEffort("grok-code-fast-1")).toBe(true);
    expect(codexModelSupportsReasoningEffort("grok-4.20-reasoning")).toBe(true);
  });

  it("rejects stale built-in models that were dropped from the curated catalog", () => {
    expect(() => resolveCodexModel("anthropic:claude-opus-4-1")).toThrow(
      "Unsupported model: anthropic:claude-opus-4-1",
    );
    expect(() => resolveCodexModel("openai:gpt-4.1")).toThrow(
      "Unsupported model: openai:gpt-4.1",
    );
    expect(() => resolveCodexModel("xai:grok-3-mini")).toThrow(
      "Unsupported model: xai:grok-3-mini",
    );
  });

  it("rejects unavailable Codex providers before creating threads or cron jobs", async () => {
    const procedures = await loadProjectProcedures();
    const repoPath = createTempDirectory("metidos-provider-guard-repo-");
    initializeGitRepository(repoPath);

    const opened = await procedures.openProjectProcedure({
      name: "Provider Guard Repo",
      projectPath: repoPath,
    });
    const unavailableMessage =
      "OpenAI Codex is unavailable for GPT-5.4. OpenAI Codex is not setup. Please use the codex cli to login using 'file' authentication.";

    await expect(
      procedures.requestThreadStartProcedure({
        agentsAccess: false,
        autoStart: null,
        githubAccess: false,
        input: "hello from unavailable codex",
        metidosAccess: false,
        model: "openai-codex:gpt-5.4",
        projectId: opened.project.id,
        reasoningEffort: "medium",
        unsafeMode: false,
        worktreePath: repoPath,
      }),
    ).rejects.toThrow(unavailableMessage);

    await expect(
      procedures.createThreadProcedure({
        agentsAccess: false,
        githubAccess: false,
        metidosAccess: false,
        model: "openai-codex:gpt-5.4",
        projectId: opened.project.id,
        reasoningEffort: "medium",
        unsafeMode: false,
        worktreePath: repoPath,
      }),
    ).rejects.toThrow(unavailableMessage);

    await expect(
      procedures.newCronProcedure({
        agentsAccess: false,
        githubAccess: false,
        metidosAccess: false,
        model: "openai-codex:gpt-5.4",
        projectId: opened.project.id,
        prompt: "run unavailable codex",
        reasoningEffort: "medium",
        schedule: "* * * * *",
        unsafeMode: false,
        worktreePath: repoPath,
      }),
    ).rejects.toThrow(unavailableMessage);
  });

  it("rejects unavailable Codex providers before queued runs or model updates", async () => {
    const procedures = await loadProjectProcedures();
    const repoPath = createTempDirectory("metidos-provider-run-guard-repo-");
    initializeGitRepository(repoPath);

    const codexHome = createTempDirectory("metidos-codex-home-");
    writeCodexAuthFile(codexHome);
    process.env.CODEX_HOME = codexHome;

    const opened = await procedures.openProjectProcedure({
      name: "Provider Run Guard Repo",
      projectPath: repoPath,
    });
    const codexThread = await procedures.createThreadProcedure({
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: false,
      model: "openai-codex:gpt-5.4",
      projectId: opened.project.id,
      reasoningEffort: "medium",
      unsafeMode: false,
      worktreePath: repoPath,
    });
    const openaiThread = await procedures.createThreadProcedure({
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: false,
      model: "openai:gpt-5.4",
      projectId: opened.project.id,
      reasoningEffort: "medium",
      unsafeMode: false,
      worktreePath: repoPath,
    });
    const cronJob = await procedures.newCronProcedure({
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: false,
      model: "openai:gpt-5.4",
      projectId: opened.project.id,
      prompt: "run safely",
      reasoningEffort: "medium",
      schedule: "0 * * * *",
      unsafeMode: false,
      worktreePath: repoPath,
    });

    process.env.CODEX_HOME = isolatedCodexHome;
    clearPiAuthFile();
    const unavailableMessage =
      "OpenAI Codex is unavailable for GPT-5.4. OpenAI Codex is not setup. Please use the codex cli to login using 'file' authentication.";
    const beforeFailedSend = await procedures.getThreadProcedure({
      threadId: codexThread.thread.id,
    });

    await expect(
      procedures.sendThreadMessageProcedure({
        threadId: codexThread.thread.id,
        input: "should not queue",
      }),
    ).rejects.toThrow(unavailableMessage);
    await expect(
      procedures.updateThreadModelProcedure({
        model: "openai-codex:gpt-5.4",
        threadId: openaiThread.thread.id,
      }),
    ).rejects.toThrow(unavailableMessage);
    await expect(
      procedures.updateCronProcedure({
        cronJobId: cronJob.id,
        model: "openai-codex:gpt-5.4",
      }),
    ).rejects.toThrow(unavailableMessage);

    const afterFailedSend = await procedures.getThreadProcedure({
      threadId: codexThread.thread.id,
    });
    expect(afterFailedSend.thread.runStatus.state).toBe("idle");
    expect(afterFailedSend.messages).toHaveLength(
      beforeFailedSend.messages.length,
    );
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
    const repoPath = createTempDirectory("metidos-active-worktree-repo-");
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
    const repoPath = createTempDirectory(
      "metidos-active-worktree-preempt-repo-",
    );
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
