/**
 * @file src/bun/pi-metidos-tools.ts
 * @description Pi-native Metidos tool definitions replacing the Codex MCP sidecar path.
 */

import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { type Static, type TSchema, Type } from "@sinclair/typebox";
import type {
  AppRPCSchema,
  RpcContextFocusChanged,
  RpcCronJob,
  RpcProject,
  RpcThread,
  RpcThreadDetail,
  RpcThreadStartRequest,
  RpcWorktree,
} from "./rpc-schema";
import { updateThreadMetadataFromSidecar } from "./sidecar-thread-metadata";
import {
  canonicalizeThreadToolPath,
  enforceBoundThreadScope,
  enforceTargetScope,
} from "./thread-tool-scope";
import {
  formatVm2ExecutionReportText,
  runUntrustedJavaScriptInVm2,
} from "./vm2-runner";

type ListThreadsRow = {
  pinned: boolean;
  projectId: number;
  projectName: string;
  projectPath: string;
  runState: RpcThread["runStatus"]["state"];
  summary: string | null;
  threadId: number;
  title: string;
  updatedAt: string;
  workspaceName: string;
  workspacePath: string;
};

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

export type PiMetidosToolScope = {
  allowUnsafeModeEscalation: boolean;
  projectIdContext: number;
  threadIdContext: number;
  worktreePathContext: string;
};

export type PiMetidosToolHost = {
  createThread: (
    params: AppRPCSchema["requests"]["createThread"]["params"],
  ) => Promise<RpcThreadDetail>;
  focusContext: (
    params: AppRPCSchema["requests"]["focusContext"]["params"],
    signal?: AbortSignal,
  ) => Promise<RpcContextFocusChanged>;
  listCrons: () => Promise<RpcCronJob[]>;
  listProjectWorktrees: (
    params: AppRPCSchema["requests"]["listProjectWorktrees"]["params"],
    signal?: AbortSignal,
  ) => Promise<RpcWorktree[]>;
  listProjects: () => Promise<RpcProject[]>;
  listThreads: () => Promise<RpcThread[]>;
  newCron: (
    params: AppRPCSchema["requests"]["newCron"]["params"],
  ) => Promise<RpcCronJob>;
  requestThreadStart: (
    params: AppRPCSchema["requests"]["requestThreadStart"]["params"],
  ) => Promise<RpcThreadStartRequest>;
  sendThreadMessage: (
    params: AppRPCSchema["requests"]["sendThreadMessage"]["params"],
  ) => Promise<RpcThreadDetail>;
  updateCron: (
    params: AppRPCSchema["requests"]["updateCron"]["params"],
  ) => Promise<RpcCronJob>;
  updateThreadMetadata: (
    params: AppRPCSchema["requests"]["updateThreadMetadata"]["params"],
  ) => Promise<RpcThread>;
};

const PI_THINKING_LEVEL_VALUES = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

const SUPPORTED_MODELS_SENTENCE =
  "Supported models are loaded from the Pi-backed catalog.";
const UPDATE_THREAD_IGNORED_ACCESS_FIELDS = [
  "webSearchAccess",
  "githubAccess",
  "agentsAccess",
  "metidosAccess",
  "unsafeMode",
] as const;

const NullableString = Type.Union([Type.String(), Type.Null()]);
const PositiveInteger = Type.Integer({ minimum: 1 });
const ThinkingLevel = Type.Union(
  PI_THINKING_LEVEL_VALUES.map((value) => Type.Literal(value)),
);
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

function canonicalPath(value: string, scope: PiMetidosToolScope): string {
  return canonicalizeThreadToolPath(value, {
    baseDirectory: scope.worktreePathContext,
  });
}

function samePath(
  left: string,
  right: string,
  scope: PiMetidosToolScope,
): boolean {
  return canonicalPath(left, scope) === canonicalPath(right, scope);
}

function normalizeLookupValue(value: string): string {
  return value.trim().toLowerCase();
}

function shortName(value: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? normalized;
}

function normalizeThreadIdInput(
  threadId: string | number | null | undefined,
): number | null {
  if (typeof threadId === "number") {
    if (!Number.isInteger(threadId) || threadId <= 0) {
      throw new Error("threadId must be a positive integer.");
    }
    return threadId;
  }

  if (typeof threadId !== "string") {
    return null;
  }

  const trimmed = threadId.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d+$/u.test(trimmed)) {
    throw new Error("threadId must be a positive integer.");
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("threadId must be a positive integer.");
  }
  return parsed;
}

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

function summarizeThreadStatus(detail: RpcThreadDetail): string {
  switch (detail.thread.runStatus.state) {
    case "working":
      return "Turning";
    case "failed":
      return "Errored";
    default:
      return detail.thread.lastRunAt === null && detail.messages.length === 0
        ? "Created"
        : "Stopped";
  }
}

function threadMetadataPayload(thread: RpcThreadDetail["thread"] | RpcThread) {
  return {
    agentsAccess: thread.agentsAccess,
    githubAccess: thread.githubAccess,
    metidosAccess: thread.metidosAccess,
    pinned: thread.pinnedAt !== null,
    pinnedAt: thread.pinnedAt,
    projectId: thread.projectId,
    summary: thread.summary,
    threadId: thread.id,
    title: thread.title,
    unsafeMode: thread.unsafeMode,
    webSearchAccess: thread.webSearchAccess,
    worktreePath: thread.worktreePath,
  };
}

function threadStatusPayload(
  detail: RpcThreadDetail,
  metadata: {
    autoStart: boolean | null;
    input: string;
    model: string | null;
    projectPath: string | null;
    reasoningEffort:
      | AppRPCSchema["requests"]["createThread"]["params"]["reasoningEffort"]
      | null;
    unsafeMode: boolean | null;
  },
) {
  return {
    ...threadMetadataPayload(detail.thread),
    autoStart: metadata.autoStart,
    createdAt: null,
    error: detail.thread.runStatus.error,
    hasUnreadError: detail.thread.runStatus.hasUnreadError,
    input: metadata.input,
    lastRunAt: detail.thread.lastRunAt,
    model: metadata.model,
    projectPath: metadata.projectPath,
    reasoningEffort: metadata.reasoningEffort,
    requestId: null,
    runState: detail.thread.runStatus.state,
    status: summarizeThreadStatus(detail),
    unsafeMode: metadata.unsafeMode,
  };
}

function threadStartRequestPayload(request: RpcThreadStartRequest) {
  return {
    ...request,
    error: null,
    hasUnreadError: null,
    lastRunAt: null,
    runState: null,
    status: null,
  };
}

function cronJobPayload(cronJob: RpcCronJob) {
  return {
    agentsAccess: cronJob.agentsAccess,
    createdAt: cronJob.createdAt,
    cronJobId: cronJob.id,
    deletedAt: cronJob.deletedAt,
    description: cronJob.description,
    enabled: cronJob.enabled,
    githubAccess: cronJob.githubAccess,
    metidosAccess: cronJob.metidosAccess,
    lastRunDate: cronJob.lastRunDate,
    lastRunStatus: cronJob.lastRunStatus,
    nextRunDate: cronJob.nextRunDate,
    projectId: cronJob.projectId,
    prompt: cronJob.prompt,
    schedule: cronJob.schedule,
    title: cronJob.title,
    unsafeMode: cronJob.unsafeMode,
    updatedAt: cronJob.updatedAt,
    webSearchAccess: cronJob.webSearchAccess,
    worktreePath: cronJob.worktreePath,
  };
}

function textToolResult<TDetails>(
  text: string,
  details: TDetails,
): AgentToolResult<TDetails> {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function coerceBooleanLikeInput(value: unknown): unknown {
  if (typeof value === "undefined" || value === null) {
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }
  return value;
}

function coercePositiveIntegerLikeInput(value: unknown): unknown {
  if (typeof value === "undefined" || value === null) {
    return value;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (!/^\d+$/u.test(normalized)) {
    return value;
  }
  return Number.parseInt(normalized, 10);
}

function prepareThreadIdAndBooleanArguments<TParams extends TSchema>(
  value: unknown,
  booleanKeys: readonly string[],
  integerKeys: readonly string[] = [],
): Static<TParams> {
  if (!value || typeof value !== "object") {
    return value as Static<TParams>;
  }

  const record = { ...(value as Record<string, unknown>) };
  for (const key of booleanKeys) {
    record[key] = coerceBooleanLikeInput(record[key]);
  }
  for (const key of integerKeys) {
    record[key] = coercePositiveIntegerLikeInput(record[key]);
  }
  return record as Static<TParams>;
}

function assertUnsafeModeEscalationAllowed(
  scope: PiMetidosToolScope,
  requestedUnsafeMode: boolean | null | undefined,
): void {
  if (requestedUnsafeMode === true && !scope.allowUnsafeModeEscalation) {
    throw new Error(
      "Unsafe mode is disabled for the current thread. This thread cannot create or update unsafe child threads or cron jobs.",
    );
  }
}

async function resolveProjectByName(
  projectName: string,
  host: PiMetidosToolHost,
  scope: PiMetidosToolScope,
): Promise<{ project: RpcProject; worktrees: RpcWorktree[] }> {
  const normalizedName = normalizeLookupValue(projectName);
  const looksLikePath =
    /[\\/]/u.test(projectName) ||
    projectName.startsWith(".") ||
    projectName.startsWith("~");
  const projects = await host.listProjects();
  const exactNameMatches = projects.filter(
    (project) =>
      normalizeLookupValue(project.name) === normalizedName ||
      normalizeLookupValue(shortName(project.path)) === normalizedName,
  );
  const pathMatches = looksLikePath
    ? projects.filter((project) => samePath(project.path, projectName, scope))
    : [];
  const matches =
    pathMatches.length > 0
      ? pathMatches
      : exactNameMatches.length > 0
        ? exactNameMatches
        : [];

  if (matches.length === 0) {
    throw new Error(`Project not found: ${projectName}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Project name is ambiguous: ${projectName}. Matches: ${matches
        .map((project) => `${project.name} (${project.path})`)
        .join(", ")}.`,
    );
  }

  const project = matches[0];
  if (!project) {
    throw new Error(`Project not found: ${projectName}`);
  }
  const worktrees = await host.listProjectWorktrees({
    projectId: project.id,
  });
  return {
    project,
    worktrees,
  };
}

function resolveWorkspaceForProject(
  project: RpcProject,
  worktrees: RpcWorktree[],
  scope: PiMetidosToolScope,
  workspaceName?: string | null,
): RpcWorktree {
  if (typeof workspaceName !== "string" || !workspaceName.trim()) {
    if (worktrees.length === 0) {
      throw new Error(`No worktrees found in project ${project.name}.`);
    }
    const primaryWorktree =
      worktrees.find((worktree) =>
        samePath(worktree.path, project.path, scope),
      ) ?? worktrees[0];
    if (!primaryWorktree) {
      throw new Error(`No worktrees found in project ${project.name}.`);
    }
    return primaryWorktree;
  }

  const trimmedWorkspaceName = workspaceName.trim();
  const normalizedWorkspaceName = normalizeLookupValue(trimmedWorkspaceName);
  const candidates = worktrees.filter((worktree) => {
    if (samePath(worktree.path, trimmedWorkspaceName, scope)) {
      return true;
    }

    if (
      normalizeLookupValue(worktree.branch ?? "") === normalizedWorkspaceName
    ) {
      return true;
    }

    if (
      normalizeLookupValue(shortName(worktree.path)) === normalizedWorkspaceName
    ) {
      return true;
    }

    if (
      samePath(worktree.path, project.path, scope) &&
      normalizedWorkspaceName === "primary"
    ) {
      return true;
    }

    return false;
  });

  if (candidates.length === 0) {
    throw new Error(
      `Workspace not found in project ${project.name}: ${workspaceName}`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Workspace name is ambiguous in project ${project.name}: ${workspaceName}. Matches: ${candidates
        .map((worktree) => `${worktree.branch ?? "Primary"} (${worktree.path})`)
        .join(", ")}.`,
    );
  }

  const workspace = candidates[0];
  if (!workspace) {
    throw new Error(`Workspace not found in project ${project.name}.`);
  }
  return workspace;
}

async function resolveFocusContextTarget(
  options: {
    project: string;
    threadId?: string | number | null | undefined;
    workspace?: string | null | undefined;
  },
  host: PiMetidosToolHost,
  scope: PiMetidosToolScope,
): Promise<{
  project: RpcProject;
  threadId: number | null;
  worktree: RpcWorktree;
}> {
  const projectResolution = await resolveProjectByName(
    options.project,
    host,
    scope,
  );
  const requestedThreadId = normalizeThreadIdInput(options.threadId);
  if (requestedThreadId !== null) {
    enforceBoundThreadScope(requestedThreadId, scope.threadIdContext);
  }

  let resolvedThread: RpcThread | null = null;
  if (requestedThreadId !== null) {
    const threads = await host.listThreads();
    resolvedThread =
      threads.find((thread) => thread.id === requestedThreadId) ?? null;
    if (!resolvedThread) {
      throw new Error(`Thread not found: ${requestedThreadId}`);
    }
    if (resolvedThread.projectId !== projectResolution.project.id) {
      throw new Error(
        `Thread ${requestedThreadId} does not belong to project ${projectResolution.project.name}.`,
      );
    }
  }

  const worktree =
    requestedThreadId !== null && !options.workspace
      ? (projectResolution.worktrees.find((candidate) =>
          samePath(candidate.path, resolvedThread?.worktreePath ?? "", scope),
        ) ??
        resolveWorkspaceForProject(
          projectResolution.project,
          projectResolution.worktrees,
          scope,
          resolvedThread?.worktreePath ?? null,
        ))
      : resolveWorkspaceForProject(
          projectResolution.project,
          projectResolution.worktrees,
          scope,
          options.workspace ?? null,
        );

  enforceTargetScope({
    projectIdContext: scope.projectIdContext,
    targetProjectId: projectResolution.project.id,
    targetWorktreePath: worktree.path,
    worktreePathContext: scope.worktreePathContext,
  });

  if (
    resolvedThread &&
    !samePath(worktree.path, resolvedThread.worktreePath, scope)
  ) {
    throw new Error(
      `Thread ${requestedThreadId} does not belong to workspace ${worktree.path}.`,
    );
  }

  return {
    project: projectResolution.project,
    threadId: resolvedThread?.id ?? null,
    worktree,
  };
}

async function buildThreadListRows(
  options: {
    projectName: string;
    workspaceName?: string | null | undefined;
  },
  host: PiMetidosToolHost,
  scope: PiMetidosToolScope,
): Promise<{
  project: RpcProject;
  rows: ListThreadsRow[];
  workspace: RpcWorktree | null;
}> {
  const projectResolution = await resolveProjectByName(
    options.projectName,
    host,
    scope,
  );
  const workspace = options.workspaceName
    ? resolveWorkspaceForProject(
        projectResolution.project,
        projectResolution.worktrees,
        scope,
        options.workspaceName,
      )
    : null;
  const threads = await host.listThreads();
  const rows = threads
    .filter(
      (thread) =>
        thread.projectId === projectResolution.project.id &&
        (workspace === null ||
          samePath(thread.worktreePath, workspace.path, scope)),
    )
    .map((thread) => {
      const worktree =
        projectResolution.worktrees.find((entry) =>
          samePath(entry.path, thread.worktreePath, scope),
        ) ?? null;
      return {
        pinned: thread.pinnedAt !== null,
        projectId: thread.projectId,
        projectName: projectResolution.project.name,
        projectPath: projectResolution.project.path,
        runState: thread.runStatus.state,
        summary: thread.summary,
        threadId: thread.id,
        title: thread.title,
        updatedAt: thread.updatedAt,
        workspaceName:
          worktree?.branch?.trim() ||
          (samePath(thread.worktreePath, projectResolution.project.path, scope)
            ? "Primary"
            : shortName(thread.worktreePath)),
        workspacePath: thread.worktreePath,
      } satisfies ListThreadsRow;
    });

  return {
    project: projectResolution.project,
    rows,
    workspace,
  };
}

async function resolveProjectId(
  params: {
    projectId?: number | null | undefined;
    projectPath?: string | null | undefined;
  },
  host: PiMetidosToolHost,
  scope: PiMetidosToolScope,
): Promise<number> {
  if (typeof params.projectId === "number") {
    return params.projectId;
  }

  if (params.projectPath?.trim()) {
    const projectPath = canonicalPath(params.projectPath, scope);
    const projects = await host.listProjects();
    const matched = projects.find((project) =>
      samePath(project.path, projectPath, scope),
    );
    if (matched) {
      return matched.id;
    }
    throw new Error(`Project not found: ${params.projectPath}`);
  }

  return scope.projectIdContext;
}

async function resolveProjectIdForWorktreePath(
  worktreePath: string,
  host: PiMetidosToolHost,
  scope: PiMetidosToolScope,
  preferredProjectId?: number | null,
): Promise<number> {
  if (typeof preferredProjectId === "number") {
    const worktrees = await host.listProjectWorktrees({
      projectId: preferredProjectId,
    });
    if (
      worktrees.some((worktree) => samePath(worktree.path, worktreePath, scope))
    ) {
      return preferredProjectId;
    }
  }

  if (scope.projectIdContext !== preferredProjectId) {
    const worktrees = await host.listProjectWorktrees({
      projectId: scope.projectIdContext,
    });
    if (
      worktrees.some((worktree) => samePath(worktree.path, worktreePath, scope))
    ) {
      return scope.projectIdContext;
    }
  }

  for (const project of await host.listProjects()) {
    if (
      project.id === preferredProjectId ||
      project.id === scope.projectIdContext
    ) {
      continue;
    }
    const worktrees = await host.listProjectWorktrees({
      projectId: project.id,
    });
    if (
      worktrees.some((worktree) => samePath(worktree.path, worktreePath, scope))
    ) {
      return project.id;
    }
  }

  throw new Error(`Worktree not found: ${worktreePath}`);
}

async function resolveWorktreeTarget(
  params: {
    projectId?: number | null | undefined;
    projectPath?: string | null | undefined;
    worktreePath?: string | null | undefined;
  },
  host: PiMetidosToolHost,
  scope: PiMetidosToolScope,
): Promise<{
  projectId: number;
  projectPath: string | null;
  worktreePath: string;
}> {
  if (params.worktreePath?.trim()) {
    const worktreePath = canonicalPath(params.worktreePath, scope);
    const explicitProjectId = await resolveProjectId(
      {
        projectId: params.projectId ?? null,
        projectPath: params.projectPath ?? null,
      },
      host,
      scope,
    ).catch(() => null);
    const projectId = await resolveProjectIdForWorktreePath(
      worktreePath,
      host,
      scope,
      explicitProjectId,
    );
    const projectPath =
      (await host.listProjects()).find((project) => project.id === projectId)
        ?.path ?? null;
    enforceTargetScope({
      projectIdContext: scope.projectIdContext,
      targetProjectId: projectId,
      targetWorktreePath: worktreePath,
      worktreePathContext: scope.worktreePathContext,
    });
    return {
      projectId,
      projectPath,
      worktreePath,
    };
  }

  return {
    projectId: scope.projectIdContext,
    projectPath:
      (await host.listProjects()).find(
        (project) => project.id === scope.projectIdContext,
      )?.path ?? null,
    worktreePath: scope.worktreePathContext,
  };
}

export function createPiMetidosTools(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
): ToolDefinition[] {
  return [
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
      parameters: Type.Object({
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
      }),
      promptGuidelines: [
        "Use this before creating or focusing another thread when you need to inspect existing work in the same project.",
      ],
      promptSnippet: "List Metidos threads in a project or worktree",
    }),
    defineTool({
      description:
        "Execute untrusted JavaScript or TypeScript inside a vm2 NodeVM sandbox. The sandboxed fs mock is read-only outside the current worktree and writable only inside it.",
      execute: async (_toolCallId, params) => {
        const report = await runUntrustedJavaScriptInVm2({
          code: params.code,
          ...(typeof params.timeoutMs === "number"
            ? { timeoutMs: params.timeoutMs }
            : {}),
          worktreePath: scope.worktreePathContext,
        });
        return textToolResult(formatVm2ExecutionReportText(report), report);
      },
      label: "Run Untrusted JS",
      name: "run_untrusted_js",
      parameters: Type.Object({
        code: Type.String({
          description: "TypeScript or JavaScript source to execute.",
          minLength: 1,
        }),
        timeoutMs: Type.Optional(
          Type.Number({
            description: "Sandbox timeout in milliseconds. Defaults to 60000.",
            minimum: 1,
          }),
        ),
      }),
      promptGuidelines: [
        "Use this only when sandboxed computation or scripted analysis is better than a direct edit, grep, or shell command.",
      ],
      promptSnippet: "Run sandboxed JavaScript or TypeScript inside Metidos",
    }),
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
            ...(target.threadId === null ? {} : { threadId: target.threadId }),
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
    defineTool({
      description: `Create a new cron job bound to a project workspace. The run prompt is reused for each fire time. Access flags mirror thread controls. Safe threads must leave unsafeMode off. ${SUPPORTED_MODELS_SENTENCE}`,
      execute: async (_toolCallId, params) => {
        assertUnsafeModeEscalationAllowed(scope, params.unsafeMode);
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
        assertUnsafeModeEscalationAllowed(scope, params.unsafeMode);
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
    defineTool<typeof NewThreadToolParameters, Record<string, unknown>>({
      description: `Start a separate Metidos thread for distinct work or another git worktree. Bound sessions cannot escape their current project/worktree. Set autoStart=true to request permission first; unsafeMode skips that request path. Safe threads must leave unsafeMode off. Access flags mirror thread controls. ${SUPPORTED_MODELS_SENTENCE}`,
      execute: async (_toolCallId, params) => {
        assertUnsafeModeEscalationAllowed(scope, params.unsafeMode);
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
          ...(typeof params.model === "string" ? { model: params.model } : {}),
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
  ];
}
