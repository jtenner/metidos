import type { RpcRequestHandlerMap } from "../rpc-transport";

export type TerminalRpcHandlerMap = Pick<
  RpcRequestHandlerMap,
  "closeTerminal" | "createTerminal" | "listTerminals" | "renameTerminal"
>;

export type TerminalRpcHandlerDependencies = {
  closeTerminalProcedure: RpcRequestHandlerMap["closeTerminal"];
  createTerminalProcedure: RpcRequestHandlerMap["createTerminal"];
  listTerminalsProcedure: RpcRequestHandlerMap["listTerminals"];
  renameTerminalProcedure: RpcRequestHandlerMap["renameTerminal"];
};

export function createTerminalRpcHandlers({
  closeTerminalProcedure,
  createTerminalProcedure,
  listTerminalsProcedure,
  renameTerminalProcedure,
}: TerminalRpcHandlerDependencies): TerminalRpcHandlerMap {
  return {
    listTerminals: (params, context) => listTerminalsProcedure(params, context),
    createTerminal: (params, context) =>
      createTerminalProcedure(params, context),
    renameTerminal: (params, context) =>
      renameTerminalProcedure(params, context),
    closeTerminal: (params, context) => closeTerminalProcedure(params, context),
  };
}
