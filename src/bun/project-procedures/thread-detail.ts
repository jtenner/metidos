/**
 * @file src/bun/project-procedures/thread-detail.ts
 * @description Module for thread detail.
 */

import {
  estimateBase64ByteLength,
  isChatImageByteSizeAllowed,
  normalizeChatImageMimeType,
} from "../../shared/chat-images";
import type { ThreadMessageRecord, ThreadRecord } from "../db";
import type {
  RpcChatImageAttachment,
  RpcThread,
  RpcThreadCompaction,
  RpcThreadMessage,
  RpcThreadRunStatus,
  RpcThreadUsage,
  RpcWorktree,
} from "../rpc-schema";
import { normalizeCommandDisplayText } from "./command-normalization";
import {
  heuristicCompactionTriggerTokens,
  normalizeStoredCodexModel,
  normalizeStoredCodexReasoningEffort,
} from "./model-catalog";
import { stripPiAssistantWebSearchMarkers } from "./pi-sdk-shapes";
import { shortName } from "./shared";

const CHAT_IMAGE_PREVIEW_MAX_EDGE_PX = 256;
const CHAT_IMAGE_PREVIEW_QUALITY = 60;
const LEGACY_THREAD_STOPPED_MESSAGE = "Codex turn was stopped by the user.";
const LEGACY_THREAD_INTERRUPTED_MESSAGE =
  "Codex turn was interrupted before completion.";

export const THREAD_STOPPED_MESSAGE = "Thread run was stopped by the user.";
export const THREAD_INTERRUPTED_MESSAGE =
  "Thread run was interrupted before completion.";

/**
 * Activity payload stored for command/file/tool messages.
 */
type CommandActivityPayload = {
  command: string;
  output: string;
  exitCode: number | null;
};

/**
 * Activity payload stored for filesystem-change messages.
 */
type FileChangeActivityPayload = {
  path: string;
  changeKind: "add" | "delete" | "update";
  diffText: string;
};

/**
 * Activity payload stored for tool-call messages.
 */
type ToolCallActivityPayload = {
  server: string;
  tool: string;
  argumentsText: string;
  output: string;
  outputImages?: unknown;
};

type ChatMessagePayload = {
  images?: unknown;
};

/**
 * Unread error exists when lastErrorAt exists and wasn't seen later.
 */
function hasUnreadThreadError(thread: ThreadRecord): boolean {
  return Boolean(
    thread.lastErrorAt &&
      (!thread.lastErrorSeenAt || thread.lastErrorSeenAt < thread.lastErrorAt),
  );
}
/**
 * Is stopped thread message.
 * @param message - Message payload.
 */

export function isStoppedThreadMessage(message: string | null): boolean {
  return (
    message === THREAD_STOPPED_MESSAGE ||
    message === THREAD_INTERRUPTED_MESSAGE ||
    message === LEGACY_THREAD_STOPPED_MESSAGE ||
    message === LEGACY_THREAD_INTERRUPTED_MESSAGE
  );
}

/**
 * Compute derived run state for a thread, preferring active status from runtime when present.
 */
export function threadRunStatusFromRecord(
  thread: ThreadRecord,
  activeStatus?: RpcThreadRunStatus,
): RpcThreadRunStatus {
  const hasUnreadError = hasUnreadThreadError(thread);
  if (activeStatus) {
    return {
      ...activeStatus,
      hasUnreadError: activeStatus.state === "stopped" ? false : hasUnreadError,
    };
  }

  if (thread.activeTurnStartedAt) {
    return {
      state: "working",
      startedAt: thread.activeTurnStartedAt,
      updatedAt: thread.updatedAt,
      error: null,
      hasUnreadError: false,
    };
  }

  const failureIsCurrent =
    thread.lastErrorAt &&
    (!thread.lastRunAt || thread.lastErrorAt >= thread.lastRunAt);
  if (failureIsCurrent) {
    if (isStoppedThreadMessage(thread.lastErrorMessage)) {
      return {
        state: "stopped",
        startedAt: null,
        updatedAt: thread.lastErrorAt,
        error: thread.lastErrorMessage,
        hasUnreadError: false,
      };
    }
    return {
      state: "failed",
      startedAt: null,
      updatedAt: thread.lastErrorAt,
      error: thread.lastErrorMessage ?? "Thread run failed.",
      hasUnreadError,
    };
  }

  return {
    state: "idle",
    startedAt: null,
    updatedAt: thread.lastRunAt ?? thread.updatedAt,
    error: null,
    hasUnreadError: false,
  };
}

/**
 * Convert token counters from DB record into optional RPC usage shape.
 */
function threadUsageFromRecord(thread: ThreadRecord): RpcThreadUsage | null {
  if (
    thread.lastInputTokens === null &&
    thread.lastCachedInputTokens === null &&
    thread.lastOutputTokens === null
  ) {
    return null;
  }
  return {
    inputTokens: thread.lastInputTokens ?? 0,
    cachedInputTokens: thread.lastCachedInputTokens ?? 0,
    outputTokens: thread.lastOutputTokens ?? 0,
  };
}

/**
 * Derive compaction telemetry with fallback heuristic and observed inference history.
 */
function threadCompactionFromRecord(thread: ThreadRecord): RpcThreadCompaction {
  return {
    estimatedTriggerTokens:
      thread.estimatedCompactionTriggerTokens ??
      heuristicCompactionTriggerTokens(thread.model),
    estimatedTriggerSource: thread.estimatedCompactionTriggerTokens
      ? "observed"
      : "heuristic",
    maxObservedInputTokens: thread.maxInputTokens,
    inferredCount: thread.compactionCount,
    lastInferredAt: thread.lastCompactionAt,
    lastInferredBeforeInputTokens: thread.lastCompactionBeforeInputTokens,
    lastInferredAfterInputTokens: thread.lastCompactionAfterInputTokens,
  };
}

/**
 * Convert DB thread record to RPC thread object with normalized model/effort and runtime status.
 */
export function toRpcThread(
  thread: ThreadRecord,
  activeStatus?: RpcThreadRunStatus,
): RpcThread {
  return {
    id: thread.id,
    projectId: thread.projectId,
    worktreePath: thread.worktreePath,
    title: thread.title,
    summary: thread.summary,
    model: normalizeStoredCodexModel(thread.model),
    reasoningEffort: normalizeStoredCodexReasoningEffort(
      thread.reasoningEffort,
    ),
    webSearchAccess: thread.webSearchAccess,
    githubAccess: thread.githubAccess,
    gitAccess: thread.gitAccess,
    sqliteAccess: thread.sqliteAccess,
    ...(thread.webServerAccess !== undefined
      ? { webServerAccess: thread.webServerAccess }
      : {}),
    agentsAccess: thread.agentsAccess,
    ...(thread.calendarAccess !== undefined
      ? { calendarAccess: thread.calendarAccess }
      : {}),
    ...(thread.notificationsAccess !== undefined
      ? { notificationsAccess: thread.notificationsAccess }
      : {}),
    ...(thread.weatherAccess !== undefined
      ? { weatherAccess: thread.weatherAccess }
      : {}),
    ...(thread.threadsAccess !== undefined
      ? { threadsAccess: thread.threadsAccess }
      : {}),
    ...(thread.cronsAccess !== undefined
      ? { cronsAccess: thread.cronsAccess }
      : {}),
    metidosAccess: thread.metidosAccess,
    ...(thread.pluginAccessGroups !== undefined
      ? { pluginAccessGroups: thread.pluginAccessGroups }
      : {}),
    permissions: thread.permissions,
    unsafeMode: thread.unsafeMode === 1,
    piSessionId: thread.piSessionId,
    piSessionFile: thread.piSessionFile,
    piLeafEntryId: thread.piLeafEntryId,
    pinnedAt: thread.pinnedAt,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastRunAt: thread.lastRunAt,
    usage: threadUsageFromRecord(thread),
    compaction: threadCompactionFromRecord(thread),
    runStatus: threadRunStatusFromRecord(thread, activeStatus),
  };
}

/**
 * Parse optional JSON payload on command/file/tool messages; fallback to null on invalid JSON.
 */
function parseActivityPayload<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeImageAttachmentsPayload(
  images: unknown,
): RpcChatImageAttachment[] {
  if (!Array.isArray(images)) {
    return [];
  }

  return images.flatMap((image): RpcChatImageAttachment[] => {
    if (!image || typeof image !== "object") {
      return [];
    }
    const candidate = image as {
      data?: unknown;
      mimeType?: unknown;
      type?: unknown;
    };
    if (
      candidate.type !== "image" ||
      typeof candidate.data !== "string" ||
      typeof candidate.mimeType !== "string"
    ) {
      return [];
    }
    const data = candidate.data.trim();
    if (!data || !isChatImageByteSizeAllowed(estimateBase64ByteLength(data))) {
      return [];
    }
    const normalized = normalizeChatImageMimeType(data, candidate.mimeType);
    if ("error" in normalized) {
      return [];
    }
    return [
      {
        data,
        mimeType: normalized.mimeType,
        type: "image",
      },
    ];
  });
}

function parseChatImageAttachments(
  value: string | null,
): RpcChatImageAttachment[] {
  const payload = parseActivityPayload<ChatMessagePayload>(value);
  return normalizeImageAttachmentsPayload(payload?.images);
}

type BunImageRuntime = {
  Image?: new (
    input: Blob | Buffer | Uint8Array,
    options?: { autoOrient?: boolean; maxPixels?: number },
  ) => {
    resize(
      width: number,
      height: number,
      options?: Record<string, unknown>,
    ): {
      webp(options?: { quality?: number }): { blob(): Promise<Blob> };
    };
  };
};

async function blobToBase64(blob: Blob): Promise<string> {
  return Buffer.from(await blob.arrayBuffer()).toString("base64");
}

async function createChatImagePreview(
  image: RpcChatImageAttachment,
): Promise<RpcChatImageAttachment | null> {
  const ImageCtor = (globalThis as { Bun?: BunImageRuntime }).Bun?.Image;
  if (!ImageCtor) {
    return null;
  }

  try {
    const originalData = image.data.trim();
    const sourceBytes = Buffer.from(originalData, "base64");
    const previewBlob = await new ImageCtor(sourceBytes, {
      maxPixels: 4096 * 4096,
    })
      .resize(CHAT_IMAGE_PREVIEW_MAX_EDGE_PX, CHAT_IMAGE_PREVIEW_MAX_EDGE_PX, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: CHAT_IMAGE_PREVIEW_QUALITY })
      .blob();
    const previewData = await blobToBase64(previewBlob);
    if (
      previewData.length === 0 ||
      (previewData.length >= originalData.length && sourceBytes.byteLength > 0)
    ) {
      return null;
    }
    return {
      type: "image",
      data: previewData,
      mimeType: "image/webp",
      byteSize: estimateBase64ByteLength(originalData),
      dataLoaded: false,
      previewByteSize: estimateBase64ByteLength(previewData),
      previewMimeType: "image/webp",
    };
  } catch {
    return null;
  }
}

async function withChatImagePreviews(
  images: readonly RpcChatImageAttachment[],
): Promise<RpcChatImageAttachment[]> {
  return Promise.all(
    images.map(async (image) => {
      const preview = await createChatImagePreview(image);
      return (
        preview ?? {
          type: "image" as const,
          data: "",
          mimeType: image.mimeType,
          byteSize: estimateBase64ByteLength(image.data),
          dataLoaded: false,
        }
      );
    }),
  );
}

/**
 * Convert a single persisted message into strongly-typed RPC message form.
 */
export function toRpcThreadMessage(
  message: ThreadMessageRecord,
  options?: { includeHeavyContent?: boolean },
): RpcThreadMessage {
  const includeHeavyContent = options?.includeHeavyContent ?? false;

  if (message.kind === "command" && message.itemId) {
    const payload = parseActivityPayload<CommandActivityPayload>(
      message.payloadJson,
    );
    return {
      id: message.id,
      threadId: message.threadId,
      role: "assistant",
      kind: "command",
      itemId: message.itemId,
      text: message.text,
      state:
        message.state === "completed" ||
        message.state === "failed" ||
        message.state === "stopped"
          ? message.state
          : "in_progress",
      command: normalizeCommandDisplayText(payload?.command ?? message.text),
      output: includeHeavyContent ? (payload?.output ?? "") : "",
      outputLoaded: includeHeavyContent,
      exitCode: typeof payload?.exitCode === "number" ? payload.exitCode : null,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  if (message.kind === "file_change" && message.itemId) {
    const payload = parseActivityPayload<FileChangeActivityPayload>(
      message.payloadJson,
    );
    return {
      id: message.id,
      threadId: message.threadId,
      role: "assistant",
      kind: "file_change",
      itemId: message.itemId,
      text: message.text,
      state:
        message.state === "in_progress" ||
        message.state === "failed" ||
        message.state === "stopped"
          ? message.state
          : "completed",
      path: payload?.path ?? message.text,
      changeKind: payload?.changeKind ?? "update",
      diffText: includeHeavyContent ? (payload?.diffText ?? "") : "",
      diffLoaded: includeHeavyContent,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  if (message.kind === "tool_call" && message.itemId) {
    const payload = parseActivityPayload<ToolCallActivityPayload>(
      message.payloadJson,
    );
    return {
      id: message.id,
      threadId: message.threadId,
      role: "assistant",
      kind: "tool_call",
      itemId: message.itemId,
      text: message.text,
      state:
        message.state === "in_progress" ||
        message.state === "failed" ||
        message.state === "stopped"
          ? message.state
          : "completed",
      server: payload?.server ?? "",
      tool: payload?.tool ?? message.text,
      argumentsText: payload?.argumentsText ?? "",
      output: includeHeavyContent ? (payload?.output ?? "") : "",
      outputLoaded: includeHeavyContent,
      ...(payload?.outputImages
        ? {
            outputImages: includeHeavyContent
              ? normalizeImageAttachmentsPayload(payload.outputImages).map(
                  (image) => ({
                    ...image,
                    byteSize: estimateBase64ByteLength(image.data),
                    dataLoaded: true,
                  }),
                )
              : normalizeImageAttachmentsPayload(payload.outputImages).map(
                  (image) => ({
                    type: "image" as const,
                    data: "",
                    mimeType: image.mimeType,
                    byteSize: estimateBase64ByteLength(image.data),
                    dataLoaded: false,
                  }),
                ),
          }
        : {}),
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  if (message.kind === "web_search" && message.itemId) {
    return {
      id: message.id,
      threadId: message.threadId,
      role: "assistant",
      kind: "web_search",
      itemId: message.itemId,
      text: message.text,
      state:
        message.state === "completed" || message.state === "stopped"
          ? message.state
          : "in_progress",
      query: message.text,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  if (message.kind === "error" && message.itemId) {
    return {
      id: message.id,
      threadId: message.threadId,
      role: "assistant",
      kind: "error",
      itemId: message.itemId,
      text: message.text,
      state:
        message.state === "completed" || message.state === "stopped"
          ? message.state
          : "in_progress",
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  if (message.kind === "reasoning" && message.itemId) {
    return {
      id: message.id,
      threadId: message.threadId,
      role: "assistant",
      kind: "reasoning",
      itemId: message.itemId,
      text: message.text,
      state:
        message.state === "completed" || message.state === "stopped"
          ? message.state
          : "in_progress",
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  const chatText = stripPiAssistantWebSearchMarkers(message.text);
  const images = parseChatImageAttachments(message.payloadJson);
  const rpcImages = includeHeavyContent
    ? images.map((image) => ({
        ...image,
        byteSize: estimateBase64ByteLength(image.data),
        dataLoaded: true,
      }))
    : images.map((image) => ({
        type: "image" as const,
        data: "",
        mimeType: image.mimeType,
        byteSize: estimateBase64ByteLength(image.data),
        dataLoaded: false,
      }));
  return {
    id: message.id,
    threadId: message.threadId,
    role: message.role,
    kind: "chat",
    itemId: message.itemId,
    text: chatText,
    ...(rpcImages.length > 0 ? { images: rpcImages } : {}),
    state:
      message.state === "in_progress" ||
      message.state === "completed" ||
      message.state === "failed" ||
      message.state === "stopped"
        ? message.state
        : null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

/**
 * Map stored thread messages to RPC wire shape.
 */
export function toRpcThreadMessages(
  messages: ThreadMessageRecord[],
  options?: { includeHeavyContent?: boolean },
): RpcThreadMessage[] {
  const rpcMessages: RpcThreadMessage[] = [];
  for (const persistedMessage of messages) {
    const message = toRpcThreadMessage(persistedMessage, options);
    if (
      message.kind === "chat" &&
      message.text.trim().length === 0 &&
      (message.images?.length ?? 0) === 0
    ) {
      continue;
    }
    rpcMessages.push(message);
  }
  return rpcMessages;
}

export async function toRpcThreadMessagesWithPreviews(
  messages: ThreadMessageRecord[],
  options?: { includeHeavyContent?: boolean },
): Promise<RpcThreadMessage[]> {
  if (options?.includeHeavyContent) {
    return toRpcThreadMessages(messages, options);
  }

  const rpcMessages = await Promise.all(
    messages.map(async (persistedMessage) => {
      const message = toRpcThreadMessage(persistedMessage, options);
      if (message.kind === "chat" && message.images?.length) {
        return {
          ...message,
          images: await withChatImagePreviews(
            parseChatImageAttachments(persistedMessage.payloadJson),
          ),
        };
      }
      if (message.kind === "tool_call" && message.outputImages?.length) {
        const payload = parseActivityPayload<ToolCallActivityPayload>(
          persistedMessage.payloadJson,
        );
        return {
          ...message,
          outputImages: await withChatImagePreviews(
            normalizeImageAttachmentsPayload(payload?.outputImages),
          ),
        };
      }
      return message;
    }),
  );
  return rpcMessages.filter(
    (message) =>
      message.kind !== "chat" ||
      message.text.trim().length > 0 ||
      (message.images?.length ?? 0) > 0,
  );
}

/**
 * Build display title from branch name or fallback directory short name.
 */
export function buildThreadTitle(
  worktree: RpcWorktree | null,
  worktreePath: string,
): string {
  return worktree?.branch?.trim() || shortName(worktreePath);
}
