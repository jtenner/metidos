/**
 * @file src/bun/plugin/capability-gate.test.ts
 * @description Tests for central Plugin Capability Gate decisions.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPluginCapability,
  evaluatePluginCapability,
  type PluginCapabilityGateContext,
} from "./capability-gate";
import { PluginContextError, PluginPermissionError } from "./context";

let tempRoots: string[] = [];

beforeEach(() => {
  tempRoots = [];
});

afterEach(async () => {
  await Promise.all(
    tempRoots.map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function pluginContext(
  overrides: Partial<PluginCapabilityGateContext> = {},
): Promise<PluginCapabilityGateContext> {
  const root = await mkdtemp(join(tmpdir(), "metidos-plugin-capability-gate-"));
  tempRoots.push(root);
  const pluginPath = join(root, "plugin");
  const projectRootPath = join(root, "project");
  await mkdir(join(pluginPath, ".data"), { recursive: true });
  await mkdir(projectRootPath, { recursive: true });
  return {
    contextKind: "threadTool",
    ownerUserId: 7,
    permissions: [],
    pluginId: "example_plugin",
    pluginPath,
    projectId: 1,
    projectRootPath,
    threadId: 2,
    threadRootPath: projectRootPath,
    worktreePath: projectRootPath,
    ...overrides,
  };
}

describe("plugin capability gate", () => {
  it("reports permission and access-group decisions with actionable failures", async () => {
    const context = await pluginContext({
      enabledAccessGroups: ["example_plugin/tools"],
      permissions: ["log:write"],
    });

    await expect(
      evaluatePluginCapability({
        context,
        request: {
          kind: "permission",
          operation: "log.write",
          permission: "log:write",
        },
      }),
    ).resolves.toMatchObject({ allowed: true, permission: "log:write" });

    await expect(
      evaluatePluginCapability({
        context,
        request: { kind: "accessGroup", groupId: "tools" },
      }),
    ).resolves.toMatchObject({ allowed: true });

    await expect(
      evaluatePluginCapability({
        context,
        request: {
          kind: "permission",
          operation: "fetch",
          permission: "network:fetch",
        },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: "plugin_permission_error",
      message: "metidos.fetch requires network:fetch.",
      permission: "network:fetch",
    });
  });

  it("resolves storage and project path capabilities through virtual path safety", async () => {
    const context = await pluginContext({
      permissions: ["files:read", "storage:write"],
    });

    await expect(
      evaluatePluginCapability({
        context,
        request: { access: "write", kind: "fs", virtualPath: "~/state.json" },
      }),
    ).resolves.toMatchObject({
      allowed: true,
      permission: "storage:write",
      resolvedPath: { rootKind: "pluginData", virtualPath: "~/state.json" },
    });

    await expect(
      evaluatePluginCapability({
        context,
        request: { access: "read", kind: "fs", virtualPath: "./" },
      }),
    ).resolves.toMatchObject({
      allowed: true,
      permission: "files:read",
      resolvedPath: { rootKind: "thread", virtualPath: "./" },
    });

    await expect(
      evaluatePluginCapability({
        context: { ...context, contextKind: "cron" },
        request: { access: "read", kind: "fs", virtualPath: "./" },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: "project_context_unavailable",
    });
  });

  it("checks network allowlists and SQLite data scope", async () => {
    const context = await pluginContext({
      network: { allow: ["https://api.example.com/v1/**"], enforceHttps: true },
      permissions: ["network:fetch", "sqlite", "storage:write"],
    });

    await expect(
      evaluatePluginCapability({
        context,
        request: {
          kind: "network",
          operation: "fetch",
          url: "https://api.example.com/v1/items",
        },
      }),
    ).resolves.toMatchObject({ allowed: true, permission: "network:fetch" });

    await expect(
      evaluatePluginCapability({
        context,
        request: {
          kind: "network",
          operation: "fetch",
          url: "https://evil.example.com/v1/items",
        },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: "network_url_not_allowed",
      permission: "network:fetch",
    });

    const websocketContext = await pluginContext({
      network: {
        allow: ["https://api.example.com/v1/**"],
        enforceHttps: true,
        webSocketAllow: ["wss://socket.example.com/**"],
      },
      permissions: ["network:websocket"],
    });
    await expect(
      evaluatePluginCapability({
        context: websocketContext,
        request: {
          kind: "network",
          operation: "websocket",
          url: "wss://socket.example.com/events",
        },
      }),
    ).resolves.toMatchObject({
      allowed: true,
      permission: "network:websocket",
    });

    await expect(
      evaluatePluginCapability({
        context,
        request: {
          kind: "network",
          operation: "websocket",
          url: "wss://socket.example.com/events",
        },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: "plugin_permission_error",
      permission: "network:websocket",
    });

    await expect(
      evaluatePluginCapability({
        context: { ...websocketContext, permissions: ["network:fetch"] },
        request: {
          kind: "network",
          operation: "websocket",
          url: "wss://socket.example.com/events",
        },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: "plugin_permission_error",
      permission: "network:websocket",
    });

    await expect(
      evaluatePluginCapability({
        context,
        request: {
          kind: "sqlite",
          operation: "sqlite.run",
          virtualPath: "~/state.sqlite",
        },
      }),
    ).resolves.toMatchObject({
      allowed: true,
      permission: "sqlite",
      resolvedPath: { rootKind: "pluginData" },
    });

    await expect(
      evaluatePluginCapability({
        context,
        request: {
          kind: "sqlite",
          operation: "sqlite.run",
          virtualPath: "./state.sqlite",
        },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: "project_context_unavailable",
    });

    await expect(
      evaluatePluginCapability({
        context: {
          ...context,
          permissions: ["metidos:lancedb", "storage:write"],
        },
        request: {
          kind: "lancedb",
          operation: "lancedb.upsert",
          virtualPath: "~/vectors",
        },
      }),
    ).resolves.toMatchObject({
      allowed: true,
      permission: "metidos:lancedb",
      resolvedPath: { rootKind: "pluginData" },
    });

    await expect(
      evaluatePluginCapability({
        context: {
          ...context,
          permissions: ["metidos:lancedb", "storage:write"],
        },
        request: {
          kind: "lancedb",
          operation: "lancedb.upsert",
          virtualPath: "./vectors",
        },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: "project_context_unavailable",
    });
  });

  it("covers Calendar, Terminal, notification, and provider capability invariants", async () => {
    const context = await pluginContext({
      permissions: [
        "calendar:delete",
        "notification:provider",
        "notification:send",
        "terminal:create",
        "unsafe",
      ],
    });

    await expect(
      evaluatePluginCapability({
        context,
        request: {
          kind: "calendar",
          operation: "calendar.delete",
          params: { confirmation: true },
        },
      }),
    ).resolves.toMatchObject({ allowed: true, permission: "calendar:delete" });

    await expect(
      evaluatePluginCapability({
        context: { ...context, contextKind: "cron" },
        request: {
          kind: "calendar",
          operation: "calendar.delete",
          params: { confirmation: true },
        },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: "plugin_confirmation_unavailable",
    });

    await expect(
      evaluatePluginCapability({
        context,
        request: { kind: "terminal", operation: "terminal.create" },
      }),
    ).resolves.toMatchObject({ allowed: true, permission: "terminal:create" });

    await expect(
      evaluatePluginCapability({
        context: { ...context, permissions: ["terminal:create"] },
        request: { kind: "terminal", operation: "terminal.create" },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: "plugin_unsafe_permission_required",
      permission: "unsafe",
    });

    await expect(
      evaluatePluginCapability({
        context,
        request: { kind: "notification", operation: "send" },
      }),
    ).resolves.toMatchObject({
      allowed: true,
      permission: "notification:send",
    });

    await expect(
      evaluatePluginCapability({
        context,
        request: {
          kind: "provider",
          operation: "notification",
          permission: "notification:provider",
        },
      }),
    ).resolves.toMatchObject({
      allowed: true,
      permission: "notification:provider",
    });
  });

  it("throws existing error families for adapters that prefer assertions", async () => {
    const context = await pluginContext({ permissions: [] });

    await expect(
      assertPluginCapability({
        context,
        request: {
          kind: "permission",
          operation: "fetch",
          permission: "network:fetch",
        },
      }),
    ).rejects.toBeInstanceOf(PluginPermissionError);

    await expect(
      assertPluginCapability({
        context: {
          ...context,
          permissions: ["files:read"],
          contextKind: "cron",
        },
        request: { access: "read", kind: "fs", virtualPath: "./" },
      }),
    ).rejects.toBeInstanceOf(PluginContextError);
  });
});
