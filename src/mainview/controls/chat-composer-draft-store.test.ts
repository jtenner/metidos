/**
 * @file src/mainview/controls/chat-composer-draft-store.test.ts
 * @description Tests for keyed chat composer drafts.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  CHAT_COMPOSER_DRAFT_STORE_MAX_KEYS,
  chatComposerDraftKey,
  initializeChatComposerDraft,
  migrateChatComposerDraftKey,
  pruneChatComposerDraftsForActiveThreads,
  readChatComposerDraft,
  resetChatComposerDraftStoreForTest,
  setChatComposerDraft,
} from "./chat-composer-draft-store";

describe("chat composer draft store", () => {
  beforeEach(() => {
    resetChatComposerDraftStoreForTest();
  });

  it("keeps drafts isolated by selected thread key", () => {
    const firstThreadKey = chatComposerDraftKey(1);
    const secondThreadKey = chatComposerDraftKey(2);

    initializeChatComposerDraft("first persisted", firstThreadKey);
    initializeChatComposerDraft("second persisted", secondThreadKey);
    setChatComposerDraft("first edited", firstThreadKey);

    expect(readChatComposerDraft("", firstThreadKey)).toBe("first edited");
    expect(readChatComposerDraft("", secondThreadKey)).toBe("second persisted");
  });

  it("initializes each key once so local edits are not replaced by later props", () => {
    const draftKey = chatComposerDraftKey(7);

    initializeChatComposerDraft("persisted", draftKey);
    setChatComposerDraft("local edit", draftKey);
    initializeChatComposerDraft("stale persisted", draftKey);

    expect(readChatComposerDraft("", draftKey)).toBe("local edit");
  });

  it("migrates drafts from optimistic to persisted thread keys", () => {
    setChatComposerDraft("describe this", "thread:-1");

    migrateChatComposerDraftKey("thread:-1", "thread:31");

    expect(readChatComposerDraft("", "thread:-1")).toBe("describe this");
    expect(readChatComposerDraft("", "thread:31")).toBe("describe this");
  });

  it("prunes drafts for threads that are no longer active", () => {
    setChatComposerDraft("one", "thread:1");
    setChatComposerDraft("two", "thread:2");
    setChatComposerDraft("global", "global-draft");

    pruneChatComposerDraftsForActiveThreads(new Set([2]));

    expect(readChatComposerDraft("", "thread:1")).toBe("");
    expect(readChatComposerDraft("", "thread:2")).toBe("two");
    expect(readChatComposerDraft("", "global-draft")).toBe("global");
  });

  it("bounds retained draft keys", () => {
    for (
      let index = 0;
      index <= CHAT_COMPOSER_DRAFT_STORE_MAX_KEYS;
      index += 1
    ) {
      setChatComposerDraft(`draft ${index}`, chatComposerDraftKey(index));
    }

    expect(readChatComposerDraft("fallback", chatComposerDraftKey(0))).toBe(
      "fallback",
    );
    expect(
      readChatComposerDraft(
        "fallback",
        chatComposerDraftKey(CHAT_COMPOSER_DRAFT_STORE_MAX_KEYS),
      ),
    ).toBe(`draft ${CHAT_COMPOSER_DRAFT_STORE_MAX_KEYS}`);
  });

  it("keeps cleared drafts initialized without retaining draft text", () => {
    const draftKey = chatComposerDraftKey(99);

    initializeChatComposerDraft("persisted", draftKey);
    setChatComposerDraft("", draftKey);
    initializeChatComposerDraft("stale persisted", draftKey);

    expect(readChatComposerDraft("fallback", draftKey)).toBe("");
  });
});
