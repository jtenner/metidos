/**
 * @file src/mainview/controls/chat-composer-image-attachments.ts
 * @description Shared image attachment store for chat composer instances.
 */

import { useSyncExternalStore } from "react";
import {
  MAX_CHAT_IMAGE_ATTACHMENTS,
  MAX_CHAT_IMAGE_BYTES,
  type ChatImageDraftAttachment,
} from "../../shared/chat-images";

const DEFAULT_CHAT_COMPOSER_IMAGE_KEY = "__default__";
const EMPTY_CHAT_COMPOSER_IMAGE_ATTACHMENTS: ChatImageDraftAttachment[] = [];
export const CHAT_COMPOSER_IMAGE_ATTACHMENT_STORE_MAX_KEYS = 128;
export const CHAT_COMPOSER_IMAGE_ATTACHMENT_ALIAS_MAX_ENTRIES =
  CHAT_COMPOSER_IMAGE_ATTACHMENT_STORE_MAX_KEYS * 4;
export const CHAT_COMPOSER_IMAGE_ATTACHMENT_STORE_MAX_BYTES =
  MAX_CHAT_IMAGE_ATTACHMENTS * MAX_CHAT_IMAGE_BYTES;
export const CHAT_COMPOSER_IMAGE_ATTACHMENT_READ_TIMEOUT_MS = 60_000;
const imageAttachmentListeners = new Set<() => void>();
let chatComposerImageAttachmentsByKey = new Map<
  string,
  ChatImageDraftAttachment[]
>();
let chatComposerImageAttachmentKeyAliases = new Map<string, string>();
let pendingImageAttachmentReadsByKey = new Map<string, number>();
let pendingImageAttachmentReadTimeoutsByKey = new Map<
  string,
  ReturnType<typeof setTimeout>[]
>();
let imageAttachmentSettledResolversByKey = new Map<string, Array<() => void>>();

function resolveImageAttachmentKeyAlias(normalizedKey: string): string {
  let currentKey = normalizedKey;
  for (let depth = 0; depth < 16; depth += 1) {
    const nextKey = chatComposerImageAttachmentKeyAliases.get(currentKey);
    if (!nextKey || nextKey === currentKey) {
      return currentKey;
    }
    currentKey = nextKey;
  }
  return currentKey;
}

function normalizeImageAttachmentKey(draftKey?: string | null): string {
  return resolveImageAttachmentKeyAlias(
    draftKey ?? DEFAULT_CHAT_COMPOSER_IMAGE_KEY,
  );
}

function emitImageAttachmentChange(): void {
  for (const listener of imageAttachmentListeners) {
    listener();
  }
}

function subscribeToChatComposerImageAttachments(
  listener: () => void,
): () => void {
  imageAttachmentListeners.add(listener);
  return () => {
    imageAttachmentListeners.delete(listener);
  };
}

function getChatComposerImageAttachmentsSnapshot(
  draftKey?: string | null,
): ChatImageDraftAttachment[] {
  return (
    chatComposerImageAttachmentsByKey.get(
      normalizeImageAttachmentKey(draftKey),
    ) ?? EMPTY_CHAT_COMPOSER_IMAGE_ATTACHMENTS
  );
}

function chatComposerImageAttachmentBytes(
  attachments: readonly ChatImageDraftAttachment[],
): number {
  return attachments.reduce(
    (totalBytes, attachment) => totalBytes + attachment.byteSize,
    0,
  );
}

function totalChatComposerImageAttachmentBytes(): number {
  let totalBytes = 0;
  for (const attachments of chatComposerImageAttachmentsByKey.values()) {
    totalBytes += chatComposerImageAttachmentBytes(attachments);
  }
  return totalBytes;
}

function clearPendingImageAttachmentReadTimeouts(normalizedKey: string): void {
  const timeoutHandles =
    pendingImageAttachmentReadTimeoutsByKey.get(normalizedKey);
  if (!timeoutHandles) {
    return;
  }
  for (const timeoutHandle of timeoutHandles) {
    clearTimeout(timeoutHandle);
  }
  pendingImageAttachmentReadTimeoutsByKey.delete(normalizedKey);
}

function deleteChatComposerImageAttachmentKey(normalizedKey: string): void {
  chatComposerImageAttachmentsByKey.delete(normalizedKey);
  if (getPendingImageAttachmentReadsSnapshot(normalizedKey) === 0) {
    pendingImageAttachmentReadsByKey.delete(normalizedKey);
    clearPendingImageAttachmentReadTimeouts(normalizedKey);
    imageAttachmentSettledResolversByKey.delete(normalizedKey);
  }
}

function pruneChatComposerImageAttachmentAliases(
  protectedKeys: ReadonlySet<string>,
): void {
  if (
    chatComposerImageAttachmentKeyAliases.size <=
    CHAT_COMPOSER_IMAGE_ATTACHMENT_ALIAS_MAX_ENTRIES
  ) {
    return;
  }

  const activeTargets = new Set<string>([
    ...chatComposerImageAttachmentsByKey.keys(),
    ...pendingImageAttachmentReadsByKey.keys(),
    ...pendingImageAttachmentReadTimeoutsByKey.keys(),
    ...imageAttachmentSettledResolversByKey.keys(),
  ]);

  for (const [aliasKey, aliasTarget] of chatComposerImageAttachmentKeyAliases) {
    if (
      chatComposerImageAttachmentKeyAliases.size <=
      CHAT_COMPOSER_IMAGE_ATTACHMENT_ALIAS_MAX_ENTRIES
    ) {
      return;
    }
    if (protectedKeys.has(aliasKey) || protectedKeys.has(aliasTarget)) {
      continue;
    }
    if (!activeTargets.has(aliasTarget)) {
      chatComposerImageAttachmentKeyAliases.delete(aliasKey);
    }
  }

  for (const [aliasKey, aliasTarget] of chatComposerImageAttachmentKeyAliases) {
    if (
      chatComposerImageAttachmentKeyAliases.size <=
      CHAT_COMPOSER_IMAGE_ATTACHMENT_ALIAS_MAX_ENTRIES
    ) {
      return;
    }
    if (protectedKeys.has(aliasKey) || protectedKeys.has(aliasTarget)) {
      continue;
    }
    chatComposerImageAttachmentKeyAliases.delete(aliasKey);
  }
}

function pruneChatComposerImageAttachmentStore(protectedKey: string): void {
  let totalBytes = totalChatComposerImageAttachmentBytes();
  while (
    chatComposerImageAttachmentsByKey.size >
      CHAT_COMPOSER_IMAGE_ATTACHMENT_STORE_MAX_KEYS ||
    totalBytes > CHAT_COMPOSER_IMAGE_ATTACHMENT_STORE_MAX_BYTES
  ) {
    let evicted = false;
    for (const [key, attachments] of chatComposerImageAttachmentsByKey) {
      if (
        key === protectedKey &&
        chatComposerImageAttachmentsByKey.size === 1
      ) {
        continue;
      }
      if (getPendingImageAttachmentReadsSnapshot(key) > 0) {
        continue;
      }
      chatComposerImageAttachmentsByKey.delete(key);
      pendingImageAttachmentReadsByKey.delete(key);
      clearPendingImageAttachmentReadTimeouts(key);
      imageAttachmentSettledResolversByKey.delete(key);
      totalBytes -= chatComposerImageAttachmentBytes(attachments);
      evicted = true;
      break;
    }
    if (!evicted) {
      break;
    }
  }
}

export function useChatComposerImageAttachments(
  draftKey?: string | null,
): ChatImageDraftAttachment[] {
  return useSyncExternalStore(
    subscribeToChatComposerImageAttachments,
    () => getChatComposerImageAttachmentsSnapshot(draftKey),
    () => getChatComposerImageAttachmentsSnapshot(draftKey),
  );
}

function getPendingImageAttachmentReadsSnapshot(
  draftKey?: string | null,
): number {
  return (
    pendingImageAttachmentReadsByKey.get(
      normalizeImageAttachmentKey(draftKey),
    ) ?? 0
  );
}

export function useChatComposerPendingImageAttachmentReads(
  draftKey?: string | null,
): number {
  return useSyncExternalStore(
    subscribeToChatComposerImageAttachments,
    () => getPendingImageAttachmentReadsSnapshot(draftKey),
    () => getPendingImageAttachmentReadsSnapshot(draftKey),
  );
}

export function readChatComposerImageAttachments(
  draftKey?: string | null,
): ChatImageDraftAttachment[] {
  return getChatComposerImageAttachmentsSnapshot(draftKey);
}

export function readChatComposerPendingImageAttachmentReads(
  draftKey?: string | null,
): number {
  return getPendingImageAttachmentReadsSnapshot(draftKey);
}

export function migrateChatComposerImageAttachmentKey(
  fromDraftKey: string | null | undefined,
  toDraftKey: string | null | undefined,
): void {
  const rawFromKey = fromDraftKey ?? DEFAULT_CHAT_COMPOSER_IMAGE_KEY;
  const rawToKey = toDraftKey ?? DEFAULT_CHAT_COMPOSER_IMAGE_KEY;
  const normalizedFromKey = resolveImageAttachmentKeyAlias(rawFromKey);
  const normalizedToKey = resolveImageAttachmentKeyAlias(rawToKey);
  if (normalizedFromKey === normalizedToKey) {
    return;
  }

  for (const [aliasKey, aliasTarget] of chatComposerImageAttachmentKeyAliases) {
    if (aliasTarget === normalizedFromKey) {
      chatComposerImageAttachmentKeyAliases.set(aliasKey, normalizedToKey);
    }
  }
  chatComposerImageAttachmentKeyAliases.set(rawFromKey, normalizedToKey);
  chatComposerImageAttachmentKeyAliases.set(normalizedFromKey, normalizedToKey);

  const fromAttachments =
    chatComposerImageAttachmentsByKey.get(normalizedFromKey) ?? [];
  const toAttachments =
    chatComposerImageAttachmentsByKey.get(normalizedToKey) ?? [];
  if (fromAttachments.length > 0) {
    chatComposerImageAttachmentsByKey.set(
      normalizedToKey,
      [...toAttachments, ...fromAttachments].slice(
        0,
        MAX_CHAT_IMAGE_ATTACHMENTS,
      ),
    );
  }
  chatComposerImageAttachmentsByKey.delete(normalizedFromKey);

  const fromPendingReads =
    pendingImageAttachmentReadsByKey.get(normalizedFromKey) ?? 0;
  if (fromPendingReads > 0) {
    pendingImageAttachmentReadsByKey.set(
      normalizedToKey,
      (pendingImageAttachmentReadsByKey.get(normalizedToKey) ?? 0) +
        fromPendingReads,
    );
    pendingImageAttachmentReadsByKey.delete(normalizedFromKey);
  }

  const fromTimeouts =
    pendingImageAttachmentReadTimeoutsByKey.get(normalizedFromKey) ?? [];
  if (fromTimeouts.length > 0) {
    pendingImageAttachmentReadTimeoutsByKey.set(normalizedToKey, [
      ...(pendingImageAttachmentReadTimeoutsByKey.get(normalizedToKey) ?? []),
      ...fromTimeouts,
    ]);
    pendingImageAttachmentReadTimeoutsByKey.delete(normalizedFromKey);
  }

  const fromResolvers =
    imageAttachmentSettledResolversByKey.get(normalizedFromKey) ?? [];
  if (fromResolvers.length > 0) {
    imageAttachmentSettledResolversByKey.set(normalizedToKey, [
      ...(imageAttachmentSettledResolversByKey.get(normalizedToKey) ?? []),
      ...fromResolvers,
    ]);
    imageAttachmentSettledResolversByKey.delete(normalizedFromKey);
  }

  pruneChatComposerImageAttachmentAliases(
    new Set([rawFromKey, rawToKey, normalizedFromKey, normalizedToKey]),
  );
  pruneChatComposerImageAttachmentStore(normalizedToKey);
  emitImageAttachmentChange();
}

export function setChatComposerImageAttachments(
  nextAttachments: ChatImageDraftAttachment[],
  draftKey?: string | null,
): void {
  const normalizedKey = normalizeImageAttachmentKey(draftKey);
  if (nextAttachments.length === 0) {
    deleteChatComposerImageAttachmentKey(normalizedKey);
    emitImageAttachmentChange();
    return;
  }

  if (chatComposerImageAttachmentsByKey.has(normalizedKey)) {
    chatComposerImageAttachmentsByKey.delete(normalizedKey);
  }
  chatComposerImageAttachmentsByKey.set(normalizedKey, nextAttachments);
  pruneChatComposerImageAttachmentStore(normalizedKey);
  emitImageAttachmentChange();
}

export function startChatComposerImageAttachmentRead(
  draftKey?: string | null,
  options?: { timeoutMs?: number },
): void {
  const normalizedKey = normalizeImageAttachmentKey(draftKey);
  pendingImageAttachmentReadsByKey.set(
    normalizedKey,
    getPendingImageAttachmentReadsSnapshot(normalizedKey) + 1,
  );
  const timeoutMs = Math.max(
    1,
    Math.floor(
      options?.timeoutMs ?? CHAT_COMPOSER_IMAGE_ATTACHMENT_READ_TIMEOUT_MS,
    ),
  );
  const timeoutHandle = setTimeout(() => {
    finishChatComposerImageAttachmentRead(normalizedKey);
  }, timeoutMs);
  // Browser timers are numeric, while Bun/Node timers can expose unref(). Keep
  // the cleanup timeout from pinning non-browser test or tooling processes.
  (timeoutHandle as { unref?: () => void }).unref?.();
  pendingImageAttachmentReadTimeoutsByKey.set(normalizedKey, [
    ...(pendingImageAttachmentReadTimeoutsByKey.get(normalizedKey) ?? []),
    timeoutHandle,
  ]);
  emitImageAttachmentChange();
}

export function finishChatComposerImageAttachmentRead(
  draftKey?: string | null,
): void {
  const normalizedKey = normalizeImageAttachmentKey(draftKey);
  const pendingImageAttachmentReads =
    getPendingImageAttachmentReadsSnapshot(normalizedKey);
  if (pendingImageAttachmentReads === 0) {
    return;
  }
  const nextPendingReads = pendingImageAttachmentReads - 1;
  const timeoutHandles =
    pendingImageAttachmentReadTimeoutsByKey.get(normalizedKey);
  const timeoutHandle = timeoutHandles?.shift();
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }
  if (timeoutHandles && timeoutHandles.length === 0) {
    pendingImageAttachmentReadTimeoutsByKey.delete(normalizedKey);
  }
  if (nextPendingReads === 0) {
    pendingImageAttachmentReadsByKey.delete(normalizedKey);
  } else {
    pendingImageAttachmentReadsByKey.set(normalizedKey, nextPendingReads);
  }
  emitImageAttachmentChange();
  if (nextPendingReads > 0) {
    return;
  }
  const resolvers =
    imageAttachmentSettledResolversByKey.get(normalizedKey) ?? [];
  imageAttachmentSettledResolversByKey.delete(normalizedKey);
  for (const resolve of resolvers) {
    resolve();
  }
}

export function waitForChatComposerImageAttachments(
  draftKey?: string | null,
): Promise<void> {
  const normalizedKey = normalizeImageAttachmentKey(draftKey);
  if (getPendingImageAttachmentReadsSnapshot(normalizedKey) === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    imageAttachmentSettledResolversByKey.set(normalizedKey, [
      ...(imageAttachmentSettledResolversByKey.get(normalizedKey) ?? []),
      resolve,
    ]);
  });
}

export function clearChatComposerImageAttachments(
  draftKey?: string | null,
): void {
  setChatComposerImageAttachments([], draftKey);
}

export function readChatComposerImageAttachmentStoreTelemetry(): {
  aliasKeys: number;
  attachmentKeys: number;
  pendingReadKeys: number;
  pendingReadTimeoutKeys: number;
  settledResolverKeys: number;
} {
  return {
    aliasKeys: chatComposerImageAttachmentKeyAliases.size,
    attachmentKeys: chatComposerImageAttachmentsByKey.size,
    pendingReadKeys: pendingImageAttachmentReadsByKey.size,
    pendingReadTimeoutKeys: pendingImageAttachmentReadTimeoutsByKey.size,
    settledResolverKeys: imageAttachmentSettledResolversByKey.size,
  };
}

export function resetChatComposerImageAttachmentStoreForTest(): void {
  chatComposerImageAttachmentsByKey = new Map<
    string,
    ChatImageDraftAttachment[]
  >();
  chatComposerImageAttachmentKeyAliases = new Map<string, string>();
  for (const key of pendingImageAttachmentReadTimeoutsByKey.keys()) {
    clearPendingImageAttachmentReadTimeouts(key);
  }
  pendingImageAttachmentReadsByKey = new Map<string, number>();
  pendingImageAttachmentReadTimeoutsByKey = new Map<
    string,
    ReturnType<typeof setTimeout>[]
  >();
  imageAttachmentSettledResolversByKey = new Map<string, Array<() => void>>();
  emitImageAttachmentChange();
}
