import { describe, expect, it } from "bun:test";

import type { RpcRequestContext } from "../rpc-schema";
import {
  createThreadRpcHandlers,
  type ThreadRpcHandlerDependencies,
  type ThreadRpcHandlerMap,
} from "./thread";

const requestContext = { userId: 1 } as unknown as RpcRequestContext;
const requestParams = { threadId: 2 } as never;

type TestThreadHandler = (
  params: unknown,
  context: RpcRequestContext,
) => Promise<unknown>;

const threadMethods = [
  "approveThreadStartRequest",
  "createThread",
  "deleteThread",
  "discardEmptyThread",
  "getThread",
  "getThreadMessageContent",
  "listThreadStatuses",
  "listThreads",
  "markThreadErrorSeen",
  "renameThread",
  "requestThreadStart",
  "respondThreadExtensionUi",
  "sendThreadMessage",
  "setThreadPinned",
  "stopThreadTurn",
  "updateThreadAccess",
  "updateThreadExtensionEditor",
  "updateThreadMetadata",
  "updateThreadModel",
  "updateThreadReasoningEffort",
] as const satisfies readonly (keyof ThreadRpcHandlerMap)[];

function createDefaultDependencies(): ThreadRpcHandlerDependencies {
  return Object.fromEntries(
    threadMethods.map((method) => [
      `${method}Procedure`,
      async () => ({ method }) as never,
    ]),
  ) as unknown as ThreadRpcHandlerDependencies;
}

describe("createThreadRpcHandlers", () => {
  it("registers exactly the Thread RPC handler map", () => {
    const handlers = createThreadRpcHandlers(createDefaultDependencies());

    expect(Object.keys(handlers).sort()).toEqual([...threadMethods].sort());
  });

  it("delegates Thread handlers to their procedure dependencies", async () => {
    const calls: {
      context: RpcRequestContext;
      method: string;
      params: unknown;
    }[] = [];
    const resultsByMethod = new Map(
      threadMethods.map((method) => [method, { handledBy: method }]),
    );
    const dependencies = Object.fromEntries(
      threadMethods.map((method) => [
        `${method}Procedure`,
        async (params: unknown, context: RpcRequestContext) => {
          calls.push({ context, method, params });
          return resultsByMethod.get(method);
        },
      ]),
    ) as unknown as ThreadRpcHandlerDependencies;
    const handlers = createThreadRpcHandlers(dependencies);

    for (const method of threadMethods) {
      await expect(
        (handlers[method] as TestThreadHandler)(requestParams, requestContext),
      ).resolves.toBe(resultsByMethod.get(method));
    }

    expect(calls).toEqual(
      threadMethods.map((method) => ({
        context: requestContext,
        method,
        params: requestParams,
      })),
    );
  });
});
