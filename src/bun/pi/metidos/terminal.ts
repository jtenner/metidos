/**
 * @file src/bun/pi/metidos/terminal.ts
 * @description Pi-native Metidos terminal tools.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { RpcTerminal } from "../../rpc-schema";
import { pathIsWithinRoot } from "../../project-procedures/shared";
import {
  canonicalPath,
  type PiMetidosToolHost,
  type PiMetidosToolScope,
  textToolResult,
  withMetidosToolTelemetry,
} from "./shared";

const NewTerminalToolParameters = Type.Object({
  command: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional command to run in the terminal. Omit or pass null to open an idle shell.",
      }),
      Type.Null(),
    ]),
  ),
  dir: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional working directory. Relative paths resolve inside the current workspace. Omit or pass null to use the current worktree root.",
      }),
      Type.Null(),
    ]),
  ),
  title: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional terminal title. Omit or pass null to let Metidos choose one.",
      }),
      Type.Null(),
    ]),
  ),
});

const TerminalIndexParameters = Type.Object({
  terminalIndex: Type.Integer({
    description: "Required terminal index from list_terminals.",
    minimum: 0,
  }),
});

const ViewTerminalParameters = Type.Object({
  lineCount: Type.Optional(
    Type.Integer({
      description:
        "Optional number of retained output lines to return, 1-1000. Omit for the default.",
      minimum: 1,
      maximum: 1000,
    }),
  ),
  lineOffset: Type.Optional(
    Type.Integer({
      description:
        "Optional zero-based retained-output line offset. Omit to start at the latest/default view.",
      minimum: 0,
    }),
  ),
  terminalIndex: Type.Integer({
    description: "Required terminal index from list_terminals.",
    minimum: 0,
  }),
});

const GrepTerminalParameters = Type.Object({
  ignoreCase: Type.Optional(
    Type.Boolean({
      description: "Optional case-insensitive search flag. Omit for false.",
    }),
  ),
  maxMatches: Type.Optional(
    Type.Integer({
      description: "Optional maximum number of matches to return, 1-100.",
      minimum: 1,
      maximum: 100,
    }),
  ),
  pattern: Type.String({
    description:
      "Required search pattern, interpreted by the terminal grep host.",
    minLength: 1,
    maxLength: 256,
  }),
  terminalIndex: Type.Integer({
    description: "Required terminal index from list_terminals.",
    minimum: 0,
  }),
});

function assertTerminalToolsAllowed(scope: PiMetidosToolScope): void {
  if (scope.unsafeModeEnabled !== true) {
    throw new Error(
      "Terminal tools require Unsafe mode and Metidos access for the current thread.",
    );
  }
}

function terminalPayload(terminal: RpcTerminal) {
  return {
    command: terminal.command,
    createdFromThreadId: terminal.createdFromThreadId,
    cwd: terminal.cwd,
    status: terminal.status,
    terminalIndex: terminal.terminalIndex,
    title: terminal.title,
    workspace: `${terminal.projectName} · ${terminal.worktreeFolder}`,
  };
}

function terminalTable(terminals: RpcTerminal[]): string {
  if (terminals.length === 0) {
    return "No open terminals.";
  }
  return [
    "Index | Title | Status | Workspace | Command",
    "--- | --- | --- | --- | ---",
    ...terminals.map((terminal) =>
      [
        terminal.terminalIndex,
        terminal.title,
        terminal.status,
        `${terminal.projectName} · ${terminal.worktreeFolder}`,
        terminal.command ?? "",
      ].join(" | "),
    ),
  ].join("\n");
}

function terminalAccess(scope: PiMetidosToolScope) {
  return { createdFromThreadId: scope.threadIdContext };
}

function terminalDirectory(scope: PiMetidosToolScope, dir: string): string {
  const resolved = canonicalPath(dir, scope);
  if (!pathIsWithinRoot(scope.worktreePathContext, resolved)) {
    throw new Error(
      "Terminal directory must stay inside the selected worktree.",
    );
  }
  return resolved;
}

async function invokeTerminalHost<T>(
  operation: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch {
    throw new Error(
      `Terminal ${operation} failed. Check the terminal workspace for details.`,
    );
  }
}

export function createPiMetidosTerminalTools(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
): ToolDefinition[] {
  assertTerminalToolsAllowed(scope);
  return [
    withMetidosToolTelemetry(
      defineTool({
        description:
          "Create an interactive terminal for the user. Use this instead of a background bash command for long-lived processes, watch tasks, dev servers, REPLs, TUIs, or anything the user may want to inspect or control manually.",
        execute: async (_toolCallId, params) => {
          const dir = params.dir?.trim()
            ? terminalDirectory(scope, params.dir)
            : scope.worktreePathContext;
          const createTerminal = host.createTerminal;
          if (!createTerminal) {
            throw new Error("Terminal host is unavailable.");
          }
          const terminal = await invokeTerminalHost("creation", () =>
            createTerminal({
              command: params.command?.trim() || null,
              createdFromThreadId: scope.threadIdContext,
              dir,
              projectId: scope.projectIdContext,
              title: params.title?.trim() || null,
              worktreePath: scope.worktreePathContext,
            }),
          );
          return textToolResult(
            `Created terminal "${terminal.title}" in ${terminal.projectName} · ${terminal.worktreeFolder}.`,
            terminalPayload(terminal),
          );
        },
        label: "New Terminal",
        name: "new_terminal",
        parameters: NewTerminalToolParameters,
        promptSnippet: "Create a Metidos terminal",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description: "List current terminals for the local operator.",
        execute: async () => {
          const listTerminals = host.listTerminals;
          if (!listTerminals) {
            throw new Error("Terminal host is unavailable.");
          }
          const terminals = await invokeTerminalHost("list", () =>
            listTerminals(terminalAccess(scope)),
          );
          return textToolResult(terminalTable(terminals), {
            terminals: terminals.map(terminalPayload),
          });
        },
        label: "List Terminals",
        name: "list_terminals",
        parameters: Type.Object({}),
        promptSnippet: "List Metidos terminals",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description: "Close one terminal by terminalIndex.",
        execute: async (_toolCallId, params) => {
          const killTerminal = host.killTerminal;
          if (!killTerminal) {
            throw new Error("Terminal host is unavailable.");
          }
          await invokeTerminalHost("close", () =>
            killTerminal(params.terminalIndex, terminalAccess(scope)),
          );
          return textToolResult(`Closed terminal ${params.terminalIndex}.`, {
            terminalIndex: params.terminalIndex,
          });
        },
        label: "Kill Terminal",
        name: "kill_terminal",
        parameters: TerminalIndexParameters,
        promptSnippet: "Kill a Metidos terminal",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description:
          "View retained cleaned output from one terminal by terminalIndex.",
        execute: async (_toolCallId, params) => {
          const viewTerminal = host.viewTerminal;
          if (!viewTerminal) {
            throw new Error("Terminal host is unavailable.");
          }
          const text = await invokeTerminalHost("view", () =>
            viewTerminal(
              params.terminalIndex,
              params.lineOffset,
              params.lineCount,
              terminalAccess(scope),
            ),
          );
          return textToolResult(text, {
            lineCount: params.lineCount ?? 200,
            lineOffset: params.lineOffset ?? 0,
            terminalIndex: params.terminalIndex,
          });
        },
        label: "View Terminal",
        name: "view_terminal",
        parameters: ViewTerminalParameters,
        promptSnippet: "View a Metidos terminal",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description:
          "Search retained cleaned output from one terminal by terminalIndex.",
        execute: async (_toolCallId, params) => {
          const grepOptions: { ignoreCase?: boolean; maxMatches?: number } = {};
          if (typeof params.ignoreCase === "boolean") {
            grepOptions.ignoreCase = params.ignoreCase;
          }
          if (typeof params.maxMatches === "number") {
            grepOptions.maxMatches = params.maxMatches;
          }
          const grepTerminal = host.grepTerminal;
          if (!grepTerminal) {
            throw new Error("Terminal host is unavailable.");
          }
          const text = await invokeTerminalHost("search", () =>
            grepTerminal(
              params.terminalIndex,
              params.pattern,
              grepOptions,
              terminalAccess(scope),
            ),
          );
          return textToolResult(text, {
            ignoreCase: params.ignoreCase ?? false,
            maxMatches: params.maxMatches ?? 20,
            pattern: params.pattern,
            terminalIndex: params.terminalIndex,
          });
        },
        label: "Grep Terminal",
        name: "grep_terminal",
        parameters: GrepTerminalParameters,
        promptSnippet: "Search a Metidos terminal",
      }),
    ),
  ];
}
