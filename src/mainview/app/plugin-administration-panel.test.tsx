// @ts-nocheck
/**
 * @file src/mainview/app/plugin-administration-panel.test.tsx
 * @description Focused tests for Plugin administration panel helpers.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  ProjectProcedures,
  RpcPluginIngressExternalBinding,
  RpcPluginInventory,
  RpcPluginInventoryPlugin,
  RpcPluginSettingsSnapshot,
} from "../../bun/rpc-schema";
import {
  PluginSettingsGroup,
  UserIngressSourcesSection,
  pluginSettingListItemKeys,
} from "./plugin-administration-panel";
import {
  defaultIngressRouteAccess,
  pluginIngressLinkCodeKey,
} from "./plugin-ingress-route-state";
import {
  loadPluginSettingsStateForInventory,
  retryPendingPluginStepUpAction,
} from "./use-plugin-administration-controller";

function buildPluginInventoryPlugin(
  overrides?: Partial<RpcPluginInventoryPlugin>,
): RpcPluginInventoryPlugin {
  return {
    adminActions: [],
    description: "Plugin administration fixture.",
    directoryName: "alpha_plugin",
    folderPath: "/tmp/plugins/alpha_plugin",
    approvedReviewHash: null,
    currentReviewHash: null,
    dataUsage: {
      bytes: 1536,
      files: 12,
      scannedAt: "2026-04-28T00:00:00.000Z",
      unavailableReason: null,
    },
    group: "Active",
    hasRootNodeModules: false,
    lifecycle: {
      activatedOnce: true,
      approvedAt: "2026-04-28T00:00:00.000Z",
      approvedBy: "admin",
      crashLoop: {
        crashCount: 0,
        lastCrashAt: null,
        threshold: 3,
        thresholdReached: false,
        windowMs: 60_000,
      },
      disabledAt: null,
      discoveredAt: "2026-04-28T00:00:00.000Z",
      enabled: true,
      failureReason: null,
      lastActionAt: "2026-04-28T00:00:00.000Z",
      lastActionBy: "admin",
      restartRequired: false,
      settings: {
        log: {
          enabled: false,
          maxBytes: 25 * 1024 * 1024,
          retentionDays: 14,
        },
        notifications: {
          enabled: true,
          perDayLimit: 25,
          perMinuteLimit: 3,
        },
        quota: {
          maxDataBytes: 2 * 1024 * 1024,
          maxFileBytes: 10 * 1024 * 1024,
          maxFiles: 100,
        },
      },
      state: "active",
    },
    lifecycleMessage: null,
    manifest: {
      access: [],
      crons: [],
      env: [],
      files: {
        allow: {
          delete: [],
          read: [],
          write: [],
        },
        deny: {
          delete: [],
          read: [],
          write: [],
        },
      },
      gc: null,
      metidosApiVersion: null,
      network: null,
      notificationProviders: [],
      oauthProviders: [],
      piAuth: [],
      permissions: [],
      providers: [],
      settings: [],
      storageDefaults: null,
      telemetry: null,
    },
    name: "Alpha Plugin",
    pluginId: "alpha-plugin",
    reviewWarnings: [],
    status: "active",
    structurallyValid: true,
    validationErrors: [],
    version: "1.0.0",
    ...overrides,
  };
}

function buildPluginInventory(
  plugins: RpcPluginInventoryPlugin[],
): RpcPluginInventory {
  return {
    groups: [],
    issues: [],
    plugins,
    pluginsDirectoryExists: true,
    pluginsDirectoryPath: "/tmp/plugins",
    scannedAt: "2026-05-14T00:00:00.000Z",
  };
}

function buildSettingsSnapshot(
  plugin: RpcPluginInventoryPlugin,
): RpcPluginSettingsSnapshot {
  return {
    directoryName: plugin.directoryName,
    pluginId: plugin.pluginId,
    settings: [
      {
        defaultValue: "fallback",
        hasDefault: true,
        hasStoredValue: true,
        key: "mode",
        kind: "text",
        readable: true,
        secret: false,
        value: "stored",
      },
    ],
  };
}

describe("plugin administration panel", () => {
  it("generates stable list setting keys in one pass", () => {
    expect(pluginSettingListItemKeys("allowed", ["a", "b", "a", "a"])).toEqual([
      "allowed:a:0",
      "allowed:b:0",
      "allowed:a:1",
      "allowed:a:2",
    ]);
  });

  it("collects partial settings snapshot failures without dropping successful values", async () => {
    const loadedPlugin = buildPluginInventoryPlugin({
      directoryName: "loaded_plugin",
      folderPath: "/tmp/plugins/loaded_plugin",
      manifest: {
        ...buildPluginInventoryPlugin().manifest,
        settings: [
          {
            defaultValue: "fallback",
            description: "Mode",
            hasDefault: true,
            items: null,
            key: "mode",
            kind: "text",
            label: "Mode",
            options: [],
            required: null,
          },
        ],
      },
      pluginId: "loaded-plugin",
    });
    const failedPlugin = buildPluginInventoryPlugin({
      directoryName: "failed_plugin",
      folderPath: "/tmp/plugins/failed_plugin",
      manifest: {
        ...buildPluginInventoryPlugin().manifest,
        settings: [
          {
            defaultValue: null,
            description: "Token",
            hasDefault: false,
            items: null,
            key: "api_token",
            kind: "secret",
            label: "API token",
            options: [],
            required: null,
          },
        ],
      },
      pluginId: "failed-plugin",
    });
    const snapshot = buildSettingsSnapshot(loadedPlugin);

    const settingsState = await loadPluginSettingsStateForInventory({
      inventory: buildPluginInventory([loadedPlugin, failedPlugin]),
      procedures: {
        getPluginSettings: async ({ directoryName }) => {
          if (directoryName === failedPlugin.directoryName) {
            throw new Error("settings unavailable");
          }
          return snapshot;
        },
      } as ProjectProcedures,
    });

    expect(settingsState.snapshots).toEqual({
      [loadedPlugin.directoryName]: snapshot,
    });
    expect(settingsState.values).toEqual({
      [loadedPlugin.directoryName]: { mode: "stored" },
    });
    expect(settingsState.errors).toEqual({
      [failedPlugin.directoryName]: "settings unavailable",
    });
    expect(settingsState.status).toBe("Failed to load settings for 1 plugin.");
  });

  it("routes step-up retries to the pending lifecycle, admin, or settings command", () => {
    const plugin = buildPluginInventoryPlugin();
    const calls: string[] = [];
    const retry = (
      actionToRetry: Parameters<
        typeof retryPendingPluginStepUpAction
      >[0]["actionToRetry"],
    ) => {
      retryPendingPluginStepUpAction({
        actionToRetry,
        executePluginAdminAction: (_plugin, action, confirmation) => {
          calls.push(`admin:${action}:${confirmation ?? ""}`);
        },
        executePluginLifecycleAction: (_plugin, action) => {
          calls.push(`lifecycle:${action}`);
        },
        savePluginSettings: () => {
          calls.push("settings");
        },
      });
    };

    retry({ action: "enable", kind: "lifecycle", plugin });
    retry({
      action: "repair",
      confirmation: "alpha_plugin",
      kind: "admin",
      plugin,
    });
    retry({ kind: "settings" });

    expect(calls).toEqual([
      "lifecycle:enable",
      "admin:repair:alpha_plugin",
      "settings",
    ]);
  });

  it("renders pending feedback for secret replacement and clearing settings", () => {
    const plugin = buildPluginInventoryPlugin({
      manifest: {
        ...buildPluginInventoryPlugin().manifest,
        settings: [
          {
            defaultValue: null,
            description: "API token",
            hasDefault: false,
            items: null,
            key: "api_token",
            kind: "secret",
            label: "API token",
            options: [],
            required: null,
          },
        ],
      },
    });
    const snapshot: RpcPluginSettingsSnapshot = {
      directoryName: plugin.directoryName,
      pluginId: plugin.pluginId,
      settings: [
        {
          defaultValue: null,
          hasDefault: false,
          hasStoredValue: true,
          key: "api_token",
          kind: "secret",
          readable: false,
          secret: true,
          value: null,
        },
      ],
    };

    const replacementMarkup = renderToStaticMarkup(
      <PluginSettingsGroup
        onValueChange={() => {}}
        plugin={plugin}
        snapshots={{ [plugin.directoryName]: snapshot }}
        values={{ [plugin.directoryName]: { api_token: "replacement" } }}
      />,
    );

    expect(replacementMarkup).toContain("Replace pending");
    expect(replacementMarkup).toContain('autoComplete="new-password"');
    expect(replacementMarkup).toContain('data-lpignore="true"');
    expect(replacementMarkup).toContain('data-1p-ignore="true"');

    const clearMarkup = renderToStaticMarkup(
      <PluginSettingsGroup
        onValueChange={() => {}}
        plugin={plugin}
        snapshots={{ [plugin.directoryName]: snapshot }}
        values={{ [plugin.directoryName]: { api_token: null } }}
      />,
    );

    expect(clearMarkup).toContain("Clear pending");
    expect(clearMarkup).toContain("Will clear on save");
    expect(clearMarkup).toContain('aria-label="Clear stored API token"');
  });

  it("renders ingress link codes, binding actions, and route drafts through the section seam", () => {
    const binding: RpcPluginIngressExternalBinding = {
      createdAt: "2026-05-14T00:00:00.000Z",
      enabled: true,
      externalUserId: "external-user-1",
      id: 22,
      metidosUserId: 7,
      pluginId: "chat-plugin",
      sourceId: "dm",
      updatedAt: "2026-05-14T00:00:00.000Z",
    };
    const routeKey = pluginIngressLinkCodeKey("chat-plugin", "dm");

    const markup = renderToStaticMarkup(
      <UserIngressSourcesSection
        actionError=""
        actionLoadingKey={null}
        availablePluginAccessGroups={[]}
        availableThreadPermissionDescriptors={[]}
        bindings={[binding]}
        codexModels={[{ id: "codex-mini", label: "Codex Mini" }]}
        homeDirectory="/home/metidos"
        linkCodes={{
          [routeKey]: {
            code: "ABC123",
            createdAt: "2026-05-14T00:00:00.000Z",
            expiresAt: "2026-05-14T00:10:00.000Z",
            pluginId: "chat-plugin",
            sourceId: "dm",
          },
        }}
        loading={false}
        onCancelRouteFolderCreate={() => {}}
        onConfirmRouteFolderCreate={() => {}}
        onCreateLinkCode={() => {}}
        onDeleteBinding={() => {}}
        onRefresh={() => {}}
        onRouteAccessChange={() => {}}
        onRouteModelChange={() => {}}
        onRoutePathChange={() => {}}
        onSaveRouteConfig={() => {}}
        onSelectRouteDirectory={() => {}}
        onSetBindingEnabled={() => {}}
        routeCreateFolderPrompt={{
          draft: {
            access: defaultIngressRouteAccess(),
            model: "codex-mini",
            projectId: null,
            worktreePath: "/home/metidos/Projects/new-inbox",
          },
          pluginId: "chat-plugin",
          sourceId: "dm",
        }}
        routeDirectorySuggestions={["/home/metidos/Projects/new-inbox"]}
        routeDirectorySuggestionsKey={routeKey}
        routeDirectorySuggestionsLoading={false}
        routeDrafts={{
          [routeKey]: {
            access: defaultIngressRouteAccess(["metidos:threads"]),
            model: "codex-mini",
            projectId: null,
            worktreePath: "/home/metidos/Projects/new-inbox",
          },
        }}
        routeHoveredDirectorySuggestion={null}
        setRouteHoveredDirectorySuggestion={() => {}}
        sources={[
          {
            pluginId: "chat-plugin",
            pluginName: "Chat Plugin",
            source: {
              description: "Fake provider direct messages",
              id: "dm",
              name: "Direct messages",
              pollIntervalMs: 60_000,
              supportsReplyToSource: true,
              timeoutMs: 5_000,
            },
          },
        ]}
        supportsTildePath={true}
      />,
    );

    expect(markup).toContain("ABC123");
    expect(markup).toContain("Generate Link Code");
    expect(markup).toContain("Select");
    expect(markup).toContain("Clear");
    expect(markup).toContain("Disable");
    expect(markup).toContain("Remove");
    expect(markup).toContain("~/Projects/new-inbox");
  });
});
