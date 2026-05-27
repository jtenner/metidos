import type { RpcRequestHandlerMap } from "../rpc-transport";

export type ThreadRpcHandlerMap = Pick<
  RpcRequestHandlerMap,
  | "approveThreadStartRequest"
  | "createThread"
  | "deleteThread"
  | "discardEmptyThread"
  | "getThread"
  | "getThreadMessageContent"
  | "listThreadStatuses"
  | "listThreads"
  | "markThreadErrorSeen"
  | "renameThread"
  | "requestThreadStart"
  | "respondThreadExtensionUi"
  | "sendThreadMessage"
  | "setThreadPinned"
  | "stopThreadTurn"
  | "updateThreadAccess"
  | "updateThreadExtensionEditor"
  | "updateThreadMetadata"
  | "updateThreadModel"
  | "updateThreadReasoningEffort"
>;

export type ThreadRpcHandlerDependencies = {
  [Method in keyof ThreadRpcHandlerMap as `${Method}Procedure`]: ThreadRpcHandlerMap[Method];
};

export function createThreadRpcHandlers({
  approveThreadStartRequestProcedure,
  createThreadProcedure,
  deleteThreadProcedure,
  discardEmptyThreadProcedure,
  getThreadMessageContentProcedure,
  getThreadProcedure,
  listThreadStatusesProcedure,
  listThreadsProcedure,
  markThreadErrorSeenProcedure,
  renameThreadProcedure,
  requestThreadStartProcedure,
  respondThreadExtensionUiProcedure,
  sendThreadMessageProcedure,
  setThreadPinnedProcedure,
  stopThreadTurnProcedure,
  updateThreadAccessProcedure,
  updateThreadExtensionEditorProcedure,
  updateThreadMetadataProcedure,
  updateThreadModelProcedure,
  updateThreadReasoningEffortProcedure,
}: ThreadRpcHandlerDependencies): ThreadRpcHandlerMap {
  return {
    listThreads: (params, context) => listThreadsProcedure(params, context),
    listThreadStatuses: (params, context) =>
      listThreadStatusesProcedure(params, context),
    createThread: (params, context) => createThreadProcedure(params, context),
    requestThreadStart: (params, context) =>
      requestThreadStartProcedure(params, context),
    approveThreadStartRequest: (params, context) =>
      approveThreadStartRequestProcedure(params, context),
    getThread: (params, context) => getThreadProcedure(params, context),
    getThreadMessageContent: (params, context) =>
      getThreadMessageContentProcedure(params, context),
    markThreadErrorSeen: (params, context) =>
      markThreadErrorSeenProcedure(params, context),
    sendThreadMessage: (params, context) =>
      sendThreadMessageProcedure(params, context),
    stopThreadTurn: (params, context) =>
      stopThreadTurnProcedure(params, context),
    updateThreadMetadata: (params, context) =>
      updateThreadMetadataProcedure(params, context),
    updateThreadAccess: (params, context) =>
      updateThreadAccessProcedure(params, context),
    renameThread: (params, context) => renameThreadProcedure(params, context),
    setThreadPinned: (params, context) =>
      setThreadPinnedProcedure(params, context),
    updateThreadModel: (params, context) =>
      updateThreadModelProcedure(params, context),
    updateThreadReasoningEffort: (params, context) =>
      updateThreadReasoningEffortProcedure(params, context),
    deleteThread: (params, context) => deleteThreadProcedure(params, context),
    discardEmptyThread: (params, context) =>
      discardEmptyThreadProcedure(params, context),
    respondThreadExtensionUi: (params, context) =>
      respondThreadExtensionUiProcedure(params, context),
    updateThreadExtensionEditor: (params, context) =>
      updateThreadExtensionEditorProcedure(params, context),
  };
}
