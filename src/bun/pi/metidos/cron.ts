/**
 * @file src/bun/pi/metidos/cron.ts
 * @description Pi-native Metidos cron management tools.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { RpcCronJob } from "../../rpc-schema";
import {
  normalizeRequestedPermissions,
  preparePermissionArrayArguments,
  requestedUnsafePermission,
} from "./permission-normalization";
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
} from "./shared";
import { resolveWorktreeTarget } from "./targeting";

const NewCronToolParameters = Type.Object({
  description: Type.Optional(NullableString),
  enabled: Type.Optional(Type.Boolean()),
  model: Type.Optional(Type.String({ minLength: 1 })),
  permissions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
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
  worktreePath: Type.Optional(
    Type.String({
      description: "Worktree path. Omit to target the current worktree.",
      minLength: 1,
    }),
  ),
});

const UpdateCronToolParameters = Type.Object({
  cronJobId: PositiveInteger,
  deleted: Type.Optional(Type.Boolean()),
  description: Type.Optional(NullableString),
  enabled: Type.Optional(Type.Boolean()),
  model: Type.Optional(Type.String({ minLength: 1 })),
  permissions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  prompt: Type.Optional(Type.String({ minLength: 1 })),
  reasoningEffort: Type.Optional(ThinkingLevel),
  schedule: Type.Optional(Type.String({ minLength: 1 })),
  title: Type.Optional(NullableString),
});

const ShowCronToolParameters = Type.Object({
  cronJobId: PositiveInteger,
});

function summarizeCronPrompt(prompt: string): string {
  const normalizedPrompt = prompt.trim().replace(/\s+/gu, " ");
  if (!normalizedPrompt) {
    return "No prompt text.";
  }
  if (normalizedPrompt.length <= 96) {
    return normalizedPrompt;
  }
  return `${normalizedPrompt.slice(0, 93)}...`;
}

function formatCronTimestamp(timestamp: number | null): string | null {
  if (timestamp === null) {
    return null;
  }
  const parsedDate = new Date(timestamp);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }
  return parsedDate.toISOString();
}

function describeCronJob(cronJob: RpcCronJob): string {
  const statusDetails = [
    cronJob.schedule,
    cronJob.enabled === 1 ? "enabled" : "disabled",
    cronJob.worktreePath,
  ];
  const nextRunAt = formatCronTimestamp(cronJob.nextRunDate);
  if (nextRunAt) {
    statusDetails.push(`next ${nextRunAt}`);
  }
  if (cronJob.lastRunStatus) {
    statusDetails.push(`last ${cronJob.lastRunStatus}`);
  }
  const title = cronJob.title.trim() || `Cron ${cronJob.id}`;
  return `- [${cronJob.id}] ${title} (${statusDetails.join(" · ")}) - ${summarizeCronPrompt(cronJob.prompt)}`;
}

function formatCronDetailValue(
  value: boolean | number | string | null,
): string {
  if (value === null) {
    return "None";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  const trimmedValue = value.trim();
  return trimmedValue || "(empty)";
}

function describeCronJobDetail(cronJob: RpcCronJob): string {
  const prompt = cronJob.prompt.trim();
  return [
    `Cron job ${cronJob.id}:`,
    `title: ${formatCronDetailValue(cronJob.title)}`,
    `description: ${formatCronDetailValue(cronJob.description)}`,
    `projectId: ${cronJob.projectId}`,
    `worktreePath: ${cronJob.worktreePath}`,
    `schedule: ${cronJob.schedule}`,
    `enabled: ${cronJob.enabled === 1 ? "true" : "false"}`,
    `model: ${cronJob.model}`,
    `reasoningEffort: ${cronJob.reasoningEffort}`,
    `permissions: ${JSON.stringify(cronJob.permissions ?? [])}`,
    `lastRunDate: ${formatCronDetailValue(formatCronTimestamp(cronJob.lastRunDate))}`,
    `lastRunStatus: ${formatCronDetailValue(cronJob.lastRunStatus)}`,
    `nextRunDate: ${formatCronDetailValue(formatCronTimestamp(cronJob.nextRunDate))}`,
    `createdAt: ${cronJob.createdAt}`,
    `updatedAt: ${cronJob.updatedAt}`,
    "prompt:",
    prompt || "(empty)",
  ].join("\n");
}

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
          const summary =
            crons.length === 0
              ? "No cron jobs found."
              : [
                  `Cron jobs (${crons.length}):`,
                  ...crons.map(describeCronJob),
                ].join("\n");
          return textToolResult(summary, {
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
        description:
          "Show every visible field for one cron job, including the full stored prompt text.",
        execute: async (_toolCallId, params) => {
          const cronJob =
            (await host.listCrons()).find(
              (entry) => entry.id === params.cronJobId,
            ) ?? null;
          if (!cronJob) {
            throw new Error(`Cron job not found: ${params.cronJobId}`);
          }
          return textToolResult(describeCronJobDetail(cronJob), {
            cronJob: cronJobPayload(cronJob),
          });
        },
        label: "Show Cron Job",
        name: "show_cron",
        parameters: ShowCronToolParameters,
        prepareArguments: (args) =>
          prepareThreadIdAndBooleanArguments<typeof ShowCronToolParameters>(
            args,
            [],
            ["cronJobId"],
          ),
        promptGuidelines: [
          "Use this before updating a cron job when you need the exact stored prompt or current permissions.",
        ],
        promptSnippet: "Show one Metidos cron job in full detail",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description: `Create a new cron job bound to a project workspace. The run prompt is reused for each fire time. Call metidos_list_permissions before selecting custom permissions. Safe threads must not request metidos:unsafe. ${SUPPORTED_MODELS_SENTENCE} Example permissions: {"permissions":["metidos:threads","metidos:git"]}. Example permissions: {"permissions":["metidos:web-search","metidos:git","weather:forecast"]}.`,
        execute: async (_toolCallId, params) => {
          const permissions = Array.isArray(params.permissions)
            ? await normalizeRequestedPermissions(params.permissions, host)
            : null;
          assertUnsafeModeEscalationAllowed(
            "new_cron",
            scope,
            requestedUnsafePermission(permissions),
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
            ...(typeof params.description === "string"
              ? { description: params.description.trim() }
              : {}),
            ...(typeof params.enabled === "boolean"
              ? { enabled: params.enabled }
              : {}),
            ...(typeof params.model === "string"
              ? { model: params.model.trim() }
              : {}),
            ...(permissions !== null ? { permissions } : {}),
            projectId: target.projectId,
            prompt: params.prompt.trim(),
            ...(typeof params.reasoningEffort === "string"
              ? { reasoningEffort: params.reasoningEffort }
              : {}),
            schedule: params.schedule.trim(),
            ...(typeof params.title === "string"
              ? { title: params.title.trim() }
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
          preparePermissionArrayArguments(
            prepareThreadIdAndBooleanArguments<typeof NewCronToolParameters>(
              args,
              ["enabled"],
              ["projectId"],
            ),
          ),
        promptGuidelines: [
          "Use this to define recurring Metidos work instead of describing cron changes abstractly.",
          "Call metidos_list_permissions before selecting custom permissions for a cron job.",
        ],
        promptSnippet: "Create a Metidos cron job for recurring work",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description: `Update schedule, prompt, permissions, enabled state, or soft-delete a cron job. Call metidos_list_permissions before selecting custom permissions. Safe threads cannot add metidos:unsafe. ${SUPPORTED_MODELS_SENTENCE}`,
        execute: async (_toolCallId, params) => {
          if (
            params.deleted === undefined &&
            params.schedule === undefined &&
            params.prompt === undefined &&
            params.model === undefined &&
            params.permissions === undefined &&
            params.title === undefined &&
            params.description === undefined &&
            params.reasoningEffort === undefined &&
            params.enabled === undefined
          ) {
            throw new Error("At least one update field is required.");
          }
          const permissions = Array.isArray(params.permissions)
            ? await normalizeRequestedPermissions(params.permissions, host)
            : null;
          assertUnsafeModeEscalationAllowed(
            "update_cron",
            scope,
            requestedUnsafePermission(permissions),
          );
          const updated = await host.updateCron({
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
            ...(typeof params.model === "string"
              ? { model: params.model.trim() }
              : {}),
            ...(permissions !== null ? { permissions } : {}),
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
          preparePermissionArrayArguments(
            prepareThreadIdAndBooleanArguments<typeof UpdateCronToolParameters>(
              args,
              ["deleted", "enabled"],
              ["cronJobId"],
            ),
          ),
        promptGuidelines: [
          "Call metidos_list_permissions before selecting custom permissions for a cron job.",
        ],
        promptSnippet: "Update or delete a Metidos cron job",
      }),
    ),
  ];
}
