/**
 * @file src/bun/plugin/sidecar-host-router.test.ts
 * @description Contract tests for Plugin System v1 sidecar host-request routing.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import {
  handlePluginSidecarHostRequest,
  type PluginHostRequestRouterDependencies,
} from "./sidecar-host-router";
import type { PluginSidecarHostRequestEnvelope } from "./sidecar-rpc";
import { PluginWebSocketRegistry } from "./websocket";

const tempDirectories = new Set<string>();

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

afterEach(() => {
  for (const path of tempDirectories) {
    rmSync(path, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

function plugin(
  input: {
    files?: {
      allow?: {
        delete?: string[];
        read?: string[];
        write?: string[];
      };
      deny?: {
        delete?: string[];
        read?: string[];
        write?: string[];
      };
    };
    folderPath?: string;
    permissions?: string[];
  } = {},
): RpcPluginInventoryPlugin & { pluginId: string } {
  const folderPath =
    input.folderPath ?? createTempDirectory("metidos-plugin-router-plugin-");
  return {
    adminActions: [],
    approvedReviewHash: "review-hash",
    currentReviewHash: "review-hash",
    dataUsage: {
      bytes: 0,
      files: 0,
      scannedAt: "2026-05-03T20:00:00.000Z",
      unavailableReason: null,
    },
    description: "Router test plugin.",
    directoryName: "router_plugin",
    folderPath,
    group: "Active",
    hasRootNodeModules: false,
    lifecycle: {
      activatedOnce: true,
      approvedAt: "2026-05-03T20:00:00.000Z",
      approvedBy: "agent",
      crashLoop: {
        crashCount: 0,
        lastCrashAt: null,
        threshold: 3,
        thresholdReached: false,
        windowMs: 60_000,
      },
      disabledAt: null,
      discoveredAt: "2026-05-03T20:00:00.000Z",
      enabled: true,
      failureReason: null,
      lastActionAt: "2026-05-03T20:00:00.000Z",
      lastActionBy: "agent",
      restartRequired: false,
      settings: {
        log: { enabled: true, maxBytes: 1024, retentionDays: 14 },
        notifications: { enabled: true, perDayLimit: 100, perMinuteLimit: 10 },
        quota: { maxDataBytes: 1024 * 1024, maxFileBytes: 1024, maxFiles: 50 },
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
          delete: input.files?.allow?.delete ?? [],
          read: input.files?.allow?.read ?? [],
          write: input.files?.allow?.write ?? [],
        },
        deny: {
          delete: input.files?.deny?.delete ?? [],
          read: input.files?.deny?.read ?? [],
          write: input.files?.deny?.write ?? [],
        },
      },
      gc: null,
      metidosApiVersion: "v1",
      network: {
        allow: [],
        enforceHttps: true,
        webSocketAllow: [],
      },
      notificationProviders: [],
      oauthProviders: [],
      permissions: input.permissions ?? [],
      piAuth: [],
      providers: [],
      settings: [],
      storageDefaults: null,
      telemetry: true,
    },
    name: "Router Plugin",
    pluginId: "router_plugin",
    reviewWarnings: [],
    status: "active",
    structurallyValid: true,
    validationErrors: [],
    version: "1.0.0",
  };
}

function envelope(
  operation: string,
  params?: unknown,
): PluginSidecarHostRequestEnvelope {
  return {
    id: `request:${operation}`,
    payload: { operation, params },
    pluginId: "router_plugin",
    type: "sidecar.request",
  };
}

function userRecord(id: number, isAdmin: boolean) {
  return {
    createdAt: "2026-05-03T20:00:00.000Z",
    displayName: null,
    email: null,
    enabled: true,
    id,
    isAdmin,
    updatedAt: "2026-05-03T20:00:00.000Z",
    username: `user-${id}`,
  };
}

function dependencies(
  input: {
    adminUserIds?: number[];
    notifications?: {
      sent: Array<Record<string, unknown>>;
    };
  } = {},
): PluginHostRequestRouterDependencies {
  const adminUserIds = new Set(input.adminUserIds ?? []);
  return {
    calendarEventsHost: {
      createCalendar: () => ({ id: 1 }),
      createEvent: () => ({ id: 1 }),
      deleteCalendar: (userId: number, calendarId: number) => ({
        calendarId,
        success: userId > 0,
      }),
      deleteEvent: (userId: number, params: { eventId: number }) => ({
        eventId: params.eventId,
        success: userId > 0,
      }),
      getEvent: (_userId: number, eventId: number) => ({ id: eventId }),
      listCalendars: () => [],
      listEvents: () => [],
      updateCalendar: (_userId: number, calendarId: number) => ({
        id: calendarId,
      }),
      updateEvent: (_userId: number, params: { eventId: number }) => ({
        id: params.eventId,
      }),
    } as unknown as PluginHostRequestRouterDependencies["calendarEventsHost"],
    dispatchPluginNotificationProviders: async () => [],
    embed: async () => [0.1, 0.2],
    logger: {
      error: () => {},
      warning: () => {},
    },
    now: () => new Date("2026-05-03T20:00:00.000Z"),
    sendNotification: async (
      request: Record<string, unknown>,
      controls?: Record<string, unknown>,
    ) => {
      input.notifications?.sent.push({ controls, request });
      return {
        receipts: [
          {
            channel: "plugin",
            deliveryId: null,
            message: "delivered",
            outlet: "plugin",
            status: "delivered",
          },
        ],
      };
    },
    terminalHost: {
      createTerminal: () => ({ index: 1 }),
      grepTerminal: () => "matched",
      killTerminal: () => {},
      readTerminal: () => "output",
    } as unknown as PluginHostRequestRouterDependencies["terminalHost"],
    usersHost: {
      getUser: (userId: number) => userRecord(userId, adminUserIds.has(userId)),
      isUserAdmin: (userId: number) => adminUserIds.has(userId),
      listUsers: () => [userRecord(1, adminUserIds.has(1))],
      resetUserOtp: () => {},
      updateUser: (userId: number) =>
        userRecord(userId, adminUserIds.has(userId)),
    } as unknown as PluginHostRequestRouterDependencies["usersHost"],
  };
}

function registry(): PluginWebSocketRegistry {
  return new PluginWebSocketRegistry({
    network: {
      allow: [],
      enforceHttps: true,
      webSocketAllow: ["wss://example.com/**"],
    },
    permissions: ["network:websocket"],
    resolveHostname: async () => ["93.184.216.34"],
  });
}

describe("plugin sidecar host-request router", () => {
  it("returns stable unsupported-operation host errors without diagnostics retention", async () => {
    const result = await handlePluginSidecarHostRequest({
      dependencies: dependencies(),
      envelope: envelope("missing.operation", {}),
      session: { plugin: plugin(), webSockets: registry() },
    });

    expect(result).toEqual({
      code: "unsupported_operation",
      message: "Plugin host operation missing.operation is not supported.",
      operation: "missing.operation",
      retainFailureDiagnostic: false,
      type: "error",
    });
  });

  it("routes filesystem read and write requests with thread worktree context", async () => {
    const rootPath = createTempDirectory("metidos-plugin-router-fs-");
    const pluginPath = join(rootPath, "plugins", "router_plugin");
    const worktreePath = join(rootPath, "worktree");
    mkdirSync(join(pluginPath, ".data"), { recursive: true });
    mkdirSync(join(worktreePath, "src"), { recursive: true });
    writeFileSync(join(worktreePath, "src", "input.txt"), "from worktree\n");
    const session = {
      plugin: plugin({
        files: {
          allow: {
            delete: ["./src/**"],
            read: ["./src/**"],
            write: ["./src/**"],
          },
        },
        folderPath: pluginPath,
        permissions: [
          "files:read",
          "files:write",
          "files:delete",
          "storage:read",
          "storage:write",
          "storage:delete",
        ],
      }),
      webSockets: registry(),
    };

    await expect(
      handlePluginSidecarHostRequest({
        dependencies: dependencies(),
        envelope: envelope("fs.readText", {
          context: { contextKind: "threadTool", worktreePath: "/" },
          params: { path: "./src/input.txt" },
        }),
        session,
        trustedCallback: {
          context: { contextKind: "threadTool", worktreePath },
          deadlineMs: Date.now() + 1_000,
        },
      }),
    ).resolves.toEqual({ result: "from worktree\n", type: "response" });

    await expect(
      handlePluginSidecarHostRequest({
        dependencies: dependencies(),
        envelope: envelope("fs.writeText", {
          context: { contextKind: "threadTool", worktreePath: "/" },
          params: { contents: "written\n", path: "./src/output.txt" },
        }),
        session,
        trustedCallback: {
          context: { contextKind: "threadTool", worktreePath },
          deadlineMs: Date.now() + 1_000,
        },
      }),
    ).resolves.toMatchObject({ type: "response" });
    const outputPath = join(worktreePath, "src", "output.txt");
    expect(readFileSync(outputPath, "utf8")).toBe("written\n");

    await expect(
      handlePluginSidecarHostRequest({
        dependencies: dependencies(),
        envelope: envelope("fs.rm", {
          context: { contextKind: "threadTool", worktreePath: "/" },
          params: { path: "./src/output.txt" },
        }),
        session,
        trustedCallback: {
          context: { contextKind: "threadTool", worktreePath },
          deadlineMs: Date.now() + 1_000,
        },
      }),
    ).resolves.toMatchObject({ type: "response" });
    expect(existsSync(outputPath)).toBe(false);
  });

  it("rejects malformed binary filesystem payloads before decoding", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-router-binary-");
    mkdirSync(join(pluginPath, ".data"), { recursive: true });

    const result = await handlePluginSidecarHostRequest({
      dependencies: dependencies(),
      envelope: envelope("fs.write", {
        params: {
          bytes: { __metidosBytesBase64: "not-base64!" },
          path: "~/blob.bin",
        },
      }),
      session: {
        plugin: plugin({
          folderPath: pluginPath,
          permissions: ["storage:write"],
        }),
        webSockets: registry(),
      },
    });

    expect(result).toMatchObject({
      code: "invalid_binary_payload",
      operation: "fs.write",
      retainFailureDiagnostic: true,
      type: "error",
    });
    expect(existsSync(join(pluginPath, ".data", "blob.bin"))).toBe(false);
  });

  it("keeps SQLite and LanceDB scoped to plugin data paths", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-router-data-");
    mkdirSync(join(pluginPath, ".data"), { recursive: true });

    const sqliteResult = await handlePluginSidecarHostRequest({
      dependencies: dependencies(),
      envelope: envelope("sqlite.run", {
        params: { path: "./project.sqlite", statement: "select 1" },
      }),
      session: {
        plugin: plugin({
          folderPath: pluginPath,
          permissions: ["sqlite", "storage:write"],
        }),
        webSockets: registry(),
      },
    });

    expect(sqliteResult).toMatchObject({
      code: "project_context_unavailable",
      operation: "sqlite.run",
      retainFailureDiagnostic: true,
      type: "error",
    });

    const lanceDbResult = await handlePluginSidecarHostRequest({
      dependencies: dependencies(),
      envelope: envelope("lancedb.upsert", {
        params: { path: "./vectors", rows: [{ vector: [1] }] },
      }),
      session: {
        plugin: plugin({
          folderPath: pluginPath,
          permissions: ["metidos:lancedb", "storage:write"],
        }),
        webSockets: registry(),
      },
    });

    expect(lanceDbResult).toMatchObject({
      code: "project_context_unavailable",
      operation: "lancedb.upsert",
      retainFailureDiagnostic: true,
      type: "error",
    });
  });

  it("applies plugin data quota to routed LanceDB writes", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-router-lancedb-");
    mkdirSync(join(pluginPath, ".data"), { recursive: true });

    await expect(
      handlePluginSidecarHostRequest({
        dependencies: dependencies(),
        envelope: envelope("lancedb.upsert", {
          params: {
            path: "~/vectors",
            rows: [{ id: 1, vector: Array(512).fill(1) }],
          },
        }),
        session: {
          plugin: plugin({
            folderPath: pluginPath,
            permissions: ["metidos:lancedb", "storage:write"],
          }),
          webSockets: registry(),
        },
      }),
    ).resolves.toMatchObject({
      code: "plugin_data_quota_exceeded",
      operation: "lancedb.upsert",
      retainFailureDiagnostic: true,
      type: "error",
    });
  });

  it("preserves calendar confirmation and terminal cron restrictions", async () => {
    await expect(
      handlePluginSidecarHostRequest({
        dependencies: dependencies(),
        envelope: envelope("calendar.delete", {
          context: { contextKind: "threadTool", ownerUserId: 999 },
          params: { calendarId: 10, confirmed: true },
        }),
        session: {
          plugin: plugin({ permissions: ["calendar:delete"] }),
          webSockets: registry(),
        },
        trustedCallback: {
          context: { contextKind: "cron", ownerUserId: 1 },
          deadlineMs: Date.now() + 1_000,
        },
      }),
    ).resolves.toMatchObject({
      code: "plugin_confirmation_unavailable",
      operation: "calendar.delete",
      type: "error",
    });

    await expect(
      handlePluginSidecarHostRequest({
        dependencies: dependencies(),
        envelope: envelope("terminal.create", {
          context: { contextKind: "threadTool", ownerUserId: 999 },
          params: { command: "pwd" },
        }),
        session: {
          plugin: plugin({ permissions: ["terminal:create", "unsafe"] }),
          webSockets: registry(),
        },
        trustedCallback: {
          context: { contextKind: "cron", ownerUserId: null },
          deadlineMs: Date.now() + 1_000,
        },
      }),
    ).resolves.toMatchObject({
      code: "plugin_terminal_unavailable_in_cron",
      operation: "terminal.create",
      type: "error",
    });
  });

  it("routes WebSocket, log, and notification operations through injected dependencies", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-router-hosts-");
    const notifications = { sent: [] as Array<Record<string, unknown>> };
    const session = {
      plugin: plugin({
        folderPath: pluginPath,
        permissions: ["log:write", "notification:send"],
      }),
      webSockets: registry(),
    };

    await expect(
      handlePluginSidecarHostRequest({
        dependencies: dependencies({ notifications }),
        envelope: envelope("websocket.state", { params: { id: 404 } }),
        session,
      }),
    ).resolves.toMatchObject({
      code: "invalid_connection_id",
      operation: "websocket.state",
      type: "error",
    });

    await expect(
      handlePluginSidecarHostRequest({
        dependencies: dependencies({ notifications }),
        envelope: envelope("metidos.log", {
          params: { level: "info", message: "router log" },
        }),
        session,
      }),
    ).resolves.toMatchObject({ result: { logged: true }, type: "response" });
    expect(existsSync(join(pluginPath, ".logs", "log-2026-05-03.log"))).toBe(
      true,
    );

    await expect(
      handlePluginSidecarHostRequest({
        dependencies: dependencies({ notifications }),
        envelope: envelope("notifications.send", {
          body: "Body",
          title: "Title",
        }),
        session,
      }),
    ).resolves.toEqual({
      result: {
        receipts: [
          {
            channel: "plugin",
            deliveryId: null,
            message: "delivered",
            outlet: "plugin",
            status: "delivered",
          },
        ],
      },
      type: "response",
    });
    expect(notifications.sent).toHaveLength(1);
    expect(notifications.sent[0]?.request).toMatchObject({
      pluginId: "router_plugin",
      title: "Title",
    });
  });
});
