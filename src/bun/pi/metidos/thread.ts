/**
 * @file src/bun/pi/metidos/thread.ts
 * @description Pi-native Metidos thread metadata and creation tools.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { workContextLifecycle } from "../../project-procedures/work-context-lifecycle";
import type { RpcThread } from "../../rpc-schema";
import { updateThreadMetadataFromSidecar } from "../../sidecar-thread-metadata";
import { enforceBoundThreadScope } from "../../thread-tool-scope";
import {
  normalizeRequestedPermissions,
  preparePermissionArrayArguments,
  requestedUnsafePermission,
} from "./permission-normalization";
import {
  assertUnsafeModeEscalationAllowed,
  type PiMetidosToolHost,
  type PiMetidosToolScope,
  PositiveInteger,
  prepareThreadIdAndBooleanArguments,
  recordUnsafeModeRequestOutcome,
  SUPPORTED_MODELS_SENTENCE,
  ThinkingLevel,
  textToolResult,
  threadStartRequestPayload,
  threadStatusPayload,
  withMetidosToolTelemetry,
} from "./shared";
import { resolveWorktreeTarget } from "./targeting";

type UpdateThreadToolInput = {
  agentsAccess?: boolean | null | undefined;
  description?: string | null | undefined;
  githubAccess?: boolean | null | undefined;
  gitAccess?: boolean | null | undefined;
  sqliteAccess?: boolean | null | undefined;
  webServerAccess?: boolean | null | undefined;
  threadsAccess?: boolean | null | undefined;
  cronsAccess?: boolean | null | undefined;
  metidosAccess?: boolean | null | undefined;
  pinned?: boolean | null | undefined;
  summary?: string | null | undefined;
  title?: string | null | undefined;
  unsafeMode?: boolean | null | undefined;
  webSearchAccess?: boolean | null | undefined;
};

const UPDATE_THREAD_IGNORED_ACCESS_FIELDS = [
  "webSearchAccess",
  "githubAccess",
  "gitAccess",
  "sqliteAccess",
  "webServerAccess",
  "agentsAccess",
  "threadsAccess",
  "cronsAccess",
  "metidosAccess",
  "unsafeMode",
] as const;

const UpdateThreadToolParameters = Type.Object({
  agentsAccess: Type.Optional(
    Type.Union([
      Type.Boolean({
        description: ignoredUpdateThreadAccessFieldDescription("agentsAccess"),
      }),
      Type.Null(),
    ]),
  ),
  description: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Alias for summary. Empty clears it. Omit or null to leave unchanged.",
      }),
      Type.Null(),
    ]),
  ),
  githubAccess: Type.Optional(
    Type.Union([
      Type.Boolean({
        description: ignoredUpdateThreadAccessFieldDescription("githubAccess"),
      }),
      Type.Null(),
    ]),
  ),
  gitAccess: Type.Optional(
    Type.Union([
      Type.Boolean({
        description: ignoredUpdateThreadAccessFieldDescription("gitAccess"),
      }),
      Type.Null(),
    ]),
  ),
  sqliteAccess: Type.Optional(
    Type.Union([
      Type.Boolean({
        description: ignoredUpdateThreadAccessFieldDescription("sqliteAccess"),
      }),
      Type.Null(),
    ]),
  ),
  webServerAccess: Type.Optional(
    Type.Union([
      Type.Boolean({
        description:
          ignoredUpdateThreadAccessFieldDescription("webServerAccess"),
      }),
      Type.Null(),
    ]),
  ),
  metidosAccess: Type.Optional(
    Type.Union([
      Type.Boolean({
        description: ignoredUpdateThreadAccessFieldDescription("metidosAccess"),
      }),
      Type.Null(),
    ]),
  ),
  pinned: Type.Optional(
    Type.Union([
      Type.Boolean({
        description:
          "Optional pinned state. Only send this field when you want to change pin state. Set true to pin the thread. Set false to unpin the thread. Omit this field entirely, or send null, to preserve the current pinned state exactly as-is.",
      }),
      Type.Null(),
    ]),
  ),
  summary: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional thread summary. Empty clears it. Omit or null to leave unchanged.",
      }),
      Type.Null(),
    ]),
  ),
  threadId: Type.Optional(
    Type.Union([
      PositiveInteger,
      Type.Null({
        description:
          "Defaults to the current thread. Omit unless you are explicitly targeting that same thread.",
      }),
    ]),
  ),
  title: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Short title. Supply one for every thread, including quick one-off tasks. Omit only when updating other fields without changing the title.",
      }),
      Type.Null(),
    ]),
  ),
  unsafeMode: Type.Optional(
    Type.Union([
      Type.Boolean({
        description: ignoredUpdateThreadAccessFieldDescription("unsafeMode"),
      }),
      Type.Null(),
    ]),
  ),
  webSearchAccess: Type.Optional(
    Type.Union([
      Type.Boolean({
        description:
          ignoredUpdateThreadAccessFieldDescription("webSearchAccess"),
      }),
      Type.Null(),
    ]),
  ),
});

const NewThreadToolParameters = Type.Object({
  autoStart: Type.Optional(Type.Boolean()),
  input: Type.String({
    description: "Initial prompt.",
    minLength: 1,
  }),
  model: Type.Optional(
    Type.String({
      description:
        "Optional provider-qualified model id. Omit to inherit the current thread's model selection.",
      minLength: 1,
    }),
  ),
  permissions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  projectId: Type.Optional(PositiveInteger),
  projectPath: Type.Optional(Type.String({ minLength: 1 })),
  reasoningEffort: Type.Optional(ThinkingLevel),
  worktreePath: Type.Optional(Type.String({ minLength: 1 })),
});

function updateThreadDescription(boundThreadId: number): string {
  return [
    "YOUR FIRST ACTION IN EVERY THREAD MUST BE TO CALL THIS TOOL.",
    "Set a concise title with update_thread before doing any other work.",
    "Update Metidos thread metadata only.",
    "Use this liberally to keep threads organized: every thread should get a concise title, including quick one-off tasks, and you should reuse this tool whenever a better title, a short summary, or pinning would make the thread easier to scan.",
    "IMPORTANT: only include the pinned field when you are intentionally changing pin state. Use pinned: true to pin. Use pinned: false to unpin. Omit pinned entirely, or use null, when you want the current pinned state to stay unchanged.",
    "Never send access-control fields such as webSearchAccess, githubAccess, gitAccess, sqliteAccess, webServerAccess, agentsAccess, metidosAccess, or unsafeMode with this tool; they are ignored from inside a running thread.",
    `Bound thread: ${boundThreadId}.`,
  ].join(" ");
}

function ignoredUpdateThreadAccessFieldDescription(fieldName: string): string {
  return `Legacy compatibility field for ${fieldName}. Do not send this when updating a thread. This tool ignores it; thread access changes must be made outside the thread.`;
}

function collectIgnoredUpdateThreadAccessFields(
  params: UpdateThreadToolInput,
): string[] {
  return UPDATE_THREAD_IGNORED_ACCESS_FIELDS.filter(
    (fieldName) => typeof params[fieldName] === "boolean",
  );
}

function buildUpdateThreadToolPayload(
  thread: Pick<RpcThread, "id" | "pinnedAt" | "summary" | "title">,
  params: UpdateThreadToolInput & {
    ignoredAccessFields?: string[] | null | undefined;
  },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    threadId: thread.id,
    title: thread.title,
  };
  const requestedSummary =
    typeof params.summary === "string"
      ? params.summary
      : typeof params.description === "string"
        ? params.description
        : undefined;
  if (typeof requestedSummary === "string") {
    if (thread.summary === null) {
      payload.summaryCleared = true;
    } else {
      payload.summary = thread.summary;
    }
  }
  if (typeof params.pinned === "boolean") {
    payload.pinned = thread.pinnedAt !== null;
  }
  if (params.ignoredAccessFields?.length) {
    payload.ignoredAccessFields = [...params.ignoredAccessFields];
  }
  return payload;
}

export function createPiMetidosThreadUpdateTools(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
): ToolDefinition[] {
  return [
    withMetidosToolTelemetry(
      defineTool({
        description: updateThreadDescription(scope.threadIdContext),
        execute: async (_toolCallId, params) => {
          const resolvedThreadId =
            typeof params.threadId === "number"
              ? params.threadId
              : scope.threadIdContext;
          enforceBoundThreadScope(resolvedThreadId, scope.threadIdContext);
          const ignoredAccessFields = collectIgnoredUpdateThreadAccessFields({
            agentsAccess: params.agentsAccess,
            description: params.description,
            githubAccess: params.githubAccess,
            gitAccess: params.gitAccess,
            sqliteAccess: params.sqliteAccess,
            webServerAccess: params.webServerAccess,
            metidosAccess: params.metidosAccess,
            pinned: params.pinned,
            summary: params.summary,
            title: params.title,
            unsafeMode: params.unsafeMode,
            webSearchAccess: params.webSearchAccess,
          });
          const hasMetadataUpdate =
            typeof params.title === "string" ||
            typeof params.summary === "string" ||
            typeof params.description === "string" ||
            typeof params.pinned === "boolean";
          if (!hasMetadataUpdate && ignoredAccessFields.length === 0) {
            throw new Error(
              "At least one of title, summary, description, or pinned is required.",
            );
          }
          if (!hasMetadataUpdate) {
            return textToolResult(
              `Ignored thread access changes for thread ${resolvedThreadId}. This tool only updates metadata from inside a running thread.`,
              {
                ignoredAccessFields,
                threadId: resolvedThreadId,
              },
            );
          }

          const thread = await updateThreadMetadataFromSidecar(
            host.updateThreadMetadata,
            {
              ...(typeof params.description === "undefined"
                ? {}
                : { description: params.description }),
              ...(typeof params.pinned === "undefined"
                ? {}
                : { pinned: params.pinned }),
              ...(typeof params.summary === "undefined"
                ? {}
                : { summary: params.summary }),
              threadId: resolvedThreadId,
              ...(typeof params.title === "undefined"
                ? {}
                : { title: params.title }),
            },
          );

          return textToolResult(
            ignoredAccessFields.length
              ? `Updated thread ${thread.id}. Ignored in-thread access changes.`
              : `Updated thread ${thread.id}.`,
            buildUpdateThreadToolPayload(thread, {
              description: params.description,
              ignoredAccessFields,
              pinned: params.pinned,
              summary: params.summary,
              title: params.title,
            }),
          );
        },
        label: "Update Thread",
        name: "update_thread",
        parameters: UpdateThreadToolParameters,
        prepareArguments: (args) =>
          prepareThreadIdAndBooleanArguments<typeof UpdateThreadToolParameters>(
            args,
            [
              "agentsAccess",
              "calendarAccess",
              "githubAccess",
              "gitAccess",
              "sqliteAccess",
              "webServerAccess",
              "metidosAccess",
              "pinned",
              "unsafeMode",
              "webSearchAccess",
            ],
            ["threadId"],
          ),
        promptGuidelines: [
          "This is your mandatory first action in every thread. Set a concise title before any other tool call or response.",
          "Use this to rename, summarize, or intentionally change the pin state of the current thread instead of describing those metadata changes in plain text.",
          "Do not include pinned unless you want to change it. Use pinned: true to pin, pinned: false to unpin, and omit pinned to leave the current pin state unchanged.",
        ],
        promptSnippet:
          "Mandatory first action: update Metidos thread title, summary, or pin state",
      }),
    ),
  ];
}

function resolveNewThreadModel(
  scope: PiMetidosToolScope,
  params: { model?: string | null | undefined },
): string | null {
  return typeof params.model === "string" ? params.model : scope.modelContext;
}

function resolveNewThreadReasoningEffort(
  scope: PiMetidosToolScope,
  params: {
    reasoningEffort?: RpcThread["reasoningEffort"] | null | undefined;
  },
): RpcThread["reasoningEffort"] | null {
  return typeof params.reasoningEffort === "string"
    ? params.reasoningEffort
    : scope.reasoningEffortContext;
}

function requestedMissingPermissions(
  scope: PiMetidosToolScope,
  permissions: readonly string[] | null,
): string[] {
  if (permissions === null) {
    return [];
  }
  const granted = new Set(scope.permissionsContext ?? []);
  return permissions.filter((permission) => !granted.has(permission));
}

export function createPiMetidosThreadCreationTools(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
): ToolDefinition[] {
  return [
    withMetidosToolTelemetry(
      defineTool<typeof NewThreadToolParameters, Record<string, unknown>>({
        description: `Start a separate Metidos thread for distinct work or another git worktree. Bound sessions cannot escape their current project/worktree. Use metidos_list_permissions before selecting custom permissions. If permissions is omitted, the child inherits the current thread's permissions. Requests for permissions the current thread does not have require user approval. Safe child threads can be created immediately. Requests that include metidos:unsafe from a safe thread require user approval. Unsafe threads may create directly, or set autoStart=true to request approval first. If model or reasoningEffort is omitted, the child thread inherits the current thread's model and reasoning selection. ${SUPPORTED_MODELS_SENTENCE} Example permissions: {"permissions":["metidos:threads","metidos:git"]}. Example permissions: {"permissions":["metidos:webview","metidos:git","weather:forecast"]}.`,
        execute: async (_toolCallId, params) => {
          const target = await resolveWorktreeTarget(
            {
              projectId: params.projectId,
              projectPath: params.projectPath,
              worktreePath: params.worktreePath,
            },
            host,
            scope,
          );
          const inheritedModel = resolveNewThreadModel(scope, params);
          const inheritedReasoningEffort = resolveNewThreadReasoningEffort(
            scope,
            params,
          );
          const permissions = Array.isArray(params.permissions)
            ? await normalizeRequestedPermissions(params.permissions, host)
            : [...(scope.permissionsContext ?? [])];
          const unsafeRequested = requestedUnsafePermission(permissions);
          const missingPermissions = requestedMissingPermissions(
            scope,
            permissions,
          );
          const metadata = {
            autoStart: params.autoStart ?? null,
            input: params.input,
            model: inheritedModel,
            permissions,
            projectPath: target.projectPath,
            reasoningEffort: inheritedReasoningEffort,
          };

          const requiresApproval =
            params.autoStart === true ||
            missingPermissions.length > 0 ||
            (unsafeRequested && !scope.allowUnsafeModeEscalation);
          if (requiresApproval) {
            recordUnsafeModeRequestOutcome("new_thread", unsafeRequested, true);
            const request = await host.requestThreadStart({
              autoStart: true,
              input: params.input,
              model: inheritedModel,
              permissions,
              projectId: target.projectId,
              reasoningEffort: inheritedReasoningEffort,
              worktreePath: target.worktreePath,
            });
            return textToolResult(
              `Requested permission to start a thread for ${target.worktreePath}.`,
              threadStartRequestPayload(request),
            );
          }

          assertUnsafeModeEscalationAllowed(
            "new_thread",
            scope,
            unsafeRequested,
          );
          const queued = await workContextLifecycle.threads.queueCallerTurn({
            input: params.input,
            queueTurn: ({ input, threadId }) =>
              host.sendThreadMessage({
                input,
                threadId,
              }),
            resolveThreadId: async () => {
              const created = await host.createThread({
                ...(typeof inheritedModel === "string"
                  ? { model: inheritedModel }
                  : {}),
                permissions,
                projectId: target.projectId,
                ...(typeof inheritedReasoningEffort === "string"
                  ? { reasoningEffort: inheritedReasoningEffort }
                  : {}),
                worktreePath: target.worktreePath,
              });
              return created.thread.id;
            },
          });
          const started = queued.result;
          const payload = threadStatusPayload(started, metadata);
          return textToolResult(
            `Started thread ${payload.threadId} (${payload.status}).`,
            payload,
          );
        },
        label: "New Thread",
        name: "new_thread",
        parameters: NewThreadToolParameters,
        prepareArguments: (args) => {
          const prepared = prepareThreadIdAndBooleanArguments<
            typeof NewThreadToolParameters
          >(args, ["autoStart"], ["projectId"]);
          const withPermissions =
            preparePermissionArrayArguments<typeof prepared>(prepared);
          if (
            withPermissions &&
            typeof withPermissions === "object" &&
            ((requestedUnsafePermission(withPermissions.permissions) &&
              !scope.allowUnsafeModeEscalation) ||
              requestedMissingPermissions(
                scope,
                Array.isArray(withPermissions.permissions)
                  ? withPermissions.permissions
                  : null,
              ).length > 0) &&
            withPermissions.autoStart !== true
          ) {
            return {
              ...withPermissions,
              autoStart: true,
            };
          }
          return withPermissions;
        },
        promptGuidelines: [
          "Use this when the work should continue in a separate Metidos thread or worktree instead of overloading the current transcript.",
          "Call metidos_list_permissions before selecting custom permissions for a new thread.",
          "When model or reasoningEffort is omitted, the child thread inherits the current thread settings.",
        ],
        promptSnippet:
          "Create a new Metidos thread in the current project or worktree",
      }),
    ),
  ];
}
