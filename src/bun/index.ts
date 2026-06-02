/**
 * @file src/bun/index.ts
 * @description Module for index.
 */

import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import type { ServerWebSocket } from "bun";
import {
  MAX_CHAT_IMAGE_ATTACHMENTS,
  MAX_CHAT_IMAGE_BYTES,
} from "../shared/chat-images";
import type { InjectedRuntimeConfig } from "../shared/runtime-config";
import {
  enforceAuthMutationRequestSecurity,
  enforceAuthReadRequestSecurity,
  generateAuthCsrfToken,
  RequestValidationError,
} from "./auth/http-security";
import {
  parseJsonObjectBody,
  toJsonRequestBodyLimitValidationError,
} from "./auth/json-body";
import {
  type AuthRouteRateLimitContext,
  closeAuthRouteRateLimitDatabase,
  noteAuthRouteAttemptSuccess,
  noteAuthRouteFailure,
  type RateLimitedAuthPath,
  readAuthRouteRateLimitStatus,
} from "./auth/rate-limit";
import { resetPrimaryFactorFromSession } from "./auth/reset";
import { migrateTotpAuthSecretsOnStartup } from "./auth/secret-migration";
import {
  AuthServiceError,
  appendAllClearedSessionCookies,
  appendAllClearedWebSocketTicketCookies,
  buildAuthCsrfCookieHeader,
  buildLogoutClearSiteDataHeader,
  buildSessionCookieHeader,
  buildWebSocketTicketCookieHeader,
  getAuthStatus,
  issueWebSocketTicket,
  login,
  loginWithRecoveryCode,
  logout,
  prepareTotpEnrollment,
  readSessionCookie,
  resolveSession,
  setupAuth,
  stepUpSession,
  validateAndConsumeWebSocketTicket,
} from "./auth/service";
import {
  buildMainviewBundle,
  collectMainviewBuildAssetPaths,
  MAINVIEW_BUILD_DIR,
  type MainviewBuildResult,
} from "./build-mainview";
import { exportPublicCalendarIcs } from "./calendar/export";
import { refreshDueExternalIcsCalendars } from "./calendar/ics";
import {
  runCalendarNotificationCleanup,
  scheduleDueCalendarReminders,
  setCalendarNotificationListener,
} from "./calendar/notifications";
import type { RpcCalendarReminderDelivery } from "./calendar/types";
import {
  type AuthSessionRecord,
  closeAppDatabase,
  deleteAppDatabaseFiles,
  getAppDatabasePath,
  initAppDatabase,
  isAppDatabaseOpen,
  stopAllActiveWebServerShares,
} from "./db";
import { resetLocalAppState, resolveDevFlowMode } from "./dev-flows";
import { createDevMainviewWatcher } from "./dev-mainview-watcher";
import { getGitSchedulerStats } from "./git";
import {
  isSecureRequest,
  readTrustedForwardedForPeer,
  resolveTrustedForwardedOrigin,
} from "./http-forwarded";
import { migrateLegacyPluginSettings } from "./legacy-plugin-settings-migration";
import { readLimitedTextBody } from "./limited-json-response";
import {
  createSubsystemLogger,
  type LogDescription,
  shouldEmitLogLevel,
  shutdownLoggingThread,
} from "./logging";
import {
  applyMainviewAssetRoot,
  buildMainviewAssetSnapshot,
} from "./mainview-assets";
import {
  escapeInlineJsonForHtml,
  injectMainviewHtmlBootstrapElement,
} from "./mainview-html-bootstrap";
import {
  resolveWebServerShareHost,
  resolveWebServerSharePort,
} from "./pi/web-server/share";
import {
  startPiWebServerShareWorker,
  stopPiWebServerShareWorker,
} from "./pi/web-server/share-worker";
import { PluginDataQuotaError } from "./plugin/data";
import { PluginFetchError } from "./plugin/fetch";
import { PluginFsPathError } from "./plugin/fs-path";
import { PluginFsReadError } from "./plugin/fs-read";
import { PluginFsWriteError } from "./plugin/fs-write";
import {
  createPluginSidecarProcessManager,
  type PluginSidecarProcessManager,
  resolvePluginSidecarRuntimeKind,
} from "./plugin/sidecar-manager";
import {
  PluginSqliteError,
  refreshPluginSqliteNativeSecurityDiagnostic,
} from "./plugin/sqlite";
import { WorkspacePathError } from "./project-procedures/workspace-path-policy";
import {
  approveThreadStartRequestProcedure,
  closeProjectProcedure,
  closeTerminalProcedure,
  closeWorktreeProcedure,
  createCalendarEventProcedure,
  createCalendarProcedure,
  createExternalIcsCalendarProcedure,
  createPluginIngressLinkCodeProcedure,
  createTerminalProcedure,
  createThreadProcedure,
  createDefaultPluginIngressThreadHost,
  createWorktreeProcedure,
  deleteCalendarEventProcedure,
  deleteCalendarProcedure,
  deleteExternalIcsCalendarProcedure,
  deletePluginIngressExternalBindingProcedure,
  deleteProjectProcedure,
  deleteThreadProcedure,
  discardEmptyThreadProcedure,
  dismissCalendarNotificationProcedure,
  dismissUserNotificationProcedure,
  focusContextProcedure,
  getAppBootstrapProcedure,
  getCalendarBootstrapProcedure,
  getHomeDirectoryProcedure,
  getModelCatalogProcedure,
  getPluginInventoryProcedure,
  getPluginSettingsProcedure,
  getProcedureRuntimeStats,
  getTerminalSettingsProcedure,
  getThreadMessageContentProcedure,
  getThreadProcedure,
  getTimezoneSettingsProcedure,
  getUserRuntimeSettingsProcedure,
  getWorktreeGitCommitDiffProcedure,
  getWorktreeSnapshotProcedure,
  leaveSharedCalendarProcedure,
  listCalendarNotificationsProcedure,
  listCalendarOccurrencesProcedure,
  listCronsProcedure,
  listDirectorySuggestionsProcedure,
  listPluginAccessGroupsProcedure,
  listPluginIngressExternalBindingsProcedure,
  listPluginIngressRouteConfigsProcedure,
  listPluginIngressSourcesProcedure,
  listProjectFaviconsProcedure,
  listProjectSkillsProcedure,
  listProjectsProcedure,
  listProjectWorktreesProcedure,
  listTerminalsProcedure,
  listThreadStatusesProcedure,
  listThreadsProcedure,
  listUserNotificationsProcedure,
  listWorktreeGitHistoryProcedure,
  logClientEventProcedure,
  markThreadErrorSeenProcedure,
  newCronProcedure,
  openProjectProcedure,
  openProjectsBatchProcedure,
  openWorktreeProcedure,
  openWorktreesBatchProcedure,
  readWorktreeFileContentPageProcedure,
  readWorktreeFileDiffProcedure,
  recoverInterruptedThreadTurnsOnStartup,
  refreshExternalIcsCalendarProcedure,
  renameTerminalProcedure,
  renameThreadProcedure,
  requestThreadStartProcedure,
  respondThreadExtensionUiProcedure,
  runCronNowProcedure,
  runPluginAdminActionProcedure,
  runPluginLifecycleActionProcedure,
  sendThreadMessageProcedure,
  setActiveWorktreeProcedure,
  setCalendarShareProcedure,
  setContextFocusChangeListener,
  setPluginIngressExternalBindingEnabledProcedure,
  setCronJobsChangeListener,
  upsertPluginIngressRouteConfigProcedure,
  setPiPluginSidecarManager,
  setThreadExtensionUiMessageListener,
  setThreadPinnedProcedure,
  setThreadStartRequestCreatedListener,
  setThreadStartRequestResolvedListener,
  setThreadStatusChangeListener,
  setUserNotificationSentListener,
  setWorktreeGitHistoryChangeListener,
  setWorktreePinnedProcedure,
  shutdownActiveThreadTurns,
  shutdownProcedureCacheMaintenance,
  shutdownProjectPolling,
  snoozeCalendarNotificationProcedure,
  startProcedureCacheMaintenance,
  stopThreadTurnProcedure,
  suspendActiveWorktreePolling,
  updateCalendarEventProcedure,
  updateCalendarNotificationSettingsProcedure,
  updateCalendarPreferenceProcedure,
  updateCalendarProcedure,
  updateCronProcedure,
  updateExternalIcsCalendarProcedure,
  updatePluginSettingsProcedure,
  updateTerminalSettingsProcedure,
  updateThreadAccessProcedure,
  updateThreadExtensionEditorProcedure,
  updateThreadMetadataProcedure,
  updateThreadModelProcedure,
  updateThreadReasoningEffortProcedure,
  updateTimezoneSettingsProcedure,
  updateUserRuntimeSettingsProcedure,
  warmProcedureStartupCaches,
} from "./project-procedures";
import { requireLocalOperatorCapability } from "./project-procedures/local-operator";
import { buildModelCatalog } from "./project-procedures/model-catalog";
import {
  MAINVIEW_HTML_BOOTSTRAP_CONTRACT,
  type RpcAppBootstrapResult,
  type RpcContextFocusChanged,
  type RpcModelCatalog,
  type RpcPluginInventory,
  type RpcRequestContext,
  type RpcRequestPriority,
  type RpcTerminal,
  type RpcThread,
  type RpcThreadExtensionUiRequest,
  type RpcThreadStartRequest,
  type RpcThreadStartRequestResolved,
  type RpcUserNotificationDelivery,
} from "./rpc-schema";
import { createBackendRpcHandlers } from "./rpc-handlers/backend";
import { createUnavailablePluginGcRunner } from "./rpc-handlers/plugin-admin";
import { consumeRpcWebSocketPreParseBudget } from "./rpc-websocket-abuse-control";
import {
  createRpcTransport,
  type ParsedRpcClientMessage,
  type RpcClientMessage,
  type RpcMethodName,
  type RpcRequestMap,
  type RpcRequestMessage,
  type RpcResponseMessage,
  type RpcSocketMessage,
  type RpcTransport,
} from "./rpc-transport";
export { classifyRpcWebSocketSendStatus } from "./rpc-transport";
import {
  authorizeRpcWebSocketUpgrade,
  revalidateRpcWebSocketSession,
  type RpcWebSocketSocketData,
} from "./rpc-websocket-auth";
import {
  buildRuntimeDiagnosticsSnapshot,
  getRuntimeStatsSummary,
  recordRpcCanceled,
  recordRpcFailed,
  recordRpcStarted,
  recordRpcSucceeded,
  recordRpcTimedOut,
  recordWebSocketPush,
  resetRuntimeStats,
} from "./runtime-stats";
import {
  deleteRuntimeStatsSidecarDatabaseFiles,
  type RuntimeStatsSidecar,
  startRuntimeStatsSidecar,
  TRACK_TELEMETRY_FLAG,
} from "./runtime-stats-sidecar";
import { handleMainviewStaticAssetRequest } from "./server/static-assets";
import {
  applySecurityHeaders,
  buildConfiguredBrowserOrigins,
  buildLivenessPayload,
  buildLoopbackBrowserOrigins,
  buildRuntimeConfigElement,
  isRuntimeStatsSecretMatch,
  isWebSocketOriginAllowed,
  LOOPBACK_HOSTNAME,
  normalizeBrowserOriginSet,
} from "./server-security";
import {
  startCronScheduler,
  stopCronScheduler,
  syncCronSchedulerCron,
  syncCronSchedulerTimezone,
} from "./sidecar-cron-scheduler";
import {
  type TerminalWebSocketData,
  terminalManager,
} from "./terminal-manager";
import { authorizeTerminalWebSocketUpgrade } from "./terminal-websocket-auth";
import { ThreadStatusCoalescer } from "./thread-status-coalescer";
import {
  formatLoopbackHttpOrigin,
  formatLoopbackWebSocketUrl,
  isPublicTlsEnabled,
  resolveTlsRuntimeConfig,
} from "./tls-config";
import { createTokenBucketRateLimiter } from "./token-bucket-rate-limit";

const DEFAULT_SERVER_PORT = "7599";
const MAINVIEW_SOURCE_DIR = resolve(process.cwd(), "src/mainview");
const MAINVIEW_HTML_PATH = resolve(process.cwd(), "src/mainview/index.html");
const MAINVIEW_CSS_PATH = resolve(process.cwd(), "src/mainview/index.css");
const GHOSTTY_WASM_PATH = resolve(
  process.cwd(),
  "node_modules/ghostty-web/ghostty-vt.wasm",
);
const MAINVIEW_BIRD_PATH = resolve(process.cwd(), "bird.png");
const FIRA_CODE_VARIABLE_FONT_PATH = resolve(
  process.cwd(),
  "src/mainview/fonts/fira-code-vf.woff2",
);
const INTER_VARIABLE_FONT_LATIN_PATH = resolve(
  process.cwd(),
  "src/mainview/fonts/inter-latin-wght-normal.woff2",
);
const INTER_VARIABLE_FONT_LATIN_EXT_PATH = resolve(
  process.cwd(),
  "src/mainview/fonts/inter-latin-ext-wght-normal.woff2",
);
const MAINVIEW_RELOAD_DEBOUNCE_MS = 90;
const THREAD_STATUS_PUSH_COALESCE_MS = 25;
const MAINVIEW_WATCH_INTERVAL_MS = 250;
const SERVER_IDLE_TIMEOUT_SECONDS = 30;
const SERVER_MONITOR_INTERVAL_MS = 1_000;
const SERVER_OVERLOAD_LOG_INTERVAL_MS = 10_000;
const EVENT_LOOP_LAG_WARN_MS = 150;
const EXTERNAL_ICS_REFRESH_WORKER_INTERVAL_MS = 60_000;
// Mainview behaves like an IDE, not a single-form web app. One websocket may
// legitimately multiplex startup hydration, background polling, and interactive
// thread work at the same time, so the per-client backlog needs real headroom.
export const MAX_PENDING_RPC_REQUESTS_PER_CLIENT = 64;
export const MAX_PENDING_RPC_REQUESTS = MAX_PENDING_RPC_REQUESTS_PER_CLIENT * 6;
export const PENDING_RPC_WARN_COUNT = MAX_PENDING_RPC_REQUESTS_PER_CLIENT / 2;
// Base64 encodes each complete or partial 3-byte group as 4 characters. Use
// ceil(bytes / 3) * 4 instead of ceil(bytes * 4 / 3) so exact-limit image
// payloads whose byte count is not divisible by 3 still fit through RPC
// string validation before the decoded byte-size check runs.
const MAX_BASE64_CHAT_IMAGE_BYTES = Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4;
// Chat image RPC frames are intentionally allowed to carry the largest valid
// desktop IDE message: every accepted image attachment at the per-image binary
// cap, expanded to base64, plus 1 MiB for prompt text and JSON metadata. Image
// count and decoded byte validation still run in procedure validation, so this
// websocket cap is an aggregate transport allowance rather than the only guard.
export const MAX_RPC_WEBSOCKET_MESSAGE_BYTES =
  MAX_BASE64_CHAT_IMAGE_BYTES * MAX_CHAT_IMAGE_ATTACHMENTS + 1024 * 1024;
export const MAX_THREAD_MESSAGE_INPUT_BYTES = 1024 * 1024;
export const MAX_RPC_PARAM_STRING_BYTES = 1024 * 1024;
export const MAX_THREAD_EXTENSION_EDITOR_TEXT_BYTES = 256 * 1024;
export const MAX_RPC_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_UNCOMPRESSED_SERVER_BINARY_FRAME_BYTES = 256 * 1024;
// The mainview multiplexes active polling, user actions, cancellation churn,
// streaming thread updates, terminal coordination, and cron/worktree refreshes
// through one authenticated local-operator websocket. The 180/s refill with a
// two-second 360-message burst is intentionally a desktop-IDE backpressure
// threshold, not an internet-facing abuse limit: procedure auth, payload caps,
// pending-request capacity, and backpressure closes still bound real server work.
const RPC_RATE_LIMIT_REFILL_PER_SECOND = 180;
const RPC_RATE_LIMIT_BURST = 360;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const DEFAULT_HTTP_PROXY_PORT = 80;
const DEFAULT_HTTPS_PROXY_PORT = 443;
const SHUTDOWN_TIMEOUT_MS = 15_000;

const webServerLogger = createSubsystemLogger("Web Server");

function traceWebServer(buildDescription: () => LogDescription): void {
  if (!shouldEmitLogLevel("TRACE")) {
    return;
  }
  webServerLogger.trace(buildDescription());
}

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
        throw new Error(`Missing value for ${arg}.`);
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

function readCliValue(args: string[], longFlag: string): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (typeof arg !== "string") {
      continue;
    }
    if (arg === longFlag) {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error(`Missing value for ${arg}.`);
      }
      return nextArg;
    }
    const prefix = `${longFlag}=`;
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return null;
}

/**
 * Resolve and validate server port from CLI arguments and optional env value.
 * @throws if port is non-numeric or outside 1..65535.
 * @param args - Argument list passed to args.
 * @param envPort - Environment-provided port used for local auth redirects.
 */
function resolveServerPort(args: string[], envPort?: string): number {
  const configuredPort = readCliPort(args) ?? envPort ?? DEFAULT_SERVER_PORT;
  if (!isStringInteger(configuredPort)) {
    throw new Error(
      `Invalid port "${configuredPort}". Expected an integer string from --port, -p, or METIDOS_PORT.`,
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

function resolveServerHostname(envHostname?: string): string {
  if (!envHostname) {
    return LOOPBACK_HOSTNAME;
  }
  if (envHostname === "0.0.0.0" || envHostname === "::") {
    if (!readEnvFlag("METIDOS_SERVER_ALLOW_PUBLIC_BIND")) {
      throw new Error(
        `METIDOS_SERVER_HOST="${envHostname}" requires METIDOS_SERVER_ALLOW_PUBLIC_BIND=1.`,
      );
    }
  }
  if (
    envHostname !== LOOPBACK_HOSTNAME &&
    envHostname !== "0.0.0.0" &&
    envHostname !== "::"
  ) {
    throw new Error(
      `Invalid METIDOS_SERVER_HOST "${envHostname}". Expected 127.0.0.1, 0.0.0.0, or ::.`,
    );
  }
  return envHostname;
}

function readEnvVar(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function readEnvFlag(name: string): boolean {
  return readEnvVar(name) === "1";
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;

export function normalizeRequestIdHeader(value: string | null): string | null {
  const normalized = value?.trim();
  if (!normalized || !REQUEST_ID_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

const WIPE_USER_DATA_FLAG = "--wipe-user-data";
const WIPE_USER_DATA_CONFIRMATION = "DELETE";

const SERVER_ARGS = Bun.argv.slice(2);
const CONFIGURED_SERVER_PORT =
  readCliPort(SERVER_ARGS) ?? readEnvVar("METIDOS_PORT");
const SERVER_PORT = resolveServerPort(SERVER_ARGS, readEnvVar("METIDOS_PORT"));
const SERVER_HOSTNAME = resolveServerHostname(
  readEnvVar("METIDOS_SERVER_HOST"),
);
const SERVER_PORT_IS_EXPLICIT = CONFIGURED_SERVER_PORT !== undefined;
const WEB_SERVER_SHARE_PORT = resolveWebServerSharePort(process.env);
const WEB_SERVER_SHARE_HOST =
  readCliValue(SERVER_ARGS, "--web-server-share-host") ??
  resolveWebServerShareHost(process.env);
const BACKEND_ONLY =
  SERVER_ARGS.includes("--backend-only") || readEnvFlag("METIDOS_BACKEND_ONLY");
const IS_DEV_SERVER =
  SERVER_ARGS.includes("--dev") || readEnvFlag("METIDOS_DEV");
const TRACK_RUNTIME_TELEMETRY = SERVER_ARGS.includes(TRACK_TELEMETRY_FLAG);
const PLUGIN_RUNTIME_KIND = resolvePluginSidecarRuntimeKind(
  readEnvVar("METIDOS_PLUGIN_RUNTIME_KIND"),
);
const PUBLIC_TLS_ENABLED = isPublicTlsEnabled(SERVER_ARGS, process.env);
const TLS_RUNTIME = resolveTlsRuntimeConfig({
  forceTls: PUBLIC_TLS_ENABLED,
});
const DEV_FLOW_MODE = resolveDevFlowMode({
  env: process.env,
  isDevServer: IS_DEV_SERVER,
});

if (WEB_SERVER_SHARE_PORT === SERVER_PORT) {
  throw new Error(
    `METIDOS web-server share port ${WEB_SERVER_SHARE_PORT} conflicts with the main HTTP port ${SERVER_PORT}. Configure ${"METIDOS_WEB_SERVER_SHARE_PORT"} to a different fixed port.`,
  );
}

process.env.METIDOS_PORT = String(SERVER_PORT);
process.env.METIDOS_RPC_HTTP_ORIGIN = formatLoopbackHttpOrigin(
  SERVER_PORT,
  false,
);
process.env.METIDOS_RPC_URL = formatLoopbackWebSocketUrl(SERVER_PORT, false);
process.env.METIDOS_WEB_SERVER_SHARE_PORT = String(WEB_SERVER_SHARE_PORT);
process.env.METIDOS_WEB_SERVER_SHARE_HOST = WEB_SERVER_SHARE_HOST;

const CONFIGURED_ALLOWED_WS_ORIGINS = buildConfiguredBrowserOrigins({
  allowedOrigins: readEnvVar("METIDOS_ALLOWED_WS_ORIGINS"),
  publicOrigin: readEnvVar("METIDOS_PUBLIC_ORIGIN"),
});
const RUNTIME_STATS_SHARED_SECRET = readEnvVar("METIDOS_RUNTIME_STATS_SECRET");
const MAINVIEW_DYNAMIC_STYLE_NONCE = randomBytes(16).toString("base64");

function buildNormalizedAllowedWsOrigins(
  activeServerPort: number,
): Set<string> {
  // Metidos is a local-operator app, so default browser origins include the
  // active loopback port plus conventional localhost reverse-proxy ports. Public
  // TLS deployments must still set METIDOS_PUBLIC_ORIGIN (or
  // METIDOS_ALLOWED_WS_ORIGINS for additional hosts) to the real browser-facing
  // origin; the implicit localhost:80/443 entries are only for same-host
  // development or trusted local reverse-proxy assumptions.
  return normalizeBrowserOriginSet([
    ...buildLoopbackBrowserOrigins(activeServerPort),
    ...buildLoopbackBrowserOrigins(DEFAULT_HTTP_PROXY_PORT, {
      protocols: ["http:"],
    }),
    ...buildLoopbackBrowserOrigins(DEFAULT_HTTPS_PROXY_PORT, {
      protocols: ["https:"],
    }),
    ...CONFIGURED_ALLOWED_WS_ORIGINS,
  ]);
}

/**
 * Runs the destructive local database wipe confirmation flow.
 */
async function runUserDataWipeCli(): Promise<boolean> {
  // This destructive maintenance command must only run from a real terminal:
  // stdin receives the typed confirmation and stdout shows the exact database
  // path being wiped. Refuse piped/non-interactive execution so automation,
  // redirected logs, or background jobs cannot accidentally confirm the wipe.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The --wipe-user-data flag requires an interactive TTY.");
  }

  const databasePath = getAppDatabasePath();
  const hadOpenAppDatabase = isAppDatabaseOpen();
  const readlineInterface = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  try {
    const confirmation = (
      await readlineInterface.question(
        [
          `This will permanently delete all local user data stored in ${databasePath} and the optional runtime telemetry sidecar database in the same app-data directory.`,
          `Type "${WIPE_USER_DATA_CONFIRMATION}" to continue: `,
        ].join("\n"),
      )
    )
      .trim()
      .toUpperCase();

    if (confirmation !== WIPE_USER_DATA_CONFIRMATION) {
      console.error("User data wipe cancelled.");
      return false;
    }

    const deletedPaths = [
      ...deleteAppDatabaseFiles(),
      ...deleteRuntimeStatsSidecarDatabaseFiles(),
    ];
    if (deletedPaths.length === 0) {
      console.log(
        `No local data files were present at ${databasePath} or its telemetry sidecar location.`,
      );
    } else {
      console.log(`Deleted local data files: ${deletedPaths.join(", ")}`);
    }

    return true;
  } finally {
    readlineInterface.close();
    if (hadOpenAppDatabase && isAppDatabaseOpen()) {
      closeAppDatabase();
    }
  }
}

function buildRpcSocketDataFromSession(
  session: AuthSessionRecord,
): RpcWebSocketSocketData {
  return {
    isAdmin: session.isAdmin,
    sessionId: session.id,
    stepUpValidUntil: session.stepUpValidUntil,
    userId: session.userId,
    username: session.username,
  };
}

function revalidateAuthenticatedWebSocketSession<
  SocketData extends RpcWebSocketSocketData,
>(
  ws: ServerWebSocket<SocketData>,
  options?: {
    requireAdmin?: boolean;
  },
): boolean {
  const result = revalidateRpcWebSocketSession({
    nowMs: Date.now(),
    requireAdmin: options?.requireAdmin === true,
    resolveSession: (input) =>
      // initAppDatabase() is a cheap singleton accessor here; resolving lazily
      // keeps websocket auth reusable in tests and after maintenance resets.
      resolveSession(initAppDatabase(), {
        nowMs: input.nowMs,
        sessionId: input.sessionId,
        touch: input.touch,
      }),
    sessionId: typeof ws.data.sessionId === "string" ? ws.data.sessionId : null,
  });
  if (result.ok) {
    Object.assign(ws.data, result.socketData);
    return true;
  }

  webServerLogger.warning({
    clearSessionCookie: result.failure.clearSessionCookie,
    error: normalizeErrorDescription(result.failure.error),
    message: "WebSocket session revalidation failed",
    requireAdmin: options?.requireAdmin === true,
    sessionId: ws.data.sessionId,
  });
  try {
    ws.close(1008, "Authenticated session is no longer valid.");
  } catch {
    // Ignore stale socket close failures.
  }
  return false;
}

function closeWebSocketsForSession(sessionId: string, reason: string): void {
  const rpcClosedCount = rpcTransport.closeSession(sessionId, reason);
  const terminalClosedCount = terminalManager.closeSocketsForSession(
    sessionId,
    reason,
  );
  webServerLogger.info({
    message: "Closed authenticated websocket clients for session",
    reason,
    rpcClosedCount,
    sessionId,
    terminalClosedCount,
  });
}

function closeWebSocketsForUser(
  userId: number,
  reason: string,
  options: { terminateTerminalPtys?: boolean } = {},
): void {
  const rpcClosedCount = rpcTransport.closeUser(userId, reason);
  const terminalClosedCount = terminalManager.closeSocketsForUser(
    userId,
    reason,
    { terminatePtys: options.terminateTerminalPtys === true },
  );
  webServerLogger.info({
    message: "Closed authenticated websocket clients for user",
    reason,
    rpcClosedCount,
    terminalClosedCount,
    terminateTerminalPtys: options.terminateTerminalPtys === true,
    userId,
  });
}

const rpcHandlers = createBackendRpcHandlers({
  approveThreadStartRequestProcedure,
  closeProjectProcedure,
  closeTerminalProcedure,
  closeWorktreeProcedure,
  createCalendarEventProcedure,
  createCalendarProcedure,
  createExternalIcsCalendarProcedure,
  createPluginIngressLinkCodeProcedure,
  createTerminalProcedure,
  createThreadProcedure,
  createWorktreeProcedure,
  deleteCalendarEventProcedure,
  deleteCalendarProcedure,
  deleteExternalIcsCalendarProcedure,
  deletePluginIngressExternalBindingProcedure,
  deleteProjectProcedure,
  deleteThreadProcedure,
  discardEmptyThreadProcedure,
  dismissCalendarNotificationProcedure,
  dismissUserNotificationProcedure,
  focusContextProcedure,
  getAppBootstrapProcedure,
  getCalendarBootstrapProcedure,
  getHomeDirectoryProcedure,
  getModelCatalogProcedure,
  getPluginInventoryProcedure,
  getPluginSettingsProcedure,
  getPluginSidecarDiagnostics: (params) =>
    pluginSidecarManager?.getDiagnostics(params ?? undefined) ?? [],
  getPluginSecurityDiagnostics: () => ({
    sqliteNativeSecurity: refreshPluginSqliteNativeSecurityDiagnostic(),
  }),
  getTerminalSettingsProcedure,
  getThreadMessageContentProcedure,
  getThreadProcedure,
  getTimezoneSettingsProcedure,
  getUserRuntimeSettingsProcedure,
  getWorktreeGitCommitDiffProcedure,
  getWorktreeSnapshotProcedure,
  leaveSharedCalendarProcedure,
  listCalendarNotificationsProcedure,
  listCalendarOccurrencesProcedure,
  listCronsProcedure,
  listDirectorySuggestionsProcedure,
  listPluginAccessGroupsProcedure,
  listPluginIngressExternalBindingsProcedure,
  listPluginIngressRouteConfigsProcedure,
  listPluginIngressSourcesProcedure,
  listProjectFaviconsProcedure,
  listProjectSkillsProcedure,
  listProjectWorktreesProcedure,
  listProjectsProcedure,
  listTerminalsProcedure,
  listThreadStatusesProcedure,
  listThreadsProcedure,
  listUserNotificationsProcedure,
  listWorktreeGitHistoryProcedure,
  logClientEventProcedure,
  markThreadErrorSeenProcedure,
  newCronProcedure,
  openProjectProcedure,
  openProjectsBatchProcedure,
  openWorktreeProcedure,
  openWorktreesBatchProcedure,
  readWorktreeFileContentPageProcedure,
  readWorktreeFileDiffProcedure,
  refreshExternalIcsCalendarProcedure,
  refreshPluginModelProviderRegistrationsIfDue: () => {
    pluginSidecarManager?.refreshPluginModelProviderRegistrationsIfDue();
  },
  refreshPluginModelProvidersForCatalog,
  renameTerminalProcedure,
  renameThreadProcedure,
  requestThreadStartProcedure,
  requireManageAppCapability: (context) => {
    requireLocalOperatorCapability(context, "manage_app");
  },
  respondThreadExtensionUiProcedure,
  retryPlugin: async (directoryName) => {
    await pluginSidecarManager?.retryPlugin(directoryName);
  },
  runCronNowProcedure,
  runPluginAdminActionProcedure,
  runPluginGc: async (directoryName) => {
    const manager = pluginSidecarManager;
    if (!manager) {
      await createUnavailablePluginGcRunner()(directoryName);
      return;
    }
    await manager.runPluginGc(directoryName);
  },
  runPluginLifecycleActionProcedure,
  sendThreadMessageProcedure,
  setActiveWorktreeProcedure,
  setCalendarShareProcedure,
  setPluginIngressExternalBindingEnabledProcedure,
  setThreadPinnedProcedure,
  setWorktreePinnedProcedure,
  snoozeCalendarNotificationProcedure,
  startApprovedPlugins: async (inventory) => {
    await pluginSidecarManager?.startApprovedPlugins(inventory);
  },
  startPluginRuntimeReconciliation,
  stopPluginRuntime: async (directoryName, reason) => {
    await pluginSidecarManager?.stopPlugin(directoryName, reason);
  },
  stopThreadTurnProcedure,
  syncCronSchedulerCron,
  syncCronSchedulerTimezone,
  updateCalendarEventProcedure,
  updateCalendarNotificationSettingsProcedure,
  updateCalendarPreferenceProcedure,
  updateCalendarProcedure,
  updateCronProcedure,
  updateExternalIcsCalendarProcedure,
  updatePluginSettingsProcedure,
  updateTerminalSettingsProcedure,
  updateThreadAccessProcedure,
  updateThreadExtensionEditorProcedure,
  updateThreadMetadataProcedure,
  updateThreadModelProcedure,
  updateThreadReasoningEffortProcedure,
  updateTimezoneSettingsProcedure,
  updateUserRuntimeSettingsProcedure,
  upsertPluginIngressRouteConfigProcedure,
});

const rpcTransport: RpcTransport = createRpcTransport({
  consumePreParseBudget: consumeRpcWebSocketPreParseBudget,
  handlers: rpcHandlers,
  logger: webServerLogger,
  maxPayloadBytes: MAX_RPC_WEBSOCKET_MESSAGE_BYTES,
  maxPendingRequests: MAX_PENDING_RPC_REQUESTS,
  maxPendingRequestsPerClient: MAX_PENDING_RPC_REQUESTS_PER_CLIENT,
  maxUncompressedServerBinaryFrameBytes:
    MAX_UNCOMPRESSED_SERVER_BINARY_FRAME_BYTES,
  normalizeErrorDescription,
  parseClientMessage: parseRpcClientMessage,
  rateLimitBurst: RPC_RATE_LIMIT_BURST,
  rateLimitRefillPerSecond: RPC_RATE_LIMIT_REFILL_PER_SECOND,
  recordRpcCanceled,
  recordRpcFailed,
  recordRpcStarted,
  recordRpcSucceeded,
  recordRpcTimedOut,
  recordWebSocketPush,
  revalidateSession: revalidateAuthenticatedWebSocketSession,
  toErrorPayload: buildRpcErrorPayload,
});

let mainviewBundlePath = resolve(MAINVIEW_BUILD_DIR, "index.js");
let mainviewBundleSourceMapPath: string | null = null;
let mainviewBuildAssetPaths: string[] = [];
let mainviewBuildPromise: Promise<MainviewBuildResult> | null = null;
let mainviewRebuildQueued = false;

let cachedMainviewHtml: string | null = null;
let overloadMonitorTimer: ReturnType<typeof setInterval> | null = null;
let procedureStartupWarmupTimer: ReturnType<typeof setTimeout> | null = null;
let calendarSchedulerTimer: ReturnType<typeof setInterval> | null = null;
let calendarCleanupTimer: ReturnType<typeof setInterval> | null = null;
let externalIcsRefreshTimer: ReturnType<typeof setInterval> | null = null;
let externalIcsRefreshInFlight = false;
let runtimeStatsSidecar: RuntimeStatsSidecar | null = null;
let pluginSidecarManager: PluginSidecarProcessManager | null = null;
let pluginRuntimeReconciliationPromise: Promise<void> | null = null;
let pendingPluginRuntimeReconciliation: {
  inventory?: RpcPluginInventory;
  trigger: PluginRuntimeReconciliationTrigger;
} | null = null;
let lastEventLoopLagMs = 0;
let peakEventLoopLagMs = 0;
let lastOverloadLogAt = 0;

type PluginRuntimeReconciliationTrigger =
  | "app_startup"
  | "plugin_inventory_refresh"
  | "plugin_settings_update";

async function reconcilePluginRuntime(
  trigger: PluginRuntimeReconciliationTrigger,
  inventory?: RpcPluginInventory,
): Promise<void> {
  const manager = pluginSidecarManager;
  if (!manager) {
    return;
  }
  const result = await manager.startApprovedPlugins(inventory);
  if (trigger === "app_startup" || result.started.length > 0) {
    await manager.refreshPluginModelProviderRegistrations();
  }
  if (
    result.started.length > 0 ||
    result.failed.length > 0 ||
    trigger === "app_startup"
  ) {
    webServerLogger.info({
      failed: result.failed.length,
      message: "Plugin sidecar reconciliation completed",
      skipped: result.skipped.length,
      started: result.started.length,
      trigger,
    });
  }
}

async function drainPluginRuntimeReconciliations(input: {
  inventory?: RpcPluginInventory;
  trigger: PluginRuntimeReconciliationTrigger;
}): Promise<void> {
  let next: typeof input | null = input;
  while (next) {
    const current = next;
    pendingPluginRuntimeReconciliation = null;
    try {
      await reconcilePluginRuntime(current.trigger, current.inventory);
    } catch (error: unknown) {
      webServerLogger.error({
        error: normalizeErrorDescription(error),
        message:
          "Plugin sidecar reconciliation failed before per-plugin startup",
        trigger: current.trigger,
      });
    }
    next = pendingPluginRuntimeReconciliation;
  }
}

function startPluginRuntimeReconciliation(
  trigger: PluginRuntimeReconciliationTrigger,
  inventory?: RpcPluginInventory,
): void {
  const requestedReconciliation =
    inventory === undefined ? { trigger } : { inventory, trigger };
  if (pluginRuntimeReconciliationPromise) {
    // Last-write-wins coalescing: while a reconciliation is in flight, keep at
    // most one follow-up request instead of extending an unbounded promise chain.
    pendingPluginRuntimeReconciliation = requestedReconciliation;
    return;
  }

  let currentReconciliation!: Promise<void>;
  currentReconciliation = drainPluginRuntimeReconciliations(
    requestedReconciliation,
  ).finally(() => {
    if (pluginRuntimeReconciliationPromise === currentReconciliation) {
      pluginRuntimeReconciliationPromise = null;
    }
  });
  pluginRuntimeReconciliationPromise = currentReconciliation;
}

async function refreshPluginModelProvidersForCatalog(): Promise<void> {
  if (pluginRuntimeReconciliationPromise) {
    await pluginRuntimeReconciliationPromise;
  }
  await pluginSidecarManager?.refreshPluginModelProviderRegistrations();
}

function getCurrentMainviewAssetSnapshot() {
  return buildMainviewAssetSnapshot({
    birdPath: MAINVIEW_BIRD_PATH,
    bundlePath: mainviewBundlePath,
    bundleSourceMapPath: mainviewBundleSourceMapPath,
    buildAssetPaths: collectMainviewBuildAssetPaths(
      MAINVIEW_BUILD_DIR,
      mainviewBuildAssetPaths,
    ),
    cssPath: MAINVIEW_CSS_PATH,
    firaCodeFontPath: FIRA_CODE_VARIABLE_FONT_PATH,
    interLatinFontPath: INTER_VARIABLE_FONT_LATIN_PATH,
    interLatinExtFontPath: INTER_VARIABLE_FONT_LATIN_EXT_PATH,
  });
}

function invalidateMainviewHtmlCache(): void {
  cachedMainviewHtml = null;
}

const BASE_RESPONSE_SECURITY_HEADERS = applySecurityHeaders(new Headers(), {
  strictTransportSecurity: TLS_RUNTIME.publicTls,
  styleNonce: MAINVIEW_DYNAMIC_STYLE_NONCE,
});
// Keep reserved names lowercase: buildResponseHeaders lowercases candidate
// header names before lookup so callers cannot override security headers via
// mixed-case aliases.
const RESERVED_RESPONSE_HEADER_NAMES = new Set([
  "cache-control",
  "content-security-policy",
  "content-type",
  "permissions-policy",
  "referrer-policy",
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
]);
/**
 * Builds response headers.
 * @param contentType - MIME type applied to response headers.
 * @param headers - HTTP headers.
 */

function buildResponseHeaders(
  contentType: string,
  headers?: HeadersInit,
  options?: {
    cacheControl?: string;
  },
): Headers {
  const responseHeaders = new Headers(BASE_RESPONSE_SECURITY_HEADERS);
  if (headers) {
    // Headers construction performs platform validation against CRLF/header-name
    // injection. This loop only lets internal callers add non-reserved headers
    // so security policy headers stay controlled in one place.
    for (const [name, value] of new Headers(headers)) {
      if (!RESERVED_RESPONSE_HEADER_NAMES.has(name.toLowerCase())) {
        responseHeaders.set(name, value);
      }
    }
  }
  responseHeaders.set("cache-control", options?.cacheControl ?? "no-store");
  responseHeaders.set("content-type", contentType);
  return responseHeaders;
}
/**
 * Performs stringResponse operation.
 * @param body - Request body payload.
 * @param contentType - MIME type returned in a plain-text response.
 * @param status - HTTP status code for the plain-text response.
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

function isWebServerSharePath(pathname: string): boolean {
  return (
    pathname === "/share/open" ||
    pathname === "/share/open/client.js" ||
    pathname.startsWith("/share/open/") ||
    pathname.startsWith("/s/")
  );
}

async function proxyWebServerShareRequest(request: Request): Promise<Response> {
  // The main server is only a transport boundary for public share routes.
  // Claim-token validation, share-session cookies, route/session matching, and
  // hosted-content authorization live in the dedicated share worker
  // (`src/bun/pi/web-server/share-thread.ts`) so `/share/open` and `/s/*`
  // requests are governed by one share-specific authority whether they arrive
  // through this proxy or directly at the worker in tests.
  const requestUrl = new URL(request.url);
  const upstreamHost = WEB_SERVER_SHARE_HOST.includes(":")
    ? `[${WEB_SERVER_SHARE_HOST}]`
    : WEB_SERVER_SHARE_HOST;
  const upstreamUrl = new URL(
    `${requestUrl.pathname}${requestUrl.search}`,
    `http://${upstreamHost}:${WEB_SERVER_SHARE_PORT}/`,
  );
  const headers = new Headers(request.headers);
  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("host");
  headers.delete("keep-alive");
  headers.delete("proxy-authenticate");
  headers.delete("proxy-authorization");
  headers.delete("te");
  headers.delete("trailer");
  headers.delete("transfer-encoding");
  headers.delete("upgrade");

  const fetchOptions: RequestInit = {
    headers,
    method: request.method,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    fetchOptions.body = request.body;
  }

  try {
    return await fetch(upstreamUrl, fetchOptions);
  } catch (error) {
    webServerLogger.warning({
      error: error instanceof Error ? error.message : String(error),
      message: "Failed to proxy web-server share request",
      pathname: requestUrl.pathname,
    });
    return stringResponse(
      "Web-server share route is unavailable.",
      "text/plain; charset=utf-8",
      502,
    );
  }
}

function safeDecodeRouteComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    // Malformed percent-encoding is not exceptional route state for public
    // HTTP inputs; callers translate this null into a 400 response.
    if (error instanceof URIError) {
      return null;
    }
    throw error;
  }
}
/**
 * Performs jsonResponse operation.
 * @param value - Input value.
 * @param status - HTTP status code for the JSON response.
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
 * Build a file-backed HTTP response with explicit cache policy.
 * @param path - Filesystem path.
 * @param contentType - MIME type string returned for response serialization.
 */
function fileResponse(
  path: string,
  contentType: string,
  options?: {
    cacheControl?: string;
  },
): Response {
  // Only hardcoded build/font asset paths and versioned asset-snapshot entries
  // reach this helper; dynamic public routes must return explicit 404s before
  // constructing Bun.file-backed responses. Do not call this with decoded route
  // parameters or other user-controlled filesystem paths.
  return new Response(Bun.file(path), {
    headers: buildResponseHeaders(contentType, undefined, options),
  });
}

type AuthRequestServer = Pick<ReturnType<typeof Bun.serve>, "requestIP">;

function formatRetryAfterMessage(retryAfterSeconds: number): string {
  return `Too many failed authentication attempts. Try again in ${retryAfterSeconds} seconds.`;
}

function createAuthRateLimitError(
  status: NonNullable<ReturnType<typeof readAuthRouteRateLimitStatus>>,
): AuthServiceError {
  return new AuthServiceError(
    "rate_limited",
    formatRetryAfterMessage(status.retryAfterSeconds),
    429,
    {
      retryAfterSeconds: String(status.retryAfterSeconds),
    },
  );
}

function shouldCountForAuthRateLimit(error: unknown): boolean {
  return (
    error instanceof AuthServiceError &&
    (error.code === "auth_locked" || error.code === "invalid_credentials")
  );
}

function authRateLimitSubjectKeyForUsername(username: string): string {
  return `username:${username.trim().toLowerCase()}`;
}

function authRateLimitSubjectKeyForSession(sessionId: string): string {
  return `session:${sessionId}`;
}

function readRequestPeerAddress(
  request: Request,
  serverInstance: AuthRequestServer,
): string | null {
  return serverInstance.requestIP(request)?.address.trim() || null;
}

function resolveAuthRoutePeerKey(
  request: Request,
  serverInstance: AuthRequestServer,
): string {
  const address = serverInstance.requestIP(request);
  if (address?.address.trim()) {
    return `${address.family}:${address.address.trim()}`;
  }
  // Fail closed for rare runtimes that cannot report the TCP peer: sharing one
  // bucket can reduce availability, but minting per-request keys would remove
  // brute-force protection entirely for that transport.
  return "unknown";
}

function resolvePublicRoutePeerKey(
  request: Request,
  serverInstance: AuthRequestServer,
): string {
  const peerAddress = readRequestPeerAddress(request, serverInstance);
  return (
    readTrustedForwardedForPeer(request, { peerAddress }) ??
    resolveAuthRoutePeerKey(request, serverInstance)
  );
}

async function runRateLimitedAuthAttempt<T>(
  context: AuthRouteRateLimitContext,
  operation: () => Promise<T>,
): Promise<T> {
  const limited = readAuthRouteRateLimitStatus(context);
  if (limited) {
    throw createAuthRateLimitError(limited);
  }

  try {
    const result = await operation();
    noteAuthRouteAttemptSuccess(context);
    return result;
  } catch (error) {
    if (shouldCountForAuthRateLimit(error)) {
      const nextLimited = noteAuthRouteFailure(context);
      if (nextLimited) {
        throw createAuthRateLimitError(nextLimited);
      }
    }
    throw error;
  }
}

/**
 * Performs sessionCookieMaxAgeSeconds operation.
 * @param expiresAt - Session expiration timestamp.
 * @param nowMs - Current timestamp used to compute remaining session lifetime.
 */

function sessionCookieMaxAgeSeconds(expiresAt: string, nowMs: number): number {
  return Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - nowMs) / 1000),
  );
}

const MAX_AUTH_JSON_BODY_BYTES = 16 * 1024;
const AUTH_CSRF_RATE_LIMIT_REFILL_INTERVAL_MS = 1_000;
const AUTH_CSRF_RATE_LIMIT_CAPACITY = 60;
const AUTH_CSRF_RATE_LIMIT_MAX_BUCKETS = 2_048;
const PUBLIC_CALENDAR_ICS_RATE_LIMIT_REFILL_INTERVAL_MS = 20 * 1000;
const PUBLIC_CALENDAR_ICS_RATE_LIMIT_CAPACITY = 30;
const PUBLIC_CALENDAR_ICS_RATE_LIMIT_MAX_BUCKETS = 2_048;
const RUNTIME_STATS_SNAPSHOT_RATE_LIMIT_REFILL_INTERVAL_MS = 1_000;
const RUNTIME_STATS_SNAPSHOT_RATE_LIMIT_CAPACITY = 5;
const RUNTIME_STATS_SNAPSHOT_RATE_LIMIT_MAX_BUCKETS = 2_048;
const authCsrfRateLimiter = createTokenBucketRateLimiter({
  capacity: AUTH_CSRF_RATE_LIMIT_CAPACITY,
  maxBuckets: AUTH_CSRF_RATE_LIMIT_MAX_BUCKETS,
  refillIntervalMs: AUTH_CSRF_RATE_LIMIT_REFILL_INTERVAL_MS,
  refillTokens: 1,
});
const publicCalendarIcsRateLimiter = createTokenBucketRateLimiter({
  capacity: PUBLIC_CALENDAR_ICS_RATE_LIMIT_CAPACITY,
  maxBuckets: PUBLIC_CALENDAR_ICS_RATE_LIMIT_MAX_BUCKETS,
  refillIntervalMs: PUBLIC_CALENDAR_ICS_RATE_LIMIT_REFILL_INTERVAL_MS,
  refillTokens: 1,
});
const runtimeStatsSnapshotRateLimiter = createTokenBucketRateLimiter({
  capacity: RUNTIME_STATS_SNAPSHOT_RATE_LIMIT_CAPACITY,
  maxBuckets: RUNTIME_STATS_SNAPSHOT_RATE_LIMIT_MAX_BUCKETS,
  refillIntervalMs: RUNTIME_STATS_SNAPSHOT_RATE_LIMIT_REFILL_INTERVAL_MS,
  refillTokens: 1,
});
function enforceAuthCsrfRateLimit(
  peerKey: string,
  pathname: string,
  nowMs: number,
): Response | null {
  const result = authCsrfRateLimiter.hit(`${pathname}:${peerKey}`, nowMs);
  if (result.allowed) {
    return null;
  }

  return jsonResponse(
    {
      error: {
        code: "rate_limited",
        details: {
          retryAfterSeconds: String(result.retryAfterSeconds),
        },
        message: "Too many CSRF token requests. Try again later.",
      },
      ok: false,
    },
    429,
    {
      "retry-after": String(result.retryAfterSeconds),
    },
  );
}

function enforcePublicCalendarIcsRateLimit(
  peerKey: string,
  nowMs: number,
): Response | null {
  const result = publicCalendarIcsRateLimiter.hit(peerKey, nowMs);
  if (result.allowed) {
    return null;
  }

  return stringResponse(
    "Too many calendar requests",
    "text/plain; charset=utf-8",
    429,
    {
      "retry-after": String(result.retryAfterSeconds),
    },
  );
}

function enforceRuntimeStatsSnapshotRateLimit(
  peerKey: string,
  nowMs: number,
): Response | null {
  const result = runtimeStatsSnapshotRateLimiter.hit(peerKey, nowMs);
  if (result.allowed) {
    return null;
  }

  return jsonResponse(
    {
      error: {
        code: "rate_limited",
        details: {
          retryAfterSeconds: String(result.retryAfterSeconds),
        },
        message: "Too many runtime stats requests. Try again later.",
      },
      ok: false,
    },
    429,
    {
      "retry-after": String(result.retryAfterSeconds),
    },
  );
}

export function isJsonContentTypeHeader(value: string | null): boolean {
  const contentType = value?.split(";")[0]?.trim().toLowerCase();
  return contentType === "application/json";
}

function parseStrictContentLength(value: string): number {
  // This parser only establishes numeric integrity. Route-specific callers must
  // still compare the returned safe integer with their byte limit.
  if (!/^\d+$/u.test(value)) {
    throw new RequestValidationError("Invalid Content-Length header.");
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new RequestValidationError("Invalid Content-Length header.");
  }
  return parsed;
}

function enforceJsonBodySizeLimit(request: Request): void {
  const contentLength = request.headers.get("content-length")?.trim();
  if (!contentLength) {
    return;
  }

  const contentLengthBytes = parseStrictContentLength(contentLength);
  if (contentLengthBytes > MAX_AUTH_JSON_BODY_BYTES) {
    throw new RequestValidationError("JSON request body is too large.", {
      code: "request_body_too_large",
      status: 413,
    });
  }
}
/**
 * Reads json body.
 * @param request - Incoming request payload.
 */

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  enforceJsonBodySizeLimit(request);
  let rawBody: string;
  try {
    rawBody = await readLimitedTextBody(request.body, {
      label: "JSON request body",
      maxBytes: MAX_AUTH_JSON_BODY_BYTES,
    });
  } catch (error) {
    const validationError = toJsonRequestBodyLimitValidationError(error);
    if (validationError) {
      throw validationError;
    }
    throw error;
  }
  return parseJsonObjectBody(rawBody);
}
/**
 * Reads required string.
 * @param body - Request body payload.
 * @param fieldName - Request field expected to be a required string.
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
 * @param fieldName - Request field expected to be optional string.
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
 * @param fieldName - Request field expected to be optional integer.
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

function sanitizeAuthErrorDetails(
  error: AuthServiceError,
): Record<string, string | null> | null {
  if (!error.details) {
    return null;
  }

  switch (error.code) {
    case "auth_locked":
      return typeof error.details.lockedUntil === "string"
        ? { lockedUntil: error.details.lockedUntil }
        : null;
    case "rate_limited":
      return typeof error.details.retryAfterSeconds === "string"
        ? { retryAfterSeconds: error.details.retryAfterSeconds }
        : null;
    case "totp_setup_required":
      return typeof error.details.username === "string"
        ? { username: error.details.username }
        : null;
    default:
      return null;
  }
}

function authErrorResponse(
  request: Request,
  error: unknown,
  options?: {
    clearSessionCookie?: boolean;
    clearWebSocketTicketCookie?: boolean;
  },
): Response {
  const headers = new Headers();
  if (options?.clearSessionCookie) {
    appendAllClearedSessionCookies(headers);
  }
  if (options?.clearWebSocketTicketCookie) {
    appendAllClearedWebSocketTicketCookies(headers);
  }

  if (error instanceof AuthServiceError) {
    const details = sanitizeAuthErrorDetails(error);
    if (error.code === "rate_limited") {
      const retryAfterSeconds = Number.parseInt(
        details?.retryAfterSeconds ?? "",
        10,
      );
      if (Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0) {
        headers.set("retry-after", String(retryAfterSeconds));
      }
    }
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
          details,
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
  // Unexpected auth failures return a generic client response below. Detailed
  // error metadata is kept in the local backend log only for operator
  // diagnostics and is never serialized into the HTTP response body.
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
        message: "The auth backend encountered an unexpected error.",
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

async function handleAuthRequest(
  request: Request,
  serverInstance: AuthRequestServer,
  options?: {
    allowedOrigins?: Iterable<string>;
  },
): Promise<Response | null> {
  const requestUrl = new URL(request.url);
  const { pathname } = requestUrl;
  if (!pathname.startsWith("/auth/")) {
    return null;
  }

  const requestId = normalizeRequestIdHeader(
    request.headers.get("x-request-id"),
  );
  // Capture the cookie value once for this HTTP request. Auth service calls
  // still revalidate the session against the database; this stable id is only
  // reused for request-local rate-limit keys and cookie cleanup decisions.
  const sessionId = readSessionCookie(request.headers.get("cookie"));
  const peerAddress = readRequestPeerAddress(request, serverInstance);
  const secureCookie = isSecureRequest(request, {
    peerAddress,
    publicTls: TLS_RUNTIME.publicTls,
  });
  const peerKey = resolveAuthRoutePeerKey(request, serverInstance);
  const trustedForwardedOrigin = resolveTrustedForwardedOrigin(request, {
    peerAddress,
  });
  webServerLogger.trace({
    message: "Auth request received",
    method: request.method,
    pathname,
    requestId: requestId ?? null,
    hasSession: !!sessionId,
    peerKey,
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
  const nowMs = Date.now();
  const createAuthRateLimitContext = (
    rateLimitedPathname: RateLimitedAuthPath,
    subjectKey?: string | null,
  ): AuthRouteRateLimitContext => ({
    nowMs,
    pathname: rateLimitedPathname,
    peerKey,
    ...(typeof subjectKey === "undefined" ? {} : { subjectKey }),
  });
  const getCurrentAuthStatus = () =>
    getAuthStatus(database, sessionId, {
      nowMs,
    });

  try {
    if (pathname === "/auth/csrf" && request.method === "GET") {
      // Intentionally unauthenticated: setup and login forms need a CSRF
      // token before any session exists, so there is no stable session key to
      // rate-limit on. Keep the peer bucket deliberately small enough to bound
      // unauthenticated token churn while Origin/Fetch Metadata and SameSite
      // cookies prevent the token endpoint from becoming mutation authority.
      enforceAuthReadRequestSecurity(request, {
        ...options,
        expectedOrigin: trustedForwardedOrigin ?? undefined,
      });
      const csrfRateLimitResponse = enforceAuthCsrfRateLimit(
        peerKey,
        pathname,
        nowMs,
      );
      if (csrfRateLimitResponse) {
        return csrfRateLimitResponse;
      }
      const token = generateAuthCsrfToken();
      return respondAuthJson(
        {
          ok: true,
          csrfToken: token,
        },
        200,
        {
          "set-cookie": buildAuthCsrfCookieHeader(token, secureCookie),
        },
      );
    }

    const authSecurityOptions = {
      ...options,
      expectedOrigin: trustedForwardedOrigin ?? undefined,
    };

    if (request.method === "POST") {
      enforceAuthMutationRequestSecurity(request, authSecurityOptions);
    }

    if (pathname === "/auth/status" && request.method === "GET") {
      // Read-only auth status intentionally stays CSRF-token-free so login and
      // setup screens can hydrate before a token exists. Origin/Fetch Metadata
      // checks still run, and getAuthStatus only returns the authenticated
      // session's own username instead of a global user list.
      enforceAuthReadRequestSecurity(request, authSecurityOptions);
      const status = getCurrentAuthStatus();
      return respondAuthJson(
        {
          ok: true,
          status,
        },
        200,
        sessionId && !status.authenticated
          ? (() => {
              const headers = new Headers();
              appendAllClearedSessionCookies(headers);
              return headers;
            })()
          : undefined,
      );
    }

    if (pathname === "/auth/setup/start" && request.method === "POST") {
      const body = await readJsonBody(request);
      const accountName = readOptionalString(body, "username") ?? undefined;
      const issuer = readOptionalString(body, "issuer");
      const enrollment = prepareTotpEnrollment({
        ...(accountName ? { accountName } : {}),
        ...(issuer ? { issuer } : {}),
      });
      return respondAuthJson({
        enrollment,
        ok: true,
      });
    }

    if (pathname === "/auth/setup" && request.method === "POST") {
      const body = await readJsonBody(request);
      const sessionLifetimeDays = readOptionalSessionLifetimeDays(body);
      const primaryFactor = readRequiredString(body, "primaryFactor");
      const primaryFactorType = readPrimaryFactorType(body);
      const totpCode = readRequiredString(body, "totpCode");
      const totpSecret = readRequiredString(body, "totpSecret");
      const username = readOptionalString(body, "username") ?? undefined;
      const result = await runRateLimitedAuthAttempt(
        createAuthRateLimitContext(
          "/auth/setup",
          authRateLimitSubjectKeyForUsername(username ?? "local-operator"),
        ),
        () =>
          setupAuth(database, {
            nowMs,
            primaryFactor,
            primaryFactorType,
            totpCode,
            totpSecret,
            ...(username ? { username } : {}),
            ...(typeof sessionLifetimeDays === "number"
              ? {
                  sessionLifetimeDays,
                }
              : {}),
          }),
      );

      return respondAuthJson(
        {
          ok: true,
          recoveryCodes: result.recoveryCodes,
          status: getAuthStatus(database, result.session.id, {
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
      const primaryFactor = readRequiredString(body, "primaryFactor");
      const totpCode = readOptionalString(body, "totpCode") ?? "";
      const username = readOptionalString(body, "username") ?? undefined;
      const result = await runRateLimitedAuthAttempt(
        createAuthRateLimitContext(
          "/auth/login",
          authRateLimitSubjectKeyForUsername(username ?? "local-operator"),
        ),
        () =>
          login(database, {
            nowMs,
            primaryFactor,
            totpCode,
            ...(username ? { username } : {}),
          }),
      );

      return respondAuthJson(
        {
          ok: true,
          status: getAuthStatus(database, result.session.id, {
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
      const primaryFactor = readRequiredString(body, "primaryFactor");
      const recoveryCode = readRequiredString(body, "recoveryCode");
      const username = readOptionalString(body, "username") ?? undefined;
      const result = await runRateLimitedAuthAttempt(
        createAuthRateLimitContext(
          "/auth/recovery-login",
          authRateLimitSubjectKeyForUsername(username ?? "local-operator"),
        ),
        () =>
          loginWithRecoveryCode(database, {
            nowMs,
            primaryFactor,
            recoveryCode,
            ...(username ? { username } : {}),
          }),
      );

      return respondAuthJson(
        {
          ok: true,
          status: getAuthStatus(database, result.session.id, {
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
      if (!sessionId) {
        throw new AuthServiceError(
          "session_required",
          "A valid authenticated session is required.",
          401,
        );
      }

      const body = await readJsonBody(request);
      const primaryFactor = readRequiredString(body, "primaryFactor");
      const totpCode = readRequiredString(body, "totpCode");
      const result = await runRateLimitedAuthAttempt(
        createAuthRateLimitContext(
          "/auth/step-up",
          authRateLimitSubjectKeyForSession(sessionId),
        ),
        () =>
          stepUpSession(database, {
            nowMs,
            primaryFactor,
            sessionId,
            totpCode,
          }),
      );

      return respondAuthJson({
        ok: true,
        status: getCurrentAuthStatus(),
        stepUpValidUntil: result.stepUpValidUntil,
      });
    }

    // Browser reset routes intentionally require a live session plus TOTP,
    // but not the current primary factor. This supports signed-in local
    // operators who forgot their PIN/password; the CLI reset remains stricter
    // because it runs outside an already authenticated browser session.
    if (pathname === "/auth/reset-pin" && request.method === "POST") {
      if (!sessionId) {
        throw new AuthServiceError(
          "session_required",
          "A valid authenticated session is required.",
          401,
        );
      }

      const body = await readJsonBody(request);
      const newPin = readRequiredString(body, "newPin");
      const totpCode = readRequiredString(body, "totpCode");
      const currentSession = resolveSession(database, {
        nowMs,
        sessionId,
        touch: false,
      });
      await runRateLimitedAuthAttempt(
        createAuthRateLimitContext(
          "/auth/reset-pin",
          authRateLimitSubjectKeyForSession(sessionId),
        ),
        () =>
          resetPrimaryFactorFromSession(database, {
            newPrimaryFactor: newPin,
            newPrimaryFactorType: "pin",
            nowMs,
            sessionId,
            totpCode,
          }),
      );
      if (currentSession) {
        closeWebSocketsForUser(
          currentSession.userId,
          "Authenticated sessions were revoked.",
          { terminateTerminalPtys: true },
        );
      }
      // Pi thread runtimes are owned by the single persisted local operator, not
      // individual browser sessions, so a primary-factor reset aborts all active
      // thread turns to provide an explicit process-containment boundary.
      await shutdownActiveThreadTurns();

      const headers = new Headers();
      appendAllClearedSessionCookies(headers);
      appendAllClearedWebSocketTicketCookies(headers);
      return respondAuthJson(
        {
          ok: true,
          status: getCurrentAuthStatus(),
        },
        200,
        headers,
      );
    }

    if (pathname === "/auth/reset-password" && request.method === "POST") {
      if (!sessionId) {
        throw new AuthServiceError(
          "session_required",
          "A valid authenticated session is required.",
          401,
        );
      }

      const body = await readJsonBody(request);
      const newPassword = readRequiredString(body, "newPassword");
      const totpCode = readRequiredString(body, "totpCode");
      const currentSession = resolveSession(database, {
        nowMs,
        sessionId,
        touch: false,
      });
      await runRateLimitedAuthAttempt(
        createAuthRateLimitContext(
          "/auth/reset-password",
          authRateLimitSubjectKeyForSession(sessionId),
        ),
        () =>
          resetPrimaryFactorFromSession(database, {
            newPrimaryFactor: newPassword,
            newPrimaryFactorType: "password",
            nowMs,
            sessionId,
            totpCode,
          }),
      );
      if (currentSession) {
        closeWebSocketsForUser(
          currentSession.userId,
          "Authenticated sessions were revoked.",
          { terminateTerminalPtys: true },
        );
      }
      // Pi thread runtimes are owned by the single persisted local operator, not
      // individual browser sessions, so a primary-factor reset aborts all active
      // thread turns to provide an explicit process-containment boundary.
      await shutdownActiveThreadTurns();

      const headers = new Headers();
      appendAllClearedSessionCookies(headers);
      appendAllClearedWebSocketTicketCookies(headers);
      return respondAuthJson(
        {
          ok: true,
          status: getCurrentAuthStatus(),
        },
        200,
        headers,
      );
    }

    if (pathname === "/auth/logout" && request.method === "POST") {
      logout(database, sessionId);
      if (sessionId) {
        closeWebSocketsForSession(
          sessionId,
          "Authenticated session logged out.",
        );
      }
      const headers = new Headers();
      appendAllClearedSessionCookies(headers);
      appendAllClearedWebSocketTicketCookies(headers);
      headers.set("clear-site-data", buildLogoutClearSiteDataHeader());
      return respondAuthJson(
        {
          ok: true,
          status: getCurrentAuthStatus(),
        },
        200,
        headers,
      );
    }

    if (pathname === "/auth/ws-ticket" && request.method === "POST") {
      const ticket = await runRateLimitedAuthAttempt(
        createAuthRateLimitContext(
          "/auth/ws-ticket",
          sessionId ? authRateLimitSubjectKeyForSession(sessionId) : null,
        ),
        async () => {
          if (!sessionId) {
            throw new AuthServiceError(
              "session_required",
              "A valid authenticated session is required.",
              401,
            );
          }

          return issueWebSocketTicket(database, {
            nowMs,
            sessionId,
          });
        },
      );
      const headers = new Headers();
      headers.append(
        "set-cookie",
        buildWebSocketTicketCookieHeader(ticket.ticket, {
          secure: secureCookie,
        }),
      );
      return respondAuthJson(
        {
          ok: true,
          ticket: {
            expiresAt: ticket.expiresAt,
          },
        },
        200,
        headers,
      );
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
      requestPath: requestUrl.pathname,
      error: normalizeErrorDescription(error),
    });
    const clearSessionCookie =
      error instanceof AuthServiceError && error.code === "session_required";
    return authErrorResponse(request, error, {
      clearSessionCookie,
      clearWebSocketTicketCookie: clearSessionCookie,
    });
  }
}

function runtimeStatsRequestUsesSharedSecret(request: Request): boolean {
  const providedSecret =
    request.headers.get("x-metidos-runtime-stats-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return isRuntimeStatsSecretMatch(RUNTIME_STATS_SHARED_SECRET, providedSecret);
}

function authorizeRuntimeStatsRequest(request: Request): Response | null {
  if (runtimeStatsRequestUsesSharedSecret(request)) {
    return null;
  }

  // The runtime-stats endpoints are loopback/development diagnostics by
  // default. In public TLS mode, retain a local-operator session-cookie fallback
  // so an admin browser can inspect diagnostics without copying the optional
  // METIDOS_RUNTIME_STATS_SECRET into frontend tooling.
  const session = resolveSession(initAppDatabase(), {
    nowMs: Date.now(),
    sessionId: readSessionCookie(request.headers.get("cookie")),
    touch: false,
  });
  if (session?.isAdmin === true) {
    return null;
  }

  return jsonResponse(
    {
      error: {
        code: session ? "admin_required" : "session_required",
        details: null,
        message: session
          ? "Local operator privileges or a runtime stats secret are required."
          : "A valid local-operator session or runtime stats secret is required.",
      },
      ok: false,
    },
    session ? 403 : 401,
  );
}

/**
 * Create a diagnostic snapshot used for overload warning logs.
 * @param activeServerPort - Current server port used for route normalization.
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
  runtimeStats: ReturnType<typeof getRuntimeStatsSummary>;
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
    // Snapshot only aggregate transport counters for diagnostics. The transport
    // owns request-id maps and abort controllers; the server health payload keeps
    // those internals out of logs while still surfacing current and peak backlog.
    pendingRpcRequests: {
      current: rpcTransport.getPendingRequestCount(),
      peak: rpcTransport.getPeakPendingRequestCount(),
    },
    port: activeServerPort,
    procedures: getProcedureRuntimeStats(),
    rpcClientCount: rpcTransport.getClientCount(),
    rpcWebSocketUrl:
      process.env.METIDOS_RPC_URL ?? `ws://127.0.0.1:${activeServerPort}/rpc`,
    runtimeStats: getRuntimeStatsSummary(),
  };
}

/**
 * Periodically emit overload telemetry for backlog and event loop lag conditions.
 * @param activeServerPort - Active server port after fallback selection.
 */
function startOverloadMonitoring(activeServerPort: () => number): void {
  // Backend bootstrap is single-shot in this process. Shutdown clears this
  // handle and exits, so a non-null timer here means monitoring is already
  // active rather than a stale cleared interval that should be restarted.
  if (overloadMonitorTimer) {
    return;
  }

  let expectedAt = performance.now() + SERVER_MONITOR_INTERVAL_MS;
  overloadMonitorTimer = setInterval(() => {
    const now = performance.now();
    lastEventLoopLagMs = Math.max(0, now - expectedAt);
    peakEventLoopLagMs = Math.max(peakEventLoopLagMs, lastEventLoopLagMs);
    expectedAt = now + SERVER_MONITOR_INTERVAL_MS;

    // This monitor is intentionally observability-only. Metidos is a local IDE
    // backend where transient agent, Git, or provider stalls are expected; applying
    // automatic backpressure here would risk breaking in-progress operator work.
    // Individual transports/procedures own their request-size and rate-limit
    // enforcement, while this loop surfaces aggregate pressure for diagnostics.
    // Keep the steady-state monitor cheap: only build the full health snapshot
    // (which clones runtime-stats maps) after inexpensive pressure checks pass.
    const git = getGitSchedulerStats();
    const procedures = getProcedureRuntimeStats();
    const hasPressure =
      lastEventLoopLagMs >= EVENT_LOOP_LAG_WARN_MS ||
      rpcTransport.getPendingRequestCount() >= PENDING_RPC_WARN_COUNT ||
      git.queuedBackgroundCount > 0 ||
      git.queuedForegroundCount > 0 ||
      procedures.foregroundReadCount > 0 ||
      procedures.gitHistoryReadLimit.pendingCount > 0 ||
      procedures.diffLoadLimit.pendingCount > 0;

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
      health: buildServerHealthSnapshot(activeServerPort()),
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

type MainviewHtmlBootstrapPayload = {
  schema: typeof MAINVIEW_HTML_BOOTSTRAP_CONTRACT.schema;
  createdAt: string;
  staleAfterMs: number;
  data: RpcAppBootstrapResult;
};

type MainviewHtmlBootstrapByteSummary = {
  componentBytes: Record<string, number>;
  overBudgetComponents: string[];
  payloadBytes: number;
};

function serializedJsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function summarizeMainviewHtmlBootstrapBytes(
  payload: MainviewHtmlBootstrapPayload,
): MainviewHtmlBootstrapByteSummary {
  const componentValues = {
    homeDirectory: payload.data.homeDirectory,
    modelCatalogDefaults: {
      defaultModel: payload.data.modelCatalog.defaultModel,
      defaultReasoningEffort: payload.data.modelCatalog.defaultReasoningEffort,
      reasoningEfforts: payload.data.modelCatalog.reasoningEfforts,
    },
    modelCatalogModels: payload.data.modelCatalog.models,
    pluginAccessGroups: payload.data.pluginAccessGroups,
    threadPermissionDescriptors: payload.data.threadPermissionDescriptors,
    projects: payload.data.projects,
    pinnedWorktrees: payload.data.pinnedWorktrees,
    threadSummaries: payload.data.threads,
  } satisfies Record<string, unknown>;
  const componentBudgets = new Map<string, number | null>(
    MAINVIEW_HTML_BOOTSTRAP_CONTRACT.fields.map((field) => [
      field.component,
      field.maxBytes ?? null,
    ]),
  );
  const componentBytes = Object.fromEntries(
    Object.entries(componentValues)
      .map(
        ([component, value]) =>
          [component, serializedJsonByteLength(value)] as const,
      )
      .sort((left, right) => right[1] - left[1]),
  );
  const overBudgetComponents = Object.entries(componentBytes)
    .filter(([component, byteLength]) => {
      const maxBytes = componentBudgets.get(component);
      return typeof maxBytes === "number" && byteLength > maxBytes;
    })
    .map(([component]) => component);

  return {
    componentBytes,
    overBudgetComponents,
    payloadBytes: serializedJsonByteLength(payload),
  };
}

async function buildMainviewHtmlBootstrapElement(
  request: Request,
): Promise<string | null> {
  const sessionId = readSessionCookie(request.headers.get("cookie"));
  if (!sessionId) {
    return null;
  }

  const session = resolveSession(initAppDatabase(), {
    nowMs: Date.now(),
    sessionId,
    touch: false,
  });
  if (!session) {
    return null;
  }

  const controller = new AbortController();
  const context: RpcRequestContext = {
    auth: {
      isAdmin: session.isAdmin,
      sessionId: session.id,
      stepUpValidUntil: session.stepUpValidUntil,
      userId: session.userId,
      username: session.username,
    },
    // HTML bootstrap is a latency optimization for already-authenticated page
    // loads. Keep it background so it never competes with interactive RPC work;
    // the browser will hydrate through normal foreground/default RPCs if this
    // payload is omitted or slow.
    priority: "background",
    signal: controller.signal,
    timeoutMs: null,
  };
  const data = await getAppBootstrapProcedure(undefined, context);
  const payload: MainviewHtmlBootstrapPayload = {
    schema: MAINVIEW_HTML_BOOTSTRAP_CONTRACT.schema,
    createdAt: new Date().toISOString(),
    staleAfterMs: MAINVIEW_HTML_BOOTSTRAP_CONTRACT.staleAfterMs,
    data,
  };
  const payloadJson = JSON.stringify(payload);
  const byteSummary = summarizeMainviewHtmlBootstrapBytes(payload);
  const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
  if (payloadBytes > MAINVIEW_HTML_BOOTSTRAP_CONTRACT.maxPayloadBytes) {
    webServerLogger.warning({
      message: "Omitting oversize Mainview HTML bootstrap payload",
      payloadBytes,
      measuredPayloadBytes: byteSummary.payloadBytes,
      maxPayloadBytes: MAINVIEW_HTML_BOOTSTRAP_CONTRACT.maxPayloadBytes,
      componentBytes: byteSummary.componentBytes,
      overBudgetComponents: byteSummary.overBudgetComponents,
      fallback: MAINVIEW_HTML_BOOTSTRAP_CONTRACT.fallback.oversize,
    });
    return null;
  }

  webServerLogger.trace({
    message: "Injecting Mainview HTML bootstrap payload",
    payloadBytes,
    maxPayloadBytes: MAINVIEW_HTML_BOOTSTRAP_CONTRACT.maxPayloadBytes,
    componentBytes: byteSummary.componentBytes,
    overBudgetComponents: byteSummary.overBudgetComponents,
  });
  return `<script type="application/json" id="metidos-mainview-bootstrap">${escapeInlineJsonForHtml(payloadJson)}</script>`;
}

async function htmlResponse(request: Request): Promise<Response> {
  let staticHtml = cachedMainviewHtml;
  // Dev mode always rereads index.html here, and the mainview watcher also
  // invalidates this cache on index.html changes. The cache is therefore a
  // production-only optimization rather than a stale dev-template risk.
  if (IS_DEV_SERVER || staticHtml === null) {
    const runtimeConfig: InjectedRuntimeConfig = {
      devServer: IS_DEV_SERVER,
      healthUrl: "/health",
      styleNonce: MAINVIEW_DYNAMIC_STYLE_NONCE,
      ...(TLS_RUNTIME.publicTls
        ? {
            preferTls: true,
          }
        : {}),
    };
    const runtimeConfigElement = buildRuntimeConfigElement(runtimeConfig);
    const assetSnapshot = getCurrentMainviewAssetSnapshot();
    const template = await Bun.file(MAINVIEW_HTML_PATH).text();
    const htmlTemplate = applyMainviewAssetRoot(
      template,
      assetSnapshot.assetRoot,
    );
    staticHtml = htmlTemplate.includes("</head>")
      ? htmlTemplate.replace("</head>", `${runtimeConfigElement}\n\t</head>`)
      : `${runtimeConfigElement}\n${htmlTemplate}`;

    if (!IS_DEV_SERVER) {
      cachedMainviewHtml = staticHtml;
    }
  }

  let bootstrapElement: string | null = null;
  try {
    bootstrapElement = await buildMainviewHtmlBootstrapElement(request);
  } catch (error) {
    webServerLogger.warning({
      error: normalizeErrorDescription(error),
      message: "Failed to build mainview HTML bootstrap element",
    });
  }
  const html = injectMainviewHtmlBootstrapElement(staticHtml, bootstrapElement);
  return stringResponse(html, "text/html; charset=utf-8");
}

type RpcParamTypeName =
  | "array"
  | "boolean"
  // Nullable validators intentionally accept explicit null separately from
  // omission; downstream procedures use null as a wire-level "clear this
  // optional value" signal for selected fields.
  | "nullableBoolean"
  | "nullableNumber"
  | "nullableString"
  | "number"
  | "object"
  | "record"
  | "string";

type RpcParamShape = Record<string, RpcParamTypeName>;

type RpcParamValidator = (params: unknown, method: RpcMethodName) => unknown;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// These structural limits are enforced per RPC request before procedure dispatch.
// Aggregate abuse from many individually valid requests is handled by the RPC
// WebSocket/HTTP rate limits and in-flight accounting instead of a connection-
// lifetime byte budget here, so procedure validators can stay deterministic and
// request-scoped.
const MAX_RPC_RECORD_DEPTH = 12;
const MAX_RPC_RECORD_KEYS = 1000;
const MAX_RPC_RECORD_ARRAY_ITEMS = 1000;
const MAX_RPC_RECORD_STRING_BYTES = 64 * 1024;

type RpcParamBoundsOptions = {
  stringByteLimitForPath?: (fieldPath: string) => number | null | undefined;
};

function assertRpcStringByteLength(
  value: string,
  fieldPath: string,
  maxBytes: number,
): void {
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new Error(
      `Invalid RPC params: ${fieldPath} string must be at most ${maxBytes} bytes.`,
    );
  }
}

function assertRpcParamBounds(
  value: unknown,
  fieldPath: string,
  options: RpcParamBoundsOptions = {},
): void {
  let keyCount = 0;
  let arrayItemCount = 0;
  const seen = new Set<object>();
  const stack: Array<{ path: string; value: unknown; depth: number }> = [
    { depth: 0, path: fieldPath, value },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (typeof current.value === "string") {
      const limit =
        options.stringByteLimitForPath?.(current.path) ??
        MAX_RPC_PARAM_STRING_BYTES;
      if (limit !== null) {
        assertRpcStringByteLength(current.value, current.path, limit);
      }
      continue;
    }
    if (typeof current.value !== "object" || current.value === null) {
      continue;
    }
    if (seen.has(current.value)) {
      continue;
    }
    seen.add(current.value);
    if (current.depth > MAX_RPC_RECORD_DEPTH) {
      throw new Error(
        `Invalid RPC params: ${fieldPath} must be at most ${MAX_RPC_RECORD_DEPTH} levels deep.`,
      );
    }
    if (Array.isArray(current.value)) {
      arrayItemCount += current.value.length;
      if (arrayItemCount > MAX_RPC_RECORD_ARRAY_ITEMS) {
        throw new Error(
          `Invalid RPC params: ${fieldPath} must contain at most ${MAX_RPC_RECORD_ARRAY_ITEMS} array items total; ${current.path} would raise the total to ${arrayItemCount}.`,
        );
      }
      current.value.forEach((item, index) => {
        stack.push({
          depth: current.depth + 1,
          path: `${current.path}[${index}]`,
          value: item,
        });
      });
      continue;
    }
    const entries = Object.entries(current.value);
    const nextKeyCount = keyCount + entries.length;
    if (nextKeyCount > MAX_RPC_RECORD_KEYS) {
      throw new Error(
        `Invalid RPC params: ${fieldPath} must contain at most ${MAX_RPC_RECORD_KEYS} keys total; ${current.path} would raise the total to ${nextKeyCount}.`,
      );
    }
    keyCount = nextKeyCount;
    for (const [key, item] of entries) {
      stack.push({
        depth: current.depth + 1,
        path: `${current.path}.${key}`,
        value: item,
      });
    }
  }
}

function assertRpcRecordBounds(
  value: Record<string, unknown>,
  fieldPath: string,
): void {
  let keyCount = 0;
  let arrayItemCount = 0;
  const seen = new Set<object>();
  const stack: Array<{ path: string; value: unknown; depth: number }> = [
    { depth: 0, path: fieldPath, value },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (typeof current.value === "string") {
      assertRpcStringByteLength(
        current.value,
        current.path,
        MAX_RPC_RECORD_STRING_BYTES,
      );
      continue;
    }
    if (typeof current.value !== "object" || current.value === null) {
      continue;
    }
    if (seen.has(current.value)) {
      continue;
    }
    seen.add(current.value);
    if (current.depth > MAX_RPC_RECORD_DEPTH) {
      throw new Error(
        `Invalid RPC params: ${fieldPath} must be at most ${MAX_RPC_RECORD_DEPTH} levels deep.`,
      );
    }
    if (Array.isArray(current.value)) {
      arrayItemCount += current.value.length;
      if (arrayItemCount > MAX_RPC_RECORD_ARRAY_ITEMS) {
        throw new Error(
          `Invalid RPC params: ${fieldPath} must contain at most ${MAX_RPC_RECORD_ARRAY_ITEMS} array items total; ${current.path} would raise the total to ${arrayItemCount}.`,
        );
      }
      current.value.forEach((item, index) => {
        stack.push({
          depth: current.depth + 1,
          path: `${current.path}[${index}]`,
          value: item,
        });
      });
      continue;
    }
    const entries = Object.entries(current.value);
    const nextKeyCount = keyCount + entries.length;
    if (nextKeyCount > MAX_RPC_RECORD_KEYS) {
      throw new Error(
        `Invalid RPC params: ${fieldPath} must contain at most ${MAX_RPC_RECORD_KEYS} keys total; ${current.path} would raise the total to ${nextKeyCount}.`,
      );
    }
    keyCount = nextKeyCount;
    for (const [key, item] of entries) {
      stack.push({
        depth: current.depth + 1,
        path: `${current.path}.${key}`,
        value: item,
      });
    }
  }
}

function assertRpcParamType(
  value: unknown,
  expected: RpcParamTypeName,
  fieldPath: string,
): void {
  switch (expected) {
    case "array":
      if (Array.isArray(value)) {
        return;
      }
      break;
    case "boolean":
      if (typeof value === "boolean") {
        return;
      }
      break;
    case "nullableBoolean":
      if (typeof value === "boolean" || value === null) {
        return;
      }
      break;
    case "nullableNumber":
      if (typeof value === "number" || value === null) {
        return;
      }
      break;
    case "nullableString":
      if (typeof value === "string" || value === null) {
        return;
      }
      break;
    case "number":
      if (typeof value === "number" && Number.isFinite(value)) {
        return;
      }
      break;
    case "object":
      if (isPlainObject(value)) {
        return;
      }
      break;
    case "record":
      if (isPlainObject(value)) {
        assertRpcRecordBounds(value, fieldPath);
        return;
      }
      break;
    case "string":
      if (typeof value === "string") {
        return;
      }
      break;
  }
  throw new Error(`Invalid RPC params: ${fieldPath} must be ${expected}.`);
}

function undefinedParams(): RpcParamValidator {
  return (params, method) => {
    if (typeof params !== "undefined") {
      throw new Error(`Invalid RPC params for ${String(method)}.`);
    }
    return undefined;
  };
}

function optionalObjectParams(shape: RpcParamShape = {}): RpcParamValidator {
  const objectValidator = objectParams(shape);
  return (params, method) =>
    typeof params === "undefined" ? undefined : objectValidator(params, method);
}

function objectParams(
  shape: RpcParamShape = {},
  options: RpcParamBoundsOptions = {},
): RpcParamValidator {
  return (params, method) => {
    if (!isPlainObject(params)) {
      throw new Error(`Invalid RPC params for ${String(method)}.`);
    }
    assertRpcParamBounds(params, String(method), options);
    for (const [field, typeName] of Object.entries(shape)) {
      const optional = field.endsWith("?");
      const fieldName = optional ? field.slice(0, -1) : field;
      const value = params[fieldName];
      if (typeof value === "undefined") {
        if (optional) {
          continue;
        }
        throw new Error(
          `Invalid RPC params: ${String(method)}.${fieldName} is required.`,
        );
      }
      assertRpcParamType(value, typeName, `${String(method)}.${fieldName}`);
    }
    return params;
  };
}

function assertRpcArrayLength(
  value: unknown[],
  fieldPath: string,
  maxLength: number,
): void {
  if (value.length > maxLength) {
    throw new Error(
      `Invalid RPC params: ${fieldPath} must contain at most ${maxLength} items.`,
    );
  }
}

function boundedThreadStatusesParams(): RpcParamValidator {
  return (params, method) => {
    const value = objectParams({ threadIds: "array" })(params, method) as {
      threadIds: unknown[];
    };
    assertRpcArrayLength(value.threadIds, `${String(method)}.threadIds`, 200);
    value.threadIds.forEach((threadId, index) => {
      assertRpcParamType(
        threadId,
        "number",
        `${String(method)}.threadIds[${index}]`,
      );
    });
    return value;
  };
}

function boundedProjectFaviconsParams(): RpcParamValidator {
  return (params, method) => {
    const value = objectParams({
      "forceRefresh?": "boolean",
      projectIds: "array",
    })(params, method) as {
      forceRefresh?: boolean;
      projectIds: unknown[];
    };
    assertRpcArrayLength(value.projectIds, `${String(method)}.projectIds`, 100);
    value.projectIds.forEach((projectId, index) => {
      assertRpcParamType(
        projectId,
        "number",
        `${String(method)}.projectIds[${index}]`,
      );
    });
    return value;
  };
}

function boundedOpenProjectsBatchParams(): RpcParamValidator {
  return (params, method) => {
    const value = objectParams({ projects: "array" })(params, method) as {
      projects: unknown[];
    };
    assertRpcArrayLength(value.projects, `${String(method)}.projects`, 50);
    value.projects.forEach((project, index) => {
      const itemPath = `${String(method)}.projects[${index}]`;
      if (!isPlainObject(project)) {
        throw new Error(`Invalid RPC params: ${itemPath} must be object.`);
      }
      assertRpcParamType(project.projectId, "number", `${itemPath}.projectId`);
      assertRpcParamType(
        project.projectPath,
        "string",
        `${itemPath}.projectPath`,
      );
      if (typeof project.name !== "undefined") {
        assertRpcParamType(project.name, "nullableString", `${itemPath}.name`);
      }
      if (typeof project.createIfMissing !== "undefined") {
        assertRpcParamType(
          project.createIfMissing,
          "boolean",
          `${itemPath}.createIfMissing`,
        );
      }
      if (typeof project.initGitIfNeeded !== "undefined") {
        assertRpcParamType(
          project.initGitIfNeeded,
          "boolean",
          `${itemPath}.initGitIfNeeded`,
        );
      }
      if (typeof project.pinWorktree !== "undefined") {
        assertRpcParamType(
          project.pinWorktree,
          "boolean",
          `${itemPath}.pinWorktree`,
        );
      }
    });
    return value;
  };
}

function boundedOpenWorktreesBatchParams(): RpcParamValidator {
  return (params, method) => {
    const value = objectParams({ worktrees: "array" })(params, method) as {
      worktrees: unknown[];
    };
    assertRpcArrayLength(value.worktrees, `${String(method)}.worktrees`, 100);
    value.worktrees.forEach((worktree, index) => {
      const itemPath = `${String(method)}.worktrees[${index}]`;
      if (!isPlainObject(worktree)) {
        throw new Error(`Invalid RPC params: ${itemPath} must be object.`);
      }
      assertRpcParamType(worktree.projectId, "number", `${itemPath}.projectId`);
      assertRpcParamType(
        worktree.worktreePath,
        "string",
        `${itemPath}.worktreePath`,
      );
    });
    return value;
  };
}

function assertNoNullByteString(value: string, fieldPath: string): void {
  if (value.includes("\0")) {
    throw new Error(`Invalid RPC params: ${fieldPath} must not contain NUL.`);
  }
}

function worktreeFileContentPageParams(): RpcParamValidator {
  return (params, method) => {
    const value = objectParams({
      "cursor?": "number",
      "limitBytes?": "number",
      path: "string",
      ...projectWorktreeParams,
    })(params, method) as {
      path: string;
    };
    assertNoNullByteString(value.path, `${String(method)}.path`);
    return value;
  };
}

function worktreeFileDiffParams(): RpcParamValidator {
  return (params, method) => {
    const value = objectParams({
      change: "object",
      ...projectWorktreeParams,
    })(params, method) as {
      change: Record<string, unknown>;
    };
    const changePath = value.change.path;
    assertRpcParamType(changePath, "string", `${String(method)}.change.path`);
    assertNoNullByteString(
      changePath as string,
      `${String(method)}.change.path`,
    );
    if (typeof value.change.previousPath !== "undefined") {
      const previousPath = value.change.previousPath;
      assertRpcParamType(
        previousPath,
        "nullableString",
        `${String(method)}.change.previousPath`,
      );
      if (typeof previousPath === "string") {
        assertNoNullByteString(
          previousPath,
          `${String(method)}.change.previousPath`,
        );
      }
    }
    return value;
  };
}

function rpcStringLimitForChatImagePath(
  fieldPath: string,
): number | null | undefined {
  // Only the canonical chat-image payload slot gets the larger base64 cap.
  // Other strings under sendThreadMessage, including unexpected fields, retain
  // the generic 1 MiB RPC string cap so callers cannot smuggle arbitrary large
  // strings beside image attachments.
  return /\.images\[\d+\]\.data$/u.test(fieldPath)
    ? MAX_BASE64_CHAT_IMAGE_BYTES
    : undefined;
}

function boundedSendThreadMessageParams(): RpcParamValidator {
  return (params, method) => {
    const value = objectParams(
      {
        "images?": "array",
        input: "string",
        threadId: "number",
      },
      { stringByteLimitForPath: rpcStringLimitForChatImagePath },
    )(params, method) as {
      images?: unknown[];
      input: string;
      threadId: number;
    };
    if (
      Buffer.byteLength(value.input, "utf8") > MAX_THREAD_MESSAGE_INPUT_BYTES
    ) {
      throw new Error(
        `Invalid RPC params: ${String(method)}.input must be at most ${MAX_THREAD_MESSAGE_INPUT_BYTES} bytes.`,
      );
    }
    if (value.images) {
      assertRpcArrayLength(value.images, `${String(method)}.images`, 8);
      value.images.forEach((image, index) => {
        const itemPath = `${String(method)}.images[${index}]`;
        if (!isPlainObject(image)) {
          throw new Error(`Invalid RPC params: ${itemPath} must be object.`);
        }
        assertRpcParamType(image.type, "string", `${itemPath}.type`);
        if (image.type !== "image") {
          throw new Error(
            `Invalid RPC params: ${itemPath}.type must be image.`,
          );
        }
        assertRpcParamType(image.data, "string", `${itemPath}.data`);
        assertRpcParamType(image.mimeType, "string", `${itemPath}.mimeType`);
      });
    }
    return value;
  };
}

function threadExtensionEditorParams(): RpcParamValidator {
  return (params, method) => {
    const value = objectParams({
      text: "string",
      threadId: "number",
    })(params, method) as { text: string; threadId: number };
    if (
      Buffer.byteLength(value.text, "utf8") >
      MAX_THREAD_EXTENSION_EDITOR_TEXT_BYTES
    ) {
      throw new Error(
        `Invalid RPC params: ${String(method)}.text must be at most ${MAX_THREAD_EXTENSION_EDITOR_TEXT_BYTES} bytes.`,
      );
    }
    return value;
  };
}

const projectWorktreeParams = {
  projectId: "number",
  worktreePath: "string",
} satisfies RpcParamShape;

const threadAccessParamShape = {
  "permissions?": "array",
} satisfies RpcParamShape;

const cronAccessParamShape = {
  ...threadAccessParamShape,
  "description?": "string",
  "enabled?": "boolean",
  "model?": "string",
  "reasoningEffort?": "string",
  "title?": "string",
} satisfies RpcParamShape;

const rpcParamValidators: { [K in RpcMethodName]: RpcParamValidator } = {
  approveThreadStartRequest: objectParams({ requestId: "string" }),
  closeProject: objectParams({ projectId: "number" }),
  closeTerminal: objectParams({ terminalId: "string" }),
  closeWorktree: objectParams(projectWorktreeParams),
  createCalendar: objectParams({
    "color?": "nullableString",
    "isPublic?": "nullableBoolean",
    "publicSlug?": "nullableString",
    title: "string",
  }),
  createCalendarEvent: objectParams({
    "allDay?": "nullableBoolean",
    calendarId: "number",
    "description?": "nullableString",
    "endAt?": "nullableString",
    "endDate?": "nullableString",
    "location?": "nullableString",
    "recurrenceRule?": "nullableString",
    "reminders?": "array",
    "startAt?": "nullableString",
    "startDate?": "nullableString",
    timezone: "string",
    title: "string",
  }),
  createExternalIcsCalendar: objectParams({
    "color?": "nullableString",
    title: "string",
    url: "string",
  }),
  createPluginIngressLinkCode: objectParams({
    pluginId: "string",
    sourceId: "string",
  }),
  createTerminal: objectParams({
    "cols?": "number",
    "command?": "nullableString",
    "createdFromThreadId?": "nullableNumber",
    "cwd?": "nullableString",
    "dir?": "nullableString",
    projectId: "number",
    "rows?": "number",
    "title?": "nullableString",
    worktreePath: "string",
  }),
  createThread: objectParams({
    ...threadAccessParamShape,
    "currentProjectId?": "nullableNumber",
    "currentWorktreePath?": "nullableString",
    "model?": "nullableString",
    projectId: "number",
    "reasoningEffort?": "nullableString",
    worktreePath: "string",
  }),
  createWorktree: objectParams({ name: "string", projectId: "number" }),
  deleteCalendar: objectParams({ calendarId: "number" }),
  deleteCalendarEvent: objectParams({
    eventId: "number",
    "expectedVersion?": "nullableNumber",
    "occurrenceStart?": "nullableString",
    "scope?": "nullableString",
  }),
  deleteExternalIcsCalendar: objectParams({ externalCalendarId: "number" }),
  deletePluginIngressExternalBinding: objectParams({ id: "number" }),
  deleteProject: objectParams({ projectId: "number" }),
  deleteThread: objectParams({ threadId: "number" }),
  discardEmptyThread: objectParams({ threadId: "number" }),
  dismissCalendarNotification: objectParams({ deliveryId: "number" }),
  dismissUserNotification: objectParams({ deliveryId: "number" }),
  focusContext: objectParams({
    "threadId?": "nullableNumber",
    ...projectWorktreeParams,
  }),
  getAppBootstrap: optionalObjectParams({
    "currentProjectId?": "nullableNumber",
    "currentWorktreePath?": "nullableString",
    "selectedThreadId?": "nullableNumber",
  }),
  getCalendarBootstrap: undefinedParams(),
  getHomeDirectory: undefinedParams(),
  getModelCatalog: optionalObjectParams({
    "refresh?": "boolean",
    "refreshProviders?": "boolean",
  }),
  getPluginInventory: undefinedParams(),
  getPluginSecurityDiagnostics: undefinedParams(),
  getPluginSettings: objectParams({ directoryName: "string" }),
  getPluginSidecarDiagnostics: optionalObjectParams({
    "directoryName?": "string",
    "pluginId?": "string",
  }),
  getTerminalSettings: undefinedParams(),
  getThread: objectParams({
    "cursor?": "nullableNumber",
    "includeHeavyContent?": "boolean",
    "messageLimit?": "number",
    threadId: "number",
  }),
  getThreadMessageContent: objectParams({
    messageId: "number",
    threadId: "number",
  }),
  getTimezoneSettings: undefinedParams(),
  getUserRuntimeSettings: undefinedParams(),
  getWorktreeGitCommitDiff: objectParams({
    commitHash: "string",
    ...projectWorktreeParams,
  }),
  getWorktreeSnapshot: objectParams(projectWorktreeParams),
  leaveSharedCalendar: objectParams({ calendarId: "number" }),
  listCalendarNotifications: undefinedParams(),
  listCalendarOccurrences: objectParams({
    end: "string",
    start: "string",
    "timezone?": "nullableString",
  }),
  listCrons: undefinedParams(),
  listDirectorySuggestions: objectParams({ query: "string" }),
  listPluginAccessGroups: undefinedParams(),
  listPluginIngressSources: undefinedParams(),
  listPluginIngressExternalBindings: optionalObjectParams({
    "currentUserOnly?": "boolean",
    "metidosUserId?": "number",
    "pluginId?": "string",
    "sourceId?": "string",
  }),
  listPluginIngressRouteConfigs: optionalObjectParams({
    "currentUserOnly?": "boolean",
    "metidosUserId?": "number",
    "pluginId?": "string",
    "sourceId?": "string",
  }),
  listProjectSkills: objectParams(projectWorktreeParams),
  listProjectWorktrees: objectParams({
    "includeHidden?": "boolean",
    projectId: "number",
  }),
  listProjects: optionalObjectParams({ "includeClosed?": "boolean" }),
  listProjectFavicons: boundedProjectFaviconsParams(),
  logClientEvent: objectParams({
    "context?": "nullableString",
    "details?": "object",
    message: "string",
    "route?": "nullableString",
    severity: "string",
    "timestamp?": "nullableString",
  }),
  listTerminals: undefinedParams(),
  listThreadStatuses: boundedThreadStatusesParams(),
  listThreads: optionalObjectParams({
    "limit?": "number",
    "offset?": "number",
  }),
  listUserNotifications: undefinedParams(),
  listWorktreeGitHistory: objectParams({
    "limit?": "number",
    "offset?": "number",
    ...projectWorktreeParams,
  }),
  markThreadErrorSeen: objectParams({ threadId: "number" }),
  newCron: objectParams({
    ...cronAccessParamShape,
    projectId: "number",
    prompt: "string",
    schedule: "string",
    worktreePath: "string",
  }),
  openProject: objectParams({
    "createIfMissing?": "boolean",
    "initGitIfNeeded?": "boolean",
    "name?": "nullableString",
    "pinWorktree?": "boolean",
    projectPath: "string",
  }),
  openProjectsBatch: boundedOpenProjectsBatchParams(),
  openWorktree: objectParams(projectWorktreeParams),
  openWorktreesBatch: boundedOpenWorktreesBatchParams(),
  readWorktreeFileContentPage: worktreeFileContentPageParams(),
  readWorktreeFileDiff: worktreeFileDiffParams(),
  refreshExternalIcsCalendar: objectParams({ externalCalendarId: "number" }),
  renameTerminal: objectParams({ terminalId: "string", title: "string" }),
  renameThread: objectParams({
    "summary?": "nullableString",
    threadId: "number",
    title: "string",
  }),
  requestThreadStart: objectParams({
    autoStart: "nullableBoolean",
    input: "string",
    model: "nullableString",
    "permissions?": "array",
    projectId: "number",
    reasoningEffort: "nullableString",
    worktreePath: "string",
  }),
  respondThreadExtensionUi: objectParams({
    response: "object",
    threadId: "number",
  }),
  runCronNow: objectParams({ cronJobId: "number" }),
  runPluginAdminAction: objectParams({
    action: "string",
    "confirmation?": "string",
    directoryName: "string",
  }),
  runPluginLifecycleAction: objectParams({
    action: "string",
    directoryName: "string",
  }),
  sendThreadMessage: boundedSendThreadMessageParams(),
  setActiveWorktree: objectParams({
    projectId: "nullableNumber",
    worktreePath: "nullableString",
  }),
  setPluginIngressExternalBindingEnabled: objectParams({
    enabled: "boolean",
    id: "number",
  }),
  upsertPluginIngressRouteConfig: objectParams({
    enabled: "boolean",
    model: "nullableString",
    permissions: "array",
    pluginId: "string",
    projectId: "number",
    sourceId: "string",
    worktreePath: "string",
  }),
  setCalendarShare: objectParams({
    calendarId: "number",
    permission: "nullableString",
    userId: "number",
  }),
  setThreadPinned: objectParams({ pinned: "boolean", threadId: "number" }),
  setWorktreePinned: objectParams({
    pinned: "boolean",
    ...projectWorktreeParams,
  }),
  snoozeCalendarNotification: objectParams({
    deliveryId: "number",
    snoozedUntil: "string",
  }),
  stopThreadTurn: objectParams({ threadId: "number" }),
  updateCalendar: objectParams({
    calendarId: "number",
    "color?": "nullableString",
    "isPublic?": "nullableBoolean",
    "publicSlug?": "nullableString",
    "title?": "nullableString",
  }),
  updateCalendarEvent: objectParams({
    "allDay?": "nullableBoolean",
    "calendarId?": "number",
    "description?": "nullableString",
    "endAt?": "nullableString",
    "endDate?": "nullableString",
    eventId: "number",
    "expectedVersion?": "nullableNumber",
    "location?": "nullableString",
    "occurrenceStart?": "nullableString",
    "recurrenceRule?": "nullableString",
    "reminders?": "array",
    "scope?": "nullableString",
    "startAt?": "nullableString",
    "startDate?": "nullableString",
    "timezone?": "string",
    "title?": "string",
  }),
  updateCalendarNotificationSettings: objectParams({
    "browserEnabled?": "boolean",
    "defaultReminders?": "array",
    "inAppEnabled?": "boolean",
    "ntfyAuthType?": "string",
    "ntfyEnabled?": "boolean",
    "ntfyPriority?": "string",
    "ntfyServerUrl?": "string",
    "ntfyTopic?": "string",
    "ntfyUsername?": "string",
  }),
  updateCalendarPreference: objectParams({
    calendarId: "number",
    "colorOverride?": "nullableString",
    "notificationChannels?": "array",
    "notificationsEnabled?": "nullableBoolean",
    "visible?": "nullableBoolean",
  }),
  updateCron: objectParams({
    ...cronAccessParamShape,
    cronJobId: "number",
    "deleted?": "boolean",
    "projectId?": "number",
    "prompt?": "string",
    "schedule?": "string",
    "worktreePath?": "string",
  }),
  updateExternalIcsCalendar: objectParams({
    externalCalendarId: "number",
    "color?": "nullableString",
    "enabled?": "nullableBoolean",
    "notificationMode?": "nullableString",
    "notificationsEnabled?": "nullableBoolean",
    "refreshIntervalMinutes?": "nullableNumber",
    "title?": "nullableString",
    "url?": "nullableString",
    "visible?": "nullableBoolean",
  }),
  updatePluginSettings: objectParams({
    directoryName: "string",
    values: "record",
  }),
  updateTerminalSettings: objectParams({
    "defaultShell?": "string",
    "replayBufferBytes?": "number",
  }),
  updateThreadAccess: objectParams({
    ...threadAccessParamShape,
    threadId: "number",
  }),
  updateThreadExtensionEditor: threadExtensionEditorParams(),
  updateThreadMetadata: objectParams({
    "pinned?": "boolean",
    "summary?": "nullableString",
    threadId: "number",
    "title?": "string",
  }),
  updateThreadModel: objectParams({ model: "string", threadId: "number" }),
  updateThreadReasoningEffort: objectParams({
    reasoningEffort: "string",
    threadId: "number",
  }),
  updateTimezoneSettings: objectParams({
    "timezone?": "nullableString",
  }),
  updateUserRuntimeSettings: objectParams({
    "commandTimeoutSeconds?": "number",
  }),
};

export function validateRpcRequestParams(
  method: RpcMethodName,
  params: unknown,
): RpcRequestMap[RpcMethodName]["params"] {
  const validator = rpcParamValidators[method];
  if (typeof validator !== "function") {
    throw new Error("Invalid RPC method.");
  }
  return validator(params, method) as RpcRequestMap[RpcMethodName]["params"];
}

/**
 * Parse and validate inbound websocket request messages.
 * @param parsed - Parsed message payload to validate.
 */
function isSafeRpcRequestId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseRpcRequestMessage(
  parsed: ParsedRpcClientMessage,
): RpcRequestMessage {
  const method = parsed.method;
  if (
    parsed.type !== "request" ||
    !isSafeRpcRequestId(parsed.id) ||
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

  const requestMethod = parsed.method as RpcMethodName;
  const timeoutMs = normalizeTimeoutMs(parsed.timeoutMs);
  const request: RpcRequestMessage = {
    type: "request",
    id: parsed.id,
    method: requestMethod,
    params: validateRpcRequestParams(requestMethod, parsed.params),
    priority: normalizeRpcRequestPriority(parsed.priority),
  };
  if (timeoutMs !== null) {
    request.timeoutMs = timeoutMs;
  }
  return request;
}

/**
 * Parse either a request or cancel message from a websocket payload.
 * @param parsed - Parsed client message.
 */
export function parseRpcClientMessage(
  parsed: ParsedRpcClientMessage,
): RpcClientMessage {
  if (parsed.type === "cancel" && isSafeRpcRequestId(parsed.id)) {
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
  return parseRpcRequestMessage(parsed);
}

type RpcErrorPayload = Pick<
  Extract<RpcResponseMessage, { ok: false }>,
  "error" | "errorCode" | "errorDetails"
>;

function buildPluginRpcErrorPayload(error: unknown): RpcErrorPayload | null {
  if (error instanceof PluginFetchError) {
    return {
      error: "Plugin fetch failed.",
      errorCode: `plugin_fetch_${error.code}`,
      errorDetails: { code: error.code },
    };
  }
  if (error instanceof PluginFsPathError) {
    return {
      error: "Plugin filesystem path validation failed.",
      errorCode: `plugin_fs_path_${error.code}`,
      errorDetails: { code: error.code, virtualPath: error.virtualPath },
    };
  }
  if (error instanceof PluginFsReadError) {
    return {
      error: "Plugin filesystem read failed.",
      errorCode: `plugin_fs_read_${error.code}`,
      errorDetails: { code: error.code, virtualPath: error.virtualPath },
    };
  }
  if (error instanceof PluginFsWriteError) {
    return {
      error: "Plugin filesystem write failed.",
      errorCode: `plugin_fs_write_${error.code}`,
      errorDetails: { code: error.code, virtualPath: error.virtualPath },
    };
  }
  if (error instanceof PluginSqliteError) {
    return {
      error: "Plugin SQLite operation failed.",
      errorCode: `plugin_sqlite_${error.code}`,
      errorDetails: { code: error.code, virtualPath: error.virtualPath },
    };
  }
  if (error instanceof PluginDataQuotaError) {
    return {
      error: "Plugin data quota check failed.",
      errorCode: `plugin_data_quota_${error.code}`,
      errorDetails: {
        attempted: error.attempted === null ? null : String(error.attempted),
        code: error.code,
        limit: error.limit === null ? null : String(error.limit),
      },
    };
  }
  return null;
}
/**
 * Builds rpc error payload.
 * @param error - Error value to process.
 */

function buildRpcErrorPayload(error: unknown): RpcErrorPayload {
  // RPC runs behind session-cookie auth, same-origin WebSocket checks, and a
  // single-use WebSocket ticket. Domain procedures intentionally return most
  // user-facing messages to the local operator. AuthServiceError details feed UI
  // retry/step-up flows, and known plugin errors are mapped to public messages
  // so absolute paths, SQL fragments, URLs, and low-level causes stay in logs.
  if (error instanceof AuthServiceError) {
    return {
      error: error.message,
      errorCode: error.code,
      errorDetails: sanitizeAuthErrorDetails(error),
    };
  }

  const pluginErrorPayload = buildPluginRpcErrorPayload(error);
  if (pluginErrorPayload) {
    return pluginErrorPayload;
  }

  if (error instanceof WorkspacePathError) {
    return {
      error: error.message,
      errorCode: error.code,
    };
  }

  return {
    error: "The requested operation failed.",
    errorCode: "internal_error",
  };
}

/**
 * Coerce raw timeout values into normalized positive integers.
 * @param value - Input value.
 */
function normalizeTimeoutMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.min(MAX_RPC_REQUEST_TIMEOUT_MS, Math.max(1, Math.floor(value)));
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

function isWebSocketSubprotocolHeaderAllowed(value: string | null): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

/**
 * Queue/reuse rebuilds for mainview bundle so rapid file edits only rebuild once.
 */

function queueMainviewBundleBuild(): Promise<MainviewBuildResult> {
  if (mainviewBuildPromise) {
    mainviewRebuildQueued = true;
    return mainviewBuildPromise;
  }

  mainviewBuildPromise = (async () => {
    try {
      let buildResult: MainviewBuildResult;
      do {
        mainviewRebuildQueued = false;
        buildResult = await buildMainviewBundle({
          env: process.env,
          mode: IS_DEV_SERVER ? "development" : "production",
        });
        mainviewBundlePath = buildResult.bundlePath;
        mainviewBundleSourceMapPath = buildResult.sourceMapPath;
        mainviewBuildAssetPaths = buildResult.assetPaths;
        invalidateMainviewHtmlCache();
      } while (mainviewRebuildQueued);

      return buildResult;
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
  if (!IS_DEV_SERVER || !rpcTransport.hasClients()) {
    return;
  }

  const payload = {
    type: "reload",
    reason,
  } satisfies RpcSocketMessage;
  void rpcTransport.publish(payload);
}

/**
 * Broadcast that git history changed for a tracked worktree.
 */

function broadcastGitHistoryChanged(
  projectId: number,
  worktreePath: string,
): void {
  if (!rpcTransport.hasClients()) {
    return;
  }

  const payload = {
    type: "git-history-changed",
    projectId,
    worktreePath,
  } satisfies RpcSocketMessage;
  void rpcTransport.publish(payload);
}

function broadcastCronJobsChanged(): void {
  if (!rpcTransport.hasClients()) {
    return;
  }

  void rpcTransport.publish({ type: "cron-jobs-changed" });
}

/**
 * Broadcast that the UI should focus a specific project/worktree/thread context.
 * @param payload - JSON payload used for tracing and response.
 */
function broadcastContextFocusChanged(
  payload: RpcContextFocusChanged,
  sessionId: string | null,
): void {
  if (!rpcTransport.hasClients()) {
    return;
  }

  const message = {
    type: "context-focus-changed",
    ...payload,
  } satisfies RpcSocketMessage;
  void rpcTransport.publish(message, {
    kind: "session",
    sessionId,
  });
}

/**
 * Broadcast that a background thread start request was created.
 */

function broadcastThreadStartRequestCreated(
  request: RpcThreadStartRequest,
): void {
  if (!rpcTransport.hasClients()) {
    return;
  }

  const payload = {
    type: "thread-start-request-created",
    ...request,
  } satisfies RpcSocketMessage;
  void rpcTransport.publish(payload);
}

function broadcastThreadStartRequestResolved(
  resolved: RpcThreadStartRequestResolved,
): void {
  if (!rpcTransport.hasClients()) {
    return;
  }

  const payload = {
    type: "thread-start-request-resolved",
    ...resolved,
  } satisfies RpcSocketMessage;
  void rpcTransport.publish(payload);
}

function broadcastTerminalChanged(terminal: RpcTerminal): void {
  if (!rpcTransport.hasClients()) {
    return;
  }
  const payload = {
    type: "terminal-changed",
    terminal,
  } satisfies RpcSocketMessage;
  void rpcTransport.publish(payload);
}

function broadcastCalendarChanged(): void {
  if (!rpcTransport.hasClients()) {
    return;
  }
  const payload = {
    type: "calendar-changed",
  } satisfies RpcSocketMessage;
  void rpcTransport.publish(payload);
}

function broadcastCalendarNotificationsDue(
  deliveries: RpcCalendarReminderDelivery[],
): void {
  if (!rpcTransport.hasClients() || deliveries.length === 0) {
    return;
  }
  const payload = {
    type: "calendar-notifications-due",
    deliveries,
  } satisfies RpcSocketMessage;
  void rpcTransport.publish(payload);
}

function broadcastUserNotificationSent(
  delivery: RpcUserNotificationDelivery,
): void {
  if (!rpcTransport.hasClients()) {
    return;
  }
  const payload = {
    type: "user-notification-sent",
    delivery,
  } satisfies RpcSocketMessage;
  void rpcTransport.publish(payload);
}

function broadcastModelCatalogChanged(modelCatalog: RpcModelCatalog): void {
  if (!rpcTransport.hasClients()) {
    return;
  }
  const payload = {
    type: "model-catalog-changed",
    modelCatalog,
  } satisfies RpcSocketMessage;
  void rpcTransport.publish(payload);
}

function pushThreadStatusChangedNow(thread: RpcThread): void {
  const payload = {
    type: "thread-status-changed",
    thread,
  } satisfies RpcSocketMessage;
  void rpcTransport.publish(payload);
}

const threadStatusChangeCoalescer = new ThreadStatusCoalescer<RpcThread>({
  windowMs: THREAD_STATUS_PUSH_COALESCE_MS,
  send: pushThreadStatusChangedNow,
});

function broadcastThreadStatusChanged(thread: RpcThread): void {
  if (!rpcTransport.hasClients()) {
    return;
  }

  threadStatusChangeCoalescer.enqueue(thread);
}

function broadcastThreadExtensionUiRequest(
  event: RpcThreadExtensionUiRequest,
  sessionId: string | null,
): boolean {
  const scope =
    sessionId === null
      ? ({ kind: "all" } as const)
      : ({ kind: "session", sessionId } as const);
  if (!rpcTransport.hasPublishTargets(scope)) {
    return false;
  }

  const payload = {
    type: "thread-extension-ui",
    event,
  } satisfies RpcSocketMessage;
  void rpcTransport.publish(payload, scope);
  return true;
}
const devMainviewWatcher = createDevMainviewWatcher({
  broadcastReload,
  debounceMs: MAINVIEW_RELOAD_DEBOUNCE_MS,
  invalidateHtmlCache: invalidateMainviewHtmlCache,
  isDevServer: IS_DEV_SERVER,
  logger: webServerLogger,
  mainviewSourceDir: MAINVIEW_SOURCE_DIR,
  normalizeErrorDescription,
  pollIntervalMs: MAINVIEW_WATCH_INTERVAL_MS,
  queueBundleBuild: queueMainviewBundleBuild,
});

function startDevMainviewWatcher(): void {
  devMainviewWatcher.start();
}

function shutdownDevWatchers(): void {
  devMainviewWatcher.shutdown();
}

async function runExternalIcsRefreshCycle(): Promise<void> {
  // This guard is synchronous by design: Bun invokes these timers/callbacks on
  // one JS event loop, and there is no await between the read and write. If ICS
  // refresh moves to workers or multiple isolates, replace this with a durable
  // DB-backed lease before allowing concurrent refresh callers.
  if (externalIcsRefreshInFlight) {
    return;
  }
  externalIcsRefreshInFlight = true;
  try {
    const results = await refreshDueExternalIcsCalendars(initAppDatabase());
    if (results.length === 0) {
      return;
    }
    let sawChangedCalendars = false;
    for (const result of results) {
      sawChangedCalendars = true;
      if (!result.ok) {
        webServerLogger.warning({
          message: "External ICS background refresh failed",
          calendarId: result.calendarId,
          ownerUserId: result.ownerUserId,
          error: result.error,
        });
      }
    }
    if (sawChangedCalendars) {
      broadcastCalendarChanged();
    }
  } catch (error) {
    webServerLogger.warning({
      message: "External ICS background refresh cycle failed",
      error: normalizeErrorDescription(error),
    });
  } finally {
    externalIcsRefreshInFlight = false;
  }
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
  const database = initAppDatabase();
  const legacyPluginSettingsMigration =
    await migrateLegacyPluginSettings(database);
  if (
    legacyPluginSettingsMigration.migratedNtfyUsers > 0 ||
    legacyPluginSettingsMigration.migratedWeatherUsers > 0 ||
    legacyPluginSettingsMigration.droppedTables.length > 0
  ) {
    webServerLogger.info({
      message: "Migrated legacy settings into plugins",
      droppedTables: legacyPluginSettingsMigration.droppedTables,
      migratedNtfyUsers: legacyPluginSettingsMigration.migratedNtfyUsers,
      migratedWeatherUsers: legacyPluginSettingsMigration.migratedWeatherUsers,
    });
  }
  for (const error of legacyPluginSettingsMigration.errors) {
    webServerLogger.warning({
      message: "Legacy plugin settings migration warning",
      error,
    });
  }
  const totpSecretMigration = await migrateTotpAuthSecretsOnStartup(database);
  if (totpSecretMigration.migrated > 0) {
    webServerLogger.info({
      message: "Migrated legacy TOTP auth secrets to local-operator encryption",
      migrated: totpSecretMigration.migrated,
      scanned: totpSecretMigration.scanned,
    });
  }
  stopAllActiveWebServerShares(database);
  await startPiWebServerShareWorker({
    host: WEB_SERVER_SHARE_HOST,
    port: WEB_SERVER_SHARE_PORT,
    secureCookies: TLS_RUNTIME.publicTls,
  });
  if (TRACK_RUNTIME_TELEMETRY) {
    runtimeStatsSidecar = startRuntimeStatsSidecar({
      logger: webServerLogger,
    });
  }
  recoverInterruptedThreadTurnsOnStartup();
  startCronScheduler();
  const sqliteSecurityDiagnostic =
    refreshPluginSqliteNativeSecurityDiagnostic();
  webServerLogger.info({
    message: "Plugin SQLite native security diagnostic",
    sqliteNativeSecurity: sqliteSecurityDiagnostic,
  });
  pluginSidecarManager = createPluginSidecarProcessManager({
    ingressThreadHost: createDefaultPluginIngressThreadHost(),
    logger: webServerLogger,
    onModelProviderCatalogChanged: (event) => {
      const modelCatalog = buildModelCatalog();
      webServerLogger.info({
        ...event,
        catalogModelCount: modelCatalog.models.length,
        message: "Plugin model provider catalog refresh completed",
      });
      broadcastModelCatalogChanged(modelCatalog);
    },
    runtimeKind: PLUGIN_RUNTIME_KIND,
  });
  setPiPluginSidecarManager(pluginSidecarManager);
  startPluginRuntimeReconciliation("app_startup");
  if (!BACKEND_ONLY) {
    await queueMainviewBundleBuild();
    startDevMainviewWatcher();
  }
  startProcedureCacheMaintenance();
  setWorktreeGitHistoryChangeListener((projectId, worktreePath) => {
    broadcastGitHistoryChanged(projectId, worktreePath);
  });
  setCronJobsChangeListener(() => {
    broadcastCronJobsChanged();
  });
  setContextFocusChangeListener((payload, sessionId) => {
    broadcastContextFocusChanged(payload, sessionId);
  });
  setThreadStartRequestCreatedListener((request) => {
    broadcastThreadStartRequestCreated(request);
  });
  setThreadStartRequestResolvedListener((resolved) => {
    broadcastThreadStartRequestResolved(resolved);
  });
  setThreadStatusChangeListener((thread) => {
    broadcastThreadStatusChanged(thread);
  });
  terminalManager.onTerminalChanged((terminal) => {
    broadcastTerminalChanged(terminal);
  });
  setThreadExtensionUiMessageListener((request, sessionId) =>
    broadcastThreadExtensionUiRequest(request, sessionId),
  );
  setCalendarNotificationListener((_userId, deliveries) => {
    broadcastCalendarNotificationsDue(deliveries);
  });
  setUserNotificationSentListener((_userId, delivery) => {
    broadcastUserNotificationSent(delivery);
  });
  calendarSchedulerTimer = setInterval(() => {
    try {
      scheduleDueCalendarReminders(initAppDatabase());
    } catch (error) {
      webServerLogger.warning({
        message: "Calendar reminder scheduling failed",
        error: normalizeErrorDescription(error),
      });
    }
  }, 60_000);
  calendarCleanupTimer = setInterval(() => {
    try {
      runCalendarNotificationCleanup(initAppDatabase());
    } catch (error) {
      webServerLogger.warning({
        message: "Calendar reminder cleanup failed",
        error: normalizeErrorDescription(error),
      });
    }
  }, 30 * 60_000);
  externalIcsRefreshTimer = setInterval(() => {
    void runExternalIcsRefreshCycle();
  }, EXTERNAL_ICS_REFRESH_WORKER_INTERVAL_MS);
  void runExternalIcsRefreshCycle();

  let activeServerPort = SERVER_PORT;
  let normalizedAllowedWsOrigins =
    buildNormalizedAllowedWsOrigins(activeServerPort);
  startOverloadMonitoring(() => activeServerPort);
  const serverOptions = {
    hostname: SERVER_HOSTNAME,
    idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS /**
     * Fetches data from the configured endpoint.
     * @param request - Incoming request payload.
     * @param serverInstance - HTTP server instance being queried.
     */,

    async fetch(request, serverInstance) {
      const requestUrl = new URL(request.url);
      const { pathname } = requestUrl;
      const requestId = normalizeRequestIdHeader(
        request.headers.get("x-request-id"),
      );
      const source = requestUrl.origin;
      const requestStartMs = Date.now();

      traceWebServer(() => ({
        message: "HTTP request received",
        method: request.method,
        pathname,
        source,
        requestId: requestId ?? null,
      }));

      const authResponse = await handleAuthRequest(request, serverInstance, {
        allowedOrigins: normalizedAllowedWsOrigins,
      });
      if (authResponse) {
        traceWebServer(() => ({
          message: "HTTP request handled by auth route",
          method: request.method,
          pathname,
          status: authResponse.status,
          source,
          requestId: requestId ?? null,
          durationMs: Date.now() - requestStartMs,
        }));
        return authResponse;
      }

      // Upgrade terminal websocket requests before falling through to HTTP routes.
      if (pathname.startsWith("/terminal/")) {
        if (
          !isWebSocketSubprotocolHeaderAllowed(
            request.headers.get("sec-websocket-protocol"),
          )
        ) {
          return stringResponse(
            "WebSocket subprotocols are not supported",
            "text/plain; charset=utf-8",
            400,
          );
        }
        if (
          !isWebSocketOriginAllowed(
            request.headers.get("origin"),
            normalizedAllowedWsOrigins,
            {
              preNormalizedAllowedOrigins: true,
              requireOrigin: true,
            },
          )
        ) {
          return stringResponse(
            "WebSocket origin not allowed",
            "text/plain; charset=utf-8",
            403,
          );
        }
        // Decoding only normalizes the route component for downstream lookup.
        // It is not a path-safety decision: terminal access is checked by
        // authorizeTerminalWebSocketUpgrade against the authenticated session
        // and terminal manager instead of trusting the decoded route text.
        const terminalId = safeDecodeRouteComponent(
          pathname.slice("/terminal/".length),
        );
        if (terminalId === null) {
          return stringResponse(
            "Bad request",
            "text/plain; charset=utf-8",
            400,
          );
        }
        const terminalAuth = authorizeTerminalWebSocketUpgrade({
          cookieHeader: request.headers.get("cookie"),
          getTerminal: (ownedTerminalId) =>
            terminalManager.getTerminal(ownedTerminalId),
          nowMs: Date.now(),
          resolveSession: (input) =>
            resolveSession(initAppDatabase(), {
              nowMs: input.nowMs,
              sessionId: input.sessionId,
              touch: input.touch,
            }),
          terminalId,
          validateTicket: (input) => {
            validateAndConsumeWebSocketTicket(initAppDatabase(), input);
          },
        });
        if (!terminalAuth.ok) {
          if (terminalAuth.failure.kind === "auth_error") {
            return authErrorResponse(request, terminalAuth.failure.error, {
              clearSessionCookie: terminalAuth.failure.clearSessionCookie,
              clearWebSocketTicketCookie:
                terminalAuth.failure.clearWebSocketTicketCookie,
            });
          }
          return new Response(terminalAuth.failure.body, {
            headers: buildResponseHeaders("text/plain; charset=utf-8"),
            status: terminalAuth.failure.status,
          });
        }
        const socketData: TerminalWebSocketData = terminalAuth.socketData;
        if (
          serverInstance.upgrade(request, {
            data: socketData,
          })
        ) {
          return;
        }
        return stringResponse(
          "WebSocket upgrade failed",
          "text/plain; charset=utf-8",
          400,
        );
      }

      // Upgrade websocket requests before falling through to HTTP routes.
      if (pathname === "/rpc") {
        if (
          !isWebSocketSubprotocolHeaderAllowed(
            request.headers.get("sec-websocket-protocol"),
          )
        ) {
          webServerLogger.warning({
            message: "WebSocket subprotocol not supported",
            method: request.method,
            pathname,
            source,
            requestId: requestId ?? null,
          });
          return stringResponse(
            "WebSocket subprotocols are not supported",
            "text/plain; charset=utf-8",
            400,
          );
        }
        if (
          !isWebSocketOriginAllowed(
            request.headers.get("origin"),
            normalizedAllowedWsOrigins,
            {
              preNormalizedAllowedOrigins: true,
              requireOrigin: true,
            },
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
        // authorizeRpcWebSocketUpgrade consumes the short-lived ticket before
        // Bun accepts the socket. If the later upgrade fails, the client must
        // request a fresh ticket; that is preferable to allowing replay of a
        // bearer cookie after a partially processed handshake.
        const websocketAuth = authorizeRpcWebSocketUpgrade({
          cookieHeader: request.headers.get("cookie"),
          nowMs: Date.now(),
          requireTicket: true,
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
              clearWebSocketTicketCookie:
                websocketAuth.failure.clearWebSocketTicketCookie,
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

        let socketData: RpcWebSocketSocketData;
        try {
          const session = resolveSession(initAppDatabase(), {
            nowMs: Date.now(),
            sessionId: websocketAuth.preAuth.sessionId,
            touch: true,
          });
          if (!session) {
            throw new AuthServiceError(
              "session_required",
              "A valid authenticated session is required.",
              401,
            );
          }
          socketData = buildRpcSocketDataFromSession(session);
        } catch (error) {
          webServerLogger.warning({
            message: "WebSocket session resolution failed",
            method: request.method,
            pathname,
            source,
            requestId: requestId ?? null,
            error: normalizeErrorDescription(error),
          });
          return authErrorResponse(request, error, {
            clearSessionCookie: true,
            clearWebSocketTicketCookie: true,
          });
        }

        webServerLogger.trace({
          message: "WebSocket auth passed",
          method: request.method,
          pathname,
          sessionId: socketData.sessionId,
          source,
          requestId: requestId ?? null,
        });

        if (
          serverInstance.upgrade(request, {
            data: socketData,
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

      const mainviewStaticAssetResponse =
        await handleMainviewStaticAssetRequest({
          backendOnly: BACKEND_ONLY,
          pathname,
          source,
          requestId: requestId ?? null,
          htmlResponse: () => htmlResponse(request),
          fileResponse,
          getAssetSnapshot: getCurrentMainviewAssetSnapshot,
          paths: {
            cssPath: MAINVIEW_CSS_PATH,
            bundlePath: mainviewBundlePath,
            ghosttyWasmPath: GHOSTTY_WASM_PATH,
            bundleSourceMapPath: mainviewBundleSourceMapPath,
            firaCodeFontPath: FIRA_CODE_VARIABLE_FONT_PATH,
            interLatinFontPath: INTER_VARIABLE_FONT_LATIN_PATH,
            interLatinExtFontPath: INTER_VARIABLE_FONT_LATIN_EXT_PATH,
          },
          trace(message, context) {
            webServerLogger.trace({
              message,
              pathname: context.pathname,
              source: context.source,
              requestId: context.requestId,
            });
          },
        });
      if (mainviewStaticAssetResponse) {
        return mainviewStaticAssetResponse;
      }

      if (
        pathname.startsWith("/calendar/public/") &&
        pathname.endsWith(".ics")
      ) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return stringResponse(
            "Method not allowed",
            "text/plain; charset=utf-8",
            405,
            { Allow: "GET, HEAD" },
          );
        }

        const calendarRateLimitResponse = enforcePublicCalendarIcsRateLimit(
          resolvePublicRoutePeerKey(request, serverInstance),
          requestStartMs,
        );
        if (calendarRateLimitResponse) {
          return calendarRateLimitResponse;
        }
        // Decoding only accepts valid percent-encoding for the public slug.
        // The slug is passed to exportPublicCalendarIcs as an opaque database
        // key; no filesystem path is derived from this decoded value.
        const slug = safeDecodeRouteComponent(
          pathname.slice("/calendar/public/".length, -".ics".length),
        );
        if (slug === null) {
          return stringResponse(
            "Bad request",
            "text/plain; charset=utf-8",
            400,
          );
        }
        const ics = exportPublicCalendarIcs(initAppDatabase(), slug);
        if (!ics) {
          return stringResponse("Not found", "text/plain; charset=utf-8", 404);
        }
        return stringResponse(ics, "text/calendar; charset=utf-8", 200);
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

      if (pathname === "/health/runtime-stats") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return stringResponse(
            "Method not allowed",
            "text/plain; charset=utf-8",
            405,
            { Allow: "GET, HEAD" },
          );
        }

        const authFailure = authorizeRuntimeStatsRequest(request);
        if (authFailure) {
          return authFailure;
        }
        if (!runtimeStatsRequestUsesSharedSecret(request)) {
          try {
            enforceAuthReadRequestSecurity(request, {
              expectedOrigin:
                resolveTrustedForwardedOrigin(request, {
                  peerAddress: readRequestPeerAddress(request, serverInstance),
                }) ?? requestUrl.origin,
            });
          } catch (error) {
            return authErrorResponse(request, error);
          }
        }
        const runtimeStatsRateLimitResponse =
          enforceRuntimeStatsSnapshotRateLimit(
            resolvePublicRoutePeerKey(request, serverInstance),
            requestStartMs,
          );
        if (runtimeStatsRateLimitResponse) {
          return runtimeStatsRateLimitResponse;
        }
        webServerLogger.trace({
          message: "Serving runtime stats health endpoint",
          pathname,
          source,
          requestId: requestId ?? null,
        });
        return jsonResponse(buildRuntimeDiagnosticsSnapshot());
      }

      if (pathname === "/health/runtime-stats/reset") {
        webServerLogger.trace({
          message: "Resetting runtime stats through health endpoint",
          method: request.method,
          pathname,
          source,
          requestId: requestId ?? null,
        });
        if (request.method !== "POST") {
          return stringResponse(
            "Method not allowed",
            "text/plain; charset=utf-8",
            405,
          );
        }
        if (!isJsonContentTypeHeader(request.headers.get("content-type"))) {
          return jsonResponse(
            {
              error: {
                code: "invalid_content_type",
                details: null,
                message:
                  'Runtime stats reset requests must use "Content-Type: application/json".',
              },
              ok: false,
            },
            415,
          );
        }
        const providedRuntimeStatsSecret =
          request.headers.get("x-metidos-runtime-stats-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (
          !isRuntimeStatsSecretMatch(
            RUNTIME_STATS_SHARED_SECRET,
            providedRuntimeStatsSecret,
          )
        ) {
          const authFailure = authorizeRuntimeStatsRequest(request);
          if (authFailure) {
            return authFailure;
          }
          const peerAddress = readRequestPeerAddress(request, serverInstance);
          enforceAuthMutationRequestSecurity(request, {
            expectedOrigin:
              resolveTrustedForwardedOrigin(request, { peerAddress }) ??
              requestUrl.origin,
          });
        }

        resetRuntimeStats();
        return jsonResponse(buildRuntimeDiagnosticsSnapshot());
      }

      if (isWebServerSharePath(pathname)) {
        return proxyWebServerShareRequest(request);
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
      maxPayloadLength: MAX_RPC_WEBSOCKET_MESSAGE_BYTES,
      /**
       * Routes new WebSocket connections to the appropriate socket owner.
       * @param ws - WebSocket instance passed to open handler.
       */
      open(ws) {
        if ("terminalId" in ws.data && typeof ws.data.terminalId === "string") {
          terminalManager.connectSocket(
            ws as ServerWebSocket<TerminalWebSocketData>,
          );
          return;
        }
        rpcTransport.open(ws);
        webServerLogger.trace({
          message: "WebSocket client connected",
          sessionId: ws.data.sessionId,
          totalClients: rpcTransport.getClientCount(),
        });
      },

      /**
       * Routes closed WebSocket connections to the appropriate socket owner.
       * @param ws - WebSocket instance being closed.
       */

      close(ws) {
        if ("terminalId" in ws.data && typeof ws.data.terminalId === "string") {
          terminalManager.disconnectSocket(
            ws as ServerWebSocket<TerminalWebSocketData>,
          );
          return;
        }
        rpcTransport.close(ws, "RPC connection closed.");
        webServerLogger.trace({
          message: "WebSocket client disconnected",
          sessionId: ws.data.sessionId,
          totalClients: rpcTransport.getClientCount(),
        });
        if (!rpcTransport.hasClients()) {
          webServerLogger.trace({
            message: "RPC client set empty, suspending polling",
            totalClients: rpcTransport.getClientCount(),
          });
          suspendActiveWorktreePolling();
        }
      },

      /**
       * Routes send-buffer drain events to the appropriate socket owner.
       * @param ws - WebSocket instance whose send buffer drained.
       */
      drain(ws) {
        if ("terminalId" in ws.data && typeof ws.data.terminalId === "string") {
          return;
        }
        rpcTransport.drain(ws);
      },

      /**
       * Processes message events.
       * @param ws - WebSocket instance that received a message.
       * @param rawMessage - Raw message payload from websocket.
       */

      message(ws, rawMessage) {
        if ("terminalId" in ws.data && typeof ws.data.terminalId === "string") {
          const terminalSocket = ws as ServerWebSocket<TerminalWebSocketData>;
          // Terminal PTY messages are not allowed to rely on upgrade-time
          // authorization alone. Revalidate on every incoming terminal frame
          // and require local-operator privileges so admin revocation closes the
          // socket before terminalManager can process more input.
          if (
            !revalidateAuthenticatedWebSocketSession(terminalSocket, {
              requireAdmin: true,
            })
          ) {
            terminalManager.disconnectSocket(terminalSocket);
            return;
          }
          terminalManager.handleSocketMessage(terminalSocket, rawMessage);
          return;
        }
        traceWebServer(() => ({
          message: "WebSocket message received",
          payloadType: typeof rawMessage,
          sessionId: ws.data.sessionId,
        }));
        rpcTransport.handleMessage(ws, rawMessage);
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
    const fallbackPort = server.port ?? activeServerPort;
    webServerLogger.warning({
      message: "Metidos dev server port fallback",
      configuredPort: SERVER_PORT,
      fallbackUrl: `http://localhost:${fallbackPort}`,
    });
  }
  activeServerPort = server.port ?? activeServerPort;
  normalizedAllowedWsOrigins =
    buildNormalizedAllowedWsOrigins(activeServerPort);

  webServerLogger.info({
    message: BACKEND_ONLY
      ? "Metidos RPC backend listening"
      : "Metidos web app listening",
    backendOnly: BACKEND_ONLY,
    devServer: IS_DEV_SERVER,
    liveReloadEnabled: IS_DEV_SERVER,
    port: server.port,
    publicTlsExpected: TLS_RUNTIME.publicTls,
    url: `http://${SERVER_HOSTNAME === "0.0.0.0" ? "localhost" : SERVER_HOSTNAME}:${server.port}`,
  });

  // Defer non-essential cache warmup until the server is already listening.
  // First requests may still compute their own cache entries; the warmup helpers
  // share the same bounded, idempotent loaders and are an opportunistic latency
  // optimization rather than a startup correctness requirement.
  procedureStartupWarmupTimer = setTimeout(() => {
    procedureStartupWarmupTimer = null;
    warmProcedureStartupCaches();
  }, 0);
}

let shutdownPromise: Promise<void> | null = null;

/**
 * Run coordinated shutdown steps once, then exit with the requested process code.
 * @param exitCode - Exit status code from child process execution.
 */
async function shutdownAndExit(exitCode: number): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    const watchdog = setTimeout(() => {
      webServerLogger.error({
        message: "Metidos shutdown timed out; forcing process exit",
        timeoutMs: SHUTDOWN_TIMEOUT_MS,
      });
      process.exit(exitCode);
    }, SHUTDOWN_TIMEOUT_MS);
    watchdog.unref();

    shutdownDevWatchers();
    if (procedureStartupWarmupTimer) {
      // Startup cache warmup is intentionally best-effort. If shutdown begins
      // before the one-shot timer fires, cancel it so shutdown does not start
      // new cache reads after listeners, sidecars, and databases begin closing.
      clearTimeout(procedureStartupWarmupTimer);
      procedureStartupWarmupTimer = null;
    }
    if (overloadMonitorTimer) {
      clearInterval(overloadMonitorTimer);
      overloadMonitorTimer = null;
    }
    if (calendarSchedulerTimer) {
      clearInterval(calendarSchedulerTimer);
      calendarSchedulerTimer = null;
    }
    if (calendarCleanupTimer) {
      clearInterval(calendarCleanupTimer);
      calendarCleanupTimer = null;
    }
    if (externalIcsRefreshTimer) {
      clearInterval(externalIcsRefreshTimer);
      externalIcsRefreshTimer = null;
    }
    setCalendarNotificationListener(null);
    setUserNotificationSentListener(null);
    setWorktreeGitHistoryChangeListener(null);
    setCronJobsChangeListener(null);
    setContextFocusChangeListener(null);
    setThreadStartRequestCreatedListener(null);
    setThreadStartRequestResolvedListener(null);
    setThreadStatusChangeListener(null);
    threadStatusChangeCoalescer.flushAll();
    setThreadExtensionUiMessageListener(null);
    shutdownProcedureCacheMaintenance();
    shutdownProjectPolling();
    await stopCronScheduler();
    await pluginSidecarManager?.stopAll();
    pluginSidecarManager = null;
    setPiPluginSidecarManager(null);
    await shutdownActiveThreadTurns();
    await stopPiWebServerShareWorker();
    await runtimeStatsSidecar?.close();
    runtimeStatsSidecar = null;
    closeAuthRouteRateLimitDatabase();
    closeAppDatabase();
    clearTimeout(watchdog);
  })()
    .catch((error) => {
      webServerLogger.error({
        message: "Failed to cleanly shut down Metidos",
        error: normalizeErrorDescription(error),
      });
    })
    .finally(() => {
      shutdownLoggingThread();
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

export async function runBackendCli(): Promise<void> {
  if (SERVER_ARGS.includes(WIPE_USER_DATA_FLAG)) {
    try {
      const completed = await runUserDataWipeCli();
      process.exitCode = completed ? 0 : 1;
    } catch (error) {
      console.error(
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : String(error),
      );
      process.exitCode = 1;
    }
  } else {
    await bootstrap();
  }
}

if (import.meta.main) {
  await runBackendCli();
}
