/**
 * @file src/bun/pi-metidos-tools-thread.ts
 * @description Pi-native Metidos thread metadata, listing, and creation tools.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  assertUnsafeModeEscalationAllowed,
  type PiMetidosToolHost,
  type PiMetidosToolScope,
  PositiveInteger,
  prepareThreadIdAndBooleanArguments,
  SUPPORTED_MODELS_SENTENCE,
  samePath,
  shortName,
  ThinkingLevel,
  textToolResult,
  threadStartRequestPayload,
  threadStatusPayload,
  withMetidosToolTelemetry,
} from "./pi-metidos-tools-shared";
import {
  buildThreadListRows,
  resolveWorktreeTarget,
} from "./pi-metidos-tools-targeting";
import type { RpcThread } from "./rpc-schema";
import { updateThreadMetadataFromSidecar } from "./sidecar-thread-metadata";
import { enforceBoundThreadScope } from "./thread-tool-scope";

type UpdateThreadToolInput = {
  agentsAccess?: boolean | null | undefined;
  description?: string | null | undefined;
  githubAccess?: boolean | null | undefined;
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
  "agentsAccess",
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
          "Optional pinned state. Set true to pin, false to unpin, or omit/null to leave the pinned state unchanged.",
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

const ListThreadsToolParameters = Type.Object({
  projectName: Type.String({
    description: "Project name or path to inspect.",
    minLength: 1,
  }),
  workspaceName: Type.Optional(
    Type.String({
      description: "Optional git worktree name or path.",
      minLength: 1,
    }),
  ),
});

const NewThreadToolParameters = Type.Object({
  agentsAccess: Type.Optional(Type.Boolean()),
  autoStart: Type.Optional(Type.Boolean()),
  githubAccess: Type.Optional(Type.Boolean()),
  input: Type.String({
    description: "Initial prompt.",
    minLength: 1,
  }),
  metidosAccess: Type.Optional(Type.Boolean()),
  model: Type.Optional(Type.String({ minLength: 1 })),
  projectId: Type.Optional(PositiveInteger),
  projectPath: Type.Optional(Type.String({ minLength: 1 })),
  reasoningEffort: Type.Optional(ThinkingLevel),
  unsafeMode: Type.Optional(Type.Boolean()),
  webSearchAccess: Type.Optional(Type.Boolean()),
  worktreePath: Type.Optional(Type.String({ minLength: 1 })),
});

function updateThreadDescription(boundThreadId: number): string {
  return `Update Metidos thread metadata only. Use this liberally to keep threads organized: every thread should get a concise title, including quick one-off tasks, and you should reuse this tool whenever a better title, a short summary, or pinning would make the thread easier to scan. Never send access-control fields such as webSearchAccess, githubAccess, agentsAccess, metidosAccess, or unsafeMode with this tool; they are legacy compatibility inputs and are ignored from inside a running thread. Bound thread: ${boundThreadId}.`;
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

export function createPiMetidosThreadMetadataTools(
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
            metidosAccess: params.metidosAccess,
            pinned: params.pinned,
            summary: params.summary,
            title: params.title,
            unsafeMode: params.unsafeMode,
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
              "githubAccess",
              "metidosAccess",
              "pinned",
              "unsafeMode",
              "webSearchAccess",
            ],
            ["threadId"],
          ),
        promptGuidelines: [
          "Use this to rename, summarize, or pin the current thread instead of describing those metadata changes in plain text.",
        ],
        promptSnippet: "Update Metidos thread title, summary, or pin state",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description:
          "List Metidos threads in a project. Workspace means the git worktree. Omit workspaceName to list every thread and include each thread's worktree.",
        execute: async (_toolCallId, params) => {
          const { project, rows, workspace } = await buildThreadListRows(
            {
              projectName: params.projectName,
              workspaceName: params.workspaceName,
            },
            host,
            scope,
          );
          const textLines = rows.length
            ? rows.map(
                (row) =>
                  `- [${row.threadId}] ${row.title} (${row.workspaceName} · ${row.workspacePath})${row.pinned ? " [pinned]" : ""}${row.summary ? ` - ${row.summary}` : ""}`,
              )
            : [
                workspace
                  ? `No threads found in ${project.name} / ${workspace.branch?.trim() || shortName(workspace.path)}.`
                  : `No threads found in ${project.name}.`,
              ];
          return textToolResult(
            [
              `Threads for ${project.name}${workspace ? ` / ${workspace.branch?.trim() || shortName(workspace.path)}` : ""}:`,
              ...textLines,
            ].join("\n"),
            {
              projectId: project.id,
              projectName: project.name,
              projectPath: project.path,
              threads: rows,
              workspaceName: workspace
                ? workspace.branch?.trim() ||
                  (samePath(workspace.path, project.path, scope)
                    ? "Primary"
                    : shortName(workspace.path))
                : null,
              workspacePath: workspace?.path ?? null,
            },
          );
        },
        label: "List Threads",
        name: "list_threads",
        parameters: ListThreadsToolParameters,
        promptGuidelines: [
          "Use this before creating or focusing another thread when you need to inspect existing work in the same project.",
        ],
        promptSnippet: "List Metidos threads in a project or worktree",
      }),
    ),
  ];
}

export function createPiMetidosThreadCreationTools(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
): ToolDefinition[] {
  return [
    withMetidosToolTelemetry(
      defineTool<typeof NewThreadToolParameters, Record<string, unknown>>({
        description: `Start a separate Metidos thread for distinct work or another git worktree. Bound sessions cannot escape their current project/worktree. Set autoStart=true to request permission first; unsafeMode skips that request path. Safe threads must leave unsafeMode off. Access flags mirror thread controls. ${SUPPORTED_MODELS_SENTENCE}`,
        execute: async (_toolCallId, params) => {
          assertUnsafeModeEscalationAllowed(
            "new_thread",
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
          const metadata = {
            autoStart: params.autoStart ?? null,
            input: params.input,
            model: params.model ?? null,
            projectPath: target.projectPath,
            reasoningEffort: params.reasoningEffort ?? null,
            unsafeMode: params.unsafeMode ?? null,
          };

          if (params.autoStart === true && params.unsafeMode !== true) {
            const request = await host.requestThreadStart({
              agentsAccess: params.agentsAccess ?? null,
              autoStart: true,
              githubAccess: params.githubAccess ?? null,
              input: params.input,
              metidosAccess: params.metidosAccess ?? null,
              model: params.model ?? null,
              projectId: target.projectId,
              reasoningEffort: params.reasoningEffort ?? null,
              unsafeMode: params.unsafeMode ?? null,
              webSearchAccess: params.webSearchAccess ?? null,
              worktreePath: target.worktreePath,
            });
            return textToolResult(
              `Requested permission to start a thread for ${target.worktreePath}.`,
              threadStartRequestPayload(request),
            );
          }

          const created = await host.createThread({
            ...(typeof params.agentsAccess === "boolean"
              ? { agentsAccess: params.agentsAccess }
              : {}),
            ...(typeof params.githubAccess === "boolean"
              ? { githubAccess: params.githubAccess }
              : {}),
            ...(typeof params.metidosAccess === "boolean"
              ? { metidosAccess: params.metidosAccess }
              : {}),
            ...(typeof params.model === "string"
              ? { model: params.model }
              : {}),
            projectId: target.projectId,
            ...(typeof params.reasoningEffort === "string"
              ? { reasoningEffort: params.reasoningEffort }
              : {}),
            ...(typeof params.unsafeMode === "boolean"
              ? { unsafeMode: params.unsafeMode }
              : {}),
            ...(typeof params.webSearchAccess === "boolean"
              ? { webSearchAccess: params.webSearchAccess }
              : {}),
            worktreePath: target.worktreePath,
          });
          const started = await host.sendThreadMessage({
            input: params.input,
            threadId: created.thread.id,
          });
          const payload = threadStatusPayload(started, metadata);
          return textToolResult(
            `Started thread ${payload.threadId} (${payload.status}).`,
            payload,
          );
        },
        label: "New Thread",
        name: "new_thread",
        parameters: NewThreadToolParameters,
        prepareArguments: (args) =>
          prepareThreadIdAndBooleanArguments<typeof NewThreadToolParameters>(
            args,
            [
              "agentsAccess",
              "autoStart",
              "githubAccess",
              "metidosAccess",
              "unsafeMode",
              "webSearchAccess",
            ],
            ["projectId"],
          ),
        promptGuidelines: [
          "Use this when the work should continue in a separate Metidos thread or worktree instead of overloading the current transcript.",
        ],
        promptSnippet:
          "Create a new Metidos thread in the current project or worktree",
      }),
    ),
  ];
}
