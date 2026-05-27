/**
 * @file src/bun/plugin/ingress-store.ts
 * @description Durable Plugin System v1 ingress message dedupe and retention store.
 */

import type { Database, SQLQueryBindings } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import {
  PLUGIN_INGRESS_EXTERNAL_ID_MAX_LENGTH,
  PLUGIN_INGRESS_MESSAGE_MAX_LENGTH,
  PLUGIN_INGRESS_SOURCE_ID_MAX_LENGTH,
  PLUGIN_INGRESS_SOURCE_ID_PATTERN,
} from "./ingress";

export const PLUGIN_INGRESS_UNVERIFIED_RETENTION_MS = 24 * 60 * 60 * 1000;
export const PLUGIN_INGRESS_TEXT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const PLUGIN_INGRESS_DEDUPE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
export const PLUGIN_INGRESS_RESPONSE_AUDIT_RETENTION_MS =
  90 * 24 * 60 * 60 * 1000;
export const PLUGIN_INGRESS_AUDIT_PREVIEW_MAX_LENGTH = 160;
export const PLUGIN_INGRESS_UNVERIFIED_WINDOW_LIMIT = 10;
export const PLUGIN_INGRESS_UNVERIFIED_DAILY_LIMIT = 100;
export const PLUGIN_INGRESS_LINK_CODE_TTL_MS = 10 * 60 * 1000;
export const PLUGIN_INGRESS_LINK_CODE_PATTERN = /^[A-Z0-9]{8}$/;

const PLUGIN_INGRESS_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const PLUGIN_INGRESS_LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PLUGIN_INGRESS_LINK_CODE_LENGTH = 8;
// Rejection sampling avoids modulo bias: only accept a byte range that divides
// evenly by the alphabet length, then use modulo within that uniform range.
const PLUGIN_INGRESS_LINK_CODE_UNIFORM_BYTE_LIMIT =
  Math.floor(256 / PLUGIN_INGRESS_LINK_CODE_ALPHABET.length) *
  PLUGIN_INGRESS_LINK_CODE_ALPHABET.length;

const VALID_STATUSES = new Set([
  "unverified",
  "ignored",
  "verified",
  "processed",
  "failed",
]);

const VALID_AUDIT_DECISIONS = new Set([
  "link_code_created",
  "link_code_used",
  "binding_changed",
  "unverified_rejected",
  "routing_failed",
  "message_routed",
  "reply_attempted",
  "reply_succeeded",
  "reply_failed",
]);
const pluginIngressLastCleanupAtMs = new WeakMap<Database, number>();

export type PluginIngressMessageStatus =
  | "unverified"
  | "ignored"
  | "verified"
  | "processed"
  | "failed";

export type PersistPluginIngressMessageInput = {
  pluginId: string;
  sourceId: string;
  externalMessageId: string;
  externalUserId: string;
  conversationId?: string | null;
  messageText: string;
  status: PluginIngressMessageStatus;
  metidosUserId?: number | null;
  responseHandle?: string | null;
  routingMetadata?: string | null;
  errorMetadata?: string | null;
  receivedAt?: string | null;
  now?: Date;
};

export type PluginIngressMessageRecord = {
  id: number;
  pluginId: string;
  sourceId: string;
  externalMessageId: string;
  externalUserId: string;
  conversationId: string | null;
  messageText: string | null;
  messageTextRedactedAt: string | null;
  status: PluginIngressMessageStatus;
  metidosUserId: number | null;
  responseHandle: string | null;
  routingMetadata: string | null;
  errorMetadata: string | null;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type MarkPluginIngressMessageProcessedInput = {
  pluginId: string;
  sourceId: string;
  externalMessageId: string;
  metidosUserId?: number | null;
  threadId: number;
  routingMetadata: Record<string, unknown>;
  now?: Date;
};

export type MarkPluginIngressMessageFailedInput = {
  pluginId: string;
  sourceId: string;
  externalMessageId: string;
  reason: string;
  metidosUserId?: number | null;
  threadId?: number | null;
  errorMetadata?: Record<string, unknown>;
  now?: Date;
};

export type PluginIngressRateLimitMarkerRecord = {
  pluginId: string;
  sourceId: string;
  externalUserId: string;
  conversationId: string | null;
  windowKind: "ten_minute" | "day";
  windowStart: string;
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
};

export type PluginIngressAuditDecision =
  | "link_code_created"
  | "link_code_used"
  | "binding_changed"
  | "unverified_rejected"
  | "routing_failed"
  | "message_routed"
  | "reply_attempted"
  | "reply_succeeded"
  | "reply_failed";

export type CreatePluginIngressAuditEventInput = {
  pluginId: string;
  sourceId: string;
  decision: PluginIngressAuditDecision;
  externalMessageId?: string | null;
  externalUserId?: string | null;
  conversationId?: string | null;
  metidosUserId?: number | null;
  threadId?: number | null;
  success?: boolean;
  reason?: string | null;
  text?: string | null;
  metadata?: Record<string, unknown> | null;
  now?: Date;
};

export type PluginIngressAuditEventRecord = {
  id: number;
  pluginId: string;
  sourceId: string;
  decision: PluginIngressAuditDecision;
  externalMessageId: string | null;
  externalUserId: string | null;
  conversationId: string | null;
  metidosUserId: number | null;
  threadId: number | null;
  success: boolean;
  reason: string | null;
  textPreview: string | null;
  textSha256: string | null;
  metadata: string | null;
  createdAt: string;
};

export type PluginIngressLinkCodeRecord = {
  id: number;
  pluginId: string;
  sourceId: string;
  codeSha256: string;
  expiresAt: string;
  consumedAt: string | null;
  consumedExternalUserId: string | null;
  createdAt: string;
};

export type PluginIngressExternalBindingRecord = {
  id: number;
  pluginId: string;
  sourceId: string;
  externalUserId: string;
  metidosUserId?: number | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PluginIngressRouteConfigRecord = {
  id: number;
  pluginId: string;
  sourceId: string;
  projectId: number;
  worktreePath: string;
  model: string | null;
  permissions: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ListPluginIngressExternalBindingsInput = {
  pluginId?: string | null;
  sourceId?: string | null;
  metidosUserId?: number | null;
};

export type ListPluginIngressRouteConfigsInput = {
  pluginId?: string | null;
  sourceId?: string | null;
  metidosUserId?: number | null;
};

export type UpsertPluginIngressRouteConfigInput = {
  pluginId: string;
  sourceId: string;
  metidosUserId?: number | null;
  projectId: number;
  worktreePath: string;
  model?: string | null;
  permissions: string[];
  enabled?: boolean;
  now?: Date;
};

export type CreatePluginIngressLinkCodeInput = {
  pluginId: string;
  sourceId: string;
  metidosUserId?: number | null;
  code?: string;
  now?: Date;
  ttlMs?: number;
};

export type ConsumePluginIngressLinkCodeInput = {
  pluginId: string;
  sourceId: string;
  metidosUserId?: number | null;
  externalUserId: string;
  code: string;
  now?: Date;
};

export type ConsumePluginIngressLinkCodeForExternalUserInput = {
  pluginId: string;
  sourceId: string;
  externalUserId: string;
  code: string;
  now?: Date;
};

export type ConsumePluginIngressLinkCodeResult =
  | { ok: true; binding: PluginIngressExternalBindingRecord }
  | {
      ok: false;
      reason: "malformed" | "not_found" | "expired" | "consumed" | "ambiguous";
    };

export function initPluginIngressMessageSchema(database: Database): void {
  rebuildPluginIngressTableIfPresent(database, {
    createSql: `CREATE TABLE IF NOT EXISTS plugin_ingress_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      external_message_id TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      conversation_id TEXT,
      message_text TEXT,
      message_text_redacted_at TEXT,
      status TEXT NOT NULL,
      response_handle TEXT,
      routing_metadata TEXT,
      error_metadata TEXT,
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(plugin_id, source_id, external_message_id)
    )`,
    legacyColumns: ["metidos_user_id"],
    tableName: "plugin_ingress_messages",
  });
  database.run(`CREATE INDEX IF NOT EXISTS idx_plugin_ingress_messages_retention
    ON plugin_ingress_messages(status, received_at)`);
  database.run(`CREATE TABLE IF NOT EXISTS plugin_ingress_rate_limit_markers (
    plugin_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    conversation_id TEXT,
    window_kind TEXT NOT NULL,
    window_start TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY(plugin_id, source_id, external_user_id, conversation_id, window_kind, window_start)
  )`);
  rebuildPluginIngressTableIfPresent(database, {
    createSql: `CREATE TABLE IF NOT EXISTS plugin_ingress_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      external_message_id TEXT,
      external_user_id TEXT,
      conversation_id TEXT,
      thread_id INTEGER,
      success INTEGER NOT NULL,
      reason TEXT,
      text_preview TEXT,
      text_sha256 TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    )`,
    legacyColumns: ["metidos_user_id"],
    tableName: "plugin_ingress_audit_events",
  });
  database.run(`CREATE INDEX IF NOT EXISTS idx_plugin_ingress_audit_events_lookup
    ON plugin_ingress_audit_events(plugin_id, source_id, decision, created_at)`);
  rebuildPluginIngressTableIfPresent(database, {
    createSql: `CREATE TABLE IF NOT EXISTS plugin_ingress_link_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      code_sha256 TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      consumed_external_user_id TEXT,
      created_at TEXT NOT NULL
    )`,
    legacyColumns: ["metidos_user_id"],
    tableName: "plugin_ingress_link_codes",
  });
  database.run(`CREATE INDEX IF NOT EXISTS idx_plugin_ingress_link_codes_lookup
    ON plugin_ingress_link_codes(plugin_id, source_id, code_sha256)`);
  rebuildPluginIngressTableIfPresent(database, {
    createSql: `CREATE TABLE IF NOT EXISTS plugin_ingress_external_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(plugin_id, source_id, external_user_id)
    )`,
    legacyColumns: ["metidos_user_id"],
    tableName: "plugin_ingress_external_bindings",
  });
  database.run(`CREATE INDEX IF NOT EXISTS idx_plugin_ingress_external_bindings_lookup
    ON plugin_ingress_external_bindings(plugin_id, source_id, enabled)`);
  rebuildPluginIngressTableIfPresent(database, {
    createSql: `CREATE TABLE IF NOT EXISTS plugin_ingress_route_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      worktree_path TEXT NOT NULL,
      model TEXT,
      permissions_json TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(plugin_id, source_id)
    )`,
    legacyColumns: ["metidos_user_id"],
    tableName: "plugin_ingress_route_configs",
  });
  ensurePluginIngressColumn(
    database,
    "plugin_ingress_route_configs",
    "model",
    "model TEXT",
  );
  database.run(`CREATE INDEX IF NOT EXISTS idx_plugin_ingress_route_configs_lookup
    ON plugin_ingress_route_configs(plugin_id, source_id, enabled)`);
}

function quoteSqliteIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(trimmed)) {
    throw new Error("SQLite identifier contains unsupported characters.");
  }
  return `"${trimmed}"`;
}

function assertSafeSqliteColumnDefinition(columnDefinition: string): string {
  const trimmed = columnDefinition.trim();
  const [columnName] = trimmed.split(/\s+/u);
  if (
    !trimmed ||
    !columnName ||
    trimmed.includes(";") ||
    trimmed.includes("\0") ||
    trimmed.includes("--") ||
    trimmed.includes("/*") ||
    trimmed.includes("*/")
  ) {
    throw new Error("SQLite column definition contains unsupported SQL.");
  }
  quoteSqliteIdentifier(columnName);
  return trimmed;
}

function ensurePluginIngressColumn(
  database: Database,
  tableName: string,
  columnName: string,
  columnDefinition: string,
): void {
  const quotedTableName = quoteSqliteIdentifier(tableName);
  const safeColumnDefinition =
    assertSafeSqliteColumnDefinition(columnDefinition);
  const exists = database
    .query<{ name: string }, []>(`PRAGMA table_info(${quotedTableName})`)
    .all()
    .some((column) => column.name === columnName);
  if (!exists) {
    database.run(
      `ALTER TABLE ${quotedTableName} ADD COLUMN ${safeColumnDefinition}`,
    );
  }
}

function sqliteTableColumns(
  database: Database,
  quotedTableName: string,
): string[] {
  return database
    .query<{ name: string }, []>(`PRAGMA table_info(${quotedTableName})`)
    .all()
    .map((column) => column.name);
}

function rebuildPluginIngressTableIfPresent(
  database: Database,
  input: {
    createSql: string;
    legacyColumns: readonly string[];
    tableName: string;
  },
): void {
  const quotedTableName = quoteSqliteIdentifier(input.tableName);
  const columns = sqliteTableColumns(database, quotedTableName);
  const hasLegacyColumns = columns.some((column) =>
    input.legacyColumns.includes(column),
  );
  if (hasLegacyColumns) {
    const migrationTableName = `__${input.tableName}_migration`;
    const quotedMigrationTableName = quoteSqliteIdentifier(migrationTableName);
    database.transaction(() => {
      database.run(`DROP TABLE IF EXISTS ${quotedMigrationTableName}`);
      database.run(
        `ALTER TABLE ${quotedTableName} RENAME TO ${quotedMigrationTableName}`,
      );
      database.run(input.createSql);
      const migratedColumns = new Set(
        sqliteTableColumns(database, quotedMigrationTableName),
      );
      const currentColumns = sqliteTableColumns(database, quotedTableName);
      const copiedColumns = currentColumns.filter((column) =>
        migratedColumns.has(column),
      );
      if (copiedColumns.length > 0) {
        const columnList = copiedColumns.map(quoteSqliteIdentifier).join(", ");
        database.run(
          `INSERT INTO ${quotedTableName} (${columnList}) SELECT ${columnList} FROM ${quotedMigrationTableName}`,
        );
      }
      database.run(`DROP TABLE ${quotedMigrationTableName}`);
    })();
    return;
  }
  database.run(input.createSql);
}

export function persistPluginIngressMessage(
  database: Database,
  input: PersistPluginIngressMessageInput,
): { record: PluginIngressMessageRecord | null; rateLimited: boolean } {
  validateInput(input);
  initPluginIngressMessageSchema(database);
  const now = input.now ?? new Date();
  maybeCleanupPluginIngressMessages(database, now);
  const nowIso = now.toISOString();
  const conversationId = input.conversationId ?? null;

  if (
    input.status === "unverified" &&
    isUnverifiedOverLimit(database, input, now)
  ) {
    upsertRateLimitMarker(
      database,
      input,
      "ten_minute",
      floorDate(now, 10 * 60 * 1000),
    );
    upsertRateLimitMarker(
      database,
      input,
      "day",
      floorDate(now, 24 * 60 * 60 * 1000),
    );
    return { record: null, rateLimited: true };
  }

  database
    .query(
      `INSERT INTO plugin_ingress_messages (
        plugin_id, source_id, external_message_id, external_user_id, conversation_id,
        message_text, status, response_handle, routing_metadata,
        error_metadata, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plugin_id, source_id, external_message_id) DO UPDATE SET
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .run(
      input.pluginId,
      input.sourceId,
      input.externalMessageId,
      input.externalUserId,
      conversationId,
      input.messageText,
      input.status,
      input.responseHandle ?? null,
      input.routingMetadata ?? null,
      input.errorMetadata ?? null,
      input.receivedAt ?? nowIso,
    );
  return {
    record: getPluginIngressMessage(
      database,
      input.pluginId,
      input.sourceId,
      input.externalMessageId,
    ),
    rateLimited: false,
  };
}

export function getPluginIngressMessage(
  database: Database,
  pluginId: string,
  sourceId: string,
  externalMessageId: string,
): PluginIngressMessageRecord | null {
  initPluginIngressMessageSchema(database);
  const row = database
    .query<Record<string, unknown>, [string, string, string]>(
      `SELECT * FROM plugin_ingress_messages
       WHERE plugin_id = ? AND source_id = ? AND external_message_id = ?`,
    )
    .get(pluginId, sourceId, externalMessageId);
  return row ? mapMessage(row) : null;
}

export function markPluginIngressMessageProcessed(
  database: Database,
  input: MarkPluginIngressMessageProcessedInput,
): PluginIngressMessageRecord {
  initPluginIngressMessageSchema(database);
  const nowIso = (input.now ?? new Date()).toISOString();
  database
    .query(
      `UPDATE plugin_ingress_messages
       SET status = 'processed',
           routing_metadata = ?,
           error_metadata = NULL,
           updated_at = ?
       WHERE plugin_id = ? AND source_id = ? AND external_message_id = ?`,
    )
    .run(
      JSON.stringify({ ...input.routingMetadata, threadId: input.threadId }),
      nowIso,
      input.pluginId,
      input.sourceId,
      input.externalMessageId,
    );
  const record = getPluginIngressMessage(
    database,
    input.pluginId,
    input.sourceId,
    input.externalMessageId,
  );
  if (!record) throw new Error("Plugin ingress message was not found.");
  return record;
}

export function markPluginIngressMessageFailed(
  database: Database,
  input: MarkPluginIngressMessageFailedInput,
): PluginIngressMessageRecord | null {
  initPluginIngressMessageSchema(database);
  const nowIso = (input.now ?? new Date()).toISOString();
  database
    .query(
      `UPDATE plugin_ingress_messages
       SET status = 'failed',
           error_metadata = ?,
           updated_at = ?
       WHERE plugin_id = ? AND source_id = ? AND external_message_id = ?`,
    )
    .run(
      JSON.stringify({
        reason: input.reason,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        ...(input.errorMetadata ?? {}),
      }),
      nowIso,
      input.pluginId,
      input.sourceId,
      input.externalMessageId,
    );
  return getPluginIngressMessage(
    database,
    input.pluginId,
    input.sourceId,
    input.externalMessageId,
  );
}

export function createPluginIngressLinkCode(
  database: Database,
  input: CreatePluginIngressLinkCodeInput,
): { code: string; record: PluginIngressLinkCodeRecord } {
  validatePluginSourceScope(input);
  initPluginIngressMessageSchema(database);
  const code = input.code ?? randomLinkCode();
  if (!PLUGIN_INGRESS_LINK_CODE_PATTERN.test(code)) {
    throw new Error("Invalid plugin ingress link code.");
  }
  const now = input.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + (input.ttlMs ?? PLUGIN_INGRESS_LINK_CODE_TTL_MS),
  ).toISOString();
  const insertResult = database
    .query(
      `INSERT INTO plugin_ingress_link_codes (plugin_id, source_id, code_sha256, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.pluginId,
      input.sourceId,
      hashLinkCode(code),
      expiresAt,
      now.toISOString(),
    );
  createPluginIngressAuditEvent(database, {
    pluginId: input.pluginId,
    sourceId: input.sourceId,
    decision: "link_code_created",
    success: true,
    now,
  });
  const record = database
    .query<Record<string, unknown>, [number]>(
      `SELECT * FROM plugin_ingress_link_codes WHERE id = ?`,
    )
    .get(Number(insertResult.lastInsertRowid));
  if (!record) throw new Error("Failed to persist plugin ingress link code.");
  return { code, record: mapLinkCode(record) };
}

export function consumePluginIngressLinkCode(
  database: Database,
  input: ConsumePluginIngressLinkCodeInput,
): ConsumePluginIngressLinkCodeResult {
  validatePluginSourceScope(input);
  validateExternalId("externalUserId", input.externalUserId);
  initPluginIngressMessageSchema(database);
  if (!PLUGIN_INGRESS_LINK_CODE_PATTERN.test(input.code)) {
    return { ok: false, reason: "malformed" };
  }
  const codeHash = hashLinkCode(input.code);
  const row = database
    .query<Record<string, unknown>, [string, string, string]>(
      `SELECT * FROM plugin_ingress_link_codes
       WHERE plugin_id = ? AND source_id = ? AND code_sha256 = ?`,
    )
    .get(input.pluginId, input.sourceId, codeHash);
  if (!row) return { ok: false, reason: "not_found" };
  return consumePluginIngressLinkCodeRecord(database, {
    externalUserId: input.externalUserId,
    ...(input.now === undefined ? {} : { now: input.now }),
    record: mapLinkCode(row),
  });
}

export function consumePluginIngressLinkCodeForExternalUser(
  database: Database,
  input: ConsumePluginIngressLinkCodeForExternalUserInput,
): ConsumePluginIngressLinkCodeResult {
  validatePluginSourceScope(input);
  validateExternalId("externalUserId", input.externalUserId);
  initPluginIngressMessageSchema(database);
  const normalizedCode = input.code.trim().toUpperCase();
  if (!PLUGIN_INGRESS_LINK_CODE_PATTERN.test(normalizedCode)) {
    return { ok: false, reason: "malformed" };
  }
  const rows = database
    .query<Record<string, unknown>, [string, string, string]>(
      `SELECT * FROM plugin_ingress_link_codes
       WHERE plugin_id = ? AND source_id = ? AND code_sha256 = ?`,
    )
    .all(input.pluginId, input.sourceId, hashLinkCode(normalizedCode))
    .map(mapLinkCode);
  if (rows.length === 0) return { ok: false, reason: "not_found" };
  const now = input.now ?? new Date();
  const activeRows = rows.filter(
    (row) => !row.consumedAt && Date.parse(row.expiresAt) > now.getTime(),
  );
  if (activeRows.length === 0) {
    return rows.every((row) => row.consumedAt)
      ? { ok: false, reason: "consumed" }
      : { ok: false, reason: "expired" };
  }
  if (activeRows.length > 1) return { ok: false, reason: "ambiguous" };
  const activeRecord = activeRows[0];
  if (!activeRecord) return { ok: false, reason: "not_found" };
  return consumePluginIngressLinkCodeRecord(database, {
    externalUserId: input.externalUserId,
    now,
    record: activeRecord,
  });
}

function consumePluginIngressLinkCodeRecord(
  database: Database,
  input: {
    externalUserId: string;
    now?: Date;
    record: PluginIngressLinkCodeRecord;
  },
): ConsumePluginIngressLinkCodeResult {
  const record = input.record;
  if (record.consumedAt) return { ok: false, reason: "consumed" };
  const now = input.now ?? new Date();
  if (Date.parse(record.expiresAt) <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  const nowIso = now.toISOString();
  database.transaction(() => {
    database
      .query(
        `UPDATE plugin_ingress_link_codes
         SET consumed_at = ?, consumed_external_user_id = ?
         WHERE id = ? AND consumed_at IS NULL`,
      )
      .run(nowIso, input.externalUserId, record.id);
    database
      .query(
        `INSERT INTO plugin_ingress_external_bindings (plugin_id, source_id, external_user_id, enabled, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(plugin_id, source_id, external_user_id) DO UPDATE SET
           enabled = 1,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.pluginId,
        record.sourceId,
        input.externalUserId,
        nowIso,
        nowIso,
      );
    createPluginIngressAuditEvent(database, {
      pluginId: record.pluginId,
      sourceId: record.sourceId,
      decision: "link_code_used",
      externalUserId: input.externalUserId,
      success: true,
      now,
    });
  })();
  const binding = getPluginIngressExternalBinding(
    database,
    record.pluginId,
    record.sourceId,
    input.externalUserId,
  );
  if (!binding) throw new Error("Failed to create plugin ingress binding.");
  return { ok: true, binding };
}

export function getPluginIngressExternalBinding(
  database: Database,
  pluginId: string,
  sourceId: string,
  externalUserId: string,
): PluginIngressExternalBindingRecord | null {
  initPluginIngressMessageSchema(database);
  const row = database
    .query<Record<string, unknown>, [string, string, string]>(
      `SELECT * FROM plugin_ingress_external_bindings
       WHERE plugin_id = ? AND source_id = ? AND external_user_id = ?`,
    )
    .get(pluginId, sourceId, externalUserId);
  return row ? mapExternalBinding(row) : null;
}

export function getPluginIngressExternalBindingById(
  database: Database,
  id: number,
): PluginIngressExternalBindingRecord | null {
  initPluginIngressMessageSchema(database);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid plugin ingress binding id.");
  }
  const row = database
    .query<Record<string, unknown>, [number]>(
      `SELECT * FROM plugin_ingress_external_bindings WHERE id = ?`,
    )
    .get(id);
  return row ? mapExternalBinding(row) : null;
}

export function listPluginIngressExternalBindings(
  database: Database,
  input: ListPluginIngressExternalBindingsInput = {},
): PluginIngressExternalBindingRecord[] {
  initPluginIngressMessageSchema(database);
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (input.pluginId) {
    validateExternalId("pluginId", input.pluginId);
    clauses.push("plugin_id = ?");
    params.push(input.pluginId);
  }
  if (input.sourceId) {
    if (
      input.sourceId.length > PLUGIN_INGRESS_SOURCE_ID_MAX_LENGTH ||
      !PLUGIN_INGRESS_SOURCE_ID_PATTERN.test(input.sourceId)
    ) {
      throw new Error("Invalid plugin ingress source id.");
    }
    clauses.push("source_id = ?");
    params.push(input.sourceId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return database
    .query<Record<string, unknown>, SQLQueryBindings[]>(
      `SELECT * FROM plugin_ingress_external_bindings ${where}
       ORDER BY plugin_id COLLATE NOCASE ASC, source_id COLLATE NOCASE ASC, external_user_id COLLATE NOCASE ASC, id ASC`,
    )
    .all(...params)
    .map(mapExternalBinding);
}

export function getPluginIngressRouteConfig(
  database: Database,
  input: {
    pluginId: string;
    sourceId: string;
    metidosUserId?: number | null;
  },
): PluginIngressRouteConfigRecord | null {
  validatePluginSourceScope(input);
  initPluginIngressMessageSchema(database);
  const row = database
    .query<Record<string, unknown>, [string, string]>(
      `SELECT * FROM plugin_ingress_route_configs
       WHERE plugin_id = ? AND source_id = ?`,
    )
    .get(input.pluginId, input.sourceId);
  return row ? mapRouteConfig(row) : null;
}

export function listPluginIngressRouteConfigs(
  database: Database,
  input: ListPluginIngressRouteConfigsInput = {},
): PluginIngressRouteConfigRecord[] {
  initPluginIngressMessageSchema(database);
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (input.pluginId) {
    validateExternalId("pluginId", input.pluginId);
    clauses.push("plugin_id = ?");
    params.push(input.pluginId);
  }
  if (input.sourceId) {
    if (
      input.sourceId.length > PLUGIN_INGRESS_SOURCE_ID_MAX_LENGTH ||
      !PLUGIN_INGRESS_SOURCE_ID_PATTERN.test(input.sourceId)
    ) {
      throw new Error("Invalid plugin ingress source id.");
    }
    clauses.push("source_id = ?");
    params.push(input.sourceId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return database
    .query<Record<string, unknown>, SQLQueryBindings[]>(
      `SELECT * FROM plugin_ingress_route_configs ${where}
       ORDER BY plugin_id COLLATE NOCASE ASC, source_id COLLATE NOCASE ASC, id ASC`,
    )
    .all(...params)
    .map(mapRouteConfig);
}

export function upsertPluginIngressRouteConfig(
  database: Database,
  input: UpsertPluginIngressRouteConfigInput,
): PluginIngressRouteConfigRecord {
  validatePluginSourceScope(input);
  if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0) {
    throw new Error("Invalid ingress route project id.");
  }
  if (!input.worktreePath.trim()) {
    throw new Error("Ingress route worktree path is required.");
  }
  const permissions = [...new Set(input.permissions.map((item) => item.trim()))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const nowIso = (input.now ?? new Date()).toISOString();
  initPluginIngressMessageSchema(database);
  database
    .query(
      `INSERT INTO plugin_ingress_route_configs (
        plugin_id, source_id, project_id, worktree_path,
        model, permissions_json, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plugin_id, source_id) DO UPDATE SET
        project_id = excluded.project_id,
        worktree_path = excluded.worktree_path,
        model = excluded.model,
        permissions_json = excluded.permissions_json,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at`,
    )
    .run(
      input.pluginId,
      input.sourceId,
      input.projectId,
      input.worktreePath.trim(),
      input.model?.trim() || null,
      JSON.stringify(permissions),
      input.enabled === false ? 0 : 1,
      nowIso,
      nowIso,
    );
  const route = getPluginIngressRouteConfig(database, input);
  if (!route) throw new Error("Failed to persist plugin ingress route config.");
  createPluginIngressAuditEvent(database, {
    pluginId: input.pluginId,
    sourceId: input.sourceId,
    decision: "binding_changed",
    success: true,
    reason: "route_config_updated",
    metadata: {
      projectId: input.projectId,
      worktreePath: input.worktreePath.trim(),
      model: input.model?.trim() || null,
      permissions,
    },
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  return route;
}

export function setPluginIngressExternalBindingEnabled(
  database: Database,
  id: number,
  enabled: boolean,
  now = new Date(),
): PluginIngressExternalBindingRecord | null {
  const binding = getPluginIngressExternalBindingById(database, id);
  if (!binding) return null;
  database
    .query<unknown, [number, string, number]>(
      `UPDATE plugin_ingress_external_bindings
       SET enabled = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(enabled ? 1 : 0, now.toISOString(), id);
  createPluginIngressAuditEvent(database, {
    pluginId: binding.pluginId,
    sourceId: binding.sourceId,
    decision: "binding_changed",
    externalUserId: binding.externalUserId,
    success: true,
    reason: enabled ? "enabled" : "disabled",
    now,
  });
  return getPluginIngressExternalBindingById(database, id);
}

export function deletePluginIngressExternalBinding(
  database: Database,
  id: number,
  now = new Date(),
): PluginIngressExternalBindingRecord | null {
  const binding = getPluginIngressExternalBindingById(database, id);
  if (!binding) return null;
  database
    .query<unknown, [number]>(
      `DELETE FROM plugin_ingress_external_bindings WHERE id = ?`,
    )
    .run(id);
  createPluginIngressAuditEvent(database, {
    pluginId: binding.pluginId,
    sourceId: binding.sourceId,
    decision: "binding_changed",
    externalUserId: binding.externalUserId,
    success: true,
    reason: "removed",
    now,
  });
  return binding;
}

export function createPluginIngressAuditEvent(
  database: Database,
  input: CreatePluginIngressAuditEventInput,
): PluginIngressAuditEventRecord {
  validateAuditInput(input);
  initPluginIngressMessageSchema(database);
  const normalizedText = normalizeAuditText(input.text ?? null);
  const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
  database
    .query(
      `INSERT INTO plugin_ingress_audit_events (
        plugin_id, source_id, decision, external_message_id, external_user_id,
        conversation_id, thread_id, success, reason,
        text_preview, text_sha256, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.pluginId,
      input.sourceId,
      input.decision,
      input.externalMessageId ?? null,
      input.externalUserId ?? null,
      input.conversationId ?? null,
      input.threadId ?? null,
      input.success === false ? 0 : 1,
      input.reason ?? null,
      normalizedText?.preview ?? null,
      normalizedText?.sha256 ?? null,
      metadata,
      (input.now ?? new Date()).toISOString(),
    );
  const record = database
    .query<Record<string, unknown>, []>(
      `SELECT * FROM plugin_ingress_audit_events WHERE id = last_insert_rowid()`,
    )
    .get();
  if (!record) throw new Error("Failed to persist plugin ingress audit event.");
  return mapAuditEvent(record);
}

export function listPluginIngressAuditEvents(
  database: Database,
  input: { pluginId?: string; sourceId?: string; limit?: number } = {},
): PluginIngressAuditEventRecord[] {
  initPluginIngressMessageSchema(database);
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (input.pluginId) {
    validateExternalId("pluginId", input.pluginId);
    clauses.push("plugin_id = ?");
    params.push(input.pluginId);
  }
  if (input.sourceId) {
    if (
      input.sourceId.length > PLUGIN_INGRESS_SOURCE_ID_MAX_LENGTH ||
      !PLUGIN_INGRESS_SOURCE_ID_PATTERN.test(input.sourceId)
    ) {
      throw new Error("Invalid plugin ingress source id.");
    }
    clauses.push("source_id = ?");
    params.push(input.sourceId);
  }
  params.push(limit);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return database
    .query<Record<string, unknown>, SQLQueryBindings[]>(
      `SELECT * FROM plugin_ingress_audit_events ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(...params)
    .map(mapAuditEvent);
}

function maybeCleanupPluginIngressMessages(
  database: Database,
  now: Date,
): void {
  const nowMs = now.getTime();
  const lastCleanupAtMs = pluginIngressLastCleanupAtMs.get(database) ?? 0;
  if (
    lastCleanupAtMs !== 0 &&
    nowMs - lastCleanupAtMs < PLUGIN_INGRESS_CLEANUP_INTERVAL_MS
  ) {
    return;
  }
  cleanupPluginIngressMessages(database, now);
  pluginIngressLastCleanupAtMs.set(database, nowMs);
}

export function cleanupPluginIngressMessages(
  database: Database,
  now = new Date(),
): void {
  initPluginIngressMessageSchema(database);
  const unverifiedBefore = new Date(
    now.getTime() - PLUGIN_INGRESS_UNVERIFIED_RETENTION_MS,
  ).toISOString();
  const textBefore = new Date(
    now.getTime() - PLUGIN_INGRESS_TEXT_RETENTION_MS,
  ).toISOString();
  const dedupeBefore = new Date(
    now.getTime() - PLUGIN_INGRESS_DEDUPE_RETENTION_MS,
  ).toISOString();
  const markerBefore = new Date(
    now.getTime() - PLUGIN_INGRESS_RESPONSE_AUDIT_RETENTION_MS,
  ).toISOString();
  database
    .query(
      `DELETE FROM plugin_ingress_messages WHERE status IN ('unverified', 'ignored') AND received_at < ?`,
    )
    .run(unverifiedBefore);
  database
    .query(
      `UPDATE plugin_ingress_messages SET message_text = NULL, message_text_redacted_at = ? WHERE message_text IS NOT NULL AND received_at < ?`,
    )
    .run(now.toISOString(), textBefore);
  database
    .query(`DELETE FROM plugin_ingress_messages WHERE received_at < ?`)
    .run(dedupeBefore);
  database
    .query(
      `DELETE FROM plugin_ingress_rate_limit_markers WHERE last_seen_at < ?`,
    )
    .run(markerBefore);
  database
    .query(`DELETE FROM plugin_ingress_audit_events WHERE created_at < ?`)
    .run(markerBefore);
}

function validatePluginSourceScope(input: {
  pluginId: string;
  sourceId: string;
}): void {
  validateExternalId("pluginId", input.pluginId);
  if (
    input.sourceId.length > PLUGIN_INGRESS_SOURCE_ID_MAX_LENGTH ||
    !PLUGIN_INGRESS_SOURCE_ID_PATTERN.test(input.sourceId)
  ) {
    throw new Error("Invalid plugin ingress source id.");
  }
}

function randomLinkCode(): string {
  let code = "";
  while (code.length < PLUGIN_INGRESS_LINK_CODE_LENGTH) {
    const [byte = 0] = randomBytes(1);
    if (byte >= PLUGIN_INGRESS_LINK_CODE_UNIFORM_BYTE_LIMIT) {
      continue;
    }
    code +=
      PLUGIN_INGRESS_LINK_CODE_ALPHABET[
        byte % PLUGIN_INGRESS_LINK_CODE_ALPHABET.length
      ] ?? "";
  }
  return code;
}

function hashLinkCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function validateAuditInput(input: CreatePluginIngressAuditEventInput): void {
  validateExternalId("pluginId", input.pluginId);
  if (
    input.sourceId.length > PLUGIN_INGRESS_SOURCE_ID_MAX_LENGTH ||
    !PLUGIN_INGRESS_SOURCE_ID_PATTERN.test(input.sourceId)
  ) {
    throw new Error("Invalid plugin ingress source id.");
  }
  if (!VALID_AUDIT_DECISIONS.has(input.decision)) {
    throw new Error("Invalid plugin ingress audit decision.");
  }
  if (input.externalMessageId)
    validateExternalId("externalMessageId", input.externalMessageId);
  if (input.externalUserId)
    validateExternalId("externalUserId", input.externalUserId);
  if (input.conversationId)
    validateExternalId("conversationId", input.conversationId);
  if (typeof input.reason === "string" && input.reason.length > 512) {
    throw new Error("Invalid ingress audit reason length.");
  }
}

function normalizeAuditText(
  text: string | null,
): { preview: string; sha256: string } | null {
  if (text === null) return null;
  const collapsed = text.replace(/\s+/g, " ").trim();
  return {
    preview: collapsed.slice(0, PLUGIN_INGRESS_AUDIT_PREVIEW_MAX_LENGTH),
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

function validateInput(input: PersistPluginIngressMessageInput): void {
  validateExternalId("pluginId", input.pluginId);
  if (
    input.sourceId.length > PLUGIN_INGRESS_SOURCE_ID_MAX_LENGTH ||
    !PLUGIN_INGRESS_SOURCE_ID_PATTERN.test(input.sourceId)
  ) {
    throw new Error("Invalid plugin ingress source id.");
  }
  validateExternalId("externalMessageId", input.externalMessageId);
  validateExternalId("externalUserId", input.externalUserId);
  if (input.conversationId)
    validateExternalId("conversationId", input.conversationId);
  if (!VALID_STATUSES.has(input.status))
    throw new Error("Invalid ingress status.");
  if (
    input.messageText.length === 0 ||
    input.messageText.length > PLUGIN_INGRESS_MESSAGE_MAX_LENGTH
  ) {
    throw new Error("Invalid ingress message text length.");
  }
}

function validateExternalId(name: string, value: string): void {
  if (
    value.length === 0 ||
    value.length > PLUGIN_INGRESS_EXTERNAL_ID_MAX_LENGTH ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ingress ids must reject ASCII control characters.
    /[\u0000-\u001f]/.test(value)
  ) {
    throw new Error(`Invalid ${name}.`);
  }
}

function isUnverifiedOverLimit(
  database: Database,
  input: PersistPluginIngressMessageInput,
  now: Date,
): boolean {
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const args = [
    input.pluginId,
    input.sourceId,
    input.externalUserId,
    input.conversationId ?? null,
  ] as const;
  const ten =
    database
      .query<
        { count: number },
        [string, string, string, string | null, string]
      >(
        `SELECT COUNT(*) AS count FROM plugin_ingress_messages WHERE plugin_id = ? AND source_id = ? AND external_user_id = ? AND conversation_id IS ? AND status = 'unverified' AND received_at >= ?`,
      )
      .get(...args, tenMinutesAgo)?.count ?? 0;
  const day =
    database
      .query<
        { count: number },
        [string, string, string, string | null, string]
      >(
        `SELECT COUNT(*) AS count FROM plugin_ingress_messages WHERE plugin_id = ? AND source_id = ? AND external_user_id = ? AND conversation_id IS ? AND status = 'unverified' AND received_at >= ?`,
      )
      .get(...args, dayAgo)?.count ?? 0;
  return (
    ten >= PLUGIN_INGRESS_UNVERIFIED_WINDOW_LIMIT ||
    day >= PLUGIN_INGRESS_UNVERIFIED_DAILY_LIMIT
  );
}

function upsertRateLimitMarker(
  database: Database,
  input: PersistPluginIngressMessageInput,
  windowKind: "ten_minute" | "day",
  windowStart: string,
): void {
  const nowIso = (input.now ?? new Date()).toISOString();
  database
    .query(
      `INSERT INTO plugin_ingress_rate_limit_markers (plugin_id, source_id, external_user_id, conversation_id, window_kind, window_start, first_seen_at, last_seen_at, count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(plugin_id, source_id, external_user_id, conversation_id, window_kind, window_start) DO UPDATE SET last_seen_at = excluded.last_seen_at, count = count + 1`,
    )
    .run(
      input.pluginId,
      input.sourceId,
      input.externalUserId,
      input.conversationId ?? null,
      windowKind,
      windowStart,
      nowIso,
      nowIso,
    );
}

function floorDate(date: Date, intervalMs: number): string {
  return new Date(
    Math.floor(date.getTime() / intervalMs) * intervalMs,
  ).toISOString();
}

function mapAuditEvent(
  row: Record<string, unknown>,
): PluginIngressAuditEventRecord {
  // The V1 ingress schema is single-local-operator scoped and rebuilt legacy
  // tables that carried metidos_user_id. Keep the RPC shape nullable for older
  // callers while intentionally not reintroducing a per-row user column here.
  return {
    id: Number(row.id),
    pluginId: String(row.plugin_id),
    sourceId: String(row.source_id),
    decision: String(row.decision) as PluginIngressAuditDecision,
    externalMessageId:
      row.external_message_id === null ? null : String(row.external_message_id),
    externalUserId:
      row.external_user_id === null ? null : String(row.external_user_id),
    conversationId:
      row.conversation_id === null ? null : String(row.conversation_id),
    metidosUserId: null,
    threadId: row.thread_id === null ? null : Number(row.thread_id),
    success: Number(row.success) === 1,
    reason: row.reason === null ? null : String(row.reason),
    textPreview: row.text_preview === null ? null : String(row.text_preview),
    textSha256: row.text_sha256 === null ? null : String(row.text_sha256),
    metadata: row.metadata === null ? null : String(row.metadata),
    createdAt: String(row.created_at),
  };
}

function mapLinkCode(
  row: Record<string, unknown>,
): PluginIngressLinkCodeRecord {
  return {
    id: Number(row.id),
    pluginId: String(row.plugin_id),
    sourceId: String(row.source_id),
    codeSha256: String(row.code_sha256),
    expiresAt: String(row.expires_at),
    consumedAt: row.consumed_at === null ? null : String(row.consumed_at),
    consumedExternalUserId:
      row.consumed_external_user_id === null
        ? null
        : String(row.consumed_external_user_id),
    createdAt: String(row.created_at),
  };
}

function mapExternalBinding(
  row: Record<string, unknown>,
): PluginIngressExternalBindingRecord {
  // External bindings are now plugin/source/external-user scoped for the local
  // operator installation; metidosUserId remains nullable for compatibility with
  // earlier multi-user RPC shapes.
  return {
    id: Number(row.id),
    pluginId: String(row.plugin_id),
    sourceId: String(row.source_id),
    externalUserId: String(row.external_user_id),
    metidosUserId: null,
    enabled: Number(row.enabled) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapRouteConfig(
  row: Record<string, unknown>,
): PluginIngressRouteConfigRecord {
  let permissions: string[] = [];
  try {
    const parsed = JSON.parse(String(row.permissions_json));
    permissions = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    permissions = [];
  }
  return {
    id: Number(row.id),
    pluginId: String(row.plugin_id),
    sourceId: String(row.source_id),
    projectId: Number(row.project_id),
    worktreePath: String(row.worktree_path),
    model: row.model === null ? null : String(row.model),
    permissions,
    enabled: Number(row.enabled) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapMessage(row: Record<string, unknown>): PluginIngressMessageRecord {
  // Ingress messages no longer persist metidos_user_id after the V1 route
  // schema migration; mapped-user routing is resolved at processing time and the
  // compatibility field intentionally hydrates as null.
  return {
    id: Number(row.id),
    pluginId: String(row.plugin_id),
    sourceId: String(row.source_id),
    externalMessageId: String(row.external_message_id),
    externalUserId: String(row.external_user_id),
    conversationId:
      row.conversation_id === null ? null : String(row.conversation_id),
    messageText: row.message_text === null ? null : String(row.message_text),
    messageTextRedactedAt:
      row.message_text_redacted_at === null
        ? null
        : String(row.message_text_redacted_at),
    status: String(row.status) as PluginIngressMessageStatus,
    metidosUserId: null,
    responseHandle:
      row.response_handle === null ? null : String(row.response_handle),
    routingMetadata:
      row.routing_metadata === null ? null : String(row.routing_metadata),
    errorMetadata:
      row.error_metadata === null ? null : String(row.error_metadata),
    receivedAt: String(row.received_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
