/**
 * @file src/bun/plugin/ingress-batch-processor.ts
 * @description Host-owned processing pipeline for polled Plugin System v1 ingress messages.
 */

import type { Database } from "bun:sqlite";
import { resolveChatPromptText } from "../../shared/chat-images";
import type {
  PluginIngressMessage,
  PluginIngressPromptTemplate,
} from "./ingress";
import type { PluginIngressPollMessageBatch } from "./ingress-poll-scheduler";
import {
  consumePluginIngressLinkCodeForExternalUser,
  createPluginIngressAuditEvent,
  getPluginIngressExternalBinding,
  getPluginIngressMessage,
  markPluginIngressMessageFailed,
  markPluginIngressMessageProcessed,
  persistPluginIngressMessage,
  type PluginIngressExternalBindingRecord,
  type PluginIngressMessageRecord,
} from "./ingress-store";
import {
  PluginIngressThreadRouter,
  type PluginIngressRoute,
  type PluginIngressRouteLookupInput,
  type PluginIngressRouteThreadParams,
  type PluginIngressThreadCreateResult,
} from "./ingress-thread-router";

export type PluginIngressBatchSource = Readonly<{
  id: string;
  name: string;
  promptTemplate: PluginIngressPromptTemplate;
  respondHandle?: string | null;
  supportsReplyToSource: boolean;
}>;

export type PluginIngressBatchSourceResolver = (
  input: Readonly<{ pluginId: string; sourceId: string }>,
) => Promise<PluginIngressBatchSource | null> | PluginIngressBatchSource | null;

export type PluginIngressBatchThreadHost = Readonly<{
  lookupRoute(
    input: PluginIngressRouteLookupInput,
  ): Promise<PluginIngressRoute | null> | PluginIngressRoute | null;
  assertRouteAccess(route: PluginIngressRoute): Promise<void> | void;
  createThread(
    params: PluginIngressRouteThreadParams,
  ): Promise<PluginIngressThreadCreateResult> | PluginIngressThreadCreateResult;
  sendThreadMessage(input: {
    threadId: number;
    input: string;
    images?: PluginIngressMessage["images"];
  }): Promise<void> | void;
}>;

export type PluginIngressRoutedMessageContext = Readonly<{
  pluginId: string;
  sourceId: string;
  source: PluginIngressBatchSource;
  record: PluginIngressMessageRecord;
  threadId: number;
}>;

export type PluginIngressLinkedExternalUserContext = Readonly<{
  binding: PluginIngressExternalBindingRecord;
  pluginId: string;
  record: PluginIngressMessageRecord;
  source: PluginIngressBatchSource;
  sourceId: string;
}>;

export type PluginIngressRouteFailureContext = Readonly<{
  externalMessageId: string;
  pluginId: string;
  reason: string;
  sourceId: string;
  threadId?: number;
}>;

const UNKNOWN_INGRESS_BATCH_SOURCE: PluginIngressBatchSource = {
  id: "unknown",
  name: "Unknown ingress source",
  promptTemplate: () => "Unknown ingress source.",
  supportsReplyToSource: false,
};

const ROUTE_NOT_CONFIGURED_THREAD_HOST: PluginIngressBatchThreadHost = {
  lookupRoute: () => null,
  assertRouteAccess: () => {},
  createThread: () => {
    throw new Error("Ingress route is not configured.");
  },
  sendThreadMessage: () => {},
};

const LINK_COMMAND_PATTERN =
  /^\/?link(?:@[A-Za-z0-9_]{1,32})?\s+([A-Za-z0-9]{8})$/i;
const LINK_CODE_ONLY_PATTERN = /^[A-Za-z0-9]{8}$/;

function storablePluginIngressMessageText(
  message: PluginIngressMessage,
): string {
  return resolveChatPromptText(message.message, message.images?.length ?? 0);
}

export function extractPluginIngressLinkCode(
  messageText: string,
): string | null {
  const normalized = messageText.trim();
  if (LINK_CODE_ONLY_PATTERN.test(normalized)) {
    return normalized.toUpperCase();
  }
  const match = LINK_COMMAND_PATTERN.exec(normalized);
  return match?.[1] ? match[1].toUpperCase() : null;
}

function isPluginIngressLinkCommand(messageText: string): boolean {
  return /^\/?link(?:@[A-Za-z0-9_]{1,32})?(?:\s|$)/i.test(messageText.trim());
}

export class PluginIngressBatchProcessor {
  private readonly router: PluginIngressThreadRouter;
  private readonly threadHost: PluginIngressBatchThreadHost;
  private readonly sourceResolver: PluginIngressBatchSourceResolver;
  private readonly onReplyContextReady:
    | ((context: PluginIngressRoutedMessageContext) => void)
    | undefined;
  private readonly onRouteFailed:
    | ((context: PluginIngressRouteFailureContext) => void)
    | undefined;
  private readonly onRoutedMessage:
    | ((context: PluginIngressRoutedMessageContext) => void)
    | undefined;
  private readonly onLinkedExternalUser:
    | ((
        context: PluginIngressLinkedExternalUserContext,
      ) => Promise<void> | void)
    | undefined;
  private readonly getDatabase: () => Database;
  private readonly sourcesByKey = new Map<string, PluginIngressBatchSource>();

  constructor(
    database: Database | (() => Database),
    options: {
      threadHost?: PluginIngressBatchThreadHost | null;
      sourceResolver: PluginIngressBatchSourceResolver;
      now?: () => Date;
      onLinkedExternalUser?: (
        context: PluginIngressLinkedExternalUserContext,
      ) => Promise<void> | void;
      onReplyContextReady?: (
        context: PluginIngressRoutedMessageContext,
      ) => void;
      onRouteFailed?: (context: PluginIngressRouteFailureContext) => void;
      onRoutedMessage?: (context: PluginIngressRoutedMessageContext) => void;
    },
  ) {
    this.getDatabase =
      typeof database === "function" ? database : () => database;
    this.threadHost = options.threadHost ?? ROUTE_NOT_CONFIGURED_THREAD_HOST;
    this.sourceResolver = options.sourceResolver;
    this.onLinkedExternalUser = options.onLinkedExternalUser;
    this.onReplyContextReady = options.onReplyContextReady;
    this.onRouteFailed = options.onRouteFailed;
    this.onRoutedMessage = options.onRoutedMessage;
    this.router = new PluginIngressThreadRouter(
      {
        lookupRoute: (input) => this.threadHost.lookupRoute(input),
        assertRouteAccess: (route) => this.threadHost.assertRouteAccess(route),
        createThread: (params) => this.threadHost.createThread(params),
        sendThreadMessage: (input) => this.threadHost.sendThreadMessage(input),
        markProcessed: (input) => {
          const record = markPluginIngressMessageProcessed(
            this.getDatabase(),
            input,
          );
          this.onRoutedMessage?.({
            pluginId: input.pluginId,
            sourceId: input.sourceId,
            source:
              this.sourcesByKey.get(this.key(input.pluginId, input.sourceId)) ??
              UNKNOWN_INGRESS_BATCH_SOURCE,
            record,
            threadId: input.threadId,
          });
        },
        markFailed: (input) => {
          markPluginIngressMessageFailed(this.getDatabase(), input);
        },
        audit: (input) => {
          createPluginIngressAuditEvent(this.getDatabase(), input);
        },
      },
      { now: () => (options.now ?? (() => new Date()))().getTime() },
    );
  }

  async processBatch(batch: PluginIngressPollMessageBatch): Promise<void> {
    const source = await this.sourceResolver({
      pluginId: batch.pluginId,
      sourceId: batch.sourceId,
    });
    if (!source) {
      for (const message of batch.messages) {
        await this.recordInvalidSourceMessage(batch, message);
      }
      return;
    }

    this.sourcesByKey.set(this.key(batch.pluginId, batch.sourceId), source);
    for (const message of batch.messages) {
      await this.processMessage(batch, source, message);
    }
  }

  private async processMessage(
    batch: PluginIngressPollMessageBatch,
    source: PluginIngressBatchSource,
    message: PluginIngressMessage,
  ): Promise<void> {
    const database = this.getDatabase();
    const existing = getPluginIngressMessage(
      database,
      batch.pluginId,
      batch.sourceId,
      message.id,
    );
    if (existing) {
      return;
    }

    const linkCode = extractPluginIngressLinkCode(message.message);
    if (linkCode || isPluginIngressLinkCommand(message.message)) {
      await this.processLinkMessage(batch, source, message, linkCode);
      return;
    }

    const binding = getPluginIngressExternalBinding(
      database,
      batch.pluginId,
      batch.sourceId,
      message.user_id,
    );
    if (!binding?.enabled) {
      const stored = persistPluginIngressMessage(database, {
        pluginId: batch.pluginId,
        sourceId: batch.sourceId,
        externalMessageId: message.id,
        externalUserId: message.user_id,
        conversationId: message.conversation_id ?? null,
        messageText: storablePluginIngressMessageText(message),
        status: "unverified",
      });
      if (!stored.rateLimited) {
        createPluginIngressAuditEvent(database, {
          pluginId: batch.pluginId,
          sourceId: batch.sourceId,
          decision: "unverified_rejected",
          externalMessageId: message.id,
          externalUserId: message.user_id,
          conversationId: message.conversation_id ?? null,
          success: false,
          reason: binding ? "binding_disabled" : "binding_not_found",
        });
      }
      return;
    }

    const persisted = persistPluginIngressMessage(database, {
      pluginId: batch.pluginId,
      sourceId: batch.sourceId,
      externalMessageId: message.id,
      externalUserId: message.user_id,
      conversationId: message.conversation_id ?? null,
      messageText: storablePluginIngressMessageText(message),
      status: "verified",
      responseHandle: source.respondHandle ?? null,
    });

    await this.router.routeVerifiedMessage({
      afterRouteFailed: (context) => {
        this.onRouteFailed?.({
          externalMessageId: message.id,
          pluginId: batch.pluginId,
          reason: context.reason,
          sourceId: batch.sourceId,
          ...(context.threadId === undefined
            ? {}
            : { threadId: context.threadId }),
        });
      },
      afterThreadResolved: (threadId) => {
        if (!persisted.record) return;
        this.onReplyContextReady?.({
          pluginId: batch.pluginId,
          sourceId: batch.sourceId,
          source,
          record: persisted.record,
          threadId,
        });
      },
      pluginId: batch.pluginId,
      sourceId: batch.sourceId,
      sourceName: source.name,
      message,
      promptTemplate: source.promptTemplate,
    });
  }

  private async processLinkMessage(
    batch: PluginIngressPollMessageBatch,
    source: PluginIngressBatchSource,
    message: PluginIngressMessage,
    linkCode: string | null,
  ): Promise<void> {
    const database = this.getDatabase();
    if (!linkCode) {
      persistPluginIngressMessage(database, {
        pluginId: batch.pluginId,
        sourceId: batch.sourceId,
        externalMessageId: message.id,
        externalUserId: message.user_id,
        conversationId: message.conversation_id ?? null,
        messageText: storablePluginIngressMessageText(message),
        status: "failed",
        errorMetadata: JSON.stringify({ reason: "link_code_malformed" }),
      });
      createPluginIngressAuditEvent(database, {
        pluginId: batch.pluginId,
        sourceId: batch.sourceId,
        decision: "link_code_used",
        externalMessageId: message.id,
        externalUserId: message.user_id,
        conversationId: message.conversation_id ?? null,
        success: false,
        reason: "malformed",
      });
      return;
    }

    const result = consumePluginIngressLinkCodeForExternalUser(database, {
      pluginId: batch.pluginId,
      sourceId: batch.sourceId,
      externalUserId: message.user_id,
      code: linkCode,
    });
    if (!result.ok) {
      persistPluginIngressMessage(database, {
        pluginId: batch.pluginId,
        sourceId: batch.sourceId,
        externalMessageId: message.id,
        externalUserId: message.user_id,
        conversationId: message.conversation_id ?? null,
        messageText: storablePluginIngressMessageText(message),
        status: "failed",
        errorMetadata: JSON.stringify({ reason: `link_code_${result.reason}` }),
      });
      createPluginIngressAuditEvent(database, {
        pluginId: batch.pluginId,
        sourceId: batch.sourceId,
        decision: "link_code_used",
        externalMessageId: message.id,
        externalUserId: message.user_id,
        conversationId: message.conversation_id ?? null,
        success: false,
        reason: result.reason,
      });
      return;
    }

    const stored = persistPluginIngressMessage(database, {
      pluginId: batch.pluginId,
      sourceId: batch.sourceId,
      externalMessageId: message.id,
      externalUserId: message.user_id,
      conversationId: message.conversation_id ?? null,
      messageText: storablePluginIngressMessageText(message),
      status: "processed",
      responseHandle: source.respondHandle ?? null,
      routingMetadata: JSON.stringify({ kind: "link_code" }),
    });
    if (stored.record) {
      try {
        await this.onLinkedExternalUser?.({
          binding: result.binding,
          pluginId: batch.pluginId,
          record: stored.record,
          source,
          sourceId: batch.sourceId,
        });
      } catch {
        // Confirmation failures must not undo the verified binding or poison
        // the ingress cursor. The sidecar manager records best-effort audit
        // details for failed source replies; notification delivery failures are
        // separately logged by PluginIngressCapability.confirmLinkedExternalUser.
      }
    }
  }

  private key(pluginId: string, sourceId: string): string {
    return `${pluginId}\u0000${sourceId}`;
  }

  private async recordInvalidSourceMessage(
    batch: PluginIngressPollMessageBatch,
    message: PluginIngressMessage,
  ): Promise<void> {
    try {
      persistPluginIngressMessage(this.getDatabase(), {
        pluginId: batch.pluginId,
        sourceId: batch.sourceId,
        externalMessageId: message.id,
        externalUserId: message.user_id,
        conversationId: message.conversation_id ?? null,
        messageText: storablePluginIngressMessageText(message),
        status: "failed",
        errorMetadata: JSON.stringify({
          reason: "ingress_source_not_registered",
        }),
      });
      createPluginIngressAuditEvent(this.getDatabase(), {
        pluginId: batch.pluginId,
        sourceId: batch.sourceId,
        decision: "routing_failed",
        externalMessageId: message.id,
        externalUserId: message.user_id,
        conversationId: message.conversation_id ?? null,
        success: false,
        reason: "ingress_source_not_registered",
      });
    } catch {
      // Invalid source or message identifiers are rejected before durable storage.
      // The poll operation itself remains successful so one malformed message does
      // not poison the source cursor forever.
    }
  }
}
