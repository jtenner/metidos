import type { RpcRequestHandlerMap } from "../rpc-transport";

export type ModelCatalogRpcHandlerMap = Pick<
  RpcRequestHandlerMap,
  "getModelCatalog"
>;

export type ModelCatalogRpcHandlerDependencies = {
  getModelCatalogProcedure: RpcRequestHandlerMap["getModelCatalog"];
  refreshPluginModelProviderRegistrationsIfDue: () => void;
  refreshPluginModelProvidersForCatalog: () => Promise<void> | void;
};

export function createModelCatalogRpcHandlers({
  getModelCatalogProcedure,
  refreshPluginModelProviderRegistrationsIfDue,
  refreshPluginModelProvidersForCatalog,
}: ModelCatalogRpcHandlerDependencies): ModelCatalogRpcHandlerMap {
  return {
    getModelCatalog: async (params, context) => {
      if (params?.refreshProviders) {
        await refreshPluginModelProvidersForCatalog();
      } else {
        refreshPluginModelProviderRegistrationsIfDue();
      }
      return getModelCatalogProcedure(params, context);
    },
  };
}
