import { describe, expect, it } from "bun:test";

import type { RpcRequestContext } from "../rpc-schema";
import {
  createWorkContextRpcHandlers,
  type WorkContextRpcHandlerDependencies,
  type WorkContextRpcHandlerMap,
} from "./work-context";

const requestContext = { userId: 1 } as unknown as RpcRequestContext;
const requestParams = { projectId: 2, worktreePath: "/tmp/project" } as never;

type TestWorkContextHandler = (
  params: unknown,
  context: RpcRequestContext,
) => Promise<unknown>;

const workContextMethods = [
  "closeProject",
  "closeWorktree",
  "createWorktree",
  "deleteProject",
  "focusContext",
  "getHomeDirectory",
  "getWorktreeGitCommitDiff",
  "getWorktreeSnapshot",
  "listDirectorySuggestions",
  "listProjectFavicons",
  "listProjectSkills",
  "listProjectWorktrees",
  "listProjects",
  "listWorktreeGitHistory",
  "openProject",
  "openProjectsBatch",
  "openWorktree",
  "openWorktreesBatch",
  "readWorktreeFileContentPage",
  "readWorktreeFileDiff",
  "setActiveWorktree",
  "setWorktreePinned",
] as const satisfies readonly (keyof WorkContextRpcHandlerMap)[];

function createDefaultDependencies(): WorkContextRpcHandlerDependencies {
  return Object.fromEntries(
    workContextMethods.map((method) => [
      `${method}Procedure`,
      async () => ({ method }) as never,
    ]),
  ) as unknown as WorkContextRpcHandlerDependencies;
}

describe("createWorkContextRpcHandlers", () => {
  it("registers exactly the Work Context RPC handler map", () => {
    const handlers = createWorkContextRpcHandlers(createDefaultDependencies());

    expect(Object.keys(handlers).sort()).toEqual(
      [...workContextMethods].sort(),
    );
  });

  it("delegates Work Context handlers to their procedure dependencies", async () => {
    const calls: {
      context: RpcRequestContext;
      method: string;
      params: unknown;
    }[] = [];
    const resultsByMethod = new Map(
      workContextMethods.map((method) => [method, { handledBy: method }]),
    );
    const dependencies = Object.fromEntries(
      workContextMethods.map((method) => [
        `${method}Procedure`,
        async (params: unknown, context: RpcRequestContext) => {
          calls.push({ context, method, params });
          return resultsByMethod.get(method);
        },
      ]),
    ) as unknown as WorkContextRpcHandlerDependencies;
    dependencies.getHomeDirectoryProcedure = async (context) => {
      calls.push({ context, method: "getHomeDirectory", params: undefined });
      return resultsByMethod.get("getHomeDirectory") as never;
    };
    const handlers = createWorkContextRpcHandlers(dependencies);

    for (const method of workContextMethods) {
      await expect(
        (handlers[method] as TestWorkContextHandler)(
          requestParams,
          requestContext,
        ),
      ).resolves.toBe(resultsByMethod.get(method));
    }

    expect(calls).toEqual(
      workContextMethods.map((method) => ({
        context: requestContext,
        method,
        params: method === "getHomeDirectory" ? undefined : requestParams,
      })),
    );
  });
});
