/**
 * @file src/mainview/app/plugin-ingress-route-state.test.ts
 * @description Characterization tests for Plugin ingress route view-state helpers.
 */

import { describe, expect, it } from "bun:test";

import type {
  RpcPluginAccessGroupOption,
  RpcPluginIngressExternalBinding,
  RpcPluginIngressRouteConfig,
  RpcPluginIngressSourceDescriptor,
  RpcPluginInventoryPlugin,
  RpcProject,
  RpcThreadPermissionDescriptor,
} from "../../bun/rpc-schema";
import {
  buildPluginIngressRouteDrafts,
  defaultIngressRouteAccess,
  displayedIngressRouteFolderPath,
  pluginIngressBindingStatusText,
  pluginIngressBindingsForSource,
  pluginIngressIntervalSummary,
  pluginIngressLinkCodeExpiryText,
  pluginIngressSourcesSummary,
  reconcilePluginIngressRouteDrafts,
  sanitizeIngressRoutePermissions,
} from "./plugin-ingress-route-state";

function buildIngressSource(
  overrides: Omit<Partial<RpcPluginIngressSourceDescriptor>, "source"> & {
    source?: Partial<RpcPluginIngressSourceDescriptor["source"]>;
  } = {},
): RpcPluginIngressSourceDescriptor {
  const { source: sourceOverrides, ...descriptorOverrides } = overrides;
  return {
    pluginId: descriptorOverrides.pluginId ?? "chat-plugin",
    pluginName: descriptorOverrides.pluginName ?? "Chat Plugin",
    source: {
      description:
        sourceOverrides?.description === undefined
          ? "Fake provider direct messages"
          : sourceOverrides.description,
      id: sourceOverrides?.id === undefined ? "dm" : sourceOverrides.id,
      name:
        sourceOverrides?.name === undefined
          ? "Direct messages"
          : sourceOverrides.name,
      pollIntervalMs:
        sourceOverrides?.pollIntervalMs === undefined
          ? 60_000
          : sourceOverrides.pollIntervalMs,
      supportsReplyToSource:
        sourceOverrides?.supportsReplyToSource === undefined
          ? true
          : sourceOverrides.supportsReplyToSource,
      timeoutMs:
        sourceOverrides?.timeoutMs === undefined
          ? 5_000
          : sourceOverrides.timeoutMs,
    },
  };
}

function buildRouteConfig(
  overrides: Partial<RpcPluginIngressRouteConfig> = {},
): RpcPluginIngressRouteConfig {
  return {
    createdAt: "2026-05-08T15:00:00.000Z",
    enabled: true,
    id: 1,
    metidosUserId: 10,
    model: "codex-pro",
    permissions: ["metidos:threads", "metidos:git", "metidos:unsafe"],
    pluginId: "chat-plugin",
    projectId: 42,
    sourceId: "dm",
    updatedAt: "2026-05-08T15:00:00.000Z",
    worktreePath: "/home/metidos/Projects/routed",
    ...overrides,
  };
}

function buildProject(overrides: Partial<RpcProject> = {}): RpcProject {
  return {
    createdAt: "2026-05-08T15:00:00.000Z",
    id: 7,
    isOpen: 1,
    lastOpenedAt: "2026-05-08T15:00:00.000Z",
    name: "fallback",
    path: "/home/metidos/Projects/fallback",
    updatedAt: "2026-05-08T15:00:00.000Z",
    ...overrides,
  };
}

function buildThreadPermission(id: string): RpcThreadPermissionDescriptor {
  return {
    accessId: id.replace("metidos:", ""),
    category: "coordination",
    defaultEnabled: id === "metidos:threads",
    description: id,
    id,
    label: id,
    order: 0,
    providerDescription: "Metidos",
    providerId: "metidos",
    requiresApproval: false,
    unsafe: id === "metidos:unsafe",
  };
}

function buildPluginAccessGroup(
  overrides: Partial<RpcPluginAccessGroupOption> = {},
): RpcPluginAccessGroupOption {
  return {
    description: null,
    groupId: "memory-read",
    groupName: "Memory read",
    key: "memory-plugin:memory-read",
    pluginDirectoryName: "memory_plugin",
    pluginId: "memory-plugin",
    pluginName: "Memory Plugin",
    tools: [],
    ...overrides,
  };
}

describe("plugin ingress route state", () => {
  it("formats ingress route folder input paths relative to home", () => {
    expect(
      displayedIngressRouteFolderPath({
        homeDirectory: "/home/metidos",
        hoveredDirectorySuggestion: null,
        supportsTildePath: true,
        worktreePath: "/home/metidos/Projects/metidos-memory",
      }),
    ).toBe("~/Projects/metidos-memory");

    expect(
      displayedIngressRouteFolderPath({
        homeDirectory: "/home/metidos",
        hoveredDirectorySuggestion: "/home/metidos/Projects/metidos-memory",
        supportsTildePath: true,
        worktreePath: "/tmp/ignored",
      }),
    ).toBe("~/Projects/metidos-memory/");

    expect(
      displayedIngressRouteFolderPath({
        homeDirectory: "/home/metidos",
        hoveredDirectorySuggestion: null,
        supportsTildePath: false,
        worktreePath: "/home/metidos/Projects/metidos-memory",
      }),
    ).toBe("/home/metidos/Projects/metidos-memory");
  });

  it("groups ingress bindings and formats link-code expiry for source rendering", () => {
    const bindings: RpcPluginIngressExternalBinding[] = [
      {
        createdAt: "2026-05-08T15:00:00.000Z",
        enabled: true,
        externalUserId: "external-user-1",
        id: 1,
        metidosUserId: 10,
        pluginId: "chat-plugin",
        sourceId: "dm",
        updatedAt: "2026-05-08T15:00:00.000Z",
      },
      {
        createdAt: "2026-05-08T15:00:00.000Z",
        enabled: false,
        externalUserId: "external-user-2",
        id: 2,
        metidosUserId: 10,
        pluginId: "chat-plugin",
        sourceId: "mentions",
        updatedAt: "2026-05-08T15:02:00.000Z",
      },
    ];

    const [dmBinding, mentionsBinding] = bindings;
    expect(dmBinding).toBeDefined();
    expect(mentionsBinding).toBeDefined();
    if (!dmBinding || !mentionsBinding) {
      throw new Error("Expected test bindings to be present.");
    }

    expect(
      pluginIngressBindingsForSource(bindings, "chat-plugin", "dm"),
    ).toEqual([dmBinding]);
    expect(pluginIngressBindingsForSource(bindings, null, "dm")).toEqual([]);
    expect(pluginIngressBindingStatusText(dmBinding)).toBe("Enabled");
    expect(pluginIngressBindingStatusText(mentionsBinding)).toBe("Disabled");
    expect(
      pluginIngressLinkCodeExpiryText(
        { expiresAt: "2026-05-08T15:10:00.000Z" },
        Date.parse("2026-05-08T15:00:01.000Z"),
      ),
    ).toBe("Expires in 10 min");
    expect(
      pluginIngressLinkCodeExpiryText(
        { expiresAt: "2026-05-08T15:00:00.000Z" },
        Date.parse("2026-05-08T15:00:01.000Z"),
      ),
    ).toBe("Expired");
    expect(pluginIngressLinkCodeExpiryText({ expiresAt: "not a date" })).toBe(
      "Expiry unavailable",
    );
  });

  it("summarizes declared plugin ingress sources without leaking cursor values", () => {
    expect(
      pluginIngressSourcesSummary({
        manifest: {},
      } as RpcPluginInventoryPlugin),
    ).toBe("No ingress sources declared");

    expect(
      pluginIngressSourcesSummary({
        manifest: {
          ingressSources: [
            buildIngressSource().source,
            buildIngressSource({
              source: {
                description: null,
                id: "mentions",
                name: null,
                pollIntervalMs: 120_000,
                supportsReplyToSource: false,
              },
            }).source,
          ],
        },
      } as RpcPluginInventoryPlugin),
    ).toBe("Direct messages · mentions");
  });

  it("formats source poll intervals", () => {
    expect(pluginIngressIntervalSummary(null)).toBe(
      "No poll interval declared",
    );
    expect(pluginIngressIntervalSummary(120_000)).toBe("2 min");
    expect(pluginIngressIntervalSummary(5_000)).toBe("5 sec");
    expect(pluginIngressIntervalSummary(750)).toBe("750 ms");
  });

  it("builds drafts from existing routes and falls back to the first project for missing routes", () => {
    const drafts = buildPluginIngressRouteDrafts(
      [
        buildIngressSource(),
        buildIngressSource({
          source: {
            id: "mentions",
            name: "Mentions",
          },
        }),
        buildIngressSource({ source: { id: null } }),
      ],
      [buildRouteConfig()],
      [buildProject()],
      "codex-mini",
    );

    expect(drafts["chat-plugin:dm"]).toEqual({
      access: defaultIngressRouteAccess([
        "metidos:threads",
        "metidos:git",
        "metidos:unsafe",
      ]),
      model: "codex-pro",
      projectId: 42,
      worktreePath: "/home/metidos/Projects/routed",
    });
    expect(drafts["chat-plugin:mentions"]).toEqual({
      access: defaultIngressRouteAccess(),
      model: "codex-mini",
      projectId: 7,
      worktreePath: "/home/metidos/Projects/fallback",
    });
    expect(drafts["chat-plugin:"]).toBeUndefined();
  });

  it("preserves edited drafts while reconciling the current source list", () => {
    const currentDrafts = {
      "chat-plugin:dm": {
        access: defaultIngressRouteAccess(["metidos:threads"]),
        model: "edited-model",
        projectId: null,
        worktreePath: "/tmp/edited",
      },
      "chat-plugin:removed": {
        access: defaultIngressRouteAccess(),
        model: "removed",
        projectId: null,
        worktreePath: "/tmp/removed",
      },
    };

    expect(
      reconcilePluginIngressRouteDrafts({
        currentDrafts,
        defaultModel: "codex-mini",
        projects: [buildProject()],
        routes: [buildRouteConfig()],
        sources: [buildIngressSource()],
      }),
    ).toEqual({
      "chat-plugin:dm": currentDrafts["chat-plugin:dm"],
    });
  });

  it("sanitizes route permissions against known thread permissions and plugin access groups", () => {
    expect(
      sanitizeIngressRoutePermissions(
        [
          "metidos:threads",
          "metidos:git",
          "metidos:unsafe",
          "memory-plugin:memory-read",
          "unknown:permission",
        ],
        [buildThreadPermission("metidos:threads")],
        [buildPluginAccessGroup()],
      ),
    ).toEqual(["metidos:threads", "memory-plugin:memory-read"]);

    expect(
      sanitizeIngressRoutePermissions(
        ["metidos:threads", "metidos:unsafe", "custom:legacy"],
        [],
        [],
      ),
    ).toEqual(["metidos:threads", "custom:legacy"]);
  });
});
