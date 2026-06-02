import { describe, expect, it } from "bun:test";

import { AuthServiceError } from "../auth/service";
import type { RpcRequestContext } from "../rpc-schema";
import {
  createTerminalRpcHandlers,
  type TerminalRpcHandlerDependencies,
} from "./terminal";

const requestContext = {
  auth: {
    isAdmin: false,
    sessionId: "session-1",
    userId: 1,
    username: "contributor",
  },
  priority: "default",
  signal: new AbortController().signal,
  timeoutMs: null,
} satisfies RpcRequestContext;

function createDependencies(
  overrides: Partial<TerminalRpcHandlerDependencies> = {},
): TerminalRpcHandlerDependencies {
  const rejectNonAdmin = async () => {
    throw new AuthServiceError(
      "admin_required",
      "Only the local app operator can manage terminals.",
    );
  };

  return {
    closeTerminalProcedure: rejectNonAdmin as never,
    createTerminalProcedure: rejectNonAdmin as never,
    listTerminalsProcedure: rejectNonAdmin as never,
    renameTerminalProcedure: rejectNonAdmin as never,
    ...overrides,
  };
}

describe("createTerminalRpcHandlers", () => {
  it("preserves procedure-level authorization failures for every terminal RPC seam", async () => {
    const handlers = createTerminalRpcHandlers(createDependencies());

    await expect(
      handlers.listTerminals(undefined, requestContext),
    ).rejects.toMatchObject({ code: "admin_required" });
    await expect(
      handlers.createTerminal({} as never, requestContext),
    ).rejects.toMatchObject({ code: "admin_required" });
    await expect(
      handlers.renameTerminal({} as never, requestContext),
    ).rejects.toMatchObject({ code: "admin_required" });
    await expect(
      handlers.closeTerminal({} as never, requestContext),
    ).rejects.toMatchObject({ code: "admin_required" });
  });

  it("forwards exact params and context to terminal procedures", async () => {
    const calls: Array<{ name: string; params: unknown; context: unknown }> =
      [];
    const procedure =
      (name: string) => async (params: unknown, context: unknown) => {
        calls.push({ name, params, context });
        return { ok: name };
      };
    const handlers = createTerminalRpcHandlers(
      createDependencies({
        closeTerminalProcedure: procedure("closeTerminal") as never,
        createTerminalProcedure: procedure("createTerminal") as never,
        listTerminalsProcedure: procedure("listTerminals") as never,
        renameTerminalProcedure: procedure("renameTerminal") as never,
      }),
    );

    const createParams = { projectId: 1, worktreePath: "/workspace" };
    const renameParams = { terminalId: "terminal-1", title: "Shell" };
    const closeParams = { terminalId: "terminal-1" };

    await handlers.listTerminals(undefined, requestContext);
    await handlers.createTerminal(createParams as never, requestContext);
    await handlers.renameTerminal(renameParams as never, requestContext);
    await handlers.closeTerminal(closeParams as never, requestContext);

    expect(calls).toEqual([
      { name: "listTerminals", params: undefined, context: requestContext },
      { name: "createTerminal", params: createParams, context: requestContext },
      { name: "renameTerminal", params: renameParams, context: requestContext },
      { name: "closeTerminal", params: closeParams, context: requestContext },
    ]);
  });
});
