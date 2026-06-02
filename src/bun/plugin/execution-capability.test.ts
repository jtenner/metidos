import { describe, expect, it } from "bun:test";

import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { evaluatePluginStaticCapability } from "./capability-gate";
import type { PluginStartupRegistrations } from "./startup-registrations";
import {
  buildPluginAgentToolSidecarRequest,
  buildPluginCronSidecarRequest,
  buildPluginGcSidecarRequest,
  createPluginPreDispatchCancellationError,
  diagnosticCodeForUnknown,
  diagnosticMessageForUnknown,
  findPluginCronExecutionSession,
  listPluginAgentToolRegistrationsForThread,
  mapPluginGcSidecarFailure,
  normalizePluginCallbackTimeoutMs,
  pluginOperationCancellationRejection,
  pluginOperationTimeoutRejection,
  PluginSidecarToolCallError,
  type PluginExecutionCapabilitySession,
} from "./execution-capability";

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
    directoryName: "alpha_plugin",
    manifest: {
      agents: [],
      auth: null,
      calendarEvents: [],
      crons: [],
      description: null,
      displayName: "Alpha Plugin",
      env: [],
      gc: { enabled: true, timeoutMs: 9_000 },
      ingress: [],
      name: "alpha_plugin",
      notificationProviders: [],
      permissions: [],
      piAuth: [],
      providers: [],
      settings: [],
      tools: [],
      version: "1.0.0",
    },
    name: "Alpha Plugin",
    pluginId: "alpha_plugin",
    status: "active",
  } as unknown as RpcPluginInventoryPlugin;
}

function session(
  registrations: PluginStartupRegistrations,
): PluginExecutionCapabilitySession {
  return {
    directoryName: "alpha_plugin",
    plugin: plugin(),
    ready: true,
    registrations,
    stopping: false,
  };
}

describe("Plugin execution capability", () => {
  it("lists thread-visible agent tools through access groups", () => {
    const basePlugin = plugin() as unknown as {
      folderPath: string;
      group: string;
      lifecycle: { state: string };
      manifest: {
        access: Array<{
          color: string | null;
          description: string;
          id: string;
          name: string;
          tools: Array<{ name: string }>;
        }>;
        files: {
          allow: { read: string[] };
          deny: { read: string[] };
        };
        permissions: string[];
      };
      pluginId: string;
      structurallyValid: boolean;
      validationErrors: string[];
    };
    basePlugin.group = "Active";
    basePlugin.lifecycle = { state: "active" };
    basePlugin.structurallyValid = true;
    basePlugin.validationErrors = [];
    basePlugin.manifest.access = [
      {
        color: null,
        description: "Thread tools.",
        id: "thread_tools",
        name: "Thread tools",
        tools: [{ name: "hello" }],
      },
    ];
    basePlugin.manifest.files = {
      allow: { read: ["~/allowed"] },
      deny: { read: ["~/denied"] },
    };
    basePlugin.manifest.permissions = ["terminal:read"];
    basePlugin.folderPath = "/plugins/alpha_plugin";

    const registrations = emptyRegistrations();
    const helloRegistration: PluginStartupRegistrations["tools"][number] = {
      actionHandle: "tool:hello:action",
      description: "Say hello.",
      name: "hello",
      runtimeId: "alpha_plugin_hello",
      timeoutMs: 5_000,
      tool: "hello",
      validatePropsHandle: "tool:hello:validateProps",
    };
    registrations.tools = [
      helloRegistration,
      {
        actionHandle: "tool:hidden:action",
        description: "Hidden.",
        name: "hidden",
        runtimeId: "alpha_plugin_hidden",
        timeoutMs: 5_000,
        tool: "hidden",
        validatePropsHandle: "tool:hidden:validateProps",
      },
    ];

    const result = listPluginAgentToolRegistrationsForThread({
      enabledAccessGroups: ["alpha_plugin/thread_tools"],
      sessions: [
        {
          directoryName: "alpha_plugin",
          plugin: basePlugin as unknown as RpcPluginInventoryPlugin,
          ready: true,
          registrations,
          stopping: false,
        },
      ],
    });

    expect(result).toEqual([
      {
        directoryName: "alpha_plugin",
        filesReadAllowlist: ["~/allowed"],
        filesReadDenylist: ["~/denied"],
        permissions: ["terminal:read"],
        pluginId: "alpha_plugin",
        pluginPath: "/plugins/alpha_plugin",
        registration: helloRegistration,
      },
    ]);
  });

  it("does not let enabled access groups grant undeclared host permissions", () => {
    const basePlugin = plugin() as unknown as {
      folderPath: string;
      group: string;
      lifecycle: { state: string };
      manifest: {
        access: Array<{
          color: string | null;
          description: string;
          id: string;
          name: string;
          tools: Array<{ name: string }>;
        }>;
        files: {
          allow: { read: string[] };
          deny: { read: string[] };
        };
        permissions: string[];
      };
      pluginId: string;
      structurallyValid: boolean;
      validationErrors: string[];
    };
    basePlugin.group = "Active";
    basePlugin.lifecycle = { state: "active" };
    basePlugin.structurallyValid = true;
    basePlugin.validationErrors = [];
    basePlugin.manifest.access = [
      {
        color: null,
        description: "Thread tools.",
        id: "thread_tools",
        name: "Thread tools",
        tools: [{ name: "hello" }],
      },
    ];
    basePlugin.manifest.files = {
      allow: { read: [] },
      deny: { read: [] },
    };
    basePlugin.manifest.permissions = [];
    basePlugin.folderPath = "/plugins/alpha_plugin";

    const registrations = emptyRegistrations();
    registrations.tools = [
      {
        actionHandle: "tool:hello:action",
        description: "Say hello.",
        name: "hello",
        runtimeId: "alpha_plugin_hello",
        timeoutMs: 5_000,
        tool: "hello",
        validatePropsHandle: "tool:hello:validateProps",
      },
      {
        actionHandle: "tool:terminal:action",
        description: "Terminal helper.",
        name: "terminal_helper",
        runtimeId: "alpha_plugin_terminal_helper",
        timeoutMs: 5_000,
        tool: "terminal_helper",
        validatePropsHandle: "tool:terminal:validateProps",
      },
    ];

    const enabledAccessGroups = ["alpha_plugin/thread_tools"];
    const visibleTools = listPluginAgentToolRegistrationsForThread({
      enabledAccessGroups,
      sessions: [
        {
          directoryName: "alpha_plugin",
          plugin: basePlugin as unknown as RpcPluginInventoryPlugin,
          ready: true,
          registrations,
          stopping: false,
        },
      ],
    });

    expect(visibleTools.map((tool) => tool.registration.runtimeId)).toEqual([
      "alpha_plugin_hello",
    ]);
    expect(visibleTools[0]?.permissions).toEqual([]);

    expect(
      evaluatePluginStaticCapability({
        context: {
          enabledAccessGroups,
          permissions: visibleTools[0]?.permissions ?? [],
          pluginId: "alpha_plugin",
        },
        request: {
          kind: "permission",
          operation: "terminal.read",
          permission: "terminal:read",
        },
      }),
    ).toMatchObject({
      allowed: false,
      code: "plugin_permission_error",
      permission: "terminal:read",
    });
  });

  it("builds agent tool sidecar requests without changing callback payloads", async () => {
    const request = await buildPluginAgentToolSidecarRequest({
      appDataOptions: { appDataDir: "/tmp/metidos-test-app-data" },
      context: {
        contextKind: "threadTool",
        ownerUserId: null,
        projectId: 1,
        threadId: 2,
        worktreePath: "/repo",
      },
      params: { name: "Metidos" },
      registration: {
        directoryName: "alpha_plugin",
        filesReadAllowlist: [],
        filesReadDenylist: [],
        permissions: [],
        pluginId: "alpha_plugin",
        pluginPath: "/plugins/alpha_plugin",
        registration: {
          actionHandle: "tool:hello:action",
          description: "Say hello.",
          name: "hello",
          runtimeId: "alpha_plugin_hello",
          timeoutMs: 5_000,
          tool: "hello",
          validatePropsHandle: "tool:hello:validateProps",
        },
      },
      session: session(emptyRegistrations()),
    });

    expect(request).toEqual({
      directoryName: "alpha_plugin",
      operation: "tool.call",
      params: {
        actionHandle: "tool:hello:action",
        context: {
          contextKind: "threadTool",
          ownerUserId: null,
          projectId: 1,
          threadId: 2,
          settings: {
            missingRequiredKeys: [],
            values: {},
          },
          worktreePath: "/repo",
        },
        props: { name: "Metidos" },
        tool: "hello",
        validatePropsHandle: "tool:hello:validateProps",
      },
      pluginId: "alpha_plugin",
      timeoutMs: 5_000,
    });
  });

  it("selects Cron sessions and builds Cron callback requests", async () => {
    const registrations = {
      ...emptyRegistrations(),
      crons: [
        {
          actionHandle: "cron:refresh:action",
          fullKey: "alpha_plugin:refresh",
          key: "refresh",
          schedule: "*/5 * * * *",
          scope: "global" as const,
          timeoutMs: 7_000,
        },
      ],
    };
    const currentSession = session(registrations);

    expect(
      findPluginCronExecutionSession({
        fullKey: "alpha_plugin:refresh",
        sessions: [currentSession],
      }),
    ).toBe(currentSession);

    expect(
      (
        await buildPluginCronSidecarRequest({
          appDataOptions: {},
          fullKey: "alpha_plugin:refresh",
          session: currentSession,
        })
      ).request,
    ).toEqual({
      directoryName: "alpha_plugin",
      operation: "cron.run",
      params: {
        actionHandle: "cron:refresh:action",
        context: {
          contextKind: "cron",
          settings: { missingRequiredKeys: [], values: {} },
        },
        fullKey: "alpha_plugin:refresh",
        key: "refresh",
      },
      pluginId: "alpha_plugin",
      timeoutMs: 7_000,
    });

    await expect(
      buildPluginCronSidecarRequest({
        appDataOptions: {},
        fullKey: "alpha_plugin:refresh",
        session: null,
      }),
    ).rejects.toThrow("Tool call failed, plugin completely unavailable.");
  });

  it("builds GC requests and maps sidecar failures to PluginGcError codes", () => {
    const currentSession = session({
      ...emptyRegistrations(),
      gc: { actionHandle: "gc:action:1", timeoutMs: null },
    });

    expect(
      buildPluginGcSidecarRequest({
        directoryName: "alpha_plugin",
        session: currentSession,
      }).request,
    ).toEqual({
      directoryName: "alpha_plugin",
      operation: "metidos.gc",
      params: { actionHandle: "gc:action:1", virtualRoot: "~/" },
      timeoutMs: 9_000,
    });

    expect(() =>
      buildPluginGcSidecarRequest({
        directoryName: "alpha_plugin",
        session: session(emptyRegistrations()),
      }),
    ).toThrow("Plugin GC callback is not registered.");

    const mapped = mapPluginGcSidecarFailure(
      new PluginSidecarToolCallError({ code: "timeout" }),
    );
    expect(mapped.name).toBe("PluginGcError");
    expect(mapped.code).toBe("timeout");
  });

  it("localizes timeout, cancellation, and diagnostics decisions", () => {
    expect(normalizePluginCallbackTimeoutMs(0)).toBe(1_000);
    expect(normalizePluginCallbackTimeoutMs(900_000)).toBe(600_000);
    expect(
      pluginOperationTimeoutRejection({
        operation: "tool.call",
        timeoutMs: 1_000,
      }),
    ).toEqual({
      code: "timeout",
      diagnosticMessage: "Plugin operation tool.call timed out after 1000ms.",
    });
    expect(
      pluginOperationCancellationRejection({ operation: "cron.run" }),
    ).toEqual({
      code: "cancelled",
      diagnosticMessage:
        "Plugin operation cron.run was cancelled by the caller.",
    });

    const cancelled = createPluginPreDispatchCancellationError({
      operation: "metidos.gc",
      reason: new Error("admin stop"),
    });
    expect(cancelled.code).toBe("cancelled");
    expect(cancelled.message).toBe("Tool call failed.");
    expect(diagnosticCodeForUnknown(cancelled)).toBe("cancelled");
    expect(diagnosticMessageForUnknown(cancelled)).toBe(
      "Plugin operation metidos.gc was cancelled before dispatch.",
    );
  });
});
