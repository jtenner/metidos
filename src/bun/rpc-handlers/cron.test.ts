import { describe, expect, it } from "bun:test";

import type { RpcRequestContext } from "../rpc-schema";
import { createCronRpcHandlers, type CronRpcHandlerDependencies } from "./cron";

const requestContext = {} as RpcRequestContext;

function createRegularUserContext(): RpcRequestContext {
  return {
    auth: {
      isAdmin: false,
      sessionId: "cron-rpc-regular-session",
      userId: 11,
      username: "cron-rpc-regular-user",
    },
    priority: "default",
    signal: new AbortController().signal,
    timeoutMs: null,
  };
}

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

  it("passes regular-user RPC context into cron authorization procedures", async () => {
    const context = createRegularUserContext();
    const calls: { name: string; context: RpcRequestContext }[] = [];
    const handlers = createCronRpcHandlers(
      createDefaultDependencies({
        listCronsProcedure: async (_params, procedureContext) => {
          calls.push({ name: "list", context: procedureContext });
          return [] as never;
        },
        runCronNowProcedure: async (_params, procedureContext) => {
          calls.push({ name: "run-now", context: procedureContext });
          return { success: true } as never;
        },
        updateCronProcedure: async (_params, procedureContext) => {
          calls.push({ name: "update", context: procedureContext });
          return { id: 51 } as never;
        },
      }),
    );

    await handlers.listCrons(undefined, context);
    await handlers.updateCron({ cronJobId: 51, title: "User rename" }, context);
    await handlers.runCronNow({ cronJobId: 51 }, context);

    expect(calls).toEqual([
      { name: "list", context },
      { name: "update", context },
      { name: "run-now", context },
    ]);
  });

  it("passes delete requests through updateCron with caller context", async () => {
    const context = createRegularUserContext();
    const updateCalls: { params: unknown; context: RpcRequestContext }[] = [];
    const handlers = createCronRpcHandlers(
      createDefaultDependencies({
        updateCronProcedure: async (params, procedureContext) => {
          updateCalls.push({ params, context: procedureContext });
          return { id: 52 } as never;
        },
      }),
    );

    await handlers.updateCron({ cronJobId: 52, deleted: true }, context);

    expect(updateCalls).toEqual([
      { params: { cronJobId: 52, deleted: true }, context },
    ]);
  });
});
