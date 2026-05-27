// @ts-nocheck
/**
 * @file src/mainview/app/plugin-inventory-state.test.ts
 * @description Characterization tests for Plugin inventory view state.
 */

import { describe, expect, it } from "bun:test";

import type {
  RpcPluginInventory,
  RpcPluginInventoryPlugin,
} from "../../bun/rpc-schema";
import {
  allPluginsFromInventory,
  pluginDataUsageSummary,
  pluginInventoryAttentionState,
  pluginInventoryDisplayName,
  pluginInventoryIssueText,
  pluginInventoryRowIssue,
  pluginInventoryStatusLabel,
  pluginsWithDeclaredSettings,
  pluginsWithDeclaredSettingsForScope,
  shouldLoadSettingsPluginInventory,
} from "./plugin-inventory-state";

function buildPluginInventoryPlugin(
  overrides?: Partial<RpcPluginInventoryPlugin>,
): RpcPluginInventoryPlugin {
  return {
    adminActions: [],
    description: null,
    directoryName: "alpha_plugin",
    folderPath: "/tmp/plugins/alpha_plugin",
    approvedReviewHash: null,
    currentReviewHash: null,
    dataUsage: {
      bytes: 0,
      files: 0,
      scannedAt: "2026-04-28T00:00:00.000Z",
      unavailableReason: null,
    },
    group: "Uninitialized",
    hasRootNodeModules: false,
    lifecycle: {
      activatedOnce: false,
      approvedAt: null,
      approvedBy: null,
      crashLoop: {
        crashCount: 0,
        lastCrashAt: null,
        threshold: 3,
        thresholdReached: false,
        windowMs: 60_000,
      },
      disabledAt: null,
      discoveredAt: null,
      enabled: false,
      failureReason: null,
      lastActionAt: null,
      lastActionBy: null,
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
          maxDataBytes: 100 * 1024 * 1024,
          maxFileBytes: 10 * 1024 * 1024,
          maxFiles: 10_000,
        },
      },
      state: "uninitialized",
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
    name: null,
    pluginId: null,
    reviewWarnings: [],
    status: "uninitialized",
    structurallyValid: true,
    validationErrors: [],
    version: null,
    ...overrides,
  };
}

function buildPluginInventory(
  overrides?: Partial<RpcPluginInventory>,
): RpcPluginInventory {
  return {
    groups: [],
    issues: [],
    plugins: [],
    pluginsDirectoryExists: true,
    pluginsDirectoryPath: "/tmp/plugins",
    scannedAt: "2026-04-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("plugin inventory state", () => {
  it("loads plugin inventory only while the active local settings panel is open", () => {
    expect(
      shouldLoadSettingsPluginInventory({
        active: true,
        isAdmin: true,
        open: true,
      }),
    ).toBe(true);
    expect(
      shouldLoadSettingsPluginInventory({
        active: true,
        isAdmin: true,
        open: false,
      }),
    ).toBe(false);
    expect(
      shouldLoadSettingsPluginInventory({
        active: false,
        isAdmin: true,
        open: true,
      }),
    ).toBe(false);
    expect(
      shouldLoadSettingsPluginInventory({
        active: true,
        isAdmin: false,
        open: true,
      }),
    ).toBe(false);
  });

  it("uses safe display-name fallbacks and actionable issue text", () => {
    expect(
      pluginInventoryDisplayName(
        buildPluginInventoryPlugin({ name: "Alpha Plugin" }),
      ),
    ).toBe("Alpha Plugin");
    expect(
      pluginInventoryDisplayName(
        buildPluginInventoryPlugin({ pluginId: "com.example.alpha" }),
      ),
    ).toBe("com.example.alpha");
    expect(pluginInventoryDisplayName(buildPluginInventoryPlugin())).toBe(
      "alpha_plugin",
    );

    expect(
      pluginInventoryIssueText({
        code: "missing_index",
        fileName: "index.ts",
        message: "index.ts is required.",
        path: "/tmp/plugins/alpha_plugin/index.ts",
      }),
    ).toBe(
      "index.ts is required. (/tmp/plugins/alpha_plugin/index.ts; missing_index)",
    );
  });

  it("prefers validation errors before review warnings in row summaries", () => {
    expect(
      pluginInventoryRowIssue(
        buildPluginInventoryPlugin({
          reviewWarnings: [
            {
              code: "unsafe_permission_declared",
              message: "Unsafe permission requires review.",
              path: "/tmp/plugins/alpha_plugin/metidos-plugin.json",
            },
          ],
          validationErrors: [
            {
              code: "missing_index",
              fileName: "index.ts",
              message: "index.ts is required.",
              path: "/tmp/plugins/alpha_plugin/index.ts",
            },
          ],
        }),
      ),
    ).toMatchObject({
      text: "index.ts is required. (/tmp/plugins/alpha_plugin/index.ts; missing_index)",
      tone: "danger",
    });

    expect(
      pluginInventoryRowIssue(
        buildPluginInventoryPlugin({
          reviewWarnings: [
            {
              code: "unsafe_permission_declared",
              message: "Unsafe permission requires review.",
              path: "/tmp/plugins/alpha_plugin/metidos-plugin.json",
            },
          ],
        }),
      ),
    ).toMatchObject({
      text: "Unsafe permission requires review. (/tmp/plugins/alpha_plugin/metidos-plugin.json; unsafe_permission_declared)",
      tone: "warning",
    });
  });

  it("formats plugin inventory status and data summaries", () => {
    const basePlugin = buildPluginInventoryPlugin();
    const plugin = buildPluginInventoryPlugin({
      dataUsage: {
        ...basePlugin.dataUsage,
        bytes: 1536,
        files: 12,
      },
      lifecycle: {
        ...basePlugin.lifecycle,
        settings: {
          ...basePlugin.lifecycle.settings,
          quota: {
            ...basePlugin.lifecycle.settings.quota,
            maxDataBytes: 2 * 1024 * 1024,
            maxFiles: 100,
          },
        },
      },
    });

    expect(pluginInventoryStatusLabel("Failed/Degraded")).toBe(
      "Failed / Degraded",
    );
    expect(pluginInventoryStatusLabel("Disabled/Restart Required")).toBe(
      "Disabled",
    );
    expect(pluginDataUsageSummary(plugin)).toBe(
      "Plugin data usage: 1.5 KB / 2 MB · Files: 12 / 100",
    );
  });

  it("derives plugin inventory attention state from issues, failures, and review needs", () => {
    expect(pluginInventoryAttentionState(null)).toBeNull();
    expect(
      pluginInventoryAttentionState(
        buildPluginInventory({
          issues: [
            {
              code: "inventory_scan_failed",
              message: "Scan failed.",
              path: "/tmp/plugins",
            },
          ],
          plugins: [
            buildPluginInventoryPlugin({
              status: "failed_degraded",
            }),
          ],
        }),
      ),
    ).toEqual({
      fingerprint:
        "danger|inventory_scan_failed|alpha_plugin:failed_degraded:0",
      tone: "danger",
    });

    expect(
      pluginInventoryAttentionState(
        buildPluginInventory({
          plugins: [
            buildPluginInventoryPlugin({
              currentReviewHash: "review-hash",
              status: "needs_review",
            }),
          ],
        }),
      ),
    ).toEqual({
      fingerprint: "warning|alpha_plugin:review-hash",
      tone: "warning",
    });
  });

  it("deduplicates inventory rows and filters plugins with declared settings", () => {
    const basePlugin = buildPluginInventoryPlugin();
    const settingsPlugin = buildPluginInventoryPlugin({
      directoryName: "beta_plugin",
      folderPath: "/tmp/plugins/beta_plugin",
      manifest: {
        ...basePlugin.manifest,
        settings: [
          {
            defaultValue: "hello",
            description: null,
            hasDefault: true,
            items: null,
            key: "message",
            kind: "string",
            label: null,
            options: [],
            required: null,
            settingScope: "settings",
          },
        ],
      },
    });
    const structurallyInvalidSettingsPlugin = buildPluginInventoryPlugin({
      directoryName: "gamma_plugin",
      folderPath: "/tmp/plugins/gamma_plugin",
      manifest: settingsPlugin.manifest,
      structurallyValid: false,
    });
    const inventory = buildPluginInventory({
      groups: [
        {
          count: 2,
          label: "Active",
          plugins: [
            basePlugin,
            settingsPlugin,
            structurallyInvalidSettingsPlugin,
          ],
        },
      ],
      plugins: [basePlugin],
    });

    expect(
      allPluginsFromInventory(inventory).map((plugin) => plugin.directoryName),
    ).toEqual(["alpha_plugin", "beta_plugin", "gamma_plugin"]);
    expect(
      pluginsWithDeclaredSettings(inventory).map(
        (plugin) => plugin.directoryName,
      ),
    ).toEqual(["beta_plugin"]);
    expect(
      pluginsWithDeclaredSettingsForScope(inventory, "settings").map(
        (plugin) => plugin.directoryName,
      ),
    ).toEqual(["beta_plugin"]);
    expect(pluginsWithDeclaredSettingsForScope(null, "settings")).toEqual([]);
  });
});
