import type { RpcRequestHandlerMap } from "../rpc-transport";

export type AppBootstrapRpcHandlerMap = Pick<
  RpcRequestHandlerMap,
  "getAppBootstrap" | "logClientEvent"
>;

export type AppBootstrapRpcHandlerDependencies = {
  getAppBootstrapProcedure: RpcRequestHandlerMap["getAppBootstrap"];
  logClientEventProcedure: RpcRequestHandlerMap["logClientEvent"];
};

export function createAppBootstrapRpcHandlers({
  getAppBootstrapProcedure,
  logClientEventProcedure,
}: AppBootstrapRpcHandlerDependencies): AppBootstrapRpcHandlerMap {
  return {
    getAppBootstrap: (params, context) =>
      getAppBootstrapProcedure(params, context),
    logClientEvent: (params, context) =>
      logClientEventProcedure(params, context),
  };
}
