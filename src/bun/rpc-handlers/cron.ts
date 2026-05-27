import type { RpcRequestHandlerMap } from "../rpc-transport";

export type CronRpcHandlerMap = Pick<
  RpcRequestHandlerMap,
  "newCron" | "updateCron" | "listCrons" | "runCronNow"
>;

export type CronRpcHandlerDependencies = {
  listCronsProcedure: RpcRequestHandlerMap["listCrons"];
  newCronProcedure: RpcRequestHandlerMap["newCron"];
  runCronNowProcedure: RpcRequestHandlerMap["runCronNow"];
  syncCronSchedulerCron: (cronId: number) => void;
  updateCronProcedure: RpcRequestHandlerMap["updateCron"];
};

export function createCronRpcHandlers({
  listCronsProcedure,
  newCronProcedure,
  runCronNowProcedure,
  syncCronSchedulerCron,
  updateCronProcedure,
}: CronRpcHandlerDependencies): CronRpcHandlerMap {
  return {
    newCron: async (params, context) => {
      const cron = await newCronProcedure(params, context);
      syncCronSchedulerCron(cron.id);
      return cron;
    },
    updateCron: async (params, context) => {
      const cron = await updateCronProcedure(params, context);
      syncCronSchedulerCron(cron.id);
      return cron;
    },
    listCrons: (params, context) => listCronsProcedure(params, context),
    runCronNow: (params, context) => runCronNowProcedure(params, context),
  };
}
