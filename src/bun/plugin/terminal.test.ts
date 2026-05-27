/**
 * @file src/bun/plugin/terminal.test.ts
 * @description Tests for Plugin System v1 permissioned terminal host API rules.
 */

import { describe, expect, it } from "bun:test";
import type { RpcTerminal } from "../rpc-schema";
import { PluginContextError, PluginPermissionError } from "./context";
import {
  executePluginTerminalOperation,
  type PluginTerminalHost,
} from "./terminal";

function fakeTerminal(overrides: Partial<RpcTerminal> = {}): RpcTerminal {
  return {
    command: "bun test",
    cols: 80,
    createdAt: "2026-04-28T00:00:00Z",
    createdFromThreadId: 42,
    cwd: "/repo",
    exitCode: null,
    exitSignal: null,
    projectId: 3,
    projectName: "metidos",
    rows: 24,
    status: "running",
    terminalId: "term-1",
    terminalIndex: 0,
    title: "Tests",
    updatedAt: "2026-04-28T00:00:00Z",
    worktreeFolder: "jt-ide",
    worktreePath: "/repo",
    ...overrides,
  };
}

function makeHost(calls: unknown[] = []): PluginTerminalHost {
  return {
    createTerminal(context, request) {
      calls.push({ context, operation: "terminal.create", request });
      return fakeTerminal({
        command: request.command ?? null,
        title: request.title ?? "Terminal",
      });
    },
    grepTerminal(ownerUserId, request) {
      calls.push({ operation: "terminal.grep", ownerUserId, request });
      return `grep:${request.pattern}`;
    },
    killTerminal(ownerUserId, request) {
      calls.push({ operation: "terminal.kill", ownerUserId, request });
    },
    readTerminal(ownerUserId, request) {
      calls.push({ operation: "terminal.read", ownerUserId, request });
      return `terminal:${request.terminalIndex}`;
    },
  };
}

const THREAD_CONTEXT = {
  contextKind: "threadTool",
  ownerUserId: 7,
  projectId: 3,
  threadId: 42,
  worktreePath: "/repo",
};

const NON_THREAD_CONTEXT_KINDS = [
  "gc",
  "init",
  "providerConfig",
  "providerExecution",
  "notificationProvider",
] as const;

describe("executePluginTerminalOperation", () => {
  it("routes terminal operations with matching permissions", async () => {
    const calls: unknown[] = [];
    const host = makeHost(calls);

    await expect(
      executePluginTerminalOperation({
        context: THREAD_CONTEXT,
        host,
        operation: "terminal.create",
        params: { command: "bun test", title: "Tests" },
        permissions: ["terminal:create", "unsafe"],
      }),
    ).resolves.toMatchObject({ command: "bun test", title: "Tests" });

    await expect(
      executePluginTerminalOperation({
        context: THREAD_CONTEXT,
        host,
        operation: "terminal.read",
        params: { lineCount: 10, lineOffset: 0, terminalIndex: 0 },
        permissions: ["terminal:read"],
      }),
    ).resolves.toBe("terminal:0");

    await expect(
      executePluginTerminalOperation({
        context: THREAD_CONTEXT,
        host,
        operation: "terminal.grep",
        params: { pattern: "ready", terminalIndex: 0 },
        permissions: ["terminal:read"],
      }),
    ).resolves.toBe("grep:ready");

    await expect(
      executePluginTerminalOperation({
        context: THREAD_CONTEXT,
        host,
        operation: "terminal.kill",
        params: { terminalIndex: 0 },
        permissions: ["terminal:kill", "unsafe"],
      }),
    ).resolves.toEqual({ success: true, terminalIndex: 0 });

    expect(calls).toEqual([
      {
        context: {
          ownerUserId: 7,
          projectId: 3,
          threadId: 42,
          worktreePath: "/repo",
        },
        operation: "terminal.create",
        request: { command: "bun test", dir: null, title: "Tests" },
      },
      {
        operation: "terminal.read",
        ownerUserId: 7,
        request: { lineCount: 10, lineOffset: 0, terminalIndex: 0 },
      },
      {
        operation: "terminal.grep",
        ownerUserId: 7,
        request: {
          ignoreCase: false,
          maxMatches: 20,
          pattern: "ready",
          terminalIndex: 0,
        },
      },
      {
        operation: "terminal.kill",
        ownerUserId: 7,
        request: { terminalIndex: 0 },
      },
    ]);
  });

  it("requires unsafe for terminal create and kill", async () => {
    const calls: unknown[] = [];
    const host = makeHost(calls);

    await expect(
      executePluginTerminalOperation({
        context: THREAD_CONTEXT,
        host,
        operation: "terminal.create",
        permissions: ["terminal:create"],
      }),
    ).rejects.toBeInstanceOf(PluginPermissionError);
    await expect(
      executePluginTerminalOperation({
        context: THREAD_CONTEXT,
        host,
        operation: "terminal.create",
        permissions: ["terminal:create"],
      }),
    ).rejects.toMatchObject({
      code: "plugin_unsafe_permission_required",
      permission: "unsafe",
    });

    await expect(
      executePluginTerminalOperation({
        context: THREAD_CONTEXT,
        host,
        operation: "terminal.kill",
        params: { terminalIndex: 0 },
        permissions: ["terminal:kill"],
      }),
    ).rejects.toBeInstanceOf(PluginPermissionError);
    await expect(
      executePluginTerminalOperation({
        context: THREAD_CONTEXT,
        host,
        operation: "terminal.kill",
        params: { terminalIndex: 0 },
        permissions: ["terminal:kill"],
      }),
    ).rejects.toMatchObject({
      code: "plugin_unsafe_permission_required",
      permission: "unsafe",
    });

    expect(calls).toEqual([]);
  });

  it("requires terminal:read for read and grep", async () => {
    const calls: unknown[] = [];
    const host = makeHost(calls);

    await expect(
      executePluginTerminalOperation({
        context: THREAD_CONTEXT,
        host,
        operation: "terminal.read",
        params: { terminalIndex: 0 },
        permissions: ["terminal:grep"],
      }),
    ).rejects.toBeInstanceOf(PluginPermissionError);
    await expect(
      executePluginTerminalOperation({
        context: THREAD_CONTEXT,
        host,
        operation: "terminal.read",
        params: { terminalIndex: 0 },
        permissions: ["terminal:grep"],
      }),
    ).rejects.toMatchObject({
      code: "plugin_permission_error",
      permission: "terminal:read",
    });

    await expect(
      executePluginTerminalOperation({
        context: THREAD_CONTEXT,
        host,
        operation: "terminal.grep",
        params: { pattern: "ready", terminalIndex: 0 },
        permissions: ["terminal:grep"],
      }),
    ).rejects.toBeInstanceOf(PluginPermissionError);
    await expect(
      executePluginTerminalOperation({
        context: THREAD_CONTEXT,
        host,
        operation: "terminal.grep",
        params: { pattern: "ready", terminalIndex: 0 },
        permissions: ["terminal:grep"],
      }),
    ).rejects.toMatchObject({
      code: "plugin_permission_error",
      permission: "terminal:read",
    });

    expect(calls).toEqual([]);
  });

  it("uses PluginContextError outside thread tool contexts", async () => {
    const calls: unknown[] = [];
    for (const contextKind of NON_THREAD_CONTEXT_KINDS) {
      await expect(
        executePluginTerminalOperation({
          context: { contextKind, ownerUserId: 7 },
          host: makeHost(calls),
          operation: "terminal.read",
          params: { terminalIndex: 0 },
          permissions: ["terminal:read"],
        }),
      ).rejects.toMatchObject({
        code: "plugin_context_error",
        contextKind,
        name: "PluginContextError",
      });
    }
    expect(calls).toEqual([]);
  });

  it("blocks terminal operations in cron contexts", async () => {
    const calls: unknown[] = [];

    await expect(
      executePluginTerminalOperation({
        context: { contextKind: "cron", ownerUserId: 7 },
        host: makeHost(calls),
        operation: "terminal.read",
        params: { terminalIndex: 0 },
        permissions: ["terminal:read"],
      }),
    ).rejects.toBeInstanceOf(PluginContextError);
    await expect(
      executePluginTerminalOperation({
        context: { contextKind: "cron", ownerUserId: 7 },
        host: makeHost(calls),
        operation: "terminal.read",
        params: { terminalIndex: 0 },
        permissions: ["terminal:read"],
      }),
    ).rejects.toMatchObject({
      code: "plugin_terminal_unavailable_in_cron",
      contextKind: "cron",
    });

    expect(calls).toEqual([]);
  });
});
