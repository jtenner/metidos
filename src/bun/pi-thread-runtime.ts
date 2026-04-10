/**
 * @file src/bun/pi-thread-runtime.ts
 * @description Pi-backed per-thread runtime helpers.
 */

import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import {
  type AgentSession,
  type AuthStorage,
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
  createPiAgentsTools,
  type PiAgentsToolHost,
  type PiAgentsToolScope,
  type PiDelegatedTaskRequest,
  type PiDelegatedTaskRun,
} from "./pi-agents-tools";
import { createPiAuthStorage } from "./pi-codex-auth";
import type { PiThreadExtensionUiBridge } from "./pi-extension-ui";
import {
  createPiGitHubCliHost,
  createPiGitHubTools,
  type PiGitHubToolHost,
} from "./pi-github-tools";
import {
  createPiMetidosTools,
  type PiMetidosToolHost,
} from "./pi-metidos-tools";
import {
  createPiRuntimeProbeProviderConfig,
  PI_RUNTIME_PROBE_RUNTIME_API_KEY,
} from "./pi-runtime-probe";
import {
  codexModelApiId,
  codexModelProvider,
  normalizeStoredCodexReasoningEffort,
} from "./project-procedures/model-catalog";

export const PI_THREAD_AGENT_DIRECTORY_NAME = "pi-agent";
export const PI_THREAD_SESSIONS_DIRECTORY_NAME = "thread-sessions";
export const PI_THREAD_RUNTIME_TEST_PROVIDER_ENV =
  "METIDOS_PI_RUNTIME_TEST_PROVIDER";
const LEGACY_PI_THREAD_RUNTIME_TEST_PROVIDER_ENV =
  "JOLT_PI_RUNTIME_TEST_PROVIDER";
export const PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE = "openai-probe";

type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type PiRuntimeThread = Pick<
  ThreadRecord,
  | "agentsAccess"
  | "githubAccess"
  | "id"
  | "metidosAccess"
  | "model"
  | "piSessionFile"
  | "projectId"
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

export type PiThreadToolPolicy = {
  allowBash: boolean;
  allowUnsafeModeEscalation: boolean;
  runtimePromptLine: string;
};

type CreatePiRuntimeOptions = {
  agentsToolHost?: PiAgentsToolHost;
  appDataDir?: string;
  extensionUiBridge?: PiThreadExtensionUiBridge;
  githubToolHost?: PiGitHubToolHost;
  metidosToolHost?: PiMetidosToolHost;
};

/**
 * Resolve the Metidos-owned Pi agent directory under the app data folder.
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

function isBinaryPiThinkingModel(model: string | null | undefined): boolean {
  const normalized = model?.trim();
  if (!normalized?.includes(":")) {
    return false;
  }
  const [provider] = normalized.split(":", 2);
  return provider === "mistral" || provider === "zai";
}

export function resolvePiThinkingLevel(
  model: string | null | undefined,
  reasoningEffort: string | null | undefined,
): PiThinkingLevel {
  const normalized = normalizeStoredCodexReasoningEffort(reasoningEffort);
  if (isBinaryPiThinkingModel(model)) {
    return normalized === "minimal" ? "off" : "high";
  }
  return normalized as PiThinkingLevel;
}

export function buildPiThreadToolPolicy(thread: {
  unsafeMode: PiRuntimeThread["unsafeMode"];
}): PiThreadToolPolicy {
  if (thread.unsafeMode === 1) {
    return {
      allowBash: true,
      allowUnsafeModeEscalation: true,
      runtimePromptLine:
        "Unsafe mode is enabled. Bash is available, and Metidos tools may create unsafe child threads or cron jobs. Stay within the workspace unless the user explicitly asks for broader host access.",
    };
  }

  return {
    allowBash: false,
    allowUnsafeModeEscalation: false,
    runtimePromptLine:
      "Unsafe mode is disabled. Bash is unavailable. Use the installed worktree-scoped file/search tools instead, and do not create unsafe child threads or cron jobs.",
  };
}

function buildPiRuntimeAppendSystemPrompt(thread: PiRuntimeThread): string {
  const toolPolicy = buildPiThreadToolPolicy(thread);
  const customToolLines: string[] = [];
  if (thread.agentsAccess === true) {
    customToolLines.push(
      "Agent coordination tools are installed in this runtime: update_plan and delegate_task.",
      "These are Pi-era replacements. Persistent child-agent lifecycle tools such as request_user_input, send_input, resume_agent, wait_agent, and close_agent are not installed.",
    );
  }
  if (thread.githubAccess === true) {
    customToolLines.push(
      "GitHub-native tools are installed in this runtime: github_repo, github_issue, github_pr, github_pr_checks, and github_pr_diff.",
    );
  }
  if (thread.metidosAccess === true) {
    customToolLines.push(
      "Metidos-native tools are installed in this runtime: update_thread, list_threads, run_untrusted_js, set_context, list_crons, new_cron, update_cron, and new_thread.",
    );
  }
  return [
    `The current workspace root is ${thread.worktreePath}.`,
    "Operate only inside this workspace.",
    toolPolicy.runtimePromptLine,
    ...(customToolLines.length > 0
      ? customToolLines
      : [
          "No GitHub, Metidos, or agent-coordination tools are installed in this runtime. Web search is not installed.",
        ]),
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
    process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV]?.trim() ||
    process.env[LEGACY_PI_THREAD_RUNTIME_TEST_PROVIDER_ENV]?.trim() ||
    "";
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
  const { authStorage } = createPiAuthStorage(agentDirectory);
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
  const normalizedModel = codexModelApiId(thread.model);
  const primaryProvider = codexModelProvider(thread.model);
  const model = modelRegistry.find(primaryProvider, normalizedModel);
  if (model) {
    return model;
  }

  throw new Error(
    `Pi runtime could not resolve model ${normalizedModel} from provider ${primaryProvider}.`,
  );
}

function buildPiTools(
  worktreePath: string,
  toolPolicy: PiThreadToolPolicy,
): NonNullable<CreateAgentSessionOptions["tools"]> {
  const tools: NonNullable<CreateAgentSessionOptions["tools"]> = [
    createReadTool(worktreePath),
    createLsTool(worktreePath),
    createFindTool(worktreePath),
    createGrepTool(worktreePath),
    createEditTool(worktreePath),
    createWriteTool(worktreePath),
  ];
  if (toolPolicy.allowBash) {
    tools.splice(1, 0, createBashTool(worktreePath));
  }
  return tools;
}

function buildPiDelegatedTaskSystemPrompt(thread: PiRuntimeThread): string {
  return [
    buildPiRuntimeAppendSystemPrompt({
      ...thread,
      agentsAccess: false,
    }),
    "You are a delegated helper agent running on behalf of another agent.",
    "Finish only the assigned task, stay tightly scoped, do not request follow-up lifecycle actions, and do not create additional helper agents.",
    "Return a concise final answer that the parent agent can reuse directly.",
  ].join("\n");
}

function extractAssistantText(message: unknown): string {
  if (
    !message ||
    typeof message !== "object" ||
    !("role" in message) ||
    !("content" in message) ||
    message.role !== "assistant"
  ) {
    return "";
  }
  const content = message.content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(
      (item): item is { text: string; type: "text" } =>
        !!item &&
        typeof item === "object" &&
        "type" in item &&
        "text" in item &&
        item.type === "text" &&
        typeof item.text === "string",
    )
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function extractLatestAssistantText(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = extractAssistantText(messages[index]);
    if (text) {
      return text;
    }
  }
  return "";
}

function createPiAgentsToolScope(thread: PiRuntimeThread): PiAgentsToolScope {
  return {
    reasoningEffortContext: resolvePiThinkingLevel(
      thread.model,
      thread.reasoningEffort,
    ),
    threadIdContext: thread.id,
  };
}

export async function runPiDelegatedTask(
  thread: PiRuntimeThread,
  request: PiDelegatedTaskRequest,
  options?: {
    appDataDir?: string;
    githubToolHost?: PiGitHubToolHost;
    metidosToolHost?: PiMetidosToolHost;
    onUpdate?: (partial: PiDelegatedTaskRun) => void;
    signal?: AbortSignal;
  },
): Promise<PiDelegatedTaskRun> {
  if (options?.signal?.aborted) {
    throw new Error("Delegated task aborted before it started.");
  }

  const agentDirectory = buildPiAgentDirectoryPath(options?.appDataDir);
  mkdirSync(agentDirectory, {
    recursive: true,
  });
  const childThread: PiRuntimeThread = {
    ...thread,
    agentsAccess: false,
    model: request.model ?? thread.model,
    reasoningEffort: request.reasoningEffort ?? thread.reasoningEffort,
  };
  const { authStorage, modelRegistry } = createPiModelRegistry(agentDirectory);
  const model = resolvePiModel(childThread, modelRegistry);
  const toolPolicy = buildPiThreadToolPolicy(childThread);
  const settingsManager = SettingsManager.inMemory({
    retry: {
      enabled: false,
      maxRetries: 0,
    },
  });
  const resourceLoader = new DefaultResourceLoader({
    agentDir: agentDirectory,
    appendSystemPrompt: buildPiDelegatedTaskSystemPrompt(childThread),
    cwd: thread.worktreePath,
    extensionFactories: [createThreadToolPolicyExtension(childThread)],
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
    settingsManager,
  });
  await resourceLoader.reload();

  const githubTools =
    childThread.githubAccess === true
      ? createPiGitHubTools(
          {
            worktreePathContext: childThread.worktreePath,
          },
          options?.githubToolHost ??
            createPiGitHubCliHost(childThread.worktreePath),
        )
      : [];
  const metidosTools =
    childThread.metidosAccess === true
      ? (() => {
          if (!options?.metidosToolHost) {
            throw new Error(
              `Delegated Pi task for thread ${thread.id} requires a Metidos tool host while metidosAccess is enabled.`,
            );
          }
          return createPiMetidosTools(
            {
              allowUnsafeModeEscalation: toolPolicy.allowUnsafeModeEscalation,
              projectIdContext: childThread.projectId,
              threadIdContext: childThread.id,
              worktreePathContext: childThread.worktreePath,
            },
            options.metidosToolHost,
          );
        })()
      : [];
  const { session } = await createAgentSession({
    agentDir: agentDirectory,
    authStorage,
    customTools: [...githubTools, ...metidosTools],
    cwd: childThread.worktreePath,
    model,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
    thinkingLevel: resolvePiThinkingLevel(
      childThread.model,
      childThread.reasoningEffort,
    ),
    tools: buildPiTools(childThread.worktreePath, toolPolicy),
  });

  let delegatedOutputText = "";
  const unsubscribe = session.subscribe((event) => {
    if (
      event.type !== "message_update" ||
      event.assistantMessageEvent.type !== "text_delta"
    ) {
      return;
    }
    delegatedOutputText += event.assistantMessageEvent.delta ?? "";
    options?.onUpdate?.({
      activeToolNames: session.getActiveToolNames(),
      model: `${model.provider}:${model.id}`,
      outputText: delegatedOutputText,
      reasoningEffort: resolvePiThinkingLevel(
        childThread.model,
        childThread.reasoningEffort,
      ),
      sessionId: session.sessionId || null,
    });
  });
  const abortListener = () => {
    void session.abort().catch(() => {});
  };
  options?.signal?.addEventListener("abort", abortListener, { once: true });

  try {
    await session.prompt(request.task);
    const outputText =
      delegatedOutputText.trim() ||
      extractLatestAssistantText(session.messages as readonly unknown[]);
    const result = {
      activeToolNames: session.getActiveToolNames(),
      model: `${model.provider}:${model.id}`,
      outputText,
      reasoningEffort: resolvePiThinkingLevel(
        childThread.model,
        childThread.reasoningEffort,
      ),
      sessionId: session.sessionId || null,
    } satisfies PiDelegatedTaskRun;
    if (options?.signal?.aborted) {
      throw new Error("Delegated task was aborted.");
    }
    return result;
  } finally {
    options?.signal?.removeEventListener("abort", abortListener);
    unsubscribe();
    session.dispose();
  }
}

function createPiAgentsToolHost(
  thread: PiRuntimeThread,
  options?: CreatePiRuntimeOptions,
): PiAgentsToolHost {
  return {
    runDelegatedTask: (request, signal, onUpdate) =>
      runPiDelegatedTask(thread, request, {
        ...(typeof options?.appDataDir === "string"
          ? { appDataDir: options.appDataDir }
          : {}),
        ...(options?.githubToolHost
          ? { githubToolHost: options.githubToolHost }
          : {}),
        ...(options?.metidosToolHost
          ? { metidosToolHost: options.metidosToolHost }
          : {}),
        ...(onUpdate ? { onUpdate } : {}),
        ...(signal ? { signal } : {}),
      }),
  };
}

/**
 * Create or resume the Pi runtime associated with a thread.
 */
export async function createPiThreadRuntime(
  thread: PiRuntimeThread,
  options?: CreatePiRuntimeOptions,
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
  const toolPolicy = buildPiThreadToolPolicy(thread);
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
  const githubTools =
    thread.githubAccess === true
      ? createPiGitHubTools(
          {
            worktreePathContext: thread.worktreePath,
          },
          options?.githubToolHost ?? createPiGitHubCliHost(thread.worktreePath),
        )
      : [];
  const metidosTools =
    thread.metidosAccess === true
      ? (() => {
          if (!options?.metidosToolHost) {
            throw new Error(
              `Pi runtime for thread ${thread.id} requires a Metidos tool host while metidosAccess is enabled.`,
            );
          }
          return createPiMetidosTools(
            {
              allowUnsafeModeEscalation: toolPolicy.allowUnsafeModeEscalation,
              projectIdContext: thread.projectId,
              threadIdContext: thread.id,
              worktreePathContext: thread.worktreePath,
            },
            options.metidosToolHost,
          );
        })()
      : [];
  const agentsTools =
    thread.agentsAccess === true
      ? createPiAgentsTools(
          createPiAgentsToolScope(thread),
          options?.agentsToolHost ?? createPiAgentsToolHost(thread, options),
        )
      : [];
  const { session } = await createAgentSession({
    agentDir: agentDirectory,
    authStorage,
    customTools: [...githubTools, ...metidosTools, ...agentsTools],
    cwd: thread.worktreePath,
    model,
    modelRegistry,
    resourceLoader,
    sessionManager,
    settingsManager,
    thinkingLevel: resolvePiThinkingLevel(thread.model, thread.reasoningEffort),
    tools: buildPiTools(thread.worktreePath, toolPolicy),
  });
  if (options?.extensionUiBridge) {
    await session.bindExtensions(
      options.extensionUiBridge.bindingsForThread(thread.id),
    );
  }

  return {
    agentDirectory,
    contextWindowTokens: model.contextWindow,
    model,
    session,
    sessionDirectory,
  };
}
