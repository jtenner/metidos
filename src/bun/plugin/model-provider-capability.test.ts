import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import type { PluginStartupRegistrations } from "./startup-registrations";
import {
  buildPluginModelProviderExecutionRequest,
  buildPluginOAuthProviderImportRequest,
  buildPluginOAuthProviderRefreshRequest,
  createPluginModelProviderRefreshStatesFromRegistrations,
  listPluginModelProviderRegistrationsForSessions,
  listPluginOAuthProviderRegistrationsForSessions,
  listPluginPiAuthBindingsForSessions,
  modelProviderRefreshesDue,
  normalizePluginOAuthCredential,
  normalizeRefreshedPluginModelProviderConfigurations,
  registerPluginOAuthProviderRegistrations,
  type PluginModelProviderCapabilitySession,
} from "./model-provider-capability";

function createTempDirectory(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function emptyRegistrations(): PluginStartupRegistrations {
  return {
    crons: [],
    gc: null,
    ingressSources: [],
    modelProviders: [],
    notificationProviders: [],
    oauthProviders: [],
    injections: [],
    tools: [],
  };
}

function plugin(): RpcPluginInventoryPlugin {
  return {
    directoryName: "provider_plugin",
    manifest: {
      agents: [],
      auth: null,
      calendarEvents: [],
      crons: [],
      description: null,
      displayName: "Provider Plugin",
      env: [],
      ingress: [],
      name: "provider_plugin",
      notificationProviders: [],
      permissions: ["provider:register", "metidos:provides_embeddings"],
      piAuth: [
        {
          kind: "api_key",
          provider: "manifest-provider",
          source: "env",
          value: "PLUGIN_API_KEY",
        },
      ],
      providers: [
        {
          description: "Test provider",
          id: "alpha",
          name: "Alpha",
          timeoutMs: 5_000,
        },
      ],
      settings: [
        {
          defaultValue: null,
          description: null,
          hasDefault: false,
          items: null,
          key: "api_key",
          kind: "secret",
          label: "API key",
          options: [],
          required: false,
        },
      ],
      tools: [],
      version: "1.0.0",
    },
    name: "Provider Plugin",
    pluginId: "provider_plugin",
    status: "active",
  } as unknown as RpcPluginInventoryPlugin;
}

function registrations(): PluginStartupRegistrations {
  return {
    ...emptyRegistrations(),
    modelProviders: [
      {
        configurations: [
          {
            id: "default",
            value: {
              label: "Default",
              models: [{ id: "alpha-chat", name: "Alpha Chat" }],
            },
          },
        ],
        embedHandle: "modelProvider:alpha:embed",
        executeHandle: "modelProvider:alpha:execute",
        getProviderConfigurationsHandle: "modelProvider:alpha:configurations",
        id: "alpha",
        refreshIntervalMs: 1_000,
        timeoutMs: 5_000,
      },
    ],
    oauthProviders: [
      {
        id: "alpha_oauth",
        importCredentialsHandle: "oauth:alpha:import",
        provider: "alpha",
        refreshHandle: "oauth:alpha:refresh",
        timeoutMs: 5_000,
      },
    ],
  };
}

function session(input: {
  now?: number;
  registrations?: PluginStartupRegistrations;
}): PluginModelProviderCapabilitySession {
  const startupRegistrations = input.registrations ?? registrations();
  return {
    capturedEnv: [{ key: "PLUGIN_API_KEY", value: "env-key" }],
    directoryName: "provider_plugin",
    modelProviderRefreshState:
      createPluginModelProviderRefreshStatesFromRegistrations(
        startupRegistrations,
        input.now ?? 1_000,
      ),
    plugin: plugin(),
    ready: true,
    registrations: startupRegistrations,
    stopping: false,
  };
}

describe("Plugin model provider capability", () => {
  it("keeps refresh state and due refresh selection outside the sidecar manager", () => {
    const currentSession = session({ now: 1_000 });

    expect(
      modelProviderRefreshesDue({ now: 1_500, sessions: [currentSession] }),
    ).toEqual([]);
    expect(
      modelProviderRefreshesDue({ now: 2_001, sessions: [currentSession] }),
    ).toEqual([{ providerId: "alpha", session: currentSession }]);

    currentSession.modelProviderRefreshState.set("alpha", {
      inFlight: true,
      lastAttemptedAt: 2_001,
      lastError: null,
      lastSuccessfulAt: 1_000,
    });
    expect(
      modelProviderRefreshesDue({ now: 3_500, sessions: [currentSession] }),
    ).toEqual([]);
  });

  it("normalizes refreshed configurations and OAuth credentials", () => {
    expect(
      normalizeRefreshedPluginModelProviderConfigurations([
        { id: "lab", label: "Lab" },
      ]),
    ).toEqual([{ id: "lab", value: { id: "lab", label: "Lab" } }]);
    expect(() =>
      normalizeRefreshedPluginModelProviderConfigurations([
        { id: "lab" },
        { id: "lab" },
      ]),
    ).toThrow("duplicates lab");
    expect(() =>
      normalizeRefreshedPluginModelProviderConfigurations(
        Array.from({ length: 26 }, (_, index) => ({ id: `config_${index}` })),
      ),
    ).toThrow("at most 25 configurations");

    expect(
      normalizePluginOAuthCredential({
        access: " token ",
        expires: 123,
        refresh: "refresh",
      }),
    ).toEqual({
      access: "token",
      expires: 123,
      refresh: "refresh",
      type: "oauth",
    });
    expect(normalizePluginOAuthCredential({ access: "", expires: 123 })).toBe(
      null,
    );
  });

  it("lists model, OAuth, and Pi Auth provider surfaces from sessions", () => {
    const currentSession = session({});

    expect(
      listPluginModelProviderRegistrationsForSessions({
        sessions: [currentSession],
      }),
    ).toEqual([
      expect.objectContaining({
        configurationId: "default",
        configurationLabel: "Default",
        directoryName: "provider_plugin",
        embedHandle: "modelProvider:alpha:embed",
        executeHandle: "modelProvider:alpha:execute",
        pluginId: "provider_plugin",
        providerId: "alpha",
        providerName: "Alpha",
        providesEmbeddings: true,
        refreshError: null,
      }),
    ]);

    expect(
      listPluginOAuthProviderRegistrationsForSessions({
        sessions: [currentSession],
      }),
    ).toEqual([
      expect.objectContaining({
        directoryName: "provider_plugin",
        pluginId: "provider_plugin",
        pluginName: "Provider Plugin",
        registration: expect.objectContaining({ provider: "alpha" }),
      }),
    ]);

    expect(
      listPluginPiAuthBindingsForSessions({ sessions: [currentSession] }),
    ).toEqual([
      expect.objectContaining({
        directoryName: "provider_plugin",
        providerId: "manifest-provider",
        source: "env",
        value: "PLUGIN_API_KEY",
      }),
    ]);
  });

  it("builds provider execution and OAuth sidecar request payloads", async () => {
    const currentSession = session({});
    const appDataDir = createTempDirectory(
      "metidos-plugin-model-provider-capability-",
    );

    const oauthRegistration = currentSession.registrations?.oauthProviders[0];
    if (!oauthRegistration) {
      throw new Error("Expected OAuth registration fixture.");
    }

    await expect(
      buildPluginModelProviderExecutionRequest({
        appDataOptions: { appDataDir },
        invocation: {
          configuration: { id: "default" },
          configurationId: "default",
          context: {
            contextKind: "providerExecution",
            ownerUserId: 7,
            projectId: 2,
            threadId: 9,
            worktreePath: "/workspace",
          },
          model: { id: "alpha-chat" },
          modelContext: { messages: [] },
          pluginId: "provider_plugin",
          providerId: "alpha",
        },
        session: currentSession,
      }),
    ).resolves.toEqual({
      ok: true,
      request: expect.objectContaining({
        directoryName: "provider_plugin",
        operation: "model.provider.execute",
        params: expect.objectContaining({
          executeHandle: "modelProvider:alpha:execute",
          providerId: "alpha",
        }),
        pluginId: "provider_plugin",
        timeoutMs: 5_000,
      }),
    });

    await expect(
      buildPluginOAuthProviderImportRequest({
        appDataOptions: { appDataDir },
        ownerUserId: 7,
        pluginId: "provider_plugin",
        registration: oauthRegistration,
        session: currentSession,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        directoryName: "provider_plugin",
        operation: "oauth.provider.import",
        pluginId: "provider_plugin",
        timeoutMs: 5_000,
      }),
    );

    expect(
      buildPluginOAuthProviderRefreshRequest({
        credentials: {
          access: "old",
          expires: 123,
          refresh: "refresh",
          type: "oauth",
        },
        pluginId: "provider_plugin",
        registration: oauthRegistration,
      }),
    ).toEqual(
      expect.objectContaining({
        operation: "oauth.provider.refresh",
        pluginId: "provider_plugin",
        timeoutMs: 5_000,
      }),
    );
  });

  it("registers OAuth refresh callbacks through an injectable provider registry", async () => {
    const registered: Array<{
      getApiKey: (credentials: Record<string, unknown>) => string;
      id: string;
      refreshToken: (credentials: Record<string, unknown>) => Promise<unknown>;
    }> = [];

    registerPluginOAuthProviderRegistrations({
      async invokeRefresh(input) {
        expect(input.pluginId).toBe("provider_plugin");
        expect(input.registration.provider).toBe("alpha");
        expect(input.credentials).toMatchObject({ access: "old" });
        return {
          access: "new",
          expires: 456,
          refresh: "refresh",
          type: "oauth",
        };
      },
      registerProvider(provider) {
        registered.push({
          getApiKey: (credentials) =>
            provider.getApiKey(
              credentials as Parameters<typeof provider.getApiKey>[0],
            ),
          id: provider.id,
          refreshToken: (credentials) =>
            provider.refreshToken(
              credentials as Parameters<typeof provider.refreshToken>[0],
            ),
        });
      },
      registrations: listPluginOAuthProviderRegistrationsForSessions({
        sessions: [session({})],
      }),
    });

    expect(registered).toHaveLength(1);
    expect(registered[0]?.id).toBe("alpha");
    expect(registered[0]?.getApiKey({ access: "api-key" })).toBe("api-key");
    await expect(
      registered[0]?.refreshToken({ access: "old", expires: 123 }),
    ).resolves.toMatchObject({ access: "new" });
  });
});
