import type { RpcRequestHandlerMap } from "../rpc-transport";

export type MemoryRpcHandlerMap = Pick<
  RpcRequestHandlerMap,
  | "searchMemoryFacts"
  | "getMemoryFactDetail"
  | "getMemoryEvidenceDetail"
  | "listMemoryEvidence"
  | "listMemoryRecallEvents"
  | "listMemoryWriteEvents"
  | "getMemoryStats"
  | "eraseMemory"
>;

export type MemoryRpcHandlerDependencies = {
  searchMemoryFactsProcedure: RpcRequestHandlerMap["searchMemoryFacts"];
  getMemoryFactDetailProcedure: RpcRequestHandlerMap["getMemoryFactDetail"];
  getMemoryEvidenceDetailProcedure: RpcRequestHandlerMap["getMemoryEvidenceDetail"];
  listMemoryEvidenceProcedure: RpcRequestHandlerMap["listMemoryEvidence"];
  listMemoryRecallEventsProcedure: RpcRequestHandlerMap["listMemoryRecallEvents"];
  listMemoryWriteEventsProcedure: RpcRequestHandlerMap["listMemoryWriteEvents"];
  getMemoryStatsProcedure: RpcRequestHandlerMap["getMemoryStats"];
  eraseMemory: RpcRequestHandlerMap["eraseMemory"];
};

export function createMemoryRpcHandlers(
  dependencies: MemoryRpcHandlerDependencies,
): MemoryRpcHandlerMap {
  return {
    searchMemoryFacts: (params, context) =>
      dependencies.searchMemoryFactsProcedure(params, context),
    getMemoryFactDetail: (params, context) =>
      dependencies.getMemoryFactDetailProcedure(params, context),
    getMemoryEvidenceDetail: (params, context) =>
      dependencies.getMemoryEvidenceDetailProcedure(params, context),
    listMemoryEvidence: (params, context) =>
      dependencies.listMemoryEvidenceProcedure(params, context),
    listMemoryRecallEvents: (params, context) =>
      dependencies.listMemoryRecallEventsProcedure(params, context),
    listMemoryWriteEvents: (params, context) =>
      dependencies.listMemoryWriteEventsProcedure(params, context),
    getMemoryStats: (params, context) =>
      dependencies.getMemoryStatsProcedure(params, context),
    eraseMemory: (params, context) => dependencies.eraseMemory(params, context),
  };
}
