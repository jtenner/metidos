/**
 * @file src/mainview/app/transcript-state.ts
 * @description Pure transcript state projection, row caching, media payloads, and history merging.
 */

import type {
  RpcChatImageAttachment,
  RpcProject,
  RpcThread,
  RpcThreadMessage,
} from "../../bun/rpc-schema";
import { estimateBase64ByteLength } from "../../shared/chat-images";
import { APP_TITLE } from "./mainview-ui-state";
import type {
  VisibleMediaPayloads,
  VisibleMessage,
} from "./visible-message-state";

function isStrictlyIncreasingMessageRange(
  messages: RpcThreadMessage[],
  minimumExclusiveId: number,
): boolean {
  let previousMessageId = minimumExclusiveId;
  for (const message of messages) {
    if (message.id <= previousMessageId) {
      return false;
    }
    previousMessageId = message.id;
  }
  return true;
}

function sortMessagesByIdIfNeeded(
  messages: RpcThreadMessage[],
): RpcThreadMessage[] {
  return isStrictlyIncreasingMessageRange(messages, Number.NEGATIVE_INFINITY)
    ? messages
    : [...messages].sort((left, right) => left.id - right.id);
}

function mergeThreadMessageContent(
  current: RpcThreadMessage,
  incoming: RpcThreadMessage,
): RpcThreadMessage {
  if (current.kind !== incoming.kind) {
    return incoming;
  }

  if (
    (current.kind === "command" || current.kind === "tool_call") &&
    incoming.kind === current.kind &&
    current.outputLoaded !== false &&
    incoming.outputLoaded === false
  ) {
    return {
      ...incoming,
      output: current.output,
      outputLoaded: true,
      ...(current.kind === "tool_call" && current.outputImages
        ? { outputImages: current.outputImages }
        : {}),
    };
  }

  if (
    current.kind === "file_change" &&
    incoming.kind === "file_change" &&
    current.diffLoaded !== false &&
    incoming.diffLoaded === false
  ) {
    return { ...incoming, diffText: current.diffText, diffLoaded: true };
  }

  return incoming;
}

export function mergeThreadMessageHistory(
  current: RpcThreadMessage[],
  incoming: RpcThreadMessage[],
): RpcThreadMessage[] {
  if (incoming.length === 0) {
    return current;
  }
  if (current.length === 0) {
    return sortMessagesByIdIfNeeded(incoming);
  }

  const sortedCurrent = sortMessagesByIdIfNeeded(current);
  const sortedIncoming = sortMessagesByIdIfNeeded(incoming);
  const currentFirstMessageId = sortedCurrent[0]?.id ?? 0;
  const currentLastMessageId = sortedCurrent[sortedCurrent.length - 1]?.id ?? 0;
  const incomingFirstMessageId = sortedIncoming[0]?.id ?? 0;
  const incomingLastMessageId =
    sortedIncoming[sortedIncoming.length - 1]?.id ?? 0;

  if (
    currentLastMessageId < incomingFirstMessageId &&
    isStrictlyIncreasingMessageRange(sortedIncoming, currentLastMessageId)
  ) {
    return [...sortedCurrent, ...sortedIncoming];
  }

  if (
    incomingLastMessageId < currentFirstMessageId &&
    isStrictlyIncreasingMessageRange(sortedIncoming, Number.NEGATIVE_INFINITY)
  ) {
    return [...sortedIncoming, ...sortedCurrent];
  }

  const mergedMessages: RpcThreadMessage[] = [];
  let currentIndex = 0;
  let incomingIndex = 0;

  while (
    currentIndex < sortedCurrent.length ||
    incomingIndex < sortedIncoming.length
  ) {
    const currentMessage = sortedCurrent[currentIndex] ?? null;
    const incomingMessage = sortedIncoming[incomingIndex] ?? null;

    if (!incomingMessage) {
      if (currentMessage) {
        mergedMessages.push(currentMessage);
      }
      currentIndex += 1;
      continue;
    }
    if (!currentMessage) {
      mergedMessages.push(incomingMessage);
      incomingIndex += 1;
      continue;
    }
    if (currentMessage.id === incomingMessage.id) {
      mergedMessages.push(
        mergeThreadMessageContent(currentMessage, incomingMessage),
      );
      currentIndex += 1;
      incomingIndex += 1;
      continue;
    }
    if (currentMessage.id < incomingMessage.id) {
      mergedMessages.push(currentMessage);
      currentIndex += 1;
      continue;
    }

    mergedMessages.push(incomingMessage);
    incomingIndex += 1;
  }

  return mergedMessages;
}

type VisibleMessageCacheEntry = {
  signature: string;
  value: VisibleMessage;
};

let threadMessageSignatureCache = new WeakMap<RpcThreadMessage, string>();
export const COMPACT_TEXT_SIGNATURE_CACHE_LIMIT = 256;
export const COMPACT_TEXT_SIGNATURE_CACHE_MAX_BYTES = 16 * 1024;
const COMPACT_TEXT_SIGNATURE_CACHE_MAX_KEY_LENGTH = 512;
export const VISIBLE_MESSAGE_CACHE_MAX_ENTRIES = 600;
const VISIBLE_MESSAGE_CACHE_MAX_TEXT_BYTES = 2 * 1024 * 1024;
const compactTextSignatureCache = new Map<string, string>();
let compactTextSignatureCacheBytes = 0;

type HotImportMeta = ImportMeta & {
  hot?: {
    dispose: (callback: () => void) => void;
  };
};

export function clearVisibleMessageSignatureCaches(): void {
  threadMessageSignatureCache = new WeakMap<RpcThreadMessage, string>();
  compactTextSignatureCache.clear();
  compactTextSignatureCacheBytes = 0;
}

(import.meta as HotImportMeta).hot?.dispose(clearVisibleMessageSignatureCaches);

function readCachedVisibleMessage(
  cache: Map<string, VisibleMessageCacheEntry>,
  cacheKey: string,
  signature: string,
  createValue: () => VisibleMessage,
): VisibleMessage {
  const existing = cache.get(cacheKey);
  if (existing && existing.signature === signature) {
    return existing.value;
  }

  const nextValue = createValue();
  cache.set(cacheKey, {
    signature,
    value: nextValue,
  });
  return nextValue;
}

function visibleMessageTextBytes(entry: unknown): number {
  if (
    typeof entry !== "object" ||
    entry === null ||
    !("value" in entry) ||
    typeof entry.value !== "object" ||
    entry.value === null ||
    !("text" in entry.value) ||
    typeof entry.value.text !== "string"
  ) {
    return 0;
  }
  return entry.value.text.length * 2;
}

export function pruneVisibleMessageCache(
  cache: Map<string, unknown>,
  retainedKeys: Iterable<string>,
): void {
  const retainedKeySet = new Set(retainedKeys);
  let retainedTextBytes = 0;
  for (const [cacheKey, entry] of cache) {
    if (!retainedKeySet.has(cacheKey)) {
      cache.delete(cacheKey);
      continue;
    }
    retainedTextBytes += visibleMessageTextBytes(entry);
  }

  while (
    cache.size > VISIBLE_MESSAGE_CACHE_MAX_ENTRIES ||
    retainedTextBytes > VISIBLE_MESSAGE_CACHE_MAX_TEXT_BYTES
  ) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    const oldestEntry = cache.get(oldestKey);
    cache.delete(oldestKey);
    retainedTextBytes = Math.max(
      0,
      retainedTextBytes -
        (oldestEntry ? visibleMessageTextBytes(oldestEntry) : 0),
    );
  }
}

export function compactTextSignature(value: string | undefined): string {
  if (!value) {
    return "0:0";
  }

  // Skip caching for long strings to avoid retaining large text as Map keys.
  // The hash computation is fast enough that caching only short strings
  // provides the best trade-off between speed and memory.
  if (value.length > COMPACT_TEXT_SIGNATURE_CACHE_MAX_KEY_LENGTH) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${value.length}:${hash >>> 0}`;
  }

  const cachedSignature = compactTextSignatureCache.get(value);
  if (cachedSignature) {
    compactTextSignatureCache.delete(value);
    compactTextSignatureCache.set(value, cachedSignature);
    return cachedSignature;
  }

  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const signature = `${value.length}:${hash >>> 0}`;
  compactTextSignatureCache.set(value, signature);
  compactTextSignatureCacheBytes += value.length * 2 + signature.length * 2;
  // Enforce both entry-count and byte budgets after every insertion. The loop
  // may evict multiple oldest keys, so the short-string signature cache cannot
  // remain above its configured budget after returning.
  while (
    compactTextSignatureCache.size > COMPACT_TEXT_SIGNATURE_CACHE_LIMIT ||
    compactTextSignatureCacheBytes > COMPACT_TEXT_SIGNATURE_CACHE_MAX_BYTES
  ) {
    const oldestCachedValue = compactTextSignatureCache.keys().next().value;
    if (typeof oldestCachedValue !== "string") {
      compactTextSignatureCache.clear();
      compactTextSignatureCacheBytes = 0;
      break;
    }
    const oldestSignature = compactTextSignatureCache.get(oldestCachedValue);
    compactTextSignatureCache.delete(oldestCachedValue);
    compactTextSignatureCacheBytes = Math.max(
      0,
      compactTextSignatureCacheBytes -
        oldestCachedValue.length * 2 -
        (oldestSignature?.length ?? 0) * 2,
    );
  }
  return signature;
}

function chatImageAttachmentsSignature(
  images: readonly RpcChatImageAttachment[] | undefined,
): string {
  return (images ?? [])
    .map(
      (image) =>
        `${image.type}:${image.mimeType}:${image.byteSize ?? estimateBase64ByteLength(image.data)}:${image.dataLoaded ?? !!image.data}`,
    )
    .join("|");
}

function computeThreadMessageVisibleSignature(
  message: RpcThreadMessage,
): string {
  switch (message.kind) {
    case "reasoning":
      return `reasoning:${message.state}:${compactTextSignature(message.text)}`;
    case "command":
      return `command:${message.state}:${message.exitCode ?? "null"}:${message.outputLoaded ?? true}:${compactTextSignature(
        message.command,
      )}:${compactTextSignature(message.output)}`;
    case "file_change": {
      const diffLoaded =
        message.diffLoaded ?? message.diffText.trim().length > 0;
      return `file_change:${message.state}:${message.changeKind}:${message.path}:${diffLoaded}:${compactTextSignature(
        message.diffText,
      )}`;
    }
    case "tool_call":
      return `tool_call:${message.state}:${message.server}:${message.tool}:${message.outputLoaded ?? true}:${compactTextSignature(
        message.argumentsText,
      )}:${compactTextSignature(message.output)}:${chatImageAttachmentsSignature(message.outputImages)}`;
    case "web_search":
      return `web_search:${message.state}:${compactTextSignature(message.query)}`;
    case "error":
      return `error:${message.state}:${compactTextSignature(message.text)}`;
    case "chat":
      return `chat:${message.state}:${message.role}:${compactTextSignature(
        message.text,
      )}:${chatImageAttachmentsSignature(message.images)}`;
  }
}

export function threadMessageVisibleSignature(
  message: RpcThreadMessage,
): string {
  const cachedSignature = threadMessageSignatureCache.get(message);
  if (cachedSignature) {
    return cachedSignature;
  }

  const signature = computeThreadMessageVisibleSignature(message);
  threadMessageSignatureCache.set(message, signature);
  return signature;
}

function threadMessageKeepsTranscriptBusy(message: RpcThreadMessage): boolean {
  if (message.kind === "chat") {
    return message.role === "assistant" && message.state === "in_progress";
  }
  return "state" in message && message.state === "in_progress";
}

export function shouldRenderThreadMessageControl(
  message: RpcThreadMessage,
): boolean {
  return (
    message.kind !== "tool_call" ||
    (message.tool !== "edit" && message.tool !== "write")
  );
}

function buildThreadVisibleMessage(message: RpcThreadMessage): VisibleMessage {
  const key = `thread-message:${message.id}`;
  switch (message.kind) {
    case "reasoning":
      return {
        key,
        kind: "reasoning",
        text: message.text,
        state: message.state,
      };
    case "command":
      return {
        key,
        kind: "command",
        messageId: message.id,
        command: message.command,
        output: message.output,
        outputLoaded: message.outputLoaded ?? true,
        state: message.state,
        exitCode: message.exitCode,
      };
    case "file_change":
      return {
        key,
        kind: "file_change",
        messageId: message.id,
        path: message.path,
        diffText: message.diffText,
        diffLoaded: message.diffLoaded ?? message.diffText.trim().length > 0,
        changeKind: message.changeKind,
        state: message.state,
      };
    case "tool_call":
      return {
        key,
        kind: "tool_call",
        messageId: message.id,
        server: message.server,
        tool: message.tool,
        argumentsText: message.argumentsText,
        output: message.output,
        outputLoaded: message.outputLoaded ?? true,
        ...(message.outputImages && message.outputImages.length > 0
          ? {
              outputImages: message.outputImages.map((image, index) => ({
                type: image.type,
                payloadKey: `${key}:output-image:${index}`,
                mimeType: image.mimeType,
                byteSize:
                  image.byteSize ?? estimateBase64ByteLength(image.data),
                dataLoaded: image.dataLoaded,
                previewByteSize: image.previewByteSize,
                previewMimeType: image.previewMimeType,
              })),
            }
          : {}),
        state: message.state,
      };
    case "web_search":
      return {
        key,
        kind: "web_search",
        query: message.query,
        state: message.state,
      };
    case "error":
      return {
        key,
        kind: "error",
        text: message.text,
        state: message.state,
      };
    case "chat":
      return {
        key,
        kind: "chat",
        messageId: message.id,
        speaker: message.role,
        state:
          message.state === "in_progress" || message.state === "stopped"
            ? message.state
            : "completed",
        tone: "normal",
        text: message.text,
        ...(message.images && message.images.length > 0
          ? {
              images: message.images.map((image, index) => ({
                type: image.type,
                payloadKey: `${key}:image:${index}`,
                mimeType: image.mimeType,
                byteSize:
                  image.byteSize ?? estimateBase64ByteLength(image.data),
                dataLoaded: image.dataLoaded,
                previewByteSize: image.previewByteSize,
                previewMimeType: image.previewMimeType,
              })),
            }
          : {}),
      };
  }
}

export type VisibleTranscriptStateCache = Map<string, VisibleMessageCacheEntry>;

export function createVisibleTranscriptStateCache(): VisibleTranscriptStateCache {
  return new Map<string, VisibleMessageCacheEntry>();
}

export type BuildVisibleTranscriptStateParams = {
  activeChatError: string;
  activeChatNotice: string;
  activeSelectedWorktreeFolder: string;
  activeSelectedWorktreePath: string | null;
  activeThreadWorkingMessage: string | null | undefined;
  activeThreadWorkingVisible: boolean | undefined;
  cache: VisibleTranscriptStateCache;
  initialTranscriptIsBusy: boolean;
  isCreatingThread: boolean;
  isThreadLoading: boolean;
  selectedProject: RpcProject | null;
  selectedThread: RpcThread | null;
  selectedThreadId: number | null;
  threadMessages: RpcThreadMessage[];
  mediaPayloadsCache?: VisibleMediaPayloads | null;
};

export type VisibleTranscriptState = {
  mediaPayloads: VisibleMediaPayloads;
  messages: VisibleMessage[];
  transcriptIsBusy: boolean;
};

export function threadMessagesKeepTranscriptBusy(
  messages: RpcThreadMessage[],
): boolean {
  return messages.some(threadMessageKeepsTranscriptBusy);
}

export function stripThreadMessageMediaPayloadData(
  message: RpcThreadMessage,
): RpcThreadMessage {
  if (message.kind === "chat" && message.images?.length) {
    return {
      ...message,
      images: message.images.map((image) => ({
        ...image,
        data: "",
        ...(image.data || image.dataLoaded !== undefined
          ? { dataLoaded: image.data ? true : image.dataLoaded }
          : {}),
      })),
    };
  }
  if (message.kind === "tool_call" && message.outputImages?.length) {
    return {
      ...message,
      outputImages: message.outputImages.map((image) => ({
        ...image,
        data: "",
        ...(image.data || image.dataLoaded !== undefined
          ? { dataLoaded: image.data ? true : image.dataLoaded }
          : {}),
      })),
    };
  }
  return message;
}

function visibleMediaPayloadsEqual(
  left: VisibleMediaPayloads,
  right: VisibleMediaPayloads,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [key, value] of left) {
    if (right.get(key) !== value) {
      return false;
    }
  }
  return true;
}

export function deriveVisibleTranscriptMediaPayloads(
  threadMessages: RpcThreadMessage[],
  previous?: VisibleMediaPayloads | null,
): VisibleMediaPayloads {
  const mediaPayloads = new Map<string, string>();
  for (const message of threadMessages) {
    const key = `thread-message:${message.id}`;
    if (message.kind === "chat" && message.images) {
      message.images.forEach((image, index) => {
        if (image.data) {
          mediaPayloads.set(`${key}:image:${index}`, image.data);
        }
      });
    } else if (message.kind === "tool_call" && message.outputImages) {
      message.outputImages.forEach((image, index) => {
        if (image.data) {
          mediaPayloads.set(`${key}:output-image:${index}`, image.data);
        }
      });
    }
  }
  return previous && visibleMediaPayloadsEqual(mediaPayloads, previous)
    ? previous
    : mediaPayloads;
}

export function buildVisibleTranscriptState({
  activeChatError,
  activeChatNotice,
  activeSelectedWorktreeFolder,
  activeSelectedWorktreePath,
  activeThreadWorkingMessage,
  activeThreadWorkingVisible,
  cache,
  initialTranscriptIsBusy,
  isCreatingThread,
  isThreadLoading,
  mediaPayloadsCache,
  selectedProject,
  selectedThread,
  selectedThreadId,
  threadMessages,
}: BuildVisibleTranscriptStateParams): VisibleTranscriptState {
  const visibleMessageCache = cache;
  let messages: VisibleMessage[];
  let hasInProgressAssistantChat = false;
  let transcriptIsBusy = initialTranscriptIsBusy;
  if (isThreadLoading) {
    messages = [
      readCachedVisibleMessage(
        visibleMessageCache,
        `thread-loading:${selectedThreadId ?? "none"}`,
        "chat:normal:assistant:Loading thread history...",
        () => ({
          key: `thread-loading:${selectedThreadId ?? "none"}`,
          kind: "chat",
          speaker: "assistant",
          state: "completed",
          tone: "normal",
          text: "Loading thread history...",
        }),
      ),
    ];
  } else if (!selectedThread) {
    const creatingThread = isCreatingThread && !!activeSelectedWorktreePath;
    const emptyThreadMessageText = creatingThread
      ? `Creating a new ${APP_TITLE} thread for ${activeSelectedWorktreeFolder}...`
      : selectedProject
        ? `Use the Threads panel or the selected worktree popover in the sidebar to create or open a ${APP_TITLE} thread.`
        : "Add a project, choose a worktree, and create a thread to begin.";
    messages = [
      readCachedVisibleMessage(
        visibleMessageCache,
        creatingThread
          ? `thread-creating:${selectedProject?.id ?? "none"}:${activeSelectedWorktreePath ?? "none"}`
          : `thread-empty:${selectedProject?.id ?? "none"}:${activeSelectedWorktreePath ?? "none"}`,
        `chat:${creatingThread ? "working" : "normal"}:assistant:${emptyThreadMessageText}`,
        () => ({
          key: creatingThread
            ? `thread-creating:${selectedProject?.id ?? "none"}:${activeSelectedWorktreePath ?? "none"}`
            : `thread-empty:${selectedProject?.id ?? "none"}:${activeSelectedWorktreePath ?? "none"}`,
          kind: "chat",
          speaker: "assistant",
          state: creatingThread ? "in_progress" : "completed",
          tone: creatingThread ? "working" : "normal",
          text: emptyThreadMessageText,
        }),
      ),
    ];
  } else if (threadMessages.length === 0) {
    const threadReadyMessageText = `Thread ready in ${activeSelectedWorktreeFolder}. Ask ${APP_TITLE} to inspect, refactor, or debug this worktree.`;
    messages = [
      readCachedVisibleMessage(
        visibleMessageCache,
        `thread-ready:${selectedThread.id}`,
        `chat:normal:assistant:${threadReadyMessageText}`,
        () => ({
          key: `thread-ready:${selectedThread.id}`,
          kind: "chat",
          speaker: "assistant",
          state: "completed",
          tone: "normal",
          text: threadReadyMessageText,
        }),
      ),
    ];
  } else {
    messages = [];
    for (const message of threadMessages) {
      if (
        message.kind === "chat" &&
        message.role === "assistant" &&
        message.state === "in_progress"
      ) {
        hasInProgressAssistantChat = true;
      }
      if (shouldRenderThreadMessageControl(message)) {
        messages.push(
          readCachedVisibleMessage(
            visibleMessageCache,
            `thread-message:${message.id}`,
            threadMessageVisibleSignature(message),
            () => buildThreadVisibleMessage(message),
          ),
        );
      }
    }
  }
  if (
    selectedThread?.runStatus.state === "working" &&
    !hasInProgressAssistantChat &&
    activeThreadWorkingVisible !== false
  ) {
    const workingMessageText =
      activeThreadWorkingMessage?.trim() || "Processing";
    transcriptIsBusy = true;
    messages.push(
      readCachedVisibleMessage(
        visibleMessageCache,
        `thread-working:${selectedThread.id}`,
        `chat:working:assistant:${workingMessageText}`,
        () => ({
          key: `thread-working:${selectedThread.id}`,
          kind: "chat",
          speaker: "assistant",
          state: "in_progress",
          tone: "working",
          text: workingMessageText,
        }),
      ),
    );
  }
  if (activeChatError) {
    messages.push(
      readCachedVisibleMessage(
        visibleMessageCache,
        `thread-chat-error:${selectedThread?.id ?? "none"}:${activeChatError}`,
        `chat:error:assistant:${activeChatError}`,
        () => ({
          key: `thread-chat-error:${selectedThread?.id ?? "none"}:${activeChatError}`,
          kind: "chat",
          speaker: "assistant",
          state: "completed",
          tone: "error",
          text: activeChatError,
        }),
      ),
    );
  }
  if (activeChatNotice) {
    messages.push(
      readCachedVisibleMessage(
        visibleMessageCache,
        `thread-chat-notice:${selectedThread?.id ?? "none"}:${activeChatNotice}`,
        `chat:notice:assistant:${activeChatNotice}`,
        () => ({
          key: `thread-chat-notice:${selectedThread?.id ?? "none"}:${activeChatNotice}`,
          kind: "chat",
          speaker: "assistant",
          state: "completed",
          tone: "notice",
          text: activeChatNotice,
        }),
      ),
    );
  }
  pruneVisibleMessageCache(
    visibleMessageCache,
    messages.map((message) => message.key),
  );

  const mediaPayloads = deriveVisibleTranscriptMediaPayloads(
    threadMessages,
    mediaPayloadsCache,
  );

  return { mediaPayloads, messages, transcriptIsBusy };
}
