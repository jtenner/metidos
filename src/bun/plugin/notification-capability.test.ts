/**
 * @file src/bun/plugin/notification-capability.test.ts
 * @description Characterization tests for Plugin System v1 notification-provider capability decisions.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { PluginSidecarToolCallError } from "./execution-capability";
import {
  buildPluginNotificationProviderSidecarRequest,
  dispatchPluginNotificationProvidersForSessions,
  normalizePluginNotificationProviderReceipt,
  type PluginNotificationProviderCapabilitySession,
} from "./notification-capability";
import type { PluginStartupRegistrations } from "./startup-registrations";

function plugin(pluginId: string): RpcPluginInventoryPlugin {
  return {
    manifest: { settings: [] },
    pluginId,
  } as unknown as RpcPluginInventoryPlugin;
}

function registrations(
  notificationProviders: Array<{
    id: string;
    sendHandle: string;
    timeoutMs: number;
  }>,
): PluginStartupRegistrations {
  return {
    crons: [],
    gc: [],
    ingressSources: [],
    modelProviders: [],
    notificationProviders,
    oauthProviders: [],
    injections: [],
    tools: [],
  } as unknown as PluginStartupRegistrations;
}

function session(input: {
  directoryName: string;
  pluginId: string;
  providerId: string;
}): PluginNotificationProviderCapabilitySession {
  return {
    directoryName: input.directoryName,
    plugin: plugin(input.pluginId),
    ready: true,
    registrations: registrations([
      {
        id: input.providerId,
        sendHandle: `notificationProvider:${input.providerId}:send`,
        timeoutMs: 7_500,
      },
    ]),
  };
}

describe("notification provider capability", () => {
  it("dispatches ready provider sessions in stable order and normalizes receipts", async () => {
    const invocations: string[] = [];
    const receipts = await dispatchPluginNotificationProvidersForSessions({
      appDataOptions: {},
      invokeSidecarRequest: async ({ request, session }) => {
        invocations.push(`${session.directoryName}:${request.operation}`);
        expect(request.params).toMatchObject({
          providerId: session.registrations?.notificationProviders[0]?.id,
        });
        return {
          receipts: [
            {
              externalId: `external-${session.directoryName}`,
              message: "Delivered.",
              status: "delivered",
            },
          ],
        };
      },
      request: {
        body: "Build finished.",
        pluginId: "sender_plugin",
        title: "Build done",
      },
      sessions: [
        session({
          directoryName: "zeta_plugin",
          pluginId: "zeta_plugin",
          providerId: "alerts",
        }),
        session({
          directoryName: "alpha_plugin",
          pluginId: "alpha_plugin",
          providerId: "alerts",
        }),
      ],
    });

    expect(invocations).toEqual([
      "alpha_plugin:notification.provider.send",
      "zeta_plugin:notification.provider.send",
    ]);
    expect(receipts).toEqual([
      {
        channel: "plugin",
        deliveryId: null,
        externalId: "external-alpha_plugin",
        message: "Delivered.",
        outlet: "plugin",
        provider: "alpha_plugin/alerts",
        status: "delivered",
      },
      {
        channel: "plugin",
        deliveryId: null,
        externalId: "external-zeta_plugin",
        message: "Delivered.",
        outlet: "plugin",
        provider: "zeta_plugin/alerts",
        status: "delivered",
      },
    ]);
  });

  it("maps provider callback errors to retryable failed receipts", async () => {
    const receipts = await dispatchPluginNotificationProvidersForSessions({
      appDataOptions: {},
      invokeSidecarRequest: async () => {
        throw new PluginSidecarToolCallError({
          code: "plugin_callback_timeout",
        });
      },
      request: {
        body: "Build finished.",
        pluginId: "sender_plugin",
        title: "Build done",
      },
      sessions: [
        session({
          directoryName: "provider_plugin",
          pluginId: "provider_plugin",
          providerId: "alerts",
        }),
      ],
    });

    expect(receipts).toEqual([
      {
        channel: "plugin",
        code: "plugin_callback_timeout",
        deliveryId: null,
        message:
          "Plugin notification provider provider_plugin/alerts failed: plugin_callback_timeout.",
        outlet: "plugin",
        provider: "provider_plugin/alerts",
        retryable: true,
        status: "failed",
      },
    ]);
  });

  it("normalizes non-delivered receipts and rejects missing required Plugin Settings before dispatch", async () => {
    expect(
      normalizePluginNotificationProviderReceipt({
        pluginId: "provider_plugin",
        providerId: "alerts",
        receipt: {
          code: "PROVIDER_SKIPPED",
          message: "Skipped.",
          status: "skipped",
        },
      }),
    ).toEqual({
      channel: "plugin",
      code: "PROVIDER_SKIPPED",
      deliveryId: null,
      message: "Skipped.",
      outlet: "plugin",
      provider: "provider_plugin/alerts",
      status: "failed",
    });

    const appDataDir = mkdtempSync(
      join(tmpdir(), "metidos-plugin-notification-capability-"),
    );
    try {
      try {
        await buildPluginNotificationProviderSidecarRequest({
          appDataOptions: { appDataDir },
          directoryName: "provider_plugin",
          plugin: {
            manifest: {
              settings: [
                {
                  defaultValue: null,
                  description: null,
                  hasDefault: false,
                  items: null,
                  key: "routing_key",
                  kind: "text",
                  label: "Routing key",
                  options: [],
                  required: true,
                },
              ],
            },
            pluginId: "provider_plugin",
          } as unknown as RpcPluginInventoryPlugin,
          pluginId: "provider_plugin",
          registration: {
            id: "alerts",
            sendHandle: "notificationProvider:alerts:send",
            timeoutMs: 5_000,
          },
          request: {
            body: "Build finished.",
            context: { contextKind: "threadTool", ownerUserId: 7 },
            pluginId: "sender_plugin",
            title: "Build done",
          },
        });
        throw new Error("Expected missing settings failure.");
      } catch (error) {
        expect(error).toBeInstanceOf(PluginSidecarToolCallError);
        expect((error as PluginSidecarToolCallError).code).toBe(
          "missing_required_plugin_settings",
        );
        expect((error as Error).cause).toEqual(
          new Error("Missing required plugin settings: routing_key."),
        );
      }
    } finally {
      rmSync(appDataDir, { force: true, recursive: true });
    }
  });
});
