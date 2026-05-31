import { describe, expect, it } from "bun:test";

import type {
  RpcPluginInventory,
  RpcPluginInventoryPlugin,
} from "./rpc-schema";
import {
  createThreadPermissionDescriptor,
  createThreadPermissionRegistry,
  defaultThreadPermissions,
  metidosNativePermissionDescriptors,
  normalizeThreadPermissions,
  permissionDescriptorsForAgentCatalog,
  permissionIdFor,
  pluginPermissionDescriptorsFromInventory,
  ThreadPermissionRegistryError,
} from "./thread-permissions";

function activePlugin(input: {
  access: Array<{
    description?: string | null;
    id: string | null;
    name?: string | null;
    tools: Array<{ name: string | null }>;
  }>;
  description?: string | null;
  pluginId: string;
}): RpcPluginInventoryPlugin {
  return {
    adminActions: [],
    approvedReviewHash: null,
    currentReviewHash: null,
    dataUsage: {
      bytes: 0,
      files: 0,
      scannedAt: "2026-05-01T00:00:00Z",
      unavailableReason: null,
    },
    description: input.description ?? "Example plugin",
    directoryName: input.pluginId,
    folderPath: `/plugins/${input.pluginId}`,
    group: "Active",
    hasRootNodeModules: false,
    lifecycle: {
      activatedOnce: true,
      approvedAt: "2026-05-01T00:00:00Z",
      approvedBy: "codex",
      crashLoop: {
        crashCount: 0,
        lastCrashAt: null,
        threshold: 3,
        thresholdReached: false,
        windowMs: 60_000,
      },
      disabledAt: null,
      discoveredAt: "2026-05-01T00:00:00Z",
      enabled: true,
      failureReason: null,
      lastActionAt: null,
      lastActionBy: null,
      restartRequired: false,
      settings: {
        log: { enabled: false, maxBytes: 0, retentionDays: 0 },
        notifications: { enabled: false, perDayLimit: 0, perMinuteLimit: 0 },
        quota: { maxDataBytes: 0, maxFileBytes: 0, maxFiles: 0 },
      },
      state: "active",
    },
    lifecycleMessage: null,
    manifest: {
      access: input.access.map((group) => ({
        description: group.description ?? null,
        id: group.id,
        name: group.name ?? null,
        tools: group.tools.map((tool) => ({
          description: null,
          name: tool.name,
          timeoutMs: 1000,
        })),
      })),
      crons: [],
      env: [],
      files: {
        allow: { delete: [], read: [], write: [] },
        deny: { delete: [], read: [], write: [] },
      },
      gc: null,
      limits: {},
      metidosApiVersion: "v1",
      network: null,
      notificationProviders: [],
      oauthProviders: [],
      permissions: [],
      piAuth: [],
      providers: [],
      settings: [],
      storageDefaults: null,
      telemetry: false,
    },
    name: input.pluginId,
    pluginId: input.pluginId,
    reviewWarnings: [],
    status: "active",
    structurallyValid: true,
    validationErrors: [],
    version: "1.0.0",
  };
}

function inventory(plugins: RpcPluginInventoryPlugin[]): RpcPluginInventory {
  return {
    groups: [],
    issues: [],
    plugins,
    pluginsDirectoryExists: true,
    pluginsDirectoryPath: "/plugins",
    scannedAt: "2026-05-01T00:00:00Z",
  };
}

describe("thread permission registry", () => {
  it("creates native metidos descriptors without plugin permissions", () => {
    const ids = metidosNativePermissionDescriptors().map(
      (descriptor) => descriptor.id,
    );

    expect(ids).toContain("metidos:web-search");
    expect(ids).not.toContain("metidos:webview");
    expect(ids).toContain("metidos:unsafe");
    expect(ids).not.toContain("metidos:weather");
    expect(ids.every((id) => id.startsWith("metidos:"))).toBeTrue();
  });

  it("creates plugin permission ids as plugin_id:access_id", () => {
    const descriptor = createThreadPermissionDescriptor({
      accessId: "read",
      description: "Read note data.",
      providerDescription: "Notes plugin",
      providerId: "notes",
    });

    expect(descriptor.id).toBe("notes:read");
    expect(descriptor.defaultEnabled).toBeFalse();
    expect(descriptor.category).toBe("plugin");
  });

  it("rejects malformed permission ids", () => {
    expect(() => normalizeThreadPermissions(["webview"])).toThrow(
      ThreadPermissionRegistryError,
    );
    expect(() => permissionIdFor("notes", "read:all")).toThrow(
      ThreadPermissionRegistryError,
    );
    expect(() =>
      createThreadPermissionDescriptor({
        accessId: "read",
        description: "Read note data.",
        providerDescription: "Notes plugin",
        providerId: "Notes",
      }),
    ).toThrow(ThreadPermissionRegistryError);
  });

  it("normalizes duplicate and blank permissions deterministically", () => {
    const registry = createThreadPermissionRegistry({
      pluginDescriptors: [
        {
          accessId: "read",
          description: "Read note data.",
          providerDescription: "Notes plugin",
          providerId: "notes",
        },
      ],
    });

    expect(
      normalizeThreadPermissions([" notes:read ", "", "notes:read"], registry),
    ).toEqual(["notes:read"]);
  });

  it("rejects unknown permission strings", () => {
    const registry = createThreadPermissionRegistry();

    expect(() => normalizeThreadPermissions(["notes:read"], registry)).toThrow(
      ThreadPermissionRegistryError,
    );
    expect(() =>
      normalizeThreadPermissions(["metidos:webview"], registry),
    ).toThrow(ThreadPermissionRegistryError);
  });

  it("selects default permissions from descriptors", () => {
    expect(defaultThreadPermissions()).toEqual([
      "metidos:crons",
      "metidos:threads",
      "metidos:web-search",
    ]);
  });

  it("derives plugin descriptors from active inventory access groups", () => {
    const descriptors = pluginPermissionDescriptorsFromInventory(
      inventory([
        activePlugin({
          access: [
            {
              description: "Read note data.",
              id: "read",
              name: "Read",
              tools: [{ name: "list_notes" }],
            },
            {
              description: "No tools should not become a permission.",
              id: "empty",
              tools: [],
            },
          ],
          description: "Notes plugin",
          pluginId: "notes",
        }),
      ]),
    );

    const registry = createThreadPermissionRegistry({
      pluginDescriptors: descriptors,
    });

    expect(registry.byId.has("notes:read")).toBeTrue();
    expect(registry.byId.has("notes:empty")).toBeFalse();
  });

  it("keeps metidos first in agent catalog ordering", () => {
    const catalog = permissionDescriptorsForAgentCatalog(
      createThreadPermissionRegistry({
        pluginDescriptors: [
          {
            accessId: "forecast",
            description: "Weather forecast tools.",
            providerDescription: "Weather plugin",
            providerId: "weather",
          },
        ],
      }),
    );

    expect(catalog[0]?.providerId).toBe("metidos");
    expect(catalog.at(-1)?.id).toBe("weather:forecast");
  });

  it("rejects plugin descriptors that use the reserved metidos provider id", () => {
    expect(() =>
      createThreadPermissionRegistry({
        pluginDescriptors: [
          {
            accessId: "weather",
            description: "Masquerade as native weather access.",
            providerDescription: "Fake Metidos plugin",
            providerId: "metidos",
          },
        ],
      }),
    ).toThrow(ThreadPermissionRegistryError);
  });

  it("does not derive plugin permissions from reserved metidos plugin ids", () => {
    const descriptors = pluginPermissionDescriptorsFromInventory(
      inventory([
        activePlugin({
          access: [{ id: "weather", tools: [{ name: "get_weather" }] }],
          pluginId: "metidos",
        }),
      ]),
    );

    expect(descriptors).toEqual([]);
  });

  it("allows different plugins to reuse an access id", () => {
    const registry = createThreadPermissionRegistry({
      pluginDescriptors: pluginPermissionDescriptorsFromInventory(
        inventory([
          activePlugin({
            access: [{ id: "read", tools: [{ name: "list_notes" }] }],
            pluginId: "notes",
          }),
          activePlugin({
            access: [{ id: "read", tools: [{ name: "get_weather" }] }],
            pluginId: "weather",
          }),
        ]),
      ),
    });

    expect(registry.byId.has("notes:read")).toBeTrue();
    expect(registry.byId.has("weather:read")).toBeTrue();
  });

  it("rejects duplicate access ids within one plugin", () => {
    const descriptors = pluginPermissionDescriptorsFromInventory(
      inventory([
        activePlugin({
          access: [
            { id: "read", tools: [{ name: "list_notes" }] },
            { id: "read", tools: [{ name: "get_note" }] },
          ],
          pluginId: "notes",
        }),
      ]),
    );

    expect(() =>
      createThreadPermissionRegistry({ pluginDescriptors: descriptors }),
    ).toThrow(ThreadPermissionRegistryError);
  });

  it("rejects malformed plugin access ids from inventory", () => {
    const descriptors = pluginPermissionDescriptorsFromInventory(
      inventory([
        activePlugin({
          access: [{ id: "read:all", tools: [{ name: "list_notes" }] }],
          pluginId: "notes",
        }),
      ]),
    );

    expect(() =>
      createThreadPermissionRegistry({ pluginDescriptors: descriptors }),
    ).toThrow(ThreadPermissionRegistryError);
  });
});
