/**
 * @file src/bun/pi-metidos-tools-cron.ts
 * @description Pi-native Metidos cron management tools.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import {
  assertUnsafeModeEscalationAllowed,
  cronJobPayload,
  NullableString,
  type PiMetidosToolHost,
  type PiMetidosToolScope,
  PositiveInteger,
  prepareThreadIdAndBooleanArguments,
  SUPPORTED_MODELS_SENTENCE,
  ThinkingLevel,
  textToolResult,
  withMetidosToolTelemetry,
} from "./pi-metidos-tools-shared";
import { resolveWorktreeTarget } from "./pi-metidos-tools-targeting";

const NewCronToolParameters = Type.Object({
  agentsAccess: Type.Optional(Type.Boolean()),
  description: Type.Optional(NullableString),
  enabled: Type.Optional(Type.Boolean()),
  githubAccess: Type.Optional(Type.Boolean()),
  metidosAccess: Type.Optional(Type.Boolean()),
  model: Type.Optional(Type.String({ minLength: 1 })),
  projectId: Type.Optional(PositiveInteger),
  projectPath: Type.Optional(
    Type.String({
      description: "Project path if projectId is unknown.",
      minLength: 1,
    }),
  ),
  prompt: Type.String({
    description: "Prompt sent to the cron run thread.",
    minLength: 1,
  }),
  reasoningEffort: Type.Optional(ThinkingLevel),
  schedule: Type.String({
    description: "Cron schedule expression.",
    minLength: 1,
  }),
  title: Type.Optional(NullableString),
  unsafeMode: Type.Optional(Type.Boolean()),
  webSearchAccess: Type.Optional(Type.Boolean()),
  worktreePath: Type.Optional(
    Type.String({
      description: "Worktree path. Omit to target the current worktree.",
      minLength: 1,
    }),
  ),
});

const UpdateCronToolParameters = Type.Object({
  agentsAccess: Type.Optional(Type.Boolean()),
  cronJobId: PositiveInteger,
  deleted: Type.Optional(Type.Boolean()),
  description: Type.Optional(NullableString),
  enabled: Type.Optional(Type.Boolean()),
  githubAccess: Type.Optional(Type.Boolean()),
  metidosAccess: Type.Optional(Type.Boolean()),
  model: Type.Optional(Type.String({ minLength: 1 })),
  prompt: Type.Optional(Type.String({ minLength: 1 })),
  reasoningEffort: Type.Optional(ThinkingLevel),
  schedule: Type.Optional(Type.String({ minLength: 1 })),
  title: Type.Optional(NullableString),
  unsafeMode: Type.Optional(Type.Boolean()),
  webSearchAccess: Type.Optional(Type.Boolean()),
});

export function createPiMetidosCronTools(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
): ToolDefinition[] {
  return [
    withMetidosToolTelemetry(
      defineTool({
        description: "List all non-deleted cron jobs with latest run metadata.",
        execute: async () => {
          const crons = await host.listCrons();
          return textToolResult(`Found ${crons.length} cron job(s).`, {
            cronJobs: crons.map(cronJobPayload),
          });
        },
        label: "List Cron Jobs",
        name: "list_crons",
        parameters: Type.Object({}),
        promptSnippet: "List Metidos cron jobs",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description: `Create a new cron job bound to a project workspace. The run prompt is reused for each fire time. Access flags mirror thread controls. Safe threads must leave unsafeMode off. ${SUPPORTED_MODELS_SENTENCE}`,
        execute: async (_toolCallId, params) => {
          assertUnsafeModeEscalationAllowed(
            "new_cron",
            scope,
            params.unsafeMode,
          );
          const target = await resolveWorktreeTarget(
            {
              projectId: params.projectId,
              projectPath: params.projectPath,
              worktreePath: params.worktreePath,
            },
            host,
            scope,
          );
          const created = await host.newCron({
            ...(typeof params.agentsAccess === "boolean"
              ? { agentsAccess: params.agentsAccess }
              : {}),
            ...(typeof params.description === "string"
              ? { description: params.description.trim() }
              : {}),
            ...(typeof params.enabled === "boolean"
              ? { enabled: params.enabled }
              : {}),
            ...(typeof params.githubAccess === "boolean"
              ? { githubAccess: params.githubAccess }
              : {}),
            ...(typeof params.metidosAccess === "boolean"
              ? { metidosAccess: params.metidosAccess }
              : {}),
            ...(typeof params.model === "string"
              ? { model: params.model.trim() }
              : {}),
            projectId: target.projectId,
            prompt: params.prompt.trim(),
            ...(typeof params.reasoningEffort === "string"
              ? { reasoningEffort: params.reasoningEffort }
              : {}),
            schedule: params.schedule.trim(),
            ...(typeof params.title === "string"
              ? { title: params.title.trim() }
              : {}),
            ...(typeof params.unsafeMode === "boolean"
              ? { unsafeMode: params.unsafeMode }
              : {}),
            ...(typeof params.webSearchAccess === "boolean"
              ? { webSearchAccess: params.webSearchAccess }
              : {}),
            worktreePath: target.worktreePath,
          });
          return textToolResult(
            `Created cron job ${created.id} in ${target.worktreePath}.`,
            cronJobPayload(created),
          );
        },
        label: "New Cron Job",
        name: "new_cron",
        parameters: NewCronToolParameters,
        prepareArguments: (args) =>
          prepareThreadIdAndBooleanArguments<typeof NewCronToolParameters>(
            args,
            [
              "agentsAccess",
              "enabled",
              "githubAccess",
              "metidosAccess",
              "unsafeMode",
              "webSearchAccess",
            ],
            ["projectId"],
          ),
        promptGuidelines: [
          "Use this to define recurring Metidos work instead of describing cron changes abstractly.",
        ],
        promptSnippet: "Create a Metidos cron job for recurring work",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description: `Update schedule, prompt, access controls, enabled state, or soft-delete a cron job. Safe threads cannot turn cron jobs into unsafe jobs. ${SUPPORTED_MODELS_SENTENCE}`,
        execute: async (_toolCallId, params) => {
          if (
            params.deleted === undefined &&
            params.schedule === undefined &&
            params.prompt === undefined &&
            params.model === undefined &&
            params.webSearchAccess === undefined &&
            params.githubAccess === undefined &&
            params.agentsAccess === undefined &&
            params.metidosAccess === undefined &&
            params.title === undefined &&
            params.description === undefined &&
            params.unsafeMode === undefined &&
            params.reasoningEffort === undefined &&
            params.enabled === undefined
          ) {
            throw new Error("At least one update field is required.");
          }
          assertUnsafeModeEscalationAllowed(
            "update_cron",
            scope,
            params.unsafeMode,
          );
          const updated = await host.updateCron({
            ...(typeof params.agentsAccess === "boolean"
              ? { agentsAccess: params.agentsAccess }
              : {}),
            cronJobId: params.cronJobId,
            ...(typeof params.deleted === "boolean"
              ? { deleted: params.deleted }
              : {}),
            ...(typeof params.description === "string"
              ? { description: params.description.trim() }
              : {}),
            ...(typeof params.enabled === "boolean"
              ? { enabled: params.enabled }
              : {}),
            ...(typeof params.githubAccess === "boolean"
              ? { githubAccess: params.githubAccess }
              : {}),
            ...(typeof params.metidosAccess === "boolean"
              ? { metidosAccess: params.metidosAccess }
              : {}),
            ...(typeof params.model === "string"
              ? { model: params.model.trim() }
              : {}),
            ...(typeof params.prompt === "string"
              ? { prompt: params.prompt.trim() }
              : {}),
            ...(typeof params.reasoningEffort === "string"
              ? { reasoningEffort: params.reasoningEffort }
              : {}),
            ...(typeof params.schedule === "string"
              ? { schedule: params.schedule.trim() }
              : {}),
            ...(typeof params.title === "string"
              ? { title: params.title.trim() }
              : {}),
            ...(typeof params.unsafeMode === "boolean"
              ? { unsafeMode: params.unsafeMode }
              : {}),
            ...(typeof params.webSearchAccess === "boolean"
              ? { webSearchAccess: params.webSearchAccess }
              : {}),
          });
          return textToolResult(
            `Updated cron job ${updated.id}.`,
            cronJobPayload(updated),
          );
        },
        label: "Update Cron Job",
        name: "update_cron",
        parameters: UpdateCronToolParameters,
        prepareArguments: (args) =>
          prepareThreadIdAndBooleanArguments<typeof UpdateCronToolParameters>(
            args,
            [
              "agentsAccess",
              "deleted",
              "enabled",
              "githubAccess",
              "metidosAccess",
              "unsafeMode",
              "webSearchAccess",
            ],
            ["cronJobId"],
          ),
        promptSnippet: "Update or delete a Metidos cron job",
      }),
    ),
  ];
}
