/**
 * @file src/bun/index.ts
 * @description Module for index.
 */

import { readdirSync, realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { ServerWebSocket } from "bun";

import {
  AuthServiceError,
  buildClearedSessionCookieHeader,
  buildSessionCookieHeader,
  DEFAULT_STEP_UP_LIFETIME_MS,
  getAuthStatus,
  issueWebSocketTicket,
  login,
  loginWithRecoveryCode,
  logout,
  prepareTotpEnrollment,
  readSessionCookie,
  requireFreshStepUp,
  resolveSession,
  setupAuth,
  stepUpSession,
  validateAndConsumeWebSocketTicket,
} from "./auth-service";
import { buildMainviewBundle, MAINVIEW_BUILD_DIR } from "./build-mainview";
import { initAppDatabase } from "./db";
import {
  issueDevWebSocketTicket,
  resetLocalAppState,
  resolveDevFlowMode,
} from "./dev-flows";
import { getGitSchedulerStats } from "./git";
import { createSubsystemLogger, type LogDescription } from "./logging";
import {
  closeProjectProcedure,
  closeWorktreeProcedure,
  createThreadProcedure,
  createWorktreeProcedure,
  deleteProjectProcedure,
  deleteThreadProcedure,
  discardEmptyThreadProcedure,
  focusContextProcedure,
  getAppBootstrapProcedure,
  getCodexModelCatalogProcedure,
  getHomeDirectoryProcedure,
  getProcedureRuntimeStats,
  getThreadProcedure,
  getWorktreeGitCommitDiffProcedure,
  getWorktreeSnapshotProcedure,
  listCronsProcedure,
  listDirectorySuggestionsProcedure,
  listProjectsProcedure,
  listProjectTasksProcedure,
  listProjectWorktreesProcedure,
  listThreadStatusesProcedure,
  listThreadsProcedure,
  listWorktreeGitHistoryProcedure,
  markThreadErrorSeenProcedure,
  newCronProcedure,
  openProjectProcedure,
  openProjectsBatchProcedure,
  openWorktreeProcedure,
  openWorktreesBatchProcedure,
  readWorktreeFileContentPageProcedure,
  readWorktreeFileDiffProcedure,
  recoverInterruptedThreadTurnsOnStartup,
  renameThreadProcedure,
  requestThreadStartProcedure,
  runProjectTaskProcedure,
  sendThreadMessageProcedure,
  setActiveWorktreeProcedure,
  setThreadPinnedProcedure,
  setWorktreeGitHistoryChangeListener,
  setWorktreePinnedProcedure,
  setWorktreeTaskChangeListener,
  shutdownActiveThreadTurns,
  shutdownProcedureCacheMaintenance,
  shutdownProjectPolling,
  startProcedureCacheMaintenance,
  stopThreadTurnProcedure,
  suspendActiveWorktreePolling,
  updateCronProcedure,
  updateThreadMetadataProcedure,
  updateThreadModelProcedure,
  updateThreadReasoningEffortProcedure,
  updateThreadUnsafeModeProcedure,
  warmProcedureStartupCaches,
} from "./project-procedures";
import { createThreadRequiresStepUp, enforceRpcStepUp } from "./rpc-authz";
import type {
  AppRPCSchema,
  RpcContextFocusChanged,
  RpcRequestContext,
  RpcRequestPriority,
  RpcThreadStartRequest,
  RpcWorktreeGitHistoryChanged,
  RpcWorktreeTasksChanged,
} from "./rpc-schema";
import {
  authorizeRpcWebSocketUpgrade,
  type RpcWebSocketSocketData,
} from "./rpc-websocket-auth";
import {
  applySecurityHeaders,
  buildLivenessPayload,
  buildLoopbackBrowserOrigins,
  buildRuntimeConfigElement,
  type InjectedRuntimeConfig,
  isWebSocketOriginAllowed,
  LOOPBACK_HOSTNAME,
  parseAllowedBrowserOrigins,
} from "./server-security";
import {
  startCronScheduler,
  stopCronScheduler,
} from "./sidecar-cron-scheduler";
import {
  formatLoopbackHttpOrigin,
  formatLoopbackWebSocketUrl,
  isPublicTlsEnabled,
  resolveTlsRuntimeConfig,
} from "./tls-config";

const DEFAULT_SERVER_PORT = "7599";
const MAINVIEW_SOURCE_DIR = resolve(process.cwd(), "src/mainview");
const MAINVIEW_HTML_PATH = resolve(process.cwd(), "src/mainview/index.html");
const MAINVIEW_CSS_PATH = resolve(process.cwd(), "src/mainview/index.css");
const FIRA_CODE_VARIABLE_FONT_PATH = resolve(
  process.cwd(),
  "node_modules/firacode/distr/woff2/FiraCode-VF.woff2",
);
const INTER_VARIABLE_FONT_LATIN_PATH = resolve(
  process.cwd(),
  "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
);
const INTER_VARIABLE_FONT_LATIN_EXT_PATH = resolve(
  process.cwd(),
  "node_modules/@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2",
);
const MAINVIEW_RELOAD_DEBOUNCE_MS = 90;
const MAINVIEW_WATCH_INTERVAL_MS = 250;
const SERVER_IDLE_TIMEOUT_SECONDS = 30;
const SERVER_MONITOR_INTERVAL_MS = 1_000;
const SERVER_OVERLOAD_LOG_INTERVAL_MS = 10_000;
const EVENT_LOOP_LAG_WARN_MS = 150;
const PENDING_RPC_WARN_COUNT = 8;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const DEFAULT_HTTP_PROXY_PORT = 80;
const DEFAULT_HTTPS_PROXY_PORT = 443;

const webServerLogger = createSubsystemLogger("Web Server");

type RpcRequestMap = AppRPCSchema["requests"];
type RpcMethodName = keyof RpcRequestMap;

type RpcRequestMessage = {
  type: "request";
  id: number;
  method: RpcMethodName;
  params: RpcRequestMap[RpcMethodName]["params"];
  priority: RpcRequestPriority;
  timeoutMs?: number;
};

type RpcCancelMessage = {
  type: "cancel";
  id: number;
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
      errorCode?: string;
      errorDetails?: Record<string, string | null> | null;
    };

type RpcReloadMessage = {
  type: "reload";
  reason: string;
};

type RpcTasksChangedMessage = RpcWorktreeTasksChanged & {
  type: "tasks-changed";
};

type RpcGitHistoryChangedMessage = RpcWorktreeGitHistoryChanged & {
  type: "git-history-changed";
};

type RpcContextFocusChangedMessage = RpcContextFocusChanged & {
  type: "context-focus-changed";
};

type RpcThreadStartRequestCreatedMessage = RpcThreadStartRequest & {
  type: "thread-start-request-created";
};

type RpcSocketMessage =
  | RpcResponseMessage
  | RpcReloadMessage
  | RpcTasksChangedMessage
  | RpcGitHistoryChangedMessage
  | RpcContextFocusChangedMessage
  | RpcThreadStartRequestCreatedMessage;

type RpcClientMessage = RpcRequestMessage | RpcCancelMessage;

type RpcRequestHandlerMap = {
  [K in keyof RpcRequestMap]: (
    params: RpcRequestMap[K]["params"],
    context: RpcRequestContext,
  ) => Promise<RpcRequestMap[K]["response"]>;
};

/** Indicates whether a string can be safely parsed as a decimal port number. */
function isStringInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

function normalizeErrorDescription(error: unknown): LogDescription {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  return String(error);
}

type PendingRpcRequest = {
  controller: AbortController;
  signal: AbortSignal;
  timeoutMs: number | null;
  canceledByClient: boolean;
};

/**
 * Resolve an explicit --port/-p override from process args.
 * Supports --port 3000, -p 3000, --port=3000, and -p=3000.
 * @param args - Argument list passed to args.
 */
function readCliPort(args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (typeof arg !== "string") {
      continue;
    }
    if (arg === "--port" || arg === "-p") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error(`Missing value for ${arg}`);
      }
      return nextArg;
    }
    if (arg.startsWith("--port=")) {
      return arg.slice("--port=".length);
    }
    if (arg.startsWith("-p=")) {
      return arg.slice("-p=".length);
    }
  }

  return null;
}

/**
 * Resolve and validate server port from CLI arguments and optional env value.
 * @throws if port is non-numeric or outside 1..65535.
 * @param args - Argument list passed to args.
 * @param envPort - envPort argument for envPort.
 */
function resolveServerPort(args: string[], envPort?: string): number {
  const configuredPort = readCliPort(args) ?? envPort ?? DEFAULT_SERVER_PORT;
  if (!isStringInteger(configuredPort)) {
    throw new Error(
      `Invalid port "${configuredPort}". Expected an integer string from --port, -p, or JOLT_PORT.`,
    );
  }

  const parsedPort = Number.parseInt(configuredPort, 10);
  if (parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(
      `Invalid port "${configuredPort}". Expected an integer string between 1 and 65535.`,
    );
  }

  return parsedPort;
}

const SERVER_ARGS = Bun.argv.slice(2);
const CONFIGURED_SERVER_PORT =
  readCliPort(SERVER_ARGS) ?? process.env.JOLT_PORT;
const SERVER_PORT = resolveServerPort(SERVER_ARGS, process.env.JOLT_PORT);
const SERVER_PORT_IS_EXPLICIT = CONFIGURED_SERVER_PORT !== undefined;
const BACKEND_ONLY =
  SERVER_ARGS.includes("--backend-only") ||
  process.env.JOLT_BACKEND_ONLY === "1";
const IS_DEV_SERVER =
  SERVER_ARGS.includes("--dev") || process.env.JOLT_DEV === "1";
const PUBLIC_TLS_ENABLED = isPublicTlsEnabled(SERVER_ARGS, process.env);
const TLS_RUNTIME = resolveTlsRuntimeConfig({
  forceTls: PUBLIC_TLS_ENABLED,
});
const DEV_FLOW_MODE = resolveDevFlowMode({
  env: process.env,
  isDevServer: IS_DEV_SERVER,
});

process.env.JOLT_PORT = String(SERVER_PORT);
process.env.JOLT_RPC_HTTP_ORIGIN = formatLoopbackHttpOrigin(SERVER_PORT, false);
process.env.JOLT_RPC_URL = formatLoopbackWebSocketUrl(SERVER_PORT, false);

const CONFIGURED_ALLOWED_WS_ORIGINS = parseAllowedBrowserOrigins(
  process.env.JOLT_ALLOWED_WS_ORIGINS,
);
/**
 * Requires fresh step up for rpc action.
 * @param context - Execution context.
 * @param actionDescription - actionDescription argument for requireFreshStepUpForRpcAction.
 */

function requireFreshStepUpForRpcAction(
  context: RpcRequestContext,
  actionDescription: string,
): void {
  enforceRpcStepUp({
    actionDescription,
    context,
    onRequireStepUp: ({
      actionDescription: nextActionDescription,
      sessionId,
    }) =>
      requireFreshStepUp(initAppDatabase(), {
        actionDescription: nextActionDescription,
        nowMs: currentNowMs(),
        sessionId,
      }),
  });
}

const rpcHandlers: RpcRequestHandlerMap = {
  getHomeDirectory: () => getHomeDirectoryProcedure(),
  listDirectorySuggestions: (params) =>
    listDirectorySuggestionsProcedure(params),
  getCodexModelCatalog: (params) => getCodexModelCatalogProcedure(params),
  getAppBootstrap: (params) => getAppBootstrapProcedure(params),
  listProjects: (params) => listProjectsProcedure(params),
  listThreads: (params) => listThreadsProcedure(params),
  listThreadStatuses: (params) => listThreadStatusesProcedure(params),
  openProject: (params, context) => openProjectProcedure(params, context),
  openProjectsBatch: (params, context) =>
    openProjectsBatchProcedure(params, context),
  openWorktreesBatch: (params, context) =>
    openWorktreesBatchProcedure(params, context),
  closeProject: (params) => closeProjectProcedure(params),
  deleteProject: (params, context) => {
    requireFreshStepUpForRpcAction(context, "delete a project");
    return deleteProjectProcedure(params);
  },
  listProjectWorktrees: (params, context) =>
    listProjectWorktreesProcedure(params, context),
  listProjectTasks: (params, context) =>
    listProjectTasksProcedure(params, context),
  createWorktree: (params) => createWorktreeProcedure(params),
  createThread: (params, context) => {
    if (createThreadRequiresStepUp(params)) {
      requireFreshStepUpForRpcAction(
        context,
        "create a thread outside the current workspace",
      );
    }
    return createThreadProcedure(params, context);
  },
  requestThreadStart: async (params) => {
    const request = await requestThreadStartProcedure(params);
    broadcastThreadStartRequestCreated(request);
    return request;
  },
  newCron: (params) => newCronProcedure(params),
  updateCron: (params) => updateCronProcedure(params),
  listCrons: (params) => listCronsProcedure(params),
  getThread: (params) => getThreadProcedure(params),
  markThreadErrorSeen: (params) => markThreadErrorSeenProcedure(params),
  sendThreadMessage: (params, context) =>
    sendThreadMessageProcedure(params, context),
  stopThreadTurn: (params) => stopThreadTurnProcedure(params),
  runProjectTask: (params, context) => {
    requireFreshStepUpForRpcAction(context, "run project tasks");
    return runProjectTaskProcedure(params, context);
  },
  updateThreadMetadata: (params) => updateThreadMetadataProcedure(params),
  renameThread: (params) => renameThreadProcedure(params),
  setThreadPinned: (params) => setThreadPinnedProcedure(params),
  updateThreadModel: (params) => updateThreadModelProcedure(params),
  updateThreadReasoningEffort: (params) =>
    updateThreadReasoningEffortProcedure(params),
  updateThreadUnsafeMode: (params) => updateThreadUnsafeModeProcedure(params),
  deleteThread: (params) => deleteThreadProcedure(params),
  discardEmptyThread: (params) => discardEmptyThreadProcedure(params),
  openWorktree: (params, context) => openWorktreeProcedure(params, context),
  getWorktreeSnapshot: (params, context) =>
    getWorktreeSnapshotProcedure(params, context),
  readWorktreeFileContentPage: (params, context) =>
    readWorktreeFileContentPageProcedure(params, context),
  readWorktreeFileDiff: (params, context) =>
    readWorktreeFileDiffProcedure(params, context),
  setActiveWorktree: (params) => setActiveWorktreeProcedure(params),
  focusContext: async (params, context) => {
    const result = await focusContextProcedure(params, context);
    broadcastContextFocusChanged(result);
    return result;
  },
  listWorktreeGitHistory: (params, context) =>
    listWorktreeGitHistoryProcedure(params, context),
  getWorktreeGitCommitDiff: (params, context) =>
    getWorktreeGitCommitDiffProcedure(params, context),
  closeWorktree: (params) => closeWorktreeProcedure(params),
  setWorktreePinned: (params) => setWorktreePinnedProcedure(params),
};

const rpcClients = new Set<ServerWebSocket<RpcWebSocketSocketData>>();
const pendingRpcRequestsByClient = new WeakMap<
  ServerWebSocket<RpcWebSocketSocketData>,
  Map<number, PendingRpcRequest>
>();
const pendingMainviewChanges = new Set<string>();

let mainviewBundlePath = resolve(MAINVIEW_BUILD_DIR, "index.js");
let mainviewBuildPromise: Promise<string> | null = null;
let mainviewRebuildQueued = false;
let devMainviewPollTimer: ReturnType<typeof setInterval> | null = null;
let pendingMainviewReloadTimer: ReturnType<typeof setTimeout> | null = null;
let mainviewFileStamps = new Map<string, number>();
let overloadMonitorTimer: ReturnType<typeof setInterval> | null = null;
let pendingRpcRequestCount = 0;
let peakPendingRpcRequestCount = 0;
let lastEventLoopLagMs = 0;
let peakEventLoopLagMs = 0;
let lastOverloadLogAt = 0;
/**
 * Builds response headers.
 * @param contentType - contentType argument for buildResponseHeaders.
 * @param headers - HTTP headers.
 */

function buildResponseHeaders(
  contentType: string,
  headers?: HeadersInit,
): Headers {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", contentType);
  return applySecurityHeaders(responseHeaders);
}
/**
 * Performs stringResponse operation.
 * @param body - Request body payload.
 * @param contentType - contentType argument for stringResponse.
 * @param status - status argument for stringResponse.
 * @param headers - HTTP headers.
 */

function stringResponse(
  body: string,
  contentType: string,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(body, {
    headers: buildResponseHeaders(contentType, headers),
    status,
  });
}
/**
 * Performs jsonResponse operation.
 * @param value - Input value.
 * @param status - status argument for jsonResponse.
 * @param headers - HTTP headers.
 */

function jsonResponse(
  value: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(value), {
    headers: buildResponseHeaders(JSON_CONTENT_TYPE, headers),
    status,
  });
}

/**
 * Build a file-backed HTTP response with explicit no-cache header.
 * @param path - Filesystem path.
 * @param contentType - contentType argument for contentType.
 */
function fileResponse(path: string, contentType: string): Response {
  return new Response(Bun.file(path), {
    headers: buildResponseHeaders(contentType),
  });
}

function currentNowMs(): number {
  return Date.now();
}

class RequestValidationError extends Error {
  readonly code: string;
  readonly status: number;
  /**
   * Creates and initializes a new instance.
   * @param message - Message payload.
   * @param options - Configuration options used by this operation.
   */

  constructor(
    message: string,
    options?: {
      code?: string;
      status?: number;
    },
  ) {
    super(message);
    this.name = "RequestValidationError";
    this.code = options?.code ?? "invalid_request";
    this.status = options?.status ?? 400;
  }
}
/**
 * Is secure request.
 * @param request - Incoming request payload.
 */

function isSecureRequest(request: Request): boolean {
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto === "https") {
    return true;
  }
  if (forwardedProto === "http") {
    return false;
  }
  if (TLS_RUNTIME.publicTls) {
    return true;
  }
  return new URL(request.url).protocol === "https:";
}
/**
 * Normalizes browser origin.
 * @param origin - origin argument for normalizeBrowserOrigin.
 */

function normalizeBrowserOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}
/**
 * Resolves rpc client origin from request.
 * @param request - Incoming request payload.
 */

function resolveRpcClientOriginFromRequest(request: Request): string | null {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? `${forwardedProto}:`
      : TLS_RUNTIME.publicTls
        ? "https:"
        : "http:";

  if (forwardedHost) {
    return normalizeBrowserOrigin(`${protocol}://${forwardedHost}`);
  }

  const host = request.headers.get("host")?.trim();
  if (!host) {
    return null;
  }
  return normalizeBrowserOrigin(`${protocol}://${host}`);
}
/**
 * Normalizes auth route origin.
 * @param origin - origin argument for normalizeAuthRouteOrigin.
 */

function normalizeAuthRouteOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
/**
 * Resolves expected auth route origin.
 * @param request - Incoming request payload.
 */

function resolveExpectedAuthRouteOrigin(request: Request): string | null {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (
    forwardedHost &&
    (forwardedProto === "http" || forwardedProto === "https")
  ) {
    return normalizeAuthRouteOrigin(`${forwardedProto}://${forwardedHost}`);
  }

  return normalizeAuthRouteOrigin(new URL(request.url).origin);
}
/**
 * Requires json auth request.
 * @param request - Incoming request payload.
 */

function requireJsonAuthRequest(request: Request): void {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestValidationError(
      'Auth requests must use "Content-Type: application/json".',
      {
        code: "invalid_content_type",
        status: 415,
      },
    );
  }
}
/**
 * Performs enforceAuthMutationRequestSecurity operation.
 * @param request - Incoming request payload.
 */

function enforceAuthMutationRequestSecurity(request: Request): void {
  requireJsonAuthRequest(request);

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite === "cross-site") {
    throw new RequestValidationError(
      "Cross-site auth requests are not allowed.",
      {
        code: "origin_not_allowed",
        status: 403,
      },
    );
  }

  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    return;
  }

  const normalizedOrigin = normalizeAuthRouteOrigin(originHeader.trim());
  const expectedOrigin = resolveExpectedAuthRouteOrigin(request);
  if (
    !normalizedOrigin ||
    !expectedOrigin ||
    normalizedOrigin !== expectedOrigin
  ) {
    throw new RequestValidationError("Auth request origin not allowed.", {
      code: "origin_not_allowed",
      status: 403,
    });
  }
}
/**
 * Performs sessionCookieMaxAgeSeconds operation.
 * @param expiresAt - expiresAt argument for sessionCookieMaxAgeSeconds.
 * @param nowMs - nowMs argument for sessionCookieMaxAgeSeconds.
 */

function sessionCookieMaxAgeSeconds(expiresAt: string, nowMs: number): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - nowMs) / 1000));
}
/**
 * Reads json body.
 * @param request - Incoming request payload.
 */

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new RequestValidationError("JSON request bodies must be objects.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new RequestValidationError(
      error instanceof Error ? error.message : "Invalid JSON request body.",
    );
  }
}
/**
 * Reads required string.
 * @param body - Request body payload.
 * @param fieldName - fieldName argument for readRequiredString.
 */

function readRequiredString(
  body: Record<string, unknown>,
  fieldName: string,
): string {
  const value = body[fieldName];
  if (typeof value !== "string" || value.trim() === "") {
    throw new RequestValidationError(
      `Expected "${fieldName}" to be a non-empty string.`,
    );
  }
  return value;
}
/**
 * Reads optional string.
 * @param body - Request body payload.
 * @param fieldName - fieldName argument for readOptionalString.
 */

function readOptionalString(
  body: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  const value = body[fieldName];
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new RequestValidationError(`Expected "${fieldName}" to be a string.`);
  }
  return value;
}
/**
 * Reads optional integer.
 * @param body - Request body payload.
 * @param fieldName - fieldName argument for readOptionalInteger.
 */

function readOptionalInteger(
  body: Record<string, unknown>,
  fieldName: string,
): number | undefined {
  const value = body[fieldName];
  if (typeof value === "undefined") {
    return undefined;
  }
  if (!Number.isInteger(value)) {
    throw new RequestValidationError(
      `Expected "${fieldName}" to be an integer.`,
    );
  }
  return value as number;
}
/**
 * Reads optional session lifetime days.
 * @param body - Request body payload.
 */

function readOptionalSessionLifetimeDays(
  body: Record<string, unknown>,
): number | undefined {
  const value = readOptionalInteger(body, "sessionLifetimeDays");
  if (typeof value === "undefined") {
    return undefined;
  }
  if (value < 1 || value > 30) {
    throw new RequestValidationError(
      'Expected "sessionLifetimeDays" to be between 1 and 30.',
    );
  }
  return value;
}
/**
 * Reads primary factor type.
 * @param body - Request body payload.
 */

function readPrimaryFactorType(
  body: Record<string, unknown>,
): "pin" | "password" {
  const value = body.primaryFactorType;
  if (value !== "pin" && value !== "password") {
    throw new RequestValidationError(
      'Expected "primaryFactorType" to be either "pin" or "password".',
    );
  }
  return value;
}
/**
 * Performs authErrorResponse operation.
 * @param request - Incoming request payload.
 * @param error - Error value to process.
 * @param options - Configuration options used by this operation.
 */

function authErrorResponse(
  request: Request,
  error: unknown,
  options?: {
    clearSessionCookie?: boolean;
  },
): Response {
  const headers = new Headers();
  if (options?.clearSessionCookie) {
    headers.set(
      "set-cookie",
      buildClearedSessionCookieHeader(isSecureRequest(request)),
    );
  }

  if (error instanceof AuthServiceError) {
    webServerLogger.warning({
      description: "Auth request failed",
      method: request.method,
      pathname: new URL(request.url).pathname,
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
    });
    return jsonResponse(
      {
        error: {
          code: error.code,
          details: error.details ?? null,
          message: error.message,
        },
        ok: false,
      },
      error.status,
      headers,
    );
  }

  if (error instanceof RequestValidationError) {
    webServerLogger.warning({
      description: "Auth request validation failed",
      method: request.method,
      pathname: new URL(request.url).pathname,
      code: error.code,
      status: error.status,
      message: error.message,
    });
    return jsonResponse(
      {
        error: {
          code: error.code,
          details: null,
          message: error.message,
        },
        ok: false,
      },
      error.status,
      headers,
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  webServerLogger.error({
    message: "Unhandled auth route failure",
    sourceMessage: message,
    error: normalizeErrorDescription(error),
  });
  return jsonResponse(
    {
      error: {
        code: "internal_error",
        details: null,
        message:
          message.trim() || "The auth backend encountered an unexpected error.",
      },
      ok: false,
    },
    500,
    headers,
  );
}
/**
 * Handles auth request.
 * @param request - Incoming request payload.
 */

async function handleAuthRequest(request: Request): Promise<Response | null> {
  const requestUrl = new URL(request.url);
  const { pathname } = requestUrl;
  if (!pathname.startsWith("/auth/")) {
    return null;
  }

  const requestId = request.headers.get("x-request-id")?.trim();
  const sessionId = readSessionCookie(request.headers.get("cookie"));
  const secureCookie = isSecureRequest(request);
  webServerLogger.trace({
    message: "Auth request received",
    method: request.method,
    pathname,
    requestId: requestId ?? null,
    authBypass: DEV_FLOW_MODE.authBypass,
    hasSession: !!sessionId,
    source: requestUrl.origin,
  });

  const respondAuthJson = (
    payload: Record<string, unknown>,
    status = 200,
    headers?: HeadersInit,
  ): Response => {
    webServerLogger.trace({
      message: "Auth route completed",
      method: request.method,
      pathname,
      status,
      requestId: requestId ?? null,
    });
    return jsonResponse(payload, status, headers);
  };

  const database = initAppDatabase();
  const nowMs = currentNowMs();
  const getCurrentAuthStatus = () =>
    getAuthStatus(database, sessionId, {
      devBypass: DEV_FLOW_MODE.authBypass,
      nowMs,
    });

  try {
    if (request.method === "POST") {
      enforceAuthMutationRequestSecurity(request);
    }

    if (pathname === "/auth/status" && request.method === "GET") {
      const status = getCurrentAuthStatus();
      return respondAuthJson(
        {
          ok: true,
          status,
        },
        200,
        sessionId && !status.authenticated
          ? {
              "set-cookie": buildClearedSessionCookieHeader(secureCookie),
            }
          : undefined,
      );
    }

    if (pathname === "/auth/setup/start" && request.method === "POST") {
      if (
        getAuthStatus(database, null, {
          devBypass: DEV_FLOW_MODE.authBypass,
          nowMs,
        }).configured
      ) {
        throw new AuthServiceError(
          "auth_already_configured",
          "Authentication has already been configured.",
          409,
        );
      }
      const body = await readJsonBody(request);
      const accountName =
        readOptionalString(body, "accountName") || "local-user";
      const issuer = readOptionalString(body, "issuer");
      const enrollment = prepareTotpEnrollment(
        issuer
          ? {
              accountName,
              issuer,
            }
          : {
              accountName,
            },
      );
      return respondAuthJson({
        enrollment,
        ok: true,
      });
    }

    if (pathname === "/auth/setup" && request.method === "POST") {
      const body = await readJsonBody(request);
      const sessionLifetimeDays = readOptionalSessionLifetimeDays(body);
      const result = await setupAuth(database, {
        nowMs,
        primaryFactor: readRequiredString(body, "primaryFactor"),
        primaryFactorType: readPrimaryFactorType(body),
        totpCode: readRequiredString(body, "totpCode"),
        totpSecret: readRequiredString(body, "totpSecret"),
        ...(typeof sessionLifetimeDays === "number"
          ? {
              sessionLifetimeDays,
            }
          : {}),
      });

      return respondAuthJson(
        {
          ok: true,
          recoveryCodes: result.recoveryCodes,
          status: getAuthStatus(database, result.session.id, {
            devBypass: DEV_FLOW_MODE.authBypass,
            nowMs,
          }),
        },
        200,
        {
          "set-cookie": buildSessionCookieHeader(result.session.id, {
            maxAgeSeconds: sessionCookieMaxAgeSeconds(
              result.session.expiresAt,
              nowMs,
            ),
            secure: secureCookie,
          }),
        },
      );
    }

    if (pathname === "/auth/login" && request.method === "POST") {
      const body = await readJsonBody(request);
      const result = await login(database, {
        nowMs,
        primaryFactor: readRequiredString(body, "primaryFactor"),
        totpCode: readRequiredString(body, "totpCode"),
      });

      return respondAuthJson(
        {
          ok: true,
          status: getAuthStatus(database, result.session.id, {
            devBypass: DEV_FLOW_MODE.authBypass,
            nowMs,
          }),
        },
        200,
        {
          "set-cookie": buildSessionCookieHeader(result.session.id, {
            maxAgeSeconds: sessionCookieMaxAgeSeconds(
              result.session.expiresAt,
              nowMs,
            ),
            secure: secureCookie,
          }),
        },
      );
    }

    if (pathname === "/auth/recovery-login" && request.method === "POST") {
      const body = await readJsonBody(request);
      const result = await loginWithRecoveryCode(database, {
        nowMs,
        primaryFactor: readRequiredString(body, "primaryFactor"),
        recoveryCode: readRequiredString(body, "recoveryCode"),
      });

      return respondAuthJson(
        {
          ok: true,
          status: getAuthStatus(database, result.session.id, {
            devBypass: DEV_FLOW_MODE.authBypass,
            nowMs,
          }),
        },
        200,
        {
          "set-cookie": buildSessionCookieHeader(result.session.id, {
            maxAgeSeconds: sessionCookieMaxAgeSeconds(
              result.session.expiresAt,
              nowMs,
            ),
            secure: secureCookie,
          }),
        },
      );
    }

    if (pathname === "/auth/step-up" && request.method === "POST") {
      if (DEV_FLOW_MODE.authBypass) {
        return respondAuthJson({
          ok: true,
          status: getCurrentAuthStatus(),
          stepUpValidUntil: new Date(
            nowMs + DEFAULT_STEP_UP_LIFETIME_MS,
          ).toISOString(),
        });
      }
      if (!sessionId) {
        throw new AuthServiceError(
          "session_required",
          "A valid authenticated session is required.",
          401,
        );
      }

      const body = await readJsonBody(request);
      const result = await stepUpSession(database, {
        nowMs,
        primaryFactor: readRequiredString(body, "primaryFactor"),
        sessionId,
        totpCode: readRequiredString(body, "totpCode"),
      });

      return respondAuthJson({
        ok: true,
        status: getCurrentAuthStatus(),
        stepUpValidUntil: result.stepUpValidUntil,
      });
    }

    if (pathname === "/auth/logout" && request.method === "POST") {
      logout(database, sessionId);
      return respondAuthJson(
        {
          ok: true,
          status: getCurrentAuthStatus(),
        },
        200,
        {
          "set-cookie": buildClearedSessionCookieHeader(secureCookie),
        },
      );
    }

    if (pathname === "/auth/ws-ticket" && request.method === "POST") {
      if (DEV_FLOW_MODE.authBypass) {
        return respondAuthJson({
          ok: true,
          ticket: issueDevWebSocketTicket(nowMs),
        });
      }

      if (!sessionId) {
        throw new AuthServiceError(
          "session_required",
          "A valid authenticated session is required.",
          401,
        );
      }

      const ticket = issueWebSocketTicket(database, {
        nowMs,
        sessionId,
      });
      return respondAuthJson({
        ok: true,
        ticket,
      });
    }

    return respondAuthJson(
      {
        error: {
          code: "method_not_allowed",
          details: null,
          message: `No auth route is available for ${request.method} ${pathname}.`,
        },
        ok: false,
      },
      405,
    );
  } catch (error) {
    webServerLogger.warning({
      message: "Auth request failed before response",
      method: request.method,
      pathname,
      requestId: requestId ?? null,
      requestUrl: requestUrl.toString(),
      error: normalizeErrorDescription(error),
    });
    const clearSessionCookie =
      error instanceof AuthServiceError &&
      (error.code === "session_required" ||
        error.code === "invalid_credentials");
    return authErrorResponse(request, error, {
      clearSessionCookie,
    });
  }
}

/**
 * Track active RPC requests globally and capture peak concurrency.
 */

function incrementPendingRpcRequestCount(): void {
  pendingRpcRequestCount += 1;
  peakPendingRpcRequestCount = Math.max(
    peakPendingRpcRequestCount,
    pendingRpcRequestCount,
  );
}

/**
 * Lower pending RPC request count safely without underflow.
 * @param count - Count limit or quantity.
 */
function decrementPendingRpcRequestCount(count = 1): void {
  pendingRpcRequestCount = Math.max(0, pendingRpcRequestCount - count);
}

/**
 * Create a diagnostic snapshot used for overload warning logs.
 * @param activeServerPort - activeServerPort argument for activeServerPort.
 */
function buildServerHealthSnapshot(activeServerPort: number): {
  backendOnly: boolean;
  devServer: boolean;
  eventLoopLagMs: {
    current: number;
    peak: number;
  };
  git: ReturnType<typeof getGitSchedulerStats>;
  ok: true;
  pendingRpcRequests: {
    current: number;
    peak: number;
  };
  port: number;
  procedures: ReturnType<typeof getProcedureRuntimeStats>;
  rpcClientCount: number;
  rpcWebSocketUrl: string;
} {
  return {
    backendOnly: BACKEND_ONLY,
    devServer: IS_DEV_SERVER,
    eventLoopLagMs: {
      current: lastEventLoopLagMs,
      peak: peakEventLoopLagMs,
    },
    git: getGitSchedulerStats(),
    ok: true,
    pendingRpcRequests: {
      current: pendingRpcRequestCount,
      peak: peakPendingRpcRequestCount,
    },
    port: activeServerPort,
    procedures: getProcedureRuntimeStats(),
    rpcClientCount: rpcClients.size,
    rpcWebSocketUrl:
      process.env.JOLT_RPC_URL ?? `ws://127.0.0.1:${activeServerPort}/rpc`,
  };
}

/**
 * Periodically emit overload telemetry for backlog and event loop lag conditions.
 * @param activeServerPort - activeServerPort argument for activeServerPort.
 */
function startOverloadMonitoring(activeServerPort: () => number): void {
  if (overloadMonitorTimer) {
    return;
  }

  let expectedAt = performance.now() + SERVER_MONITOR_INTERVAL_MS;
  overloadMonitorTimer = setInterval(() => {
    const now = performance.now();
    lastEventLoopLagMs = Math.max(0, now - expectedAt);
    peakEventLoopLagMs = Math.max(peakEventLoopLagMs, lastEventLoopLagMs);
    expectedAt = now + SERVER_MONITOR_INTERVAL_MS;

    // Sample health at each tick and compare against lag/pending thresholds.
    const health = buildServerHealthSnapshot(activeServerPort());
    const hasPressure =
      health.eventLoopLagMs.current >= EVENT_LOOP_LAG_WARN_MS ||
      health.pendingRpcRequests.current >= PENDING_RPC_WARN_COUNT ||
      health.git.queuedBackgroundCount > 0 ||
      health.git.queuedForegroundCount > 0 ||
      health.procedures.foregroundReadCount > 0 ||
      health.procedures.taskCacheRefreshLimit.pendingCount > 0 ||
      health.procedures.gitHistoryReadLimit.pendingCount > 0 ||
      health.procedures.diffLoadLimit.pendingCount > 0;

    if (!hasPressure) {
      return;
    }

    const nowMs = Date.now();
    // Throttle repeated overload logs so a spike doesn't drown the console.
    if (nowMs - lastOverloadLogAt < SERVER_OVERLOAD_LOG_INTERVAL_MS) {
      return;
    }
    lastOverloadLogAt = nowMs;
    webServerLogger.warning({
      message: "Server overload pressure",
      health,
    });
  }, SERVER_MONITOR_INTERVAL_MS);
}

/**
 * Detect port binding collisions without relying on a concrete error class.
 * @param error - Error value to process.
 */
function isAddressInUseError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EADDRINUSE"
  );
}

/**
 * Render the HTML entrypoint and inject runtime flags.
 */

async function htmlResponse(): Promise<Response> {
  const runtimeConfig: InjectedRuntimeConfig = {
    devServer: IS_DEV_SERVER,
    healthUrl: "/health",
    ...(TLS_RUNTIME.publicTls
      ? {
          preferTls: true,
        }
      : {}),
  };
  const runtimeConfigElement = buildRuntimeConfigElement(runtimeConfig);
  const template = await Bun.file(MAINVIEW_HTML_PATH).text();
  const html = template.includes("</head>")
    ? template.replace("</head>", `${runtimeConfigElement}\n\t</head>`)
    : `${runtimeConfigElement}\n${template}`;

  return stringResponse(html, "text/html; charset=utf-8");
}

/**
 * Parse and validate inbound websocket request messages.
 * @param raw - raw argument for raw.
 */
function parseRpcRequestMessage(raw: string): RpcRequestMessage {
  // Parse first, then validate shape so runtime schema errors are surfaced consistently.
  let parsed: Partial<RpcRequestMessage>;
  try {
    parsed = JSON.parse(raw) as Partial<RpcRequestMessage>;
  } catch (error) {
    webServerLogger.warning({
      message: "Invalid RPC request JSON",
      payloadPreview: raw.slice(0, 200),
      error: normalizeErrorDescription(error),
    });
    throw new Error("Invalid RPC request payload");
  }

  const method = parsed.method;
  if (
    parsed.type !== "request" ||
    typeof parsed.id !== "number" ||
    typeof method !== "string" ||
    !(method in rpcHandlers)
  ) {
    webServerLogger.warning({
      message: "Invalid RPC request payload",
      payload: {
        type: parsed.type,
        id: parsed.id,
        method,
      },
      hasMethod: typeof method === "string",
    });
    throw new Error("Invalid RPC request payload");
  }

  const timeoutMs = normalizeTimeoutMs(parsed.timeoutMs);
  return {
    ...parsed,
    type: "request",
    id: parsed.id,
    method: parsed.method as RpcMethodName,
    params: parsed.params as RpcRequestMap[RpcMethodName]["params"],
    priority: normalizeRpcRequestPriority(parsed.priority),
    ...(timeoutMs !== null ? { timeoutMs } : {}),
  };
}

/**
 * Parse either a request or cancel message from a websocket payload.
 * @param raw - raw argument for raw.
 */
function parseRpcClientMessage(raw: string): RpcClientMessage {
  let parsed: Partial<RpcClientMessage>;
  try {
    parsed = JSON.parse(raw) as Partial<RpcClientMessage>;
  } catch {
    webServerLogger.warning({
      message: "Invalid RPC client message JSON",
      payloadPreview: raw.slice(0, 200),
    });
    throw new Error("Invalid RPC request payload");
  }
  if (parsed.type === "cancel" && typeof parsed.id === "number") {
    webServerLogger.trace({
      message: "RPC client cancel received",
      requestId: parsed.id,
    });
    return {
      type: "cancel",
      id: parsed.id,
    };
  }

  webServerLogger.trace({
    message: "RPC client request payload received",
    payloadType: parsed.type,
  });
  return parseRpcRequestMessage(raw);
}

/**
 * Convert exceptions into user-facing string payloads.
 * @param error - Error value to process.
 */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
/**
 * Builds rpc error payload.
 * @param error - Error value to process.
 */

function buildRpcErrorPayload(
  error: unknown,
): Pick<
  Extract<RpcResponseMessage, { ok: false }>,
  "error" | "errorCode" | "errorDetails"
> {
  if (error instanceof AuthServiceError) {
    return {
      error: error.message,
      errorCode: error.code,
      errorDetails: error.details ?? null,
    };
  }

  return {
    error: toErrorMessage(error),
  };
}

/**
 * Build cancellation `Error` with causal metadata while preserving names.
 * @param reason - Reason for this operation.
 * @param fallbackMessage - fallbackMessage argument for fallbackMessage.
 */
function createAbortError(reason: unknown, fallbackMessage: string): Error {
  if (reason instanceof Error) {
    return reason;
  }

  const error = new Error(
    typeof reason === "string" && reason.trim() ? reason : fallbackMessage,
    {
      cause: reason,
    },
  );
  if (reason instanceof DOMException && reason.name) {
    error.name = reason.name;
  } else {
    error.name = "AbortError";
  }
  return error;
}

/**
 * Distinguish timeout/cancel style abort errors.
 * @param error - Error value to process.
 */
function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Coerce raw timeout values into normalized positive integers.
 * @param value - Input value.
 */
function normalizeTimeoutMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(value));
}

/**
 * Normalize unknown priorities to a valid RPC priority enum value.
 * @param value - Input value.
 */
function normalizeRpcRequestPriority(value: unknown): RpcRequestPriority {
  if (value === "background" || value === "default" || value === "foreground") {
    return value;
  }
  return "default";
}

/**
 * Return (or create) a per-client map for pending RPC operations.
 */

function getPendingRpcRequests(
  client: ServerWebSocket<RpcWebSocketSocketData>,
): Map<number, PendingRpcRequest> {
  const existing = pendingRpcRequestsByClient.get(client);
  if (existing) {
    return existing;
  }

  const created = new Map<number, PendingRpcRequest>();
  pendingRpcRequestsByClient.set(client, created);
  return created;
}

/**
 * Cancel one request for a client when a matching cancel packet arrives.
 */

function abortPendingRpcRequest(
  client: ServerWebSocket<RpcWebSocketSocketData>,
  requestId: number,
): void {
  const pendingRequests = pendingRpcRequestsByClient.get(client);
  const pending = pendingRequests?.get(requestId);
  if (!pending) {
    webServerLogger.trace({
      message: "RPC request cancel ignored",
      requestId,
      authBypass: client.data.authBypass,
      sessionId: client.data.sessionId,
    });
    return;
  }

  pending.canceledByClient = true;
  webServerLogger.trace({
    message: "RPC request canceled by client",
    requestId,
    authBypass: client.data.authBypass,
    sessionId: client.data.sessionId,
  });
  pending.controller.abort(
    createAbortError(
      null,
      `RPC request ${requestId} was canceled by the client.`,
    ),
  );
}

/**
 * Abort all outstanding requests for a socket (cleanup on disconnect/error paths).
 */

function abortAllPendingRpcRequests(
  client: ServerWebSocket<RpcWebSocketSocketData>,
  reason: string,
): void {
  const pendingRequests = pendingRpcRequestsByClient.get(client);
  if (!pendingRequests) {
    return;
  }

  webServerLogger.trace({
    message: "Aborting all pending RPC requests",
    requestCount: pendingRequests.size,
    reason,
    authBypass: client.data.authBypass,
    sessionId: client.data.sessionId,
  });
  for (const pending of pendingRequests.values()) {
    pending.canceledByClient = true;
    pending.controller.abort(createAbortError(null, reason));
  }
  decrementPendingRpcRequestCount(pendingRequests.size);
  pendingRequests.clear();
  pendingRpcRequestsByClient.delete(client);
}

/**
 * Await request completion while short-circuiting on abort/timeout signal events.
 */

async function awaitRequestResult<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    throw createAbortError(signal.reason, "RPC request aborted.");
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener("abort", handleAbort);
      reject(createAbortError(signal.reason, "RPC request aborted."));
    };
    signal.addEventListener("abort", handleAbort, {
      once: true,
    });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

/**
 * Normalize raw websocket data to a string payload.
 * @param rawMessage - rawMessage argument for rawMessage.
 */
function parseRawSocketMessage(rawMessage: string | Buffer): string {
  return typeof rawMessage === "string"
    ? rawMessage
    : Buffer.from(rawMessage).toString("utf8");
}

/**
 * Create an abort controller and optionally attach timeout behavior.
 * @param timeoutMs - timeoutMs argument for timeoutMs.
 */
function buildRequestSignal(timeoutMs: number | null): {
  controller: AbortController;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  if (typeof timeoutMs !== "number") {
    return {
      controller,
      signal: controller.signal,
    };
  }

  return {
    controller,
    signal: AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(timeoutMs),
    ]),
  };
}

/**
 * Check whether an abort signal came from timeout signal expiry.
 * @param signal - Abort signal for cancellation.
 */
function isTimeoutAbort(signal: AbortSignal): boolean {
  return (
    signal.reason instanceof DOMException &&
    signal.reason.name === "TimeoutError"
  );
}

/**
 * Convert aborted execution into a user-facing RPC timeout message when appropriate.
 */

function toRpcAbortMessage(
  request: RpcRequestMessage,
  pending: PendingRpcRequest,
  error: unknown,
): string {
  if (pending.timeoutMs !== null && isTimeoutAbort(pending.signal)) {
    return `RPC request "${String(request.method)}" timed out after ${pending.timeoutMs}ms.`;
  }
  return toErrorMessage(error);
}

/**
 * Queue/reuse rebuilds for mainview bundle so rapid file edits only rebuild once.
 */

function queueMainviewBundleBuild(): Promise<string> {
  if (mainviewBuildPromise) {
    mainviewRebuildQueued = true;
    return mainviewBuildPromise;
  }

  mainviewBuildPromise = (async () => {
    try {
      do {
        mainviewRebuildQueued = false;
        mainviewBundlePath = await buildMainviewBundle();
      } while (mainviewRebuildQueued);

      return mainviewBundlePath;
    } finally {
      mainviewBuildPromise = null;
    }
  })();

  return mainviewBuildPromise;
}

/**
 * Broadcast a dev reload event to connected clients (frontend hot reload path).
 * @param reason - Reason for this operation.
 */
function broadcastReload(reason: string): void {
  if (!IS_DEV_SERVER || rpcClients.size === 0) {
    return;
  }

  const payload: RpcReloadMessage = {
    type: "reload",
    reason,
  };
  const raw = JSON.stringify(payload satisfies RpcSocketMessage);
  for (const client of rpcClients) {
    try {
      client.send(raw);
    } catch {
      rpcClients.delete(client);
    }
  }
}

/**
 * Broadcast that a worktree task list changed.
 * @param projectId - Project identifier.
 * @param worktreePath - Worktree path.
 */
function broadcastTasksChanged(projectId: number, worktreePath: string): void {
  if (rpcClients.size === 0) {
    return;
  }

  const payload: RpcTasksChangedMessage = {
    type: "tasks-changed",
    projectId,
    worktreePath,
  };
  const raw = JSON.stringify(payload satisfies RpcSocketMessage);
  for (const client of rpcClients) {
    try {
      client.send(raw);
    } catch {
      rpcClients.delete(client);
    }
  }
}

/**
 * Broadcast that git history changed for a tracked worktree.
 */

function broadcastGitHistoryChanged(
  projectId: number,
  worktreePath: string,
): void {
  if (rpcClients.size === 0) {
    return;
  }

  const payload: RpcGitHistoryChangedMessage = {
    type: "git-history-changed",
    projectId,
    worktreePath,
  };
  const raw = JSON.stringify(payload satisfies RpcSocketMessage);
  for (const client of rpcClients) {
    try {
      client.send(raw);
    } catch {
      rpcClients.delete(client);
    }
  }
}

/**
 * Broadcast that the UI should focus a specific project/worktree/thread context.
 * @param payload - payload argument for payload.
 */
function broadcastContextFocusChanged(payload: RpcContextFocusChanged): void {
  if (rpcClients.size === 0) {
    return;
  }

  const message: RpcContextFocusChangedMessage = {
    type: "context-focus-changed",
    ...payload,
  };
  const raw = JSON.stringify(message satisfies RpcSocketMessage);
  for (const client of rpcClients) {
    try {
      client.send(raw);
    } catch {
      rpcClients.delete(client);
    }
  }
}

/**
 * Broadcast that a background thread start request was created.
 */

function broadcastThreadStartRequestCreated(
  request: RpcThreadStartRequest,
): void {
  if (rpcClients.size === 0) {
    return;
  }

  const payload: RpcThreadStartRequestCreatedMessage = {
    type: "thread-start-request-created",
    ...request,
  };
  const raw = JSON.stringify(payload satisfies RpcSocketMessage);
  for (const client of rpcClients) {
    try {
      client.send(raw);
    } catch {
      rpcClients.delete(client);
    }
  }
}
/**
 * Normalizes watch filename.
 * @param filename - Target filename.
 */

function normalizeWatchFilename(filename?: string | Buffer | null): string {
  if (typeof filename === "string") {
    return filename.trim();
  }
  if (filename) {
    return filename.toString("utf8").trim();
  }
  return "";
}

/**
 * Flush pending file change events and decide whether to rebuild or just reload assets.
 */

function flushPendingMainviewReloads(): void {
  pendingMainviewReloadTimer = null;
  const changedFiles = [...pendingMainviewChanges].map((entry) =>
    entry.toLowerCase(),
  );
  pendingMainviewChanges.clear();

  const requiresBuild = changedFiles.some(
    (entry) => !entry || entry.endsWith(".ts") || entry.endsWith(".tsx"),
  );
  const requiresReload =
    requiresBuild ||
    changedFiles.some(
      (entry) => !entry || entry === "index.css" || entry === "index.html",
    );
  if (!requiresReload) {
    return;
  }

  void (async () => {
    if (requiresBuild) {
      try {
        await queueMainviewBundleBuild();
      } catch (error) {
        webServerLogger.error({
          message:
            "Failed to rebuild the mainview bundle after a source change",
          error: normalizeErrorDescription(error),
        });
        return;
      }
    }

    broadcastReload(requiresBuild ? "mainview-source" : "mainview-asset");
  })();
}

/**
 * Debounce file change reload notifications to reduce event fan-out.
 * @param filename - Target filename.
 */
function enqueueMainviewReload(filename?: string | Buffer | null): void {
  const normalizedFilename = normalizeWatchFilename(filename);
  pendingMainviewChanges.add(normalizedFilename);

  if (pendingMainviewReloadTimer) {
    clearTimeout(pendingMainviewReloadTimer);
  }
  pendingMainviewReloadTimer = setTimeout(
    flushPendingMainviewReloads,
    MAINVIEW_RELOAD_DEBOUNCE_MS,
  );
}

/**
 * Read mainview directory mtimes and return a normalized path->mtime map.
 */

function readMainviewFileStamps(): Map<string, number> {
  const nextStamps = new Map<string, number>();
  const visitedRealPaths = new Set<string>();

  /**
   * Reads directory.
   * @param directoryPath - directoryPath path used by readDirectory.
   */

  const readDirectory = (directoryPath: string) => {
    let realPath: string;
    try {
      realPath = realpathSync(directoryPath);
    } catch {
      return;
    }

    if (visitedRealPaths.has(realPath)) {
      return;
    }
    visitedRealPaths.add(realPath);

    let entries: string[];
    try {
      entries = readdirSync(directoryPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = resolve(directoryPath, entry);
      const stats = statSync(entryPath, {
        throwIfNoEntry: false,
      });
      if (!stats) {
        continue;
      }
      if (stats.isDirectory()) {
        readDirectory(entryPath);
        continue;
      }
      if (!stats.isFile()) {
        continue;
      }

      nextStamps.set(
        relative(MAINVIEW_SOURCE_DIR, entryPath).replace(/\\/g, "/"),
        stats.mtimeMs,
      );
    }
  };

  readDirectory(MAINVIEW_SOURCE_DIR);

  return nextStamps;
}

/**
 * Start polling-based file watching in dev mode and enqueue debounced reloads on drift.
 */

function startDevMainviewWatcher(): void {
  if (!IS_DEV_SERVER || devMainviewPollTimer) {
    return;
  }

  mainviewFileStamps = readMainviewFileStamps();
  devMainviewPollTimer = setInterval(() => {
    const nextStamps = readMainviewFileStamps();
    for (const [entry, mtimeMs] of nextStamps) {
      const previousMtimeMs = mainviewFileStamps.get(entry);
      if (previousMtimeMs !== mtimeMs) {
        enqueueMainviewReload(entry);
      }
    }
    for (const entry of mainviewFileStamps.keys()) {
      if (!nextStamps.has(entry)) {
        enqueueMainviewReload(entry);
      }
    }
    mainviewFileStamps = nextStamps;
  }, MAINVIEW_WATCH_INTERVAL_MS);
}

/**
 * Stop active polling/reload timers and clear pending file state.
 */

function shutdownDevWatchers(): void {
  if (devMainviewPollTimer) {
    clearInterval(devMainviewPollTimer);
    devMainviewPollTimer = null;
  }
  mainviewFileStamps.clear();

  if (pendingMainviewReloadTimer) {
    clearTimeout(pendingMainviewReloadTimer);
    pendingMainviewReloadTimer = null;
  }
  pendingMainviewChanges.clear();
}

/**
 * Start DB recovery, background listeners, and HTTP/WebSocket server bootstrap.
 */

async function bootstrap(): Promise<void> {
  if (DEV_FLOW_MODE.resetOnStartup) {
    resetLocalAppState({
      logger: {
        warn: (message: string, ...extra: unknown[]) => {
          const detail =
            extra.length > 0
              ? `${String(message)} ${extra.map((item) => String(item)).join(" ")}`
              : message;
          webServerLogger.warning(detail);
        },
      },
    });
  }
  if (DEV_FLOW_MODE.authBypass) {
    webServerLogger.warning(
      "[jolt] JOLT_DEV_BYPASS=1 is active. Auth and RPC login checks are bypassed in dev mode.",
    );
  }

  initAppDatabase();
  recoverInterruptedThreadTurnsOnStartup();
  startCronScheduler();
  if (!BACKEND_ONLY) {
    await queueMainviewBundleBuild();
    startDevMainviewWatcher();
  }
  startProcedureCacheMaintenance();
  setWorktreeTaskChangeListener((projectId, worktreePath) => {
    broadcastTasksChanged(projectId, worktreePath);
  });
  setWorktreeGitHistoryChangeListener((projectId, worktreePath) => {
    broadcastGitHistoryChanged(projectId, worktreePath);
  });

  let activeServerPort = SERVER_PORT;
  startOverloadMonitoring(() => activeServerPort);
  const serverOptions = {
    hostname: LOOPBACK_HOSTNAME,
    idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS /**
     * Fetches data from the configured endpoint.
     * @param request - Incoming request payload.
     * @param serverInstance - serverInstance argument for fetch.
     */,

    async fetch(request, serverInstance) {
      const requestUrl = new URL(request.url);
      const { pathname } = requestUrl;
      const requestId = request.headers.get("x-request-id")?.trim();
      const source = requestUrl.origin;
      const requestStartMs = Date.now();

      webServerLogger.trace({
        message: "HTTP request received",
        method: request.method,
        pathname,
        source,
        requestId: requestId ?? null,
      });

      const authResponse = await handleAuthRequest(request);
      if (authResponse) {
        webServerLogger.trace({
          message: "HTTP request handled by auth route",
          method: request.method,
          pathname,
          status: authResponse.status,
          source,
          requestId: requestId ?? null,
          durationMs: Date.now() - requestStartMs,
        });
        return authResponse;
      }

      // Upgrade websocket requests before falling through to HTTP routes.
      if (pathname === "/rpc") {
        const allowedOrigins = new Set([
          ...buildLoopbackBrowserOrigins(activeServerPort),
          ...buildLoopbackBrowserOrigins(DEFAULT_HTTP_PROXY_PORT, {
            protocols: ["http:"],
          }),
          ...buildLoopbackBrowserOrigins(DEFAULT_HTTPS_PROXY_PORT, {
            protocols: ["https:"],
          }),
          ...CONFIGURED_ALLOWED_WS_ORIGINS,
        ]);
        const proxyOrigin = resolveRpcClientOriginFromRequest(request);
        if (proxyOrigin) {
          allowedOrigins.add(proxyOrigin);
        }
        if (
          !isWebSocketOriginAllowed(
            request.headers.get("origin"),
            allowedOrigins,
          )
        ) {
          webServerLogger.warning({
            message: "WebSocket origin not allowed",
            method: request.method,
            pathname,
            source,
            requestId: requestId ?? null,
            origin: request.headers.get("origin"),
          });
          return stringResponse(
            "WebSocket origin not allowed",
            "text/plain; charset=utf-8",
            403,
          );
        }
        const websocketAuth = authorizeRpcWebSocketUpgrade({
          authBypass: DEV_FLOW_MODE.authBypass,
          cookieHeader: request.headers.get("cookie"),
          nowMs: currentNowMs(),
          requestUrl: request.url,
          validateTicket: (input) => {
            validateAndConsumeWebSocketTicket(initAppDatabase(), input);
          },
        });
        if (!websocketAuth.ok) {
          if (websocketAuth.failure.kind === "auth_error") {
            webServerLogger.warning({
              message: "WebSocket auth failed",
              method: request.method,
              pathname,
              status: "auth_error",
              source,
              requestId: requestId ?? null,
              reason: normalizeErrorDescription(websocketAuth.failure.error),
            });
            return authErrorResponse(request, websocketAuth.failure.error, {
              clearSessionCookie: websocketAuth.failure.clearSessionCookie,
            });
          }
          webServerLogger.warning({
            message: "WebSocket upgrade rejected",
            method: request.method,
            pathname,
            status: websocketAuth.failure.status,
            source,
            requestId: requestId ?? null,
          });
          return new Response(websocketAuth.failure.body, {
            headers: buildResponseHeaders("text/plain; charset=utf-8"),
            status: websocketAuth.failure.status,
          });
        }

        webServerLogger.trace({
          message: "WebSocket auth passed",
          method: request.method,
          pathname,
          authBypass: websocketAuth.socketData.authBypass,
          sessionId: websocketAuth.socketData.sessionId,
          source,
          requestId: requestId ?? null,
        });

        if (
          serverInstance.upgrade(request, {
            data: websocketAuth.socketData,
          })
        ) {
          webServerLogger.info({
            message: "WebSocket upgrade accepted",
            method: request.method,
            pathname,
            source,
            requestId: requestId ?? null,
          });
          return;
        }

        webServerLogger.warning({
          message: "WebSocket upgrade failed",
          method: request.method,
          pathname,
          source,
          requestId: requestId ?? null,
        });
        return stringResponse(
          "WebSocket upgrade failed",
          "text/plain; charset=utf-8",
          400,
        );
      }

      if (!BACKEND_ONLY && (pathname === "/" || pathname === "/index.html")) {
        webServerLogger.trace({
          message: "Serving HTML entrypoint",
          pathname,
          source,
          requestId: requestId ?? null,
        });
        return htmlResponse();
      }

      if (!BACKEND_ONLY && pathname === "/index.css") {
        webServerLogger.trace({
          message: "Serving mainview css",
          pathname,
          source,
          requestId: requestId ?? null,
        });
        return fileResponse(MAINVIEW_CSS_PATH, "text/css; charset=utf-8");
      }

      if (!BACKEND_ONLY && pathname === "/index.js") {
        webServerLogger.trace({
          message: "Serving mainview bundle",
          pathname,
          source,
          requestId: requestId ?? null,
        });
        return fileResponse(
          mainviewBundlePath,
          "application/javascript; charset=utf-8",
        );
      }

      if (!BACKEND_ONLY && pathname === "/fonts/fira-code-vf.woff2") {
        webServerLogger.trace({
          message: "Serving font asset",
          pathname,
          source,
          requestId: requestId ?? null,
        });
        return fileResponse(FIRA_CODE_VARIABLE_FONT_PATH, "font/woff2");
      }

      if (
        !BACKEND_ONLY &&
        pathname === "/fonts/inter-latin-wght-normal.woff2"
      ) {
        webServerLogger.trace({
          message: "Serving font asset",
          pathname,
          source,
          requestId: requestId ?? null,
        });
        return fileResponse(INTER_VARIABLE_FONT_LATIN_PATH, "font/woff2");
      }

      if (
        !BACKEND_ONLY &&
        pathname === "/fonts/inter-latin-ext-wght-normal.woff2"
      ) {
        webServerLogger.trace({
          message: "Serving font asset",
          pathname,
          source,
          requestId: requestId ?? null,
        });
        return fileResponse(INTER_VARIABLE_FONT_LATIN_EXT_PATH, "font/woff2");
      }

      if (pathname === "/health") {
        webServerLogger.trace({
          message: "Serving health endpoint",
          pathname,
          source,
          requestId: requestId ?? null,
        });
        return stringResponse(
          JSON.stringify(buildLivenessPayload(true)),
          "application/json; charset=utf-8",
        );
      }

      webServerLogger.warning({
        message: "HTTP route not found",
        method: request.method,
        pathname,
        source,
        requestId: requestId ?? null,
      });
      return stringResponse("Not found", "text/plain; charset=utf-8", 404);
    },
    websocket: {
      /**
       * Opens .
       * @param ws - ws argument for open.
       */

      open(ws) {
        rpcClients.add(ws);
        getPendingRpcRequests(ws);
        webServerLogger.trace({
          message: "WebSocket client connected",
          authBypass: ws.data.authBypass,
          sessionId: ws.data.sessionId,
          totalClients: rpcClients.size,
        });
      } /**
       * Closes .
       * @param ws - ws argument for close.
       */,

      close(ws) {
        rpcClients.delete(ws);
        abortAllPendingRpcRequests(ws, "RPC connection closed.");
        webServerLogger.trace({
          message: "WebSocket client disconnected",
          authBypass: ws.data.authBypass,
          sessionId: ws.data.sessionId,
          totalClients: rpcClients.size,
        });
        if (rpcClients.size === 0) {
          webServerLogger.trace({
            message: "RPC client set empty, suspending polling",
            totalClients: rpcClients.size,
          });
          suspendActiveWorktreePolling();
        }
      } /**
       * Processes message events.
       * @param ws - ws argument for message.
       * @param rawMessage - rawMessage argument for message.
       */,

      message(ws, rawMessage) {
        void (async () => {
          const messageStartedAt = Date.now();
          const payload = parseRawSocketMessage(rawMessage);
          let requestId = -1;
          const messageByteLength =
            typeof rawMessage === "string"
              ? rawMessage.length
              : rawMessage.byteLength;
          webServerLogger.trace({
            message: "WebSocket message received",
            payloadType: typeof rawMessage,
            authBypass: ws.data.authBypass,
            sessionId: ws.data.sessionId,
            messageByteLength,
          });
          try {
            // Each websocket message is treated as either cancel or request and resolved independently.
            const message = parseRpcClientMessage(payload);
            if (message.type === "cancel") {
              webServerLogger.trace({
                message: "RPC client cancel message",
                requestId: message.id,
                authBypass: ws.data.authBypass,
                sessionId: ws.data.sessionId,
              });
              abortPendingRpcRequest(ws, message.id);
              return;
            }

            const request = message;
            requestId = request.id;
            webServerLogger.trace({
              message: "RPC request processing started",
              requestId: request.id,
              method: request.method,
              priority: request.priority,
              timeoutMs: request.timeoutMs ?? null,
              authBypass: ws.data.authBypass,
              sessionId: ws.data.sessionId,
            });
            const pendingRequests = getPendingRpcRequests(ws);
            if (pendingRequests.has(request.id)) {
              webServerLogger.warning({
                message: "Duplicate RPC request received while pending",
                requestId: request.id,
                method: request.method,
                authBypass: ws.data.authBypass,
                sessionId: ws.data.sessionId,
              });
              throw new Error(`RPC request ${request.id} is already pending.`);
            }

            const { controller, signal } = buildRequestSignal(
              request.timeoutMs ?? null,
            );
            const pending: PendingRpcRequest = {
              controller,
              signal,
              timeoutMs: request.timeoutMs ?? null,
              canceledByClient: false,
            };
            pendingRequests.set(request.id, pending);
            incrementPendingRpcRequestCount();
            webServerLogger.trace({
              message: "RPC request registered",
              requestId: request.id,
              pendingForClient: pendingRequests.size,
              globalPending: pendingRpcRequestCount,
            });

            if (!ws.data.authBypass) {
              const session = resolveSession(initAppDatabase(), {
                nowMs: currentNowMs(),
                sessionId: ws.data.sessionId,
                touch: true,
              });
              if (!session) {
                throw new AuthServiceError(
                  "session_required",
                  "A valid authenticated session is required.",
                  401,
                );
              }
            }

            const handler = rpcHandlers[request.method] as (
              params: RpcRequestMap[RpcMethodName]["params"],
              context: RpcRequestContext,
            ) => Promise<RpcRequestMap[RpcMethodName]["response"]>;
            try {
              const result = await awaitRequestResult(
                handler(request.params, {
                  auth: ws.data,
                  signal,
                  priority: request.priority,
                  timeoutMs: pending.timeoutMs,
                }),
                signal,
              );
              if (pending.canceledByClient || signal.aborted) {
                return;
              }

              const response: RpcResponseMessage = {
                id: request.id,
                ok: true,
                result,
                type: "response",
              };
              ws.send(JSON.stringify(response satisfies RpcSocketMessage));
              webServerLogger.trace({
                message: "RPC request completed",
                requestId: request.id,
                method: request.method,
                durationMs: Date.now() - messageStartedAt,
                authBypass: ws.data.authBypass,
                sessionId: ws.data.sessionId,
              });
            } catch (error) {
              if (pending.canceledByClient) {
                return;
              }

              const isTimeout =
                isAbortError(error) &&
                pending.timeoutMs !== null &&
                isTimeoutAbort(pending.signal);
              const rpcError = isTimeout
                ? toRpcAbortMessage(request, pending, error)
                : normalizeErrorDescription(error);
              webServerLogger.warning({
                message: isTimeout
                  ? "RPC request timed out"
                  : "RPC request failed",
                requestId: request.id,
                method: request.method,
                durationMs: Date.now() - messageStartedAt,
                error: rpcError,
              });

              const response: RpcResponseMessage = {
                id: request.id,
                ok: false,
                ...(isAbortError(error) && signal.aborted
                  ? {
                      error: toRpcAbortMessage(request, pending, error),
                    }
                  : buildRpcErrorPayload(error)),
                type: "response",
              };
              ws.send(JSON.stringify(response satisfies RpcSocketMessage));
            } finally {
              if (pendingRequests.get(request.id) === pending) {
                pendingRequests.delete(request.id);
                decrementPendingRpcRequestCount();
                webServerLogger.trace({
                  message: "RPC request cleaned up",
                  requestId: request.id,
                  globalPending: pendingRpcRequestCount,
                  pendingForClient: pendingRequests.size,
                });
              }
            }
          } catch (error) {
            if (requestId < 0) {
              try {
                const parsed = JSON.parse(payload) as { id?: number };
                requestId = typeof parsed.id === "number" ? parsed.id : -1;
              } catch {
                requestId = -1;
              }
            }
            if (requestId < 0) {
              return;
            }
            webServerLogger.warning({
              message: "RPC message handling failed",
              requestId,
              error: normalizeErrorDescription(error),
            });
            const response: RpcResponseMessage = {
              id: requestId,
              ok: false,
              ...buildRpcErrorPayload(error),
              type: "response",
            };
            ws.send(JSON.stringify(response satisfies RpcSocketMessage));
          }
        })();
      },
    },
  } satisfies Bun.Serve.Options<RpcWebSocketSocketData>;

  let server: ReturnType<typeof Bun.serve>;
  try {
    // Preferred port first; in dev, gracefully fallback when occupied.
    server = Bun.serve({
      ...serverOptions,
      port: SERVER_PORT,
    });
  } catch (error) {
    if (
      !IS_DEV_SERVER ||
      SERVER_PORT_IS_EXPLICIT ||
      !isAddressInUseError(error)
    ) {
      throw error;
    }

    server = Bun.serve({
      ...serverOptions,
      port: 0,
    });
    activeServerPort = server.port ?? activeServerPort;
    webServerLogger.warning(
      `Port ${SERVER_PORT} is already in use; Jolt dev server fell back to http://localhost:${server.port ?? activeServerPort}.`,
    );
  }
  activeServerPort = server.port ?? activeServerPort;

  webServerLogger.info(
    BACKEND_ONLY
      ? `Jolt RPC backend listening on http://localhost:${server.port}`
      : `Jolt web app listening on http://localhost:${server.port}${IS_DEV_SERVER ? " (live reload enabled)" : ""}${TLS_RUNTIME.publicTls ? " with public HTTPS/WSS expected via reverse proxy" : ""}`,
  );

  setTimeout(() => {
    warmProcedureStartupCaches();
  }, 0);
}

let shutdownPromise: Promise<void> | null = null;

/**
 * Run coordinated shutdown steps once, then exit with the requested process code.
 * @param exitCode - exitCode argument for exitCode.
 */
async function shutdownAndExit(exitCode: number): Promise<void> {
  if (shutdownPromise) {
    process.exit(exitCode);
  }

  shutdownPromise = (async () => {
    shutdownDevWatchers();
    if (overloadMonitorTimer) {
      clearInterval(overloadMonitorTimer);
      overloadMonitorTimer = null;
    }
    setWorktreeGitHistoryChangeListener(null);
    setWorktreeTaskChangeListener(null);
    shutdownProcedureCacheMaintenance();
    shutdownProjectPolling();
    await stopCronScheduler();
    await shutdownActiveThreadTurns();
  })()
    .catch((error) => {
      webServerLogger.error({
        message: "Failed to cleanly shut down Jolt",
        error: normalizeErrorDescription(error),
      });
    })
    .finally(() => {
      process.exit(exitCode);
    });

  await shutdownPromise;
}

process.on("SIGINT", () => {
  void shutdownAndExit(0);
});

process.on("SIGTERM", () => {
  void shutdownAndExit(0);
});

process.on("uncaughtException", (error) => {
  webServerLogger.error({
    message: "Uncaught exception",
    error: normalizeErrorDescription(error),
  });
  void shutdownAndExit(1);
});

process.on("unhandledRejection", (reason) => {
  webServerLogger.error({
    message: "Unhandled promise rejection",
    error: normalizeErrorDescription(reason),
  });
  void shutdownAndExit(1);
});

await bootstrap();
