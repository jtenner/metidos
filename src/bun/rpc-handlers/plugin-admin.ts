import { PluginGcError } from "../plugin/data";
import type { PluginAdminRuntimeHooks } from "../plugin/lifecycle";
import type { RpcPluginInventory, RpcRequestContext } from "../rpc-schema";
import type { RpcRequestHandlerMap } from "../rpc-transport";

export type PluginRuntimeReconciliationTrigger =
  | "app_startup"
  | "plugin_inventory_refresh"
  | "plugin_settings_update";

export type PluginAdminRpcHandlerMap = Pick<
  RpcRequestHandlerMap,
  | "createPluginIngressLinkCode"
  | "deletePluginIngressExternalBinding"
  | "getPluginInventory"
  | "getPluginSecurityDiagnostics"
  | "getPluginSettings"
  | "getPluginSidecarDiagnostics"
  | "listPluginAccessGroups"
  | "listPluginIngressExternalBindings"
  | "listPluginIngressRouteConfigs"
  | "listPluginIngressSources"
  | "runPluginAdminAction"
  | "runPluginLifecycleAction"
  | "setPluginIngressExternalBindingEnabled"
  | "updatePluginSettings"
  | "upsertPluginIngressRouteConfig"
>;

type PluginSidecarDiagnosticsParams = Parameters<
  RpcRequestHandlerMap["getPluginSidecarDiagnostics"]
>[0];

type PluginSecurityDiagnostics = Awaited<
  ReturnType<RpcRequestHandlerMap["getPluginSecurityDiagnostics"]>
>;

type PluginSidecarDiagnostics = Awaited<
  ReturnType<RpcRequestHandlerMap["getPluginSidecarDiagnostics"]>
>;

export type PluginAdminRpcHandlerDependencies = {
  createPluginIngressLinkCodeProcedure: RpcRequestHandlerMap["createPluginIngressLinkCode"];
  deletePluginIngressExternalBindingProcedure: RpcRequestHandlerMap["deletePluginIngressExternalBinding"];
  getPluginInventoryProcedure: RpcRequestHandlerMap["getPluginInventory"];
  getPluginSettingsProcedure: RpcRequestHandlerMap["getPluginSettings"];
  getPluginSidecarDiagnostics: (
    params: PluginSidecarDiagnosticsParams,
  ) => PluginSidecarDiagnostics | Promise<PluginSidecarDiagnostics>;
  getPluginSecurityDiagnostics: () =>
    | PluginSecurityDiagnostics
    | Promise<PluginSecurityDiagnostics>;
  listPluginAccessGroupsProcedure: RpcRequestHandlerMap["listPluginAccessGroups"];
  listPluginIngressExternalBindingsProcedure: RpcRequestHandlerMap["listPluginIngressExternalBindings"];
  listPluginIngressRouteConfigsProcedure: RpcRequestHandlerMap["listPluginIngressRouteConfigs"];
  listPluginIngressSourcesProcedure: RpcRequestHandlerMap["listPluginIngressSources"];
  refreshPluginModelProviderRegistrationsIfDue: () => void;
  requireManageAppCapability: (context: RpcRequestContext) => void;
  retryPlugin: (directoryName: string) => Promise<void> | void;
  runPluginAdminActionProcedure: (
    params: Parameters<RpcRequestHandlerMap["runPluginAdminAction"]>[0],
    context: RpcRequestContext,
    runtimeHooks: PluginAdminRuntimeHooks,
  ) => ReturnType<RpcRequestHandlerMap["runPluginAdminAction"]>;
  runPluginGc: (directoryName: string) => Promise<void> | void;
  runPluginLifecycleActionProcedure: RpcRequestHandlerMap["runPluginLifecycleAction"];
  setPluginIngressExternalBindingEnabledProcedure: RpcRequestHandlerMap["setPluginIngressExternalBindingEnabled"];
  startApprovedPlugins: (
    inventory?: RpcPluginInventory,
  ) => Promise<void> | void;
  startPluginRuntimeReconciliation: (
    trigger: PluginRuntimeReconciliationTrigger,
    inventory?: RpcPluginInventory,
  ) => void;
  stopPluginRuntime: (
    directoryName: string,
    reason:
      | "host_shutdown"
      | "plugin_disabled"
      | "plugin_reset"
      | "plugin_retry"
      | undefined,
  ) => Promise<void> | void;
  updatePluginSettingsProcedure: RpcRequestHandlerMap["updatePluginSettings"];
  upsertPluginIngressRouteConfigProcedure: RpcRequestHandlerMap["upsertPluginIngressRouteConfig"];
};

export function createPluginAdminRpcHandlers({
  createPluginIngressLinkCodeProcedure,
  deletePluginIngressExternalBindingProcedure,
  getPluginInventoryProcedure,
  getPluginSettingsProcedure,
  getPluginSidecarDiagnostics,
  getPluginSecurityDiagnostics,
  listPluginAccessGroupsProcedure,
  listPluginIngressExternalBindingsProcedure,
  listPluginIngressRouteConfigsProcedure,
  listPluginIngressSourcesProcedure,
  refreshPluginModelProviderRegistrationsIfDue,
  requireManageAppCapability,
  retryPlugin,
  runPluginAdminActionProcedure,
  runPluginGc,
  runPluginLifecycleActionProcedure,
  setPluginIngressExternalBindingEnabledProcedure,
  startApprovedPlugins,
  startPluginRuntimeReconciliation,
  stopPluginRuntime,
  updatePluginSettingsProcedure,
  upsertPluginIngressRouteConfigProcedure,
}: PluginAdminRpcHandlerDependencies): PluginAdminRpcHandlerMap {
  return {
    getPluginInventory: async (params, context) => {
      const inventory = await getPluginInventoryProcedure(params, context);
      startPluginRuntimeReconciliation("plugin_inventory_refresh", inventory);
      return inventory;
    },
    getPluginSettings: (params, context) =>
      getPluginSettingsProcedure(params, context),
    createPluginIngressLinkCode: (params, context) =>
      createPluginIngressLinkCodeProcedure(params, context),
    listPluginIngressSources: (params, context) =>
      listPluginIngressSourcesProcedure(params, context),
    listPluginIngressExternalBindings: (params, context) =>
      listPluginIngressExternalBindingsProcedure(params, context),
    listPluginIngressRouteConfigs: (params, context) =>
      listPluginIngressRouteConfigsProcedure(params, context),
    upsertPluginIngressRouteConfig: (params, context) =>
      upsertPluginIngressRouteConfigProcedure(params, context),
    setPluginIngressExternalBindingEnabled: (params, context) =>
      setPluginIngressExternalBindingEnabledProcedure(params, context),
    deletePluginIngressExternalBinding: (params, context) =>
      deletePluginIngressExternalBindingProcedure(params, context),
    listPluginAccessGroups: (params, context) =>
      listPluginAccessGroupsProcedure(params, context),
    updatePluginSettings: async (params, context) => {
      const snapshot = await updatePluginSettingsProcedure(params, context);
      startPluginRuntimeReconciliation("plugin_settings_update");
      return snapshot;
    },
    getPluginSidecarDiagnostics: async (params, context) => {
      requireManageAppCapability(context);
      return await getPluginSidecarDiagnostics(params ?? undefined);
    },
    getPluginSecurityDiagnostics: async (_params, context) => {
      requireManageAppCapability(context);
      return await getPluginSecurityDiagnostics();
    },
    runPluginLifecycleAction: async (params, context) => {
      const result = await runPluginLifecycleActionProcedure(params, context);
      if (params.action === "enable" || params.action === "reapprove") {
        await startApprovedPlugins(result.inventory);
        refreshPluginModelProviderRegistrationsIfDue();
      } else if (params.action === "retry") {
        await retryPlugin(params.directoryName);
        refreshPluginModelProviderRegistrationsIfDue();
      }
      return result;
    },
    runPluginAdminAction: (params, context) =>
      runPluginAdminActionProcedure(params, context, {
        restartPluginRuntime: async () => {
          await startApprovedPlugins();
        },
        runPluginGc: async (directoryName) => {
          await runPluginGc(directoryName);
        },
        stopPluginRuntime: async (directoryName) => {
          await stopPluginRuntime(directoryName, "plugin_reset");
        },
      }),
  };
}

export function createUnavailablePluginGcRunner(): (
  directoryName: string,
) => Promise<void> {
  return async () => {
    throw new PluginGcError({
      code: "plugin_gc_unavailable",
      message: "Plugin runtime manager is not available.",
    });
  };
}
