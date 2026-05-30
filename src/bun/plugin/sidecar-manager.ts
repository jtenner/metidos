/**
 * @file src/bun/plugin/sidecar-manager.ts
 * @description Lifecycle manager for Plugin System v1 sidecar runtimes.
 */

import type { AuthStorage as PiAuthStorage } from "@mariozechner/pi-coding-agent";
import { lstatSync, realpathSync } from "node:fs";

import {
  createCalendar,
  createCalendarEvent,
  deleteCalendar,
  deleteCalendarEvent,
  getCalendarBootstrap,
  getCalendarEvent,
  listCalendarOccurrences,
  MAX_CALENDAR_OCCURRENCES_PER_REQUEST,
  updateCalendar,
  updateCalendarEvent,
} from "../calendar/store";
import {
  type AppDataPathOptions,
  getProjectById,
  getTerminalSettings,
  getUserById,
  initAppDatabase,
  listUsers,
  resetUserOtpEnrollment,
  updateUserProfile,
} from "../db";
import { readLocalRuntimeSettings } from "../local-settings";
import type { LogSubsystem } from "../logging";
import { createSubsystemLogger } from "../logging";
import type { PiAuthPluginBinding } from "../pi/builtin-provider-settings";
import { invalidateModelCatalogState } from "../project-procedures/model-catalog";
import type {
  RpcPluginInventory,
  RpcPluginInventoryPlugin,
  RpcPluginSidecarDiagnostics,
  RpcPluginSidecarFailureDiagnostic,
  RpcPluginSidecarStderrLine,
} from "../rpc-schema/plugin";
import {
  terminalManager,
  terminalOwnerSessionKeyForThread,
  type TerminalAccessScope,
} from "../terminal-manager";
import type { PluginCalendarEventsHost } from "./calendar-events";
import {
  isStaticModelProviderOnlyRegistration,
  normalizePluginSidecarDiagnosticsRetentionLines,
  retainNewestPluginSidecarDiagnostics,
  shouldRequireCompleteSettingsForSidecarOperation,
} from "./sidecar-capability-seams";
import { ensurePluginDataRootForActivation } from "./data";
import {
  buildPluginAgentToolSidecarRequest,
  buildPluginCronSidecarRequest,
  buildPluginGcSidecarRequest,
  createPluginPreDispatchCancellationError,
  diagnosticCodeForUnknown,
  diagnosticMessageForUnknown,
  errorMessageForUnknown,
  findPluginCronExecutionSession,
  listPluginAgentToolRegistrationsForThread,
  mapPluginGcSidecarFailure,
  missingRequiredPluginSettingsMessage,
  normalizePluginCallbackTimeoutMs,
  pluginOperationCancellationRejection,
  pluginOperationTimeoutRejection,
  pluginRuntimeSettingsForStartup,
  pluginSettingsDeclarations,
  PluginSidecarToolCallError,
  shouldRetainPluginOperationFailureDiagnostic,
  type PluginAgentToolContext,
  type PluginAgentToolRegistrationForThread,
  type PluginCapabilitySidecarRequest,
} from "./execution-capability";
import type { PluginEmbeddingHost } from "./embeddings";
import { executePluginEmbeddingRequest } from "./embedding-capability";
import {
  assertRequiredPluginEnvCaptured,
  capturePluginEnvironment,
  type PluginCapturedEnvVar,
  PluginEnvCaptureError,
} from "./env";
import { isReservedPluginDisplayName, isReservedPluginId } from "./identity";
import type {
  PluginIngressPollResult,
  PluginIngressResponseContext,
} from "./ingress";
import type { PluginIngressBatchThreadHost } from "./ingress-batch-processor";
import type { PluginIngressPollScheduler } from "./ingress-poll-scheduler";
import {
  buildPluginIngressPollSidecarRequest,
  buildPluginIngressPromptTemplateSidecarRequest,
  buildPluginIngressResponseSidecarRequest,
  PluginIngressCapability,
  type PluginIngressCapabilityPollFailure,
  type PluginIngressPollFailureTelemetryEvent,
} from "./ingress-capability";
import {
  buildPluginInventoryWithLifecycle,
  computePluginReviewHash,
  recordPluginRuntimeActivation,
  recordPluginRuntimeFailure,
} from "./lifecycle";
import { executePluginLogOperation, PLUGIN_LOG_WRITE_PERMISSION } from "./log";
import type { PluginModelProviderRegistration } from "./model-providers";
import {
  buildPluginModelProviderEmbeddingRequest,
  buildPluginModelProviderExecutionRequest,
  buildPluginOAuthProviderImportRequest,
  buildPluginOAuthProviderRefreshRequest,
  createPluginModelProviderRefreshState,
  createPluginModelProviderRefreshStatesFromRegistrations,
  listPluginModelProviderRegistrationsForSessions,
  listPluginOAuthProviderRegistrationsForSessions,
  listPluginPiAuthBindingsForSessions,
  modelProviderRefreshesDue,
  normalizePluginOAuthCredential,
  normalizeRefreshedPluginModelProviderConfigurations,
  type PluginModelProviderRefreshState,
  type PluginOAuthCredential,
  registerPluginOAuthProviderRegistrations,
  resolvePluginModelProviderRuntimeApiKeysForSessions,
} from "./model-provider-capability";
import {
  dispatchPluginNotificationProvidersForSessions,
  type PluginNotificationProviderInvocation,
} from "./notification-capability";
import {
  type PluginNotificationDeliveryControls,
  type PluginNotificationReceipt,
  type PluginNotificationSendInput,
  type PluginNotificationSendResult,
  sendPluginNotificationThroughUserOutlets,
} from "./notifications";
import {
  buildPluginPromptInjectionSidecarRequest,
  listPluginPromptInjectionRegistrationsForThread,
  normalizePluginPromptInjectionResult,
  type PluginPromptInjectionContext,
  type PluginPromptInjectionRegistrationForThread,
} from "./prompt-injection-capability";
import { closePluginSqliteConnections } from "./sqlite";
import { readPluginSettingsForRuntime } from "./settings";
import {
  createDefaultPluginSidecarProcess,
  createWorkerPluginSidecarProcess,
  DEFAULT_PLUGIN_SIDECAR_MEMORY_LIMIT_BYTES,
  readTextLines,
  resolvePluginSidecarRuntimeKind,
  type PluginSidecarProcess,
  type PluginSidecarRuntimeKind,
  type PluginSidecarSpawnInput,
  writeSidecarFrame,
} from "./sidecar-runtime";
import {
  createPluginHostErrorFrame,
  createPluginHostResponseFrame,
} from "./sidecar-host-framing";
import { handlePluginSidecarHostRequest } from "./sidecar-host-router";
import {
  decodePluginSidecarRpcEnvelope,
  encodePluginSidecarRpcEnvelope,
  PLUGIN_SIDECAR_RPC_PROTOCOL_VERSION,
  type PluginSidecarHostRequestEnvelope,
  type PluginSidecarInboundEnvelope,
  type PluginSidecarProtocolError,
  type PluginSidecarShutdownPayload,
  type PluginSidecarStartupSettingsPayload,
} from "./sidecar-rpc";
import {
  type PluginStartupOAuthProviderRegistration,
  type PluginStartupRegistrations,
  validatePluginStartupRegistrations,
} from "./startup-registrations";
import {
  PluginTerminalError,
  type PluginTerminalHost,
  type PluginTerminalThreadContext,
} from "./terminal";
import { PluginWebSocketRegistry } from "./websocket";

export {
  PLUGIN_SIDECAR_CALLBACK_TIMEOUT_MAX_MS,
  PLUGIN_SIDECAR_CALLBACK_TIMEOUT_MIN_MS,
  PLUGIN_SIDECAR_TOOL_FAILURE_MESSAGE,
  PLUGIN_SIDECAR_UNAVAILABLE_TOOL_FAILURE_MESSAGE,
} from "./execution-capability";
export {
  buildDefaultPluginSidecarCommand,
  DEFAULT_PLUGIN_QUICKJS_MEMORY_LIMIT_BYTES,
  DEFAULT_PLUGIN_SIDECAR_MEMORY_LIMIT_BYTES,
  resolvePluginSidecarRuntimeKind,
  type PluginSidecarRuntimeKind,
} from "./sidecar-runtime";

type PluginUserRecord = {
  createdAt: string;
  displayName: string | null;
  email: string | null;
  enabled: boolean;
  id: number;
  isAdmin: boolean;
  updatedAt: string;
  username: string;
};

type PluginUsersHost = {
  getUser(
    userId: number,
  ): Promise<PluginUserRecord | null> | PluginUserRecord | null;
  isUserAdmin(userId: number): Promise<boolean> | boolean;
  listUsers():
    | Promise<readonly PluginUserRecord[]>
    | readonly PluginUserRecord[];
  resetUserOtp(userId: number): Promise<void> | void;
  updateUser(
    userId: number,
    patch: {
      displayName?: string | null;
      email?: string | null;
      enabled?: boolean;
    },
  ): Promise<PluginUserRecord> | PluginUserRecord;
};

const DEFAULT_PLUGIN_SIDECAR_STARTUP_TIMEOUT_MS = 60_000;
const DEFAULT_PLUGIN_SIDECAR_SHUTDOWN_GRACE_MS = 1_000;
export const DEFAULT_PLUGIN_SIDECAR_WRITE_TIMEOUT_MS = 5_000;
export const PLUGIN_SIDECAR_CRASH_LOOP_THRESHOLD = 3;
export const PLUGIN_SIDECAR_CRASH_LOOP_WINDOW_MS = 60_000;
export const DEFAULT_PLUGIN_SIDECAR_STDERR_RETAINED_LINES = 200;
export const PLUGIN_SIDECAR_STDERR_LINE_MAX_CHARS = 16 * 1024;
export const PLUGIN_SIDECAR_STDOUT_LINE_MAX_CHARS = 8 * 1024 * 1024;
export const PLUGIN_SIDECAR_MAX_IN_FLIGHT_REQUESTS = 64;
export const PLUGIN_SIDECAR_MAX_CONCURRENT_HOST_REQUESTS = 64;
export const PLUGIN_SIDECAR_MAX_QUEUED_WRITES = 128;
const PLUGIN_UNSAFE_PRIVATE_NETWORK_ALLOWLIST_ENV =
  "METIDOS_PLUGIN_UNSAFE_PRIVATE_NETWORK_PLUGINS";

function assertRealPluginDirectory(
  plugin: RpcPluginInventoryPlugin,
): RpcPluginInventoryPlugin {
  const stats = lstatSync(plugin.folderPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(
      `Refusing to start plugin ${plugin.directoryName} because its plugin root is not a real directory: ${plugin.folderPath}`,
    );
  }
  return {
    ...plugin,
    folderPath: realpathSync(plugin.folderPath),
  };
}

function unsafePrivateNetworkAllowlist(): Set<string> {
  return new Set(
    (
      globalThis.process?.env?.[PLUGIN_UNSAFE_PRIVATE_NETWORK_ALLOWLIST_ENV] ??
      ""
    )
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function pluginMatchesUnsafePrivateNetworkAllowlist(
  plugin: RpcPluginInventoryPlugin,
  allowlist: ReadonlySet<string>,
): boolean {
  return (
    allowlist.has(plugin.directoryName) ||
    (plugin.pluginId !== null && allowlist.has(plugin.pluginId))
  );
}

type PluginSidecarStartFailure = {
  directoryName: string;
  message: string;
  pluginId: string | null;
};

type PluginSidecarStartSuccess = {
  directoryName: string;
  pluginId: string;
  processId: number | null;
  registrations: PluginStartupRegistrations;
};

type PluginSidecarStartSkipped = {
  directoryName: string;
  pluginId: string | null;
  reason: string;
  status: RpcPluginInventoryPlugin["status"];
};

export type PluginSidecarManagerStartResult = {
  failed: PluginSidecarStartFailure[];
  skipped: PluginSidecarStartSkipped[];
  started: PluginSidecarStartSuccess[];
};

type PluginSidecarManagerLogger = Pick<
  LogSubsystem,
  "error" | "info" | "warning"
>;

type PluginSidecarInFlightOperation = {
  abortHandler?: (() => void) | undefined;
  context: unknown | null;
  deadlineMs: number;
  operation: string;
  reject: (error: PluginSidecarToolCallError) => void;
  resolve: (value: unknown) => void;
  signal?: AbortSignal | undefined;
  timer: ReturnType<typeof setTimeout>;
};

type PluginSidecarShutdownReason = PluginSidecarShutdownPayload["reason"];

type PluginCronHandle = {
  stop: () => unknown;
};

type PluginSidecarSession = {
  capturedEnv: PluginCapturedEnvVar[];
  cronHandles: Map<string, PluginCronHandle>;
  directoryName: string;
  hostRequests: Set<string>;
  inFlight: Map<string, PluginSidecarInFlightOperation>;
  ingressSourceIds: Set<string>;
  missingRequiredSettings: string[];
  modelProviderRefreshState: Map<string, PluginModelProviderRefreshState>;
  plugin: RpcPluginInventoryPlugin;
  process: PluginSidecarProcess;
  ready: boolean;
  registrations: PluginStartupRegistrations | null;
  settingsFingerprint: string;
  startupSettled: boolean;
  webSockets: PluginWebSocketRegistry;
  stopping: boolean;
  writeQueue: Promise<void>;
  writeQueueDepth: number;
};

type CachedModelProviderSession = {
  capturedEnv: PluginCapturedEnvVar[];
  directoryName: string;
  settingsFingerprint: string;
  modelProviderRefreshState: Map<string, PluginModelProviderRefreshState>;
  plugin: RpcPluginInventoryPlugin;
  registrations: PluginStartupRegistrations;
  reviewHash: string;
};

export type PluginSidecarStderrTelemetryEvent = {
  directoryName: string;
  lineLength: number;
  observedAt: string;
  pluginId: string;
  retainedLineCount: number;
  type: "stderr_line";
};

export type PluginSidecarTelemetryEvent =
  | PluginSidecarStderrTelemetryEvent
  | PluginIngressPollFailureTelemetryEvent;

type PluginSidecarDiagnosticsRecord = {
  directoryName: string;
  failures: RpcPluginSidecarFailureDiagnostic[];
  lines: RpcPluginSidecarStderrLine[];
  pluginId: string | null;
  pluginSnapshot: RpcPluginInventoryPlugin | null;
  telemetryEnabled: boolean | null;
};

type PluginSidecarCrashLoopUpdate = {
  crashCount: number;
  thresholdReached: boolean;
};

export type PluginNotificationSender = (
  input: PluginNotificationSendInput,
  controls?: PluginNotificationDeliveryControls,
) => Promise<PluginNotificationSendResult>;

function toPluginUserRecord(
  user: NonNullable<ReturnType<typeof getUserById>>,
): PluginUserRecord {
  return {
    createdAt: user.createdAt,
    displayName: user.displayName,
    email: user.email,
    enabled: user.enabled,
    id: user.id,
    isAdmin: user.isAdmin,
    updatedAt: user.updatedAt,
    username: user.username,
  };
}

function createDefaultPluginUsersHost(): PluginUsersHost {
  return {
    getUser: (userId) => {
      const user = getUserById(initAppDatabase(), userId);
      return user ? toPluginUserRecord(user) : null;
    },
    isUserAdmin: (userId) =>
      getUserById(initAppDatabase(), userId)?.isAdmin === true,
    listUsers: () => listUsers(initAppDatabase()).map(toPluginUserRecord),
    resetUserOtp: (userId) => {
      resetUserOtpEnrollment(initAppDatabase(), userId);
    },
    updateUser: (userId, patch) =>
      toPluginUserRecord(updateUserProfile(initAppDatabase(), userId, patch)),
  };
}

function pluginTerminalAccessScope(
  context: PluginTerminalThreadContext,
): TerminalAccessScope {
  return {
    createdFromThreadId: context.threadId,
    ownerSessionId: terminalOwnerSessionKeyForThread(context.threadId),
  };
}

function createDefaultPluginTerminalHost(): PluginTerminalHost {
  return {
    createTerminal: (context, request) => {
      const database = initAppDatabase();
      const project = getProjectById(database, context.projectId);
      if (!project) {
        throw new PluginTerminalError({
          code: "plugin_context_error",
          message: "Plugin terminal create requires a current project context.",
        });
      }
      return terminalManager.createTerminal({
        command: request.command ?? null,
        createdFromThreadId: context.threadId,
        dir: request.dir ?? null,
        ownerSessionId: terminalOwnerSessionKeyForThread(context.threadId),
        projectId: context.projectId,
        projectName: project.name,
        settings: getTerminalSettings(database),
        title: request.title ?? null,
        worktreePath: context.worktreePath,
      });
    },
    grepTerminal: (context, request) =>
      terminalManager.grepTerminal(
        request.terminalIndex,
        request.pattern,
        request.ignoreCase ?? false,
        request.maxMatches ?? 20,
        pluginTerminalAccessScope(context),
      ),
    killTerminal: (context, request) => {
      terminalManager.killTerminalByIndex(
        request.terminalIndex,
        pluginTerminalAccessScope(context),
      );
    },
    readTerminal: (context, request) =>
      terminalManager.viewTerminal(
        request.terminalIndex,
        request.lineOffset ?? 0,
        request.lineCount ?? 200,
        pluginTerminalAccessScope(context),
      ),
  };
}

function createDefaultPluginCalendarEventsHost(): PluginCalendarEventsHost {
  return {
    createCalendar: (userId, params) =>
      createCalendar(
        initAppDatabase(),
        userId,
        params as Parameters<typeof createCalendar>[2],
      ),
    createEvent: (userId, params) =>
      createCalendarEvent(initAppDatabase(), userId, params),
    deleteCalendar: (userId, calendarId) => {
      deleteCalendar(initAppDatabase(), userId, calendarId);
      return { calendarId, success: true };
    },
    deleteEvent: (userId, params) => {
      deleteCalendarEvent(initAppDatabase(), userId, params.eventId, params);
      return { eventId: params.eventId, success: true };
    },
    getEvent: (userId, eventId) =>
      getCalendarEvent(initAppDatabase(), userId, eventId),
    listCalendars: (userId, params) => {
      const bootstrap = getCalendarBootstrap(initAppDatabase(), userId);
      return params?.includeExternal
        ? [...bootstrap.calendars, ...bootstrap.externalCalendars]
        : bootstrap.calendars;
    },
    listEvents: (userId, params) =>
      listCalendarOccurrences(
        initAppDatabase(),
        userId,
        params.start,
        params.end,
        { maxOccurrences: MAX_CALENDAR_OCCURRENCES_PER_REQUEST },
      ),
    updateCalendar: (userId, calendarId, params) =>
      updateCalendar(initAppDatabase(), userId, calendarId, params),
    updateEvent: (userId, params) =>
      updateCalendarEvent(initAppDatabase(), userId, params),
  };
}

export type PluginSidecarProcessManagerOptions = AppDataPathOptions & {
  buildInventory?: (options: AppDataPathOptions) => Promise<RpcPluginInventory>;
  diagnosticsRetentionLines?: number;
  environment?: Record<string, string | undefined>;
  logger?: PluginSidecarManagerLogger;
  markRuntimeActivated?: (input: { directoryName: string }) => Promise<void>;
  markRuntimeFailure?: (input: {
    crashCount?: number;
    crashLoopThresholdReached?: boolean;
    directoryName: string;
    message: string;
  }) => Promise<void>;
  now?: () => Date;
  calendarEventsHost?: PluginCalendarEventsHost;
  terminalHost?: PluginTerminalHost;
  usersHost?: PluginUsersHost;
  ingressPollScheduler?: PluginIngressPollScheduler;
  ingressThreadHost?: PluginIngressBatchThreadHost | null;
  onModelProviderCatalogChanged?: (event: {
    configurationCount: number;
    directoryName: string;
    durationMs: number;
    modelCount: number;
    providerId: string;
    success: boolean;
  }) => void;
  reportSidecarTelemetry?: (event: PluginSidecarTelemetryEvent) => void;
  sendNotification?: PluginNotificationSender;
  writeHostStderr?: (text: string) => void;
  sidecarMemoryLimitBytes?: number;
  runtimeKind?: PluginSidecarRuntimeKind;
  spawnSidecar?: (input: PluginSidecarSpawnInput) => PluginSidecarProcess;
  startupTimeoutMs?: number;
  sidecarWriteTimeoutMs?: number;
};

export type PluginSidecarRequestOptions = PluginCapabilitySidecarRequest;

export type { PluginAgentToolContext } from "./execution-capability";
export type {
  PluginPromptInjectionContext,
  PluginPromptInjectionRegistrationForThread,
} from "./prompt-injection-capability";

export type PluginModelProviderExecutionContext = {
  contextKind: "providerExecution";
  ownerUserId?: number | null;
  projectId: number;
  threadId: number;
  worktreePath: string;
};

export type { PluginCronExecutionContext } from "./execution-capability";

export type PluginModelProviderExecutionInput = {
  configuration: Record<string, unknown>;
  configurationId: string;
  context: PluginModelProviderExecutionContext;
  model: Record<string, unknown>;
  modelContext: Record<string, unknown>;
  options?: Record<string, unknown> | undefined;
  pluginId: string;
  providerId: string;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | null | undefined;
};

export type PluginModelProviderEmbeddingInput = {
  context: PluginModelProviderExecutionContext;
  input: unknown;
  model: Record<string, unknown>;
  options?: unknown;
  registration: PluginModelProviderRegistration;
};

export type { PluginAgentToolRegistrationForThread } from "./execution-capability";
export { PluginSidecarToolCallError } from "./execution-capability";

function isSidecarInboundEnvelope(
  envelope: unknown,
): envelope is PluginSidecarInboundEnvelope {
  return (
    typeof envelope === "object" &&
    envelope !== null &&
    "type" in envelope &&
    typeof envelope.type === "string" &&
    envelope.type.startsWith("sidecar.")
  );
}

function protocolErrorMessage(error: PluginSidecarProtocolError): string {
  return `${error.code}: ${error.message}`;
}

function normalizeExitCode(value: number | unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : -1;
}

function sidecarExitDescription(exitCode: number): string {
  if (exitCode === 133) {
    return "code 133 (SIGTRAP/trace trap). This commonly indicates the Bun sidecar crashed before it could emit diagnostics, often because the sidecar process memory limit is too low.";
  }
  if (exitCode > 128) {
    return `code ${exitCode} (signal ${exitCode - 128})`;
  }
  return `code ${exitCode}`;
}

function timerPromise(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);
    timer.unref?.();
  });
}

function normalizeSidecarWriteTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
    return DEFAULT_PLUGIN_SIDECAR_WRITE_TIMEOUT_MS;
  }
  return Math.max(1, Math.trunc(timeoutMs));
}

function removeAbortHandler(
  signal: AbortSignal | undefined,
  handler: (() => void) | undefined,
): void {
  if (signal && handler) {
    signal.removeEventListener("abort", handler);
  }
}

function pluginStartupCacheFingerprint(value: unknown): string {
  const stableValue = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map(stableValue);
    }
    if (isRecord(input)) {
      return Object.fromEntries(
        Object.entries(input)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nestedValue]) => [key, stableValue(nestedValue)]),
      );
    }
    return input;
  };
  return JSON.stringify(stableValue(value)) ?? "null";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEligibleActivePlugin(
  plugin: RpcPluginInventoryPlugin,
): string | null {
  if (plugin.status !== "active") {
    return `Plugin status is ${plugin.status}.`;
  }
  if (!plugin.pluginId) {
    return "Plugin manifest did not resolve a valid plugin id.";
  }
  if (isReservedPluginId(plugin.pluginId)) {
    return "Plugin id is reserved for Metidos-native permissions.";
  }
  if (plugin.name && isReservedPluginDisplayName(plugin.name)) {
    return "Plugin display name is reserved for the host application.";
  }
  if (!plugin.approvedReviewHash || !plugin.currentReviewHash) {
    return "Plugin does not have approved and current review hashes.";
  }
  if (plugin.approvedReviewHash !== plugin.currentReviewHash) {
    return "Plugin files differ from the approved review hash.";
  }
  if (plugin.validationErrors.length > 0 || !plugin.structurallyValid) {
    return "Plugin validation errors block runtime startup.";
  }
  return null;
}

function pluginAdminActionPath(
  plugin: RpcPluginInventoryPlugin,
  actionName: "open_data" | "open_logs",
): string | null {
  return (
    plugin.adminActions.find((action) => action.action === actionName)?.path ??
    null
  );
}

function createDiagnosticsRecord(
  plugin: RpcPluginInventoryPlugin,
): PluginSidecarDiagnosticsRecord {
  return {
    directoryName: plugin.directoryName,
    failures: [],
    lines: [],
    pluginId: plugin.pluginId,
    pluginSnapshot: plugin,
    telemetryEnabled: plugin.manifest.telemetry,
  };
}

export class PluginSidecarProcessManager {
  private readonly appDataOptions: AppDataPathOptions;
  private readonly buildInventory: (
    options: AppDataPathOptions,
  ) => Promise<RpcPluginInventory>;
  // Crash-loop counters are process-local by design: persisted plugin lifecycle
  // state records startup failures for operators, while this short sliding
  // window only prevents one running backend from tight-looping restarts.
  private readonly crashTimestampsByDirectoryName = new Map<string, number[]>();
  private readonly diagnosticsByDirectoryName = new Map<
    string,
    PluginSidecarDiagnosticsRecord
  >();
  private readonly diagnosticsRetentionLines: number;
  private readonly environment: Record<string, string | undefined>;
  private readonly logger: PluginSidecarManagerLogger;
  private readonly ingressCapability: PluginIngressCapability<PluginSidecarSession>;
  private readonly markRuntimeActivated: (input: {
    directoryName: string;
  }) => Promise<void>;
  private readonly markRuntimeFailure: (input: {
    crashCount?: number;
    crashLoopThresholdReached?: boolean;
    directoryName: string;
    message: string;
  }) => Promise<void>;
  private readonly calendarEventsHost: PluginCalendarEventsHost;
  private readonly terminalHost: PluginTerminalHost;
  private readonly usersHost: PluginUsersHost;
  private readonly now: () => Date;
  private readonly onModelProviderCatalogChanged: NonNullable<
    PluginSidecarProcessManagerOptions["onModelProviderCatalogChanged"]
  >;
  private readonly reportSidecarTelemetry: (
    event: PluginSidecarTelemetryEvent,
  ) => void;
  private readonly sendNotification: PluginNotificationSender;
  private readonly writeHostStderr: (text: string) => void;
  private requestSequence = 0;
  // One cached model-provider snapshot per plugin directory. startApprovedPlugins
  // prunes entries for directories no longer present in the inventory before
  // reuse, so the cache is bounded by discovered plugin directories.
  private readonly cachedModelProviderSessions = new Map<
    string,
    CachedModelProviderSession
  >();
  private readonly runtimeKind: PluginSidecarRuntimeKind;
  private readonly sidecarMemoryLimitBytes: number;
  private readonly sessions = new Map<string, PluginSidecarSession>();
  private readonly spawnSidecar: (
    input: PluginSidecarSpawnInput,
  ) => PluginSidecarProcess;
  private readonly startupTimeoutMs: number;
  private readonly sidecarWriteTimeoutMs: number;

  constructor(options: PluginSidecarProcessManagerOptions = {}) {
    this.appDataOptions =
      options.appDataDir === undefined
        ? {}
        : { appDataDir: options.appDataDir };
    this.buildInventory =
      options.buildInventory ??
      ((appDataOptions) => buildPluginInventoryWithLifecycle(appDataOptions));
    this.diagnosticsRetentionLines =
      normalizePluginSidecarDiagnosticsRetentionLines(
        options.diagnosticsRetentionLines,
        DEFAULT_PLUGIN_SIDECAR_STDERR_RETAINED_LINES,
      );
    this.environment = options.environment ?? process.env;
    this.logger = options.logger ?? createSubsystemLogger("plugin-sidecars");
    this.ingressCapability = new PluginIngressCapability({
      database: () => initAppDatabase(),
      ...(options.ingressPollScheduler
        ? { ingressPollScheduler: options.ingressPollScheduler }
        : {}),
      ingressThreadHost: options.ingressThreadHost ?? null,
      logger: this.logger,
      now: () => this.now(),
      operations: {
        findReadySession: (input) => this.findReadySession(input),
        invokePoll: async (input) => {
          const result = await this.invokeSidecarRequest(
            buildPluginIngressPollSidecarRequest({
              context: input.context,
              directoryName: input.session.directoryName,
              source: input.source,
            }),
          );
          return result as PluginIngressPollResult;
        },
        invokePromptTemplate: async (input) => {
          const result = await this.invokeSidecarRequest(
            buildPluginIngressPromptTemplateSidecarRequest({
              context: input.context,
              directoryName: input.session.directoryName,
              source: input.source,
            }),
          );
          return typeof result === "string" ? result : "";
        },
        invokeResponse: async (input) => {
          await this.invokeSidecarRequest(
            buildPluginIngressResponseSidecarRequest({
              context: input.context,
              directoryName: input.session.directoryName,
              payload: input.payload,
              ...(input.signal ? { signal: input.signal } : {}),
              source: input.source,
            }),
          );
        },
        onPollFailure: (input) => this.handleIngressPollFailure(input),
      },
      sendNotification: (request, controls) =>
        this.sendNotification(request, controls),
    });
    this.markRuntimeActivated =
      options.markRuntimeActivated ??
      ((input) =>
        recordPluginRuntimeActivation(input.directoryName, {
          ...this.appDataOptions,
        }));
    this.markRuntimeFailure =
      options.markRuntimeFailure ??
      ((input) =>
        recordPluginRuntimeFailure(input.directoryName, input.message, {
          ...this.appDataOptions,
          ...(input.crashCount === undefined
            ? {}
            : { crashCount: input.crashCount }),
          ...(input.crashLoopThresholdReached === undefined
            ? {}
            : { crashLoopThresholdReached: input.crashLoopThresholdReached }),
        }));
    this.calendarEventsHost =
      options.calendarEventsHost ?? createDefaultPluginCalendarEventsHost();
    this.terminalHost =
      options.terminalHost ?? createDefaultPluginTerminalHost();
    this.usersHost = options.usersHost ?? createDefaultPluginUsersHost();
    this.now = options.now ?? (() => new Date());
    this.onModelProviderCatalogChanged =
      options.onModelProviderCatalogChanged ?? (() => {});
    this.reportSidecarTelemetry = options.reportSidecarTelemetry ?? (() => {});
    this.sendNotification =
      options.sendNotification ??
      ((request, controls) =>
        sendPluginNotificationThroughUserOutlets({
          controls: {
            ...(controls ?? {}),
            providerDispatcher:
              controls?.providerDispatcher ??
              ((providerInput) =>
                this.dispatchPluginNotificationProviders(providerInput)),
          },
          database: initAppDatabase(),
          request,
        }));
    this.writeHostStderr =
      options.writeHostStderr ?? ((text) => process.stderr.write(`${text}\n`));
    this.runtimeKind = options.runtimeKind ?? resolvePluginSidecarRuntimeKind();
    this.sidecarMemoryLimitBytes =
      options.sidecarMemoryLimitBytes ??
      DEFAULT_PLUGIN_SIDECAR_MEMORY_LIMIT_BYTES;
    this.spawnSidecar =
      options.spawnSidecar ??
      ((input) => {
        const spawnInput = {
          ...input,
          memoryLimitBytes: this.sidecarMemoryLimitBytes,
        };
        return this.runtimeKind === "process"
          ? createDefaultPluginSidecarProcess(spawnInput)
          : createWorkerPluginSidecarProcess(spawnInput);
      });
    this.startupTimeoutMs =
      options.startupTimeoutMs ?? DEFAULT_PLUGIN_SIDECAR_STARTUP_TIMEOUT_MS;
    this.sidecarWriteTimeoutMs = normalizeSidecarWriteTimeoutMs(
      options.sidecarWriteTimeoutMs,
    );
  }

  async startApprovedPlugins(
    inventory?: RpcPluginInventory,
  ): Promise<PluginSidecarManagerStartResult> {
    inventory ??= await this.buildInventory(this.appDataOptions);
    const failed: PluginSidecarStartFailure[] = [];
    const skipped: PluginSidecarStartSkipped[] = [];
    const started: PluginSidecarStartSuccess[] = [];

    const activeDirectoryNames = new Set(
      inventory.plugins.map((plugin) => plugin.directoryName),
    );
    for (const directoryName of this.cachedModelProviderSessions.keys()) {
      if (!activeDirectoryNames.has(directoryName)) {
        this.cachedModelProviderSessions.delete(directoryName);
      }
    }

    const pluginIdCounts = new Map<string, number>();
    for (const plugin of inventory.plugins) {
      if (!plugin.pluginId) {
        continue;
      }
      pluginIdCounts.set(
        plugin.pluginId,
        (pluginIdCounts.get(plugin.pluginId) ?? 0) + 1,
      );
    }

    for (const plugin of inventory.plugins.sort((left, right) =>
      left.directoryName.localeCompare(right.directoryName),
    )) {
      const duplicatePluginId =
        plugin.pluginId && (pluginIdCounts.get(plugin.pluginId) ?? 0) > 1;
      const skipReason = duplicatePluginId
        ? "Plugin id is duplicated by another plugin."
        : isEligibleActivePlugin(plugin);
      if (skipReason) {
        skipped.push({
          directoryName: plugin.directoryName,
          pluginId: plugin.pluginId,
          reason: skipReason,
          status: plugin.status,
        });
        if (plugin.pluginId) {
          this.ingressCapability.removePlugin(plugin.pluginId);
        }
        this.cachedModelProviderSessions.delete(plugin.directoryName);
        const ineligibleSession = this.sessions.get(plugin.directoryName);
        if (ineligibleSession) {
          await this.stopSession(ineligibleSession, "plugin_disabled");
        }
        continue;
      }
      const reviewHash = plugin.approvedReviewHash;
      if (!plugin.pluginId || !reviewHash) {
        this.cachedModelProviderSessions.delete(plugin.directoryName);
        continue;
      }
      const cachedSession = this.cachedModelProviderSessions.get(
        plugin.directoryName,
      );
      if (cachedSession) {
        let cacheStillCurrent = false;
        try {
          const capturedEnv = capturePluginEnvironment(
            plugin.manifest.env,
            this.environment,
          );
          const settings = await readPluginSettingsForRuntime({
            declarations: pluginSettingsDeclarations(plugin),
            directoryName: plugin.directoryName,
            options: this.appDataOptions,
          });
          cacheStillCurrent =
            cachedSession.plugin.pluginId === plugin.pluginId &&
            cachedSession.reviewHash === reviewHash &&
            pluginStartupCacheFingerprint(cachedSession.capturedEnv) ===
              pluginStartupCacheFingerprint(capturedEnv) &&
            cachedSession.settingsFingerprint ===
              pluginStartupCacheFingerprint(settings);
        } catch {
          cacheStillCurrent = false;
        }
        if (cacheStillCurrent) {
          started.push({
            directoryName: plugin.directoryName,
            pluginId: plugin.pluginId,
            processId: null,
            registrations: cachedSession.registrations,
          });
          continue;
        }
        this.cachedModelProviderSessions.delete(plugin.directoryName);
      }
      const existingSession = this.sessions.get(plugin.directoryName);
      if (existingSession) {
        let existingSessionCurrent = false;
        if (existingSession.plugin.approvedReviewHash === reviewHash) {
          try {
            const capturedEnv = capturePluginEnvironment(
              plugin.manifest.env,
              this.environment,
            );
            const settings = await readPluginSettingsForRuntime({
              declarations: pluginSettingsDeclarations(plugin),
              directoryName: plugin.directoryName,
              options: this.appDataOptions,
            });
            existingSessionCurrent =
              existingSession.plugin.pluginId === plugin.pluginId &&
              pluginStartupCacheFingerprint(existingSession.capturedEnv) ===
                pluginStartupCacheFingerprint(capturedEnv) &&
              existingSession.settingsFingerprint ===
                pluginStartupCacheFingerprint(settings);
          } catch {
            existingSessionCurrent = false;
          }
        }
        if (existingSessionCurrent) {
          this.registerSessionIngressSources(existingSession);
          started.push({
            directoryName: plugin.directoryName,
            pluginId: plugin.pluginId,
            processId: existingSession.process.pid ?? null,
            registrations: existingSession.registrations ?? {
              crons: [],
              gc: null,
              ingressSources: [],
              modelProviders: [],
              notificationProviders: [],
              oauthProviders: [],
              injections: [],
              tools: [],
            },
          });
          continue;
        }
        await this.stopSession(existingSession, "plugin_retry");
      }

      const result = await this.startPlugin(plugin, reviewHash).catch(
        async (error: unknown): Promise<PluginSidecarStartFailure> => {
          const message =
            error instanceof Error ? error.message : String(error);
          this.recordStartupDiagnostic(plugin, message);
          await this.recordStartupFailure(plugin.directoryName, message);
          return {
            directoryName: plugin.directoryName,
            message,
            pluginId: plugin.pluginId,
          };
        },
      );
      if ("message" in result) {
        failed.push(result);
      } else {
        started.push(result);
      }
    }

    return { failed, skipped, started };
  }

  async stopAll(reason: PluginSidecarShutdownReason = "host_shutdown") {
    const sessions = [...this.sessions.values()];
    this.cachedModelProviderSessions.clear();
    await Promise.all(
      sessions.map((session) => this.stopSession(session, reason)),
    );
  }

  async stopPlugin(
    directoryName: string,
    reason: PluginSidecarShutdownReason = "plugin_reset",
  ): Promise<boolean> {
    this.cachedModelProviderSessions.delete(directoryName);
    const existingSession = this.sessions.get(directoryName);
    if (!existingSession) {
      return false;
    }
    await this.stopSession(existingSession, reason);
    return true;
  }

  async retryPlugin(
    directoryName: string,
  ): Promise<PluginSidecarManagerStartResult> {
    this.crashTimestampsByDirectoryName.delete(directoryName);
    this.cachedModelProviderSessions.delete(directoryName);
    const existingSession = this.sessions.get(directoryName);
    if (existingSession) {
      await this.stopSession(existingSession, "plugin_retry");
    }
    return await this.startApprovedPlugins();
  }

  getDiagnostics(
    options: { directoryName?: string; pluginId?: string } = {},
  ): RpcPluginSidecarDiagnostics[] {
    return [...this.diagnosticsByDirectoryName.values()]
      .filter(
        (record) =>
          (options.directoryName === undefined ||
            record.directoryName === options.directoryName) &&
          (options.pluginId === undefined ||
            record.pluginId === options.pluginId),
      )
      .sort((left, right) =>
        left.directoryName.localeCompare(right.directoryName),
      )
      .map((record) => {
        const plugin = record.pluginSnapshot;
        return {
          directoryName: record.directoryName,
          failures: {
            items: [...record.failures],
            limit: this.diagnosticsRetentionLines,
            retainedCount: record.failures.length,
          },
          paths: {
            dataPath: plugin
              ? pluginAdminActionPath(plugin, "open_data")
              : null,
            folderPath: plugin?.folderPath ?? null,
            logsPath: plugin
              ? pluginAdminActionPath(plugin, "open_logs")
              : null,
          },
          pluginId: record.pluginId,
          quota: plugin
            ? {
                settings: plugin.lifecycle.settings.quota,
                usage: plugin.dataUsage,
              }
            : null,
          review: {
            approvedReviewHash: plugin?.approvedReviewHash ?? null,
            currentReviewHash: plugin?.currentReviewHash ?? null,
            lifecycleMessage: plugin?.lifecycleMessage ?? null,
            lifecycleState: plugin?.lifecycle.state ?? null,
            status: plugin?.status ?? null,
          },
          stderr: {
            limit: this.diagnosticsRetentionLines,
            lines: [...record.lines],
            retainedLineCount: record.lines.length,
          },
          telemetryEnabled: record.telemetryEnabled,
        };
      });
  }

  async pollIngressSourceNow(
    pluginId: string,
    sourceId: string,
  ): Promise<void> {
    await this.ingressCapability.pollSourceNow(pluginId, sourceId);
  }

  refreshPluginModelProviderRegistrationsIfDue(now = Date.now()): void {
    for (const refresh of modelProviderRefreshesDue({
      now,
      sessions: this.sessions.values(),
    })) {
      const state =
        refresh.session.modelProviderRefreshState.get(refresh.providerId) ??
        createPluginModelProviderRefreshState();
      refresh.session.modelProviderRefreshState.set(refresh.providerId, {
        ...state,
        inFlight: true,
        lastAttemptedAt: now,
      });
      void this.refreshPluginModelProviderRegistration(
        refresh.session,
        refresh.providerId,
      );
    }
  }

  async refreshPluginModelProviderRegistrations(): Promise<void> {
    const refreshes: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      if (!session.ready || session.stopping || !session.registrations) {
        continue;
      }
      for (const provider of session.registrations.modelProviders) {
        if (provider.getProviderConfigurationsHandle) {
          refreshes.push(
            this.refreshPluginModelProviderRegistration(session, provider.id),
          );
        }
      }
    }
    await Promise.all(refreshes);
  }

  private async refreshPluginModelProviderRegistration(
    session: PluginSidecarSession,
    providerId: string,
  ): Promise<void> {
    const provider = session.registrations?.modelProviders.find(
      (candidate) => candidate.id === providerId,
    );
    if (!provider?.getProviderConfigurationsHandle) {
      return;
    }
    const startedAt = Date.now();
    let refreshedConfigurationCount = 0;
    let refreshedModelCount = 0;
    let refreshSucceeded = false;
    const existingState = session.modelProviderRefreshState.get(
      provider.id,
    ) ?? {
      inFlight: false,
      lastAttemptedAt: null,
      lastError: null,
      lastSuccessfulAt: null,
    };
    session.modelProviderRefreshState.set(provider.id, {
      ...existingState,
      inFlight: true,
      lastAttemptedAt: startedAt,
    });
    try {
      const result = await this.invokeSidecarRequest({
        directoryName: session.directoryName,
        operation: "model.provider.refresh",
        params: {
          getProviderConfigurationsHandle:
            provider.getProviderConfigurationsHandle,
          providerId: provider.id,
        },
        ...(provider.timeoutMs === null
          ? {}
          : { timeoutMs: provider.timeoutMs }),
      });
      const configurations =
        normalizeRefreshedPluginModelProviderConfigurations(result);
      provider.configurations = configurations;
      refreshedConfigurationCount = configurations.length;
      refreshedModelCount = configurations.reduce((total, configuration) => {
        const models = configuration.value.models;
        return total + (Array.isArray(models) ? models.length : 0);
      }, 0);
      refreshSucceeded = true;
      session.modelProviderRefreshState.set(provider.id, {
        inFlight: false,
        lastAttemptedAt: startedAt,
        lastError: null,
        lastSuccessfulAt: Date.now(),
      });
    } catch (error) {
      session.modelProviderRefreshState.set(provider.id, {
        inFlight: false,
        lastAttemptedAt: startedAt,
        lastError: errorMessageForUnknown(error),
        lastSuccessfulAt: existingState.lastSuccessfulAt,
      });
    } finally {
      invalidateModelCatalogState();
      this.onModelProviderCatalogChanged({
        configurationCount: refreshedConfigurationCount,
        directoryName: session.directoryName,
        durationMs: Date.now() - startedAt,
        modelCount: refreshedModelCount,
        providerId: provider.id,
        success: refreshSucceeded,
      });
    }
  }

  listPluginModelProviderRegistrations(): PluginModelProviderRegistration[] {
    return listPluginModelProviderRegistrationsForSessions({
      sessions: [
        ...this.sessions.values(),
        ...this.cachedModelProviderSessions.values(),
      ],
    });
  }

  listPluginPiAuthBindings(): PiAuthPluginBinding[] {
    return listPluginPiAuthBindingsForSessions({
      sessions: this.sessions.values(),
    });
  }

  listPluginOAuthProviderRegistrations() {
    return listPluginOAuthProviderRegistrationsForSessions({
      sessions: this.sessions.values(),
    });
  }

  async invokeOAuthProviderImport(input: {
    ownerUserId?: number | null;
    pluginId: string | null;
    registration: PluginStartupOAuthProviderRegistration;
  }): Promise<PluginOAuthCredential | null> {
    const request = await buildPluginOAuthProviderImportRequest({
      appDataOptions: this.appDataOptions,
      ...(input.ownerUserId === undefined
        ? {}
        : { ownerUserId: input.ownerUserId }),
      pluginId: input.pluginId,
      registration: input.registration,
      session: input.pluginId
        ? this.findReadySession({ pluginId: input.pluginId })
        : null,
    });
    if (!request) {
      return null;
    }
    const result = await this.invokeSidecarRequest(request);
    return normalizePluginOAuthCredential(result);
  }

  async invokeOAuthProviderRefresh(input: {
    credentials: PluginOAuthCredential;
    pluginId: string | null;
    registration: PluginStartupOAuthProviderRegistration;
  }): Promise<PluginOAuthCredential> {
    const result = await this.invokeSidecarRequest(
      buildPluginOAuthProviderRefreshRequest(input),
    );
    const credential = normalizePluginOAuthCredential(result);
    if (!credential) {
      throw new Error(
        `Plugin OAuth provider ${input.registration.id} returned invalid refreshed credentials.`,
      );
    }
    return credential;
  }

  registerPluginOAuthProviders(): void {
    registerPluginOAuthProviderRegistrations({
      invokeRefresh: (refreshInput) =>
        this.invokeOAuthProviderRefresh(refreshInput),
      registrations: this.listPluginOAuthProviderRegistrations(),
    });
  }

  async applyPluginOAuthProviderAuth(input: {
    authStorage: PiAuthStorage;
    ownerUserId?: number | null;
  }): Promise<void> {
    const configuredProviders = new Set<string>();
    this.registerPluginOAuthProviders();
    for (const item of this.listPluginOAuthProviderRegistrations()) {
      if (configuredProviders.has(item.registration.provider)) {
        continue;
      }
      try {
        const credential = await this.invokeOAuthProviderImport({
          ...(input.ownerUserId === undefined
            ? {}
            : { ownerUserId: input.ownerUserId }),
          pluginId: item.pluginId,
          registration: item.registration,
        });
        if (credential) {
          input.authStorage.set(item.registration.provider, credential);
          configuredProviders.add(item.registration.provider);
        }
      } catch {
        // Import failures should not prevent model registry creation; the plugin
        // sidecar request path records operation diagnostics for the failed call.
      }
    }
  }

  async invokeModelProviderExecution(
    input: PluginModelProviderExecutionInput,
  ): Promise<unknown> {
    const plan = await buildPluginModelProviderExecutionRequest({
      appDataOptions: this.appDataOptions,
      invocation: input,
      session: this.findReadySession({ pluginId: input.pluginId }),
    });
    if (!plan.ok) {
      throw new PluginSidecarToolCallError({
        ...(plan.cause === undefined ? {} : { cause: plan.cause }),
        code: plan.code,
        ...(plan.pluginUnavailable === undefined
          ? {}
          : { pluginUnavailable: plan.pluginUnavailable }),
      });
    }
    return await this.invokeSidecarRequest(plan.request);
  }

  async invokeModelProviderEmbedding(
    input: PluginModelProviderEmbeddingInput,
  ): Promise<unknown> {
    const plan = await buildPluginModelProviderEmbeddingRequest({
      appDataOptions: this.appDataOptions,
      embedding: input,
      session: this.findReadySession({ pluginId: input.registration.pluginId }),
    });
    if (!plan.ok) {
      throw new PluginSidecarToolCallError({
        ...(plan.cause === undefined ? {} : { cause: plan.cause }),
        code: plan.code,
        ...(plan.pluginUnavailable === undefined
          ? {}
          : { pluginUnavailable: plan.pluginUnavailable }),
      });
    }
    return await this.invokeSidecarRequest(plan.request);
  }

  async resolvePluginModelProviderRuntimeApiKeys(input: {
    ownerUserId?: number | null;
  }): Promise<Map<string, string>> {
    return await resolvePluginModelProviderRuntimeApiKeysForSessions({
      appDataOptions: this.appDataOptions,
      ...(input.ownerUserId === undefined
        ? {}
        : { ownerUserId: input.ownerUserId }),
      sessions: [
        ...this.sessions.values(),
        ...this.cachedModelProviderSessions.values(),
      ],
    });
  }

  listAgentToolRegistrationsForThread(
    enabledAccessGroups: readonly string[],
  ): PluginAgentToolRegistrationForThread[] {
    return listPluginAgentToolRegistrationsForThread({
      enabledAccessGroups,
      sessions: this.sessions.values(),
    });
  }

  listPromptInjectionRegistrationsForThread(
    enabledAccessGroups: readonly string[],
  ): PluginPromptInjectionRegistrationForThread[] {
    return listPluginPromptInjectionRegistrationsForThread({
      enabledAccessGroups,
      sessions: this.sessions.values(),
    });
  }

  async invokePromptInjection(input: {
    context: PluginPromptInjectionContext;
    prompt: string;
    registration: PluginPromptInjectionRegistrationForThread;
    signal?: AbortSignal;
  }): Promise<string> {
    const result = await this.invokeSidecarRequest(
      buildPluginPromptInjectionSidecarRequest(input),
    );
    return normalizePluginPromptInjectionResult(result);
  }

  async dispatchPluginNotificationProviders(input: {
    request: PluginNotificationSendInput;
  }): Promise<PluginNotificationReceipt[]> {
    return await dispatchPluginNotificationProvidersForSessions({
      appDataOptions: this.appDataOptions,
      invokeSidecarRequest: (invocation) =>
        this.invokeNotificationProviderSidecarRequest(invocation),
      request: input.request,
      sessions: this.sessions.values(),
    });
  }

  private async invokeNotificationProviderSidecarRequest(
    input: PluginNotificationProviderInvocation<PluginSidecarSession>,
  ): Promise<unknown> {
    return await this.invokeSidecarRequest(input.request);
  }

  async invokeAgentTool(input: {
    context: PluginAgentToolContext;
    params: unknown;
    registration: PluginAgentToolRegistrationForThread;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const request = await buildPluginAgentToolSidecarRequest({
      appDataOptions: this.appDataOptions,
      context: input.context,
      params: input.params,
      registration: input.registration,
      session: this.sessions.get(input.registration.directoryName),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return await this.invokeSidecarRequest(request);
  }

  async runPluginCron(fullKey: string): Promise<unknown> {
    const plan = await buildPluginCronSidecarRequest({
      appDataOptions: this.appDataOptions,
      fullKey,
      session: findPluginCronExecutionSession({
        fullKey,
        sessions: this.sessions.values(),
      }),
    });
    try {
      return await this.invokeSidecarRequest(plan.request);
    } catch (error) {
      await this.recordCronFailureDiagnostic(plan.session, {
        cronKey: plan.registration.fullKey,
        error,
      });
      throw error;
    }
  }

  async runPluginGc(directoryName: string): Promise<unknown> {
    const plan = buildPluginGcSidecarRequest({
      directoryName,
      session: this.findReadySession({ directoryName }),
    });
    try {
      return await this.invokeSidecarRequest(plan.request);
    } catch (error) {
      throw mapPluginGcSidecarFailure(error);
    }
  }

  async invokeSidecarRequest(
    options: PluginSidecarRequestOptions,
  ): Promise<unknown> {
    const session = this.findReadySession(options);
    if (!session?.plugin.pluginId) {
      throw new PluginSidecarToolCallError({
        code: "plugin_unavailable",
        pluginUnavailable: true,
      });
    }
    try {
      if (
        session.missingRequiredSettings.length > 0 &&
        shouldRequireCompleteSettingsForSidecarOperation(options.operation)
      ) {
        throw new PluginSidecarToolCallError({
          code: "missing_required_plugin_settings",
          cause: new Error(
            missingRequiredPluginSettingsMessage(
              session.missingRequiredSettings,
            ),
          ),
        });
      }

      const timeoutMs = normalizePluginCallbackTimeoutMs(options.timeoutMs);
      const requestId = this.nextRequestId(session.plugin.pluginId);
      const deadlineMs = Date.now() + timeoutMs;
      const frame = encodePluginSidecarRpcEnvelope({
        id: requestId,
        payload: {
          deadlineMs,
          operation: options.operation,
          ...(options.params === undefined ? {} : { params: options.params }),
        },
        pluginId: session.plugin.pluginId,
        type: "host.request",
      });
      if (typeof frame !== "string") {
        throw new PluginSidecarToolCallError({
          cause: frame.error,
          code: frame.error.code,
        });
      }

      return await new Promise<unknown>((resolve, reject) => {
        const fail = (error: PluginSidecarToolCallError) => {
          reject(error);
        };
        const timer = setTimeout(() => {
          void this.sendCancellation(session, requestId, "timeout").finally(
            () => {
              this.terminateSessionForRequestTimeout(session, requestId);
            },
          );
          this.rejectInFlightOperation(
            session,
            requestId,
            pluginOperationTimeoutRejection({
              operation: options.operation,
              timeoutMs,
            }),
          );
        }, timeoutMs);
        timer.unref?.();
        const abortHandler = options.signal
          ? () => {
              void this.sendCancellation(session, requestId, "cancelled");
              this.rejectInFlightOperation(
                session,
                requestId,
                pluginOperationCancellationRejection({
                  operation: options.operation,
                }),
              );
            }
          : undefined;
        if (options.signal?.aborted) {
          clearTimeout(timer);
          reject(
            createPluginPreDispatchCancellationError({
              operation: options.operation,
              reason: options.signal.reason,
            }),
          );
          return;
        }
        if (options.signal && abortHandler) {
          options.signal.addEventListener("abort", abortHandler, {
            once: true,
          });
        }
        if (session.inFlight.size >= PLUGIN_SIDECAR_MAX_IN_FLIGHT_REQUESTS) {
          clearTimeout(timer);
          removeAbortHandler(options.signal, abortHandler);
          reject(
            new PluginSidecarToolCallError({
              code: "too_many_in_flight_plugin_requests",
              diagnosticMessage: `Plugin sidecar already has ${PLUGIN_SIDECAR_MAX_IN_FLIGHT_REQUESTS} in-flight requests.`,
            }),
          );
          return;
        }
        session.inFlight.set(requestId, {
          abortHandler,
          context: this.contextForSidecarRequest(options.params),
          deadlineMs,
          operation: options.operation,
          reject: fail,
          resolve,
          signal: options.signal,
          timer,
        });
        // The request is registered before writing so every transport failure
        // path can reject the exact in-flight promise. Silent sidecar crashes
        // are bounded by the operation timer; stdin/write failures are handled
        // immediately below and also fail the session's other in-flight calls.
        this.writeSessionFrame(session, frame).catch((error: unknown) => {
          this.handleSessionWriteFailure(session, {
            error,
            operation: options.operation,
            requestId,
          });
        });
      });
    } catch (error) {
      this.recordOperationFailureDiagnostic(session, {
        code: diagnosticCodeForUnknown(error),
        message: diagnosticMessageForUnknown(error),
        operation: options.operation,
      });
      throw error;
    }
  }

  private findReadySession(
    options: Pick<PluginSidecarRequestOptions, "directoryName" | "pluginId">,
  ): PluginSidecarSession | null {
    if (options.directoryName) {
      const session = this.sessions.get(options.directoryName);
      return session?.ready && !session.stopping ? session : null;
    }
    if (options.pluginId) {
      for (const session of this.sessions.values()) {
        if (
          session.plugin.pluginId === options.pluginId &&
          session.ready &&
          !session.stopping
        ) {
          return session;
        }
      }
    }
    return null;
  }

  private nextRequestId(pluginId: string): string {
    this.requestSequence += 1;
    return `${pluginId}:request:${this.requestSequence}`;
  }

  private contextForSidecarRequest(params: unknown): unknown | null {
    if (params && typeof params === "object" && !Array.isArray(params)) {
      const context = (params as Record<string, unknown>).context;
      return context === undefined ? null : context;
    }
    return null;
  }

  private async sendCancellation(
    session: PluginSidecarSession,
    requestId: string,
    reason: string,
  ): Promise<void> {
    if (!session.plugin.pluginId || session.stopping) {
      return;
    }
    const frame = encodePluginSidecarRpcEnvelope({
      id: `${requestId}:cancel`,
      payload: { reason, targetId: requestId },
      pluginId: session.plugin.pluginId,
      type: "host.cancel",
    });
    if (typeof frame !== "string") {
      return;
    }
    try {
      await this.writeSessionFrame(session, frame);
    } catch (error) {
      this.logger.warning({
        directoryName: session.directoryName,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to send plugin sidecar cancellation",
        pluginId: session.plugin.pluginId,
        requestId,
      });
    }
  }

  private writeSessionFrame(
    session: PluginSidecarSession,
    frame: string,
  ): Promise<void> {
    if (session.writeQueueDepth >= PLUGIN_SIDECAR_MAX_QUEUED_WRITES) {
      return Promise.reject(
        new Error(
          `Plugin sidecar stdin write queue exceeded ${PLUGIN_SIDECAR_MAX_QUEUED_WRITES} pending frames.`,
        ),
      );
    }
    session.writeQueueDepth += 1;
    const timeoutMs = this.sidecarWriteTimeoutMs;
    const write = () =>
      Promise.race([
        writeSidecarFrame(session.process, frame),
        timerPromise(
          timeoutMs,
          `Plugin sidecar stdin write timed out after ${timeoutMs} ms.`,
        ),
      ]);
    const nextWrite = session.writeQueue.then(write, write).finally(() => {
      session.writeQueueDepth = Math.max(0, session.writeQueueDepth - 1);
    });
    session.writeQueue = nextWrite.catch(() => undefined);
    return nextWrite;
  }

  private handleSessionWriteFailure(
    session: PluginSidecarSession,
    input: { error: unknown; operation: string; requestId: string },
  ): void {
    const reason = errorMessageForUnknown(input.error);
    const diagnosticMessage = `Plugin operation ${input.operation} could not be sent to the sidecar: ${reason}`;
    const code = reason.includes("stdin write timed out")
      ? "write_timeout"
      : "write_failed";
    this.recordOperationFailureDiagnostic(session, {
      code,
      message: diagnosticMessage,
      operation: input.operation,
    });
    this.logger.error({
      directoryName: session.directoryName,
      error: reason,
      message: "Plugin sidecar stdin write failed",
      operation: input.operation,
      pluginId: session.plugin.pluginId,
      requestId: input.requestId,
    });
    this.rejectInFlightOperation(session, input.requestId, {
      cause: input.error,
      code,
      diagnosticMessage,
      pluginUnavailable: true,
    });
    this.failInFlightOperations(session, {
      cause: input.error,
      code,
      diagnosticMessage: `Plugin sidecar became unavailable after a stdin transport failure: ${reason}`,
      pluginUnavailable: true,
    });
    if (!session.stopping) {
      session.stopping = true;
      this.unregisterSessionCronSchedules(session);
      this.unregisterSessionIngressSources(session);
      session.webSockets.closeAll();
      if (this.sessions.get(session.directoryName) === session) {
        this.sessions.delete(session.directoryName);
        invalidateModelCatalogState();
      }
      session.process.kill("SIGTERM");
    }
  }

  private resolveInFlightOperation(
    session: PluginSidecarSession,
    requestId: string,
    value: unknown,
  ): boolean {
    const operation = session.inFlight.get(requestId);
    if (!operation) {
      return false;
    }
    session.inFlight.delete(requestId);
    clearTimeout(operation.timer);
    removeAbortHandler(operation.signal, operation.abortHandler);
    operation.resolve(value);
    return true;
  }

  private rejectInFlightOperation(
    session: PluginSidecarSession,
    requestId: string,
    input: {
      cause?: unknown;
      code: string;
      diagnosticMessage?: string;
      pluginUnavailable?: boolean;
    },
  ): boolean {
    const operation = session.inFlight.get(requestId);
    if (!operation) {
      return false;
    }
    session.inFlight.delete(requestId);
    clearTimeout(operation.timer);
    removeAbortHandler(operation.signal, operation.abortHandler);
    operation.reject(new PluginSidecarToolCallError(input));
    return true;
  }

  private failInFlightOperations(
    session: PluginSidecarSession,
    input: {
      cause?: unknown;
      code: string;
      diagnosticMessage?: string;
      pluginUnavailable?: boolean;
    },
  ): void {
    for (const requestId of [...session.inFlight.keys()]) {
      this.rejectInFlightOperation(session, requestId, input);
    }
  }

  private async recordCronFailureDiagnostic(
    session: PluginSidecarSession,
    input: { cronKey: string; error: unknown },
  ): Promise<void> {
    const code = diagnosticCodeForUnknown(input.error);
    const message = diagnosticMessageForUnknown(input.error);
    const line = `Plugin cron ${input.cronKey} failed (${code}): ${message}`;
    const stderrDetails =
      input.error instanceof Error && input.error.stack
        ? `${line}\n${input.error.stack}`
        : line;
    try {
      this.writeHostStderr(stderrDetails);
    } catch (error) {
      this.logger.warning({
        cronKey: input.cronKey,
        directoryName: session.directoryName,
        error: errorMessageForUnknown(error),
        message: "Plugin cron failure stderr write failed",
        pluginId: session.plugin.pluginId,
      });
    }
    this.recordStderrDiagnostic(session, line);

    if (
      session.plugin.lifecycle.settings.log.enabled === true &&
      session.plugin.manifest.permissions.includes(PLUGIN_LOG_WRITE_PERMISSION)
    ) {
      try {
        await executePluginLogOperation({
          now: this.now(),
          params: { level: "error", message: line },
          permissions: session.plugin.manifest.permissions,
          pluginPath: session.plugin.folderPath,
          settings: session.plugin.lifecycle.settings.log,
        });
      } catch (error) {
        this.logger.warning({
          cronKey: input.cronKey,
          directoryName: session.directoryName,
          error: errorMessageForUnknown(error),
          message: "Plugin cron failure log append failed",
          pluginId: session.plugin.pluginId,
        });
      }
    }
  }

  private registerSessionIngressSources(session: PluginSidecarSession): void {
    this.ingressCapability.registerSessionSources(session);
  }

  private unregisterSessionIngressSources(session: PluginSidecarSession): void {
    this.ingressCapability.unregisterSessionSources(session);
  }

  private handleIngressPollFailure(
    input: PluginIngressCapabilityPollFailure<PluginSidecarSession>,
  ): void {
    this.recordOperationFailureDiagnostic(input.session, {
      code: input.code,
      message: input.message,
      operation: input.operation,
    });
    if (
      input.session.plugin.manifest.telemetry !== false &&
      input.session.plugin.pluginId
    ) {
      this.reportSidecarTelemetry({
        directoryName: input.session.directoryName,
        observedAt: this.now().toISOString(),
        pluginId: input.session.plugin.pluginId,
        sourceId: input.failure.sourceId,
        type: "ingress_poll_failure",
      });
    }
  }

  getActiveReplyContext(threadId: number) {
    return this.ingressCapability.getActiveReplyContext(threadId);
  }

  async sendReplyToSource(input: {
    pluginId: string;
    sourceId: string;
    responseContext: PluginIngressResponseContext;
    message: string;
    signal?: AbortSignal;
  }): Promise<void> {
    await this.ingressCapability.sendReplyToSource(input);
  }

  private registerSessionCronSchedules(session: PluginSidecarSession): void {
    this.unregisterSessionCronSchedules(session);
    if (!session.registrations?.crons.length) {
      return;
    }
    for (const cron of session.registrations.crons) {
      try {
        const handle = Bun.cron(cron.schedule, () => {
          void this.runPluginCron(cron.fullKey).catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.warning({
              cronKey: cron.fullKey,
              directoryName: session.directoryName,
              error: message,
              message: "Plugin cron execution failed",
              pluginId: session.plugin.pluginId,
            });
          });
        }) as PluginCronHandle;
        session.cronHandles.set(cron.fullKey, handle);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.recordStartupDiagnostic(
          session.plugin,
          `Plugin cron ${cron.fullKey} could not be scheduled: ${message}`,
        );
        throw error;
      }
    }
  }

  private unregisterSessionCronSchedules(session: PluginSidecarSession): void {
    for (const handle of session.cronHandles.values()) {
      try {
        handle.stop();
      } catch {
        // Best-effort cleanup during plugin shutdown or restart.
      }
    }
    session.cronHandles.clear();
  }

  private terminateSessionForRequestTimeout(
    session: PluginSidecarSession,
    requestId: string,
  ): void {
    if (session.stopping) {
      return;
    }
    session.stopping = true;
    if (this.sessions.get(session.directoryName) === session) {
      this.unregisterSessionCronSchedules(session);
      this.unregisterSessionIngressSources(session);
      session.webSockets.closeAll();
      this.sessions.delete(session.directoryName);
      invalidateModelCatalogState();
    }
    this.logger.warning({
      directoryName: session.directoryName,
      message:
        "Plugin sidecar callback timed out; terminating sidecar to stop stale plugin work",
      pluginId: session.plugin.pluginId,
      requestId,
    });
    this.failInFlightOperations(session, {
      code: "timeout",
      pluginUnavailable: true,
    });
    session.process.kill("SIGTERM");
  }

  private async stopSession(
    session: PluginSidecarSession,
    reason: PluginSidecarShutdownReason,
  ): Promise<void> {
    session.stopping = true;
    this.unregisterSessionCronSchedules(session);
    this.unregisterSessionIngressSources(session);
    session.webSockets.closeAll();
    closePluginSqliteConnections(session.plugin.folderPath);
    if (this.sessions.get(session.directoryName) === session) {
      this.sessions.delete(session.directoryName);
      invalidateModelCatalogState();
    }
    this.failInFlightOperations(session, {
      code: "host_shutdown",
      pluginUnavailable: true,
    });
    try {
      if (session.plugin.pluginId) {
        const frame = encodePluginSidecarRpcEnvelope({
          id: `${session.directoryName}-shutdown`,
          payload: {
            graceMs: DEFAULT_PLUGIN_SIDECAR_SHUTDOWN_GRACE_MS,
            reason,
          },
          pluginId: session.plugin.pluginId,
          type: "host.shutdown",
        });
        if (typeof frame === "string") {
          await this.writeSessionFrame(session, frame);
        }
      }
    } catch {
      // Best-effort shutdown frame; kill below still guarantees teardown.
    }
    session.process.kill("SIGTERM");
  }

  private handleUnknownCorrelationId(
    session: PluginSidecarSession,
    requestId: string,
  ): void {
    this.logger.warning({
      directoryName: session.directoryName,
      message: "Plugin sidecar returned an unknown request id",
      pluginId: session.plugin.pluginId,
      requestId,
    });
    this.failInFlightOperations(session, {
      code: "wrong_response_id",
    });
  }

  private pruneCrashTimestamps(directoryName: string, nowMs: number): number[] {
    const windowStartMs = nowMs - PLUGIN_SIDECAR_CRASH_LOOP_WINDOW_MS;
    const recentCrashes = (
      this.crashTimestampsByDirectoryName.get(directoryName) ?? []
    ).filter((crashMs) => crashMs >= windowStartMs);
    if (recentCrashes.length === 0) {
      this.crashTimestampsByDirectoryName.delete(directoryName);
      return recentCrashes;
    }
    this.crashTimestampsByDirectoryName.set(directoryName, recentCrashes);
    return recentCrashes;
  }

  private recordUnexpectedCrash(
    directoryName: string,
  ): PluginSidecarCrashLoopUpdate {
    const nowMs = this.now().getTime();
    const recentCrashes = this.pruneCrashTimestamps(directoryName, nowMs);
    recentCrashes.push(nowMs);
    this.crashTimestampsByDirectoryName.set(directoryName, recentCrashes);
    return {
      crashCount: recentCrashes.length,
      thresholdReached:
        recentCrashes.length >= PLUGIN_SIDECAR_CRASH_LOOP_THRESHOLD,
    };
  }

  private async startPlugin(
    inputPlugin: RpcPluginInventoryPlugin,
    reviewHash: string,
  ): Promise<PluginSidecarStartSuccess> {
    const plugin = assertRealPluginDirectory(inputPlugin);
    if (!plugin.pluginId) {
      throw new Error("Plugin manifest did not resolve a valid plugin id.");
    }
    await ensurePluginDataRootForActivation({
      activatedOnce: plugin.lifecycle.activatedOnce,
      pluginPath: plugin.folderPath,
    });
    const capturedEnv = capturePluginEnvironment(
      plugin.manifest.env,
      this.environment,
    );
    try {
      assertRequiredPluginEnvCaptured(capturedEnv);
    } catch (error) {
      if (error instanceof PluginEnvCaptureError) {
        this.recordStartupDiagnostic(plugin, error.message);
      }
      throw error;
    }
    const settings = await readPluginSettingsForRuntime({
      declarations: pluginSettingsDeclarations(plugin),
      directoryName: plugin.directoryName,
      options: this.appDataOptions,
    });
    if (settings.missingRequiredKeys.length > 0) {
      this.recordStartupDiagnostic(
        plugin,
        missingRequiredPluginSettingsMessage(settings.missingRequiredKeys),
      );
    }
    const privateNetworkAllowlist = unsafePrivateNetworkAllowlist();
    const requestedUnsafePrivateNetwork =
      pluginMatchesUnsafePrivateNetworkAllowlist(
        plugin,
        privateNetworkAllowlist,
      );
    const unsafeAllowPrivateNetwork =
      requestedUnsafePrivateNetwork &&
      plugin.manifest.permissions.includes("unsafe");
    if (unsafeAllowPrivateNetwork) {
      this.recordStartupDiagnostic(
        plugin,
        `Unsafe plugin private-network access enabled by ${PLUGIN_UNSAFE_PRIVATE_NETWORK_ALLOWLIST_ENV} for ${plugin.pluginId ?? plugin.directoryName} and plugin unsafe approval; network fetch and WebSocket requests may reach localhost or private LAN services.`,
      );
    } else if (requestedUnsafePrivateNetwork) {
      this.recordStartupDiagnostic(
        plugin,
        `Unsafe plugin private-network access requested by ${PLUGIN_UNSAFE_PRIVATE_NETWORK_ALLOWLIST_ENV} for ${plugin.pluginId ?? plugin.directoryName} but denied because the plugin manifest does not include unsafe permission.`,
      );
    }
    const currentReviewHash = await computePluginReviewHash(plugin.folderPath);
    if (!currentReviewHash.hash || currentReviewHash.hash !== reviewHash) {
      throw new Error("Plugin files differ from the approved review hash.");
    }
    const process = this.spawnSidecar({ capturedEnv, plugin, reviewHash });
    const session: PluginSidecarSession = {
      capturedEnv,
      cronHandles: new Map(),
      directoryName: plugin.directoryName,
      hostRequests: new Set(),
      inFlight: new Map(),
      ingressSourceIds: new Set(),
      missingRequiredSettings: settings.missingRequiredKeys,
      modelProviderRefreshState: new Map(),
      plugin,
      process,
      ready: false,
      registrations: null,
      settingsFingerprint: pluginStartupCacheFingerprint(settings),
      startupSettled: false,
      stopping: false,
      webSockets: new PluginWebSocketRegistry({
        limits: {
          maxConnections: plugin.manifest.limits?.maxWebSocketConnections,
          maxMessageBytes: plugin.manifest.limits?.maxWebSocketMessageBytes,
          maxQueuedMessages: plugin.manifest.limits?.maxWebSocketQueuedMessages,
        },
        network: plugin.manifest.network,
        permissions: plugin.manifest.permissions,
        unsafeAllowPrivateNetwork,
      }),
      writeQueue: Promise.resolve(),
      writeQueueDepth: 0,
    };
    this.sessions.set(plugin.directoryName, session);

    const startupResult = new Promise<void>((resolve, reject) => {
      const resolveStartup = () => {
        if (session.startupSettled) {
          return;
        }
        session.startupSettled = true;
        session.ready = true;
        resolve();
      };
      const rejectStartup = (error: Error) => {
        if (session.startupSettled) {
          return;
        }
        session.startupSettled = true;
        reject(error);
      };

      if (process.stdout) {
        void readTextLines(
          process.stdout,
          async (line) => {
            const decoded = decodePluginSidecarRpcEnvelope(
              line,
              plugin.pluginId ? { expectedPluginId: plugin.pluginId } : {},
            );
            if (!decoded.ok) {
              rejectStartup(new Error(protocolErrorMessage(decoded.error)));
              return;
            }
            const { envelope } = decoded;
            if (!isSidecarInboundEnvelope(envelope)) {
              rejectStartup(
                new Error(
                  `Plugin sidecar stdout emitted a host-owned envelope (${envelope.type}).`,
                ),
              );
              return;
            }
            this.handleSidecarEnvelope(
              session,
              envelope,
              resolveStartup,
              rejectStartup,
            );
          },
          { maxLineLength: PLUGIN_SIDECAR_STDOUT_LINE_MAX_CHARS },
        ).catch((error: unknown) => {
          rejectStartup(
            new Error(
              `Plugin sidecar stdout failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        });
      } else {
        rejectStartup(
          new Error("Plugin sidecar process did not expose stdout."),
        );
      }

      if (process.stderr) {
        void readTextLines(
          process.stderr,
          (line) => {
            this.recordStderrDiagnostic(session, line);
          },
          { maxLineLength: PLUGIN_SIDECAR_STDERR_LINE_MAX_CHARS },
        ).catch((error: unknown) => {
          this.logger.warning({
            directoryName: plugin.directoryName,
            error: error instanceof Error ? error.message : String(error),
            message: "Plugin sidecar stderr reader failed",
            pluginId: plugin.pluginId,
          });
        });
      }

      void process.exited.then((exitCode) => {
        const normalizedExitCode = normalizeExitCode(exitCode);
        if (this.sessions.get(plugin.directoryName) === session) {
          this.unregisterSessionCronSchedules(session);
          this.unregisterSessionIngressSources(session);
          session.webSockets.closeAll();
          this.sessions.delete(plugin.directoryName);
          invalidateModelCatalogState();
        }
        this.failInFlightOperations(session, {
          code: "sidecar_exited",
          pluginUnavailable: true,
        });
        if (session.stopping) {
          return;
        }
        if (!session.ready) {
          const message = `Plugin sidecar exited before startup completed with ${sidecarExitDescription(normalizedExitCode)}.`;
          this.recordStartupDiagnostic(plugin, message);
          rejectStartup(new Error(message));
          return;
        }
        const crashLoop = this.recordUnexpectedCrash(plugin.directoryName);
        const message = `Plugin sidecar exited unexpectedly with ${sidecarExitDescription(normalizedExitCode)}.`;
        if (crashLoop.thresholdReached) {
          this.logger.warning({
            crashCount: crashLoop.crashCount,
            directoryName: plugin.directoryName,
            message:
              "Plugin sidecar crash-loop threshold reached; marking plugin failed/degraded",
            pluginId: plugin.pluginId,
            windowMs: PLUGIN_SIDECAR_CRASH_LOOP_WINDOW_MS,
          });
          void this.recordStartupFailure(
            plugin.directoryName,
            message,
            crashLoop,
          );
          return;
        }
        this.logger.warning({
          crashCount: crashLoop.crashCount,
          directoryName: plugin.directoryName,
          message:
            "Plugin sidecar crashed; restarting below crash-loop threshold",
          pluginId: plugin.pluginId,
          windowMs: PLUGIN_SIDECAR_CRASH_LOOP_WINDOW_MS,
        });
        void this.startPlugin(plugin, reviewHash).catch((error: unknown) => {
          void this.recordStartupFailure(
            plugin.directoryName,
            error instanceof Error ? error.message : String(error),
          );
        });
      });
    });

    const startupSettings: PluginSidecarStartupSettingsPayload =
      pluginRuntimeSettingsForStartup(settings);
    const startupFrame = encodePluginSidecarRpcEnvelope({
      id: `${plugin.directoryName}-startup`,
      payload: {
        apiVersion: "v1",
        env: capturedEnv,
        fs: {
          files: {
            allow: {
              delete: plugin.manifest.files.allow.delete,
              read: plugin.manifest.files.allow.read,
              write: plugin.manifest.files.allow.write,
            },
            deny: {
              delete: plugin.manifest.files.deny.delete,
              read: plugin.manifest.files.deny.read,
              write: plugin.manifest.files.deny.write,
            },
          },
          pluginPath: plugin.folderPath,
          quota: plugin.lifecycle.settings.quota,
        },
        network: plugin.manifest.network,
        permissions: plugin.manifest.permissions,
        protocolVersion: PLUGIN_SIDECAR_RPC_PROTOCOL_VERSION,
        reviewHash,
        settings: startupSettings,
        unsafeAllowPrivateNetwork,
      },
      pluginId: plugin.pluginId,
      type: "host.startup",
    });
    if (typeof startupFrame !== "string") {
      session.stopping = true;
      this.sessions.delete(plugin.directoryName);
      process.kill("SIGTERM");
      throw new Error(protocolErrorMessage(startupFrame.error));
    }

    try {
      await writeSidecarFrame(process, startupFrame);
      await Promise.race([
        startupResult,
        timerPromise(
          this.startupTimeoutMs,
          `Plugin sidecar startup timed out after ${this.startupTimeoutMs} ms.`,
        ),
      ]);
      this.registerSessionCronSchedules(session);
    } catch (error) {
      session.stopping = true;
      this.unregisterSessionCronSchedules(session);
      this.unregisterSessionIngressSources(session);
      session.webSockets.closeAll();
      this.sessions.delete(plugin.directoryName);
      process.kill("SIGTERM");
      throw error;
    }

    this.logger.info({
      directoryName: plugin.directoryName,
      message: "Plugin sidecar started",
      pluginId: plugin.pluginId,
      processId: process.pid ?? null,
    });
    await this.recordStartupActivation(plugin.directoryName);

    const registrations = session.registrations ?? {
      crons: [],
      gc: null,
      ingressSources: [],
      modelProviders: [],
      notificationProviders: [],
      oauthProviders: [],
      injections: [],
      tools: [],
    };
    if (isStaticModelProviderOnlyRegistration(registrations)) {
      this.cachedModelProviderSessions.set(plugin.directoryName, {
        capturedEnv,
        directoryName: plugin.directoryName,
        settingsFingerprint: pluginStartupCacheFingerprint(settings),
        modelProviderRefreshState:
          createPluginModelProviderRefreshStatesFromRegistrations(
            registrations,
          ),
        plugin,
        registrations,
        reviewHash,
      });
      await this.stopSession(session, "plugin_retry");
      invalidateModelCatalogState();
      this.logger.info({
        directoryName: plugin.directoryName,
        message: "Plugin sidecar stopped after caching static model providers",
        pluginId: plugin.pluginId,
      });
      return {
        directoryName: plugin.directoryName,
        pluginId: plugin.pluginId,
        processId: null,
        registrations,
      };
    }

    this.registerSessionIngressSources(session);

    return {
      directoryName: plugin.directoryName,
      pluginId: plugin.pluginId,
      processId: process.pid ?? null,
      registrations,
    };
  }

  private recordStartupDiagnostic(
    plugin: RpcPluginInventoryPlugin,
    line: string,
  ): void {
    const observedAt = this.now().toISOString();
    const existing = this.diagnosticsByDirectoryName.get(plugin.directoryName);
    const record = existing ?? createDiagnosticsRecord(plugin);
    record.pluginId = plugin.pluginId;
    record.pluginSnapshot = plugin;
    record.telemetryEnabled = plugin.manifest.telemetry;
    if (record.lines.at(-1)?.line === line) {
      return;
    }
    record.lines.push({ line, observedAt });
    retainNewestPluginSidecarDiagnostics(
      record.lines,
      this.diagnosticsRetentionLines,
    );
    this.diagnosticsByDirectoryName.set(plugin.directoryName, record);

    this.logger.warning({
      directoryName: plugin.directoryName,
      message: "Plugin sidecar startup diagnostic",
      pluginId: plugin.pluginId,
      stderr: line,
    });
  }

  private recordStderrDiagnostic(
    session: PluginSidecarSession,
    line: string,
  ): void {
    const observedAt = this.now().toISOString();
    const existing = this.diagnosticsByDirectoryName.get(session.directoryName);
    const record = existing ?? createDiagnosticsRecord(session.plugin);
    record.pluginId = session.plugin.pluginId;
    record.pluginSnapshot = session.plugin;
    record.telemetryEnabled = session.plugin.manifest.telemetry;
    record.lines.push({ line, observedAt });
    retainNewestPluginSidecarDiagnostics(
      record.lines,
      this.diagnosticsRetentionLines,
    );
    this.diagnosticsByDirectoryName.set(session.directoryName, record);

    this.logger.warning({
      directoryName: session.directoryName,
      message: "Plugin sidecar stderr diagnostic",
      pluginId: session.plugin.pluginId,
      stderr: line,
    });

    if (
      session.plugin.manifest.telemetry !== false &&
      session.plugin.pluginId
    ) {
      this.reportSidecarTelemetry({
        directoryName: session.directoryName,
        lineLength: line.length,
        observedAt,
        pluginId: session.plugin.pluginId,
        retainedLineCount: record.lines.length,
        type: "stderr_line",
      });
    }
  }

  private recordOperationFailureDiagnostic(
    session: PluginSidecarSession,
    input: {
      code: string;
      message: string;
      operation: string;
    },
  ): void {
    if (!shouldRetainPluginOperationFailureDiagnostic(input.code)) {
      return;
    }
    const observedAt = this.now().toISOString();
    const existing = this.diagnosticsByDirectoryName.get(session.directoryName);
    const record = existing ?? createDiagnosticsRecord(session.plugin);
    record.pluginId = session.plugin.pluginId;
    record.pluginSnapshot = session.plugin;
    record.telemetryEnabled = session.plugin.manifest.telemetry;
    record.failures.push({
      code: input.code,
      message: input.message,
      observedAt,
      operation: input.operation,
    });
    retainNewestPluginSidecarDiagnostics(
      record.failures,
      this.diagnosticsRetentionLines,
    );
    this.diagnosticsByDirectoryName.set(session.directoryName, record);

    this.logger.warning({
      code: input.code,
      directoryName: session.directoryName,
      message: "Plugin sidecar operation diagnostic",
      operation: input.operation,
      pluginId: session.plugin.pluginId,
    });
  }

  private handleSidecarEnvelope(
    session: PluginSidecarSession,
    envelope: PluginSidecarInboundEnvelope,
    resolveStartup: () => void,
    rejectStartup: (error: Error) => void,
  ): void {
    switch (envelope.type) {
      case "sidecar.ready":
        try {
          session.registrations = validatePluginStartupRegistrations(
            envelope.payload.registrations,
            session.plugin,
          );
          session.modelProviderRefreshState.clear();
          for (const provider of session.registrations.modelProviders) {
            const startupConfigurationCount = provider.configurations.length;
            const startupConfigurationTimestamp =
              startupConfigurationCount > 0 ? Date.now() : null;
            session.modelProviderRefreshState.set(provider.id, {
              inFlight: false,
              lastAttemptedAt: startupConfigurationTimestamp,
              lastError: null,
              lastSuccessfulAt: startupConfigurationTimestamp,
            });
          }
          invalidateModelCatalogState();
        } catch (error) {
          const startupError =
            error instanceof Error ? error : new Error(String(error));
          this.recordStartupDiagnostic(session.plugin, startupError.message);
          rejectStartup(startupError);
          return;
        }
        resolveStartup();
        break;
      case "sidecar.error":
        if (!session.ready) {
          rejectStartup(
            new Error(
              `Plugin sidecar startup failed: ${envelope.payload.code}: ${envelope.payload.message}`,
            ),
          );
          return;
        }
        if (envelope.payload.requestId) {
          if (
            !this.rejectInFlightOperation(session, envelope.payload.requestId, {
              code: envelope.payload.code,
              diagnosticMessage: envelope.payload.message,
              pluginUnavailable: envelope.payload.unavailable === true,
            })
          ) {
            this.handleUnknownCorrelationId(
              session,
              envelope.payload.requestId,
            );
          }
          return;
        }
        this.logger.warning({
          code: envelope.payload.code,
          directoryName: session.directoryName,
          message: envelope.payload.message,
          pluginId: session.plugin.pluginId,
        });
        break;
      case "sidecar.response":
        if (
          !this.resolveInFlightOperation(
            session,
            envelope.payload.requestId,
            envelope.payload.result,
          )
        ) {
          this.handleUnknownCorrelationId(session, envelope.payload.requestId);
        }
        break;
      case "sidecar.event":
        this.logger.info({
          directoryName: session.directoryName,
          message: "Plugin sidecar protocol envelope received",
          pluginId: session.plugin.pluginId,
          type: envelope.type,
        });
        break;
      case "sidecar.request":
        void this.handleSidecarHostRequest(session, envelope);
        break;
    }
  }

  async embedForThread(input: {
    ownerUserId: number | null | undefined;
    projectId: number;
    query: string;
    threadId: number;
    worktreePath: string;
  }): Promise<number[]> {
    return this.executeEmbeddingRequest({
      context: {
        contextKind: "threadTool",
        ownerUserId: input.ownerUserId,
        projectId: input.projectId,
        threadId: input.threadId,
        worktreePath: input.worktreePath,
      },
      input: input.query,
      payload: null,
    });
  }

  private async executeEmbeddingRequest(input: {
    context?: unknown;
    input: unknown;
    payload: unknown;
  }): Promise<number[]> {
    return await executePluginEmbeddingRequest({
      context: input.context,
      input: input.input,
      invokeProviderEmbedding: (invocation) =>
        this.invokeModelProviderEmbedding(invocation),
      listProviderRegistrations: () =>
        this.listPluginModelProviderRegistrations(),
      payload: input.payload,
      readRuntimeSettings: (_ownerUserId) =>
        readLocalRuntimeSettings(initAppDatabase()),
    });
  }

  private async handleSidecarHostRequest(
    session: PluginSidecarSession,
    envelope: PluginSidecarHostRequestEnvelope,
  ): Promise<void> {
    if (!session.plugin.pluginId) {
      return;
    }

    const pluginId = session.plugin.pluginId;
    const writeHostError = async (input: {
      code: string;
      message: string;
    }): Promise<void> => {
      const frame = createPluginHostErrorFrame({
        code: input.code,
        envelope,
        message: input.message,
        pluginId,
      });
      if (frame) {
        await this.writeSessionFrame(session, frame);
      }
    };
    const writeHostResponse = async (result: unknown): Promise<void> => {
      const frame = createPluginHostResponseFrame({
        envelope,
        pluginId,
        result,
      });
      if (frame) {
        await this.writeSessionFrame(session, frame);
        return;
      }
      await writeHostError({
        code: "oversized_payload",
        message:
          "Plugin host response exceeded the sidecar protocol payload limit.",
      });
    };

    if (
      !session.hostRequests.has(envelope.id) &&
      session.hostRequests.size >= PLUGIN_SIDECAR_MAX_CONCURRENT_HOST_REQUESTS
    ) {
      await writeHostError({
        code: "too_many_host_requests",
        message: `Plugin sidecar already has ${PLUGIN_SIDECAR_MAX_CONCURRENT_HOST_REQUESTS} concurrent host requests.`,
      });
      return;
    }

    const hostRequestId = envelope.payload.hostRequestId;
    const trustedHostRequest = hostRequestId
      ? (session.inFlight.get(hostRequestId) ?? null)
      : null;

    session.hostRequests.add(envelope.id);
    try {
      const result = await handlePluginSidecarHostRequest({
        dependencies: {
          calendarEventsHost: this.calendarEventsHost,
          dispatchPluginNotificationProviders: (providerInput) =>
            this.dispatchPluginNotificationProviders(providerInput),
          embed: ((request) =>
            this.executeEmbeddingRequest(
              request,
            )) satisfies PluginEmbeddingHost,
          logger: this.logger,
          now: this.now,
          sendNotification: this.sendNotification,
          terminalHost: this.terminalHost,
          usersHost: this.usersHost,
        },
        envelope,
        session: {
          plugin: { ...session.plugin, pluginId },
          webSockets: session.webSockets,
        },
        trustedCallback: trustedHostRequest
          ? {
              context: trustedHostRequest.context,
              deadlineMs: trustedHostRequest.deadlineMs,
            }
          : null,
      });
      if (result.type === "response") {
        await writeHostResponse(result.result);
        return;
      }
      if (result.retainFailureDiagnostic) {
        this.recordOperationFailureDiagnostic(session, {
          code: result.code,
          message: result.message,
          operation: `host.${result.operation}`,
        });
      }
      await writeHostError({
        code: result.code,
        message: result.message,
      });
    } finally {
      session.hostRequests.delete(envelope.id);
    }
  }

  private async recordStartupActivation(directoryName: string): Promise<void> {
    try {
      await this.markRuntimeActivated({ directoryName });
    } catch (error) {
      this.logger.error({
        directoryName,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to persist plugin runtime activation",
      });
    }
  }

  private async recordStartupFailure(
    directoryName: string,
    message: string,
    crashLoop?: PluginSidecarCrashLoopUpdate,
  ): Promise<void> {
    try {
      await this.markRuntimeFailure({
        ...(crashLoop?.crashCount === undefined
          ? {}
          : { crashCount: crashLoop.crashCount }),
        ...(crashLoop?.thresholdReached === undefined
          ? {}
          : { crashLoopThresholdReached: crashLoop.thresholdReached }),
        directoryName,
        message,
      });
    } catch (error) {
      this.logger.error({
        directoryName,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to persist plugin runtime failure",
      });
    }
  }
}

export function createPluginSidecarProcessManager(
  options: PluginSidecarProcessManagerOptions = {},
): PluginSidecarProcessManager {
  return new PluginSidecarProcessManager(options);
}
