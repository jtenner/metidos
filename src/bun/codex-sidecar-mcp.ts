import { dirname, isAbsolute, resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import {
  type ThreadRecord,
  getThreadById,
  initAppDatabase,
  renameThread as renameThreadRecord,
  setThreadPinned as setThreadPinnedRecord,
} from "./db";
import type {
  AppRPCSchema,
  RpcProcedureCallOptions,
  RpcRequestPriority,
  RpcThreadDetail,
  RpcThreadStartRequest,
} from "./rpc-schema";

const DEFAULT_RPC_URL = "ws://127.0.0.1:7599/rpc";
const DEFAULT_RPC_TIMEOUT_MS = 30_000;

type RpcRequestMap = AppRPCSchema["requests"];
type RpcMethodName = keyof RpcRequestMap;

type RpcRequestMessage<K extends RpcMethodName = RpcMethodName> = {
  type: "request";
  id: number;
  method: K;
  params: RpcRequestMap[K]["params"];
  priority: RpcRequestPriority;
  timeoutMs?: number;
};

type RpcResponseMessage =
  | {
      type: "response";
      id: number;
      ok: true;
      result: unknown;
    }
  | {
      type: "response";
      id: number;
      ok: false;
      error: string;
    };

type PendingRpcRequest = {
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
};

type ThreadLifecycleStatus = "Turning" | "Errored" | "Stopped" | "Created";

const threadIdContext = readIntegerEnv("JOLT_THREAD_ID");
const projectIdContext = readIntegerEnv("JOLT_PROJECT_ID");
const worktreePathContext = readStringEnv("JOLT_WORKTREE_PATH");
const rpcUrl = readStringEnv("JOLT_RPC_URL") ?? DEFAULT_RPC_URL;
const db = initAppDatabase();

function boundThreadSentence(): string {
  return typeof threadIdContext === "number"
    ? ` Bound thread: ${threadIdContext}.`
    : "";
}

function explicitThreadIdDescription(): string {
  return typeof threadIdContext === "number"
    ? `Required. Use thread ${threadIdContext} for this Codex thread.`
    : "Required Jolt thread id.";
}

function defaultProjectIdDescription(): string {
  return typeof projectIdContext === "number"
    ? `Defaults to project ${projectIdContext}.`
    : "Jolt project id.";
}

function defaultWorktreePathDescription(): string {
  return worktreePathContext
    ? `Defaults to ${worktreePathContext}.`
    : "Required with no worktree context.";
}

class JoltRpcClient {
  private connecting: Promise<WebSocket> | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRpcRequest>();
  private socket: WebSocket | null = null;

  constructor(private readonly url: string) {}

  async call<K extends RpcMethodName>(
    method: K,
    params: RpcRequestMap[K]["params"],
    options?: RpcProcedureCallOptions,
  ): Promise<RpcRequestMap[K]["response"]> {
    const socket = await this.waitForOpenSocket();
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;

    const priority = normalizeRpcRequestPriority(options?.priority);
    const timeoutMs = normalizeTimeoutMs(options?.timeoutMs);
    return new Promise<RpcRequestMap[K]["response"]>(
      (resolveRequest, reject) => {
        const timeoutId =
          timeoutMs === null
            ? null
            : setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(
                  new Error(
                    `RPC "${String(method)}" timed out after ${timeoutMs}ms.`,
                  ),
                );
              }, timeoutMs);

        this.pendingRequests.set(requestId, {
          resolve: (value) => {
            resolveRequest(value as RpcRequestMap[K]["response"]);
          },
          reject,
          timeoutId,
        });

        const message: RpcRequestMessage<K> = {
          type: "request",
          id: requestId,
          method,
          params,
          priority,
          ...(timeoutMs === null ? {} : { timeoutMs }),
        };

        try {
          socket.send(JSON.stringify(message));
        } catch (error) {
          this.clearPendingRequest(requestId);
          reject(error);
        }
      },
    );
  }

  private clearPendingRequest(requestId: number): PendingRpcRequest | null {
    const pending = this.pendingRequests.get(requestId) ?? null;
    if (!pending) {
      return null;
    }
    this.pendingRequests.delete(requestId);
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
    return pending;
  }

  private async waitForOpenSocket(): Promise<WebSocket> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return this.socket;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = new Promise<WebSocket>((resolveSocket, reject) => {
      const nextSocket = new WebSocket(this.url);

      const resetSocket = (reason: unknown) => {
        if (this.socket === nextSocket) {
          this.socket = null;
        }
        if (this.connecting) {
          this.connecting = null;
        }
        reject(reason);
      };

      nextSocket.addEventListener("open", () => {
        this.socket = nextSocket;
        this.connecting = null;
        resolveSocket(nextSocket);
      });

      nextSocket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as RpcResponseMessage;
        if (message.type !== "response") {
          return;
        }
        const pending = this.clearPendingRequest(message.id);
        if (!pending) {
          return;
        }
        if (message.ok) {
          pending.resolve(message.result);
          return;
        }
        pending.reject(new Error(message.error));
      });

      nextSocket.addEventListener("close", () => {
        if (this.socket === nextSocket) {
          this.socket = null;
        }
        if (this.connecting) {
          this.connecting = null;
        }
        const pending = [...this.pendingRequests.keys()];
        for (const requestId of pending) {
          this.clearPendingRequest(requestId)?.reject(
            new Error("Jolt RPC connection closed."),
          );
        }
      });

      nextSocket.addEventListener("error", () => {
        resetSocket(new Error(`Could not connect to Jolt RPC at ${this.url}.`));
      });
    });

    return this.connecting;
  }
}

const rpcClient = new JoltRpcClient(rpcUrl);

function readIntegerEnv(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    return null;
  }
  return Number.parseInt(raw, 10);
}

function readStringEnv(name: string): string | null {
  const raw = process.env[name]?.trim();
  return raw ? raw : null;
}

function normalizeTimeoutMs(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_RPC_TIMEOUT_MS;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeRpcRequestPriority(
  value: RpcRequestPriority | undefined,
): RpcRequestPriority {
  switch (value) {
    case "background":
    case "default":
    case "foreground":
      return value;
    default:
      return "foreground";
  }
}

function canonicalPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Path is required.");
  }

  const baseDirectory = worktreePathContext ?? process.cwd();
  const resolvedPath = isAbsolute(trimmed)
    ? resolve(trimmed)
    : resolve(baseDirectory, trimmed);
  const normalized = resolvedPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function samePath(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right);
}

async function listKnownProjects() {
  return rpcClient.call("listProjects", { includeClosed: true });
}

async function resolveProjectId(params?: {
  projectId?: number | null | undefined;
  projectPath?: string | null | undefined;
}): Promise<number> {
  if (typeof params?.projectId === "number") {
    return params.projectId;
  }

  if (params?.projectPath?.trim()) {
    const projectPath = canonicalPath(params.projectPath);
    const projects = await listKnownProjects();
    const matched = projects.find((project) =>
      samePath(project.path, projectPath),
    );
    if (matched) {
      return matched.id;
    }
    throw new Error(`Project not found: ${params.projectPath}`);
  }

  if (typeof projectIdContext === "number") {
    return projectIdContext;
  }

  throw new Error("projectId or projectPath required with no active project.");
}

async function resolveProjectIdForWorktreePath(
  worktreePath: string,
  preferredProjectId?: number | null,
): Promise<number> {
  if (typeof preferredProjectId === "number") {
    const worktrees = await rpcClient.call("listProjectWorktrees", {
      projectId: preferredProjectId,
    });
    if (
      worktrees.worktrees.some((worktree) =>
        samePath(worktree.path, worktreePath),
      )
    ) {
      return preferredProjectId;
    }
  }

  if (
    typeof projectIdContext === "number" &&
    projectIdContext !== preferredProjectId
  ) {
    const worktrees = await rpcClient.call("listProjectWorktrees", {
      projectId: projectIdContext,
    });
    if (
      worktrees.worktrees.some((worktree) =>
        samePath(worktree.path, worktreePath),
      )
    ) {
      return projectIdContext;
    }
  }

  for (const project of await listKnownProjects()) {
    if (
      typeof preferredProjectId === "number" &&
      project.id === preferredProjectId
    ) {
      continue;
    }
    if (
      typeof projectIdContext === "number" &&
      project.id === projectIdContext
    ) {
      continue;
    }
    const worktrees = await rpcClient.call("listProjectWorktrees", {
      projectId: project.id,
    });
    if (
      worktrees.worktrees.some((worktree) =>
        samePath(worktree.path, worktreePath),
      )
    ) {
      return project.id;
    }
  }

  throw new Error(`Worktree not found: ${worktreePath}`);
}

async function resolveWorktreeTarget(params?: {
  projectId?: number | null | undefined;
  projectPath?: string | null | undefined;
  worktreePath?: string | null | undefined;
}): Promise<{
  projectId: number;
  projectPath: string | null;
  worktreePath: string;
}> {
  if (params?.worktreePath?.trim()) {
    const worktreePath = canonicalPath(params.worktreePath);
    const explicitProjectId = await resolveProjectId({
      projectId: params.projectId ?? null,
      projectPath: params.projectPath ?? null,
    }).catch(() => null);
    const projectId = await resolveProjectIdForWorktreePath(
      worktreePath,
      explicitProjectId,
    );
    return {
      projectId,
      projectPath:
        (await listKnownProjects()).find((project) => project.id === projectId)
          ?.path ?? null,
      worktreePath,
    };
  }

  if (typeof projectIdContext === "number" && worktreePathContext) {
    const projectPath =
      (await listKnownProjects()).find(
        (project) => project.id === projectIdContext,
      )?.path ?? null;
    return {
      projectId: projectIdContext,
      projectPath,
      worktreePath: worktreePathContext,
    };
  }

  throw new Error("worktreePath required with no active worktree.");
}

function requireThreadId(threadId?: number | null): number {
  if (typeof threadId === "number") {
    return threadId;
  }
  throw new Error("threadId is required.");
}

function normalizeOptionalSummary(
  summary: string | null | undefined,
): string | null | undefined {
  if (typeof summary === "undefined") {
    return undefined;
  }
  return summary?.trim() || null;
}

function updateThreadMetadataLocally(
  threadId: number,
  title?: string,
  summary?: string | null,
  pinned?: boolean,
) {
  const existingThread = getThreadById(db, threadId);
  if (!existingThread) {
    throw new Error(`Thread not found: ${threadId}`);
  }

  const normalizedSummary = normalizeOptionalSummary(summary);
  if (
    typeof title !== "undefined" ||
    typeof normalizedSummary !== "undefined"
  ) {
    renameThreadRecord(
      db,
      threadId,
      title ?? existingThread.title,
      normalizedSummary,
    );
  }

  if (typeof pinned === "boolean") {
    setThreadPinnedRecord(db, threadId, pinned);
  }

  const thread = getThreadById(db, threadId);
  if (!thread) {
    throw new Error(`Thread not found: ${threadId}`);
  }
  return thread;
}

function refreshThreadMetadataInApp(
  thread: ThreadRecord,
  title?: string,
  summary?: string | null,
  pinned?: boolean,
): void {
  const normalizedSummary = normalizeOptionalSummary(summary);
  if (
    typeof title !== "undefined" ||
    typeof normalizedSummary !== "undefined"
  ) {
    void rpcClient
      .call(
        "renameThread",
        {
          threadId: thread.id,
          title: thread.title,
          ...(typeof normalizedSummary === "undefined"
            ? {}
            : { summary: thread.summary }),
        },
        { priority: "background", timeoutMs: 1_500 },
      )
      .catch(() => {});
  }

  if (typeof pinned === "boolean") {
    void rpcClient
      .call(
        "setThreadPinned",
        { threadId: thread.id, pinned },
        { priority: "background", timeoutMs: 1_500 },
      )
      .catch(() => {});
  }
}

function summarizeThreadStatus(detail: RpcThreadDetail): ThreadLifecycleStatus {
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

function threadMetadataPayload(
  thread:
    | RpcThreadDetail["thread"]
    | Pick<
        ThreadRecord,
        "id" | "projectId" | "worktreePath" | "title" | "summary" | "pinnedAt"
      >,
) {
  return {
    threadId: thread.id,
    projectId: thread.projectId,
    worktreePath: thread.worktreePath,
    title: thread.title,
    summary: thread.summary,
    pinned: thread.pinnedAt !== null,
    pinnedAt: thread.pinnedAt,
  };
}

function threadStatusPayload(
  detail: RpcThreadDetail,
  metadata: {
    input: string;
    model: string | null;
    reasoningEffort:
      | AppRPCSchema["requests"]["createThread"]["params"]["reasoningEffort"]
      | null;
    unsafeMode: boolean | null;
    autoStart: boolean | null;
    projectPath: string | null;
  },
) {
  return {
    ...threadMetadataPayload(detail.thread),
    projectPath: metadata.projectPath,
    input: metadata.input,
    model: metadata.model,
    reasoningEffort: metadata.reasoningEffort,
    unsafeMode: metadata.unsafeMode,
    autoStart: metadata.autoStart,
    requestId: null,
    createdAt: null,
    status: summarizeThreadStatus(detail),
    runState: detail.thread.runStatus.state,
    error: detail.thread.runStatus.error,
    hasUnreadError: detail.thread.runStatus.hasUnreadError,
    lastRunAt: detail.thread.lastRunAt,
  };
}

function threadStartRequestPayload(request: RpcThreadStartRequest) {
  return {
    ...request,
    status: null,
    runState: null,
    error: null,
    hasUnreadError: null,
    lastRunAt: null,
  };
}

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    ...(typeof structuredContent === "undefined" ? {} : { structuredContent }),
  };
}

function safeMetadataAnnotations() {
  return {
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true,
  };
}

const server = new McpServer({
  name: "jolt",
  version: "0.0.1",
});

server.registerTool(
  "modify_thread",
  {
    title: "Modify Thread",
    description: `Update Jolt thread metadata. Use this liberally to keep threads organized: every thread should get a concise title, including quick one-off tasks, and you should reuse this tool whenever a better title, a short summary, or pinning and unpinning would make the thread easier to scan.${boundThreadSentence()}`,
    inputSchema: {
      title: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Short title. Supply one for every thread, including quick one-off tasks. Omit only when updating other metadata without changing the title.",
        ),
      summary: z
        .string()
        .optional()
        .describe(
          "Optional thread summary. Empty clears it. Omit to leave unchanged.",
        ),
      pinned: z
        .boolean()
        .optional()
        .describe(
          "Optional pinned state. Set true to pin, false to unpin, or omit to leave the pinned state unchanged.",
        ),
      threadId: z
        .number()
        .int()
        .positive()
        .describe(explicitThreadIdDescription()),
    },
    // Treat metadata updates as safe UI changes so Codex can run them freely.
    annotations: safeMetadataAnnotations(),
  },
  async ({ pinned, summary, threadId, title }) => {
    const resolvedThreadId = requireThreadId(threadId);
    if (
      typeof title === "undefined" &&
      typeof summary === "undefined" &&
      typeof pinned === "undefined"
    ) {
      throw new Error("At least one of title, summary, or pinned is required.");
    }

    const thread = updateThreadMetadataLocally(
      resolvedThreadId,
      title,
      summary,
      pinned,
    );
    // Refresh the live app cache without blocking the tool result.
    refreshThreadMetadataInApp(thread, title, summary, pinned);
    return textResult(`Updated thread ${thread.id}.`, {
      threadId: thread.id,
      title: thread.title,
      summary: thread.summary,
      pinned: thread.pinnedAt !== null,
      pinnedAt: thread.pinnedAt,
    });
  },
);

server.registerTool(
  "new_thread",
  {
    title: "New Thread",
    description:
      "Start a separate Jolt thread. Use sparingly for distinct work or a different worktree. Set autoStart to true to ask the UI for permission before creating the thread; if unsafeMode is true, the thread starts immediately instead of waiting for a popup.",
    inputSchema: {
      input: z.string().trim().min(1).describe("Initial prompt."),
      projectId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(`${defaultProjectIdDescription()} Omit for null metadata.`),
      projectPath: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Project path if projectId is unknown. Omit for null metadata.",
        ),
      worktreePath: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          `${defaultWorktreePathDescription()} Omit for null metadata.`,
        ),
      model: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Model override. Omit for null metadata."),
      reasoningEffort: z
        .enum(["minimal", "low", "medium", "high", "xhigh"])
        .optional()
        .describe("Reasoning override. Omit for null metadata."),
      unsafeMode: z
        .boolean()
        .optional()
        .describe(
          "Use the danger-full-access sandbox for the new thread. Omit for null metadata.",
        ),
      autoStart: z
        .boolean()
        .optional()
        .describe(
          "When true, request permission in the UI before creating the thread. If unsafeMode is true, the thread starts immediately. Omit for null metadata.",
        ),
    },
    annotations: {
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  async ({
    autoStart,
    input,
    model,
    projectId,
    projectPath,
    reasoningEffort,
    unsafeMode,
    worktreePath,
  }) => {
    const target = await resolveWorktreeTarget({
      projectId,
      projectPath,
      worktreePath,
    });
    const metadata = {
      input,
      model: model ?? null,
      reasoningEffort: reasoningEffort ?? null,
      unsafeMode: unsafeMode ?? null,
      autoStart: autoStart ?? null,
      projectPath: target.projectPath,
    };

    if (autoStart === true && unsafeMode !== true) {
      const request = await rpcClient.call("requestThreadStart", {
        projectId: target.projectId,
        worktreePath: target.worktreePath,
        input,
        model: metadata.model,
        reasoningEffort: metadata.reasoningEffort,
        unsafeMode: metadata.unsafeMode,
        autoStart: metadata.autoStart,
      });
      const payload = threadStartRequestPayload(request);
      return textResult(
        `Requested permission to start a thread for ${target.worktreePath}.`,
        payload,
      );
    }

    const created = await rpcClient.call("createThread", {
      projectId: target.projectId,
      worktreePath: target.worktreePath,
      model: metadata.model,
      reasoningEffort: metadata.reasoningEffort,
      unsafeMode: metadata.unsafeMode,
    });
    const started = await rpcClient.call("sendThreadMessage", {
      threadId: created.thread.id,
      input,
    });
    const payload = threadStatusPayload(started, metadata);
    return textResult(
      `Started thread ${payload.threadId} (${payload.status}).`,
      payload,
    );
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main().catch((error) => {
  console.error("Jolt sidecar MCP server failed", error);
  process.exit(1);
});
