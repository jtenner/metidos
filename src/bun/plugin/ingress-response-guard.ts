import type { Database } from "bun:sqlite";
import {
  PLUGIN_INGRESS_RESPONSE_MESSAGE_MAX_LENGTH,
  PLUGIN_REPLY_TO_SOURCE_PERMISSION,
} from "./ingress";
import { createPluginIngressAuditEvent } from "./ingress-store";

export const PLUGIN_INGRESS_REPLY_WINDOW_MS = 30 * 60 * 1000;
export const PLUGIN_INGRESS_REPLY_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const PLUGIN_INGRESS_REPLY_RATE_LIMIT = 6;

export type PluginIngressReplyGuardInput = {
  database: Database;
  pluginId: string;
  sourceId: string;
  permissions: readonly string[];
  source: {
    supportsReplyToSource: boolean;
    respondHandle?: string | null;
  } | null;
  ingress: {
    externalMessageId: string;
    externalUserId: string;
    conversationId?: string | null;
    metidosUserId?: number | null;
    threadId: number;
    receivedAt: string;
    dedicatedThread: boolean;
    responseContextEnabled: boolean;
    threadClosedAt?: string | null;
    threadHiddenFromActiveIngress?: boolean;
  } | null;
  message: string;
  now?: Date;
};

export type PluginIngressReplyGuardResult =
  | {
      ok: true;
      responseContext: {
        external_message_id: string;
        external_user_id: string;
        external_conversation_id?: string;
      };
      message: string;
    }
  | { ok: false; reason: string; safeMessage: string };

/**
 * Enforces host-owned reply-to-source guardrails before invoking a plugin's
 * provider callback. The caller never supplies a recipient; the returned
 * context is derived only from the verified ingress record.
 */
export function enforcePluginIngressReplyGuardrails(
  input: PluginIngressReplyGuardInput,
): PluginIngressReplyGuardResult {
  const now = input.now ?? new Date();
  const fail = (reason: string): PluginIngressReplyGuardResult => {
    createPluginIngressAuditEvent(input.database, {
      pluginId: input.pluginId,
      sourceId: input.sourceId,
      decision: "reply_failed",
      externalMessageId: input.ingress?.externalMessageId ?? null,
      externalUserId: input.ingress?.externalUserId ?? null,
      conversationId: input.ingress?.conversationId ?? null,
      metidosUserId: input.ingress?.metidosUserId ?? null,
      threadId: input.ingress?.threadId ?? null,
      success: false,
      reason,
      now,
    });
    return { ok: false, reason, safeMessage: "Reply was not sent." };
  };

  const trimmed = input.message.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > PLUGIN_INGRESS_RESPONSE_MESSAGE_MAX_LENGTH
  ) {
    return fail("invalid_message_length");
  }
  if (!input.permissions.includes(PLUGIN_REPLY_TO_SOURCE_PERMISSION)) {
    return fail("missing_reply_permission");
  }
  if (!input.source?.supportsReplyToSource || !input.source.respondHandle) {
    return fail("source_reply_unavailable");
  }
  if (!input.ingress) return fail("missing_ingress_context");
  if (!input.ingress.dedicatedThread || !input.ingress.responseContextEnabled) {
    return fail("thread_not_reply_enabled");
  }
  if (
    input.ingress.threadClosedAt ||
    input.ingress.threadHiddenFromActiveIngress
  ) {
    return fail("thread_inactive_for_ingress");
  }
  const receivedAt = Date.parse(input.ingress.receivedAt);
  if (!Number.isFinite(receivedAt)) return fail("invalid_ingress_received_at");
  if (now.getTime() - receivedAt > PLUGIN_INGRESS_REPLY_WINDOW_MS) {
    return fail("reply_window_expired");
  }
  const ingress = input.ingress;
  if (isReplyRateLimited(input.database, { ...input, ingress }, now)) {
    return fail("reply_rate_limited");
  }

  createPluginIngressAuditEvent(input.database, {
    pluginId: input.pluginId,
    sourceId: input.sourceId,
    decision: "reply_attempted",
    externalMessageId: ingress.externalMessageId,
    externalUserId: ingress.externalUserId,
    conversationId: ingress.conversationId ?? null,
    metidosUserId: ingress.metidosUserId ?? null,
    threadId: ingress.threadId,
    success: true,
    text: trimmed,
    now,
  });

  return {
    ok: true,
    responseContext: {
      external_message_id: ingress.externalMessageId,
      external_user_id: ingress.externalUserId,
      ...(ingress.conversationId
        ? { external_conversation_id: ingress.conversationId }
        : {}),
    },
    message: trimmed,
  };
}

export function auditPluginIngressReplySendResult(
  database: Database,
  input: {
    pluginId: string;
    sourceId: string;
    externalMessageId: string;
    externalUserId: string;
    conversationId?: string | null;
    metidosUserId?: number | null;
    threadId: number;
    success: boolean;
    reason?: string | null;
    message?: string | null;
    now?: Date;
  },
): void {
  createPluginIngressAuditEvent(database, {
    pluginId: input.pluginId,
    sourceId: input.sourceId,
    decision: input.success ? "reply_succeeded" : "reply_failed",
    externalMessageId: input.externalMessageId,
    externalUserId: input.externalUserId,
    conversationId: input.conversationId ?? null,
    metidosUserId: input.metidosUserId ?? null,
    threadId: input.threadId,
    success: input.success,
    reason: input.reason ?? null,
    text: input.message ?? null,
    ...(input.now ? { now: input.now } : {}),
  });
}

function isReplyRateLimited(
  database: Database,
  input: PluginIngressReplyGuardInput & {
    ingress: NonNullable<PluginIngressReplyGuardInput["ingress"]>;
  },
  now: Date,
): boolean {
  const windowStart = new Date(
    Math.floor(now.getTime() / PLUGIN_INGRESS_REPLY_RATE_LIMIT_WINDOW_MS) *
      PLUGIN_INGRESS_REPLY_RATE_LIMIT_WINDOW_MS,
  ).toISOString();
  const row = database
    .query<
      { count: number },
      [string, string, string, string | null, string, string]
    >(
      `SELECT count FROM plugin_ingress_rate_limit_markers
       WHERE plugin_id = ? AND source_id = ? AND external_user_id = ?
         AND conversation_id IS ? AND window_kind = ? AND window_start = ?`,
    )
    .get(
      input.pluginId,
      input.sourceId,
      input.ingress.externalUserId,
      input.ingress.conversationId ?? null,
      "reply_ten_minute",
      windowStart,
    );
  if ((row?.count ?? 0) >= PLUGIN_INGRESS_REPLY_RATE_LIMIT) return true;
  database
    .query(
      `INSERT INTO plugin_ingress_rate_limit_markers (
        plugin_id, source_id, external_user_id, conversation_id, window_kind,
        window_start, first_seen_at, last_seen_at, count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(plugin_id, source_id, external_user_id, conversation_id, window_kind, window_start)
      DO UPDATE SET last_seen_at = excluded.last_seen_at, count = count + 1`,
    )
    .run(
      input.pluginId,
      input.sourceId,
      input.ingress.externalUserId,
      input.ingress.conversationId ?? null,
      "reply_ten_minute",
      windowStart,
      now.toISOString(),
      now.toISOString(),
    );
  return false;
}
