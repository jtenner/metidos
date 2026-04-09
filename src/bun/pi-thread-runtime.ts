/**
 * @file src/bun/pi-thread-runtime.ts
 * @description Pi-backed per-thread runtime helpers.
 */

import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import {
  type AgentSession,
  AuthStorage,
  type CreateAgentSessionOptions,
  createAgentSession,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  DefaultResourceLoader,
  type ExtensionFactory,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";

import { getAppDataDirectoryPath, type ThreadRecord } from "./db";
import {
  createPiRuntimeProbeProviderConfig,
  PI_RUNTIME_PROBE_RUNTIME_API_KEY,
} from "./pi-runtime-probe";
import {
  codexModelProvider,
  normalizeStoredCodexModel,
  normalizeStoredCodexReasoningEffort,
} from "./project-procedures/model-catalog";

export const PI_THREAD_AGENT_DIRECTORY_NAME = "pi-agent";
export const PI_THREAD_SESSIONS_DIRECTORY_NAME = "thread-sessions";
export const PI_THREAD_RUNTIME_TEST_PROVIDER_ENV =
  "JOLT_PI_RUNTIME_TEST_PROVIDER";
export const PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE = "openai-probe";

type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type PiRuntimeThread = Pick<
  ThreadRecord,
  | "id"
  | "model"
  | "piSessionFile"
  | "reasoningEffort"
  | "unsafeMode"
  | "worktreePath"
>;

export type PiThreadRuntime = {
  agentDirectory: string;
  contextWindowTokens: number;
  model: Model<Api>;
  session: AgentSession;
  sessionDirectory: string;
};

/**
 * Resolve the Jolt-owned Pi agent directory under the app data folder.
 */
export function buildPiAgentDirectoryPath(appDataDir?: string): string {
  return join(
    getAppDataDirectoryPath(
      typeof appDataDir === "string" ? { appDataDir } : undefined,
    ),
    PI_THREAD_AGENT_DIRECTORY_NAME,
  );
}

/**
 * Resolve the deterministic per-thread Pi session directory.
 */
export function buildPiThreadSessionDirectoryPath(
  threadId: number,
  appDataDir?: string,
): string {
  return join(
    buildPiAgentDirectoryPath(appDataDir),
    PI_THREAD_SESSIONS_DIRECTORY_NAME,
    `thread-${threadId}`,
  );
}

function resolvePiThinkingLevel(
  reasoningEffort: string | null | undefined,
): PiThinkingLevel {
  return normalizeStoredCodexReasoningEffort(
    reasoningEffort,
  ) as PiThinkingLevel;
}

function buildPiRuntimeAppendSystemPrompt(thread: PiRuntimeThread): string {
  return [
    `The current workspace root is ${thread.worktreePath}.`,
    "Operate only inside this workspace.",
    thread.unsafeMode === 1
      ? "Unsafe mode is enabled. Bash is available, but stay within the workspace unless the user explicitly asks for broader host access."
      : "Unsafe mode is disabled. Bash is unavailable. Use the installed file and search tools inside the workspace instead.",
    "No GitHub, MCP, web search, sub-agent, or Jolt-specific tools are installed in this runtime.",
  ].join("\n");
}

function resolveThreadScopedPath(
  worktreePath: string,
  candidatePath: string,
): string {
  const trimmedPath = candidatePath.trim();
  if (!trimmedPath) {
    throw new Error("Path is required.");
  }

  const absoluteWorktreePath = resolve(worktreePath);
  const absoluteCandidatePath = isAbsolute(trimmedPath)
    ? resolve(trimmedPath)
    : resolve(absoluteWorktreePath, trimmedPath);
  const relativePath = relative(absoluteWorktreePath, absoluteCandidatePath);

  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  ) {
    return absoluteCandidatePath;
  }

  throw new Error(
    `Path is outside the current workspace root: ${candidatePath}`,
  );
}

function toolPathFromEvent(
  event: {
    input?: Record<string, unknown>;
    toolName: string;
  } | null,
): string | null {
  if (!event) {
    return null;
  }

  switch (event.toolName) {
    case "read":
    case "edit":
    case "write":
    case "grep":
    case "find":
    case "ls": {
      const candidatePath = event.input?.path;
      return typeof candidatePath === "string" ? candidatePath : null;
    }
    default:
      return null;
  }
}

function createThreadToolPolicyExtension(
  thread: PiRuntimeThread,
): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", (event) => {
      if (event.toolName === "bash" && thread.unsafeMode !== 1) {
        return {
          block: true,
          reason:
            "Bash is disabled for this thread while unsafe mode is turned off.",
        };
      }

      const candidatePath = toolPathFromEvent(event);
      if (!candidatePath) {
        return undefined;
      }

      try {
        resolveThreadScopedPath(thread.worktreePath, candidatePath);
        return undefined;
      } catch (error) {
        return {
          block: true,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    });
  };
}

function applyPiRuntimeTestProviderOverride(
  authStorage: AuthStorage,
  modelRegistry: ModelRegistry,
): void {
  const configuredProvider =
    process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV]?.trim() ?? "";
  if (configuredProvider !== PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE) {
    return;
  }

  const probeProviderConfig = createPiRuntimeProbeProviderConfig({
    chunkDelayMs: 1,
  });
  const probeModel = probeProviderConfig.models?.[0];
  if (
    !probeModel ||
    !probeProviderConfig.baseUrl ||
    !probeProviderConfig.api ||
    !probeProviderConfig.apiKey ||
    typeof probeProviderConfig.authHeader !== "boolean" ||
    !probeProviderConfig.streamSimple
  ) {
    throw new Error(
      "Pi runtime probe provider did not expose a complete provider configuration.",
    );
  }

  modelRegistry.registerProvider("openai", {
    api: probeProviderConfig.api,
    apiKey: probeProviderConfig.apiKey,
    authHeader: probeProviderConfig.authHeader,
    baseUrl: probeProviderConfig.baseUrl,
    models: [
      {
        ...probeModel,
        id: "gpt-5.4",
        name: "Probe GPT-5.4",
      },
    ],
    streamSimple: probeProviderConfig.streamSimple,
  });
  authStorage.setRuntimeApiKey("openai", PI_RUNTIME_PROBE_RUNTIME_API_KEY);
}

function createPiModelRegistry(agentDirectory: string): {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
} {
  const authStorage = AuthStorage.create(join(agentDirectory, "auth.json"));
  const modelRegistry = ModelRegistry.create(
    authStorage,
    join(agentDirectory, "models.json"),
  );
  applyPiRuntimeTestProviderOverride(authStorage, modelRegistry);
  return {
    authStorage,
    modelRegistry,
  };
}

function resolvePiModel(
  thread: PiRuntimeThread,
  modelRegistry: ModelRegistry,
): Model<Api> {
  const normalizedModel = normalizeStoredCodexModel(thread.model);
  const primaryProvider = codexModelProvider(normalizedModel);
  const providerCandidates =
    primaryProvider === "openai"
      ? ["openai", "openai-codex"]
      : [primaryProvider];

  for (const provider of providerCandidates) {
    const model = modelRegistry.find(provider, normalizedModel);
    if (model) {
      return model;
    }
  }

  throw new Error(
    `Pi runtime could not resolve model ${normalizedModel} from providers ${providerCandidates.join(", ")}.`,
  );
}

function buildPiTools(
  worktreePath: string,
  unsafeMode: boolean,
): NonNullable<CreateAgentSessionOptions["tools"]> {
  const tools: NonNullable<CreateAgentSessionOptions["tools"]> = [
    createReadTool(worktreePath),
    createLsTool(worktreePath),
    createFindTool(worktreePath),
    createGrepTool(worktreePath),
    createEditTool(worktreePath),
    createWriteTool(worktreePath),
  ];
  if (unsafeMode) {
    tools.splice(1, 0, createBashTool(worktreePath));
  }
  return tools;
}

/**
 * Create or resume the Pi runtime associated with a thread.
 */
export async function createPiThreadRuntime(
  thread: PiRuntimeThread,
  options?: {
    appDataDir?: string;
  },
): Promise<PiThreadRuntime> {
  const agentDirectory = buildPiAgentDirectoryPath(options?.appDataDir);
  const sessionDirectory = buildPiThreadSessionDirectoryPath(
    thread.id,
    options?.appDataDir,
  );
  mkdirSync(agentDirectory, {
    recursive: true,
  });
  mkdirSync(sessionDirectory, {
    recursive: true,
  });
  const { authStorage, modelRegistry } = createPiModelRegistry(agentDirectory);
  const model = resolvePiModel(thread, modelRegistry);
  const settingsManager = SettingsManager.inMemory({
    retry: {
      enabled: false,
      maxRetries: 0,
    },
  });
  const resourceLoader = new DefaultResourceLoader({
    agentDir: agentDirectory,
    appendSystemPrompt: buildPiRuntimeAppendSystemPrompt(thread),
    cwd: thread.worktreePath,
    extensionFactories: [createThreadToolPolicyExtension(thread)],
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
    settingsManager,
  });
  await resourceLoader.reload();

  const sessionManager =
    thread.piSessionFile && existsSync(thread.piSessionFile)
      ? SessionManager.open(
          thread.piSessionFile,
          sessionDirectory,
          thread.worktreePath,
        )
      : SessionManager.continueRecent(thread.worktreePath, sessionDirectory);
  const { session } = await createAgentSession({
    agentDir: agentDirectory,
    authStorage,
    cwd: thread.worktreePath,
    model,
    modelRegistry,
    resourceLoader,
    sessionManager,
    settingsManager,
    thinkingLevel: resolvePiThinkingLevel(thread.reasoningEffort),
    tools: buildPiTools(thread.worktreePath, thread.unsafeMode === 1),
  });

  return {
    agentDirectory,
    contextWindowTokens: model.contextWindow,
    model,
    session,
    sessionDirectory,
  };
}
