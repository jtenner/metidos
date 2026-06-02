/**
 * @file src/bun/db.ts
 * @description Module for db.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { timingSafeEqual } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import {
  type AppDataPathOptions,
  applyAppDatabasePermissions,
  applyAppDatabasePragmas as applyAppDatabasePragmasWithRunner,
  assertAppDatabaseFilesAreRegular,
  deleteAppDatabaseFiles as deleteAppDatabaseFilesForPath,
  ensureAppDirectory,
  getAppDatabaseDirectoryPath,
  getAppDatabasePath,
  isInMemoryAppDatabasePath,
  SQL_BUSY_TIMEOUT_MS,
} from "./db-context";
import {
  initTimezoneSettingsSchema as initAppSchemaTimezoneSettings,
  migrateAppSchema,
  quoteSqliteIdentifier,
  tableHasColumn,
} from "./app-schema-migration";

export {
  assertSafeSqliteColumnDefinition,
  quoteSqliteIdentifier,
} from "./app-schema-migration";

export type { AppDataPathOptions } from "./db-context";
export {
  APP_DATABASE_JOURNAL_MODE,
  APP_DATABASE_SYNCHRONOUS,
  getAppDatabaseDirectoryPath,
  getAppDatabasePath,
  getAppDataDirectoryPath,
  resetResolvedAppDataDirectory,
  resolveAppDatabaseRuntimePragmas,
  SQL_BUSY_TIMEOUT_MS,
  selectWritableAppDataDirectory,
} from "./db-context";

import { computeNextRunDateForLocalCronSchedule } from "./cron-schedules";
import {
  generateWebServerShareOpaqueToken,
  hashWebServerShareOpaqueToken,
} from "./pi/web-server/share";
import {
  parseThreadPluginAccessGroups,
  serializeThreadPluginAccessGroups,
} from "./plugin/tool-access";
import {
  type ProjectRecord,
  type ProjectInput as ProjectStoreInput,
  upsertProject as upsertProjectRecord,
} from "./project-store";
import {
  defaultThreadPermissions,
  permissionIdFor,
} from "./thread-permissions";

export type { ProjectRecord, ProjectWorktreeRecord } from "./project-store";
export {
  deleteProject,
  ensureProjectWorktreeVisible,
  getProject,
  getProjectById,
  listOpenProjects,
  listProjects,
  listProjectWorktreesMetadata,
  setProjectClosed,
  setProjectWorktreePinned,
} from "./project-store";

/** Default thread model used when no explicit model is provided. */

export const DEFAULT_THREAD_MODEL = "gpt-5.4";
/** Default reasoning effort used for thread creation and migration repair. */
export const DEFAULT_THREAD_REASONING_EFFORT = "medium";
const DEFAULT_BOOTSTRAP_USERNAME = "metidos";
/** Lazily-initialized singleton db handle for the process lifetime. */

let appDatabase: Database | null = null;
type ProjectInput = {
  projectPath: string;
  name?: string | null;
};
/** Input used when inserting a thread row. */
type ThreadInput = {
  projectId: number;
  worktreePath: string;
  cronJobId?: number | null;
  title: string;
  model: string;
  reasoningEffort: string;
  webSearchAccess?: boolean | null;
  githubAccess: boolean;
  gitAccess?: boolean;
  sqliteAccess?: boolean;
  webServerAccess?: boolean;
  agentsAccess: boolean;
  calendarAccess?: boolean;
  notificationsAccess?: boolean;
  weatherAccess?: boolean;
  threadsAccess?: boolean;
  cronsAccess?: boolean;
  metidosAccess: boolean;
  pluginAccessGroups?: string[] | null;
  permissions?: string[] | null;
  unsafeMode: boolean;
  piSessionId?: string | null;
  piSessionFile?: string | null;
  piLeafEntryId?: string | null;
};

type ThreadUsageInput = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

/** Input for compaction metric updates persisted with token usage. */

type ThreadCompactionStatsInput = {
  maxInputTokens: number;
  estimatedCompactionTriggerTokens: number | null;
  compactionCount: number;
  lastCompactionAt: string | null;
  lastCompactionBeforeInputTokens: number | null;
  lastCompactionAfterInputTokens: number | null;
};

type ThreadMessageInput = {
  threadId: number;
  role: "assistant" | "user";
  text: string;
  payloadJson?: string | null;
};

type ThreadActivityKind =
  | "chat"
  | "reasoning"
  | "command"
  | "file_change"
  | "tool_call"
  | "web_search"
  | "error";

export type ThreadActivityInput = {
  threadId: number;
  itemId: string;
  role?: "assistant" | "user";
  kind: ThreadActivityKind;
  text: string;
  state: string | null;
  payloadJson?: string | null;
};

type ThreadActivityPersistInput = ThreadActivityInput & {
  messageId?: number | null;
};

export type AuthPrimaryFactorType = "pin" | "password";

type AuthSettingsInput = {
  userId?: number | null;
  primaryFactorType: AuthPrimaryFactorType;
  primaryFactorHash: string;
  totpSecretCiphertext: string;
  sessionLifetimeDays: number;
};

type AuthSessionInput = {
  id: string;
  userId?: number | null;
  issuedAt: string;
  expiresAt: string;
  lastUsedAt: string;
  stepUpValidUntil?: string | null;
};

export type TerminalSettingsRecord = {
  defaultShell: string;
  replayBufferBytes: number;
};

export const DEFAULT_COMMAND_TIMEOUT_SECONDS = 10 * 60;

function integerSqlLiteral(value: number, label: string): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer SQL literal.`);
  }
  return String(value);
}

// SQLite DEFAULT clauses cannot use bound parameters. Keep the schema literal
// derived from a validated numeric constant instead of interpolating arbitrary
// configuration values into DDL.
const DEFAULT_COMMAND_TIMEOUT_SECONDS_SQL = integerSqlLiteral(
  DEFAULT_COMMAND_TIMEOUT_SECONDS,
  "DEFAULT_COMMAND_TIMEOUT_SECONDS",
);

export type TimezoneSettingsRecord = {
  effectiveTimezone: string;
  timezone: string;
  userId: number;
  updatedAt: string;
};

export type UserRuntimeSettingsRecord = {
  commandTimeoutSeconds: number;
  embeddingModel: string;
  userId: number;
  updatedAt: string;
};

export type WeatherSettingsRecord = {
  userId: number;
  coordinates: string;
  updatedAt: string;
};

type UserInput = {
  isAdmin: boolean;
  username: string;
};

export type UserProfileUpdateInput = {
  displayName?: string | null;
  email?: string | null;
  enabled?: boolean;
};

const MAX_USER_DISPLAY_NAME_BYTES = 200;
const MAX_USER_EMAIL_BYTES = 320;

type AuthWebSocketTicketInput = {
  id: string;
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
};

type SecurityAuditEventInput = {
  eventType: string;
  summaryText: string;
  threadId?: number | null;
  projectId?: number | null;
  worktreePath?: string | null;
  payloadJson?: string | null;
};

export type ClientLogEventInput = {
  severity: string;
  message: string;
  route?: string | null;
  context?: string | null;
  detailsJson?: string | null;
  clientTimestamp?: string | null;
  userId?: number | null;
};

/** Public DB shape for thread rows returned from queries. */

export type ThreadRecord = {
  id: number;
  projectId: number;
  worktreePath: string;
  cronJobId: number | null;
  title: string;
  summary: string | null;
  model: string;
  // Persisted DB records keep raw reasoning-effort strings for migration and
  // repair compatibility. RPC projection normalizes this before Mainview uses
  // the value as a RpcReasoningEffort.
  reasoningEffort: string;
  webSearchAccess: boolean;
  githubAccess: boolean;
  gitAccess: boolean;
  sqliteAccess: boolean;
  webServerAccess?: boolean;
  agentsAccess: boolean;
  calendarAccess?: boolean;
  notificationsAccess?: boolean;
  weatherAccess?: boolean;
  threadsAccess?: boolean;
  cronsAccess?: boolean;
  metidosAccess: boolean;
  pluginAccessGroups?: string[];
  permissions: string[];
  unsafeMode: 0 | 1;
  piSessionId: string | null;
  piSessionFile: string | null;
  piLeafEntryId: string | null;
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastInputTokens: number | null;
  lastCachedInputTokens: number | null;
  lastOutputTokens: number | null;
  maxInputTokens: number | null;
  estimatedCompactionTriggerTokens: number | null;
  compactionCount: number;
  lastCompactionAt: string | null;
  lastCompactionBeforeInputTokens: number | null;
  lastCompactionAfterInputTokens: number | null;
  activeTurnStartedAt: string | null;
  lastErrorAt: string | null;
  lastErrorSeenAt: string | null;
  lastErrorMessage: string | null;
};

// Keep this SQL row shape derived from ThreadRecord so row-mapping omissions
// stay visible during type-checking: new persisted fields should either remain
// database-shaped here or be explicitly converted below.
type ThreadSqlRecord = Omit<
  ThreadRecord,
  | "agentsAccess"
  | "calendarAccess"
  | "weatherAccess"
  | "githubAccess"
  | "gitAccess"
  | "metidosAccess"
  | "pluginAccessGroups"
  | "permissions"
  | "threadsAccess"
  | "cronsAccess"
  | "notificationsAccess"
  | "sqliteAccess"
  | "webSearchAccess"
  | "webServerAccess"
> & {
  agentsAccess: 0 | 1;
  calendarAccess: 0 | 1;
  weatherAccess?: 0 | 1;
  githubAccess: 0 | 1;
  gitAccess: 0 | 1;
  metidosAccess: 0 | 1;
  pluginAccessGroups: string;
  permissions: string;
  threadsAccess?: 0 | 1;
  cronsAccess?: 0 | 1;
  notificationsAccess: 0 | 1;
  sqliteAccess: 0 | 1;
  webSearchAccess: 0 | 1;
  webServerAccess?: 0 | 1;
};

/** Public DB shape for thread_messages rows returned from queries. */
export type ThreadMessageRecord = {
  id: number;
  threadId: number;
  role: "assistant" | "user";
  kind: ThreadActivityKind;
  itemId: string | null;
  text: string;
  state: string | null;
  payloadJson: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InProgressThreadMessageRecord = {
  threadId: number;
  lastUpdatedAt: string;
};

export type AuthSettingsRecord = {
  userId: number;
  primaryFactorType: AuthPrimaryFactorType;
  primaryFactorHash: string;
  totpSecretCiphertext: string;
  totpLastUsedCounter: number | null;
  sessionLifetimeDays: number;
  failedPrimaryFactorAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthSessionRecord = {
  id: string;
  userId: number;
  username: string;
  isAdmin: boolean;
  issuedAt: string;
  expiresAt: string;
  lastUsedAt: string;
  stepUpValidUntil: string | null;
};

export type AuthRecoveryCodeRecord = {
  id: number;
  userId: number;
  codeHash: string;
  usedAt: string | null;
  createdAt: string;
};

export type AuthWebSocketTicketRecord = {
  id: string;
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

export type SecurityAuditEventRecord = {
  id: number;
  eventType: string;
  summaryText: string;
  threadId: number | null;
  projectId: number | null;
  worktreePath: string | null;
  payloadJson: string | null;
  createdAt: string;
};

export type ClientLogEventRecord = {
  id: number;
  userId: number | null;
  severity: string;
  message: string;
  route: string | null;
  context: string | null;
  detailsJson: string | null;
  clientTimestamp: string | null;
  createdAt: string;
};

export type UserRecord = {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  enabled: boolean;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UserSetupRecord = UserRecord & {
  configured: boolean;
};

export type CronJobRunStatus =
  | "InProgress"
  | "Stopped"
  | "Errored"
  | "Completed";

export type CronJobRecord = {
  id: number;
  projectId: number;
  worktreePath: string;
  schedule: string;
  prompt: string;
  title: string;
  description: string;
  model: string;
  // Persisted DB records keep raw reasoning-effort strings for migration and
  // repair compatibility. RPC projection normalizes this before Mainview uses
  // the value as a RpcReasoningEffort.
  reasoningEffort: string;
  webSearchAccess: boolean;
  githubAccess: boolean;
  gitAccess: boolean;
  sqliteAccess: boolean;
  webServerAccess?: boolean;
  agentsAccess: boolean;
  calendarAccess?: boolean;
  notificationsAccess?: boolean;
  weatherAccess?: boolean;
  threadsAccess?: boolean;
  cronsAccess?: boolean;
  metidosAccess: boolean;
  pluginAccessGroups?: string[];
  permissions: string[];
  unsafeMode: 0 | 1;
  lastRunDate: number | null;
  lastRunStatus: CronJobRunStatus | null;
  enabled: 0 | 1;
  deletedAt: number | null;
  createdAt: string;
  updatedAt: string;
  nextRunDate: number | null;
};

export type CronJobRunRecord = {
  id: number;
  cronJobId: number;
  threadId: number;
  runDate: number;
  runStatus: CronJobRunStatus;
};

type CronJobInput = {
  projectId: number;
  worktreePath: string;
  schedule: string;
  prompt: string;
  title: string;
  description: string;
  model: string;
  reasoningEffort: string;
  webSearchAccess?: boolean | null;
  githubAccess?: boolean | null;
  gitAccess?: boolean | null;
  sqliteAccess?: boolean | null;
  webServerAccess?: boolean | null;
  agentsAccess?: boolean | null;
  calendarAccess?: boolean | null;
  notificationsAccess?: boolean | null;
  weatherAccess?: boolean | null;
  threadsAccess?: boolean | null;
  cronsAccess?: boolean | null;
  metidosAccess?: boolean | null;
  pluginAccessGroups?: string[] | null;
  permissions?: string[] | null;
  unsafeMode?: boolean | null;
  enabled?: boolean | null;
};

type CronJobUpdateInput = {
  projectId?: number;
  worktreePath?: string;
  schedule?: string;
  prompt?: string;
  title?: string;
  description?: string;
  model?: string;
  reasoningEffort?: string;
  webSearchAccess?: boolean;
  githubAccess?: boolean;
  gitAccess?: boolean;
  sqliteAccess?: boolean;
  webServerAccess?: boolean;
  agentsAccess?: boolean;
  calendarAccess?: boolean;
  notificationsAccess?: boolean;
  weatherAccess?: boolean;
  threadsAccess?: boolean;
  cronsAccess?: boolean;
  metidosAccess?: boolean;
  pluginAccessGroups?: string[];
  permissions?: string[];
  unsafeMode?: boolean;
  enabled?: boolean;
};

type CronJobRunInput = {
  cronJobId: number;
  threadId: number;
  runDate: number;
  runStatus: CronJobRunStatus;
};

type CronJobSqlRecord = Omit<
  CronJobRecord,
  | "agentsAccess"
  | "calendarAccess"
  | "weatherAccess"
  | "githubAccess"
  | "gitAccess"
  | "metidosAccess"
  | "threadsAccess"
  | "cronsAccess"
  | "notificationsAccess"
  | "pluginAccessGroups"
  | "nextRunDate"
  | "sqliteAccess"
  | "webSearchAccess"
  | "webServerAccess"
> & {
  agentsAccess: 0 | 1;
  calendarAccess: 0 | 1;
  weatherAccess?: 0 | 1;
  githubAccess: 0 | 1;
  gitAccess: 0 | 1;
  metidosAccess: 0 | 1;
  threadsAccess?: 0 | 1;
  cronsAccess?: 0 | 1;
  notificationsAccess: 0 | 1;
  pluginAccessGroups: string;
  sqliteAccess: 0 | 1;
  webSearchAccess: 0 | 1;
  webServerAccess?: 0 | 1;
};

/** Compute next run timestamp from a cron schedule expression, if parseable. */
function computeCronJobNextRunDate(
  schedule: string,
  timezone: string,
): number | null {
  if (typeof schedule !== "string" || schedule.trim().length === 0) {
    return null;
  }
  try {
    return computeNextRunDateForLocalCronSchedule(schedule, timezone);
  } catch {
    return null;
  }
}

/** Attach computed `nextRunDate` to a cron record coming out of SQL. */
function hydrateCronJobFromSqlRow(
  database: Database,
  cronJob: CronJobSqlRecord,
  includeNextRunDate: boolean,
): CronJobRecord {
  const {
    agentsAccess: sqlAgentsAccess,
    calendarAccess: sqlCalendarAccess,
    weatherAccess: sqlWeatherAccess,
    githubAccess: sqlGithubAccess,
    gitAccess: sqlGitAccess,
    metidosAccess: sqlMetidosAccess,
    threadsAccess: sqlThreadsAccess,
    cronsAccess: sqlCronsAccess,
    notificationsAccess: sqlNotificationsAccess,
    pluginAccessGroups: sqlPluginAccessGroups,
    permissions: sqlPermissions,
    sqliteAccess: sqlSqliteAccess,
    webSearchAccess: sqlWebSearchAccess,
    webServerAccess: sqlWebServerAccess,
    ...rest
  } = cronJob;
  return {
    ...rest,
    webSearchAccess: sqlWebSearchAccess === 1,
    githubAccess: sqlGithubAccess === 1,
    gitAccess: sqlGitAccess === 1,
    sqliteAccess: sqlSqliteAccess === 1,
    webServerAccess: sqlWebServerAccess === 1,
    agentsAccess: sqlAgentsAccess === 1,
    calendarAccess: sqlCalendarAccess === 1,
    notificationsAccess: sqlNotificationsAccess === 1,
    pluginAccessGroups: parseThreadPluginAccessGroups(sqlPluginAccessGroups),
    permissions: parseStoredThreadPermissions(sqlPermissions),
    threadsAccess:
      typeof sqlThreadsAccess === "number"
        ? sqlThreadsAccess === 1
        : sqlMetidosAccess === 1,
    cronsAccess:
      typeof sqlCronsAccess === "number"
        ? sqlCronsAccess === 1
        : sqlMetidosAccess === 1,
    metidosAccess:
      sqlMetidosAccess === 1 || sqlThreadsAccess === 1 || sqlCronsAccess === 1,
    weatherAccess: sqlWeatherAccess === 1,
    nextRunDate: includeNextRunDate
      ? computeCronJobNextRunDate(
          cronJob.schedule,
          getEffectiveTimezoneForUser(database, LOCAL_SETTINGS_COMPAT_USER_ID),
        )
      : null,
  };
}

/** Execute a SQL statement with optional positional bindings. */
function runStatement(
  database: Database,
  sql: string,
  ...bindings: SQLQueryBindings[]
): ReturnType<Database["run"]> {
  return bindings.length === 0
    ? database.run(sql)
    : database.run(sql, bindings);
}

const STORED_THREAD_PERMISSION_PATTERN =
  /^[a-z][a-z0-9_]{1,63}:[a-z][a-z0-9_-]{0,63}$/;

function parseStoredThreadPermissions(value: unknown): string[] {
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeStoredThreadPermissions(parsed);
  } catch {
    return [];
  }
}

function normalizeStoredThreadPermissions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const permission = item.trim();
    if (STORED_THREAD_PERMISSION_PATTERN.test(permission)) {
      normalized.add(permission);
    }
  }
  return [...normalized].sort((left, right) => left.localeCompare(right));
}

function serializeStoredThreadPermissions(value: unknown): string {
  return JSON.stringify(normalizeStoredThreadPermissions(value));
}

type LegacyAccessInput = {
  agentsAccess?: boolean | number | null;
  calendarAccess?: boolean | number | null;
  cronsAccess?: boolean | number | null;
  githubAccess?: boolean | number | null;
  gitAccess?: boolean | number | null;
  metidosAccess?: boolean | number | null;
  notificationsAccess?: boolean | number | null;
  permissions?: string[] | null;
  pluginAccessGroups?: string[] | null;
  sqliteAccess?: boolean | number | null;
  threadsAccess?: boolean | number | null;
  unsafeMode?: boolean | number | null;
  weatherAccess?: boolean | number | null;
  webSearchAccess?: boolean | number | null;
  webServerAccess?: boolean | number | null;
};

function legacyPluginAccessGroupToPermission(group: string): string | null {
  const [providerId, accessId, ...extra] = group.split("/");
  if (!providerId || !accessId || extra.length > 0) {
    return null;
  }
  try {
    return permissionIdFor(providerId, accessId);
  } catch {
    return null;
  }
}

function resolveInputThreadPermissions(input: LegacyAccessInput): string[] {
  if (Array.isArray(input.permissions)) {
    return normalizeStoredThreadPermissions(input.permissions);
  }
  const permissions = new Set(defaultThreadPermissions());
  const setNative = (
    accessId: string,
    enabled: boolean | number | null | undefined,
  ) => {
    if (enabled === true || enabled === 1) {
      permissions.add(`metidos:${accessId}`);
    } else if (enabled === false || enabled === 0) {
      permissions.delete(`metidos:${accessId}`);
    }
  };

  setNative("web-search", input.webSearchAccess);
  setNative("webserver", input.webServerAccess);
  setNative("github", input.githubAccess);
  setNative("git", input.gitAccess);
  setNative("sqlite", input.sqliteAccess);
  setNative("agents", input.agentsAccess);
  setNative("calendar", input.calendarAccess);
  setNative("notifications", input.notificationsAccess);
  // `metidosAccess` is a legacy aggregate UI flag, not a stored permission id.
  // Canonical access is represented by the narrower metidos:threads and
  // metidos:crons permissions, so hydration derives the aggregate from those
  // concrete scopes instead of persisting a separate metidos:metidos bit.
  const legacyMetidosAccess =
    input.metidosAccess !== false && input.metidosAccess !== 0;
  setNative("threads", input.threadsAccess ?? legacyMetidosAccess);
  setNative("crons", input.cronsAccess ?? legacyMetidosAccess);
  setNative("unsafe", input.unsafeMode);

  for (const group of input.pluginAccessGroups ?? []) {
    const permission = legacyPluginAccessGroupToPermission(group);
    if (permission) {
      permissions.add(permission);
    }
  }

  return normalizeStoredThreadPermissions([...permissions]);
}

function backfillThreadPermissions(db: Database): void {
  if (
    !tableHasColumn(db, "threads", "web_search_access") ||
    !tableHasColumn(db, "threads", "unsafe_mode")
  ) {
    return;
  }
  // Startup-only migration repair: materialize only the legacy subset missing
  // permissions so each row can pass through the compatibility projector before
  // legacy access columns are dropped.
  const rows = db
    .query<
      Omit<LegacyAccessInput, "pluginAccessGroups" | "permissions"> & {
        id: number;
        permissions: string | null;
        pluginAccessGroups: string;
      },
      []
    >(
      `
        SELECT
          id,
          web_search_access AS webSearchAccess,
          github_access AS githubAccess,
          git_access AS gitAccess,
          sqlite_access AS sqliteAccess,
          web_server_access AS webServerAccess,
          agents_access AS agentsAccess,
          calendar_access AS calendarAccess,
          notifications_access AS notificationsAccess,
          threads_access AS threadsAccess,
          crons_access AS cronsAccess,
          metidos_access AS metidosAccess,
          plugin_access_groups AS pluginAccessGroups,
          unsafe_mode AS unsafeMode,
          permissions AS permissions
        FROM threads
        WHERE permissions IS NULL OR permissions = '[]' OR TRIM(permissions) = ''
      `,
    )
    .all();
  const update = db.query("UPDATE threads SET permissions = ? WHERE id = ?");
  for (const row of rows) {
    const { permissions: _permissions, ...legacyAccess } = row;
    update.run(
      serializeStoredThreadPermissions(
        resolveInputThreadPermissions({
          ...legacyAccess,
          pluginAccessGroups: parseThreadPluginAccessGroups(
            row.pluginAccessGroups,
          ),
        }),
      ),
      row.id,
    );
  }
}

function backfillCronJobPermissions(db: Database): void {
  if (
    !tableHasColumn(db, "cron_jobs", "web_search_access") ||
    !tableHasColumn(db, "cron_jobs", "unsafe_mode")
  ) {
    return;
  }
  // Startup-only migration repair: materialize only the legacy subset missing
  // permissions so each row can pass through the compatibility projector before
  // legacy access columns are dropped.
  const rows = db
    .query<
      Omit<LegacyAccessInput, "pluginAccessGroups" | "permissions"> & {
        id: number;
        permissions: string | null;
        pluginAccessGroups: string;
      },
      []
    >(
      `
        SELECT
          id,
          web_search_access AS webSearchAccess,
          github_access AS githubAccess,
          git_access AS gitAccess,
          sqlite_access AS sqliteAccess,
          web_server_access AS webServerAccess,
          agents_access AS agentsAccess,
          calendar_access AS calendarAccess,
          notifications_access AS notificationsAccess,
          threads_access AS threadsAccess,
          crons_access AS cronsAccess,
          metidos_access AS metidosAccess,
          plugin_access_groups AS pluginAccessGroups,
          unsafe_mode AS unsafeMode,
          permissions AS permissions
        FROM cron_jobs
        WHERE permissions IS NULL OR permissions = '[]' OR TRIM(permissions) = ''
      `,
    )
    .all();
  const update = db.query("UPDATE cron_jobs SET permissions = ? WHERE id = ?");
  for (const row of rows) {
    const { permissions: _permissions, ...legacyAccess } = row;
    update.run(
      serializeStoredThreadPermissions(
        resolveInputThreadPermissions({
          ...legacyAccess,
          pluginAccessGroups: parseThreadPluginAccessGroups(
            row.pluginAccessGroups,
          ),
        }),
      ),
      row.id,
    );
  }
}

export type PluginExternalIdentityBindingRecord = {
  pluginId: string;
  sourceId: string;
  externalUserId: string;
  metidosUserId: number;
  verifiedAt: string;
  verifiedBy: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PluginIngressCursorRecord = {
  pluginId: string;
  sourceId: string;
  cursor: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapPluginExternalIdentityBindingRecord(record: {
  plugin_id: string;
  source_id: string;
  external_user_id: string;
  metidos_user_id: number;
  verified_at: string;
  verified_by: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}): PluginExternalIdentityBindingRecord {
  return {
    pluginId: record.plugin_id,
    sourceId: record.source_id,
    externalUserId: record.external_user_id,
    metidosUserId: record.metidos_user_id,
    verifiedAt: record.verified_at,
    verifiedBy: record.verified_by,
    enabled: record.enabled === 1,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function mapPluginIngressCursorRecord(record: {
  plugin_id: string;
  source_id: string;
  cursor: string | null;
  created_at: string;
  updated_at: string;
}): PluginIngressCursorRecord {
  return {
    pluginId: record.plugin_id,
    sourceId: record.source_id,
    cursor: record.cursor,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function assertPluginIdentityBindingText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) {
    throw new Error(`${field} must be between 1 and 200 characters.`);
  }
  return trimmed;
}

export function upsertPluginExternalIdentityBinding(
  database: Database,
  input: {
    pluginId: string;
    sourceId: string;
    externalUserId: string;
    metidosUserId: number;
    verifiedBy: string;
    enabled?: boolean;
  },
): PluginExternalIdentityBindingRecord {
  // This is an administrative verified-identity primitive, not the public
  // ingress throttle. Unverified inbound messages are rate-limited before they
  // can create work via plugin_ingress_rate_limit_markers in ingress-store.ts.
  const user = getUserById(database, input.metidosUserId);
  if (!user?.enabled) {
    throw new Error(
      "Cannot bind external identity to a missing or disabled Metidos user.",
    );
  }
  const pluginId = assertPluginIdentityBindingText(input.pluginId, "pluginId");
  const sourceId = assertPluginIdentityBindingText(input.sourceId, "sourceId");
  const externalUserId = assertPluginIdentityBindingText(
    input.externalUserId,
    "externalUserId",
  );
  const verifiedBy = assertPluginIdentityBindingText(
    input.verifiedBy,
    "verifiedBy",
  );
  database
    .query<unknown, [string, string, string, number, string, number]>(
      `INSERT INTO plugin_external_identity_bindings (
         plugin_id, source_id, external_user_id, metidos_user_id, verified_by, enabled
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(plugin_id, source_id, external_user_id) DO UPDATE SET
         metidos_user_id = excluded.metidos_user_id,
         verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         verified_by = excluded.verified_by,
         enabled = excluded.enabled,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .run(
      pluginId,
      sourceId,
      externalUserId,
      input.metidosUserId,
      verifiedBy,
      input.enabled === false ? 0 : 1,
    );
  const record = getPluginExternalIdentityBinding(
    database,
    pluginId,
    sourceId,
    externalUserId,
  );
  if (!record) throw new Error("Failed to persist external identity binding.");
  return record;
}

export function getPluginExternalIdentityBinding(
  database: Database,
  pluginId: string,
  sourceId: string,
  externalUserId: string,
): PluginExternalIdentityBindingRecord | null {
  const record = database
    .query<
      {
        plugin_id: string;
        source_id: string;
        external_user_id: string;
        metidos_user_id: number;
        verified_at: string;
        verified_by: string;
        enabled: number;
        created_at: string;
        updated_at: string;
      },
      [string, string, string]
    >(
      `SELECT plugin_id, source_id, external_user_id, metidos_user_id,
              verified_at, verified_by, enabled, created_at, updated_at
       FROM plugin_external_identity_bindings
       WHERE plugin_id = ? AND source_id = ? AND external_user_id = ?`,
    )
    .get(pluginId, sourceId, externalUserId);
  return record ? mapPluginExternalIdentityBindingRecord(record) : null;
}

export function resolveEnabledPluginExternalIdentityBinding(
  database: Database,
  pluginId: string,
  sourceId: string,
  externalUserId: string,
): PluginExternalIdentityBindingRecord | null {
  const binding = getPluginExternalIdentityBinding(
    database,
    pluginId,
    sourceId,
    externalUserId,
  );
  if (!binding?.enabled) return null;
  const user = getUserById(database, binding.metidosUserId);
  return user?.enabled ? binding : null;
}

export function setPluginExternalIdentityBindingEnabled(
  database: Database,
  pluginId: string,
  sourceId: string,
  externalUserId: string,
  enabled: boolean,
): PluginExternalIdentityBindingRecord | null {
  database
    .query<unknown, [number, string, string, string]>(
      `UPDATE plugin_external_identity_bindings
       SET enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE plugin_id = ? AND source_id = ? AND external_user_id = ?`,
    )
    .run(enabled ? 1 : 0, pluginId, sourceId, externalUserId);
  return getPluginExternalIdentityBinding(
    database,
    pluginId,
    sourceId,
    externalUserId,
  );
}

export function getPluginIngressCursor(
  database: Database,
  pluginId: string,
  sourceId: string,
): PluginIngressCursorRecord | null {
  const record = database
    .query<
      {
        plugin_id: string;
        source_id: string;
        cursor: string | null;
        created_at: string;
        updated_at: string;
      },
      [string, string]
    >(
      `SELECT plugin_id, source_id, cursor, created_at, updated_at
       FROM plugin_ingress_cursors
       WHERE plugin_id = ? AND source_id = ?`,
    )
    .get(pluginId, sourceId);
  return record ? mapPluginIngressCursorRecord(record) : null;
}

export function upsertPluginIngressCursor(
  database: Database,
  input: { pluginId: string; sourceId: string; cursor?: string | null },
): PluginIngressCursorRecord {
  database
    .query<unknown, [string, string, string | null]>(
      `INSERT INTO plugin_ingress_cursors (plugin_id, source_id, cursor)
       VALUES (?, ?, ?)
       ON CONFLICT(plugin_id, source_id) DO UPDATE SET
         cursor = excluded.cursor,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .run(input.pluginId, input.sourceId, input.cursor ?? null);
  const record = getPluginIngressCursor(
    database,
    input.pluginId,
    input.sourceId,
  );
  if (!record) {
    throw new Error("Failed to persist plugin ingress cursor.");
  }
  return record;
}

/**
 * Run operations inside a transaction and rollback on exceptions.
 *
 * Nested callers join the outer transaction instead of opening a savepoint. That
 * means inner callbacks do not have independent rollback semantics: if an inner
 * callback throws and the outer callback catches the error and continues, any
 * writes already performed by the inner callback remain part of the outer
 * transaction and can still commit. Callers that need isolation must avoid
 * swallowing nested transaction errors or introduce an explicit savepoint.
 */

export function runInTransaction<T>(database: Database, callback: () => T): T {
  if (database.inTransaction) {
    return callback();
  }

  runStatement(database, "BEGIN IMMEDIATE");
  try {
    const result = callback();
    runStatement(database, "COMMIT");
    return result;
  } catch (error) {
    try {
      // Keep caller's original error as primary even if rollback fails.
      runStatement(database, "ROLLBACK");
    } catch {
      // Ignore rollback errors so the original failure surfaces.
    }
    throw error;
  }
}

// The legacy auth migration helpers below only use repository-owned table
// names. tableExists binds the identifier as data for sqlite_master lookups;
// countRows quotes the identifier before interpolating it into SQL, so dynamic
// table names cannot extend the current statement.
function tableExists(db: Database, tableName: string): boolean {
  return Boolean(
    db
      .query<{ name: string }, [string]>(
        `
			SELECT name
			FROM sqlite_master
			WHERE type = 'table' AND name = ?
		`,
      )
      .get(tableName),
  );
}

function countRows(db: Database, tableName: string): number {
  const row = db
    .query<{ count: number }, []>(
      `SELECT COUNT(*) AS count FROM ${quoteSqliteIdentifier(tableName)}`,
    )
    .get();
  return row?.count ?? 0;
}

function getFirstUserId(db: Database): number | null {
  if (!tableExists(db, "users")) {
    return null;
  }
  const row = db
    .query<{ id: number }, []>(
      `
			SELECT id
			FROM users
			ORDER BY id ASC
			LIMIT 1
		`,
    )
    .get();
  return row?.id ?? null;
}

function createBootstrapUser(db: Database): number {
  if (!tableExists(db, "users")) {
    return LOCAL_SETTINGS_COMPAT_USER_ID;
  }
  runStatement(
    db,
    `
			INSERT INTO users (
				username,
				is_admin,
				updated_at
			)
			VALUES (
				?,
				1,
				strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			)
			ON CONFLICT(username) DO UPDATE SET
				is_admin = 1,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		`,
    DEFAULT_BOOTSTRAP_USERNAME,
  );
  const userId = getFirstUserId(db);
  if (userId === null) {
    throw new Error("Failed to create the bootstrap user.");
  }
  return userId;
}

function migrateLegacySingleUserAuth(db: Database): void {
  if (
    !tableExists(db, "user_auth_settings") ||
    !tableExists(db, "auth_settings")
  ) {
    return;
  }
  if (
    countRows(db, "auth_settings") > 0 ||
    countRows(db, "user_auth_settings") === 0
  ) {
    return;
  }

  runStatement(
    db,
    `
			INSERT INTO auth_settings (
				id,
				primary_factor_type,
				primary_factor_hash,
				totp_secret_ciphertext,
				session_lifetime_days,
				failed_primary_factor_attempts,
				locked_until,
				created_at,
				updated_at
			)
			SELECT
				1,
				primary_factor_type,
				primary_factor_hash,
				totp_secret_ciphertext,
				session_lifetime_days,
				failed_primary_factor_attempts,
				locked_until,
				created_at,
				updated_at
			FROM user_auth_settings
			ORDER BY user_id ASC
			LIMIT 1
		`,
  );

  if (tableExists(db, "user_auth_recovery_codes")) {
    runStatement(
      db,
      `
			INSERT INTO auth_recovery_codes (
				code_hash,
				used_at,
				created_at
			)
			SELECT
				code_hash,
				used_at,
				created_at
			FROM user_auth_recovery_codes
			ORDER BY user_id ASC, id ASC
		`,
    );
  }

  if (tableExists(db, "user_auth_sessions")) {
    runStatement(
      db,
      `
			INSERT INTO auth_sessions (
				id,
				issued_at,
				expires_at,
				last_used_at,
				step_up_valid_until
			)
			SELECT
				id,
				issued_at,
				expires_at,
				last_used_at,
				step_up_valid_until
			FROM user_auth_sessions
		`,
    );
  }

  if (tableExists(db, "user_auth_websocket_tickets")) {
    runStatement(
      db,
      `
			INSERT INTO auth_websocket_tickets (
				id,
				session_id,
				issued_at,
				expires_at,
				consumed_at
			)
			SELECT
				id,
				session_id,
				issued_at,
				expires_at,
				consumed_at
			FROM user_auth_websocket_tickets
		`,
    );
  }
}

function initTimezoneSettingsSchema(database: Database): void {
  initAppSchemaTimezoneSettings(database, {
    defaultCommandTimeoutSeconds: DEFAULT_COMMAND_TIMEOUT_SECONDS,
    defaultCommandTimeoutSecondsSql: DEFAULT_COMMAND_TIMEOUT_SECONDS_SQL,
    defaultThreadModel: DEFAULT_THREAD_MODEL,
    defaultThreadReasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
  });
}

function dropLegacySingleUserAuthTables(db: Database): void {
  for (const tableName of [
    "user_auth_websocket_tickets",
    "user_auth_sessions",
    "user_auth_recovery_codes",
    "user_auth_settings",
  ]) {
    if (tableExists(db, tableName)) {
      runStatement(
        db,
        `DROP TABLE IF EXISTS ${quoteSqliteIdentifier(tableName)}`,
      );
    }
  }
}

/**
 * Migrate/create schema and apply incremental column backfills on startup.
 * Keeps the on-disk DB in sync with expected runtime shape.
 * @param db - Database handle to open a transaction against.
 */
export function migrateDatabase(db: Database): void {
  migrateAppSchema(
    db,
    {
      defaultCommandTimeoutSeconds: DEFAULT_COMMAND_TIMEOUT_SECONDS,
      defaultCommandTimeoutSecondsSql: DEFAULT_COMMAND_TIMEOUT_SECONDS_SQL,
      defaultThreadModel: DEFAULT_THREAD_MODEL,
      defaultThreadReasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
    },
    {
      migrateLegacySingleUserAuth,
      dropLegacySingleUserAuthTables,
      backfillThreadPermissions,
      backfillCronJobPermissions,
    },
  );
}

/**
 * Gets app database path.
 * @param options - Configuration options used by this operation.
 */

export function closeAppDatabase(): void {
  /** Close the singleton database handle so maintenance/reset flows can remove the file safely. */

  if (!appDatabase) {
    return;
  }
  appDatabase.close(false);
  appDatabase = null;
}

export function isAppDatabaseOpen(): boolean {
  return appDatabase !== null;
}

/**
 * Deletes the app database files for the resolved app-data directory.
 *
 * The singleton database handle is closed before unlinking files so maintenance
 * flows do not leave open handles to deleted files on Unix or fail deletion on
 * platforms that reject removal of open database files.
 *
 * @param options - Configuration options used by this operation.
 */
export function deleteAppDatabaseFiles(options?: AppDataPathOptions): string[] {
  closeAppDatabase();
  return deleteAppDatabaseFilesForPath(options);
}

/**
 * Initialize and cache the singleton app database handle.
 * Applies migrations to repair/upgrade user data stores in place.
 */

export function applyAppDatabasePragmas(
  database: Database,
  options?: {
    busyTimeoutMs?: number | null;
    journalMode?: string | null;
    synchronous?: string | null;
  },
): void {
  applyAppDatabasePragmasWithRunner(database, runStatement, options);
}

export function initAppDatabase(): Database {
  if (appDatabase) {
    return appDatabase;
  }

  const dbPath = getAppDatabasePath();
  const isInMemoryDatabase = isInMemoryAppDatabasePath(dbPath);
  if (!isInMemoryDatabase) {
    ensureAppDirectory(getAppDatabaseDirectoryPath());
    assertAppDatabaseFilesAreRegular(dbPath);
    applyAppDatabasePermissions(dbPath);
  }

  const db = new Database(dbPath);
  applyAppDatabasePragmas(db, {
    busyTimeoutMs: SQL_BUSY_TIMEOUT_MS,
  });
  migrateDatabase(db);
  if (!isInMemoryDatabase) {
    applyAppDatabasePermissions(dbPath);
  }
  appDatabase = db;
  return db;
}

type UserSqlRecord = Omit<UserRecord, "enabled" | "isAdmin"> & {
  enabled: 0 | 1;
  isAdmin: 0 | 1;
};

function hydrateUserFromSqlRow(user: UserSqlRecord): UserRecord {
  return {
    ...user,
    enabled: user.enabled === 1,
    isAdmin: user.isAdmin === 1,
  };
}

function normalizeOptionalProfileText(
  value: string | null | undefined,
  label: string,
  maxBytes: number,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (Buffer.byteLength(trimmed, "utf8") > maxBytes) {
    throw new Error(`${label} must be at most ${maxBytes} bytes.`);
  }
  return trimmed;
}

function getFirstConfiguredAuthUserId(database: Database): number | null {
  // Auth settings are a singleton local-operator credential row. The table does
  // not persist per-user ownership, so this helper only answers whether setup is
  // complete and chooses a legacy-compatible local-operator id for callers that
  // omit an explicit authenticated user id. Request-path code must pass the
  // current session user id to getAuthSettings/upsert helpers when that display
  // owner matters; changing the first row in users must not be treated as a
  // credential ownership migration.
  const row = database
    .query<{ configured: number }, []>(
      `
			SELECT CASE
				WHEN EXISTS (
					SELECT 1
					FROM auth_settings
					WHERE id = 1
						AND length(trim(totp_secret_ciphertext)) > 0
				) THEN 1
				ELSE 0
			END AS configured
		`,
    )
    .get();
  if (row?.configured !== 1) {
    return null;
  }
  return getFirstUserId(database) ?? LOCAL_SETTINGS_COMPAT_USER_ID;
}

function resolveRequiredAuthUserId(
  database: Database,
  userId?: number | null,
): number {
  // Compatibility shim for legacy persistence helpers and unit tests that still
  // pass through auth ownership fields. Request-path callers should pass the
  // authenticated local-operator id; this fallback must stay isolated to
  // low-level DB helpers until those historical call sites are retired. Creating
  // the bootstrap user here is not an auth bypass: auth remains unconfigured
  // until auth_settings contains an enrolled TOTP secret.
  if (typeof userId === "number") {
    return userId;
  }
  const existingUserId =
    getFirstConfiguredAuthUserId(database) ?? getFirstUserId(database);
  if (existingUserId !== null) {
    return existingUserId;
  }
  if (!tableExists(database, "users")) {
    return LOCAL_SETTINGS_COMPAT_USER_ID;
  }
  return createBootstrapUser(database);
}

const LOCAL_SETTINGS_COMPAT_USER_ID = 1;

// This id is a legacy compatibility sentinel, not a reserved row in the modern
// users table. Synthetic users are only returned when old single-operator data
// has configured auth_settings but no users table yet; as soon as a users table
// exists, all reads use real rows so id=1 cannot shadow or impersonate a real
// local operator.
function buildSyntheticLocalOperatorUser(): UserRecord {
  const now = new Date(0).toISOString();
  return {
    id: LOCAL_SETTINGS_COMPAT_USER_ID,
    username: DEFAULT_BOOTSTRAP_USERNAME,
    displayName: null,
    email: null,
    enabled: true,
    isAdmin: true,
    createdAt: now,
    updatedAt: now,
  };
}

function readSyntheticLocalOperatorUser(
  database: Database,
  username?: string | null,
): UserRecord | null {
  if (
    tableExists(database, "users") ||
    countConfiguredAuthUsers(database) === 0
  ) {
    return null;
  }
  const user = buildSyntheticLocalOperatorUser();
  if (typeof username === "string" && username.trim() !== user.username) {
    return null;
  }
  return user;
}

export function resolveSingletonLocalSettingsUserId(
  _database?: Database | null,
): number {
  return LOCAL_SETTINGS_COMPAT_USER_ID;
}

export function createUser(database: Database, input: UserInput): UserRecord {
  if (!tableExists(database, "users")) {
    return buildSyntheticLocalOperatorUser();
  }
  runStatement(
    database,
    `
			INSERT INTO users (
				username,
				is_admin,
				updated_at
			)
			VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		`,
    input.username.trim(),
    input.isAdmin ? 1 : 0,
  );
  const user = getUserByUsername(database, input.username);
  if (!user) {
    throw new Error(`Failed to create local operator "${input.username}".`);
  }
  return user;
}

export function updateUserAdminStatus(
  database: Database,
  userId: number,
  isAdmin: boolean,
): UserRecord {
  runStatement(
    database,
    `
			UPDATE users
			SET
				is_admin = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    isAdmin ? 1 : 0,
    userId,
  );
  const user = getUserById(database, userId);
  if (!user) {
    throw new Error(`Failed to update admin state for user ${userId}.`);
  }
  return user;
}

export function getUserById(
  database: Database,
  userId: number,
): UserRecord | null {
  if (!tableExists(database, "users")) {
    const synthetic = readSyntheticLocalOperatorUser(database);
    return synthetic?.id === userId ? synthetic : null;
  }
  const user = database
    .query<UserSqlRecord, [number]>(
      `
			SELECT
				id,
				username,
				display_name AS displayName,
				email,
				enabled,
				is_admin AS isAdmin,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM users
			WHERE id = ?
		`,
    )
    .get(userId);
  return user ? hydrateUserFromSqlRow(user) : null;
}

export function getUserByUsername(
  database: Database,
  username: string,
): UserRecord | null {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) {
    return null;
  }
  if (!tableExists(database, "users")) {
    return readSyntheticLocalOperatorUser(database, normalizedUsername);
  }

  const user = database
    .query<UserSqlRecord, [string]>(
      `
			SELECT
				id,
				username,
				display_name AS displayName,
				email,
				enabled,
				is_admin AS isAdmin,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM users
			WHERE username = ?
		`,
    )
    .get(normalizedUsername);
  return user ? hydrateUserFromSqlRow(user) : null;
}

// User rows are retained and disabled/updated instead of hard-deleted. Auth
// settings, audit events, sessions, notifications, and plugin attribution use
// stable user ids as historical references; adding hard deletion would require
// an explicit data-retention migration rather than a low-level DB helper.
export function listUsers(database: Database): UserRecord[] {
  if (!tableExists(database, "users")) {
    const synthetic = readSyntheticLocalOperatorUser(database);
    return synthetic ? [synthetic] : [];
  }
  return database
    .query<UserSqlRecord, []>(
      `
			SELECT
				id,
				username,
				display_name AS displayName,
				email,
				enabled,
				is_admin AS isAdmin,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM users
			ORDER BY username COLLATE NOCASE ASC, id ASC
		`,
    )
    .all()
    .map(hydrateUserFromSqlRow);
}

export function updateUserProfile(
  database: Database,
  userId: number,
  input: UserProfileUpdateInput,
): UserRecord {
  const updates: string[] = [];
  const bindings: Array<boolean | number | string | null> = [];

  if (Object.hasOwn(input, "displayName")) {
    updates.push("display_name = ?");
    bindings.push(
      normalizeOptionalProfileText(
        input.displayName,
        "Display name",
        MAX_USER_DISPLAY_NAME_BYTES,
      ),
    );
  }
  if (Object.hasOwn(input, "email")) {
    updates.push("email = ?");
    bindings.push(
      normalizeOptionalProfileText(input.email, "Email", MAX_USER_EMAIL_BYTES),
    );
  }
  if (typeof input.enabled === "boolean") {
    updates.push("enabled = ?");
    bindings.push(input.enabled ? 1 : 0);
  }

  const existing = getUserById(database, userId);
  if (!existing) {
    throw new Error(`User ${userId} was not found.`);
  }
  if (updates.length > 0) {
    runStatement(
      database,
      `
				UPDATE users
				SET
					${updates.join(",\n\t\t\t\t\t")},
					updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				WHERE id = ?
			`,
      ...bindings,
      userId,
    );
  }
  if (input.enabled === false) {
    deleteAllAuthSessions(database, userId);
  }
  const user = getUserById(database, userId);
  if (!user) {
    throw new Error(`Failed to update user ${userId}.`);
  }
  return user;
}

export function resetUserOtpEnrollment(
  database: Database,
  userId: number,
): UserRecord {
  return runInTransaction(database, () => {
    const existing = getUserById(database, userId);
    if (!existing) {
      throw new Error(`User ${userId} was not found.`);
    }
    runStatement(
      database,
      `
				UPDATE auth_settings
				SET
					totp_secret_ciphertext = '',
					failed_primary_factor_attempts = 0,
					locked_until = NULL,
					updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				WHERE id = 1
			`,
    );
    runStatement(database, "DELETE FROM auth_recovery_codes");
    deleteAllAuthSessions(database, userId);
    return existing;
  });
}

export function listUsersWithSetupStatus(
  database: Database,
): UserSetupRecord[] {
  const configured = countConfiguredAuthUsers(database) > 0;
  return listUsers(database).map((user) => ({
    ...user,
    configured,
  }));
}

export function countConfiguredAuthUsers(database: Database): number {
  const row = database
    .query<{ count: number }, []>(
      `
			SELECT COUNT(*) AS count
			FROM auth_settings
			WHERE id = 1
				AND length(trim(totp_secret_ciphertext)) > 0
		`,
    )
    .get();
  return row?.count ?? 0;
}

export function listKnownAuthUsernames(database: Database): string[] {
  if (countConfiguredAuthUsers(database) === 0) {
    return [];
  }
  const user = getUserById(
    database,
    getFirstConfiguredAuthUserId(database) ??
      resolveRequiredAuthUserId(database),
  );
  return user ? [user.username] : [];
}

/**
 * Gets auth settings.
 * @param database - Database instance to read authentication settings from.
 */

export function getTerminalSettings(
  database: Database,
): TerminalSettingsRecord {
  const record = database
    .query<
      {
        default_shell: string;
        replay_buffer_bytes: number;
      },
      []
    >(
      `
			SELECT default_shell, replay_buffer_bytes
			FROM terminal_settings
			WHERE id = 1
		`,
    )
    .get();
  return {
    defaultShell: record?.default_shell ?? "",
    replayBufferBytes: record?.replay_buffer_bytes ?? 5 * 1024 * 1024,
  };
}

const TERMINAL_DEFAULT_SHELL_ALLOWLIST = new Set([
  "bash",
  "bash.exe",
  "cmd.exe",
  "fish",
  "fish.exe",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "sh",
  "sh.exe",
  "zsh",
  "zsh.exe",
]);

function normalizeTerminalDefaultShell(input: string): string {
  const shell = input.trim();
  if (!shell) return "";
  const customShellAllowed =
    process.env.METIDOS_ALLOW_CUSTOM_TERMINAL_SHELL === "true";
  if (
    !customShellAllowed &&
    !TERMINAL_DEFAULT_SHELL_ALLOWLIST.has(basename(shell).toLowerCase())
  ) {
    throw new Error(
      "Terminal default shell must be a known shell unless METIDOS_ALLOW_CUSTOM_TERMINAL_SHELL=true.",
    );
  }
  if (isAbsolute(shell)) {
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(shell);
    } catch {
      throw new Error("Terminal default shell must point to a file.");
    }
    if (!stat.isFile()) {
      throw new Error("Terminal default shell must point to a file.");
    }
    if ((stat.mode & 0o022) !== 0) {
      throw new Error(
        "Terminal default shell must not be writable by group or other users.",
      );
    }
    return realpathSync(shell);
  }
  return shell;
}

export function updateTerminalSettings(
  database: Database,
  input: Partial<TerminalSettingsRecord>,
): TerminalSettingsRecord {
  const current = getTerminalSettings(database);
  const defaultShell =
    typeof input.defaultShell === "string"
      ? normalizeTerminalDefaultShell(input.defaultShell)
      : current.defaultShell;
  const replayBufferBytes =
    typeof input.replayBufferBytes === "number" &&
    Number.isFinite(input.replayBufferBytes)
      ? Math.max(
          64 * 1024,
          Math.min(Math.floor(input.replayBufferBytes), 128 * 1024 * 1024),
        )
      : current.replayBufferBytes;
  runStatement(
    database,
    `
			INSERT INTO terminal_settings (id, default_shell, replay_buffer_bytes, updated_at)
			VALUES (1, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			ON CONFLICT(id) DO UPDATE SET
				default_shell = excluded.default_shell,
				replay_buffer_bytes = excluded.replay_buffer_bytes,
				updated_at = excluded.updated_at
		`,
    defaultShell,
    replayBufferBytes,
  );
  return getTerminalSettings(database);
}

function defaultRuntimeTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function normalizeTimezoneSetting(value: unknown): string {
  const timezone = typeof value === "string" ? value.trim() : "";
  if (!timezone) {
    return "";
  }
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
  return timezone;
}

function getTimezoneSetting(database: Database): string {
  const record = database
    .query<{ timezone: string }, []>(
      `
			SELECT timezone
			FROM app_settings
			WHERE id = 1
		`,
    )
    .get();
  return record?.timezone?.trim() ?? "";
}

function readLocalSettingsRow(database: Database): {
  // Local runtime settings are singleton app settings for the single local
  // operator model; outer APIs keep a userId for RPC shape compatibility while
  // this row remains intentionally app-scoped.
  command_timeout_seconds: number;
  embedding_model: string;
  updated_at: string;
} {
  initTimezoneSettingsSchema(database);
  return (
    database
      .query<
        {
          command_timeout_seconds: number;
          embedding_model: string;
          updated_at: string;
        },
        []
      >(
        `
			SELECT command_timeout_seconds, embedding_model, updated_at
			FROM app_settings
			WHERE id = 1
		`,
      )
      .get() ?? {
      command_timeout_seconds: DEFAULT_COMMAND_TIMEOUT_SECONDS,
      embedding_model: "",
      updated_at: new Date().toISOString(),
    }
  );
}

function normalizeCommandTimeoutSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Command timeout must be a finite number of seconds.");
  }
  const timeoutSeconds = Math.trunc(value);
  if (timeoutSeconds < 1) {
    throw new Error("Command timeout must be at least 1 second.");
  }
  return timeoutSeconds;
}

export function getEffectiveTimezoneForUser(
  database: Database,
  _userId: number,
): string {
  return getTimezoneSetting(database) || defaultRuntimeTimezone();
}

export function getTimezoneSettings(
  database: Database,
  userId: number,
): TimezoneSettingsRecord {
  const timezone = getTimezoneSetting(database);
  const localSettings = readLocalSettingsRow(database);

  return {
    effectiveTimezone: timezone || defaultRuntimeTimezone(),
    timezone,
    userId,
    updatedAt: localSettings.updated_at,
  };
}

export function getUserRuntimeSettings(
  database: Database,
  userId: number,
): UserRuntimeSettingsRecord {
  const record = readLocalSettingsRow(database);
  const commandTimeoutSeconds = normalizeCommandTimeoutSeconds(
    record.command_timeout_seconds,
  );
  return {
    commandTimeoutSeconds,
    embeddingModel: record.embedding_model.trim(),
    userId,
    updatedAt: record.updated_at,
  };
}

export function updateUserRuntimeSettings(
  database: Database,
  userId: number,
  input: Partial<
    Pick<UserRuntimeSettingsRecord, "commandTimeoutSeconds" | "embeddingModel">
  >,
): UserRuntimeSettingsRecord {
  initTimezoneSettingsSchema(database);
  if (typeof input.commandTimeoutSeconds === "number") {
    const commandTimeoutSeconds = normalizeCommandTimeoutSeconds(
      input.commandTimeoutSeconds,
    );
    runStatement(
      database,
      `
				UPDATE app_settings
				SET command_timeout_seconds = ?,
					updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				WHERE id = 1
			`,
      commandTimeoutSeconds,
    );
  }

  if (typeof input.embeddingModel === "string") {
    runStatement(
      database,
      `
				UPDATE app_settings
				SET embedding_model = ?,
					updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				WHERE id = 1
			`,
      input.embeddingModel.trim(),
    );
  }

  return getUserRuntimeSettings(database, userId);
}

export function updateTimezoneSettings(
  database: Database,
  userId: number,
  input: Partial<Pick<TimezoneSettingsRecord, "timezone">>,
): TimezoneSettingsRecord {
  initTimezoneSettingsSchema(database);
  if (typeof input.timezone === "string") {
    const timezone = normalizeTimezoneSetting(input.timezone);
    runStatement(
      database,
      `
				UPDATE app_settings
				SET timezone = ?,
					updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				WHERE id = 1
			`,
      timezone,
    );
  }

  return getTimezoneSettings(database, userId);
}

export function getAuthSettings(
  database: Database,
  userId?: number | null,
): AuthSettingsRecord | null {
  const resolvedUserId =
    typeof userId === "number"
      ? userId
      : getFirstConfiguredAuthUserId(database);
  if (resolvedUserId === null) {
    return null;
  }

  // Auth settings are singleton app credentials in the local-operator model;
  // resolvedUserId preserves the caller-facing owner shape while the table row
  // remains id=1 for compatibility with legacy single-user stores. When userId
  // is omitted, the returned userId is only a legacy/default display owner, not a
  // source of authorization truth.
  const settings = database
    .query<Omit<AuthSettingsRecord, "userId">, []>(
      `
			SELECT
				primary_factor_type AS primaryFactorType,
				primary_factor_hash AS primaryFactorHash,
				totp_secret_ciphertext AS totpSecretCiphertext,
				totp_last_used_counter AS totpLastUsedCounter,
				session_lifetime_days AS sessionLifetimeDays,
				failed_primary_factor_attempts AS failedPrimaryFactorAttempts,
				locked_until AS lockedUntil,
				created_at AS createdAt,
				updated_at AS updatedAt
			FROM auth_settings
			WHERE id = 1
		`,
    )
    .get();
  return settings
    ? {
        ...settings,
        userId: resolvedUserId,
      }
    : null;
}
/**
 * Upserts auth settings.
 * @param database - Database instance used to upsert auth settings.
 * @param input - Auth settings payload to persist.
 */

export function upsertAuthSettings(
  database: Database,
  input: AuthSettingsInput,
): AuthSettingsRecord {
  const userId = resolveRequiredAuthUserId(database, input.userId);

  runStatement(
    database,
    `
			INSERT INTO auth_settings (
				id,
				primary_factor_type,
				primary_factor_hash,
				totp_secret_ciphertext,
				session_lifetime_days,
				failed_primary_factor_attempts,
				locked_until,
				updated_at
			)
			VALUES (
				1,
				?,
				?,
				?,
				?,
				0,
				NULL,
				strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			)
			ON CONFLICT(id) DO UPDATE SET
				primary_factor_type = excluded.primary_factor_type,
				primary_factor_hash = excluded.primary_factor_hash,
				totp_secret_ciphertext = excluded.totp_secret_ciphertext,
				session_lifetime_days = excluded.session_lifetime_days,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		`,
    input.primaryFactorType,
    input.primaryFactorHash,
    input.totpSecretCiphertext,
    input.sessionLifetimeDays,
  );

  const settings = getAuthSettings(database, userId);
  if (!settings) {
    throw new Error("Failed to upsert auth settings.");
  }
  return settings;
}
/**
 * Sets auth failure state.
 * @param database - Database instance used to update failure counters.
 * @param failedPrimaryFactorAttempts - Counter for failed primary factor attempts.
 * @param lockedUntil - Timestamp until which account lockout remains.
 */

export function setAuthFailureState(
  database: Database,
  failedPrimaryFactorAttempts: number,
  lockedUntil: string | null,
  userId?: number | null,
): void {
  resolveRequiredAuthUserId(database, userId);
  runStatement(
    database,
    `
			UPDATE auth_settings
			SET
				failed_primary_factor_attempts = ?,
				locked_until = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = 1
		`,
    failedPrimaryFactorAttempts,
    lockedUntil,
  );
}

export function setTotpLastUsedCounter(
  database: Database,
  counter: number,
  userId?: number | null,
): void {
  resolveRequiredAuthUserId(database, userId);
  if (!Number.isInteger(counter) || counter < 0) {
    throw new Error("TOTP last-used counter must be a non-negative integer.");
  }
  runStatement(
    database,
    `
			UPDATE auth_settings
			SET
				totp_last_used_counter = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = 1
		`,
    counter,
  );
}

export function tryAdvanceTotpLastUsedCounter(
  database: Database,
  counter: number,
  userId?: number | null,
): boolean {
  resolveRequiredAuthUserId(database, userId);
  if (!Number.isInteger(counter) || counter < 0) {
    throw new Error("TOTP last-used counter must be a non-negative integer.");
  }
  // Keep TOTP replay rejection atomic: concurrent verifications race on this
  // single conditional UPDATE, so equal or older counters cannot advance the
  // stored value even if the same code matched in the allowed verification window.
  const result = runStatement(
    database,
    `
			UPDATE auth_settings
			SET
				totp_last_used_counter = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = 1
				AND COALESCE(totp_last_used_counter, -1) < ?
		`,
    counter,
    counter,
  );
  return Number(result.changes) > 0;
}
/**
 * Resets auth failure state.
 * @param database - Database instance used to clear failure state.
 */

export function resetAuthFailureState(
  database: Database,
  userId?: number | null,
): void {
  setAuthFailureState(database, 0, null, userId);
}
/**
 * Lists auth recovery codes.
 * @param database - Database instance used to list recovery codes.
 */

export function listAuthRecoveryCodes(
  database: Database,
  userId?: number | null,
): AuthRecoveryCodeRecord[] {
  const resolvedUserId = resolveRequiredAuthUserId(database, userId);
  return database
    .query<Omit<AuthRecoveryCodeRecord, "userId">, []>(
      `
			SELECT
				id,
				code_hash AS codeHash,
				used_at AS usedAt,
				created_at AS createdAt
			FROM auth_recovery_codes
			ORDER BY id ASC
		`,
    )
    .all()
    .map((record) => ({
      ...record,
      userId: resolvedUserId,
    }));
}
/**
 * Replaces auth recovery code hashes.
 * @param database - Database instance used to replace recovery hashes.
 * @param codeHashes - New recovery code hash list to persist.
 */

export function replaceAuthRecoveryCodeHashes(
  database: Database,
  codeHashes: readonly string[],
  userId?: number | null,
): AuthRecoveryCodeRecord[] {
  const resolvedUserId = resolveRequiredAuthUserId(database, userId);

  return runInTransaction(database, () => {
    runStatement(database, "DELETE FROM auth_recovery_codes");
    for (const codeHash of codeHashes) {
      runStatement(
        database,
        `
				INSERT INTO auth_recovery_codes (code_hash)
				VALUES (?)
			`,
        codeHash,
      );
    }

    return listAuthRecoveryCodes(database, resolvedUserId);
  });
}
/**
 * Marks auth recovery code used.
 * @param database - Database instance marking a code as used.
 * @param codeHash - Recovery code hash that was used.
 * @param usedAt - Timestamp at which the recovery code was consumed.
 */

export function markAuthRecoveryCodeUsed(
  database: Database,
  codeHash: string,
  usedAt: string,
  userId?: number | null,
): boolean {
  resolveRequiredAuthUserId(database, userId);
  const result = runStatement(
    database,
    `
			UPDATE auth_recovery_codes
			SET used_at = ?
			WHERE code_hash = ?
				AND used_at IS NULL
		`,
    usedAt,
    codeHash,
  );
  return Number(result.changes) > 0;
}
/**
 * Creates auth session.
 * @param database - Database handle used to create an auth session.
 * @param input - Auth session creation payload.
 */

export function createAuthSession(
  database: Database,
  input: AuthSessionInput,
): AuthSessionRecord {
  const userId = resolveRequiredAuthUserId(database, input.userId);

  runStatement(
    database,
    `
			INSERT INTO auth_sessions (
				id,
				issued_at,
				expires_at,
				last_used_at,
				step_up_valid_until
			)
			VALUES (?, ?, ?, ?, ?)
		`,
    input.id,
    input.issuedAt,
    input.expiresAt,
    input.lastUsedAt,
    input.stepUpValidUntil ?? null,
  );

  const session = getAuthSession(database, input.id);
  if (!session) {
    throw new Error(`Failed to create auth session ${input.id}.`);
  }
  if (session.userId !== userId) {
    throw new Error(`Auth session ${input.id} resolved to the wrong operator.`);
  }
  return session;
}
/**
 * Gets auth session.
 * @param database - Database handle used to fetch a session.
 * @param sessionId - sessionId identifier.
 */

export function getAuthSession(
  database: Database,
  sessionId: string,
): AuthSessionRecord | null {
  const userId =
    getFirstConfiguredAuthUserId(database) ??
    resolveRequiredAuthUserId(database);
  const user =
    getUserById(database, userId) ?? buildSyntheticLocalOperatorUser();
  if (!user.enabled) {
    return null;
  }
  const session = database
    .query<
      Omit<AuthSessionRecord, "isAdmin" | "userId" | "username">,
      [string]
    >(
      `
			SELECT
				id,
				issued_at AS issuedAt,
				expires_at AS expiresAt,
				last_used_at AS lastUsedAt,
				step_up_valid_until AS stepUpValidUntil
			FROM auth_sessions
			WHERE id = ?
		`,
    )
    .get(sessionId);
  return session
    ? {
        ...session,
        isAdmin: user.isAdmin,
        userId: user.id,
        username: user.username,
      }
    : null;
}
/**
 * Touches auth session.
 * @param database - Database handle used to refresh session activity.
 * @param sessionId - sessionId identifier.
 * @param lastUsedAt - Timestamp to update as most recent usage.
 * @param expiresAt - Optional new expiration timestamp.
 */

export function touchAuthSession(
  database: Database,
  sessionId: string,
  lastUsedAt: string,
  expiresAt?: string,
): void {
  /** Refresh session activity and optionally extend its expiry. */

  if (typeof expiresAt === "string") {
    runStatement(
      database,
      `
				UPDATE auth_sessions
				SET
					last_used_at = ?,
					expires_at = ?
				WHERE id = ?
			`,
      lastUsedAt,
      expiresAt,
      sessionId,
    );
    return;
  }

  runStatement(
    database,
    `
			UPDATE auth_sessions
			SET last_used_at = ?
			WHERE id = ?
		`,
    lastUsedAt,
    sessionId,
  );
}

export function touchAuthSessionIfExpiresAfter(
  database: Database,
  sessionId: string,
  lastUsedAt: string,
  expiresAfter: string,
): boolean {
  /**
   * Refresh session activity only while the persisted row is still live.
   * Request-time session resolution checks expiry before touching; this SQL
   * guard closes the concurrent-delete window so a stale request cannot revive
   * an already-expired or removed session after another request has cleaned it.
   */
  const result = runStatement(
    database,
    `
			UPDATE auth_sessions
			SET last_used_at = ?
			WHERE id = ?
				AND expires_at > ?
		`,
    lastUsedAt,
    sessionId,
    expiresAfter,
  );
  return Number(result.changes) > 0;
}
/**
 * Sets auth session step up valid until.
 * @param database - Database handle used to set the optional step-up expiry.
 * @param sessionId - sessionId identifier.
 * @param stepUpValidUntil - Timestamp until step-up authentication remains valid.
 */

export function setAuthSessionStepUpValidUntil(
  database: Database,
  sessionId: string,
  stepUpValidUntil: string | null,
): void {
  /** Store the optional step-up timestamp for a session. */
  runStatement(
    database,
    `
			UPDATE auth_sessions
			SET step_up_valid_until = ?
			WHERE id = ?
		`,
    stepUpValidUntil,
    sessionId,
  );
}
/**
 * Deletes auth session.
 * @param database - Database handle used to delete a session.
 * @param sessionId - sessionId identifier.
 */

export function deleteAuthSession(database: Database, sessionId: string): void {
  // Keep ticket cleanup explicit even though current schemas declare
  // ON DELETE CASCADE. Some tests and older local databases may run with
  // foreign-key enforcement unavailable, and logout must still revoke pending
  // websocket upgrades before removing the session row.
  runStatement(
    database,
    "DELETE FROM auth_websocket_tickets WHERE session_id = ?",
    sessionId,
  );
  runStatement(database, "DELETE FROM auth_sessions WHERE id = ?", sessionId);
}
/**
 * Deletes all auth sessions.
 * @param database - Database handle used to purge all sessions.
 */

export function deleteAllAuthSessions(
  database: Database,
  userId?: number | null,
): number {
  if (typeof userId === "number") {
    resolveRequiredAuthUserId(database, userId);
  }
  // The auth schema stores one local-operator session namespace; userId is a
  // compatibility guard for callers, not a row filter. Sensitive resets should
  // revoke every session and pending websocket ticket in that singleton scope.
  runStatement(database, "DELETE FROM auth_websocket_tickets");
  const result = runStatement(database, "DELETE FROM auth_sessions");
  return Number(result.changes);
}
/**
 * Deletes expired auth sessions.
 * @param database - Database handle used to remove expired sessions.
 * @param now - Current timestamp used to evaluate expiration.
 */

export function deleteExpiredAuthSessions(
  database: Database,
  now: string,
): number {
  /** Remove sessions that are already past their expiry. */

  const result = runStatement(
    database,
    `
			DELETE FROM auth_sessions
			WHERE expires_at <= ?
		`,
    now,
  );
  return Number(result.changes);
}
/**
 * Creates auth web socket ticket.
 * @param database - Database handle used to create a websocket ticket.
 * @param input - Websocket ticket creation input payload.
 */

export function createAuthWebSocketTicket(
  database: Database,
  input: AuthWebSocketTicketInput,
): AuthWebSocketTicketRecord {
  runStatement(
    database,
    `
			INSERT INTO auth_websocket_tickets (
				id,
				session_id,
				issued_at,
				expires_at,
				consumed_at
			)
			VALUES (?, ?, ?, ?, NULL)
		`,
    input.id,
    input.sessionId,
    input.issuedAt,
    input.expiresAt,
  );

  const ticket = getAuthWebSocketTicket(database, input.id);
  if (!ticket) {
    throw new Error(`Failed to create websocket ticket ${input.id}.`);
  }
  return ticket;
}
/**
 * Gets auth web socket ticket.
 * @param database - Database handle used to fetch a websocket ticket.
 * @param ticketId - ticketId identifier.
 */

export function getAuthWebSocketTicket(
  database: Database,
  ticketId: string,
): AuthWebSocketTicketRecord | null {
  return database
    .query<AuthWebSocketTicketRecord, [string]>(
      `
			SELECT
				id,
				session_id AS sessionId,
				issued_at AS issuedAt,
				expires_at AS expiresAt,
				consumed_at AS consumedAt
			FROM auth_websocket_tickets
			WHERE id = ?
		`,
    )
    .get(ticketId);
}
/**
 * Performs consumeAuthWebSocketTicket operation.
 * @param database - Database handle used to consume a websocket ticket.
 * @param ticketId - ticketId identifier.
 * @param consumedAt - Timestamp marking ticket consumption time.
 */

export function consumeAuthWebSocketTicket(
  database: Database,
  ticketId: string,
  consumedAt: string,
  options?: {
    expiresAfter?: string;
    sessionId?: string;
  },
): AuthWebSocketTicketRecord | null {
  /** Consume a websocket ticket only if it has not been consumed before and still matches the validated session/expiry guard. */
  const result = runStatement(
    database,
    `
			UPDATE auth_websocket_tickets
			SET consumed_at = ?
			WHERE id = ?
				AND consumed_at IS NULL
				AND (? IS NULL OR session_id = ?)
				AND (? IS NULL OR expires_at > ?)
		`,
    consumedAt,
    ticketId,
    options?.sessionId ?? null,
    options?.sessionId ?? null,
    options?.expiresAfter ?? null,
    options?.expiresAfter ?? null,
  );
  if (Number(result.changes) === 0) {
    return null;
  }
  return getAuthWebSocketTicket(database, ticketId);
}
/**
 * Deletes expired auth web socket tickets.
 * @param database - Database handle used to purge expired tickets.
 * @param now - Current timestamp used to determine ticket expiry.
 */

export function deleteExpiredAuthWebSocketTickets(
  database: Database,
  now: string,
): number {
  /** Remove websocket tickets that are expired or already consumed. */

  const result = runStatement(
    database,
    `
			DELETE FROM auth_websocket_tickets
			WHERE expires_at <= ?
				OR consumed_at IS NOT NULL
		`,
    now,
  );
  return Number(result.changes);
}
/**
 * Creates security audit event.
 * @param database - Database handle used to create an audit event.
 * @param input - Audit event payload to persist.
 */

export function createSecurityAuditEvent(
  database: Database,
  input: SecurityAuditEventInput,
): SecurityAuditEventRecord {
  /** Persist a security-relevant event so dangerous local actions can be reviewed later. */
  const result = runStatement(
    database,
    `
			INSERT INTO security_audit_events (
				event_type,
				summary_text,
				thread_id,
				project_id,
				worktree_path,
				payload_json
			)
			VALUES (?, ?, ?, ?, ?, ?)
		`,
    input.eventType,
    input.summaryText,
    input.threadId ?? null,
    input.projectId ?? null,
    input.worktreePath ?? null,
    input.payloadJson ?? null,
  );
  const eventId = Number(result.lastInsertRowid);
  const event = database
    .query<SecurityAuditEventRecord, [number]>(
      `
			SELECT
				id,
				event_type AS eventType,
				summary_text AS summaryText,
				thread_id AS threadId,
				project_id AS projectId,
				worktree_path AS worktreePath,
				payload_json AS payloadJson,
				created_at AS createdAt
			FROM security_audit_events
			WHERE id = ?
		`,
    )
    .get(eventId);
  if (!event) {
    throw new Error("Failed to create security audit event.");
  }
  return event;
}
/**
 * Creates a bounded client-side log event record.
 * @param database - Database handle used to create the log event.
 * @param input - Normalized client log payload to persist.
 */

export function createClientLogEvent(
  database: Database,
  input: ClientLogEventInput,
): ClientLogEventRecord {
  const result = runStatement(
    database,
    `
			INSERT INTO client_log_events (
				user_id,
				severity,
				message,
				route,
				context,
				details_json,
				client_timestamp
			)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`,
    input.userId ?? null,
    input.severity,
    input.message,
    input.route ?? null,
    input.context ?? null,
    input.detailsJson ?? null,
    input.clientTimestamp ?? null,
  );
  pruneClientLogEvents(database);
  const event = database
    .query<ClientLogEventRecord, [number]>(
      `
			SELECT
				id,
				user_id AS userId,
				severity,
				message,
				route,
				context,
				details_json AS detailsJson,
				client_timestamp AS clientTimestamp,
				created_at AS createdAt
			FROM client_log_events
			WHERE id = ?
		`,
    )
    .get(Number(result.lastInsertRowid));
  if (!event) {
    throw new Error("Failed to create client log event.");
  }
  return event;
}

export function pruneClientLogEvents(
  database: Database,
  maxRows = 1000,
): number {
  const result = runStatement(
    database,
    `
			DELETE FROM client_log_events
			WHERE id NOT IN (
				SELECT id
				FROM client_log_events
				ORDER BY created_at DESC, id DESC
				LIMIT ?
			)
		`,
    Math.max(1, Math.trunc(maxRows)),
  );
  return Number(result.changes);
}

export function listClientLogEvents(
  database: Database,
  limit = 100,
): ClientLogEventRecord[] {
  return database
    .query<ClientLogEventRecord, [number]>(
      `
			SELECT
				id,
				user_id AS userId,
				severity,
				message,
				route,
				context,
				details_json AS detailsJson,
				client_timestamp AS clientTimestamp,
				created_at AS createdAt
			FROM client_log_events
			ORDER BY created_at DESC, id DESC
			LIMIT ?
		`,
    )
    .all(Math.max(1, Math.trunc(limit)));
}

export function listSecurityAuditEvents(
  database: Database,
  options?: {
    limit?: number;
    projectId?: number;
    threadId?: number;
  },
): SecurityAuditEventRecord[] {
  /** Return persisted security audit events ordered newest-first, optionally scoped to one thread or project. */

  const limit =
    typeof options?.limit === "number" &&
    Number.isInteger(options.limit) &&
    options.limit > 0
      ? options.limit
      : null;
  if (typeof options?.threadId === "number") {
    if (limit !== null) {
      return database
        .query<SecurityAuditEventRecord, [number, number]>(
          `
			SELECT
				id,
				event_type AS eventType,
				summary_text AS summaryText,
				thread_id AS threadId,
				project_id AS projectId,
				worktree_path AS worktreePath,
				payload_json AS payloadJson,
				created_at AS createdAt
			FROM security_audit_events
			WHERE thread_id = ?
			ORDER BY created_at DESC, id DESC
			LIMIT ?
		`,
        )
        .all(options.threadId, limit);
    }

    return database
      .query<SecurityAuditEventRecord, [number]>(
        `
			SELECT
				id,
				event_type AS eventType,
				summary_text AS summaryText,
				thread_id AS threadId,
				project_id AS projectId,
				worktree_path AS worktreePath,
				payload_json AS payloadJson,
				created_at AS createdAt
			FROM security_audit_events
			WHERE thread_id = ?
			ORDER BY created_at DESC, id DESC
		`,
      )
      .all(options.threadId);
  }

  if (typeof options?.projectId === "number") {
    if (limit !== null) {
      return database
        .query<SecurityAuditEventRecord, [number, number]>(
          `
			SELECT
				id,
				event_type AS eventType,
				summary_text AS summaryText,
				thread_id AS threadId,
				project_id AS projectId,
				worktree_path AS worktreePath,
				payload_json AS payloadJson,
				created_at AS createdAt
			FROM security_audit_events
			WHERE project_id = ?
			ORDER BY created_at DESC, id DESC
			LIMIT ?
		`,
        )
        .all(options.projectId, limit);
    }

    return database
      .query<SecurityAuditEventRecord, [number]>(
        `
			SELECT
				id,
				event_type AS eventType,
				summary_text AS summaryText,
				thread_id AS threadId,
				project_id AS projectId,
				worktree_path AS worktreePath,
				payload_json AS payloadJson,
				created_at AS createdAt
			FROM security_audit_events
			WHERE project_id = ?
			ORDER BY created_at DESC, id DESC
		`,
      )
      .all(options.projectId);
  }

  if (limit !== null) {
    return database
      .query<SecurityAuditEventRecord, [number]>(
        `
			SELECT
				id,
				event_type AS eventType,
				summary_text AS summaryText,
				thread_id AS threadId,
				project_id AS projectId,
				worktree_path AS worktreePath,
				payload_json AS payloadJson,
				created_at AS createdAt
			FROM security_audit_events
			ORDER BY created_at DESC, id DESC
			LIMIT ?
		`,
      )
      .all(limit);
  }

  return database
    .query<SecurityAuditEventRecord, []>(
      `
			SELECT
				id,
				event_type AS eventType,
				summary_text AS summaryText,
				thread_id AS threadId,
				project_id AS projectId,
				worktree_path AS worktreePath,
				payload_json AS payloadJson,
				created_at AS createdAt
			FROM security_audit_events
			ORDER BY created_at DESC, id DESC
		`,
    )
    .all();
}
/**
 * Upserts project.
 * @param database - Database handle used to upsert project metadata.
 * @param input - Project metadata to insert or update.
 */

export function upsertProject(
  database: Database,
  input: ProjectInput,
): ProjectRecord {
  const projectInput = {
    projectPath: input.projectPath,
    ...(input.name === undefined ? {} : { name: input.name }),
  } satisfies ProjectStoreInput;

  return upsertProjectRecord(database, projectInput);
}
/**
 * Lists threads.
 * @param database - Database handle used to list threads.
 */

export function listThreads(database: Database): ThreadRecord[] {
  const rows = database
    .query<ThreadSqlRecord, []>(
      `
				SELECT
					threads.id AS id,
					threads.project_id AS projectId,
					threads.worktree_path AS worktreePath,
					threads.cron_job_id AS cronJobId,
				threads.title AS title,
				threads.summary AS summary,
				threads.model AS model,
				threads.reasoning_effort AS reasoningEffort,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:web-search') AS webSearchAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:github') AS githubAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:git') AS gitAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:sqlite') AS sqliteAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:webserver') AS webServerAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:agents') AS agentsAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:calendar') AS calendarAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:notifications') AS notificationsAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value LIKE 'weather:%') AS weatherAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:threads') AS threadsAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:crons') AS cronsAccess,
				(EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:threads') OR EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:crons')) AS metidosAccess,
					threads.plugin_access_groups AS pluginAccessGroups,
					threads.permissions AS permissions,
					EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:unsafe') AS unsafeMode,
					threads.pi_session_id AS piSessionId,
					threads.pi_session_file AS piSessionFile,
					threads.pi_leaf_entry_id AS piLeafEntryId,
					threads.pinned_at AS pinnedAt,
					threads.created_at AS createdAt,
					threads.updated_at AS updatedAt,
					threads.last_run_at AS lastRunAt,
					threads.last_input_tokens AS lastInputTokens,
					threads.last_cached_input_tokens AS lastCachedInputTokens,
					threads.last_output_tokens AS lastOutputTokens,
					threads.max_input_tokens AS maxInputTokens,
					threads.estimated_compaction_trigger_tokens AS estimatedCompactionTriggerTokens,
					threads.compaction_count AS compactionCount,
					threads.last_compaction_at AS lastCompactionAt,
					threads.last_compaction_before_input_tokens AS lastCompactionBeforeInputTokens,
					threads.last_compaction_after_input_tokens AS lastCompactionAfterInputTokens,
					threads.active_turn_started_at AS activeTurnStartedAt,
					threads.last_error_at AS lastErrorAt,
					threads.last_error_seen_at AS lastErrorSeenAt,
					threads.last_error_message AS lastErrorMessage
				FROM threads
				INNER JOIN projects
					ON projects.id = threads.project_id
				WHERE threads.deleted_at IS NULL
					AND projects.deleted_at IS NULL
				ORDER BY
					(threads.pinned_at IS NULL) ASC,
					threads.pinned_at DESC,
					threads.updated_at DESC,
					threads.created_at DESC,
					threads.id DESC
			`,
    )
    .all();
  return rows.map(hydrateThreadFromSqlRow);
}

export function listThreadsPage(
  database: Database,
  options: {
    limit: number;
    offset?: number;
  },
): ThreadRecord[] {
  const limit = Math.max(1, Math.trunc(options.limit));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const rows = database
    .query<ThreadSqlRecord, [number, number]>(
      `
				SELECT
					threads.id AS id,
					threads.project_id AS projectId,
					threads.worktree_path AS worktreePath,
					threads.cron_job_id AS cronJobId,
				threads.title AS title,
				threads.summary AS summary,
				threads.model AS model,
				threads.reasoning_effort AS reasoningEffort,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:web-search') AS webSearchAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:github') AS githubAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:git') AS gitAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:sqlite') AS sqliteAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:webserver') AS webServerAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:agents') AS agentsAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:calendar') AS calendarAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:notifications') AS notificationsAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value LIKE 'weather:%') AS weatherAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:threads') AS threadsAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:crons') AS cronsAccess,
				(EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:threads') OR EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:crons')) AS metidosAccess,
					threads.plugin_access_groups AS pluginAccessGroups,
					threads.permissions AS permissions,
					EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:unsafe') AS unsafeMode,
					threads.pi_session_id AS piSessionId,
					threads.pi_session_file AS piSessionFile,
					threads.pi_leaf_entry_id AS piLeafEntryId,
					threads.pinned_at AS pinnedAt,
					threads.created_at AS createdAt,
					threads.updated_at AS updatedAt,
					threads.last_run_at AS lastRunAt,
					threads.last_input_tokens AS lastInputTokens,
					threads.last_cached_input_tokens AS lastCachedInputTokens,
					threads.last_output_tokens AS lastOutputTokens,
					threads.max_input_tokens AS maxInputTokens,
					threads.estimated_compaction_trigger_tokens AS estimatedCompactionTriggerTokens,
					threads.compaction_count AS compactionCount,
					threads.last_compaction_at AS lastCompactionAt,
					threads.last_compaction_before_input_tokens AS lastCompactionBeforeInputTokens,
					threads.last_compaction_after_input_tokens AS lastCompactionAfterInputTokens,
					threads.active_turn_started_at AS activeTurnStartedAt,
					threads.last_error_at AS lastErrorAt,
					threads.last_error_seen_at AS lastErrorSeenAt,
					threads.last_error_message AS lastErrorMessage
				FROM threads
				INNER JOIN projects
					ON projects.id = threads.project_id
				WHERE threads.deleted_at IS NULL
					AND projects.deleted_at IS NULL
				ORDER BY
					(threads.pinned_at IS NULL) ASC,
					threads.pinned_at DESC,
					threads.updated_at DESC,
					threads.created_at DESC,
					threads.id DESC
				LIMIT ?
				OFFSET ?
			`,
    )
    .all(limit, offset);
  return rows.map(hydrateThreadFromSqlRow);
}

export function listThreadsForUser(
  database: Database,
  _ownerUserId: number,
): ThreadRecord[] {
  return listThreads(database);
}

function listThreadsByIdsFiltered(
  database: Database,
  threadIds: readonly number[],
): ThreadRecord[] {
  if (threadIds.length === 0) {
    return [];
  }

  const placeholders = threadIds.map(() => "?").join(", ");
  const rows = database
    .query<ThreadSqlRecord, number[]>(
      `
				SELECT
					threads.id AS id,
					threads.project_id AS projectId,
					threads.worktree_path AS worktreePath,
					threads.cron_job_id AS cronJobId,
				threads.title AS title,
				threads.summary AS summary,
				threads.model AS model,
				threads.reasoning_effort AS reasoningEffort,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:web-search') AS webSearchAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:github') AS githubAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:git') AS gitAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:sqlite') AS sqliteAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:webserver') AS webServerAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:agents') AS agentsAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:calendar') AS calendarAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:notifications') AS notificationsAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value LIKE 'weather:%') AS weatherAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:threads') AS threadsAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:crons') AS cronsAccess,
				(EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:threads') OR EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:crons')) AS metidosAccess,
					threads.plugin_access_groups AS pluginAccessGroups,
					threads.permissions AS permissions,
					EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:unsafe') AS unsafeMode,
					threads.pi_session_id AS piSessionId,
					threads.pi_session_file AS piSessionFile,
					threads.pi_leaf_entry_id AS piLeafEntryId,
					threads.pinned_at AS pinnedAt,
					threads.created_at AS createdAt,
					threads.updated_at AS updatedAt,
					threads.last_run_at AS lastRunAt,
					threads.last_input_tokens AS lastInputTokens,
					threads.last_cached_input_tokens AS lastCachedInputTokens,
					threads.last_output_tokens AS lastOutputTokens,
					threads.max_input_tokens AS maxInputTokens,
					threads.estimated_compaction_trigger_tokens AS estimatedCompactionTriggerTokens,
					threads.compaction_count AS compactionCount,
					threads.last_compaction_at AS lastCompactionAt,
					threads.last_compaction_before_input_tokens AS lastCompactionBeforeInputTokens,
					threads.last_compaction_after_input_tokens AS lastCompactionAfterInputTokens,
					threads.active_turn_started_at AS activeTurnStartedAt,
					threads.last_error_at AS lastErrorAt,
					threads.last_error_seen_at AS lastErrorSeenAt,
					threads.last_error_message AS lastErrorMessage
				FROM threads
				INNER JOIN projects
					ON projects.id = threads.project_id
				WHERE threads.id IN (${placeholders})
					AND threads.deleted_at IS NULL
					AND projects.deleted_at IS NULL
				ORDER BY
					(threads.pinned_at IS NULL) ASC,
					threads.pinned_at DESC,
					threads.updated_at DESC,
					threads.created_at DESC,
					threads.id DESC
			`,
    )
    .all(...threadIds);
  return rows.map(hydrateThreadFromSqlRow);
}

export function listThreadsByIds(
  database: Database,
  threadIds: readonly number[],
): ThreadRecord[] {
  return listThreadsByIdsFiltered(database, threadIds);
}

export function listThreadsByIdsForUser(
  database: Database,
  _ownerUserId: number,
  threadIds: readonly number[],
): ThreadRecord[] {
  return listThreadsByIdsFiltered(database, threadIds);
}
/**
 * Gets thread by id.
 * @param database - Database handle used to fetch a thread by ID.
 * @param threadId - Thread identifier.
 */

export function getThreadById(
  database: Database,
  threadId: number,
): ThreadRecord | null {
  const thread = database
    .query<ThreadSqlRecord, [number]>(
      `
				SELECT
					threads.id AS id,
					threads.project_id AS projectId,
					threads.worktree_path AS worktreePath,
					threads.cron_job_id AS cronJobId,
				threads.title AS title,
				threads.summary AS summary,
				threads.model AS model,
				threads.reasoning_effort AS reasoningEffort,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:web-search') AS webSearchAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:github') AS githubAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:git') AS gitAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:sqlite') AS sqliteAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:webserver') AS webServerAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:agents') AS agentsAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:calendar') AS calendarAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:notifications') AS notificationsAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value LIKE 'weather:%') AS weatherAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:threads') AS threadsAccess,
				EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:crons') AS cronsAccess,
				(EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:threads') OR EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:crons')) AS metidosAccess,
					threads.plugin_access_groups AS pluginAccessGroups,
					threads.permissions AS permissions,
					EXISTS(SELECT 1 FROM json_each(threads.permissions) WHERE value = 'metidos:unsafe') AS unsafeMode,
					threads.pi_session_id AS piSessionId,
					threads.pi_session_file AS piSessionFile,
					threads.pi_leaf_entry_id AS piLeafEntryId,
					threads.pinned_at AS pinnedAt,
					threads.created_at AS createdAt,
					threads.updated_at AS updatedAt,
					threads.last_run_at AS lastRunAt,
					threads.last_input_tokens AS lastInputTokens,
					threads.last_cached_input_tokens AS lastCachedInputTokens,
					threads.last_output_tokens AS lastOutputTokens,
					threads.max_input_tokens AS maxInputTokens,
					threads.estimated_compaction_trigger_tokens AS estimatedCompactionTriggerTokens,
					threads.compaction_count AS compactionCount,
					threads.last_compaction_at AS lastCompactionAt,
					threads.last_compaction_before_input_tokens AS lastCompactionBeforeInputTokens,
					threads.last_compaction_after_input_tokens AS lastCompactionAfterInputTokens,
					threads.active_turn_started_at AS activeTurnStartedAt,
					threads.last_error_at AS lastErrorAt,
					threads.last_error_seen_at AS lastErrorSeenAt,
					threads.last_error_message AS lastErrorMessage
				FROM threads
				INNER JOIN projects
					ON projects.id = threads.project_id
				WHERE threads.id = ?
					AND threads.deleted_at IS NULL
					AND projects.deleted_at IS NULL
			`,
    )
    .get(threadId);
  return thread ? hydrateThreadFromSqlRow(thread) : null;
}

export function getThreadByIdForUser(
  database: Database,
  _ownerUserId: number,
  threadId: number,
): ThreadRecord | null {
  return getThreadById(database, threadId);
}

export function hasActiveThreadForCronJob(
  database: Database,
  cronJobId: number,
): boolean {
  return Boolean(
    database
      .query<{ id: number }, [number]>(
        `
			SELECT id
			FROM threads
			WHERE cron_job_id = ?
				AND deleted_at IS NULL
				AND active_turn_started_at IS NOT NULL
			LIMIT 1
		`,
      )
      .get(cronJobId),
  );
}

function hydrateThreadFromSqlRow(thread: ThreadSqlRecord): ThreadRecord {
  const {
    agentsAccess: sqlAgentsAccess,
    calendarAccess: sqlCalendarAccess,
    weatherAccess: sqlWeatherAccess,
    pluginAccessGroups: sqlPluginAccessGroups,
    permissions: sqlPermissions,
    githubAccess: sqlGithubAccess,
    gitAccess: sqlGitAccess,
    metidosAccess: sqlMetidosAccess,
    threadsAccess: sqlThreadsAccess,
    cronsAccess: sqlCronsAccess,
    notificationsAccess: sqlNotificationsAccess,
    sqliteAccess: sqlSqliteAccess,
    webSearchAccess: sqlWebSearchAccess,
    webServerAccess: sqlWebServerAccess,
    ...rest
  } = thread;
  return {
    ...rest,
    webSearchAccess: sqlWebSearchAccess === 1,
    githubAccess: sqlGithubAccess === 1,
    gitAccess: sqlGitAccess === 1,
    sqliteAccess: sqlSqliteAccess === 1,
    webServerAccess: sqlWebServerAccess === 1,
    agentsAccess: sqlAgentsAccess === 1,
    calendarAccess: sqlCalendarAccess === 1,
    notificationsAccess: sqlNotificationsAccess === 1,
    threadsAccess:
      typeof sqlThreadsAccess === "number"
        ? sqlThreadsAccess === 1
        : sqlMetidosAccess === 1,
    cronsAccess:
      typeof sqlCronsAccess === "number"
        ? sqlCronsAccess === 1
        : sqlMetidosAccess === 1,
    metidosAccess:
      sqlMetidosAccess === 1 || sqlThreadsAccess === 1 || sqlCronsAccess === 1,
    pluginAccessGroups: parseThreadPluginAccessGroups(sqlPluginAccessGroups),
    permissions: parseStoredThreadPermissions(sqlPermissions),
    weatherAccess: sqlWeatherAccess === 1,
  };
}
/**
 * Creates thread.
 * @param database - Database handle used to create a new thread.
 * @param input - Thread creation payload.
 */

export function createThread(
  database: Database,
  input: ThreadInput,
): ThreadRecord {
  /**
   * Insert a thread row and return the inserted record.
   * Throws if readback fails, which indicates write/read consistency issues.
   */

  const result = runStatement(
    database,
    `
			INSERT INTO threads (
				project_id,
				worktree_path,
				cron_job_id,
				title,
				model,
				reasoning_effort,
				plugin_access_groups,
				permissions,
				pi_session_id,
				pi_session_file,
				pi_leaf_entry_id,
				updated_at
			)
				VALUES (
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				)
		`,
    input.projectId,
    input.worktreePath,
    input.cronJobId ?? null,
    input.title,
    input.model,
    input.reasoningEffort,
    serializeThreadPluginAccessGroups(input.pluginAccessGroups),
    serializeStoredThreadPermissions(resolveInputThreadPermissions(input)),
    input.piSessionId ?? null,
    input.piSessionFile ?? null,
    input.piLeafEntryId ?? null,
  );
  const threadId = Number(result.lastInsertRowid);
  const thread = getThreadById(database, threadId);
  if (!thread) {
    throw new Error(`Failed to create thread for project ${input.projectId}`);
  }
  return thread;
}
export function updateThreadPiSessionState(
  database: Database,
  threadId: number,
  input: {
    piSessionId: string | null;
    piSessionFile: string | null;
    piLeafEntryId: string | null;
  },
): void {
  runStatement(
    database,
    `
			UPDATE threads
			SET
				pi_session_id = ?,
				pi_session_file = ?,
				pi_leaf_entry_id = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    input.piSessionId,
    input.piSessionFile,
    input.piLeafEntryId,
    threadId,
  );
}
/**
 * Performs renameThread operation.
 * @param database - Database handle used to rename a thread.
 * @param threadId - Thread identifier.
 * @param title - New thread title.
 * @param summary - New thread summary text.
 */

export function renameThread(
  database: Database,
  threadId: number,
  title: string,
  summary?: string | null,
): void {
  /** Rename a thread, persist optional summary changes, and refresh updated_at so clients accept the metadata patch as fresh state. */

  if (typeof summary !== "undefined") {
    runStatement(
      database,
      `
				UPDATE threads
				SET
					title = ?,
					summary = ?,
					updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				WHERE id = ?
			`,
      title,
      summary,
      threadId,
    );
    return;
  }

  runStatement(
    database,
    `
			UPDATE threads
			SET
				title = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    title,
    threadId,
  );
}
/**
 * Sets thread model.
 * @param database - Database handle used to set thread model.
 * @param threadId - Thread identifier.
 * @param model - Model to configure for the thread.
 */

export function setThreadModel(
  database: Database,
  threadId: number,
  model: string,
): void {
  /** Persist selected model and update audit timestamp. */
  runStatement(
    database,
    `
			UPDATE threads
			SET
				model = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    model,
    threadId,
  );
}
/**
 * Sets thread reasoning effort.
 * @param database - Database handle used to set reasoning effort.
 * @param threadId - Thread identifier.
 * @param reasoningEffort - Reasoning effort value to persist.
 */

export function setThreadReasoningEffort(
  database: Database,
  threadId: number,
  reasoningEffort: string,
): void {
  /** Persist selected reasoning effort and refresh update time. */

  runStatement(
    database,
    `
			UPDATE threads
			SET
				reasoning_effort = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    reasoningEffort,
    threadId,
  );
}
/**
 * Sets thread access controls.
 * @param database - Database handle used to update thread access.
 * @param threadId - Thread identifier.
 * @param input - Access flag input.
 */

export function setThreadAccess(
  database: Database,
  threadId: number,
  input: {
    webSearchAccess: boolean;
    githubAccess: boolean;
    gitAccess: boolean;
    sqliteAccess: boolean;
    webServerAccess: boolean;
    agentsAccess: boolean;
    calendarAccess: boolean;
    notificationsAccess: boolean;
    weatherAccess: boolean;
    threadsAccess: boolean;
    cronsAccess: boolean;
    metidosAccess: boolean;
    pluginAccessGroups: string[];
    permissions?: string[] | null;
    unsafeMode: boolean;
  },
): void {
  /**
   * Persist access controls and refresh the thread's modified timestamp.
   * `unsafeMode` is persisted through the canonical `metidos:unsafe`
   * permission when legacy boolean flags are projected; callers that pass an
   * explicit `permissions` array own the exact permission set by design.
   */
  runStatement(
    database,
    `
			UPDATE threads
			SET
				plugin_access_groups = ?,
				permissions = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    serializeThreadPluginAccessGroups(input.pluginAccessGroups),
    serializeStoredThreadPermissions(resolveInputThreadPermissions(input)),
    threadId,
  );
}
/**
 * Sets thread unsafe mode.
 * @param database - Database handle used to update thread unsafe-mode.
 * @param threadId - Thread identifier.
 * @param unsafeMode - Unsafe-mode value to persist.
 */

export function setThreadUnsafeMode(
  database: Database,
  threadId: number,
  unsafeMode: boolean,
): void {
  /** Set unsafe mode and keep canonical permission strings synchronized. */
  const currentPermissions = new Set(
    getThreadById(database, threadId)?.permissions ?? [],
  );
  if (unsafeMode) {
    currentPermissions.add("metidos:unsafe");
  } else {
    currentPermissions.delete("metidos:unsafe");
  }
  runStatement(
    database,
    `
			UPDATE threads
			SET
				permissions = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    serializeStoredThreadPermissions([...currentPermissions]),
    threadId,
  );
}
/**
 * Sets thread pinned.
 * @param database - Database handle used to pin or unpin a thread.
 * @param threadId - Thread identifier.
 * @param pinned - Desired thread pinned state.
 */

export function setThreadPinned(
  database: Database,
  threadId: number,
  pinned: boolean,
): void {
  /**
   * Toggle pinned state by setting or clearing `pinned_at` and refresh
   * `updated_at` so realtime/thread-detail freshness keys observe the change.
   */

  runStatement(
    database,
    `
			UPDATE threads
			SET
				pinned_at = CASE
					WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
					ELSE NULL
				END,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    pinned ? 1 : 0,
    threadId,
  );
}
/**
 * Soft deletes a thread.
 * @param database - Database handle used to mark a thread as deleted.
 * @param threadId - Thread identifier.
 */

export function deleteThread(database: Database, threadId: number): void {
  /** Keep thread deletion soft so history remains auditable. */
  runStatement(
    database,
    `
			UPDATE threads
			SET
				deleted_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
				AND deleted_at IS NULL
		`,
    threadId,
  );
}
/**
 * Marks thread ran.
 * @param database - Database handle used to mark thread as executed.
 * @param threadId - Thread identifier.
 */

export function markThreadRan(database: Database, threadId: number): void {
  /** Mark a thread successfully executed and clear transient error state. */

  runStatement(
    database,
    `
			UPDATE threads
			SET
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				last_run_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				active_turn_started_at = NULL,
				last_error_at = NULL,
				last_error_seen_at = NULL,
				last_error_message = NULL
			WHERE id = ?
		`,
    threadId,
  );
}
/**
 * Marks thread run started.
 * @param database - Database handle used to mark thread run start.
 * @param threadId - Thread identifier.
 * @param startedAt - Timestamp when thread run started.
 */

export function markThreadRunStarted(
  database: Database,
  threadId: number,
  startedAt: string,
): void {
  /**
   * Mark a thread turn as in-progress with a caller-provided start timestamp.
   * Mirrors start times across restart/resume scenarios.
   */

  runStatement(
    database,
    `
			UPDATE threads
			SET
				updated_at = ?,
				active_turn_started_at = ?
			WHERE id = ?
		`,
    startedAt,
    startedAt,
    threadId,
  );
}
/**
 * Marks thread stopped.
 * @param database - Database handle used to mark thread as stopped.
 * @param threadId - Thread identifier.
 * @param message - Message payload.
 * @param stoppedAt - Optional stop timestamp shared with live runtime status.
 */

export function markThreadStopped(
  database: Database,
  threadId: number,
  message: string,
  stoppedAt?: string,
): void {
  /** Mark thread as stopped with one timestamp for list recency and status state. */
  const stoppedTimestamp = stoppedAt?.trim() ? stoppedAt : null;
  runStatement(
    database,
    `
			UPDATE threads
			SET
				updated_at = COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				last_run_at = COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				active_turn_started_at = NULL,
				last_error_at = COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				last_error_seen_at = COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				last_error_message = ?
			WHERE id = ?
		`,
    stoppedTimestamp,
    stoppedTimestamp,
    stoppedTimestamp,
    stoppedTimestamp,
    message,
    threadId,
  );
}
/**
 * Sets thread usage.
 * @param database - Database handle used to set thread usage metrics.
 * @param threadId - Thread identifier.
 * @param usage - Usage metrics payload for the thread.
 * @param compactionStats - Compaction metadata included in usage metrics.
 */

export function setThreadUsage(
  database: Database,
  threadId: number,
  usage: ThreadUsageInput,
  compactionStats: ThreadCompactionStatsInput,
): void {
  /** Store latest token usage and compaction telemetry for thread analytics. */

  runStatement(
    database,
    `
			UPDATE threads
			SET
				last_input_tokens = ?,
				last_cached_input_tokens = ?,
				last_output_tokens = ?,
				max_input_tokens = ?,
				estimated_compaction_trigger_tokens = ?,
				compaction_count = ?,
				last_compaction_at = ?,
				last_compaction_before_input_tokens = ?,
				last_compaction_after_input_tokens = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.outputTokens,
    compactionStats.maxInputTokens,
    compactionStats.estimatedCompactionTriggerTokens,
    compactionStats.compactionCount,
    compactionStats.lastCompactionAt,
    compactionStats.lastCompactionBeforeInputTokens,
    compactionStats.lastCompactionAfterInputTokens,
    threadId,
  );
}
/**
 * Marks thread failed.
 * @param database - Database handle used to mark thread as failed.
 * @param threadId - Thread identifier.
 * @param errorMessage - Failure message to persist for the thread.
 */

export function markThreadFailed(
  database: Database,
  threadId: number,
  errorMessage: string,
): void {
  /** Capture a hard failure and make it visible as last error for UI surfacing. */
  runStatement(
    database,
    `
			UPDATE threads
			SET
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				active_turn_started_at = NULL,
				last_error_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
				last_error_seen_at = NULL,
				last_error_message = ?
			WHERE id = ?
		`,
    errorMessage,
    threadId,
  );
}
/**
 * Marks thread error seen.
 * @param database - Database handle used to mark thread error as acknowledged.
 * @param threadId - Thread identifier.
 */

export function markThreadErrorSeen(
  database: Database,
  threadId: number,
): void {
  /**
   * Mark last error as acknowledged by user.
   * If no prior error exists, leave `last_error_seen_at` null.
   */

  runStatement(
    database,
    `
			UPDATE threads
			SET
				last_error_seen_at = CASE
					WHEN last_error_at IS NULL THEN NULL
					ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				END
			WHERE id = ?
		`,
    threadId,
  );
}
/**
 * Lists threads with in progress messages.
 * @param database - Database handle used to list in-progress thread messages.
 */

export function listThreadsWithInProgressMessages(
  database: Database,
): InProgressThreadMessageRecord[] {
  /** Summarize latest activity update per thread for in-flight UI restoration. */
  return database
    .query<InProgressThreadMessageRecord, []>(
      `
				SELECT
					thread_id AS threadId,
					MAX(COALESCE(updated_at, created_at)) AS lastUpdatedAt
				FROM thread_messages
				WHERE state = 'in_progress'
				GROUP BY thread_id
			`,
    )
    .all();
}
/**
 * Lists thread messages.
 * @param database - Database handle used to list thread messages.
 * @param threadId - Thread identifier.
 */

export function listThreadMessages(
  database: Database,
  threadId: number,
): ThreadMessageRecord[] {
  /** Return all messages in canonical order for a thread. */

  return database
    .query<ThreadMessageRecord, [number]>(
      `
				SELECT
					id,
					thread_id AS threadId,
					role,
					kind,
					item_id AS itemId,
					text,
					state,
					payload_json AS payloadJson,
					created_at AS createdAt,
					COALESCE(updated_at, created_at) AS updatedAt
				FROM thread_messages
				WHERE thread_id = ?
				ORDER BY id ASC
			`,
    )
    .all(threadId);
}
/**
 * Lists thread messages page.
 * @param database - Database handle used to fetch a paginated message list.
 * @param threadId - Thread identifier.
 * @param options - Configuration options used by this operation.
 */

const THREAD_MESSAGES_PAGE_DEFAULT_LIMIT = 100;
const THREAD_MESSAGES_PAGE_MIN_LIMIT = 1;
const THREAD_MESSAGES_PAGE_MAX_LIMIT = 200;

function normalizeThreadMessagesPageLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return THREAD_MESSAGES_PAGE_DEFAULT_LIMIT;
  }
  return Math.min(
    THREAD_MESSAGES_PAGE_MAX_LIMIT,
    Math.max(THREAD_MESSAGES_PAGE_MIN_LIMIT, Math.floor(limit)),
  );
}

export function listThreadMessagesPage(
  database: Database,
  threadId: number,
  options?: {
    cursor?: number | null;
    limit?: number;
  },
): {
  messages: ThreadMessageRecord[];
  nextCursor: number | null;
} {
  // Keep the store-level page size bounded even when called outside RPC
  // procedures. The SQL uses bound LIMIT/cursor parameters after this integer
  // clamp so user-supplied pagination values cannot create unbounded reads or
  // alter the query shape.
  const limit = normalizeThreadMessagesPageLimit(options?.limit);
  const pageSize = limit + 1;
  const cursor = typeof options?.cursor === "number" ? options.cursor : null;
  const rows =
    cursor === null
      ? database
          .query<ThreadMessageRecord, [number, number]>(
            `
				SELECT
					id,
					thread_id AS threadId,
					role,
					kind,
					item_id AS itemId,
					text,
					state,
					payload_json AS payloadJson,
					created_at AS createdAt,
					COALESCE(updated_at, created_at) AS updatedAt
				FROM thread_messages
				WHERE thread_id = ?
				ORDER BY id DESC
				LIMIT ?
			`,
          )
          .all(threadId, pageSize)
      : database
          .query<ThreadMessageRecord, [number, number, number]>(
            `
				SELECT
					id,
					thread_id AS threadId,
					role,
					kind,
					item_id AS itemId,
					text,
					state,
					payload_json AS payloadJson,
					created_at AS createdAt,
					COALESCE(updated_at, created_at) AS updatedAt
				FROM thread_messages
				WHERE thread_id = ?
					AND id < ?
				ORDER BY id DESC
				LIMIT ?
			`,
          )
          .all(threadId, cursor, pageSize);
  const hasMore = rows.length > limit;
  const pageRows = (hasMore ? rows.slice(0, limit) : rows).reverse();
  return {
    messages: pageRows,
    nextCursor:
      hasMore && pageRows.length > 0 ? (pageRows[0]?.id ?? null) : null,
  };
}
/**
 * Inserts a thread message row and returns its database id.
 * @param database - Database handle used to create a thread message.
 * @param input - Message payload to persist for the thread.
 */
export function writeThreadMessage(
  database: Database,
  input: ThreadMessageInput,
): number {
  const result = runStatement(
    database,
    `
			INSERT INTO thread_messages (
				thread_id,
				role,
				kind,
				item_id,
				text,
				state,
				payload_json,
				updated_at
			)
			VALUES (?, ?, 'chat', NULL, ?, NULL, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		`,
    input.threadId,
    input.role,
    input.text,
    input.payloadJson ?? null,
  );
  return Number(result.lastInsertRowid);
}

/**
 * Creates thread message.
 * @param database - Database handle used to create a thread message.
 * @param input - Message payload to persist for the thread.
 */
export function createThreadMessage(
  database: Database,
  input: ThreadMessageInput,
): ThreadMessageRecord {
  /** Insert a message row using default chat activity values and return inserted row. */
  const messageId = writeThreadMessage(database, input);
  const message = database
    .query<ThreadMessageRecord, [number]>(
      `
				SELECT
					id,
					thread_id AS threadId,
					role,
					kind,
					item_id AS itemId,
					text,
					state,
					payload_json AS payloadJson,
					created_at AS createdAt,
					COALESCE(updated_at, created_at) AS updatedAt
				FROM thread_messages
				WHERE id = ?
			`,
    )
    .get(messageId);
  if (!message) {
    throw new Error(
      `Failed to create thread message for thread ${input.threadId}`,
    );
  }
  return message;
}
/**
 * Upserts thread activity.
 * @param database - Database handle used to upsert thread activity.
 * @param input - Activity input payload for upsert.
 */

export function upsertThreadActivity(
  database: Database,
  input: ThreadActivityInput,
): void {
  /**
   * Convenience one-item wrapper around multi-activity upsert.
   * Keeps caller code simple when only a single activity update is needed.
   */

  upsertThreadActivities(database, [input]);
}
/**
 * Finds thread activity message id.
 * @param database - Database handle used to locate activity message ID.
 * @param threadId - Thread identifier.
 * @param itemId - itemId identifier.
 */

function findThreadActivityMessageId(
  database: Database,
  threadId: number,
  itemId: string,
): number | null {
  /** Find most recent message row for given thread+item to coalesce activity updates. */
  const existing = database
    .query<{ id: number }, [number, string]>(
      `
				SELECT id
				FROM thread_messages
				WHERE thread_id = ? AND item_id = ?
				ORDER BY id DESC
				LIMIT 1
			`,
    )
    .get(threadId, itemId);
  return existing ? existing.id : null;
}
/**
 * Updates thread activity by id.
 * @param database - Database handle used to update activity by ID.
 * @param messageId - messageId identifier.
 * @param input - Updated activity fields.
 */

function updateThreadActivityById(
  database: Database,
  messageId: number,
  input: ThreadActivityInput,
): boolean {
  /**
   * Apply a full activity upsert payload into an existing row.
   * Returns true when at least one database row changed.
   */

  const result = runStatement(
    database,
    `
			UPDATE thread_messages
			SET
				role = ?,
				kind = ?,
				text = ?,
				state = ?,
				payload_json = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    input.role ?? "assistant",
    input.kind,
    input.text,
    input.state,
    input.payloadJson ?? null,
    messageId,
  );
  return Number(result.changes) > 0;
}
/**
 * Inserts thread activity.
 * @param database - Database handle used to insert thread activity.
 * @param input - Activity payload to insert.
 */

function insertThreadActivity(
  database: Database,
  input: ThreadActivityInput,
): number {
  /** Insert a new activity message row and return the row id for downstream correlation. */
  const result = runStatement(
    database,
    `
			INSERT INTO thread_messages (
				thread_id,
				role,
				kind,
				item_id,
				text,
				state,
				payload_json,
				updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		`,
    input.threadId,
    input.role ?? "assistant",
    input.kind,
    input.itemId,
    input.text,
    input.state,
    input.payloadJson ?? null,
  );
  return Number(result.lastInsertRowid);
}
/**
 * Upserts thread activities.
 * @param database - Database handle used to bulk-upsert thread activities.
 * @param inputs - Activity payloads to upsert in batch.
 */

export function upsertThreadActivities(
  database: Database,
  inputs: readonly ThreadActivityPersistInput[],
): number[] {
  /**
   * Upsert many activity events in one atomic transaction.
   * Reuses known message ids within the batch to avoid duplicate rows for same item.
   */

  if (inputs.length === 0) {
    return [];
  }

  return runInTransaction(database, () => {
    const resolvedMessageIds: number[] = [];
    let messageIdByActivity: Map<string, number> | null = null;

    for (const input of inputs) {
      let messageId =
        typeof input.messageId === "number" ? input.messageId : null;
      let activityKey: string | null = null;

      if (messageId === null) {
        activityKey = `${input.threadId}\u0000${input.itemId}`;
        messageId = messageIdByActivity?.get(activityKey) ?? null;
      }

      if (typeof messageId === "number") {
        // Prefer in-batch update first so duplicate event chunks stay idempotent.
        if (!updateThreadActivityById(database, messageId, input)) {
          messageId = insertThreadActivity(database, input);
        }
      } else {
        const existingMessageId = findThreadActivityMessageId(
          database,
          input.threadId,
          input.itemId,
        );
        // Fall back to DB search for pre-existing activity rows from prior sessions.
        if (typeof existingMessageId === "number") {
          updateThreadActivityById(database, existingMessageId, input);
          messageId = existingMessageId;
        } else {
          messageId = insertThreadActivity(database, input);
        }
      }

      if (activityKey !== null) {
        if (!messageIdByActivity) {
          messageIdByActivity = new Map();
        }
        messageIdByActivity.set(activityKey, messageId);
      } else if (messageIdByActivity) {
        messageIdByActivity.set(
          `${input.threadId}\u0000${input.itemId}`,
          messageId,
        );
      }
      resolvedMessageIds.push(messageId);
    }

    return resolvedMessageIds;
  });
}
/**
 * Performs stopInProgressThreadMessages operation.
 * @param database - Database handle used to stop in-progress messages.
 * @param threadId - Thread identifier.
 */

export function stopInProgressThreadMessages(
  database: Database,
  threadId: number,
): void {
  /** Mark orphaned in-progress messages as stopped (used on restart/cleanup). */
  runStatement(
    database,
    `
			UPDATE thread_messages
			SET
				state = 'stopped',
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE thread_id = ?
				AND state = 'in_progress'
		`,
    threadId,
  );
}

/**
 * Creates a cron job row.
 * @param database - Database handle used to create cron jobs.
 * @param input - Input row.
 */
export function createCronJob(
  database: Database,
  input: CronJobInput,
): CronJobRecord {
  const result = runStatement(
    database,
    `
			INSERT INTO cron_jobs (
				project_id,
				worktree_path,
				schedule,
				prompt,
				title,
				description,
				model,
				reasoning_effort,
				plugin_access_groups,
				permissions,
				enabled
			)
				VALUES (
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?,
					?
				)
		`,
    input.projectId,
    input.worktreePath,
    input.schedule,
    input.prompt,
    input.title,
    input.description,
    input.model,
    input.reasoningEffort,
    serializeThreadPluginAccessGroups(input.pluginAccessGroups),
    serializeStoredThreadPermissions(resolveInputThreadPermissions(input)),
    input.enabled === false ? 0 : 1,
  );
  const cronJob = getCronJobById(database, Number(result.lastInsertRowid));
  if (!cronJob) {
    throw new Error(
      `Failed to create cron job for project ${input.projectId} and workspace ${input.worktreePath}`,
    );
  }
  return cronJob;
}

/**
 * Lists cron jobs.
 * @param database - Database handle used to list cron jobs.
 */
export function listCronJobs(database: Database): CronJobRecord[] {
  /** Load all cron jobs with latest settings. */
  const rows = database
    .query<CronJobSqlRecord, []>(
      `
			SELECT
				cron_jobs.id AS id,
				cron_jobs.project_id AS projectId,
				cron_jobs.worktree_path AS worktreePath,
				cron_jobs.schedule AS schedule,
				cron_jobs.prompt AS prompt,
				cron_jobs.title AS title,
				cron_jobs.description AS description,
				cron_jobs.model AS model,
				cron_jobs.reasoning_effort AS reasoningEffort,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:web-search') AS webSearchAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:github') AS githubAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:git') AS gitAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:sqlite') AS sqliteAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:webserver') AS webServerAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:agents') AS agentsAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:calendar') AS calendarAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:notifications') AS notificationsAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value LIKE 'weather:%') AS weatherAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:threads') AS threadsAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:crons') AS cronsAccess,
				(EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:threads') OR EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:crons')) AS metidosAccess,
				cron_jobs.plugin_access_groups AS pluginAccessGroups,
				cron_jobs.permissions AS permissions,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:unsafe') AS unsafeMode,
				cron_jobs.last_run_date AS lastRunDate,
				cron_jobs.last_run_status AS lastRunStatus,
				cron_jobs.enabled AS enabled,
				cron_jobs.deleted_at AS deletedAt,
				cron_jobs.created_at AS createdAt,
				cron_jobs.updated_at AS updatedAt
			FROM cron_jobs
			INNER JOIN projects
				ON projects.id = cron_jobs.project_id
			ORDER BY cron_jobs.id DESC
		`,
    )
    .all();
  return rows.map((cronJob) =>
    hydrateCronJobFromSqlRow(database, cronJob, true),
  );
}

export function listCronJobsForUser(
  database: Database,
  _ownerUserId: number,
): CronJobRecord[] {
  return listCronJobs(database);
}

/**
 * Gets a single cron job by id.
 * @param database - Database handle used to fetch a cron job by ID.
 * @param cronJobId - Cron job identifier.
 */
export function getCronJobById(
  database: Database,
  cronJobId: number,
  options: { includeNextRunDate?: boolean } = {},
): CronJobRecord | null {
  const { includeNextRunDate = true } = options;
  /** Read a cron job row by its id. */
  const cronJob = database
    .query<CronJobSqlRecord, [number]>(
      `
			SELECT
				cron_jobs.id AS id,
				cron_jobs.project_id AS projectId,
				cron_jobs.worktree_path AS worktreePath,
				cron_jobs.schedule AS schedule,
				cron_jobs.prompt AS prompt,
				cron_jobs.title AS title,
				cron_jobs.description AS description,
				cron_jobs.model AS model,
				cron_jobs.reasoning_effort AS reasoningEffort,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:web-search') AS webSearchAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:github') AS githubAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:git') AS gitAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:sqlite') AS sqliteAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:webserver') AS webServerAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:agents') AS agentsAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:calendar') AS calendarAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:notifications') AS notificationsAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value LIKE 'weather:%') AS weatherAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:threads') AS threadsAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:crons') AS cronsAccess,
				(EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:threads') OR EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:crons')) AS metidosAccess,
				cron_jobs.plugin_access_groups AS pluginAccessGroups,
				cron_jobs.permissions AS permissions,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:unsafe') AS unsafeMode,
				cron_jobs.last_run_date AS lastRunDate,
				cron_jobs.last_run_status AS lastRunStatus,
				cron_jobs.enabled AS enabled,
				cron_jobs.deleted_at AS deletedAt,
				cron_jobs.created_at AS createdAt,
				cron_jobs.updated_at AS updatedAt
			FROM cron_jobs
			INNER JOIN projects
				ON projects.id = cron_jobs.project_id
			WHERE cron_jobs.id = ?
		`,
    )
    .get(cronJobId);
  return cronJob
    ? hydrateCronJobFromSqlRow(database, cronJob, includeNextRunDate)
    : null;
}

export function getCronJobByIdForUser(
  database: Database,
  _ownerUserId: number,
  cronJobId: number,
  options: { includeNextRunDate?: boolean } = {},
): CronJobRecord | null {
  return getCronJobById(database, cronJobId, options);
}

/**
 * Updates a cron job row.
 * @param database - Database handle used to update cron job metadata.
 * @param cronJobId - Cron job identifier.
 * @param input - patch input.
 */
export function updateCronJob(
  database: Database,
  cronJobId: number,
  input: CronJobUpdateInput,
): CronJobRecord {
  const updates: string[] = [];
  const bindings: SQLQueryBindings[] = [];

  if (typeof input.projectId === "number") {
    updates.push("project_id = ?");
    bindings.push(input.projectId);
  }

  if (typeof input.worktreePath === "string") {
    updates.push("worktree_path = ?");
    bindings.push(input.worktreePath);
  }

  if (typeof input.schedule === "string") {
    updates.push("schedule = ?");
    bindings.push(input.schedule);
  }

  if (typeof input.prompt === "string") {
    updates.push("prompt = ?");
    bindings.push(input.prompt);
  }

  if (typeof input.title === "string") {
    updates.push("title = ?");
    bindings.push(input.title);
  }

  if (typeof input.description === "string") {
    updates.push("description = ?");
    bindings.push(input.description);
  }

  if (typeof input.model === "string") {
    updates.push("model = ?");
    bindings.push(input.model);
  }

  if (typeof input.reasoningEffort === "string") {
    updates.push("reasoning_effort = ?");
    bindings.push(input.reasoningEffort);
  }

  const hasAccessUpdates = [
    input.webSearchAccess,
    input.githubAccess,
    input.gitAccess,
    input.sqliteAccess,
    input.webServerAccess,
    input.agentsAccess,
    input.calendarAccess,
    input.notificationsAccess,
    input.weatherAccess,
    input.threadsAccess,
    input.cronsAccess,
    input.metidosAccess,
    input.unsafeMode,
  ].some((value) => typeof value === "boolean");

  if (hasAccessUpdates && !Array.isArray(input.permissions)) {
    updates.push("permissions = ?");
    bindings.push(
      serializeStoredThreadPermissions(resolveInputThreadPermissions(input)),
    );
  }

  if (Array.isArray(input.pluginAccessGroups)) {
    updates.push("plugin_access_groups = ?");
    bindings.push(serializeThreadPluginAccessGroups(input.pluginAccessGroups));
  }

  if (Array.isArray(input.permissions)) {
    updates.push("permissions = ?");
    bindings.push(serializeStoredThreadPermissions(input.permissions));
  }

  if (typeof input.enabled === "boolean") {
    updates.push("enabled = ?");
    bindings.push(input.enabled ? 1 : 0);
  }

  if (!updates.length) {
    throw new Error("No cron job fields to update.");
  }

  const sql = `
			UPDATE cron_jobs
			SET
				${updates.join(", ")},
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`;

  runStatement(database, sql, ...bindings, cronJobId);
  const cronJob = getCronJobById(database, cronJobId);
  if (!cronJob) {
    throw new Error(`Cron job not found: ${cronJobId}`);
  }
  return cronJob;
}

/**
 * Lists enabled, non-deleted cron jobs.
 * @param database - Database handle used to list active cron jobs.
 */
export function listActiveCronJobs(database: Database): CronJobRecord[] {
  /** Read cron jobs that are enabled and not soft-deleted. */
  const rows = database
    .query<CronJobSqlRecord, []>(
      `
			SELECT
				cron_jobs.id AS id,
				cron_jobs.project_id AS projectId,
				cron_jobs.worktree_path AS worktreePath,
				cron_jobs.schedule AS schedule,
				cron_jobs.prompt AS prompt,
				cron_jobs.title AS title,
				cron_jobs.description AS description,
				cron_jobs.model AS model,
				cron_jobs.reasoning_effort AS reasoningEffort,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:web-search') AS webSearchAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:github') AS githubAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:git') AS gitAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:sqlite') AS sqliteAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:webserver') AS webServerAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:agents') AS agentsAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:calendar') AS calendarAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:notifications') AS notificationsAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value LIKE 'weather:%') AS weatherAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:threads') AS threadsAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:crons') AS cronsAccess,
				(EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:threads') OR EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:crons')) AS metidosAccess,
				cron_jobs.plugin_access_groups AS pluginAccessGroups,
				cron_jobs.permissions AS permissions,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:unsafe') AS unsafeMode,
				cron_jobs.last_run_date AS lastRunDate,
				cron_jobs.last_run_status AS lastRunStatus,
				cron_jobs.enabled AS enabled,
				cron_jobs.deleted_at AS deletedAt,
				cron_jobs.created_at AS createdAt,
				cron_jobs.updated_at AS updatedAt
			FROM cron_jobs
			INNER JOIN projects
				ON projects.id = cron_jobs.project_id
			WHERE cron_jobs.enabled = 1
				AND cron_jobs.deleted_at IS NULL
				AND projects.deleted_at IS NULL
			ORDER BY cron_jobs.id ASC
		`,
    )
    .all();
  return rows.map((cronJob) =>
    hydrateCronJobFromSqlRow(database, cronJob, false),
  );
}

/**
 * Sets cron job enabled state.
 * @param database - Database handle used to enable/disable cron job.
 * @param cronJobId - Cron job identifier.
 * @param enabled - enabled state.
 */
export function setCronJobEnabled(
  database: Database,
  cronJobId: number,
  enabled: boolean,
): void {
  /** Toggle cron job scheduling state. */
  runStatement(
    database,
    `
			UPDATE cron_jobs
			SET
				enabled = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    enabled ? 1 : 0,
    cronJobId,
  );
}

/**
 * Soft deletes a cron job by setting deletedAt.
 * @param database - Database handle used to mark a cron job as deleted.
 * @param cronJobId - Cron job identifier.
 */
export function softDeleteCronJob(database: Database, cronJobId: number): void {
  /** Disable and soft-delete a cron job so historical run rows remain. */
  runStatement(
    database,
    `
			UPDATE cron_jobs
			SET
				deleted_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
				enabled = 0,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    cronJobId,
  );
}

/**
 * Updates cron job last-run metadata.
 * @param database - Database handle used to record cron last run timestamp.
 * @param cronJobId - Cron job identifier.
 * @param inputRunDate - Last run date (ms since epoch).
 * @param status - Last run status.
 */
export function updateCronJobLastRun(
  database: Database,
  cronJobId: number,
  inputRunDate: number,
  status: CronJobRunStatus,
): void {
  /** Persist runtime execution metadata for scheduler visibility. */
  runStatement(
    database,
    `
			UPDATE cron_jobs
			SET
				last_run_date = ?,
				last_run_status = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
		`,
    inputRunDate,
    status,
    cronJobId,
  );
}

/**
 * Claims due cron jobs and marks them as in progress.
 * @param database - Database handle used to claim cron jobs for execution.
 * @param schedule - Cron schedule expression that triggered.
 * @param runDate - Run time in ms since epoch.
 */
export function claimCronJobsForScheduledRun(
  database: Database,
  schedule: string,
  runDate: number,
): CronJobRecord[] {
  /** Claim due jobs atomically by matching schedule and outdated last-run timestamp. */
  const rows = database
    .query<CronJobSqlRecord, [number, string, number]>(
      `
			UPDATE cron_jobs
			SET
				last_run_date = ?,
				last_run_status = 'InProgress',
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id IN (
				SELECT id
				FROM cron_jobs
				WHERE schedule = ?
					AND enabled = 1
					AND deleted_at IS NULL
					AND (
						last_run_status IS NULL
						OR last_run_status != 'InProgress'
					)
					AND NOT EXISTS (
						SELECT 1
						FROM threads
						WHERE threads.cron_job_id = cron_jobs.id
							AND threads.deleted_at IS NULL
							AND threads.active_turn_started_at IS NOT NULL
					)
					AND (
						last_run_date IS NULL
						OR last_run_date < ?
					)
			)
			RETURNING
				cron_jobs.id AS id,
				1 AS ownerUserId,
				cron_jobs.project_id AS projectId,
				cron_jobs.worktree_path AS worktreePath,
				cron_jobs.schedule AS schedule,
				cron_jobs.prompt AS prompt,
				cron_jobs.title AS title,
				cron_jobs.description AS description,
				cron_jobs.model AS model,
				cron_jobs.reasoning_effort AS reasoningEffort,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:web-search') AS webSearchAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:github') AS githubAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:git') AS gitAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:sqlite') AS sqliteAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:webserver') AS webServerAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:agents') AS agentsAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:calendar') AS calendarAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:notifications') AS notificationsAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value LIKE 'weather:%') AS weatherAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:threads') AS threadsAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:crons') AS cronsAccess,
				(EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:threads') OR EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:crons')) AS metidosAccess,
				cron_jobs.plugin_access_groups AS pluginAccessGroups,
				cron_jobs.permissions AS permissions,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:unsafe') AS unsafeMode,
				cron_jobs.last_run_date AS lastRunDate,
				cron_jobs.last_run_status AS lastRunStatus,
				cron_jobs.enabled AS enabled,
				cron_jobs.deleted_at AS deletedAt,
				cron_jobs.created_at AS createdAt,
				cron_jobs.updated_at AS updatedAt
		`,
    )
    .all(runDate, schedule, runDate);
  for (const row of rows) {
    if (typeof row.notificationsAccess !== "number") {
      row.notificationsAccess =
        database
          .query<{ notificationsAccess: 0 | 1 }, [number]>(
            `SELECT EXISTS(SELECT 1 FROM json_each(permissions) WHERE value = 'metidos:notifications') AS notificationsAccess FROM cron_jobs WHERE id = ?`,
          )
          .get(row.id)?.notificationsAccess ?? 0;
    }
  }
  return rows.map((cronJob) =>
    hydrateCronJobFromSqlRow(database, cronJob, false),
  );
}

/**
 * Claims a specific cron job for execution and marks it in progress.
 * Disabled cron jobs are claimable only when explicitly requested for manual runs.
 */
export function claimCronJobForScheduledRunById(
  database: Database,
  cronJobId: number,
  runDate: number,
  options: { includeDisabled?: boolean } = {},
): CronJobRecord[] {
  const includeDisabled = options.includeDisabled === true ? 1 : 0;
  const rows = database
    .query<CronJobSqlRecord, [number, number, number, number]>(
      `
			UPDATE cron_jobs
			SET
				last_run_date = ?,
				last_run_status = 'InProgress',
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
				AND (enabled = 1 OR ? = 1)
				AND deleted_at IS NULL
				AND (
					last_run_status IS NULL
					OR last_run_status != 'InProgress'
				)
				AND NOT EXISTS (
					SELECT 1
					FROM threads
					WHERE threads.cron_job_id = cron_jobs.id
						AND threads.deleted_at IS NULL
						AND threads.active_turn_started_at IS NOT NULL
				)
				AND (
					last_run_date IS NULL
					OR last_run_date < ?
				)
			RETURNING
				cron_jobs.id AS id,
				1 AS ownerUserId,
				cron_jobs.project_id AS projectId,
				cron_jobs.worktree_path AS worktreePath,
				cron_jobs.schedule AS schedule,
				cron_jobs.prompt AS prompt,
				cron_jobs.title AS title,
				cron_jobs.description AS description,
				cron_jobs.model AS model,
				cron_jobs.reasoning_effort AS reasoningEffort,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:web-search') AS webSearchAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:github') AS githubAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:git') AS gitAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:sqlite') AS sqliteAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:webserver') AS webServerAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:agents') AS agentsAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:calendar') AS calendarAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:notifications') AS notificationsAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value LIKE 'weather:%') AS weatherAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:threads') AS threadsAccess,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:crons') AS cronsAccess,
				(EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:threads') OR EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:crons')) AS metidosAccess,
				cron_jobs.plugin_access_groups AS pluginAccessGroups,
				cron_jobs.permissions AS permissions,
				EXISTS(SELECT 1 FROM json_each(cron_jobs.permissions) WHERE value = 'metidos:unsafe') AS unsafeMode,
				cron_jobs.last_run_date AS lastRunDate,
				cron_jobs.last_run_status AS lastRunStatus,
				cron_jobs.enabled AS enabled,
				cron_jobs.deleted_at AS deletedAt,
				cron_jobs.created_at AS createdAt,
				cron_jobs.updated_at AS updatedAt
		`,
    )
    .all(runDate, cronJobId, includeDisabled, runDate);

  for (const row of rows) {
    if (typeof row.notificationsAccess !== "number") {
      row.notificationsAccess =
        database
          .query<{ notificationsAccess: 0 | 1 }, [number]>(
            `SELECT EXISTS(SELECT 1 FROM json_each(permissions) WHERE value = 'metidos:notifications') AS notificationsAccess FROM cron_jobs WHERE id = ?`,
          )
          .get(row.id)?.notificationsAccess ?? 0;
    }
  }
  return rows.map((cronJob) =>
    hydrateCronJobFromSqlRow(database, cronJob, false),
  );
}

/**
 * Creates a cron job run row.
 * @param database - Database handle used to create a cron run record.
 * @param input - Input row.
 */
export function createCronJobRun(
  database: Database,
  input: CronJobRunInput,
): CronJobRunRecord {
  const result = runStatement(
    database,
    `
			INSERT INTO cron_job_runs (
				cron_job_id,
				thread_id,
				run_date,
				run_status
			)
			VALUES (?, ?, ?, ?)
		`,
    input.cronJobId,
    input.threadId,
    input.runDate,
    input.runStatus,
  );
  const runId = Number(result.lastInsertRowid);
  const runRow = getCronJobRunById(database, runId);
  if (!runRow) {
    throw new Error(
      `Failed to create cron job run for cronJobId ${input.cronJobId}`,
    );
  }
  return runRow;
}

/**
 * Reads a cron job run by id.
 * @param database - Database handle used to fetch cron run details.
 * @param runId - Run identifier.
 */
export function getCronJobRunById(
  database: Database,
  runId: number,
): CronJobRunRecord | null {
  /** Read a single run row by primary key. */
  return database
    .query<CronJobRunRecord, [number]>(
      `
			SELECT
				id,
				cron_job_id AS cronJobId,
				thread_id AS threadId,
				run_date AS runDate,
				run_status AS runStatus
			FROM cron_job_runs
			WHERE id = ?
		`,
    )
    .get(runId);
}

/**
 * Updates cron job run status.
 * @param database - Database handle used to update cron run status.
 * @param runId - Run identifier.
 * @param status - New status.
 */
export function updateCronJobRunStatus(
  database: Database,
  runId: number,
  status: CronJobRunStatus,
): void {
  /** Persist terminal run status for scheduler history. */
  runStatement(
    database,
    `
			UPDATE cron_job_runs
			SET run_status = ?
			WHERE id = ?
		`,
    status,
    runId,
  );
}

/**
 * Lists run rows for a specific cron job.
 * @param database - Database handle used to list cron run history.
 * @param cronJobId - Cron job identifier.
 */
export function listCronJobRuns(
  database: Database,
  cronJobId: number,
): CronJobRunRecord[] {
  /** Return run history newest-first for inspection and analytics. */
  return database
    .query<CronJobRunRecord, [number]>(
      `
			SELECT
				id,
				cron_job_id AS cronJobId,
				thread_id AS threadId,
				run_date AS runDate,
				run_status AS runStatus
			FROM cron_job_runs
			WHERE cron_job_id = ?
			ORDER BY run_date DESC, id DESC
		`,
    )
    .all(cronJobId);
}

export function stopInProgressCronJobRuns(
  database: Database,
  cronJobId: number,
): void {
  runStatement(
    database,
    `
			UPDATE cron_job_runs
			SET run_status = 'Stopped'
			WHERE cron_job_id = ?
				AND run_status = 'InProgress'
		`,
    cronJobId,
  );
  runStatement(
    database,
    `
			UPDATE cron_jobs
			SET
				last_run_status = 'Stopped',
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
				AND last_run_status = 'InProgress'
		`,
    cronJobId,
  );
}

export type WebServerShareRecord = {
  id: number;
  claimTokenHash: string;
  threadId: number;
  serverId: number;
  serverInstanceId: string;
  targetPort: number;
  projectId: number | null;
  worktreePath: string | null;
  createdAt: string;
  updatedAt: string;
  stoppedAt: string | null;
  revokedAt: string | null;
};

export type WebServerShareSessionRecord = {
  id: number;
  sessionTokenHash: string;
  threadId: number;
  serverId: number;
  serverInstanceId: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

type CreateWebServerShareInput = {
  claimTokenHash: string;
  threadId: number;
  serverId: number;
  serverInstanceId: string;
  targetPort: number;
  projectId?: number | null;
  worktreePath?: string | null;
};

type CreateWebServerShareSessionInput = {
  sessionTokenHash: string;
  threadId: number;
  serverId: number;
  serverInstanceId: string;
  expiresAt: string;
};

function hydrateWebServerShareFromSqlRow(
  row: WebServerShareRecord,
): WebServerShareRecord {
  return row;
}

function hydrateWebServerShareSessionFromSqlRow(
  row: WebServerShareSessionRecord,
): WebServerShareSessionRecord {
  return row;
}

function nowIsoString(): string {
  return new Date().toISOString();
}

export function createWebServerShare(
  database: Database,
  input: CreateWebServerShareInput,
): WebServerShareRecord {
  runStatement(
    database,
    `
			INSERT INTO web_server_shares (
				claim_token_hash,
				thread_id,
				server_id,
				server_instance_id,
				target_port,
				project_id,
				worktree_path,
				updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		`,
    input.claimTokenHash,
    input.threadId,
    input.serverId,
    input.serverInstanceId,
    input.targetPort,
    input.projectId ?? null,
    input.worktreePath ?? null,
  );
  const share = getWebServerShareByServerInstanceId(
    database,
    input.serverInstanceId,
  );
  if (!share) {
    throw new Error(
      `Failed to create a web-server share for instance ${input.serverInstanceId}.`,
    );
  }
  return share;
}

export function getWebServerShareByServerInstanceId(
  database: Database,
  serverInstanceId: string,
): WebServerShareRecord | null {
  const share = database
    .query<WebServerShareRecord, [string]>(
      `
			SELECT
				id,
				claim_token_hash AS claimTokenHash,
				thread_id AS threadId,
				server_id AS serverId,
				server_instance_id AS serverInstanceId,
				target_port AS targetPort,
				project_id AS projectId,
				worktree_path AS worktreePath,
				created_at AS createdAt,
				updated_at AS updatedAt,
				stopped_at AS stoppedAt,
				revoked_at AS revokedAt
			FROM web_server_shares
			WHERE server_instance_id = ?
			LIMIT 1
		`,
    )
    .get(serverInstanceId);
  return share ? hydrateWebServerShareFromSqlRow(share) : null;
}

export function getActiveWebServerShareByServerInstanceId(
  database: Database,
  serverInstanceId: string,
): WebServerShareRecord | null {
  const share = database
    .query<WebServerShareRecord, [string]>(
      `
			SELECT
				id,
				claim_token_hash AS claimTokenHash,
				thread_id AS threadId,
				server_id AS serverId,
				server_instance_id AS serverInstanceId,
				target_port AS targetPort,
				project_id AS projectId,
				worktree_path AS worktreePath,
				created_at AS createdAt,
				updated_at AS updatedAt,
				stopped_at AS stoppedAt,
				revoked_at AS revokedAt
			FROM web_server_shares
			WHERE server_instance_id = ?
				AND stopped_at IS NULL
				AND revoked_at IS NULL
			LIMIT 1
		`,
    )
    .get(serverInstanceId);
  return share ? hydrateWebServerShareFromSqlRow(share) : null;
}

export type ClaimWebServerShareSessionInput = {
  claimToken: string;
  sessionExpiresAt: string;
  sessionTokenHash: string;
};

const INVALID_WEB_SERVER_SHARE_CLAIM_TOKEN_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

export function claimWebServerShareSession(
  database: Database,
  input: ClaimWebServerShareSessionInput,
): WebServerShareRecord | null {
  return runInTransaction(database, () => {
    const claimTokenHash = hashWebServerShareOpaqueToken(input.claimToken);
    const share = database
      .query<WebServerShareRecord, [string]>(
        `
			SELECT
				id,
				claim_token_hash AS claimTokenHash,
				thread_id AS threadId,
				server_id AS serverId,
				server_instance_id AS serverInstanceId,
				target_port AS targetPort,
				project_id AS projectId,
				worktree_path AS worktreePath,
				created_at AS createdAt,
				updated_at AS updatedAt,
				stopped_at AS stoppedAt,
				revoked_at AS revokedAt
			FROM web_server_shares
			WHERE claim_token_hash = ?
				AND stopped_at IS NULL
				AND revoked_at IS NULL
			LIMIT 1
		`,
      )
      .get(claimTokenHash);
    const referenceClaimTokenHash =
      share?.claimTokenHash ?? INVALID_WEB_SERVER_SHARE_CLAIM_TOKEN_HASH;
    if (
      !timingSafeShareTokenHashEqual(claimTokenHash, referenceClaimTokenHash)
    ) {
      return null;
    }
    if (!share) {
      return null;
    }

    const nextClaimTokenHash = hashWebServerShareOpaqueToken(
      generateWebServerShareOpaqueToken(),
    );
    const rotateResult = runStatement(
      database,
      `
			UPDATE web_server_shares
			SET
				claim_token_hash = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
				AND claim_token_hash = ?
				AND stopped_at IS NULL
				AND revoked_at IS NULL
		`,
      nextClaimTokenHash,
      share.id,
      claimTokenHash,
    );
    if (rotateResult.changes === 0) {
      return null;
    }

    revokeWebServerShareSessionsByServerInstanceId(
      database,
      share.serverInstanceId,
    );
    createWebServerShareSession(database, {
      expiresAt: input.sessionExpiresAt,
      serverId: share.serverId,
      serverInstanceId: share.serverInstanceId,
      sessionTokenHash: input.sessionTokenHash,
      threadId: share.threadId,
    });
    return hydrateWebServerShareFromSqlRow(share);
  });
}

function timingSafeShareTokenHashEqual(
  leftHash: string,
  rightHash: string,
): boolean {
  const left = Buffer.from(leftHash, "hex");
  const right = Buffer.from(rightHash, "hex");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function getActiveWebServerShareByClaimToken(
  database: Database,
  claimToken: string,
): WebServerShareRecord | null {
  const claimTokenHash = hashWebServerShareOpaqueToken(claimToken);
  const share = database
    .query<WebServerShareRecord, [string]>(
      `
			SELECT
				id,
				claim_token_hash AS claimTokenHash,
				thread_id AS threadId,
				server_id AS serverId,
				server_instance_id AS serverInstanceId,
				target_port AS targetPort,
				project_id AS projectId,
				worktree_path AS worktreePath,
				created_at AS createdAt,
				updated_at AS updatedAt,
				stopped_at AS stoppedAt,
				revoked_at AS revokedAt
			FROM web_server_shares
			WHERE claim_token_hash = ?
				AND stopped_at IS NULL
				AND revoked_at IS NULL
			LIMIT 1
		`,
    )
    .get(claimTokenHash);
  return share ? hydrateWebServerShareFromSqlRow(share) : null;
}

export function createWebServerShareSession(
  database: Database,
  input: CreateWebServerShareSessionInput,
): WebServerShareSessionRecord {
  runStatement(
    database,
    `
			INSERT INTO web_server_share_sessions (
				session_token_hash,
				thread_id,
				server_id,
				server_instance_id,
				expires_at
			)
			VALUES (?, ?, ?, ?, ?)
		`,
    input.sessionTokenHash,
    input.threadId,
    input.serverId,
    input.serverInstanceId,
    input.expiresAt,
  );
  const session = getWebServerShareSessionByTokenHash(
    database,
    input.sessionTokenHash,
  );
  if (!session) {
    throw new Error(
      `Failed to create a web-server share session for instance ${input.serverInstanceId}.`,
    );
  }
  return session;
}

export function getWebServerShareSessionByTokenHash(
  database: Database,
  sessionTokenHash: string,
): WebServerShareSessionRecord | null {
  const session = database
    .query<WebServerShareSessionRecord, [string]>(
      `
			SELECT
				id,
				session_token_hash AS sessionTokenHash,
				thread_id AS threadId,
				server_id AS serverId,
				server_instance_id AS serverInstanceId,
				expires_at AS expiresAt,
				revoked_at AS revokedAt,
				created_at AS createdAt
			FROM web_server_share_sessions
			WHERE session_token_hash = ?
			LIMIT 1
		`,
    )
    .get(sessionTokenHash);
  return session ? hydrateWebServerShareSessionFromSqlRow(session) : null;
}

export function deleteExpiredWebServerShareSessions(
  database: Database,
  now = nowIsoString(),
): number {
  const result = runStatement(
    database,
    `
			DELETE FROM web_server_share_sessions
			WHERE expires_at < ?
		`,
    now,
  );
  return result.changes;
}

export function resolveActiveWebServerShareSession(
  database: Database,
  sessionToken: string,
  now = nowIsoString(),
): WebServerShareSessionRecord | null {
  const sessionTokenHash = hashWebServerShareOpaqueToken(sessionToken);
  const session = database
    .query<WebServerShareSessionRecord, [string, string]>(
      `
			SELECT
				id,
				session_token_hash AS sessionTokenHash,
				thread_id AS threadId,
				server_id AS serverId,
				server_instance_id AS serverInstanceId,
				expires_at AS expiresAt,
				revoked_at AS revokedAt,
				created_at AS createdAt
			FROM web_server_share_sessions
			WHERE session_token_hash = ?
				AND revoked_at IS NULL
				AND expires_at > ?
			LIMIT 1
		`,
    )
    .get(sessionTokenHash, now);
  return session ? hydrateWebServerShareSessionFromSqlRow(session) : null;
}

export function revokeWebServerShareSessionsByServerInstanceId(
  database: Database,
  serverInstanceId: string,
): number {
  const result = runStatement(
    database,
    `
			UPDATE web_server_share_sessions
			SET revoked_at = COALESCE(revoked_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			WHERE server_instance_id = ?
				AND revoked_at IS NULL
		`,
    serverInstanceId,
  );
  return result.changes;
}

export function rotateWebServerShareClaimToken(
  database: Database,
  shareId: number,
): void {
  const nextClaimTokenHash = hashWebServerShareOpaqueToken(
    generateWebServerShareOpaqueToken(),
  );
  runStatement(
    database,
    `
			UPDATE web_server_shares
			SET
				claim_token_hash = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE id = ?
				AND stopped_at IS NULL
				AND revoked_at IS NULL
		`,
    nextClaimTokenHash,
    shareId,
  );
}

export function stopWebServerShareByServerInstanceId(
  database: Database,
  serverInstanceId: string,
): boolean {
  return runInTransaction(database, () => {
    revokeWebServerShareSessionsByServerInstanceId(database, serverInstanceId);
    const result = runStatement(
      database,
      `
			UPDATE web_server_shares
			SET
				stopped_at = COALESCE(stopped_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE server_instance_id = ?
				AND stopped_at IS NULL
				AND revoked_at IS NULL
		`,
      serverInstanceId,
    );
    return result.changes > 0;
  });
}

export function stopAllActiveWebServerShares(database: Database): number {
  return runInTransaction(database, () => {
    const activeShares = database
      .query<{ serverInstanceId: string }, []>(
        `
			SELECT server_instance_id AS serverInstanceId
			FROM web_server_shares
			WHERE stopped_at IS NULL
				AND revoked_at IS NULL
		`,
      )
      .all();
    for (const share of activeShares) {
      revokeWebServerShareSessionsByServerInstanceId(
        database,
        share.serverInstanceId,
      );
    }
    const result = runStatement(
      database,
      `
			UPDATE web_server_shares
			SET
				stopped_at = COALESCE(stopped_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE stopped_at IS NULL
				AND revoked_at IS NULL
		`,
    );
    return Math.max(result.changes, activeShares.length);
  });
}
