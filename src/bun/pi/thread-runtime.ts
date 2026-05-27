/**
 * @file src/bun/pi/thread-runtime.ts
 * @description Pi-backed per-thread runtime helpers.
 */

import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import {
  type AgentSession,
  AuthStorage,
  type CreateAgentSessionOptions,
  createAgentSession,
  createBashToolDefinition,
  DefaultResourceLoader,
  type ExtensionFactory,
  ModelRegistry,
  type AuthStorage as PiAuthStorage,
  type ProviderConfig,
  SessionManager,
  SettingsManager,
  type Skill,
} from "@mariozechner/pi-coding-agent";

import {
  DEFAULT_COMMAND_TIMEOUT_SECONDS,
  getAppDataDirectoryPath,
  initAppDatabase,
  type ThreadRecord,
} from "../db";
import {
  getEffectiveLocalTimezone,
  readLocalRuntimeSettings,
} from "../local-settings";
import { registerPluginModelProviderConfigurations } from "../plugin/model-providers";
import type { PluginSidecarProcessManager } from "../plugin/sidecar-manager";
import {
  codexModelApiId,
  codexModelProvider,
  normalizeStoredCodexReasoningEffort,
} from "../project-procedures/model-catalog";
import {
  createPiAgentsTools,
  type PiAgentsToolHost,
  type PiAgentsToolScope,
  type PiDelegatedTaskRequest,
  type PiDelegatedTaskRun,
} from "./agents-tools";
import registerBravePiWebSearchTools from "./brave-web-search";
import { applyPiBuiltinProviderSettings } from "./builtin-provider-settings";
import type { PiThreadExtensionUiBridge } from "./extension-ui";
import {
  createPiGitCliHost,
  createPiGitTools,
  type PiGitToolHost,
} from "./git-tools/index";
import {
  createPiGitHubCliHost,
  createPiGitHubTools,
  type PiGitHubToolHost,
} from "./github-tools";
import {
  createPiIngressReplyTools,
  type PiIngressReplyToolHost,
} from "./ingress-reply-tool";
import { createPiMetidosTools, type PiMetidosToolHost } from "./metidos/tools";
import {
  buildPiWebSearchPromptLine,
  createPiNativeWebSearchExtension,
  resolvePiWebSearchRuntimeMode,
} from "./native-web-search";
import { registerPiNativeWebSearchProviderOverrides } from "./native-web-search-provider";
import { createPiLanceDbTools } from "./lancedb-tools";
import { createPiPluginTools } from "./plugin-tools";
import {
  createPiRuntimeProbeProviderConfig,
  PI_RUNTIME_PROBE_RUNTIME_API_KEY,
} from "./runtime-probe";
import { createPiSqliteTools } from "./sqlite-tools";
import {
  buildPiThreadToolPolicy,
  hasPiThreadRuntimePermission,
  METIDOS_PERMISSION,
  type PiThreadToolPolicy,
} from "./thread-tool-policy";
import {
  buildPiWebServerPromptLine,
  createPiWebServerManager,
  createPiWebServerTools,
} from "./web-server/tools";

export const PI_THREAD_AGENT_DIRECTORY_NAME = "pi-agent";
export const PI_THREAD_SESSIONS_DIRECTORY_NAME = "thread-sessions";
export const PI_THREAD_RUNTIME_TEST_PROVIDER_ENV =
  "METIDOS_PI_RUNTIME_TEST_PROVIDER";
export const PI_THREAD_RUNTIME_TEST_PROVIDER_CHUNK_DELAY_MS_ENV =
  "METIDOS_PI_RUNTIME_TEST_PROVIDER_CHUNK_DELAY_MS";
export const PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE = "openai-probe";
export const PI_THREAD_RUNTIME_TEST_PROVIDER_ALL_PROVIDERS_PROBE =
  "all-providers-probe";

type PiRuntimeProbeProviderModel = NonNullable<
  ProviderConfig["models"]
>[number];

type PiRuntimeCustomToolDefinition = NonNullable<
  CreateAgentSessionOptions["customTools"]
>[number];

type PiRuntimeTestProviderOverride = {
  providerName: string;
  providerConfig: ProviderConfig;
};

type PiRuntimeTestProviderOverrideCache = {
  envKey: string;
  overrides: PiRuntimeTestProviderOverride[];
};

let piRuntimeTestProviderOverrideCache: PiRuntimeTestProviderOverrideCache | null =
  null;

type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type PiRuntimeThread = Pick<
  ThreadRecord,
  | "id"
  | "model"
  | "permissions"
  | "piSessionFile"
  | "projectId"
  | "reasoningEffort"
  | "worktreePath"
> & {
  ownerUserId?: number;
};

export type PiThreadRuntime = {
  agentDirectory: string;
  contextWindowTokens: number;
  model: Model<Api>;
  reloadResources: () => Promise<void>;
  session: AgentSession;
  sessionDirectory: string;
};

type CreatePiRuntimeOptions = {
  agentsToolHost?: PiAgentsToolHost;
  appDataDir?: string;
  extensionUiBridge?: PiThreadExtensionUiBridge;
  extensionUiSessionId?: string | null;
  githubToolHost?: PiGitHubToolHost;
  gitToolHost?: PiGitToolHost;
  ingressReplyToolHost?: PiIngressReplyToolHost;
  metidosToolHost?: PiMetidosToolHost;
  pluginSidecarManager?: PluginSidecarProcessManager | null;
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

function resolveThreadWebSearchAccess(thread: PiRuntimeThread): boolean {
  return hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.webSearch);
}

function pluginPermissionIdsToAccessGroupKeys(
  permissionIds: readonly string[],
): string[] {
  const accessGroupKeys: string[] = [];
  for (const permissionId of permissionIds) {
    if (permissionId.startsWith("metidos:")) {
      continue;
    }
    const separatorIndex = permissionId.indexOf(":");
    if (
      separatorIndex <= 0 ||
      separatorIndex !== permissionId.lastIndexOf(":")
    ) {
      continue;
    }
    accessGroupKeys.push(
      `${permissionId.slice(0, separatorIndex)}/${permissionId.slice(separatorIndex + 1)}`,
    );
  }
  return accessGroupKeys;
}

export async function buildPiPromptWithPluginInjections(input: {
  prompt: string;
  signal?: AbortSignal;
  thread: PiRuntimeThread;
  pluginSidecarManager?: PluginSidecarProcessManager | null;
}): Promise<string> {
  const { pluginSidecarManager, prompt, thread } = input;
  if (!pluginSidecarManager) {
    return prompt;
  }
  const accessGroups = pluginPermissionIdsToAccessGroupKeys(thread.permissions);
  const injected: string[] = [];
  for (const registration of pluginSidecarManager.listPromptInjectionRegistrationsForThread(
    accessGroups,
  )) {
    const content = await pluginSidecarManager.invokePromptInjection({
      context: {
        contextKind: "promptInjection",
        inject: registration.inject,
        ownerUserId: thread.ownerUserId ?? null,
        projectId: thread.projectId,
        threadId: thread.id,
        worktreePath: thread.worktreePath,
      },
      prompt,
      registration,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const trimmed = content.trim();
    if (trimmed) {
      injected.push(trimmed);
    }
  }
  return [...injected, prompt].join("\n");
}

export function buildPiRuntimeCurrentDateTimePromptLine(
  timezone: string,
  now: Date = new Date(),
): string {
  const effectiveTimezone = timezone.trim() || "UTC";
  const formatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: effectiveTimezone,
  });
  return `The current user's time is ${formatter.format(now)} (${effectiveTimezone}).`;
}

function resolvePiRuntimeThreadTimezone(_thread: PiRuntimeThread): string {
  const database = initAppDatabase();
  return getEffectiveLocalTimezone(database);
}

function resolvePiRuntimeCommandTimeoutSeconds(
  _thread: PiRuntimeThread,
): number {
  const database = initAppDatabase();
  return readLocalRuntimeSettings(database).commandTimeoutSeconds;
}

function createMetidosBashToolDefinition(
  cwd: string,
  resolveCommandTimeoutSeconds: () => number,
): PiRuntimeCustomToolDefinition {
  const bashTool = createBashToolDefinition(cwd);
  return {
    ...bashTool,
    description: `${bashTool.description} When omitted, Metidos applies the user's configured command timeout, which defaults to ${DEFAULT_COMMAND_TIMEOUT_SECONDS} seconds.`,
    execute: async (...args: Parameters<typeof bashTool.execute>) => {
      const [toolCallId, params, signal, onUpdate, ctx] = args;
      const commandTimeoutSeconds = resolveCommandTimeoutSeconds();
      return bashTool.execute(
        toolCallId,
        {
          ...params,
          timeout:
            typeof params.timeout === "number"
              ? params.timeout
              : commandTimeoutSeconds,
        },
        signal,
        onUpdate,
        ctx,
      );
    },
  } as unknown as PiRuntimeCustomToolDefinition;
}

function buildPiRuntimeAppendSystemPrompt(
  thread: PiRuntimeThread,
  model: Model<Api>,
): string {
  const toolPolicy = buildPiThreadToolPolicy(thread);
  const currentDateTimeLine = buildPiRuntimeCurrentDateTimePromptLine(
    resolvePiRuntimeThreadTimezone(thread),
  );
  const customToolLines: string[] = [];
  if (resolveThreadWebSearchAccess(thread)) {
    customToolLines.push(buildPiWebSearchPromptLine(model));
  }
  if (hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.agents)) {
    customToolLines.push(
      "Agent coordination tools are installed in this runtime: update_plan and delegate_task.",
      "These are Pi-era replacements. Persistent child-agent lifecycle tools such as request_user_input, send_input, resume_agent, wait_agent, and close_agent are not installed.",
    );
  }
  if (hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.github)) {
    customToolLines.push(
      "GitHub-native tools are installed in this runtime: github_repo, github_issue, github_pr, github_pr_checks, and github_pr_diff.",
    );
  }
  if (hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.git)) {
    customToolLines.push(
      "Local Git CLI tools are installed in this runtime: git_status, git_diff, git_log, git_add, git_commit, git_switch, and related worktree-scoped git_* helpers. They do not require bash.",
    );
  }
  if (hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.sqlite)) {
    customToolLines.push(
      "Project-scoped SQLite tools are installed in this runtime: sqlite. Use them for SQLite queries against database files inside the current workspace.",
    );
  }
  if (hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.lancedb)) {
    customToolLines.push(
      "Project-scoped LanceDB vector tools are installed in this runtime: lancedb_upsert, lancedb_query, and lancedb_delete. lancedb_query embeds the query string with the configured Metidos embedding model.",
    );
  }
  if (hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.webServer)) {
    customToolLines.push(buildPiWebServerPromptLine());
  }
  customToolLines.push(
    "Thread update tool is installed in this runtime: update_thread.",
  );
  const threadsAccessEnabled = hasPiThreadRuntimePermission(
    thread,
    METIDOS_PERMISSION.threads,
  );
  const cronsAccessEnabled = hasPiThreadRuntimePermission(
    thread,
    METIDOS_PERMISSION.crons,
  );
  if (threadsAccessEnabled || cronsAccessEnabled) {
    const installedGroups = [
      "update_thread",
      ...(cronsAccessEnabled
        ? ["list_crons", "show_cron", "new_cron", "update_cron"]
        : []),
      ...(threadsAccessEnabled ? ["new_thread"] : []),
      "model_providers",
      "models_query",
    ];
    const installedGroupsText =
      installedGroups.length > 1
        ? `${installedGroups.slice(0, -1).join(", ")}, and ${installedGroups.at(-1)}`
        : (installedGroups.at(0) ?? "update_thread");
    customToolLines.push(
      `Metidos-native tools are installed in this runtime: ${installedGroupsText}.`,
    );
  }
  if (hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.calendar)) {
    customToolLines.push(
      "Calendar tools are installed in this runtime: list_calendars, list_calendar_events, show_calendar_event, new_calendar_event, and modify_calendar_event.",
    );
  }
  if (hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.notifications)) {
    customToolLines.push(
      "Notification tools are installed in this runtime: notify_user. Use notify_user when the user asks to be notified or when a background task should ping the owning user.",
    );
  }
  if (
    thread.permissions.some((permission) => !permission.startsWith("metidos:"))
  ) {
    customToolLines.push(
      "Thread-selected Plugin System v1 tools may be installed in this runtime. Plugin tool names use plugin_id_tool_name and execute through the plugin sidecar.",
    );
  }
  return [
    currentDateTimeLine,
    `The current workspace root is ${thread.worktreePath}.`,
    "Operate only inside this workspace.",
    toolPolicy.runtimePromptLine,
    ...(customToolLines.length > 0
      ? customToolLines
      : [
          "No web-search, GitHub, Git, Metidos, or agent-coordination tools are installed in this runtime.",
        ]),
  ].join("\n");
}

function hasParentTraversalPathSegment(path: string): boolean {
  return path.split(/[\\/]+/).some((segment) => segment === "..");
}

function pathIsWithinThreadRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath);
  if (!relativePath) {
    return true;
  }
  if (isAbsolute(relativePath)) {
    return false;
  }
  const [firstSegment = ""] = relativePath.split(/[\\/]+/);
  return firstSegment !== "..";
}

function pathExistsOrIsSymlink(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

const realWorktreePathCache = new Map<string, string | null>();

function getCachedRealWorktreePath(
  absoluteWorktreePath: string,
): string | null {
  if (realWorktreePathCache.has(absoluteWorktreePath)) {
    return realWorktreePathCache.get(absoluteWorktreePath) ?? null;
  }

  let realWorktreePath: string | null = null;
  try {
    realWorktreePath = realpathSync(absoluteWorktreePath);
  } catch {
    realWorktreePath = null;
  }
  realWorktreePathCache.set(absoluteWorktreePath, realWorktreePath);
  return realWorktreePath;
}

function existingSymlinkPathsWithinThreadRoot(
  rootPath: string,
  targetPath: string,
): string[] {
  const symlinkPaths: string[] = [];
  let currentPath = rootPath;
  while (true) {
    if (pathExistsOrIsSymlink(currentPath)) {
      try {
        if (lstatSync(currentPath).isSymbolicLink()) {
          symlinkPaths.push(currentPath);
        }
      } catch {
        return symlinkPaths;
      }
    } else {
      return symlinkPaths;
    }

    if (currentPath === targetPath) {
      return symlinkPaths;
    }
    const relativeTargetPath = relative(currentPath, targetPath);
    const [nextSegment = ""] = relativeTargetPath.split(/[\\/]+/);
    if (
      !nextSegment ||
      nextSegment === ".." ||
      isAbsolute(relativeTargetPath)
    ) {
      return symlinkPaths;
    }
    currentPath = join(currentPath, nextSegment);
  }
}

export function resolveThreadScopedPath(
  worktreePath: string,
  candidatePath: string,
): string {
  const trimmedPath = candidatePath.trim();
  if (!trimmedPath) {
    throw new Error("Path is required.");
  }

  if (hasParentTraversalPathSegment(trimmedPath)) {
    throw new Error(
      `Path is outside the current workspace root: ${candidatePath}`,
    );
  }

  const absoluteWorktreePath = resolve(worktreePath);
  const absoluteCandidatePath = isAbsolute(trimmedPath)
    ? resolve(trimmedPath)
    : resolve(absoluteWorktreePath, trimmedPath);

  if (!pathIsWithinThreadRoot(absoluteWorktreePath, absoluteCandidatePath)) {
    throw new Error(
      `Path is outside the current workspace root: ${candidatePath}`,
    );
  }

  const symlinkPaths = existingSymlinkPathsWithinThreadRoot(
    absoluteWorktreePath,
    absoluteCandidatePath,
  );
  if (symlinkPaths.length > 0) {
    const realWorktreePath = getCachedRealWorktreePath(absoluteWorktreePath);
    if (!realWorktreePath) {
      return absoluteCandidatePath;
    }

    for (const symlinkPath of symlinkPaths) {
      let realSymlinkPath = symlinkPath;
      try {
        realSymlinkPath = realpathSync(symlinkPath);
      } catch {
        throw new Error(
          `Path is outside the current workspace root: ${candidatePath}`,
        );
      }
      if (!pathIsWithinThreadRoot(realWorktreePath, realSymlinkPath)) {
        throw new Error(
          `Path is outside the current workspace root: ${candidatePath}`,
        );
      }
    }
  }

  return absoluteCandidatePath;
}

function isThreadScopedPath(
  worktreePath: string,
  candidatePath: string,
): boolean {
  try {
    resolveThreadScopedPath(worktreePath, candidatePath);
    return true;
  } catch {
    return false;
  }
}

export function filterProjectScopedPiSkills(
  worktreePath: string,
  skills: readonly Skill[],
): Skill[] {
  return skills.filter((skill) =>
    isThreadScopedPath(worktreePath, skill.filePath),
  );
}

function buildPiRuntimeExtensionFactories(
  thread: PiRuntimeThread,
  model: Model<Api>,
): ExtensionFactory[] {
  const webSearchMode = resolvePiWebSearchRuntimeMode({
    model,
    webSearchAccess: resolveThreadWebSearchAccess(thread),
  });
  return [
    createThreadToolPolicyExtension(thread),
    createPiNativeWebSearchExtension({
      webSearchAccess: resolveThreadWebSearchAccess(thread),
    }),
    ...(webSearchMode === "brave" ? [registerBravePiWebSearchTools] : []),
  ];
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
    case "ls":
    case "sqlite":
    case "web_server_host": {
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
      if (
        event.toolName === "bash" &&
        !hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.unsafe)
      ) {
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

      if (
        event.toolName === "sqlite" &&
        typeof candidatePath === "string" &&
        isAbsolute(candidatePath.trim())
      ) {
        return {
          block: true,
          reason: "Path must be relative to the current workspace root.",
        };
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

function buildPiRuntimeTestProviderOverrides(
  configuredProvider: string,
  chunkDelayMs: number,
  cacheScope: string,
  modelRegistry: ModelRegistry,
): PiRuntimeTestProviderOverride[] {
  const envKey = `${cacheScope}:${configuredProvider}:${chunkDelayMs}`;
  if (piRuntimeTestProviderOverrideCache?.envKey === envKey) {
    return piRuntimeTestProviderOverrideCache.overrides;
  }

  const probeProviderConfig = createPiRuntimeProbeProviderConfig({
    chunkDelayMs,
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

  const probeApi = probeProviderConfig.api;
  const probeApiKey = probeProviderConfig.apiKey;
  const probeAuthHeader = probeProviderConfig.authHeader;
  const probeBaseUrl = probeProviderConfig.baseUrl;
  const probeStreamSimple = probeProviderConfig.streamSimple;

  const buildProviderConfig = (
    models: PiRuntimeProbeProviderModel[],
  ): ProviderConfig => ({
    api: probeApi,
    apiKey: probeApiKey,
    authHeader: probeAuthHeader,
    baseUrl: probeBaseUrl,
    models,
    streamSimple: probeStreamSimple,
  });

  const overrides: PiRuntimeTestProviderOverride[] = [];
  if (
    configuredProvider === PI_THREAD_RUNTIME_TEST_PROVIDER_ALL_PROVIDERS_PROBE
  ) {
    const modelsByProvider = new Map<string, PiRuntimeProbeProviderModel[]>();
    for (const model of modelRegistry.getAll()) {
      const providerModels = modelsByProvider.get(model.provider) ?? [];
      providerModels.push({
        id: model.id,
        ...(model.compat
          ? {
              compat: structuredClone(model.compat),
            }
          : {}),
        contextWindow: model.contextWindow ?? 128_000,
        cost: model.cost ?? {
          cacheRead: 0,
          cacheWrite: 0,
          input: 0,
          output: 0,
        },
        input: model.input ?? ["text"],
        maxTokens: model.maxTokens ?? 16_384,
        name: model.name ?? `Probe ${model.provider}/${model.id}`,
        reasoning: model.reasoning ?? false,
      });
      modelsByProvider.set(model.provider, providerModels);
    }
    for (const [providerName, models] of modelsByProvider) {
      overrides.push({
        providerName,
        providerConfig: buildProviderConfig(models),
      });
    }
  } else {
    overrides.push({
      providerName: "openai",
      providerConfig: buildProviderConfig([
        {
          id: "gpt-5.4",
          ...(probeModel.compat
            ? {
                compat: structuredClone(probeModel.compat),
              }
            : {}),
          contextWindow: probeModel.contextWindow ?? 8_192,
          cost: probeModel.cost ?? {
            cacheRead: 0,
            cacheWrite: 0,
            input: 0,
            output: 0,
          },
          input: probeModel.input ?? ["text"],
          maxTokens: probeModel.maxTokens ?? 1_024,
          name: "Probe GPT-5.4",
          reasoning: probeModel.reasoning ?? false,
        },
      ]),
    });
  }

  piRuntimeTestProviderOverrideCache = {
    envKey,
    overrides,
  };
  return overrides;
}

function applyPiRuntimeTestProviderOverride(
  authStorage: PiAuthStorage,
  modelRegistry: ModelRegistry,
  cacheScope: string,
): void {
  const configuredProvider =
    process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV]?.trim() || "";
  if (
    configuredProvider !== PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE &&
    configuredProvider !== PI_THREAD_RUNTIME_TEST_PROVIDER_ALL_PROVIDERS_PROBE
  ) {
    return;
  }

  const configuredChunkDelayMs = Number.parseInt(
    process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_CHUNK_DELAY_MS_ENV] ?? "",
    10,
  );
  const chunkDelayMs =
    Number.isFinite(configuredChunkDelayMs) && configuredChunkDelayMs >= 0
      ? configuredChunkDelayMs
      : 1;

  for (const {
    providerName,
    providerConfig,
  } of buildPiRuntimeTestProviderOverrides(
    configuredProvider,
    chunkDelayMs,
    cacheScope,
    modelRegistry,
  )) {
    modelRegistry.registerProvider(providerName, providerConfig);
    authStorage.setRuntimeApiKey(
      providerName,
      PI_RUNTIME_PROBE_RUNTIME_API_KEY,
    );
  }
}

async function createPiModelRegistry(
  agentDirectory: string,
  options: {
    pluginExecutionContext?: {
      ownerUserId?: number | null;
      projectId: number;
      threadId: number;
      worktreePath: string;
    };
    pluginSidecarManager?: PluginSidecarProcessManager | null | undefined;
  } = {},
): Promise<{
  authStorage: PiAuthStorage;
  modelRegistry: ModelRegistry;
}> {
  const authStorage = AuthStorage.create(join(agentDirectory, "auth.json"));
  await applyPiBuiltinProviderSettings({
    authStorage,
    bindings: options.pluginSidecarManager?.listPluginPiAuthBindings() ?? [],
  });
  await options.pluginSidecarManager?.applyPluginOAuthProviderAuth({
    authStorage,
    ownerUserId: options.pluginExecutionContext?.ownerUserId ?? null,
  });
  const modelRegistry = ModelRegistry.create(
    authStorage,
    join(agentDirectory, "models.json"),
  );
  registerPiNativeWebSearchProviderOverrides(modelRegistry);
  if (options.pluginSidecarManager) {
    registerPluginModelProviderConfigurations(
      modelRegistry,
      options.pluginSidecarManager.listPluginModelProviderRegistrations(),
      options.pluginExecutionContext
        ? {
            execution: {
              context: options.pluginExecutionContext,
              execute: (input) =>
                options.pluginSidecarManager?.invokeModelProviderExecution({
                  configuration: input.configuration,
                  configurationId: input.configurationId,
                  context: input.context,
                  model: input.model as unknown as Record<string, unknown>,
                  modelContext: input.modelContext as unknown as Record<
                    string,
                    unknown
                  >,
                  options: input.options as Record<string, unknown> | undefined,
                  pluginId: input.pluginId,
                  providerId: input.providerId,
                  signal: input.signal,
                  timeoutMs: input.timeoutMs,
                }) ??
                Promise.reject(
                  new Error("Plugin sidecar manager unavailable."),
                ),
            },
          }
        : {},
    );
    if (options.pluginExecutionContext) {
      const runtimeApiKeys =
        await options.pluginSidecarManager.resolvePluginModelProviderRuntimeApiKeys(
          {
            ownerUserId: options.pluginExecutionContext.ownerUserId ?? null,
          },
        );
      for (const [providerId, apiKey] of runtimeApiKeys) {
        authStorage.setRuntimeApiKey(providerId, apiKey);
      }
    }
  }
  applyPiRuntimeTestProviderOverride(
    authStorage,
    modelRegistry,
    agentDirectory,
  );
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

function buildPiActiveToolNames(options: {
  customTools: NonNullable<CreateAgentSessionOptions["customTools"]>;
  model: Model<Api>;
  thread: PiRuntimeThread;
  toolPolicy: PiThreadToolPolicy;
}): NonNullable<CreateAgentSessionOptions["tools"]> {
  const toolNames: NonNullable<CreateAgentSessionOptions["tools"]> = [
    ...options.toolPolicy.activeToolNames,
  ];
  const webSearchMode = resolvePiWebSearchRuntimeMode({
    model: options.model,
    webSearchAccess: resolveThreadWebSearchAccess(options.thread),
  });
  if (webSearchMode === "brave") {
    toolNames.push("web_search", "web_fetch");
  }
  toolNames.push(...options.customTools.map((tool) => tool.name));
  return [...new Set(toolNames)];
}

function buildPiDelegatedTaskSystemPrompt(
  thread: PiRuntimeThread,
  model: Model<Api>,
): string {
  return [
    buildPiRuntimeAppendSystemPrompt(
      {
        ...thread,
        permissions: thread.permissions.filter(
          (permission) => permission !== METIDOS_PERMISSION.agents,
        ),
      },
      model,
    ),
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

type PiRuntimeDisposableResource = {
  close?: () => Promise<unknown> | unknown;
  destroy?: () => Promise<unknown> | unknown;
  dispose?: () => Promise<unknown> | unknown;
};

async function disposePiRuntimeResource(resource: unknown): Promise<void> {
  if (!resource || typeof resource !== "object") {
    return;
  }
  const disposable = resource as PiRuntimeDisposableResource;
  const cleanup = disposable.dispose ?? disposable.close ?? disposable.destroy;
  if (typeof cleanup !== "function") {
    return;
  }
  await cleanup.call(resource);
}

async function disposePiRuntimeResources(
  resources: readonly unknown[],
): Promise<void> {
  await Promise.allSettled(
    resources.map((resource) => disposePiRuntimeResource(resource)),
  );
}

export async function runPiDelegatedTask(
  thread: PiRuntimeThread,
  request: PiDelegatedTaskRequest,
  options?: {
    appDataDir?: string;
    githubToolHost?: PiGitHubToolHost;
    gitToolHost?: PiGitToolHost;
    ingressReplyToolHost?: PiIngressReplyToolHost;
    metidosToolHost?: PiMetidosToolHost;
    pluginSidecarManager?: PluginSidecarProcessManager | null;
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
    model: request.model ?? thread.model,
    permissions: thread.permissions.filter(
      (permission) => permission !== METIDOS_PERMISSION.agents,
    ),
    reasoningEffort: request.reasoningEffort ?? thread.reasoningEffort,
  };
  const { authStorage, modelRegistry } = await createPiModelRegistry(
    agentDirectory,
    {
      pluginExecutionContext: {
        ownerUserId: childThread.ownerUserId ?? null,
        projectId: childThread.projectId,
        threadId: childThread.id,
        worktreePath: childThread.worktreePath,
      },
      pluginSidecarManager: options?.pluginSidecarManager,
    },
  );
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
    appendSystemPrompt: [buildPiDelegatedTaskSystemPrompt(childThread, model)],
    cwd: thread.worktreePath,
    extensionFactories: buildPiRuntimeExtensionFactories(childThread, model),
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    settingsManager,
    skillsOverride: (current) => ({
      skills: filterProjectScopedPiSkills(
        childThread.worktreePath,
        current.skills,
      ),
      diagnostics: current.diagnostics,
    }),
  });
  try {
    await resourceLoader.reload();

    const githubTools = hasPiThreadRuntimePermission(
      childThread,
      METIDOS_PERMISSION.github,
    )
      ? createPiGitHubTools(
          {
            worktreePathContext: childThread.worktreePath,
          },
          options?.githubToolHost ??
            createPiGitHubCliHost(childThread.worktreePath),
        )
      : [];
    const gitTools = hasPiThreadRuntimePermission(
      childThread,
      METIDOS_PERMISSION.git,
    )
      ? createPiGitTools(
          {
            worktreePathContext: childThread.worktreePath,
          },
          options?.gitToolHost ?? createPiGitCliHost(childThread.worktreePath),
        )
      : [];
    const sqliteTools = hasPiThreadRuntimePermission(
      childThread,
      METIDOS_PERMISSION.sqlite,
    )
      ? createPiSqliteTools({
          worktreePathContext: childThread.worktreePath,
        })
      : [];
    const lancedbTools = hasPiThreadRuntimePermission(
      childThread,
      METIDOS_PERMISSION.lancedb,
    )
      ? createPiLanceDbTools({
          embed: async (query) => {
            if (!options?.pluginSidecarManager) {
              throw new Error(
                "LanceDB query requires the Metidos plugin sidecar manager for embeddings.",
              );
            }
            return options.pluginSidecarManager.embedForThread({
              ownerUserId: childThread.ownerUserId,
              projectId: childThread.projectId,
              query,
              threadId: childThread.id,
              worktreePath: childThread.worktreePath,
            });
          },
          worktreePathContext: childThread.worktreePath,
        })
      : [];
    const webServerManager = hasPiThreadRuntimePermission(
      childThread,
      METIDOS_PERMISSION.webServer,
    )
      ? createPiWebServerManager({
          ownerUserId: childThread.ownerUserId,
          projectId: childThread.projectId,
          threadId: childThread.id,
          worktreePathContext: childThread.worktreePath,
        })
      : null;
    try {
      const webServerTools =
        webServerManager !== null
          ? createPiWebServerTools(
              {
                ownerUserId: childThread.ownerUserId,
                projectId: childThread.projectId,
                threadId: childThread.id,
                worktreePathContext: childThread.worktreePath,
              },
              webServerManager,
            )
          : [];
      const metidosTools = options?.metidosToolHost
        ? createPiMetidosTools(
            {
              allowUnsafeModeEscalation: toolPolicy.allowUnsafeModeEscalation,
              calendarAccessEnabled: hasPiThreadRuntimePermission(
                childThread,
                METIDOS_PERMISSION.calendar,
              ),
              notificationsAccessEnabled: hasPiThreadRuntimePermission(
                childThread,
                METIDOS_PERMISSION.notifications,
              ),
              threadsAccessEnabled: hasPiThreadRuntimePermission(
                childThread,
                METIDOS_PERMISSION.threads,
              ),
              cronsAccessEnabled: hasPiThreadRuntimePermission(
                childThread,
                METIDOS_PERMISSION.crons,
              ),
              metidosAccessEnabled: false,
              permissionsContext: childThread.permissions,
              modelContext: childThread.model,
              projectIdContext: childThread.projectId,
              reasoningEffortContext: normalizeStoredCodexReasoningEffort(
                childThread.reasoningEffort,
              ),
              threadIdContext: childThread.id,
              unsafeModeEnabled: hasPiThreadRuntimePermission(
                childThread,
                METIDOS_PERMISSION.unsafe,
              ),
              worktreePathContext: childThread.worktreePath,
            },
            options.metidosToolHost,
          )
        : hasPiThreadRuntimePermission(
              childThread,
              METIDOS_PERMISSION.threads,
            ) ||
            hasPiThreadRuntimePermission(
              childThread,
              METIDOS_PERMISSION.crons,
            ) ||
            hasPiThreadRuntimePermission(
              childThread,
              METIDOS_PERMISSION.calendar,
            ) ||
            hasPiThreadRuntimePermission(
              childThread,
              METIDOS_PERMISSION.notifications,
            )
          ? (() => {
              throw new Error(
                `Delegated Pi task for thread ${thread.id} requires a Metidos tool host while Metidos, Calendar, or Notification access is enabled.`,
              );
            })()
          : [];
      const ingressReplyTools = options?.ingressReplyToolHost
        ? createPiIngressReplyTools(
            { threadIdContext: childThread.id },
            options.ingressReplyToolHost,
          )
        : [];
      const pluginTools = options?.pluginSidecarManager
        ? createPiPluginTools({
            context: {
              contextKind: "threadTool",
              ownerUserId: childThread.ownerUserId ?? null,
              projectId: childThread.projectId,
              threadId: childThread.id,
              worktreePath: childThread.worktreePath,
            },
            enabledPermissions: childThread.permissions,
            manager: options.pluginSidecarManager,
          })
        : [];
      const bashTools = toolPolicy.allowBash
        ? [
            createMetidosBashToolDefinition(childThread.worktreePath, () =>
              resolvePiRuntimeCommandTimeoutSeconds(childThread),
            ),
          ]
        : [];
      const customTools = [
        ...bashTools,
        ...githubTools,
        ...gitTools,
        ...sqliteTools,
        ...lancedbTools,
        ...webServerTools,
        ...metidosTools,
        ...ingressReplyTools,
        ...pluginTools,
      ];
      const { session } = await createAgentSession({
        agentDir: agentDirectory,
        authStorage,
        customTools,
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
        tools: buildPiActiveToolNames({
          customTools,
          model,
          thread: childThread,
          toolPolicy,
        }),
      });

      const originalDispose = session.dispose.bind(session);
      session.dispose = (async () => {
        await webServerManager?.dispose();
        await originalDispose();
      }) as typeof session.dispose;

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
        await session.dispose();
      }
    } catch (error) {
      await webServerManager?.dispose();
      throw error;
    }
  } finally {
    await disposePiRuntimeResources([
      resourceLoader,
      modelRegistry,
      authStorage,
    ]);
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
        ...(options?.gitToolHost ? { gitToolHost: options.gitToolHost } : {}),
        ...(options?.metidosToolHost
          ? { metidosToolHost: options.metidosToolHost }
          : {}),
        ...(options?.ingressReplyToolHost
          ? { ingressReplyToolHost: options.ingressReplyToolHost }
          : {}),
        ...(options?.pluginSidecarManager
          ? { pluginSidecarManager: options.pluginSidecarManager }
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
  const { authStorage, modelRegistry } = await createPiModelRegistry(
    agentDirectory,
    {
      pluginExecutionContext: {
        ownerUserId: thread.ownerUserId ?? null,
        projectId: thread.projectId,
        threadId: thread.id,
        worktreePath: thread.worktreePath,
      },
      pluginSidecarManager: options?.pluginSidecarManager,
    },
  );
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
    appendSystemPrompt: [buildPiRuntimeAppendSystemPrompt(thread, model)],
    cwd: thread.worktreePath,
    extensionFactories: buildPiRuntimeExtensionFactories(thread, model),
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    settingsManager,
    skillsOverride: (current) => ({
      skills: filterProjectScopedPiSkills(thread.worktreePath, current.skills),
      diagnostics: current.diagnostics,
    }),
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
  const githubTools = hasPiThreadRuntimePermission(
    thread,
    METIDOS_PERMISSION.github,
  )
    ? createPiGitHubTools(
        {
          worktreePathContext: thread.worktreePath,
        },
        options?.githubToolHost ?? createPiGitHubCliHost(thread.worktreePath),
      )
    : [];
  const gitTools = hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.git)
    ? createPiGitTools(
        {
          worktreePathContext: thread.worktreePath,
        },
        options?.gitToolHost ?? createPiGitCliHost(thread.worktreePath),
      )
    : [];
  const sqliteTools = hasPiThreadRuntimePermission(
    thread,
    METIDOS_PERMISSION.sqlite,
  )
    ? createPiSqliteTools({
        worktreePathContext: thread.worktreePath,
      })
    : [];
  const lancedbTools = hasPiThreadRuntimePermission(
    thread,
    METIDOS_PERMISSION.lancedb,
  )
    ? createPiLanceDbTools({
        embed: async (query) => {
          if (!options?.pluginSidecarManager) {
            throw new Error(
              "LanceDB query requires the Metidos plugin sidecar manager for embeddings.",
            );
          }
          return options.pluginSidecarManager.embedForThread({
            ownerUserId: thread.ownerUserId,
            projectId: thread.projectId,
            query,
            threadId: thread.id,
            worktreePath: thread.worktreePath,
          });
        },
        worktreePathContext: thread.worktreePath,
      })
    : [];
  const webServerManager = hasPiThreadRuntimePermission(
    thread,
    METIDOS_PERMISSION.webServer,
  )
    ? createPiWebServerManager({
        ownerUserId: thread.ownerUserId,
        projectId: thread.projectId,
        threadId: thread.id,
        worktreePathContext: thread.worktreePath,
      })
    : null;
  try {
    const webServerTools =
      webServerManager !== null
        ? createPiWebServerTools(
            {
              ownerUserId: thread.ownerUserId,
              projectId: thread.projectId,
              threadId: thread.id,
              worktreePathContext: thread.worktreePath,
            },
            webServerManager,
          )
        : [];
    const metidosTools = options?.metidosToolHost
      ? createPiMetidosTools(
          {
            allowUnsafeModeEscalation: toolPolicy.allowUnsafeModeEscalation,
            calendarAccessEnabled: hasPiThreadRuntimePermission(
              thread,
              METIDOS_PERMISSION.calendar,
            ),
            notificationsAccessEnabled: hasPiThreadRuntimePermission(
              thread,
              METIDOS_PERMISSION.notifications,
            ),
            threadsAccessEnabled: hasPiThreadRuntimePermission(
              thread,
              METIDOS_PERMISSION.threads,
            ),
            cronsAccessEnabled: hasPiThreadRuntimePermission(
              thread,
              METIDOS_PERMISSION.crons,
            ),
            metidosAccessEnabled: false,
            permissionsContext: thread.permissions,
            modelContext: thread.model,
            projectIdContext: thread.projectId,
            reasoningEffortContext: normalizeStoredCodexReasoningEffort(
              thread.reasoningEffort,
            ),
            threadIdContext: thread.id,
            unsafeModeEnabled: hasPiThreadRuntimePermission(
              thread,
              METIDOS_PERMISSION.unsafe,
            ),
            worktreePathContext: thread.worktreePath,
          },
          options.metidosToolHost,
        )
      : hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.threads) ||
          hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.crons) ||
          hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.calendar) ||
          hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.notifications)
        ? (() => {
            throw new Error(
              `Pi runtime for thread ${thread.id} requires a Metidos tool host while Metidos, Calendar, or Notification access is enabled.`,
            );
          })()
        : [];
    const agentsTools = hasPiThreadRuntimePermission(
      thread,
      METIDOS_PERMISSION.agents,
    )
      ? createPiAgentsTools(
          createPiAgentsToolScope(thread),
          options?.agentsToolHost ?? createPiAgentsToolHost(thread, options),
        )
      : [];
    const ingressReplyTools = options?.ingressReplyToolHost
      ? createPiIngressReplyTools(
          { threadIdContext: thread.id },
          options.ingressReplyToolHost,
        )
      : [];
    const pluginTools = options?.pluginSidecarManager
      ? createPiPluginTools({
          context: {
            contextKind: "threadTool",
            ownerUserId: thread.ownerUserId ?? null,
            projectId: thread.projectId,
            threadId: thread.id,
            worktreePath: thread.worktreePath,
          },
          enabledPermissions: thread.permissions,
          manager: options.pluginSidecarManager,
        })
      : [];
    const bashTools = toolPolicy.allowBash
      ? [
          createMetidosBashToolDefinition(thread.worktreePath, () =>
            resolvePiRuntimeCommandTimeoutSeconds(thread),
          ),
        ]
      : [];
    const customTools = [
      ...bashTools,
      ...githubTools,
      ...gitTools,
      ...sqliteTools,
      ...lancedbTools,
      ...webServerTools,
      ...metidosTools,
      ...agentsTools,
      ...ingressReplyTools,
      ...pluginTools,
    ];
    const { session } = await createAgentSession({
      agentDir: agentDirectory,
      authStorage,
      customTools,
      cwd: thread.worktreePath,
      model,
      modelRegistry,
      resourceLoader,
      sessionManager,
      settingsManager,
      thinkingLevel: resolvePiThinkingLevel(
        thread.model,
        thread.reasoningEffort,
      ),
      tools: buildPiActiveToolNames({
        customTools,
        model,
        thread,
        toolPolicy,
      }),
    });
    const originalDispose = session.dispose.bind(session);
    session.dispose = (async () => {
      await webServerManager?.dispose();
      await originalDispose();
    }) as typeof session.dispose;

    const extensionUiSessionId = options?.extensionUiSessionId ?? null;
    if (options?.extensionUiBridge) {
      await session.bindExtensions(
        options.extensionUiBridge.bindingsForThread(
          thread.id,
          extensionUiSessionId,
        ),
      );
    }

    return {
      agentDirectory,
      contextWindowTokens: model.contextWindow,
      model,
      reloadResources: () => resourceLoader.reload(),
      session,
      sessionDirectory,
    };
  } catch (error) {
    await webServerManager?.dispose();
    throw error;
  }
}
