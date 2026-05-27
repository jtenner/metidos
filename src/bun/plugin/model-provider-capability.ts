/**
 * @file src/bun/plugin/model-provider-capability.ts
 * @description Internal capability seam for Plugin System v1 model providers, OAuth providers, and Pi Auth bindings.
 */

import { registerOAuthProvider } from "@mariozechner/pi-ai/oauth";

import type { AppDataPathOptions } from "../db";
import type { PiAuthPluginBinding } from "../pi/builtin-provider-settings";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { PLUGIN_PROVIDES_EMBEDDINGS_PERMISSION } from "./embeddings";
import {
  type PluginModelProviderRegistration,
  resolvedPluginProviderRegistryId,
} from "./model-providers";
import {
  type PluginRuntimeSettings,
  readPluginSettingsForRuntime,
} from "./settings";
import {
  PLUGIN_STARTUP_MODEL_PROVIDER_CONFIGURATION_LIMIT,
  type PluginStartupModelProviderConfiguration,
  type PluginStartupOAuthProviderRegistration,
  type PluginStartupRegistrations,
} from "./startup-registrations";

export type PluginModelProviderRefreshState = {
  inFlight: boolean;
  lastAttemptedAt: number | null;
  lastError: string | null;
  lastSuccessfulAt: number | null;
};

export type PluginModelProviderCapabilitySession = {
  capturedEnv: readonly { key: string; value: string | null }[];
  directoryName: string;
  modelProviderRefreshState: Map<string, PluginModelProviderRefreshState>;
  plugin: RpcPluginInventoryPlugin;
  ready?: boolean;
  registrations: PluginStartupRegistrations | null;
  stopping?: boolean;
};

export type PluginOAuthCredential = Record<string, unknown> & {
  access: string;
  expires: number;
  refresh: string;
  type: "oauth";
};

export type PluginOAuthProviderRegistrationView = {
  directoryName: string;
  pluginId: string | null;
  pluginName: string | null;
  registration: PluginStartupOAuthProviderRegistration;
};

type PluginProviderPiAuthRecord = {
  kind: "api_key";
  source: "env" | "setting";
  value: string;
};

export type PluginRuntimeSettingsSnapshot = Pick<
  PluginRuntimeSettings,
  "missingRequiredKeys" | "values"
>;

export type PluginModelProviderCatalogChangeEvent = {
  configurationCount: number;
  directoryName: string;
  durationMs: number;
  modelCount: number;
  providerId: string;
  success: boolean;
};

export type PluginModelProviderExecutionContext = {
  contextKind: "providerExecution";
  ownerUserId?: number | null;
  projectId: number;
  threadId: number;
  worktreePath: string;
};

export type PluginModelProviderExecutionRequestInput = {
  configuration: Record<string, unknown>;
  configurationId: string;
  context: PluginModelProviderExecutionContext;
  model: Record<string, unknown>;
  modelContext: Record<string, unknown>;
  options?: Record<string, unknown> | undefined;
  pluginId: string;
  providerId: string;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | null | undefined;
};

export type PluginCapabilitySidecarRequest = {
  directoryName?: string;
  operation: string;
  params?: unknown;
  pluginId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

function isReadyCapabilitySession(
  session: PluginModelProviderCapabilitySession,
): boolean {
  return !session.ready || Boolean(session.ready && !session.stopping);
}

function pluginSettingsDeclarations(plugin: RpcPluginInventoryPlugin) {
  return plugin.manifest.settings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runtimeSettingsSnapshot(
  scope: PluginRuntimeSettings,
): PluginRuntimeSettingsSnapshot {
  return {
    missingRequiredKeys: [...scope.missingRequiredKeys],
    values: { ...scope.values },
  };
}

function missingRequiredSettingsMessage(keys: string[]): string {
  return `Missing required plugin settings: ${keys.join(", ")}.`;
}

function pluginProviderRuntimeApiKeyValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const withoutBearerPrefix = trimmed.replace(/^Bearer\s+/iu, "").trim();
  return withoutBearerPrefix.length > 0 ? withoutBearerPrefix : null;
}

function pluginProviderPiAuthRecords(
  value: unknown,
): PluginProviderPiAuthRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((record): PluginProviderPiAuthRecord[] => {
    if (!isRecord(record)) {
      return [];
    }
    if (record.kind !== "api_key") {
      return [];
    }
    if (record.source !== "env" && record.source !== "setting") {
      return [];
    }
    if (typeof record.value !== "string" || record.value.trim().length === 0) {
      return [];
    }
    return [
      {
        kind: "api_key",
        source: record.source,
        value: record.value.trim(),
      },
    ];
  });
}

export function createPluginModelProviderRefreshState(
  input: { lastAttemptedAt?: number; lastSuccessfulAt?: number } = {},
): PluginModelProviderRefreshState {
  return {
    inFlight: false,
    lastAttemptedAt: input.lastAttemptedAt ?? null,
    lastError: null,
    lastSuccessfulAt: input.lastSuccessfulAt ?? null,
  };
}

export function createPluginModelProviderRefreshStatesFromRegistrations(
  registrations: PluginStartupRegistrations,
  now = Date.now(),
): Map<string, PluginModelProviderRefreshState> {
  return new Map(
    registrations.modelProviders.map((provider) => [
      provider.id,
      createPluginModelProviderRefreshState({
        lastAttemptedAt: now,
        lastSuccessfulAt: now,
      }),
    ]),
  );
}

export function modelProviderRefreshesDue<
  TSession extends PluginModelProviderCapabilitySession,
>(input: {
  now: number;
  sessions: Iterable<TSession>;
}): Array<{
  providerId: string;
  session: TSession;
}> {
  const refreshes: Array<{
    providerId: string;
    session: TSession;
  }> = [];
  for (const session of input.sessions) {
    if (!isReadyCapabilitySession(session) || !session.registrations) {
      continue;
    }
    for (const provider of session.registrations.modelProviders) {
      if (!provider.getProviderConfigurationsHandle) {
        continue;
      }
      const refreshIntervalMs = provider.refreshIntervalMs;
      if (refreshIntervalMs === null) {
        continue;
      }
      const state =
        session.modelProviderRefreshState.get(provider.id) ??
        createPluginModelProviderRefreshState();
      if (state.inFlight) {
        continue;
      }
      const lastRefreshAt = state.lastSuccessfulAt ?? state.lastAttemptedAt;
      if (
        lastRefreshAt !== null &&
        input.now - lastRefreshAt < refreshIntervalMs
      ) {
        continue;
      }
      refreshes.push({ providerId: provider.id, session });
    }
  }
  return refreshes;
}

export function normalizePluginOAuthCredential(
  value: unknown,
): PluginOAuthCredential | null {
  if (!isRecord(value)) {
    return null;
  }
  const access = typeof value.access === "string" ? value.access.trim() : "";
  const expires = value.expires;
  if (!access || typeof expires !== "number" || !Number.isFinite(expires)) {
    return null;
  }
  const refresh = typeof value.refresh === "string" ? value.refresh : "";
  return {
    ...value,
    access,
    expires,
    refresh,
    type: "oauth",
  };
}

export function normalizeRefreshedPluginModelProviderConfigurations(
  value: unknown,
): PluginStartupModelProviderConfiguration[] {
  if (!Array.isArray(value)) {
    throw new Error("Plugin model provider refresh result must be an array.");
  }
  if (value.length > PLUGIN_STARTUP_MODEL_PROVIDER_CONFIGURATION_LIMIT) {
    throw new Error(
      `Plugin model provider refresh result must contain at most ${PLUGIN_STARTUP_MODEL_PROVIDER_CONFIGURATION_LIMIT} configurations.`,
    );
  }
  const seenIds = new Set<string>();
  return value.map((configuration, index) => {
    if (!isRecord(configuration)) {
      throw new Error(
        `Plugin model provider refresh configuration ${index} must be an object.`,
      );
    }
    const id = configuration.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(
        `Plugin model provider refresh configuration ${index}.id must be a non-empty string.`,
      );
    }
    if (seenIds.has(id)) {
      throw new Error(
        `Plugin model provider refresh configuration ${index}.id duplicates ${id}.`,
      );
    }
    seenIds.add(id);
    return { id, value: { ...configuration } };
  });
}

export function listPluginModelProviderRegistrationsForSessions(input: {
  sessions: Iterable<PluginModelProviderCapabilitySession>;
}): PluginModelProviderRegistration[] {
  const registrations: PluginModelProviderRegistration[] = [];
  for (const session of input.sessions) {
    if (!isReadyCapabilitySession(session) || !session.registrations) {
      continue;
    }
    if (!session.plugin.pluginId) {
      continue;
    }
    const manifestProviders = new Map(
      session.plugin.manifest.providers.flatMap((provider) =>
        provider.id ? [[provider.id, provider] as const] : [],
      ),
    );
    for (const provider of session.registrations.modelProviders) {
      const manifestProvider = manifestProviders.get(provider.id) ?? null;
      const refreshState = session.modelProviderRefreshState.get(provider.id);
      const refreshError = refreshState?.lastError ?? null;
      const providerName = manifestProvider?.name ?? null;
      const providerCanEmbed = Boolean(
        provider.embedHandle &&
          session.plugin.manifest.permissions.includes(
            PLUGIN_PROVIDES_EMBEDDINGS_PERMISSION,
          ),
      );
      const baseRegistration = {
        directoryName: session.directoryName,
        ...(provider.embedHandle ? { embedHandle: provider.embedHandle } : {}),
        executeHandle: provider.executeHandle,
        pluginId: session.plugin.pluginId,
        pluginName: session.plugin.name,
        providerId: provider.id,
        providerName,
        ...(providerCanEmbed ? { providesEmbeddings: true } : {}),
        timeoutMs: provider.timeoutMs,
      };
      if (provider.configurations.length === 0) {
        registrations.push({
          ...baseRegistration,
          configuration: {
            id: "default",
            label: providerName ?? provider.id,
            models: [],
          },
          configurationId: "default",
          configurationLabel: providerName,
          refreshError:
            refreshError ??
            (refreshState?.inFlight
              ? "Model provider refresh is in progress."
              : "Model provider has not returned any configurations yet."),
        });
        continue;
      }
      for (const configuration of provider.configurations) {
        registrations.push({
          ...baseRegistration,
          configuration: configuration.value,
          configurationId: configuration.id,
          configurationLabel:
            typeof configuration.value.label === "string" &&
            configuration.value.label.trim().length > 0
              ? configuration.value.label.trim()
              : null,
          refreshError,
        });
      }
    }
  }
  return registrations.sort((left, right) =>
    `${left.pluginId}/${left.providerId}/${left.configurationId}`.localeCompare(
      `${right.pluginId}/${right.providerId}/${right.configurationId}`,
    ),
  );
}

export function listPluginPiAuthBindingsForSessions(input: {
  sessions: Iterable<PluginModelProviderCapabilitySession>;
}): PiAuthPluginBinding[] {
  const bindings: PiAuthPluginBinding[] = [];
  for (const session of input.sessions) {
    if (!isReadyCapabilitySession(session) || !session.plugin.pluginId) {
      continue;
    }
    const settings = pluginSettingsDeclarations(session.plugin);
    const capturedEnvValues = new Map(
      session.capturedEnv.map((envVar) => [envVar.key, envVar.value]),
    );
    for (const binding of session.plugin.manifest.piAuth) {
      if (
        (binding.kind !== "api_key" &&
          binding.kind !== "codex_auth" &&
          binding.kind !== "pi_oauth_file") ||
        !binding.provider ||
        (binding.source !== "env" && binding.source !== "setting") ||
        !binding.value
      ) {
        continue;
      }
      bindings.push({
        directoryName: session.directoryName,
        envValues: capturedEnvValues,
        kind: binding.kind,
        providerId: binding.provider,
        settings,
        source: binding.source,
        value: binding.value,
      });
    }
  }
  return bindings;
}

export function listPluginOAuthProviderRegistrationsForSessions(input: {
  sessions: Iterable<PluginModelProviderCapabilitySession>;
}): PluginOAuthProviderRegistrationView[] {
  const registrations: PluginOAuthProviderRegistrationView[] = [];
  for (const session of input.sessions) {
    if (!isReadyCapabilitySession(session) || !session.registrations) {
      continue;
    }
    for (const registration of session.registrations.oauthProviders) {
      registrations.push({
        directoryName: session.directoryName,
        pluginId: session.plugin.pluginId,
        pluginName: session.plugin.name,
        registration,
      });
    }
  }
  return registrations;
}

export async function buildPluginOAuthProviderImportRequest(input: {
  appDataOptions: AppDataPathOptions;
  ownerUserId?: number | null;
  pluginId: string | null;
  registration: PluginStartupOAuthProviderRegistration;
  session: PluginModelProviderCapabilitySession | null | undefined;
}): Promise<PluginCapabilitySidecarRequest | null> {
  if (!input.registration.importCredentialsHandle || !input.pluginId) {
    return null;
  }
  const session = input.session;
  if (!session?.plugin.pluginId || !session.registrations) {
    return null;
  }
  const settings = await readPluginSettingsForRuntime({
    declarations: pluginSettingsDeclarations(session.plugin),
    directoryName: session.directoryName,
    options: input.appDataOptions,
  });
  return {
    directoryName: session.directoryName,
    operation: "oauth.provider.import",
    params: {
      context: {
        contextKind: "oauthProvider",
        ownerUserId: input.ownerUserId ?? null,
        settings: runtimeSettingsSnapshot(settings),
      },
      handle: input.registration.importCredentialsHandle,
      providerId: input.registration.provider,
    },
    pluginId: input.pluginId,
    timeoutMs: input.registration.timeoutMs,
  };
}

export function buildPluginOAuthProviderRefreshRequest(input: {
  credentials: PluginOAuthCredential;
  pluginId: string | null;
  registration: PluginStartupOAuthProviderRegistration;
}): PluginCapabilitySidecarRequest {
  if (!input.registration.refreshHandle || !input.pluginId) {
    throw new Error(
      `Plugin OAuth provider ${input.registration.id} cannot refresh credentials.`,
    );
  }
  return {
    operation: "oauth.provider.refresh",
    params: {
      credentials: input.credentials,
      handle: input.registration.refreshHandle,
      providerId: input.registration.provider,
    },
    pluginId: input.pluginId,
    timeoutMs: input.registration.timeoutMs,
  };
}

export function registerPluginOAuthProviderRegistrations(input: {
  invokeRefresh: (input: {
    credentials: PluginOAuthCredential;
    pluginId: string | null;
    registration: PluginStartupOAuthProviderRegistration;
  }) => Promise<PluginOAuthCredential>;
  registerProvider?: typeof registerOAuthProvider;
  registrations: readonly PluginOAuthProviderRegistrationView[];
}): void {
  const registerProvider = input.registerProvider ?? registerOAuthProvider;
  for (const item of input.registrations) {
    if (!item.registration.refreshHandle) {
      continue;
    }
    registerProvider({
      id: item.registration.provider,
      name: item.pluginName ?? item.registration.id,
      async login() {
        throw new Error(
          "Plugin OAuth providers do not support host-initiated login yet.",
        );
      },
      refreshToken: async (credentials: Record<string, unknown>) => {
        return await input.invokeRefresh({
          credentials: {
            ...credentials,
            type: "oauth",
          } as PluginOAuthCredential,
          pluginId: item.pluginId,
          registration: item.registration,
        });
      },
      getApiKey(credentials: { access?: unknown }) {
        return typeof credentials.access === "string" ? credentials.access : "";
      },
    });
  }
}

export async function buildPluginModelProviderExecutionRequest(input: {
  appDataOptions: AppDataPathOptions;
  invocation: PluginModelProviderExecutionRequestInput;
  session: PluginModelProviderCapabilitySession | null | undefined;
}): Promise<
  | { ok: true; request: PluginCapabilitySidecarRequest }
  | { cause?: Error; code: string; ok: false; pluginUnavailable?: boolean }
> {
  const session = input.session;
  if (!session?.plugin.pluginId || !session.registrations) {
    return {
      code: "plugin_unavailable",
      ok: false,
      pluginUnavailable: true,
    };
  }
  const provider = session.registrations.modelProviders.find(
    (candidate) => candidate.id === input.invocation.providerId,
  );
  if (!provider?.executeHandle) {
    return { code: "plugin_model_provider_execute_unavailable", ok: false };
  }
  const configuration = provider.configurations.find(
    (candidate) => candidate.id === input.invocation.configurationId,
  );
  if (!configuration) {
    return {
      code: "plugin_model_provider_configuration_unavailable",
      ok: false,
    };
  }

  const settings = await readPluginSettingsForRuntime({
    declarations: pluginSettingsDeclarations(session.plugin),
    directoryName: session.directoryName,
    options: input.appDataOptions,
  });
  if (settings.missingRequiredKeys.length > 0) {
    return {
      cause: new Error(
        missingRequiredSettingsMessage(settings.missingRequiredKeys),
      ),
      code: "missing_required_plugin_settings",
      ok: false,
    };
  }
  const callbackTimeoutMs = input.invocation.timeoutMs ?? provider.timeoutMs;
  return {
    ok: true,
    request: {
      directoryName: session.directoryName,
      operation: "model.provider.execute",
      params: {
        context: {
          ...input.invocation.context,
          settings: runtimeSettingsSnapshot(settings),
        },
        executeHandle: provider.executeHandle,
        providerId: provider.id,
        request: {
          configuration: configuration.value,
          configurationId: input.invocation.configurationId,
          model: input.invocation.model,
          modelContext: input.invocation.modelContext,
          ...(input.invocation.options === undefined
            ? {}
            : { options: input.invocation.options }),
        },
      },
      pluginId: input.invocation.pluginId,
      ...(input.invocation.signal ? { signal: input.invocation.signal } : {}),
      ...(callbackTimeoutMs === null ? {} : { timeoutMs: callbackTimeoutMs }),
    },
  };
}

export async function buildPluginModelProviderEmbeddingRequest(input: {
  appDataOptions: AppDataPathOptions;
  embedding: {
    context: PluginModelProviderExecutionContext;
    input: unknown;
    model: Record<string, unknown>;
    options?: unknown;
    registration: PluginModelProviderRegistration;
  };
  session: PluginModelProviderCapabilitySession | null | undefined;
}): Promise<
  | { ok: true; request: PluginCapabilitySidecarRequest }
  | { cause?: Error; code: string; ok: false; pluginUnavailable?: boolean }
> {
  const registration = input.embedding.registration;
  const session = input.session;
  if (!session?.plugin.pluginId || !session.registrations) {
    return {
      code: "plugin_unavailable",
      ok: false,
      pluginUnavailable: true,
    };
  }
  const provider = session.registrations.modelProviders.find(
    (candidate) => candidate.id === registration.providerId,
  );
  if (!provider?.embedHandle) {
    return { code: "plugin_model_provider_embed_unavailable", ok: false };
  }
  const configuration = provider.configurations.find(
    (candidate) => candidate.id === registration.configurationId,
  );
  if (!configuration) {
    return {
      code: "plugin_model_provider_configuration_unavailable",
      ok: false,
    };
  }
  const settings = await readPluginSettingsForRuntime({
    declarations: pluginSettingsDeclarations(session.plugin),
    directoryName: session.directoryName,
    options: input.appDataOptions,
  });
  if (settings.missingRequiredKeys.length > 0) {
    return {
      cause: new Error(
        missingRequiredSettingsMessage(settings.missingRequiredKeys),
      ),
      code: "missing_required_plugin_settings",
      ok: false,
    };
  }
  const callbackTimeoutMs = registration.timeoutMs ?? provider.timeoutMs;
  return {
    ok: true,
    request: {
      directoryName: session.directoryName,
      operation: "model.provider.embed",
      params: {
        context: {
          ...input.embedding.context,
          settings: runtimeSettingsSnapshot(settings),
        },
        embedHandle: provider.embedHandle,
        providerId: provider.id,
        request: {
          configuration: configuration.value,
          configurationId: registration.configurationId,
          input: input.embedding.input,
          model: input.embedding.model,
          ...(input.embedding.options === undefined
            ? {}
            : { options: input.embedding.options }),
        },
      },
      pluginId: registration.pluginId,
      ...(callbackTimeoutMs === null ? {} : { timeoutMs: callbackTimeoutMs }),
    },
  };
}

export async function resolvePluginModelProviderRuntimeApiKeysForSessions(input: {
  appDataOptions: AppDataPathOptions;
  ownerUserId?: number | null;
  sessions: Iterable<PluginModelProviderCapabilitySession>;
}): Promise<Map<string, string>> {
  const apiKeys = new Map<string, string>();

  for (const session of input.sessions) {
    if (!isReadyCapabilitySession(session) || !session.registrations) {
      continue;
    }
    if (!session.plugin.pluginId) {
      continue;
    }
    let settings: Awaited<
      ReturnType<typeof readPluginSettingsForRuntime>
    > | null = null;
    const capturedEnvValues = new Map(
      session.capturedEnv.map((envVar) => [envVar.key, envVar.value]),
    );
    for (const provider of session.registrations.modelProviders) {
      for (const configuration of provider.configurations) {
        const providerRegistryId = resolvedPluginProviderRegistryId({
          configurationId: configuration.id,
          pluginId: session.plugin.pluginId,
          providerId: provider.id,
        });
        let configured = false;
        for (const authRecord of pluginProviderPiAuthRecords(
          configuration.value.piAuth,
        )) {
          let apiKey: unknown = null;
          if (authRecord.source === "env") {
            apiKey = capturedEnvValues.get(authRecord.value);
          } else {
            settings ??= await readPluginSettingsForRuntime({
              declarations: pluginSettingsDeclarations(session.plugin),
              directoryName: session.directoryName,
              options: input.appDataOptions,
            });
            apiKey = settings.values[authRecord.value];
          }
          const runtimeApiKey = pluginProviderRuntimeApiKeyValue(apiKey);
          if (runtimeApiKey) {
            apiKeys.set(providerRegistryId, runtimeApiKey);
            configured = true;
            break;
          }
        }
        if (configured) {
          continue;
        }
        const userSettingKey =
          typeof configuration.value.apiKeyUserSetting === "string" &&
          configuration.value.apiKeyUserSetting.trim().length > 0
            ? configuration.value.apiKeyUserSetting.trim()
            : null;
        if (userSettingKey) {
          settings ??= await readPluginSettingsForRuntime({
            declarations: pluginSettingsDeclarations(session.plugin),
            directoryName: session.directoryName,
            options: input.appDataOptions,
          });
          const settingApiKey = settings.values[userSettingKey];
          const runtimeApiKey = pluginProviderRuntimeApiKeyValue(settingApiKey);
          if (runtimeApiKey) {
            apiKeys.set(providerRegistryId, runtimeApiKey);
          }
        }
      }
    }
  }
  return apiKeys;
}
