import { describe, expect, it } from "bun:test";

import { PluginGcError } from "../plugin/data";
import type { RpcPluginInventory, RpcRequestContext } from "../rpc-schema";
import {
  createPluginAdminRpcHandlers,
  createUnavailablePluginGcRunner,
  type PluginAdminRpcHandlerDependencies,
  type PluginRuntimeReconciliationTrigger,
} from "./plugin-admin";

const requestContext = {} as RpcRequestContext;

type PluginInventory = Awaited<
  ReturnType<PluginAdminRpcHandlerDependencies["getPluginInventoryProcedure"]>
>;
type PluginSettingsSnapshot = Awaited<
  ReturnType<PluginAdminRpcHandlerDependencies["updatePluginSettingsProcedure"]>
>;
type PluginLifecycleResult = Awaited<
  ReturnType<
    PluginAdminRpcHandlerDependencies["runPluginLifecycleActionProcedure"]
  >
>;
type PluginAdminResult = Awaited<
  ReturnType<PluginAdminRpcHandlerDependencies["runPluginAdminActionProcedure"]>
>;

function createDefaultDependencies(
  overrides: Partial<PluginAdminRpcHandlerDependencies> = {},
): PluginAdminRpcHandlerDependencies {
  return {
    createPluginIngressLinkCodeProcedure: async () => ({}) as never,
    deletePluginIngressExternalBindingProcedure: async () => ({}) as never,
    getPluginInventoryProcedure: async () => ({ plugins: [] }) as never,
    getPluginSettingsProcedure: async () => ({}) as never,
    getPluginSidecarDiagnostics: async () => [],
    getPluginSecurityDiagnostics: async () =>
      ({ sqliteNativeSecurity: { available: true } }) as never,
    listPluginAccessGroupsProcedure: async () => [] as never,
    listPluginIngressExternalBindingsProcedure: async () => [] as never,
    listPluginIngressRouteConfigsProcedure: async () => [] as never,
    listPluginIngressSourcesProcedure: async () => [] as never,
    refreshPluginModelProviderRegistrationsIfDue: () => {},
    requireManageAppCapability: () => {},
    retryPlugin: async () => {},
    runPluginAdminActionProcedure: async () => ({}) as never,
    runPluginGc: async () => {},
    runPluginLifecycleActionProcedure: async () => ({}) as never,
    setPluginIngressExternalBindingEnabledProcedure: async () => ({}) as never,
    startApprovedPlugins: async () => {},
    startPluginRuntimeReconciliation: () => {},
    stopPluginRuntime: async () => {},
    updatePluginSettingsProcedure: async () => ({}) as never,
    upsertPluginIngressRouteConfigProcedure: async () => ({}) as never,
    ...overrides,
  };
}

describe("createPluginAdminRpcHandlers", () => {
  it("starts plugin runtime reconciliation after inventory refreshes", async () => {
    const inventory = { plugins: [{ directoryName: "example" }] } as unknown as
      | PluginInventory
      | RpcPluginInventory;
    const reconciliations: Array<{
      inventory?: RpcPluginInventory;
      trigger: PluginRuntimeReconciliationTrigger;
    }> = [];
    const handlers = createPluginAdminRpcHandlers(
      createDefaultDependencies({
        getPluginInventoryProcedure: async () => inventory as PluginInventory,
        startPluginRuntimeReconciliation: (trigger, nextInventory) => {
          reconciliations.push(
            nextInventory === undefined
              ? { trigger }
              : { inventory: nextInventory, trigger },
          );
        },
      }),
    );

    await expect(
      handlers.getPluginInventory(undefined, requestContext),
    ).resolves.toBe(inventory);
    expect(reconciliations).toEqual([
      { inventory, trigger: "plugin_inventory_refresh" },
    ]);
  });

  it("starts plugin runtime reconciliation after settings updates", async () => {
    const snapshot = { plugins: {} } as unknown as PluginSettingsSnapshot;
    const reconciliations: PluginRuntimeReconciliationTrigger[] = [];
    const handlers = createPluginAdminRpcHandlers(
      createDefaultDependencies({
        startPluginRuntimeReconciliation: (trigger) => {
          reconciliations.push(trigger);
        },
        updatePluginSettingsProcedure: async () => snapshot,
      }),
    );

    await expect(
      handlers.updatePluginSettings({} as never, requestContext),
    ).resolves.toBe(snapshot);
    expect(reconciliations).toEqual(["plugin_settings_update"]);
  });

  it("requires manage_app before returning plugin diagnostics", async () => {
    const capabilityChecks: RpcRequestContext[] = [];
    const sidecarDiagnostics = [{ directoryName: "example" }] as Awaited<
      ReturnType<
        PluginAdminRpcHandlerDependencies["getPluginSidecarDiagnostics"]
      >
    >;
    const securityDiagnostics = {
      sqliteNativeSecurity: { available: false },
    } as unknown as Awaited<
      ReturnType<
        PluginAdminRpcHandlerDependencies["getPluginSecurityDiagnostics"]
      >
    >;
    const handlers = createPluginAdminRpcHandlers(
      createDefaultDependencies({
        getPluginSecurityDiagnostics: async () => securityDiagnostics,
        getPluginSidecarDiagnostics: async () => sidecarDiagnostics,
        requireManageAppCapability: (context) => {
          capabilityChecks.push(context);
        },
      }),
    );

    await expect(
      handlers.getPluginSidecarDiagnostics({} as never, requestContext),
    ).resolves.toBe(sidecarDiagnostics);
    await expect(
      handlers.getPluginSecurityDiagnostics(undefined, requestContext),
    ).resolves.toBe(securityDiagnostics);
    expect(capabilityChecks).toEqual([requestContext, requestContext]);
  });

  it("starts approved plugins and refreshes model providers after enable or reapprove", async () => {
    const inventory = {
      plugins: [{ directoryName: "enabled" }],
    } as unknown as RpcPluginInventory;
    const calls: string[] = [];
    const handlers = createPluginAdminRpcHandlers(
      createDefaultDependencies({
        refreshPluginModelProviderRegistrationsIfDue: () => {
          calls.push("refresh-model-providers");
        },
        runPluginLifecycleActionProcedure: async () =>
          ({ inventory }) as PluginLifecycleResult,
        startApprovedPlugins: async (nextInventory) => {
          if (nextInventory === inventory) calls.push("start-approved");
        },
      }),
    );

    await handlers.runPluginLifecycleAction(
      { action: "enable", directoryName: "enabled" } as never,
      requestContext,
    );

    expect(calls).toEqual(["start-approved", "refresh-model-providers"]);
  });

  it("retries plugins and refreshes model providers after retry lifecycle actions", async () => {
    const calls: string[] = [];
    const result = {
      inventory: { plugins: [] },
    } as unknown as PluginLifecycleResult;
    const handlers = createPluginAdminRpcHandlers(
      createDefaultDependencies({
        refreshPluginModelProviderRegistrationsIfDue: () => {
          calls.push("refresh-model-providers");
        },
        retryPlugin: async (directoryName) => {
          calls.push(`retry:${directoryName}`);
        },
        runPluginLifecycleActionProcedure: async () => result,
      }),
    );

    await expect(
      handlers.runPluginLifecycleAction(
        { action: "retry", directoryName: "retry-me" } as never,
        requestContext,
      ),
    ).resolves.toBe(result);
    expect(calls).toEqual(["retry:retry-me", "refresh-model-providers"]);
  });

  it("passes plugin admin runtime hooks to the admin procedure", async () => {
    const calls: string[] = [];
    const result = { ok: true } as unknown as PluginAdminResult;
    const handlers = createPluginAdminRpcHandlers(
      createDefaultDependencies({
        runPluginAdminActionProcedure: async (_params, _context, hooks) => {
          await hooks.restartPluginRuntime?.("admin-plugin");
          await hooks.runPluginGc?.("admin-plugin");
          await hooks.stopPluginRuntime?.("admin-plugin");
          return result;
        },
        runPluginGc: async (directoryName) => {
          calls.push(`gc:${directoryName}`);
        },
        startApprovedPlugins: async () => {
          calls.push("restart");
        },
        stopPluginRuntime: async (directoryName, reason) => {
          calls.push(`stop:${directoryName}:${reason}`);
        },
      }),
    );

    await expect(
      handlers.runPluginAdminAction({} as never, requestContext),
    ).resolves.toBe(result);
    expect(calls).toEqual([
      "restart",
      "gc:admin-plugin",
      "stop:admin-plugin:plugin_reset",
    ]);
  });
});

describe("createUnavailablePluginGcRunner", () => {
  it("raises the plugin GC unavailable error used by plugin admin RPC hooks", async () => {
    await expect(createUnavailablePluginGcRunner()("missing")).rejects.toEqual(
      new PluginGcError({
        code: "plugin_gc_unavailable",
        message: "Plugin runtime manager is not available.",
      }),
    );
  });
});
