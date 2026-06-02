/**
 * @file src/mainview/app/plugin-lifecycle-action-state.test.ts
 * @description Characterization tests for Plugin lifecycle action view state.
 */

import { describe, expect, it } from "bun:test";

import type { RpcPluginInventoryPlugin } from "../../bun/rpc-schema";
import {
  clearPluginActionKey,
  pluginActionFeedbackState,
  pluginAdminActionKey,
  pluginIssuesExceptReviewHashChanged,
  pluginLifecycleActionButtonState,
  pluginLifecycleActionDisabledReason,
  pluginLifecycleActionDisplayLabel,
  pluginLifecycleActionKey,
  pluginLifecycleActionViewState,
} from "./plugin-lifecycle-action-state";

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

describe("plugin-lifecycle-action-state", () => {
  it("keeps lifecycle and admin action keys stable", () => {
    const plugin = buildPluginInventoryPlugin();

    expect(pluginLifecycleActionKey(plugin, "enable")).toBe(
      "alpha_plugin:enable",
    );
    expect(pluginAdminActionKey(plugin, "run_gc")).toBe(
      "alpha_plugin:admin:run_gc",
    );
    expect(
      clearPluginActionKey("alpha_plugin:enable", "alpha_plugin:enable"),
    ).toBeNull();
    expect(
      clearPluginActionKey("alpha_plugin:disable", "alpha_plugin:enable"),
    ).toBe("alpha_plugin:disable");
  });

  it("uses status-aware labels for lifecycle approvals", () => {
    expect(
      pluginLifecycleActionDisplayLabel(
        buildPluginInventoryPlugin({ status: "needs_review" }),
        "reapprove",
      ),
    ).toBe("Approve");
    expect(
      pluginLifecycleActionDisplayLabel(
        buildPluginInventoryPlugin({ status: "disabled_restart_required" }),
        "reapprove",
      ),
    ).toBe("Enable");
    expect(
      pluginLifecycleActionDisplayLabel(
        buildPluginInventoryPlugin({ status: "failed_degraded" }),
        "retry",
      ),
    ).toBe("Retry Plugin");
  });

  it("allows re-approval when the only validation error is the expected hash mismatch", () => {
    const plugin = buildPluginInventoryPlugin({
      status: "needs_review",
      validationErrors: [
        {
          code: "review_hash_changed",
          message:
            "Approved plugin review hash no longer matches the current plugin files.",
          path: "metidos-plugin.json",
        },
      ],
    });

    expect(
      pluginIssuesExceptReviewHashChanged(plugin.validationErrors),
    ).toEqual([]);
    expect(pluginLifecycleActionDisabledReason(plugin, "reapprove")).toBeNull();
    expect(pluginLifecycleActionDisabledReason(plugin, "enable")).toBe(
      "Resolve activation-blocking errors before this lifecycle action.",
    );
  });

  it("keeps re-approval disabled for non-hash validation errors", () => {
    const plugin = buildPluginInventoryPlugin({
      status: "needs_review",
      validationErrors: [
        {
          code: "missing_required_file",
          fileName: "index.ts",
          message: "index.ts is required.",
          path: "/tmp/plugins/alpha_plugin/index.ts",
        },
      ],
    });

    expect(pluginLifecycleActionDisabledReason(plugin, "reapprove")).toBe(
      "Resolve activation-blocking errors before this lifecycle action.",
    );
  });

  it("derives lifecycle button busy and disabled state", () => {
    const plugin = buildPluginInventoryPlugin({ status: "needs_review" });

    expect(
      pluginLifecycleActionButtonState({
        action: "reapprove",
        actionLoadingKey: "alpha_plugin:reapprove",
        isAdmin: true,
        plugin,
      }),
    ).toMatchObject({
      busy: true,
      disabled: true,
      disabledReason: null,
      key: "alpha_plugin:reapprove",
      label: "Working...",
      title: undefined,
    });

    expect(
      pluginLifecycleActionButtonState({
        action: "reapprove",
        actionLoadingKey: null,
        isAdmin: false,
        plugin,
      }),
    ).toMatchObject({
      busy: false,
      disabled: true,
      label: "Approve",
    });

    expect(
      pluginLifecycleActionViewState({
        action: "reapprove",
        actionLoadingKey: null,
        plugin,
      }),
    ).toMatchObject({ disabled: false, label: "Approve" });
  });

  it("keeps unrelated lifecycle actions enabled while another action is loading", () => {
    const plugin = buildPluginInventoryPlugin({ status: "needs_review" });

    expect(
      pluginLifecycleActionButtonState({
        action: "disable",
        actionLoadingKey: "alpha_plugin:reapprove",
        isAdmin: true,
        plugin,
      }),
    ).toMatchObject({
      busy: false,
      disabled: false,
      key: "alpha_plugin:disable",
      label: "Disable",
    });
  });

  it("normalizes Plugin action feedback state", () => {
    expect(pluginActionFeedbackState({ error: "", message: "Saved" })).toEqual({
      error: "",
      hasError: false,
      hasMessage: true,
      message: "Saved",
    });
    expect(pluginActionFeedbackState({ error: "Boom", message: "" })).toEqual({
      error: "Boom",
      hasError: true,
      hasMessage: false,
      message: "",
    });
  });
});
