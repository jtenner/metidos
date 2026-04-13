/**
 * @file src/bun/pi-metidos-tools-task-graph.ts
 * @description Pi-native Metidos task-graph admin tool definitions.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { type Static, Type } from "@sinclair/typebox";
import {
  assertTaskGraphAdminAllowed,
  type PiMetidosToolHost,
  type PiMetidosToolScope,
  textToolResult,
  withMetidosToolTelemetry,
} from "./pi-metidos-tools-shared";
import type {
  RpcInitTaskGraphRequest,
  RpcInitTaskGraphResult,
  RpcNormalizeTaskGraphRequest,
  RpcNormalizeTaskGraphResult,
  RpcValidateTaskGraphRequest,
  RpcValidateTaskGraphResult,
} from "./rpc-schema";

const InitTaskGraphToolParameters = Type.Object({
  createTagsRegistry: Type.Optional(
    Type.Boolean({
      description: "Seed an empty tags.toml registry if it is missing.",
    }),
  ),
  createTypesRegistry: Type.Optional(
    Type.Boolean({
      description: "Seed an empty types.toml registry if it is missing.",
    }),
  ),
  idPrefix: Type.Optional(
    Type.String({
      description: "Task id prefix written into config.toml.",
      minLength: 1,
    }),
  ),
  strictTags: Type.Optional(
    Type.Boolean({
      description:
        "Whether unregistered tags should be treated as validation errors.",
    }),
  ),
  strictTypes: Type.Optional(
    Type.Boolean({
      description:
        "Whether unregistered task types should be treated as validation errors.",
    }),
  ),
});

const TaskGraphSubsetToolParameters = Type.Object({
  taskIds: Type.Optional(
    Type.Array(
      Type.String({
        minLength: 1,
      }),
      {
        description:
          "Optional subset of task ids to validate or normalize. Omit to operate on the full repository task graph.",
      },
    ),
  ),
});

function normalizeOptionalTaskIds(taskIds?: string[]): string[] | undefined {
  if (!taskIds) {
    return undefined;
  }
  const normalized = [
    ...new Set(taskIds.map((taskId) => taskId.trim())),
  ].filter((taskId) => taskId.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeInitTaskGraphRequest(
  params: Static<typeof InitTaskGraphToolParameters>,
): RpcInitTaskGraphRequest {
  const idPrefix = params.idPrefix?.trim();
  if (typeof params.idPrefix === "string" && !idPrefix) {
    throw new Error("idPrefix must not be empty.");
  }
  return {
    ...(typeof params.createTagsRegistry === "boolean"
      ? { createTagsRegistry: params.createTagsRegistry }
      : {}),
    ...(typeof params.createTypesRegistry === "boolean"
      ? { createTypesRegistry: params.createTypesRegistry }
      : {}),
    ...(typeof idPrefix === "string" ? { idPrefix } : {}),
    ...(typeof params.strictTags === "boolean"
      ? { strictTags: params.strictTags }
      : {}),
    ...(typeof params.strictTypes === "boolean"
      ? { strictTypes: params.strictTypes }
      : {}),
  };
}

function normalizeTaskGraphSubsetRequest(
  params: Static<typeof TaskGraphSubsetToolParameters>,
): RpcValidateTaskGraphRequest {
  const taskIds = normalizeOptionalTaskIds(params.taskIds);
  return {
    ...(taskIds ? { taskIds } : {}),
  };
}

function summarizeInitTaskGraphResult(result: RpcInitTaskGraphResult): string {
  const statusCounts = Object.values(result.status).reduce(
    (counts, status) => {
      counts[status] += 1;
      return counts;
    },
    {
      created: 0,
      existing: 0,
      skipped: 0,
    },
  );
  return `Task graph init finished at ${result.paths.root} (${statusCounts.created} created, ${statusCounts.existing} existing, ${statusCounts.skipped} skipped).`;
}

function summarizeValidateTaskGraphResult(
  result: RpcValidateTaskGraphResult,
): string {
  if (result.ok && result.warnings.length === 0) {
    return `Task graph validation passed at ${result.root} with no findings.`;
  }
  return `Task graph validation completed at ${result.root} with ${result.errors.length} error(s) and ${result.warnings.length} warning(s).`;
}

function summarizeNormalizeTaskGraphResult(
  result: RpcNormalizeTaskGraphResult,
): string {
  if (result.changedFiles.length === 0) {
    return `Task graph already canonical at ${result.root}.`;
  }
  return `Normalized task graph at ${result.root}; rewrote ${result.changedFiles.length} file(s).`;
}

export function createPiMetidosTaskGraphTools(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
): ToolDefinition[] {
  return [
    withMetidosToolTelemetry(
      defineTool({
        description:
          "Initialize the repository task graph under .metidos/tasks/ in the current workspace. This scaffolds canonical config and directories only; routine task creation and edits should still use the normal file tools. Requires taskGraphAdmin runtime permission.",
        execute: async (_toolCallId, params) => {
          assertTaskGraphAdminAllowed(host);
          const result = await host.initTaskGraph(
            normalizeInitTaskGraphRequest(params),
            scope.worktreePathContext,
          );
          return textToolResult(summarizeInitTaskGraphResult(result), result);
        },
        label: "Init Task Graph",
        name: "init_task_graph",
        parameters: InitTaskGraphToolParameters,
        promptGuidelines: [
          "Use this only to scaffold the canonical .metidos/tasks/ layout. Do not use it for routine task edits.",
        ],
        promptSnippet:
          "Initialize the canonical repository task graph in the current workspace",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description:
          "Validate the canonical repository task graph under .metidos/tasks/ in the current workspace. This is read-only and returns structured findings. Requires taskGraphAdmin runtime permission.",
        execute: async (_toolCallId, params) => {
          assertTaskGraphAdminAllowed(host);
          const result = await host.validateTaskGraph(
            normalizeTaskGraphSubsetRequest(params),
            scope.worktreePathContext,
          );
          return textToolResult(
            summarizeValidateTaskGraphResult(result),
            result,
          );
        },
        label: "Validate Task Graph",
        name: "validate_task_graph",
        parameters: TaskGraphSubsetToolParameters,
        promptGuidelines: [
          "Use this before or after task-graph edits when you need machine-readable validation findings instead of ad hoc inspection.",
        ],
        promptSnippet: "Validate the canonical repository task graph",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description:
          "Rewrite the canonical repository task graph under .metidos/tasks/ into stable normalized form. Use this for canonical cleanup only; routine task edits should still use normal file tools. Requires taskGraphAdmin runtime permission.",
        execute: async (_toolCallId, params) => {
          assertTaskGraphAdminAllowed(host);
          const result = await host.normalizeTaskGraph(
            normalizeTaskGraphSubsetRequest(
              params,
            ) as RpcNormalizeTaskGraphRequest,
            scope.worktreePathContext,
          );
          return textToolResult(
            summarizeNormalizeTaskGraphResult(result),
            result,
          );
        },
        label: "Normalize Task Graph",
        name: "normalize_task_graph",
        parameters: TaskGraphSubsetToolParameters,
        promptGuidelines: [
          "Use this only for canonical formatting and ordering cleanup. Do not use it as a replacement for normal task edits.",
        ],
        promptSnippet: "Normalize the canonical repository task graph",
      }),
    ),
  ];
}
