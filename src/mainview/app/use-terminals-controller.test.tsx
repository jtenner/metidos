import { describe, expect, it } from "bun:test";
import type { ProjectProcedures, RpcTerminal } from "../../bun/rpc-schema";
import {
  buildCreateTerminalRequest,
  chatDraftStorageKey,
  loadVisibleTerminalsForUser,
  resolveInteractionModeAfterTerminalRefresh,
  resolveSelectedTerminalId,
} from "./use-terminals-controller";

function terminal(terminalId: string): RpcTerminal {
  return {
    command: null,
    createdAt: "2026-06-03T00:00:00.000Z",
    createdFromThreadId: null,
    cwd: "/repo",
    projectId: 7,
    projectName: "Demo",
    status: "running",
    terminalId,
    title: `Terminal ${terminalId}`,
    updatedAt: "2026-06-03T00:00:00.000Z",
    worktreeFolder: "repo",
    worktreePath: "/repo",
  } as RpcTerminal;
}

describe("terminal controller helpers", () => {
  it("uses per-thread chat draft storage keys", () => {
    expect(chatDraftStorageKey(42)).toBe("metidos:thread:42:chat-draft");
  });

  it("keeps a selected terminal when it is still present", () => {
    expect(
      resolveSelectedTerminalId("terminal-a", [
        terminal("terminal-a"),
        terminal("terminal-b"),
      ]),
    ).toBe("terminal-a");
  });

  it("moves stale terminal selection to the newest listed terminal", () => {
    expect(
      resolveSelectedTerminalId("missing-terminal", [
        terminal("terminal-a"),
        terminal("terminal-b"),
      ]),
    ).toBe("terminal-b");
  });

  it("clears terminal selection when no terminals remain", () => {
    expect(resolveSelectedTerminalId("missing-terminal", [])).toBeNull();
  });

  it("hides terminal lists from non-admin users without calling ProjectProcedures", async () => {
    let listCalls = 0;
    const listTerminals: ProjectProcedures["listTerminals"] = async () => {
      listCalls += 1;
      return [terminal("terminal-a")];
    };

    await expect(
      loadVisibleTerminalsForUser({ isAdmin: false, listTerminals }),
    ).resolves.toEqual([]);
    expect(listCalls).toBe(0);
  });

  it("loads terminal lists for admin users through ProjectProcedures", async () => {
    let listCalls = 0;
    const terminals = [terminal("terminal-a")];
    const listTerminals: ProjectProcedures["listTerminals"] = async (
      params,
      options,
    ) => {
      listCalls += 1;
      expect(params).toBeUndefined();
      expect(options?.priority).toBe("background");
      return terminals;
    };

    await expect(
      loadVisibleTerminalsForUser({ isAdmin: true, listTerminals }),
    ).resolves.toEqual(terminals);
    expect(listCalls).toBe(1);
  });

  it("keeps terminal mode after refresh when fake terminal sessions remain", () => {
    expect(
      resolveInteractionModeAfterTerminalRefresh({
        interactionMode: "terminal",
        terminals: [terminal("terminal-a")],
      }),
    ).toBe("terminal");
  });

  it("returns to chat mode after refresh when no terminal sessions remain", () => {
    expect(
      resolveInteractionModeAfterTerminalRefresh({
        interactionMode: "terminal",
        terminals: [],
      }),
    ).toBe("chat");
  });

  it("blocks terminal create requests for non-admin users", () => {
    expect(
      buildCreateTerminalRequest({
        activeProjectId: 7,
        activeThreadId: 42,
        activeWorktreePath: "/repo",
        isAdmin: false,
        options: { command: "pwd", title: "Blocked" },
        selectedTerminalId: null,
        terminals: [terminal("terminal-a")],
      }),
    ).toBeNull();
  });

  it("builds terminal create requests for admin users with fake terminal payloads", () => {
    expect(
      buildCreateTerminalRequest({
        activeProjectId: 7,
        activeThreadId: 42,
        activeWorktreePath: "/repo",
        isAdmin: true,
        options: { command: "pwd", title: "Demo shell" },
        selectedTerminalId: null,
        terminals: [],
      }),
    ).toEqual({
      command: "pwd",
      createdFromThreadId: 42,
      projectId: 7,
      title: "Demo shell",
      worktreePath: "/repo",
    });
  });
});
