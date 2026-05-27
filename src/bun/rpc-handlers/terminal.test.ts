import { describe, expect, it } from "bun:test";

import type { RpcRequestContext } from "../rpc-schema";
import {
  createTerminalRpcHandlers,
  type TerminalRpcHandlerDependencies,
} from "./terminal";

const requestContext = {} as RpcRequestContext;

function createDefaultDependencies(
  overrides: Partial<TerminalRpcHandlerDependencies> = {},
): TerminalRpcHandlerDependencies {
  return {
    closeTerminalProcedure: async () => ({ closed: true }) as never,
    createTerminalProcedure: async () => ({ id: 0 }) as never,
    listTerminalsProcedure: async () => [] as never,
    renameTerminalProcedure: async () => ({ id: 0, name: "renamed" }) as never,
    ...overrides,
  };
}

describe("createTerminalRpcHandlers", () => {
  it("delegates terminal procedures through the terminal handler map", async () => {
    const calls: string[] = [];
    const terminalList = [{ id: 1 }] as unknown as Awaited<
      ReturnType<TerminalRpcHandlerDependencies["listTerminalsProcedure"]>
    >;
    const createdTerminal = { id: 2 } as unknown as Awaited<
      ReturnType<TerminalRpcHandlerDependencies["createTerminalProcedure"]>
    >;
    const renamedTerminal = { id: 2, name: "shell" } as unknown as Awaited<
      ReturnType<TerminalRpcHandlerDependencies["renameTerminalProcedure"]>
    >;
    const closedTerminal = { id: 2 } as unknown as Awaited<
      ReturnType<TerminalRpcHandlerDependencies["closeTerminalProcedure"]>
    >;
    const handlers = createTerminalRpcHandlers(
      createDefaultDependencies({
        closeTerminalProcedure: async () => {
          calls.push("close");
          return closedTerminal;
        },
        createTerminalProcedure: async () => {
          calls.push("create");
          return createdTerminal;
        },
        listTerminalsProcedure: async () => {
          calls.push("list");
          return terminalList;
        },
        renameTerminalProcedure: async () => {
          calls.push("rename");
          return renamedTerminal;
        },
      }),
    );

    await expect(
      handlers.listTerminals(undefined, requestContext),
    ).resolves.toBe(terminalList);
    await expect(
      handlers.createTerminal({} as never, requestContext),
    ).resolves.toBe(createdTerminal);
    await expect(
      handlers.renameTerminal({} as never, requestContext),
    ).resolves.toBe(renamedTerminal);
    await expect(
      handlers.closeTerminal({} as never, requestContext),
    ).resolves.toBe(closedTerminal);
    expect(calls).toEqual(["list", "create", "rename", "close"]);
  });
});
