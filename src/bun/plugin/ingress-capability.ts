/**
 * @file src/bun/plugin/ingress-capability.ts
 * @description Internal capability seam for Plugin System v1 ingress polling, routing, and source replies.
 */

import type { Database } from "bun:sqlite";

import { getPluginIngressCursor, upsertPluginIngressCursor } from "../db";
import type { LogSubsystem } from "../logging";
import type { PiIngressReplyContext } from "../pi/ingress-reply-tool";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { recordUserNotificationDelivery } from "../user-notifications";
import {
  diagnosticCodeForUnknown,
  errorMessageForUnknown,
  type PluginCapabilitySidecarRequest,
} from "./execution-capability";
import type {
  PluginIngressPollContext,
  PluginIngressPollResult,
  PluginIngressPromptTemplateContext,
  PluginIngressResponseContext,
} from "./ingress";
import {
  PluginIngressBatchProcessor,
  type PluginIngressBatchSource,
  type PluginIngressBatchThreadHost,
  type PluginIngressLinkedExternalUserContext,
  type PluginIngressRoutedMessageContext,
  type PluginIngressRouteFailureContext,
} from "./ingress-batch-processor";
import {
  PluginIngressPollScheduler,
  type PluginIngressPollFailure,
  type PluginIngressPollMessageBatch,
} from "./ingress-poll-scheduler";
import { createPluginIngressAuditEvent } from "./ingress-store";
import type {
  PluginNotificationDeliveryControls,
  PluginNotificationSendInput,
  PluginNotificationSendResult,
} from "./notifications";
import type {
  PluginStartupIngressSourceRegistration,
  PluginStartupRegistrations,
} from "./startup-registrations";

export type PluginIngressNotificationSender = (
  input: PluginNotificationSendInput,
  controls?: PluginNotificationDeliveryControls,
) => Promise<PluginNotificationSendResult>;

export type PluginIngressCapabilityLogger = Pick<LogSubsystem, "warning">;

export type PluginIngressCapabilitySession = {
  directoryName: string;
  ingressSourceIds: Set<string>;
  plugin: RpcPluginInventoryPlugin;
  ready?: boolean;
  registrations: PluginStartupRegistrations | null;
  stopping?: boolean;
};

export type PluginIngressPollFailureTelemetryEvent = {
  directoryName: string;
  observedAt: string;
  pluginId: string;
  sourceId: string;
  type: "ingress_poll_failure";
};

function localOperatorUserId(database: Database): number {
  const row = database
    .query<{ id: number }, []>("SELECT id FROM users ORDER BY id ASC LIMIT 1")
    .get();
  if (!row) {
    throw new Error("Local operator user is not available.");
  }
  return row.id;
}

export type PluginIngressCapabilityPollFailure<TSession> = Readonly<{
  code: string;
  failure: PluginIngressPollFailure;
  message: string;
  operation: "ingress.poll";
  session: TSession;
}>;

export type PluginIngressCapabilitySidecarOperations<TSession> = Readonly<{
  findReadySession(input: { pluginId: string }): TSession | null | undefined;
  invokePoll(input: {
    context: PluginIngressPollContext;
    session: TSession;
    source: PluginStartupIngressSourceRegistration;
  }): Promise<PluginIngressPollResult>;
  invokePromptTemplate(input: {
    context: PluginIngressPromptTemplateContext;
    session: TSession;
    source: PluginStartupIngressSourceRegistration;
  }): Promise<string>;
  invokeResponse(input: {
    context: PluginIngressResponseContext;
    payload: { message: string };
    session: TSession;
    signal?: AbortSignal;
    source: PluginStartupIngressSourceRegistration;
  }): Promise<void>;
  onPollFailure?: (input: PluginIngressCapabilityPollFailure<TSession>) => void;
}>;

export function buildPluginIngressPollSidecarRequest(input: {
  context: PluginIngressPollContext;
  directoryName: string;
  source: PluginStartupIngressSourceRegistration;
}): PluginCapabilitySidecarRequest {
  return {
    directoryName: input.directoryName,
    operation: "ingress.poll",
    params: {
      context: {
        ...(input.context.cursor === undefined
          ? {}
          : { cursor: input.context.cursor }),
        maxMessages: input.context.maxMessages,
      },
      pollHandle: input.source.pollHandle,
      sourceId: input.source.id,
    },
    signal: input.context.signal,
    timeoutMs: input.source.timeoutMs,
  };
}

export function buildPluginIngressPromptTemplateSidecarRequest(input: {
  context: PluginIngressPromptTemplateContext;
  directoryName: string;
  source: PluginStartupIngressSourceRegistration;
}): PluginCapabilitySidecarRequest {
  return {
    directoryName: input.directoryName,
    operation: "ingress.prompt.template",
    params: {
      context: input.context,
      promptTemplateHandle: input.source.promptTemplateHandle,
      sourceId: input.source.id,
    },
    timeoutMs: input.source.timeoutMs,
  };
}

export function buildPluginIngressResponseSidecarRequest(input: {
  context: PluginIngressResponseContext;
  directoryName: string;
  payload: { message: string };
  signal?: AbortSignal;
  source: PluginStartupIngressSourceRegistration;
}): PluginCapabilitySidecarRequest {
  if (!input.source.respondHandle) {
    throw new Error("Ingress source does not support replies.");
  }
  return {
    directoryName: input.directoryName,
    operation: "ingress.respond",
    params: {
      context: input.context,
      payload: input.payload,
      respondHandle: input.source.respondHandle,
      sourceId: input.source.id,
    },
    ...(input.signal ? { signal: input.signal } : {}),
    timeoutMs: input.source.timeoutMs,
  };
}

export class PluginIngressCapability<
  TSession extends PluginIngressCapabilitySession,
> {
  private readonly activeReplyContexts = new Map<
    number,
    PiIngressReplyContext
  >();
  private readonly batchProcessor: PluginIngressBatchProcessor;
  private readonly getDatabase: () => Database;
  private readonly logger: PluginIngressCapabilityLogger;
  private readonly now: () => Date;
  private readonly operations: PluginIngressCapabilitySidecarOperations<TSession>;
  private readonly pollScheduler: PluginIngressPollScheduler;
  private readonly sendNotification: PluginIngressNotificationSender;

  constructor(options: {
    database: Database | (() => Database);
    ingressPollScheduler?: PluginIngressPollScheduler;
    ingressThreadHost?: PluginIngressBatchThreadHost | null;
    logger: PluginIngressCapabilityLogger;
    now?: () => Date;
    operations: PluginIngressCapabilitySidecarOperations<TSession>;
    sendNotification: PluginIngressNotificationSender;
  }) {
    const database = options.database;
    this.getDatabase =
      typeof database === "function" ? database : () => database;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.operations = options.operations;
    this.sendNotification = options.sendNotification;
    this.batchProcessor = new PluginIngressBatchProcessor(this.getDatabase, {
      threadHost: options.ingressThreadHost ?? null,
      sourceResolver: (input) => this.resolveBatchSource(input),
      now: () => this.now(),
      onLinkedExternalUser: (context) =>
        this.confirmLinkedExternalUser(context),
      onReplyContextReady: (context) => this.registerReplyContext(context),
      onRouteFailed: (context) => this.handleRouteFailure(context),
      onRoutedMessage: (context) => this.registerReplyContext(context),
    });
    this.pollScheduler =
      options.ingressPollScheduler ??
      new PluginIngressPollScheduler({
        hooks: {
          onBatch: (batch) => this.handlePollBatch(batch),
          onFailure: (failure) => this.handlePollFailure(failure),
        },
      });
  }

  registerSessionSources(session: TSession): void {
    this.unregisterSessionSources(session);
    if (
      !session.plugin.pluginId ||
      !session.registrations?.ingressSources.length
    ) {
      return;
    }
    const pluginId = session.plugin.pluginId;
    for (const source of session.registrations.ingressSources) {
      const persistedCursor = getPluginIngressCursor(
        this.getDatabase(),
        pluginId,
        source.id,
      )?.cursor;
      session.ingressSourceIds.add(source.id);
      this.pollScheduler.upsertSource({
        pluginId,
        sourceId: source.id,
        ...(persistedCursor === undefined
          ? {}
          : { initialCursor: persistedCursor }),
        pollIntervalMs: source.pollIntervalMs,
        timeoutMs: source.timeoutMs,
        eligibility: {
          pluginActive: session.plugin.status === "active",
          pluginApproved: Boolean(session.plugin.approvedReviewHash),
          pluginCurrent:
            Boolean(session.plugin.currentReviewHash) &&
            session.plugin.approvedReviewHash ===
              session.plugin.currentReviewHash,
          pluginLifecycleStatus: session.plugin.status,
          sourceEnabled: true,
        },
        poll: (context) =>
          this.operations.invokePoll({ context, session, source }),
      });
    }
  }

  unregisterSessionSources(session: TSession): void {
    if (!session.plugin.pluginId) {
      session.ingressSourceIds.clear();
      return;
    }
    for (const sourceId of session.ingressSourceIds) {
      this.pollScheduler.removeSource(session.plugin.pluginId, sourceId);
    }
    for (const [threadId, context] of this.activeReplyContexts) {
      if (context.pluginId === session.plugin.pluginId) {
        this.activeReplyContexts.delete(threadId);
      }
    }
    session.ingressSourceIds.clear();
  }

  async pollSourceNow(pluginId: string, sourceId: string): Promise<void> {
    await this.pollScheduler.pollNow(pluginId, sourceId);
  }

  removePlugin(pluginId: string): void {
    this.pollScheduler.removePlugin(pluginId);
    for (const [threadId, context] of this.activeReplyContexts) {
      if (context.pluginId === pluginId) {
        this.activeReplyContexts.delete(threadId);
      }
    }
  }

  getActiveReplyContext(threadId: number): PiIngressReplyContext | null {
    const context = this.activeReplyContexts.get(threadId);
    if (!context?.ingress?.responseContextEnabled) return null;
    const receivedAt = Date.parse(context.ingress.receivedAt);
    if (
      !Number.isFinite(receivedAt) ||
      this.now().getTime() - receivedAt > 30 * 60 * 1000
    ) {
      this.activeReplyContexts.delete(threadId);
      return null;
    }
    return context;
  }

  async sendReplyToSource(input: {
    pluginId: string;
    sourceId: string;
    responseContext: PluginIngressResponseContext;
    message: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const resolved = this.resolveReadySource(input);
    if (!resolved) {
      throw new Error("Ingress source is not active.");
    }
    await this.operations.invokeResponse({
      session: resolved.session,
      source: resolved.source,
      context: input.responseContext,
      payload: { message: input.message },
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  private async handlePollBatch(
    batch: PluginIngressPollMessageBatch,
  ): Promise<void> {
    await this.batchProcessor.processBatch(batch);
    if (batch.cursor === undefined) {
      return;
    }
    upsertPluginIngressCursor(this.getDatabase(), {
      pluginId: batch.pluginId,
      sourceId: batch.sourceId,
      cursor: batch.cursor,
    });
  }

  private handlePollFailure(failure: PluginIngressPollFailure): void {
    const session = this.operations.findReadySession({
      pluginId: failure.pluginId,
    });
    if (!session) {
      return;
    }
    this.operations.onPollFailure?.({
      code: diagnosticCodeForUnknown(failure.error),
      failure,
      message: `Plugin ingress source ${failure.sourceId} poll failed: ${errorMessageForUnknown(failure.error)}`,
      operation: "ingress.poll",
      session,
    });
  }

  private resolveBatchSource(input: {
    pluginId: string;
    sourceId: string;
  }): PluginIngressBatchSource | null {
    const resolved = this.resolveReadySource(input);
    if (!resolved) return null;
    return {
      id: resolved.source.id,
      name: resolved.source.name,
      promptTemplate: (context) =>
        this.operations.invokePromptTemplate({
          context,
          session: resolved.session,
          source: resolved.source,
        }),
      respondHandle: resolved.source.respondHandle,
      supportsReplyToSource: resolved.source.supportsReplyToSource,
    };
  }

  private resolveReadySource(input: { pluginId: string; sourceId: string }): {
    session: TSession;
    source: PluginStartupIngressSourceRegistration;
  } | null {
    const session = this.operations.findReadySession({
      pluginId: input.pluginId,
    });
    const source = session?.registrations?.ingressSources.find(
      (candidate) => candidate.id === input.sourceId,
    );
    if (!session || !source) return null;
    return { session, source };
  }

  private async confirmLinkedExternalUser(
    context: PluginIngressLinkedExternalUserContext,
  ): Promise<void> {
    const sourceName = context.source.name || context.sourceId;
    const title = `${sourceName} linked`;
    const body = `${sourceName} is now linked to your Metidos account. You can send messages from the external chat.`;
    try {
      recordUserNotificationDelivery(this.getDatabase(), {
        body,
        pluginId: context.pluginId,
        priority: "default",
        status: "sent",
        tags: ["ingress", "link"],
        title,
      });
    } catch (error) {
      this.logger.warning({
        error: errorMessageForUnknown(error),
        message: "Failed to record ingress link notification.",
        pluginId: context.pluginId,
        sourceId: context.sourceId,
      });
    }

    try {
      await this.sendNotification({
        body,
        context: {
          contextKind: "pluginIngressLink",
          ownerUserId: localOperatorUserId(this.getDatabase()),
        },
        pluginId: context.pluginId,
        priority: "default",
        tags: ["ingress", "link"],
        title,
      });
    } catch (error) {
      this.logger.warning({
        error: errorMessageForUnknown(error),
        message: "Failed to send ingress link notification.",
        pluginId: context.pluginId,
        sourceId: context.sourceId,
      });
    }

    await this.sendLinkSourceResponse(context, sourceName);
  }

  private async sendLinkSourceResponse(
    context: PluginIngressLinkedExternalUserContext,
    sourceName: string,
  ): Promise<void> {
    if (
      !context.source.supportsReplyToSource ||
      !context.source.respondHandle
    ) {
      return;
    }
    const resolved = this.resolveReadySource({
      pluginId: context.pluginId,
      sourceId: context.sourceId,
    });
    if (!resolved?.source.respondHandle) {
      return;
    }
    const responseContext: PluginIngressResponseContext = {
      external_message_id: context.record.externalMessageId,
      external_user_id: context.record.externalUserId,
      ...(context.record.conversationId
        ? { external_conversation_id: context.record.conversationId }
        : {}),
    };
    const message = `${sourceName} is linked to your Metidos account. You can now send messages here.`;
    createPluginIngressAuditEvent(this.getDatabase(), {
      pluginId: context.pluginId,
      sourceId: context.sourceId,
      decision: "reply_attempted",
      externalMessageId: context.record.externalMessageId,
      externalUserId: context.record.externalUserId,
      conversationId: context.record.conversationId,
      success: true,
      text: message,
    });
    try {
      await this.operations.invokeResponse({
        session: resolved.session,
        source: resolved.source,
        context: responseContext,
        payload: { message },
      });
      createPluginIngressAuditEvent(this.getDatabase(), {
        pluginId: context.pluginId,
        sourceId: context.sourceId,
        decision: "reply_succeeded",
        externalMessageId: context.record.externalMessageId,
        externalUserId: context.record.externalUserId,
        conversationId: context.record.conversationId,
        success: true,
        text: message,
      });
    } catch (error) {
      createPluginIngressAuditEvent(this.getDatabase(), {
        pluginId: context.pluginId,
        sourceId: context.sourceId,
        decision: "reply_failed",
        externalMessageId: context.record.externalMessageId,
        externalUserId: context.record.externalUserId,
        conversationId: context.record.conversationId,
        success: false,
        reason: errorMessageForUnknown(error),
        text: message,
      });
      this.logger.warning({
        error: errorMessageForUnknown(error),
        message: "Failed to send ingress link source response.",
        pluginId: context.pluginId,
        sourceId: context.sourceId,
      });
    }
  }

  private handleRouteFailure(context: PluginIngressRouteFailureContext): void {
    if (context.threadId !== undefined) {
      this.activeReplyContexts.delete(context.threadId);
    }
    this.logger.warning({
      externalMessageId: context.externalMessageId,
      message: "Plugin ingress route failed.",
      pluginId: context.pluginId,
      reason: context.reason,
      sourceId: context.sourceId,
      ...(context.threadId === undefined ? {} : { threadId: context.threadId }),
    });
  }

  private registerReplyContext(
    context: PluginIngressRoutedMessageContext,
  ): void {
    const resolved = this.resolveReadySource({
      pluginId: context.pluginId,
      sourceId: context.sourceId,
    });
    if (!resolved) return;
    this.activeReplyContexts.set(context.threadId, {
      database: this.getDatabase(),
      pluginId: context.pluginId,
      sourceId: context.sourceId,
      permissions: resolved.session.plugin.manifest.permissions,
      source: {
        supportsReplyToSource: resolved.source.supportsReplyToSource,
        respondHandle: resolved.source.respondHandle,
      },
      ingress: {
        externalMessageId: context.record.externalMessageId,
        externalUserId: context.record.externalUserId,
        conversationId: context.record.conversationId,
        metidosUserId: localOperatorUserId(this.getDatabase()),
        threadId: context.threadId,
        receivedAt: context.record.receivedAt,
        dedicatedThread: true,
        responseContextEnabled: Boolean(resolved.source.respondHandle),
      },
    });
  }
}
