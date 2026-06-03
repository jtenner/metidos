import { describe, expect, it } from "bun:test";
import type { RpcTerminal } from "../../bun/rpc-schema";
import {
  chatDraftStorageKey,
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
});
