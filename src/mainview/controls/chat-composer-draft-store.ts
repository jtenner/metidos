/**
 * @file src/mainview/controls/chat-composer-draft-store.ts
 * @description Shared draft store for chat composer instances.
 */

import { useEffect, useSyncExternalStore } from "react";

const DEFAULT_CHAT_COMPOSER_DRAFT_KEY = "__default__";
export const CHAT_COMPOSER_DRAFT_STORE_MAX_KEYS = 128;
const draftListeners = new Set<() => void>();

let chatComposerDrafts = new Map<string, string>();
let initializedDraftKeys = new Set<string>();
let chatComposerDraftKeyAliases = new Map<string, string>();

export function chatComposerDraftKey(threadId: number | null): string {
  return threadId === null ? "thread:none" : `thread:${threadId}`;
}

function resolveDraftKeyAlias(normalizedDraftKey: string): string {
  let currentKey = normalizedDraftKey;
  for (let depth = 0; depth < 16; depth += 1) {
    const nextKey = chatComposerDraftKeyAliases.get(currentKey);
    if (!nextKey || nextKey === currentKey) {
      return currentKey;
    }
    currentKey = nextKey;
  }
  return currentKey;
}

function normalizeDraftKey(draftKey?: string | null): string {
  return resolveDraftKeyAlias(draftKey ?? DEFAULT_CHAT_COMPOSER_DRAFT_KEY);
}

function emitDraftChange(): void {
  for (const listener of draftListeners) {
    listener();
  }
}

function subscribeToChatComposerDraft(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

function getChatComposerDraftSnapshot(draftKey?: string | null): string {
  return chatComposerDrafts.get(normalizeDraftKey(draftKey)) ?? "";
}

function deleteChatComposerDraftKey(normalizedDraftKey: string): void {
  chatComposerDrafts.delete(normalizedDraftKey);
  initializedDraftKeys.delete(normalizedDraftKey);
}

function markChatComposerDraftKeyInitialized(normalizedDraftKey: string): void {
  if (initializedDraftKeys.has(normalizedDraftKey)) {
    initializedDraftKeys.delete(normalizedDraftKey);
  }
  initializedDraftKeys.add(normalizedDraftKey);
}

function pruneChatComposerDraftStore(): void {
  while (initializedDraftKeys.size > CHAT_COMPOSER_DRAFT_STORE_MAX_KEYS) {
    const oldestKey = initializedDraftKeys.values().next().value;
    if (oldestKey === undefined) {
      return;
    }
    deleteChatComposerDraftKey(oldestKey);
  }
}

function parseThreadDraftKey(normalizedDraftKey: string): number | null {
  const match = /^thread:(\d+)$/u.exec(normalizedDraftKey);
  if (!match) {
    return null;
  }
  const threadId = Number(match[1]);
  return Number.isSafeInteger(threadId) && threadId > 0 ? threadId : null;
}

export function migrateChatComposerDraftKey(
  fromDraftKey: string | null | undefined,
  toDraftKey: string | null | undefined,
): void {
  const rawFromKey = fromDraftKey ?? DEFAULT_CHAT_COMPOSER_DRAFT_KEY;
  const rawToKey = toDraftKey ?? DEFAULT_CHAT_COMPOSER_DRAFT_KEY;
  const normalizedFromKey = resolveDraftKeyAlias(rawFromKey);
  const normalizedToKey = resolveDraftKeyAlias(rawToKey);
  if (normalizedFromKey === normalizedToKey) {
    return;
  }

  for (const [aliasKey, aliasTarget] of chatComposerDraftKeyAliases) {
    if (aliasTarget === normalizedFromKey) {
      chatComposerDraftKeyAliases.set(aliasKey, normalizedToKey);
    }
  }
  chatComposerDraftKeyAliases.set(rawFromKey, normalizedToKey);
  chatComposerDraftKeyAliases.set(normalizedFromKey, normalizedToKey);

  const fromInitialized = initializedDraftKeys.has(normalizedFromKey);
  const fromDraft = chatComposerDrafts.get(normalizedFromKey);
  let changed = false;
  if (fromDraft !== undefined && !chatComposerDrafts.has(normalizedToKey)) {
    chatComposerDrafts.set(normalizedToKey, fromDraft);
    changed = true;
  }
  if (fromInitialized && !initializedDraftKeys.has(normalizedToKey)) {
    markChatComposerDraftKeyInitialized(normalizedToKey);
    changed = true;
  }
  if (chatComposerDrafts.has(normalizedFromKey) || fromInitialized) {
    deleteChatComposerDraftKey(normalizedFromKey);
    changed = true;
  }
  pruneChatComposerDraftStore();
  if (changed) {
    emitDraftChange();
  }
}

export function pruneChatComposerDraftsForActiveThreads(
  activeThreadIds: ReadonlySet<number>,
): void {
  let changed = false;
  for (const normalizedDraftKey of initializedDraftKeys) {
    const threadId = parseThreadDraftKey(normalizedDraftKey);
    if (threadId === null || activeThreadIds.has(threadId)) {
      continue;
    }
    deleteChatComposerDraftKey(normalizedDraftKey);
    changed = true;
  }
  if (changed) {
    emitDraftChange();
  }
}

/**
 * Read the shared draft via `useSyncExternalStore`, initializing each draft key from its initial value.
 */
export function useChatComposerDraft(
  initialValue: string,
  draftKey?: string | null,
): string {
  const normalizedDraftKey = normalizeDraftKey(draftKey);
  const draft = useSyncExternalStore(
    subscribeToChatComposerDraft,
    () => getChatComposerDraftSnapshot(normalizedDraftKey),
    () => getChatComposerDraftSnapshot(normalizedDraftKey),
  );

  useEffect(() => {
    initializeChatComposerDraft(initialValue, normalizedDraftKey);
  }, [initialValue, normalizedDraftKey]);

  return initializedDraftKeys.has(normalizedDraftKey) ? draft : initialValue;
}

/**
 * Initialize the draft value exactly once for a draft key from bootstrap/persisted state.
 */
export function initializeChatComposerDraft(
  initialValue: string,
  draftKey?: string | null,
): void {
  const normalizedDraftKey = normalizeDraftKey(draftKey);
  if (initializedDraftKeys.has(normalizedDraftKey)) {
    return;
  }

  if (initialValue) {
    chatComposerDrafts.set(normalizedDraftKey, initialValue);
  }
  markChatComposerDraftKeyInitialized(normalizedDraftKey);
  pruneChatComposerDraftStore();
  emitDraftChange();
}

/**
 * Read the draft, with a fallback for callers before initialization.
 */
export function readChatComposerDraft(
  fallback = "",
  draftKey?: string | null,
): string {
  const normalizedDraftKey = normalizeDraftKey(draftKey);
  return initializedDraftKeys.has(normalizedDraftKey)
    ? (chatComposerDrafts.get(normalizedDraftKey) ?? "")
    : fallback;
}

/**
 * Update the draft value in the shared in-memory store only.
 */
export function setChatComposerDraft(
  nextValue: string,
  draftKey?: string | null,
): void {
  const normalizedDraftKey = normalizeDraftKey(draftKey);
  if (
    initializedDraftKeys.has(normalizedDraftKey) &&
    chatComposerDrafts.get(normalizedDraftKey) === nextValue
  ) {
    return;
  }

  if (!nextValue) {
    chatComposerDrafts.delete(normalizedDraftKey);
    markChatComposerDraftKeyInitialized(normalizedDraftKey);
    pruneChatComposerDraftStore();
    emitDraftChange();
    return;
  }

  if (chatComposerDrafts.has(normalizedDraftKey)) {
    chatComposerDrafts.delete(normalizedDraftKey);
  }
  chatComposerDrafts.set(normalizedDraftKey, nextValue);
  markChatComposerDraftKeyInitialized(normalizedDraftKey);
  pruneChatComposerDraftStore();
  emitDraftChange();
}

export function resetChatComposerDraftStoreForTest(): void {
  chatComposerDrafts = new Map<string, string>();
  initializedDraftKeys = new Set<string>();
  chatComposerDraftKeyAliases = new Map<string, string>();
  emitDraftChange();
}
