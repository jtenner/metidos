/**
 * @file src/bun/codex-sidecar-mcp.ts
 * @description Module for codex sidecar mcp.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import {
  canonicalizeSidecarPath,
  enforceBoundThreadScope,
  enforceTargetScope,
} from "./codex-sidecar-scope";
import { createSubsystemLogger } from "./logging";
import type {
  AppRPCSchema,
  RpcCronJob,
  RpcProcedureCallOptions,
  RpcProject,
  RpcRequestPriority,
  RpcThread,
  RpcThreadDetail,
  RpcThreadStartRequest,
  RpcWorktree,
} from "./rpc-schema";
import { updateThreadMetadataFromSidecar } from "./sidecar-thread-metadata";
import {
  formatVm2ExecutionReportText,
  runUntrustedJavaScriptInVm2,
} from "./vm2-runner";

const DEFAULT_RPC_URL = "ws://127.0.0.1:7599/rpc";
/** Default request timeout in milliseconds when no timeout override is supplied. */
const DEFAULT_RPC_TIMEOUT_MS = 30_000;

/** RPC request mapping from the shared schema, used for typed method dispatch. */

type RpcRequestMap = AppRPCSchema["requests"];
/** Known RPC method names supported by the sidecar client. */
type RpcMethodName = keyof RpcRequestMap;

type RpcRequestMessage<K extends RpcMethodName = RpcMethodName> = {
  type: "request";
  id: number;
  method: K;
  params: RpcRequestMap[K]["params"];
  priority: RpcRequestPriority;
  timeoutMs?: number;
};

/** Response message shapes emitted by RPC for successful and failed calls. */

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

/** Internal metadata for a pending request awaiting a socket response. */
type PendingRpcRequest = {
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
};

/** Localized lifecycle label used by tool-facing payloads. */

type ThreadLifecycleStatus = "Turning" | "Errored" | "Stopped" | "Created";

const threadIdContext = readIntegerEnv("JOLT_THREAD_ID");
const projectIdContext = readIntegerEnv("JOLT_PROJECT_ID");
const worktreePathContext = readStringEnv("JOLT_WORKTREE_PATH");
const rpcUrl = readStringEnv("JOLT_RPC_URL") ?? DEFAULT_RPC_URL;
const rpcHttpOrigin =
  readStringEnv("JOLT_RPC_HTTP_ORIGIN") ?? deriveRpcHttpOrigin(rpcUrl);
const sessionIdContext = readStringEnv("JOLT_SESSION_ID");
const sidecarLogger = createSubsystemLogger("MCP Sidecar");

/** Description suffix when a thread id binding is present in environment. */
function boundThreadSentence(): string {
  return typeof threadIdContext === "number"
    ? ` Bound thread: ${threadIdContext}.`
    : "";
}

/** Input description for thread id with explicit context fallback text. */

function explicitThreadIdDescription(): string {
  return typeof threadIdContext === "number"
    ? `Required. Use thread ${threadIdContext} for this Codex thread.`
    : "Required Jolt thread id.";
}

/** Description text for project id defaults in generated tool schemas. */
function defaultProjectIdDescription(): string {
  return typeof projectIdContext === "number"
    ? `Defaults to project ${projectIdContext}.`
    : "Jolt project id.";
}

/** Description text for worktree path defaults in generated tool schemas. */

function defaultWorktreePathDescription(): string {
  return worktreePathContext
    ? `Defaults to git worktree ${worktreePathContext}.`
    : "Git worktree path.";
}

/**
 * Derives the HTTP origin paired with a websocket RPC URL.
 *
 * The derived origin is used for `/auth/ws-ticket` so ticket exchange happens on the same
 * server family (http/https vs ws/wss).
 * @param value - RPC websocket URL.
 */
export function deriveRpcHttpOrigin(value: string): string {
  const url = new URL(value);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

/**
 * Builds a session cookie header value for websocket-authenticated requests.
 *
 * This is attached to both `/auth/ws-ticket` and authenticated `/rpc` connections.
 * @param sessionId - Session identifier.
 */
export function buildSessionCookieHeader(sessionId: string): string {
  return `jolt_session=${sessionId}`;
}

/**
 * Builds the websocket ticket cookie pair used during authenticated RPC upgrades.
 * @param ticketId - Ticket identifier.
 */
export function buildWebSocketTicketCookieHeader(ticketId: string): string {
  return `jolt_ws_ticket=${ticketId}`;
}

/**
 * Builds the combined Cookie header used for authenticated RPC upgrades.
 * @param sessionId - Session identifier.
 * @param ticketId - Ticket identifier.
 */
export function buildRpcSocketCookieHeader(
  sessionId: string,
  ticketId: string,
): string {
  return `${buildSessionCookieHeader(sessionId)}; ${buildWebSocketTicketCookieHeader(ticketId)}`;
}

type RpcSocketConnectionDetails = {
  headers?: Record<string, string>;
  url: string;
};

type WebSocketTicket = {
  expiresAt: string;
  ticket: string;
};

type WebSocketTicketMetadata = {
  expiresAt: string;
};

/**
 * Parses a websocket-ticket response payload.
 * @param value - Response payload.
 */
function readWebSocketTicketMetadata(
  value: unknown,
): WebSocketTicketMetadata | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  if (payload.ok !== true || typeof payload.ticket !== "object") {
    return null;
  }
  const ticket = payload.ticket as Record<string, unknown>;
  if (typeof ticket.expiresAt !== "string") {
    return null;
  }
  return {
    expiresAt: ticket.expiresAt,
  };
}

/**
 * Extract the websocket ticket cookie value from a Set-Cookie header.
 * @param value - Set-Cookie header value.
 */
function readTicketIdFromSetCookie(value: string | null): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const [cookiePair] = value.split(";");
  if (!cookiePair) {
    return null;
  }

  const [name, ...valueParts] = cookiePair.trim().split("=");
  if (name !== "jolt_ws_ticket") {
    return null;
  }
  return valueParts.join("=") || null;
}

/**
 * Extracts a readable failure message from a websocket-ticket response.
 * @param value - Response payload.
 */
function readWebSocketTicketErrorMessage(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const error = payload.error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return null;
  }
  const errorRecord = error as Record<string, unknown>;
  if (typeof errorRecord.message === "string") {
    return errorRecord.message;
  }
  if (typeof errorRecord.code === "string") {
    return errorRecord.code;
  }
  return null;
}

/**
 * Requests a fresh websocket ticket for the current authenticated session.
 *
 * The sidecar POSTs to `/auth/ws-ticket` on the same origin as the RPC URL and sends
 * the active `jolt_session` cookie for authentication.
 * @param options - Configuration options used by this operation.
 */
async function requestWebSocketTicket(options: {
  fetchImpl?: typeof fetch;
  httpOrigin: string;
  sessionId: string;
}): Promise<WebSocketTicket> {
  const ticketUrl = new URL("/auth/ws-ticket", options.httpOrigin);
  const response = await (options.fetchImpl ?? fetch)(ticketUrl, {
    cache: "no-store",
    headers: {
      Cookie: buildSessionCookieHeader(options.sessionId),
      "Content-Type": "application/json",
    },
    body: "{}",
    method: "POST",
  });
  const rawText = await response.text();
  let payload: unknown = null;
  if (rawText.trim()) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = rawText;
    }
  }

  const ticketMetadata = readWebSocketTicketMetadata(payload);
  const ticketId = readTicketIdFromSetCookie(
    response.headers.get("set-cookie"),
  );
  if (!response.ok || !ticketMetadata || !ticketId) {
    const message =
      readWebSocketTicketErrorMessage(payload) ??
      rawText.trim() ??
      response.statusText ??
      `HTTP ${response.status}`;
    throw new Error(
      `Failed to obtain websocket ticket from ${ticketUrl.origin}: ${message}`,
    );
  }

  return {
    expiresAt: ticketMetadata.expiresAt,
    ticket: ticketId,
  };
}

/**
 * Build websocket connection details for the RPC client.
 *
 * If a `sessionId` is available, the client first exchanges it for a short-lived ticket
 * and attaches both the ticket and session cookie via the websocket Cookie header.
 * Without a session id, it falls back to a direct websocket URL.
 * @param options - Configuration options used by this operation.
 */
export async function buildRpcSocketConnectionDetails(options: {
  fetchImpl?: typeof fetch;
  httpOrigin: string;
  rpcUrl: string;
  sessionId: string | null;
}): Promise<RpcSocketConnectionDetails> {
  if (!options.sessionId) {
    return {
      url: options.rpcUrl,
    };
  }

  const ticket = await requestWebSocketTicket({
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    httpOrigin: options.httpOrigin,
    sessionId: options.sessionId,
  });

  return {
    headers: {
      Cookie: buildRpcSocketCookieHeader(options.sessionId, ticket.ticket),
    },
    url: options.rpcUrl,
  };
}

class JoltRpcClient {
  private connecting: Promise<WebSocket> | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRpcRequest>();
  private socket: WebSocket | null = null;

  /** Create a websocket-backed RPC client for a specific endpoint. */
  constructor(
    private readonly url: string,
    private readonly httpOrigin: string,
    private readonly sessionId: string | null,
  ) {}

  /**
   * Send a typed request and await typed result.
   *
   * Serializes the payload, tracks the request for response correlation, and
   * enforces an optional timeout per request.
   */

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
        // Track each request by id so the response handler can resolve/reject it.
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
          // Marshal minimal JSON payload to keep request handling side-effect free.
          socket.send(JSON.stringify(message));
        } catch (error) {
          this.clearPendingRequest(requestId);
          reject(error);
        }
      },
    );
  }

  /**
   * Remove one pending request from tracking and cancel any pending timeout timer.
   */

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

  /**
   * Reuse one shared websocket when open, otherwise connect once and fan-in callers.
   */

  private async waitForOpenSocket(): Promise<WebSocket> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return this.socket;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = new Promise<WebSocket>((resolveSocket, reject) => {
      void (async () => {
        try {
          const connectionDetails = await buildRpcSocketConnectionDetails({
            fetchImpl: fetch as typeof fetch,
            httpOrigin: this.httpOrigin,
            rpcUrl: this.url,
            sessionId: this.sessionId,
          });
          const nextSocket = connectionDetails.headers
            ? new (
                WebSocket as unknown as {
                  new (
                    url: string | URL,
                    options?: Bun.WebSocketOptions,
                  ): WebSocket;
                }
              )(connectionDetails.url, {
                headers: connectionDetails.headers,
              })
            : new WebSocket(connectionDetails.url);

          /**
           * Resets socket.
           * @param reason - Reason for this operation.
           */

          const resetSocket = (reason: unknown) => {
            // Centralized reset path so callers awaiting open/requests fail consistently.
            if (this.socket === nextSocket) {
              this.socket = null;
            }
            if (this.connecting) {
              this.connecting = null;
            }
            reject(reason);
          };

          nextSocket.addEventListener("open", () => {
            // Cache the live socket and clear the shared in-flight connect promise.
            this.socket = nextSocket;
            this.connecting = null;
            resolveSocket(nextSocket);
          });

          nextSocket.addEventListener("message", (event) => {
            // Ignore non-response frames; this socket may carry unrelated payload types.
            let message: RpcResponseMessage;
            try {
              message = JSON.parse(String(event.data)) as RpcResponseMessage;
            } catch {
              return;
            }
            if (
              !message ||
              typeof message !== "object" ||
              message.type !== "response"
            ) {
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
            // On socket close, reject all pending calls so callers don’t hang forever.
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
            resetSocket(
              new Error(`Could not connect to Jolt RPC at ${this.url}.`),
            );
          });
        } catch (error) {
          if (this.connecting) {
            this.connecting = null;
          }
          reject(error);
        }
      })();
    });

    return this.connecting;
  }
}

const rpcClient = new JoltRpcClient(rpcUrl, rpcHttpOrigin, sessionIdContext);

/**
 * Read and parse an environment variable as an integer project/thread id.
 * @param name - Display or identifier name.
 */
function readIntegerEnv(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    return null;
  }
  return Number.parseInt(raw, 10);
}

/**
 * Read and trim an environment variable, returning null for missing/empty values.
 * @param name - Display or identifier name.
 */
function readStringEnv(name: string): string | null {
  const raw = process.env[name]?.trim();
  return raw ? raw : null;
}

/**
 * Normalize RPC timeout values with fallback to default for invalid/empty input.
 * @param value - Input value.
 */
function normalizeTimeoutMs(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_RPC_TIMEOUT_MS;
  }
  return Math.max(1, Math.floor(value));
}

/**
 * Ensure outgoing priority is one of the accepted enum values.
 */
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
/**
 * Performs canonicalPath operation.
 * @param value - Input value.
 */

function canonicalPath(value: string): string {
  return canonicalizeSidecarPath(value, {
    baseDirectory: worktreePathContext ?? process.cwd(),
  });
}

/** Compare two paths after canonical normalization for robust equality checks. */
function samePath(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right);
}

/** Normalize a free-form lookup string for stable name comparisons.
 * @param value - Input value.
 */
function normalizeLookupValue(value: string): string {
  return value.trim().toLowerCase();
}

/** Return a stable leaf label for a worktree path. */
function shortName(value: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? normalized;
}

/** List all project/worktree records for a resolved project id. */

async function resolveProjectWorktrees(
  projectId: number,
): Promise<RpcWorktree[]> {
  const result = await rpcClient.call("listProjectWorktrees", {
    projectId,
  });
  return result.worktrees;
}

/**
 * Resolve a project by name, basename, or path-like input.
 *
 * Returns the matched project plus a fresh worktree listing for downstream
 * workspace resolution.
 */

async function resolveProjectByName(
  projectName: string,
): Promise<{ project: RpcProject; worktrees: RpcWorktree[] }> {
  const normalizedName = normalizeLookupValue(projectName);
  const looksLikePath =
    /[\\/]/.test(projectName) ||
    projectName.startsWith(".") ||
    projectName.startsWith("~");
  const projects = await listKnownProjects();
  const exactNameMatches = projects.filter(
    (project) =>
      normalizeLookupValue(project.name) === normalizedName ||
      normalizeLookupValue(shortName(project.path)) === normalizedName,
  );
  const pathMatches = looksLikePath
    ? projects.filter((project) => samePath(project.path, projectName))
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
  const worktrees = await resolveProjectWorktrees(project.id);
  return {
    project,
    worktrees,
  };
}

/**
 * Resolve a workspace identifier within one project using either a path or a
 * human-readable worktree label.
 */

function resolveWorkspaceForProject(
  project: RpcProject,
  worktrees: RpcWorktree[],
  workspaceName?: string | null,
): RpcWorktree {
  if (typeof workspaceName !== "string" || !workspaceName.trim()) {
    if (worktrees.length === 0) {
      throw new Error(`No worktrees found in project ${project.name}.`);
    }
    const primaryWorktree =
      worktrees.find((worktree) => samePath(worktree.path, project.path)) ??
      worktrees[0];
    if (!primaryWorktree) {
      throw new Error(`No worktrees found in project ${project.name}.`);
    }
    return primaryWorktree;
  }

  const trimmedWorkspaceName = workspaceName.trim();
  const normalizedWorkspaceName = normalizeLookupValue(trimmedWorkspaceName);
  const candidates = worktrees.filter((worktree) => {
    if (samePath(worktree.path, trimmedWorkspaceName)) {
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
      samePath(worktree.path, project.path) &&
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

/** Extract a numeric thread id from loose tool input. */
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
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("threadId must be a positive integer.");
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("threadId must be a positive integer.");
  }
  return parsed;
}

/** Resolve the project/workspace/thread context for a focus request. */

async function resolveFocusContextTarget(options: {
  project: string;
  workspace?: string | null | undefined;
  threadId?: string | number | null | undefined;
}): Promise<{
  project: RpcProject;
  worktree: RpcWorktree;
  threadId: number | null;
}> {
  const projectResolution = await resolveProjectByName(options.project);
  const requestedThreadId = normalizeThreadIdInput(options.threadId);
  if (requestedThreadId !== null) {
    enforceBoundThreadScope(requestedThreadId, threadIdContext);
  }
  let resolvedThread: RpcThread | null = null;
  if (requestedThreadId !== null) {
    const threads = await rpcClient.call("listThreads", undefined);
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

  const workspace =
    requestedThreadId !== null && !options.workspace
      ? (projectResolution.worktrees.find((worktree) =>
          samePath(worktree.path, resolvedThread?.worktreePath ?? ""),
        ) ??
        resolveWorkspaceForProject(
          projectResolution.project,
          projectResolution.worktrees,
          resolvedThread?.worktreePath ?? null,
        ))
      : resolveWorkspaceForProject(
          projectResolution.project,
          projectResolution.worktrees,
          options.workspace ?? null,
        );

  enforceTargetScope({
    projectIdContext,
    targetProjectId: projectResolution.project.id,
    targetWorktreePath: workspace.path,
    worktreePathContext,
  });

  if (
    resolvedThread &&
    !samePath(workspace.path, resolvedThread.worktreePath)
  ) {
    throw new Error(
      `Thread ${requestedThreadId} does not belong to workspace ${workspace.path}.`,
    );
  }

  return {
    project: projectResolution.project,
    worktree: workspace,
    threadId: resolvedThread?.id ?? null,
  };
}

type ListThreadsRow = {
  threadId: number;
  title: string;
  summary: string | null;
  pinned: boolean;
  projectId: number;
  projectName: string;
  projectPath: string;
  workspacePath: string;
  workspaceName: string;
  runState: RpcThread["runStatus"]["state"];
  updatedAt: string;
};
/**
 * Builds thread list rows.
 * @param options - Configuration options used by this operation.
 */

async function buildThreadListRows(options: {
  projectName: string;
  workspaceName?: string | null | undefined;
}): Promise<{
  project: RpcProject;
  workspace: RpcWorktree | null;
  rows: ListThreadsRow[];
}> {
  const projectResolution = await resolveProjectByName(options.projectName);
  const workspace = options.workspaceName
    ? resolveWorkspaceForProject(
        projectResolution.project,
        projectResolution.worktrees,
        options.workspaceName,
      )
    : null;
  const threads = await rpcClient.call("listThreads", undefined);
  const threadRows = threads
    .filter(
      (thread) =>
        thread.projectId === projectResolution.project.id &&
        (workspace === null || samePath(thread.worktreePath, workspace.path)),
    )
    .map((thread) => {
      const worktree =
        projectResolution.worktrees.find((entry) =>
          samePath(entry.path, thread.worktreePath),
        ) ?? null;
      return {
        threadId: thread.id,
        title: thread.title,
        summary: thread.summary,
        pinned: thread.pinnedAt !== null,
        projectId: thread.projectId,
        projectName: projectResolution.project.name,
        projectPath: projectResolution.project.path,
        workspacePath: thread.worktreePath,
        workspaceName:
          worktree?.branch?.trim() ||
          (samePath(thread.worktreePath, projectResolution.project.path)
            ? "Primary"
            : shortName(thread.worktreePath)),
        runState: thread.runStatus.state,
        updatedAt: thread.updatedAt,
      };
    });

  return {
    project: projectResolution.project,
    workspace,
    rows: threadRows,
  };
}

/** List all known projects including closed ones for robust resolution fallback. */
async function listKnownProjects() {
  return rpcClient.call("listProjects", { includeClosed: true });
}

/**
 * Resolve a project id from explicit inputs, env context, or project path lookup.
 */

async function resolveProjectId(params?: {
  projectId?: number | null | undefined;
  projectPath?: string | null | undefined;
}): Promise<number> {
  // explicit ids are authoritative; skip all other resolution paths.
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

/**
 * Resolve a project id that owns a given worktree path.
 *
 * Checks explicit project preference first, then active project context, then all projects.
 */

async function resolveProjectIdForWorktreePath(
  worktreePath: string,
  preferredProjectId?: number | null,
): Promise<number> {
  // prefer caller-provided project candidate to avoid expensive global scans.
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
    // skip candidates already checked above for deterministic preference ordering.
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

/**
 * Resolve worktree target used by thread operations, using explicit args or context.
 */

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
    const target = {
      projectId,
      projectPath:
        (await listKnownProjects()).find((project) => project.id === projectId)
          ?.path ?? null,
      worktreePath,
    };
    enforceTargetScope({
      projectIdContext,
      targetProjectId: target.projectId,
      targetWorktreePath: target.worktreePath,
      worktreePathContext,
    });
    return target;
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
/**
 * Requires thread id.
 * @param threadId - Thread identifier.
 */

function requireThreadId(threadId?: number | null): number {
  if (typeof threadId === "number") {
    enforceBoundThreadScope(threadId, threadIdContext);
    return threadId;
  }
  throw new Error("threadId is required.");
}

/** Map low-level run state into a concise, UI-oriented label. */
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

/** Build metadata payload for thread details from db rows or rpc thread objects.
 * @param thread - thread argument for thread.
 */
function threadMetadataPayload(thread: RpcThreadDetail["thread"] | RpcThread) {
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

/**
 * Build a detailed thread payload for new threads and send-message status responses.
 */

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

/** Convert request payload into status-neutral thread-start output structure. */
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

/**
 * Build a stable MCP response shape for cron job records.
 */
function cronJobPayload(cronJob: RpcCronJob) {
  return {
    cronJobId: cronJob.id,
    projectId: cronJob.projectId,
    worktreePath: cronJob.worktreePath,
    unsafeMode: cronJob.unsafeMode,
    title: cronJob.title,
    description: cronJob.description,
    schedule: cronJob.schedule,
    prompt: cronJob.prompt,
    lastRunDate: cronJob.lastRunDate,
    lastRunStatus: cronJob.lastRunStatus,
    enabled: cronJob.enabled,
    deletedAt: cronJob.deletedAt,
    createdAt: cronJob.createdAt,
    updatedAt: cronJob.updatedAt,
    nextRunDate: cronJob.nextRunDate,
  };
}

/**
 * Return MCP-friendly error metadata for structured logging.
 */
function normalizeToolError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }
  return String(error);
}

/**
 * Build MCP text output with optional structured payload for downstream clients.
 * @param text - Input text content.
 * @param structuredContent - structuredContent argument for structuredContent.
 */
function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    ...(typeof structuredContent === "undefined" ? {} : { structuredContent }),
  };
}

/** Shared MCP annotations used by read-modify metadata operations. */
function safeMetadataAnnotations() {
  return {
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true,
  };
}

/**
 * Wrap tool handlers with start/finish/error tracing and duration capture.
 */
function withToolLogging<TArgs, TResult>(
  toolName: string,
  handler: (args: TArgs) => Promise<TResult> | TResult,
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs): Promise<TResult> => {
    const startedAt = Date.now();
    sidecarLogger.trace({
      message: `MCP tool call started: ${toolName}`,
      tool: toolName,
      args,
    });

    try {
      const result = await handler(args);
      sidecarLogger.trace({
        message: `MCP tool call completed: ${toolName}`,
        tool: toolName,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      sidecarLogger.error({
        message: `MCP tool call failed: ${toolName}`,
        tool: toolName,
        durationMs: Date.now() - startedAt,
        error: normalizeToolError(error),
      });
      throw error;
    }
  };
}

const server = new McpServer({
  name: "jolt",
  version: "0.0.1",
});

/** Tool: update existing thread metadata (title, summary, pinned). */

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
  withToolLogging(
    "modify_thread",
    async ({ pinned, summary, threadId, title }) => {
      const resolvedThreadId = requireThreadId(threadId);
      const thread = await updateThreadMetadataFromSidecar(
        (params, options) =>
          rpcClient.call("updateThreadMetadata", params, options),
        {
          threadId: resolvedThreadId,
          ...(typeof title === "undefined" ? {} : { title }),
          ...(typeof summary === "undefined" ? {} : { summary }),
          ...(typeof pinned === "undefined" ? {} : { pinned }),
        },
        {
          priority: "foreground",
        },
      );
      return textResult(`Updated thread ${thread.id}.`, {
        threadId: thread.id,
        title: thread.title,
        summary: thread.summary,
        pinned: thread.pinnedAt !== null,
        pinnedAt: thread.pinnedAt,
      });
    },
  ),
);

/** Tool: list project threads with optional workspace filtering. */
server.registerTool(
  "list_threads",
  {
    title: "List Threads",
    description:
      "List Jolt threads in a project. Workspace means the git worktree. Omit workspaceName to list every thread and include each thread's worktree.",
    inputSchema: {
      projectName: z
        .string()
        .trim()
        .min(1)
        .describe("Project name or path to inspect."),
      workspaceName: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional git worktree name or path."),
    },
    annotations: {
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  withToolLogging("list_threads", async ({ projectName, workspaceName }) => {
    const { project, rows, workspace } = await buildThreadListRows({
      projectName,
      workspaceName,
    });
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
    return textResult(
      [
        `Threads for ${project.name}${workspace ? ` / ${workspace.branch?.trim() || shortName(workspace.path)}` : ""}:`,
        ...textLines,
      ].join("\n"),
      {
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        workspacePath: workspace?.path ?? null,
        workspaceName: workspace
          ? workspace.branch?.trim() ||
            (samePath(workspace.path, project.path)
              ? "Primary"
              : shortName(workspace.path))
          : null,
        threads: rows,
      },
    );
  }),
);

/**
 * Tool: list available models and model catalog details for cron creation.
 */
server.registerTool(
  "list_models",
  {
    title: "List Models",
    description:
      "List all supported codex models and their associated default reasoning effort.",
    inputSchema: {},
    annotations: {
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  withToolLogging("list_models", async () => {
    const catalog = await rpcClient.call("getCodexModelCatalog", undefined);
    const lines = catalog.models.map(
      (model) =>
        `- ${model.id}: ${model.label} (${model.group}${
          model.deprecated ? ", deprecated" : ""
        })`,
    );
    return textResult(
      lines.length > 0
        ? [
            `Default model: ${catalog.defaultModel}`,
            `Default reasoning effort: ${catalog.defaultReasoningEffort}`,
            "",
            ...lines,
          ].join("\n")
        : "No models are currently configured.",
      {
        defaultModel: catalog.defaultModel,
        defaultReasoningEffort: catalog.defaultReasoningEffort,
        models: catalog.models,
        reasoningEfforts: catalog.reasoningEfforts,
      },
    );
  }),
);

/**
 * Tool: run untrusted JavaScript or TypeScript in a vm2 sandbox.
 */
server.registerTool(
  "run_untrusted_js",
  {
    title: "Run Untrusted JS",
    description:
      "Execute untrusted JavaScript or TypeScript inside a vm2 NodeVM sandbox. Supports redirected console output, a configurable timeout, and a frozen sandbox with fetch plus Bun.Glob, Bun.file, Bun.SQLite, Bun.sleep, Bun.nanoseconds, Bun.gzipSync, Bun.gunzipSync, Bun.deflateSync, Bun.inflateSync, Bun.zstdCompress, Bun.zstdDecompress, Bun.zstdCompressSync, Bun.zstdDecompressSync, Bun.semver, Bun.TOML, Bun.markdown, and Bun.color. The sandboxed fs mock is read-only outside the current worktree and writable only inside it.",
    inputSchema: {
      code: z
        .string()
        .min(1)
        .describe("TypeScript or JavaScript source to execute."),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Sandbox timeout in milliseconds. Defaults to 60000."),
    },
    annotations: {
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  withToolLogging("run_untrusted_js", async ({ code, timeoutMs }) => {
    const report = await runUntrustedJavaScriptInVm2({
      code,
      ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
      worktreePath: worktreePathContext ?? process.cwd(),
    });
    return textResult(formatVm2ExecutionReportText(report), report);
  }),
);

/** Tool: focus the UI on a project/workspace/thread context. */

server.registerTool(
  "set_context",
  {
    title: "Set Context",
    description:
      "Focus the UI on a project, git worktree, and optional thread. Omit workspace to use the primary worktree. threadId wins and opens that thread's project/worktree.",
    inputSchema: {
      project: z
        .string()
        .trim()
        .min(1)
        .describe("Project name or path to focus."),
      workspace: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional git worktree name or path."),
      threadId: z
        .union([z.number().int().positive(), z.string().trim().min(1)])
        .optional()
        .describe("Optional thread id to focus."),
    },
    annotations: {
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  withToolLogging("set_context", async ({ project, threadId, workspace }) => {
    const target = await resolveFocusContextTarget({
      project,
      threadId,
      workspace,
    });
    const result = await rpcClient.call(
      "focusContext",
      {
        projectId: target.project.id,
        worktreePath: target.worktree.path,
        ...(target.threadId === null ? {} : { threadId: target.threadId }),
      },
      {
        priority: "foreground",
      },
    );
    return textResult(
      `Focused ${result.projectName} / ${shortName(result.worktreePath)}${result.threadId ? ` / thread ${result.threadId}` : ""}.`,
      {
        projectId: result.projectId,
        projectName: result.projectName,
        projectPath: result.projectPath,
        worktreePath: result.worktreePath,
        threadId: result.threadId,
      },
    );
  }),
);

/**
 * Tool: list non-deleted cron jobs.
 */

server.registerTool(
  "list_crons",
  {
    title: "List Cron Jobs",
    description: "List all non-deleted cron jobs with latest run metadata.",
    inputSchema: {},
    annotations: {
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  withToolLogging("list_crons", async () => {
    const crons = await rpcClient.call("listCrons", undefined);
    return textResult(`Found ${crons.length} cron job(s).`, {
      cronJobs: crons.map(cronJobPayload),
    });
  }),
);

/**
 * Tool: create a cron job for periodic work execution.
 */

server.registerTool(
  "new_cron",
  {
    title: "New Cron Job",
    description:
      "Create a new cron job bound to a project workspace. The run prompt is reused for each fire time.",
    inputSchema: {
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
      schedule: z.string().trim().min(1).describe("Cron schedule expression."),
      prompt: z
        .string()
        .trim()
        .min(1)
        .describe("Prompt sent to the cron run thread."),
      model: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Model override for cron-run threads."),
      title: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Optional short name for the cron job. Defaults to a label derived from the prompt.",
        ),
      description: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Optional full description for the cron job. Defaults to a prompt-derived summary.",
        ),
      unsafeMode: z
        .boolean()
        .optional()
        .describe(
          "When true, cron-run threads start in danger-full-access mode.",
        ),
      enabled: z
        .boolean()
        .optional()
        .describe(
          "Whether the cron schedule starts immediately. Omit for null metadata.",
        ),
      reasoningEffort: z
        .enum(["minimal", "low", "medium", "high", "xhigh"])
        .optional()
        .describe("Reasoning effort override for cron-run threads."),
    },
    annotations: {
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  withToolLogging("new_cron", async (params) => {
    const target = await resolveWorktreeTarget({
      projectId: params.projectId,
      projectPath: params.projectPath,
      worktreePath: params.worktreePath,
    });
    const created = await rpcClient.call("newCron", {
      projectId: target.projectId,
      worktreePath: target.worktreePath,
      schedule: params.schedule.trim(),
      prompt: params.prompt.trim(),
      ...(typeof params.model === "string"
        ? { model: params.model.trim() }
        : {}),
      ...(typeof params.reasoningEffort === "string"
        ? { reasoningEffort: params.reasoningEffort }
        : {}),
      ...(typeof params.title === "string"
        ? { title: params.title.trim() }
        : {}),
      ...(typeof params.description === "string"
        ? { description: params.description.trim() }
        : {}),
      ...(typeof params.unsafeMode === "boolean"
        ? { unsafeMode: params.unsafeMode }
        : {}),
      ...(typeof params.enabled === "boolean"
        ? { enabled: params.enabled }
        : {}),
    });
    return textResult(
      `Created cron job ${created.id} in ${target.worktreePath}.`,
      cronJobPayload(created),
    );
  }),
);

/**
 * Tool: update a cron job definition or toggle enabled/deletion.
 */

server.registerTool(
  "update_cron",
  {
    title: "Update Cron Job",
    description:
      "Update schedule, prompt, enabled state, or soft-delete a cron job.",
    inputSchema: {
      cronJobId: z.number().int().positive().describe("Cron job identifier."),
      schedule: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional replacement cron schedule."),
      model: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional model override for cron run threads."),
      prompt: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional replacement prompt."),
      title: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Optional replacement title. Omit to keep the current title.",
        ),
      description: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Optional replacement description. Omit to keep the current description.",
        ),
      unsafeMode: z
        .boolean()
        .optional()
        .describe(
          "When true, cron-run threads start in danger-full-access mode.",
        ),
      reasoningEffort: z
        .enum(["minimal", "low", "medium", "high", "xhigh"])
        .optional()
        .describe("Reasoning effort override for cron run threads."),
      enabled: z.boolean().optional().describe("Optional new enabled state."),
      deleted: z.boolean().optional().describe("Optional soft-delete flag."),
    },
    annotations: {
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  withToolLogging("update_cron", async (params) => {
    if (
      params.deleted === undefined &&
      params.schedule === undefined &&
      params.prompt === undefined &&
      params.model === undefined &&
      params.title === undefined &&
      params.description === undefined &&
      params.unsafeMode === undefined &&
      params.reasoningEffort === undefined &&
      params.enabled === undefined
    ) {
      throw new Error("At least one update field is required.");
    }
    const updated = await rpcClient.call("updateCron", {
      cronJobId: params.cronJobId,
      ...(typeof params.schedule === "undefined"
        ? {}
        : { schedule: params.schedule.trim() }),
      ...(typeof params.model === "undefined"
        ? {}
        : { model: params.model.trim() }),
      ...(typeof params.prompt === "undefined"
        ? {}
        : { prompt: params.prompt.trim() }),
      ...(typeof params.title === "string"
        ? { title: params.title.trim() }
        : {}),
      ...(typeof params.description === "string"
        ? { description: params.description.trim() }
        : {}),
      ...(typeof params.reasoningEffort === "string"
        ? { reasoningEffort: params.reasoningEffort }
        : {}),
      ...(typeof params.unsafeMode === "boolean"
        ? { unsafeMode: params.unsafeMode }
        : {}),
      ...(typeof params.enabled === "boolean"
        ? { enabled: params.enabled }
        : {}),
      ...(typeof params.deleted === "boolean"
        ? { deleted: params.deleted }
        : {}),
    });
    return textResult(
      `Updated cron job ${updated.id}.`,
      cronJobPayload(updated),
    );
  }),
);

/**
 * Tool: create threads with optional start/request workflow for deferred approval.
 */

server.registerTool(
  "new_thread",
  {
    title: "New Thread",
    description:
      "Start a separate Jolt thread for distinct work or another git worktree. Bound sidecar sessions cannot escape their current project/worktree. Set autoStart=true to ask the UI first; unsafeMode skips the popup.",
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
  withToolLogging(
    "new_thread",
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
        // For approved flow, request permission first instead of creating immediately.
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

      // Default path: create thread and send first message in one end-to-end operation.
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
  ),
);

/** Start MCP stdio server and begin listening for tool invocations. */
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  void main().catch((error) => {
    sidecarLogger.error(
      error instanceof Error
        ? `Jolt sidecar MCP server failed: ${error.message}`
        : "Jolt sidecar MCP server failed",
    );
    process.exit(1);
  });
}
