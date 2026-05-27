import { describe, expect, it } from "bun:test";

import type { RpcRequestContext } from "../rpc-schema";
import { createCronRpcHandlers, type CronRpcHandlerDependencies } from "./cron";

const requestContext = {} as RpcRequestContext;

function createDefaultDependencies(
  overrides: Partial<CronRpcHandlerDependencies> = {},
): CronRpcHandlerDependencies {
  return {
    listCronsProcedure: async () => [] as never,
    newCronProcedure: async () => ({ id: 0 }) as never,
    runCronNowProcedure: async () => ({ success: true }) as never,
    syncCronSchedulerCron: () => {},
    updateCronProcedure: async () => ({ id: 0 }) as never,
    ...overrides,
  };
}

describe("createCronRpcHandlers", () => {
  it("syncs the cron scheduler after creating a cron job", async () => {
    const syncedCronIds: number[] = [];
    const cron = { id: 41 } as Awaited<
      ReturnType<CronRpcHandlerDependencies["newCronProcedure"]>
    >;
    const handlers = createCronRpcHandlers(
      createDefaultDependencies({
        newCronProcedure: async () => cron,
        syncCronSchedulerCron: (cronId) => {
          syncedCronIds.push(cronId);
        },
      }),
    );

    await expect(handlers.newCron({} as never, requestContext)).resolves.toBe(
      cron,
    );
    expect(syncedCronIds).toEqual([41]);
  });

  it("syncs the cron scheduler after updating a cron job", async () => {
    const syncedCronIds: number[] = [];
    const cron = { id: 42 } as Awaited<
      ReturnType<CronRpcHandlerDependencies["updateCronProcedure"]>
    >;
    const handlers = createCronRpcHandlers(
      createDefaultDependencies({
        syncCronSchedulerCron: (cronId) => {
          syncedCronIds.push(cronId);
        },
        updateCronProcedure: async () => cron,
      }),
    );

    await expect(
      handlers.updateCron({} as never, requestContext),
    ).resolves.toBe(cron);
    expect(syncedCronIds).toEqual([42]);
  });

  it("delegates cron reads and manual runs without scheduler sync", async () => {
    const syncedCronIds: number[] = [];
    const cronList = [{ id: 43 }] as Awaited<
      ReturnType<CronRpcHandlerDependencies["listCronsProcedure"]>
    >;
    const runResult = { success: true, cronJobId: 44, threadId: 45 } as Awaited<
      ReturnType<CronRpcHandlerDependencies["runCronNowProcedure"]>
    >;
    const handlers = createCronRpcHandlers(
      createDefaultDependencies({
        listCronsProcedure: async () => cronList,
        runCronNowProcedure: async () => runResult,
        syncCronSchedulerCron: (cronId) => {
          syncedCronIds.push(cronId);
        },
      }),
    );

    await expect(handlers.listCrons(undefined, requestContext)).resolves.toBe(
      cronList,
    );
    await expect(
      handlers.runCronNow({} as never, requestContext),
    ).resolves.toBe(runResult);
    expect(syncedCronIds).toEqual([]);
  });
});
