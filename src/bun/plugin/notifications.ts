/**
 * @file src/bun/plugin/notifications.ts
 * @description Permissioned Plugin System v1 notification send helpers.
 */

import type { Database } from "bun:sqlite";

import { resolveSingletonLocalSettingsUserId, runInTransaction } from "../db";
import type { LogSubsystem } from "../logging";

export const PLUGIN_NOTIFICATION_SEND_PERMISSION = "notification:send";
export const PLUGIN_NOTIFICATION_PROVIDER_PERMISSION = "notification:provider";
export const PLUGIN_NOTIFICATION_LOG_WRITE_PERMISSION = "log:write";
export const PLUGIN_NOTIFICATION_DISABLED = "DISABLED";
export const PLUGIN_NOTIFICATION_RATE_LIMITED = "RATE_LIMITED";
export const PLUGIN_NOTIFICATION_NO_ENABLED_OUTLETS =
  "NO_ENABLED_NOTIFICATION_OUTLETS";
export const PLUGIN_NOTIFICATION_DELIVERY_FAILED = "DELIVERY_FAILED";
export const PLUGIN_NOTIFICATION_PROVIDER_FAILED = "PROVIDER_CALLBACK_FAILED";

export const DEFAULT_PLUGIN_NOTIFICATION_RATE_LIMITS = {
  enabled: true,
  perDayLimit: 25,
  perMinuteLimit: 3,
};

export type PluginNotificationPriority =
  | "min"
  | "low"
  | "default"
  | "high"
  | "urgent";

export type PluginNotificationRequest = {
  body: string;
  clickUrl?: string | null;
  priority?: PluginNotificationPriority | null;
  tags?: string[] | null;
  title: string;
};

export type PluginNotificationContext = {
  contextKind?: string;
  ownerUserId?: number | null;
  sourceThreadId?: number | null;
  threadId?: number | null;
};

export type PluginNotificationSendInput = PluginNotificationRequest & {
  context?: PluginNotificationContext | null;
  pluginId: string;
};

export type PluginNotificationReceipt = {
  channel: "ntfy" | "plugin";
  code?: string;
  deliveryId: number | null;
  externalId?: string | null;
  externalUrl?: string | null;
  message: string;
  outlet: "ntfy" | "plugin";
  provider?: string;
  retryAfter?: number | string | null;
  retryable?: boolean;
  status: "delivered" | "failed";
};

export type PluginNotificationSendResult = {
  receipts: PluginNotificationReceipt[];
};

export type PluginNotificationProviderDispatcher = (input: {
  request: PluginNotificationSendInput;
}) => Promise<PluginNotificationReceipt[]>;

export type PluginNotificationDeliveryControls = {
  logSettings?: {
    enabled: boolean;
  } | null;
  logger?: Pick<LogSubsystem, "warning"> | null;
  notificationSettings?: {
    enabled: boolean;
    perDayLimit: number;
    perMinuteLimit: number;
  } | null;
  permissions?: readonly string[] | null;
  providerDispatcher?: PluginNotificationProviderDispatcher | null;
};

const PLUGIN_NOTIFICATION_MINUTE_WINDOW_MS = 60_000;
const PLUGIN_NOTIFICATION_DAY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function resetPluginNotificationRateLimitsForTests(): void {
  // Rate limits are persisted in the app database. Tests use isolated
  // databases, so this hook remains for older callers without global state.
}

export class PluginNotificationError extends Error {
  readonly code: string;

  constructor(input: { cause?: unknown; code: string; message: string }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "PluginNotificationError";
    this.code = input.code;
  }
}

function isPluginNotificationPriority(
  value: unknown,
): value is PluginNotificationPriority {
  return (
    value === "min" ||
    value === "low" ||
    value === "default" ||
    value === "high" ||
    value === "urgent"
  );
}

function normalizeText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PluginNotificationError({
      code: "invalid_notification_request",
      message: `Plugin notification ${field} must be a non-empty string.`,
    });
  }
  return value.trim();
}

function normalizeTags(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new PluginNotificationError({
      code: "invalid_notification_request",
      message: "Plugin notification tags must be an array of strings.",
    });
  }
  return value.filter((tag): tag is string => typeof tag === "string");
}

export function normalizePluginNotificationRequest(
  value: unknown,
): PluginNotificationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PluginNotificationError({
      code: "invalid_notification_request",
      message: "Plugin notification request must be an object.",
    });
  }
  const record = value as Record<string, unknown>;
  const bodyValue = record.body ?? record.message;
  const priority = record.priority;
  if (
    priority !== undefined &&
    priority !== null &&
    !isPluginNotificationPriority(priority)
  ) {
    throw new PluginNotificationError({
      code: "invalid_notification_request",
      message: "Plugin notification priority is invalid.",
    });
  }
  const clickUrl = record.clickUrl;
  if (
    clickUrl !== undefined &&
    clickUrl !== null &&
    typeof clickUrl !== "string"
  ) {
    throw new PluginNotificationError({
      code: "invalid_notification_request",
      message: "Plugin notification clickUrl must be a string when provided.",
    });
  }
  return {
    body: normalizeText(bodyValue, "body"),
    clickUrl:
      typeof clickUrl === "string" && clickUrl.trim().length > 0
        ? clickUrl.trim()
        : null,
    priority: priority ?? null,
    tags: normalizeTags(record.tags),
    title: normalizeText(record.title, "title"),
  };
}

type PluginNotificationRecipient =
  | {
      contextKind: "threadTool";
      rateLimitRecipient: string;
      userId: number;
    }
  | {
      contextKind: "cron";
      rateLimitRecipient: string;
      userId: null;
    };

function notificationRecipientFromContext(
  context: PluginNotificationContext | null | undefined,
): PluginNotificationRecipient {
  if (context?.contextKind === "threadTool") {
    const userId = resolveSingletonLocalSettingsUserId();
    return {
      contextKind: "threadTool",
      rateLimitRecipient: `local-operator:${userId}`,
      userId,
    };
  }
  if (context?.contextKind === "cron") {
    return {
      contextKind: "cron",
      rateLimitRecipient: "cron:global",
      userId: null,
    };
  }
  throw new PluginNotificationError({
    code: "plugin_context_error",
    message:
      "metidos.notifications.send requires a local-operator or cron plugin callback context.",
  });
}

export function assertPluginNotificationSendPermission(
  permissions: readonly string[],
): void {
  if (!permissions.includes(PLUGIN_NOTIFICATION_SEND_PERMISSION)) {
    throw new PluginNotificationError({
      code: "plugin_permission_error",
      message: "metidos.notifications.send requires notification:send.",
    });
  }
}

function failedPluginNotificationReceipt(input: {
  code: string;
  message: string;
}): PluginNotificationSendResult {
  return {
    receipts: [
      {
        channel: "plugin",
        code: input.code,
        deliveryId: null,
        message: input.message,
        outlet: "plugin",
        status: "failed",
      },
    ],
  };
}

function failedPluginNotificationProviderReceipt(input: {
  code: string;
  message: string;
}): PluginNotificationReceipt {
  return {
    channel: "plugin",
    code: input.code,
    deliveryId: null,
    message: input.message,
    outlet: "plugin",
    provider: "plugin-notification-providers",
    retryable: true,
    status: "failed",
  };
}

function normalizedNotificationSettings(
  controls: PluginNotificationDeliveryControls | null | undefined,
): typeof DEFAULT_PLUGIN_NOTIFICATION_RATE_LIMITS {
  const settings = controls?.notificationSettings;
  return {
    enabled:
      typeof settings?.enabled === "boolean"
        ? settings.enabled
        : DEFAULT_PLUGIN_NOTIFICATION_RATE_LIMITS.enabled,
    perDayLimit:
      typeof settings?.perDayLimit === "number" &&
      Number.isInteger(settings.perDayLimit) &&
      settings.perDayLimit > 0
        ? settings.perDayLimit
        : DEFAULT_PLUGIN_NOTIFICATION_RATE_LIMITS.perDayLimit,
    perMinuteLimit:
      typeof settings?.perMinuteLimit === "number" &&
      Number.isInteger(settings.perMinuteLimit) &&
      settings.perMinuteLimit > 0
        ? settings.perMinuteLimit
        : DEFAULT_PLUGIN_NOTIFICATION_RATE_LIMITS.perMinuteLimit,
  };
}

function ensurePluginNotificationRateLimitSchema(database: Database): void {
  database.run(
    `CREATE TABLE IF NOT EXISTS plugin_notification_rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_id TEXT NOT NULL,
      recipient TEXT NOT NULL,
      sent_at_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
  );
  database.run(
    `CREATE INDEX IF NOT EXISTS idx_plugin_notification_rate_limits_window ON plugin_notification_rate_limits(plugin_id, recipient, sent_at_ms)`,
  );
  database.run(
    `CREATE INDEX IF NOT EXISTS idx_plugin_notification_rate_limits_cleanup ON plugin_notification_rate_limits(sent_at_ms)`,
  );
}

function isPluginNotificationRateLimited(input: {
  database: Database;
  nowMs: number;
  pluginId: string;
  recipient: string;
  settings: typeof DEFAULT_PLUGIN_NOTIFICATION_RATE_LIMITS;
}): boolean {
  ensurePluginNotificationRateLimitSchema(input.database);
  const dayCutoff = input.nowMs - PLUGIN_NOTIFICATION_DAY_WINDOW_MS;
  const minuteCutoff = input.nowMs - PLUGIN_NOTIFICATION_MINUTE_WINDOW_MS;
  return runInTransaction(input.database, () => {
    input.database
      .query<unknown, [number]>(
        `DELETE FROM plugin_notification_rate_limits WHERE sent_at_ms <= ?`,
      )
      .run(dayCutoff);
    const counts = input.database
      .query<
        { perDayCount: number; perMinuteCount: number },
        [number, string, string]
      >(
        `SELECT
          COUNT(*) AS perDayCount,
          COALESCE(SUM(CASE WHEN sent_at_ms > ? THEN 1 ELSE 0 END), 0) AS perMinuteCount
        FROM plugin_notification_rate_limits
        WHERE plugin_id = ? AND recipient = ?`,
      )
      .get(minuteCutoff, input.pluginId, input.recipient) ?? {
      perDayCount: 0,
      perMinuteCount: 0,
    };
    if (
      counts.perMinuteCount >= input.settings.perMinuteLimit ||
      counts.perDayCount >= input.settings.perDayLimit
    ) {
      return true;
    }
    input.database
      .query<unknown, [string, string, number]>(
        `INSERT INTO plugin_notification_rate_limits(plugin_id, recipient, sent_at_ms) VALUES (?, ?, ?)`,
      )
      .run(input.pluginId, input.recipient, input.nowMs);
    return false;
  });
}

function logPluginNotificationRateLimit(input: {
  contextKind: PluginNotificationRecipient["contextKind"];
  controls: PluginNotificationDeliveryControls | null | undefined;
  pluginId: string;
  recipientUserId: number | null;
}): void {
  if (
    input.controls?.logSettings?.enabled === true &&
    input.controls.permissions?.includes(
      PLUGIN_NOTIFICATION_LOG_WRITE_PERMISSION,
    )
  ) {
    input.controls.logger?.warning({
      pluginId: input.pluginId,
      ...(input.recipientUserId === null
        ? { contextKind: input.contextKind }
        : { recipientUserId: input.recipientUserId }),
      reason: PLUGIN_NOTIFICATION_RATE_LIMITED,
      summary: "Plugin notification send was rate limited.",
    });
  }
}

export async function sendPluginNotificationThroughUserOutlets(input: {
  controls?: PluginNotificationDeliveryControls | null;
  database: Database;
  now?: Date;
  request: PluginNotificationSendInput;
}): Promise<PluginNotificationSendResult> {
  const recipient = notificationRecipientFromContext(input.request.context);
  const notificationSettings = normalizedNotificationSettings(input.controls);
  if (!notificationSettings.enabled) {
    return failedPluginNotificationReceipt({
      code: PLUGIN_NOTIFICATION_DISABLED,
      message: "Plugin notifications are disabled for this plugin.",
    });
  }
  const now = input.now ?? new Date();
  if (
    isPluginNotificationRateLimited({
      database: input.database,
      nowMs: now.getTime(),
      pluginId: input.request.pluginId,
      recipient: recipient.rateLimitRecipient,
      settings: notificationSettings,
    })
  ) {
    logPluginNotificationRateLimit({
      contextKind: recipient.contextKind,
      controls: input.controls,
      pluginId: input.request.pluginId,
      recipientUserId: recipient.userId,
    });
    return failedPluginNotificationReceipt({
      code: PLUGIN_NOTIFICATION_RATE_LIMITED,
      message: "Plugin notification rate limit exceeded.",
    });
  }
  const receipts: PluginNotificationReceipt[] = [];
  if (input.controls?.providerDispatcher) {
    try {
      receipts.push(
        ...(await input.controls.providerDispatcher({
          request: input.request,
        })),
      );
    } catch (error) {
      receipts.push(
        failedPluginNotificationProviderReceipt({
          code: PLUGIN_NOTIFICATION_PROVIDER_FAILED,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  if (receipts.length === 0) {
    return {
      receipts: [
        {
          channel: "plugin",
          code: PLUGIN_NOTIFICATION_NO_ENABLED_OUTLETS,
          deliveryId: null,
          message:
            recipient.userId === null
              ? "No enabled notification outlets are configured for this cron context."
              : "No enabled notification outlets are configured for the local operator.",
          outlet: "plugin",
          status: "failed",
        },
      ],
    };
  }
  return { receipts };
}
