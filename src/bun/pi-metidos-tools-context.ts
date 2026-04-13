/**
 * @file src/bun/pi-metidos-tools-context.ts
 * @description Pi-native Metidos workspace focus tools.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import {
  type PiMetidosToolHost,
  type PiMetidosToolScope,
  PositiveInteger,
  prepareThreadIdAndBooleanArguments,
  shortName,
  textToolResult,
  withMetidosToolTelemetry,
} from "./pi-metidos-tools-shared";
import { resolveFocusContextTarget } from "./pi-metidos-tools-targeting";

const SetContextToolParameters = Type.Object({
  project: Type.String({
    description: "Project name or path to focus.",
    minLength: 1,
  }),
  threadId: Type.Optional(PositiveInteger),
  workspace: Type.Optional(
    Type.String({
      description: "Optional git worktree name or path.",
      minLength: 1,
    }),
  ),
});

export function createPiMetidosContextTools(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
): ToolDefinition[] {
  return [
    withMetidosToolTelemetry(
      defineTool({
        description:
          "Focus the Metidos UI on a project, git worktree, and optional thread. Omit workspace to use the primary worktree. threadId wins and opens that thread's project/worktree.",
        execute: async (_toolCallId, params, signal) => {
          const target = await resolveFocusContextTarget(
            {
              project: params.project,
              threadId: params.threadId,
              workspace: params.workspace,
            },
            host,
            scope,
          );
          const result = await host.focusContext(
            {
              ...(target.threadId === null
                ? {}
                : { threadId: target.threadId }),
              projectId: target.project.id,
              worktreePath: target.worktree.path,
            },
            signal,
          );
          return textToolResult(
            `Focused ${result.projectName} / ${shortName(result.worktreePath)}${result.threadId ? ` / thread ${result.threadId}` : ""}.`,
            {
              projectId: result.projectId,
              projectName: result.projectName,
              projectPath: result.projectPath,
              threadId: result.threadId,
              worktreePath: result.worktreePath,
            },
          );
        },
        label: "Set Context",
        name: "set_context",
        parameters: SetContextToolParameters,
        prepareArguments: (args) =>
          prepareThreadIdAndBooleanArguments<typeof SetContextToolParameters>(
            args,
            [],
            ["threadId"],
          ),
        promptGuidelines: [
          "Use this when the user explicitly wants the browser UI moved to another project, worktree, or thread.",
        ],
        promptSnippet:
          "Focus the Metidos UI on another project, worktree, or thread",
      }),
    ),
  ];
}
