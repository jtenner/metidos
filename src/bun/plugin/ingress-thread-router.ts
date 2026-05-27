/**
 * @file src/bun/plugin/ingress-thread-router.ts
 * @description Host-owned routing policy for verified Plugin System v1 ingress messages.
 */

import {
  estimateBase64ByteLength,
  isChatImageByteSizeAllowed,
  MAX_CHAT_IMAGE_ATTACHMENTS,
  normalizeChatImageMimeType,
  resolveChatPromptText,
  type ChatImageAttachment,
} from "../../shared/chat-images";
import { workContextLifecycle } from "../project-procedures/work-context-lifecycle";
import {
  PLUGIN_INGRESS_MESSAGE_MAX_LENGTH,
  PLUGIN_INGRESS_RENDERED_PROMPT_MAX_LENGTH,
  type PluginIngressMessage,
  type PluginIngressPromptTemplate,
} from "./ingress";

export const PLUGIN_INGRESS_THREAD_REUSE_WINDOW_MS = 30 * 60 * 1000;

const INGRESS_REPLY_REQUIRED_INSTRUCTION =
  "You are handling an external ingress request. The external user cannot see your response unless you use the `reply_to_source` tool. Before finishing every turn, use `reply_to_source` to send a concise, precise, and accurate response to the user's request when a response is appropriate.";

const UNSAFE_PERMISSION_NAMES = new Set(["unsafe", "metidos:unsafe"]);

export type PluginIngressRoute = Readonly<{
  id: string;
  metidosUserId?: number | null;
  projectId: number;
  worktreePath?: string | null;
  threadId?: number | null;
  model?: string | null;
  reasoningEffort?: string | null;
  permissions?: readonly string[] | null;
  enabled: boolean;
}>;

export type PluginIngressRouteLookupInput = Readonly<{
  pluginId: string;
  sourceId: string;
  externalUserId: string;
}>;

export type PluginIngressRouteThreadParams = Readonly<{
  projectId: number;
  worktreePath?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  permissions?: readonly string[] | null;
  metidosUserId?: number | null;
}>;

export type PluginIngressThreadCreateResult = Readonly<{ threadId: number }>;

export type PluginIngressThreadRouterHost = Readonly<{
  lookupRoute(
    input: PluginIngressRouteLookupInput,
  ): Promise<PluginIngressRoute | null> | PluginIngressRoute | null;
  assertRouteAccess(route: PluginIngressRoute): Promise<void> | void;
  createThread(
    params: PluginIngressRouteThreadParams,
  ): Promise<PluginIngressThreadCreateResult> | PluginIngressThreadCreateResult;
  sendThreadMessage(input: {
    threadId: number;
    metidosUserId?: number | null;
    input: string;
    images?: readonly ChatImageAttachment[];
  }): Promise<void> | void;
  markProcessed(input: {
    pluginId: string;
    sourceId: string;
    externalMessageId: string;
    threadId: number;
    routingMetadata: Record<string, unknown>;
  }): Promise<void> | void;
  markFailed(input: {
    pluginId: string;
    sourceId: string;
    externalMessageId: string;
    reason: string;
    metidosUserId?: number | null;
    threadId?: number | null;
    errorMetadata?: Record<string, unknown>;
  }): Promise<void> | void;
  audit(input: {
    decision: "message_routed" | "routing_failed";
    pluginId: string;
    sourceId: string;
    externalMessageId: string;
    externalUserId: string;
    conversationId?: string | null;
    metidosUserId?: number | null;
    threadId?: number | null;
    success: boolean;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> | void;
}>;

type ActiveIngressThread = {
  threadId: number;
  lastMessageAtMs: number;
};

export class PluginIngressThreadRouter {
  private readonly activeThreads = new Map<string, ActiveIngressThread>();
  private readonly now: () => number;

  constructor(
    private readonly host: PluginIngressThreadRouterHost,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  async routeVerifiedMessage(input: {
    afterThreadResolved?: (threadId: number) => Promise<void> | void;
    afterRouteFailed?: (failure: {
      reason: string;
      threadId?: number;
    }) => Promise<void> | void;
    pluginId: string;
    sourceId: string;
    sourceName: string;
    message: PluginIngressMessage;
    promptTemplate: PluginIngressPromptTemplate;
  }): Promise<
    { routed: true; threadId: number } | { routed: false; reason: string }
  > {
    const { pluginId, sourceId, message } = input;
    const fail = async (
      reason: string,
      metadata?: Record<string, unknown>,
      threadId?: number,
    ) => {
      await this.host.markFailed({
        pluginId,
        sourceId,
        externalMessageId: message.id,
        reason,
        ...(threadId === undefined ? {} : { threadId }),
        ...(metadata ? { errorMetadata: metadata } : {}),
      });
      await this.host.audit({
        decision: "routing_failed",
        pluginId,
        sourceId,
        externalMessageId: message.id,
        externalUserId: message.user_id,
        conversationId: message.conversation_id ?? null,
        ...(threadId === undefined ? {} : { threadId }),
        success: false,
        reason,
        ...(metadata ? { metadata } : {}),
      });
      await input.afterRouteFailed?.({
        reason,
        ...(threadId === undefined ? {} : { threadId }),
      });
      return { routed: false as const, reason };
    };

    if (
      message.conversation_id &&
      message.conversation_id !== message.user_id
    ) {
      return fail("unsupported_conversation_context", {
        conversationId: message.conversation_id,
      });
    }
    const images = normalizeIngressImages(message);
    if (!images.ok) return fail(images.reason);
    const resolvedMessage = resolveChatPromptText(
      message.message,
      images.value.length,
    );
    if (
      !resolvedMessage ||
      resolvedMessage.length > PLUGIN_INGRESS_MESSAGE_MAX_LENGTH
    ) {
      return fail("invalid_message_text");
    }

    let route: PluginIngressRoute | null;
    try {
      route = await this.host.lookupRoute({
        pluginId,
        sourceId,
        externalUserId: message.user_id,
      });
    } catch (error) {
      return fail("route_lookup_failed", routingErrorMetadata(error));
    }
    if (!route?.enabled) return fail("route_not_configured");
    const enabledRoute = route;

    const permissions = stripUnsafePermissions(
      enabledRoute.permissions ?? null,
    );
    if (containsUnsafePermission(enabledRoute.permissions ?? null)) {
      return fail("unsafe_permissions_not_allowed", {
        routeId: enabledRoute.id,
      });
    }

    try {
      await this.host.assertRouteAccess(enabledRoute);
    } catch (error) {
      return fail("route_access_failed", {
        ...routingErrorMetadata(error),
        routeId: enabledRoute.id,
      });
    }

    const rendered = await renderPromptTemplate({
      ...input,
      message: { ...message, message: resolvedMessage },
    });
    if (!rendered.ok)
      return fail(rendered.reason, { routeId: enabledRoute.id });

    let resolvedThreadId: number | undefined;
    let queued: { threadId: number } | null = null;
    try {
      queued = await workContextLifecycle.threads.queueCallerTurn({
        afterThreadResolved: async (threadId) => {
          resolvedThreadId = threadId;
          await input.afterThreadResolved?.(threadId);
        },
        input: rendered.prompt,
        queueTurn: ({ input, threadId }) =>
          this.host.sendThreadMessage({
            input,
            threadId,
            ...(images.value.length > 0 ? { images: images.value } : {}),
          }),
        resolveThreadId: () =>
          this.resolveThread(
            pluginId,
            sourceId,
            message,
            enabledRoute,
            permissions,
          ),
      });
    } catch (error) {
      return fail(
        "route_execution_failed",
        { ...routingErrorMetadata(error), routeId: enabledRoute.id },
        resolvedThreadId,
      );
    }
    if (!queued) {
      return fail(
        "route_execution_failed",
        {
          error: "Thread turn was not queued.",
          errorName: "InternalError",
          routeId: enabledRoute.id,
        },
        resolvedThreadId,
      );
    }
    const threadId = queued.threadId;
    await this.host.markProcessed({
      pluginId,
      sourceId,
      externalMessageId: message.id,
      threadId,
      routingMetadata: {
        routeId: enabledRoute.id,
        directChat: true,
        imageCount: images.value.length,
        reusedWindowMs: PLUGIN_INGRESS_THREAD_REUSE_WINDOW_MS,
      },
    });
    await this.host.audit({
      decision: "message_routed",
      pluginId,
      sourceId,
      externalMessageId: message.id,
      externalUserId: message.user_id,
      conversationId: message.conversation_id ?? null,
      threadId,
      success: true,
      metadata: { imageCount: images.value.length, routeId: enabledRoute.id },
    });
    return { routed: true, threadId };
  }

  expireInactive(): void {
    const cutoff = this.now() - PLUGIN_INGRESS_THREAD_REUSE_WINDOW_MS;
    for (const [key, value] of this.activeThreads) {
      if (value.lastMessageAtMs <= cutoff) this.activeThreads.delete(key);
    }
  }

  private async resolveThread(
    pluginId: string,
    sourceId: string,
    message: PluginIngressMessage,
    route: PluginIngressRoute,
    permissions: readonly string[] | null,
  ): Promise<number> {
    if (route.threadId) return route.threadId;
    this.expireInactive();
    const key = [pluginId, sourceId, route.id, message.user_id].join("\u001f");
    const existing = this.activeThreads.get(key);
    if (existing) {
      existing.lastMessageAtMs = this.now();
      return existing.threadId;
    }
    const created = await this.host.createThread({
      projectId: route.projectId,
      ...(route.worktreePath !== undefined
        ? { worktreePath: route.worktreePath }
        : {}),
      ...(route.model !== undefined ? { model: route.model } : {}),
      ...(route.reasoningEffort !== undefined
        ? { reasoningEffort: route.reasoningEffort }
        : {}),
      permissions,
    });
    this.activeThreads.set(key, {
      threadId: created.threadId,
      lastMessageAtMs: this.now(),
    });
    return created.threadId;
  }
}

function normalizeIngressImages(
  message: PluginIngressMessage,
): { ok: true; value: ChatImageAttachment[] } | { ok: false; reason: string } {
  const images = message.images ?? [];
  if (images.length === 0) return { ok: true, value: [] };
  if (images.length > MAX_CHAT_IMAGE_ATTACHMENTS) {
    return { ok: false, reason: "too_many_image_attachments" };
  }

  const normalized: ChatImageAttachment[] = [];
  for (const image of images) {
    if (image.type !== "image" || !image.data.trim()) {
      return { ok: false, reason: "invalid_image_attachment" };
    }
    const typeResult = normalizeChatImageMimeType(
      image.data,
      image.mimeType.trim().toLowerCase(),
    );
    if ("error" in typeResult) {
      return { ok: false, reason: "invalid_image_attachment" };
    }
    if (!isChatImageByteSizeAllowed(estimateBase64ByteLength(image.data))) {
      return { ok: false, reason: "image_attachment_too_large" };
    }
    normalized.push({
      type: "image",
      data: image.data.trim(),
      mimeType: typeResult.mimeType,
    });
  }

  return { ok: true, value: normalized };
}

async function renderPromptTemplate(input: {
  pluginId: string;
  sourceId: string;
  sourceName: string;
  message: PluginIngressMessage;
  promptTemplate: PluginIngressPromptTemplate;
}): Promise<{ ok: true; prompt: string } | { ok: false; reason: string }> {
  let sourceInstructions: string;
  try {
    const rendered = await input.promptTemplate({
      sourceId: input.sourceId,
      sourceName: input.sourceName,
      external_message_id: input.message.id,
      external_user_id: input.message.user_id,
      ...(input.message.conversation_id
        ? { external_conversation_id: input.message.conversation_id }
        : {}),
    });
    sourceInstructions = typeof rendered === "string" ? rendered.trim() : "";
  } catch {
    return { ok: false, reason: "rendered_prompt_failed" };
  }

  const messageFence = codeFenceForMessage(input.message.message);
  const instructionFence = codeFenceForMessage(sourceInstructions);
  const sourceInstructionSection = sourceInstructions
    ? `\n\nSource-specific instructions from ${input.sourceName} (${input.pluginId}/${input.sourceId}):\n\n${instructionFence}\n${sourceInstructions}\n${instructionFence}`
    : "";
  const prompt = `${INGRESS_REPLY_REQUIRED_INSTRUCTION}${sourceInstructionSection}\n\nThis is the user's message. Please respond if appropriate:\n\n${messageFence}\n${input.message.message}\n${messageFence}`;
  if (prompt.length > PLUGIN_INGRESS_RENDERED_PROMPT_MAX_LENGTH)
    return { ok: false, reason: "rendered_prompt_too_large" };
  return { ok: true, prompt };
}

function codeFenceForMessage(message: string): string {
  let longestRun = 0;
  for (const match of message.matchAll(/`+/g)) {
    longestRun = Math.max(longestRun, match[0]?.length ?? 0);
  }
  return "`".repeat(Math.max(3, longestRun + 1));
}

function routingErrorMetadata(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : typeof error;
  return {
    error: message.slice(0, 500),
    errorName: name.slice(0, 80),
  };
}

function containsUnsafePermission(
  permissions: readonly string[] | null,
): boolean {
  return (permissions ?? []).some((permission) =>
    UNSAFE_PERMISSION_NAMES.has(permission),
  );
}

function stripUnsafePermissions(
  permissions: readonly string[] | null,
): readonly string[] | null {
  if (!permissions) return null;
  return permissions.filter(
    (permission) => !UNSAFE_PERMISSION_NAMES.has(permission),
  );
}
