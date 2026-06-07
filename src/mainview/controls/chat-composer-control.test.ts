/**
 * @file src/mainview/controls/chat-composer-control.test.ts
 * @description Focused tests for chat composer accessibility helpers.
 */

import { beforeEach, describe, expect, it } from "bun:test";

import { APP_TITLE } from "../app/mainview-ui-state";
import {
  chatComposerTextareaLabel,
  createImageAttachmentId,
  fileLooksLikeChatImage,
} from "./chat-composer-control";
import {
  CHAT_COMPOSER_IMAGE_ATTACHMENT_ALIAS_MAX_ENTRIES,
  CHAT_COMPOSER_IMAGE_ATTACHMENT_STORE_MAX_KEYS,
  clearChatComposerImageAttachments,
  finishChatComposerImageAttachmentRead,
  migrateChatComposerImageAttachmentKey,
  readChatComposerImageAttachments,
  readChatComposerImageAttachmentStoreTelemetry,
  readChatComposerPendingImageAttachmentReads,
  resetChatComposerImageAttachmentStoreForTest,
  waitForChatComposerImageAttachments,
  setChatComposerImageAttachments,
  startChatComposerImageAttachmentRead,
} from "./chat-composer-image-attachments";
import {
  filterChatComposerSkills,
  matchChatComposerSkillsTrigger,
} from "./chat-composer-skills";

describe("chatComposerTextareaLabel", () => {
  it("labels the composer as a message field when a thread is selected", () => {
    expect(chatComposerTextareaLabel(true)).toBe(`Message ${APP_TITLE}`);
  });

  it("explains that a thread is required before sending when no thread is selected", () => {
    expect(chatComposerTextareaLabel(false)).toBe(
      `Draft message for ${APP_TITLE} (create a thread to send)`,
    );
  });
});

describe("chat composer image attachment store", () => {
  beforeEach(() => {
    resetChatComposerImageAttachmentStoreForTest();
  });

  it("stores and clears pasted image attachments", () => {
    setChatComposerImageAttachments([
      {
        byteSize: 12,
        data: "aGVsbG8=",
        id: "image-1",
        mimeType: "image/png",
        type: "image",
      },
    ]);

    expect(readChatComposerImageAttachments()).toHaveLength(1);
    clearChatComposerImageAttachments();
    expect(readChatComposerImageAttachments()).toEqual([]);
  });

  it("keeps image attachments isolated by draft key", () => {
    setChatComposerImageAttachments(
      [
        {
          byteSize: 12,
          data: "aGVsbG8=",
          id: "image-1",
          mimeType: "image/png",
          type: "image",
        },
      ],
      "thread:1",
    );

    expect(readChatComposerImageAttachments("thread:1")).toHaveLength(1);
    expect(readChatComposerImageAttachments("thread:2")).toEqual([]);
  });

  it("migrates image attachments from optimistic to persisted thread keys", () => {
    setChatComposerImageAttachments(
      [
        {
          byteSize: 12,
          data: "aGVsbG8=",
          id: "image-1",
          mimeType: "image/png",
          type: "image",
        },
      ],
      "thread:-1",
    );

    migrateChatComposerImageAttachmentKey("thread:-1", "thread:31");

    expect(readChatComposerImageAttachments("thread:-1")).toHaveLength(1);
    expect(readChatComposerImageAttachments("thread:31")).toHaveLength(1);
  });

  it("migrates pending image reads so late file loads land on the persisted thread", async () => {
    startChatComposerImageAttachmentRead("thread:-1");
    migrateChatComposerImageAttachmentKey("thread:-1", "thread:31");

    let settled = false;
    const waitForSettled = waitForChatComposerImageAttachments(
      "thread:31",
    ).then(() => {
      settled = true;
    });
    setChatComposerImageAttachments(
      [
        {
          byteSize: 12,
          data: "aGVsbG8=",
          id: "image-1",
          mimeType: "image/png",
          type: "image",
        },
      ],
      "thread:-1",
    );
    expect(readChatComposerPendingImageAttachmentReads("thread:31")).toBe(1);

    finishChatComposerImageAttachmentRead("thread:-1");
    await waitForSettled;

    expect(settled).toBeTrue();
    expect(readChatComposerImageAttachments("thread:31")).toHaveLength(1);
    expect(readChatComposerPendingImageAttachmentReads("thread:31")).toBe(0);
  });

  it("waits for pending image attachment reads to settle", async () => {
    startChatComposerImageAttachmentRead();

    let settled = false;
    const waitForSettled = waitForChatComposerImageAttachments().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBeFalse();

    finishChatComposerImageAttachmentRead();
    await waitForSettled;
    expect(settled).toBeTrue();
  });

  it("settles stalled image attachment reads after a timeout", async () => {
    startChatComposerImageAttachmentRead("thread:stalled", { timeoutMs: 1 });

    let settled = false;
    const waitForSettled = waitForChatComposerImageAttachments(
      "thread:stalled",
    ).then(() => {
      settled = true;
    });

    await waitForSettled;
    expect(settled).toBeTrue();
  });

  it("tracks image attachment read timeout handles independently", async () => {
    startChatComposerImageAttachmentRead("thread:out-of-order", {
      timeoutMs: 20,
    });
    startChatComposerImageAttachmentRead("thread:out-of-order", {
      timeoutMs: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(
      readChatComposerPendingImageAttachmentReads("thread:out-of-order"),
    ).toBe(1);

    await waitForChatComposerImageAttachments("thread:out-of-order");
    expect(
      readChatComposerPendingImageAttachmentReads("thread:out-of-order"),
    ).toBe(0);
  });

  it("keeps fake image attachment loading states scoped by draft key", async () => {
    startChatComposerImageAttachmentRead("thread:loading");

    let loadingSettled = false;
    const waitForLoadingSettled = waitForChatComposerImageAttachments(
      "thread:loading",
    ).then(() => {
      loadingSettled = true;
    });

    await waitForChatComposerImageAttachments("thread:ready");
    expect(loadingSettled).toBeFalse();
    expect(readChatComposerPendingImageAttachmentReads("thread:loading")).toBe(
      1,
    );
    expect(readChatComposerPendingImageAttachmentReads("thread:ready")).toBe(0);

    finishChatComposerImageAttachmentRead("thread:loading");
    await waitForLoadingSettled;
    expect(loadingSettled).toBeTrue();
  });

  it("bounds retained image attachment draft keys", () => {
    for (
      let index = 0;
      index <= CHAT_COMPOSER_IMAGE_ATTACHMENT_STORE_MAX_KEYS;
      index += 1
    ) {
      setChatComposerImageAttachments(
        [
          {
            byteSize: 1,
            data: "aA==",
            id: `image-${index}`,
            mimeType: "image/png",
            type: "image",
          },
        ],
        `thread:${index}`,
      );
    }

    expect(readChatComposerImageAttachments("thread:0")).toEqual([]);
    expect(
      readChatComposerImageAttachments(
        `thread:${CHAT_COMPOSER_IMAGE_ATTACHMENT_STORE_MAX_KEYS}`,
      ),
    ).toHaveLength(1);
  });

  it("bounds migrated image attachment key aliases", () => {
    for (
      let index = 0;
      index <= CHAT_COMPOSER_IMAGE_ATTACHMENT_ALIAS_MAX_ENTRIES;
      index += 1
    ) {
      migrateChatComposerImageAttachmentKey(
        `thread:optimistic-${index}`,
        `thread:persisted-${index}`,
      );
    }

    setChatComposerImageAttachments(
      [
        {
          byteSize: 1,
          data: "aA==",
          id: "image-latest",
          mimeType: "image/png",
          type: "image",
        },
      ],
      `thread:persisted-${CHAT_COMPOSER_IMAGE_ATTACHMENT_ALIAS_MAX_ENTRIES}`,
    );

    expect(
      readChatComposerImageAttachmentStoreTelemetry().aliasKeys,
    ).toBeLessThanOrEqual(CHAT_COMPOSER_IMAGE_ATTACHMENT_ALIAS_MAX_ENTRIES);
    expect(
      readChatComposerImageAttachments(
        `thread:optimistic-${CHAT_COMPOSER_IMAGE_ATTACHMENT_ALIAS_MAX_ENTRIES}`,
      ),
    ).toHaveLength(1);
  });
});

describe("chat composer image attachment ids", () => {
  it("uses crypto UUIDs instead of timestamp and Math.random ids", () => {
    const id = createImageAttachmentId();

    expect(id).toStartWith("image-");
    expect(id.slice("image-".length)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });
});

describe("chat composer image file detection", () => {
  it("accepts image-looking file selections even when the browser MIME type is empty", () => {
    expect(
      fileLooksLikeChatImage({ name: "camera-upload.jpg", type: "" }),
    ).toBeTrue();
    expect(
      fileLooksLikeChatImage({ name: "clipboard.bin", type: "image/png" }),
    ).toBeTrue();
  });

  it("rejects non-image file selections", () => {
    expect(fileLooksLikeChatImage({ name: "notes.txt", type: "" })).toBeFalse();
  });
});

describe("chat composer skill matching", () => {
  it("ignores skill trigger text when no skills are available", () => {
    expect(matchChatComposerSkillsTrigger("/skills:commit", 14, [])).toBeNull();
    expect(matchChatComposerSkillsTrigger("/skills:commit", 14)).toBeNull();
  });

  it("does not suggest skills without an active trigger match", () => {
    expect(filterChatComposerSkills(["commit", "research"], null)).toEqual([]);
  });

  it("matches skills trigger text at the cursor", () => {
    expect(
      matchChatComposerSkillsTrigger("please /skills:comm", 19, ["commit"]),
    ).toEqual({
      endIndex: 19,
      filter: "comm",
      startIndex: 7,
    });
  });

  it("does not match stale skill trigger text after whitespace", () => {
    expect(
      matchChatComposerSkillsTrigger("/skills:commit send", 19, ["commit"]),
    ).toBeNull();
  });

  it("filters available skills by the trigger filter", () => {
    const match = matchChatComposerSkillsTrigger("/skills:co", 10, [
      "commit",
      "grill-me",
      "to-prd",
    ]);

    expect(
      filterChatComposerSkills(["commit", "grill-me", "to-prd"], match),
    ).toEqual(["commit"]);
  });

  it("filters skill suggestions case-insensitively", () => {
    const match = matchChatComposerSkillsTrigger("/skills:RE", 10, [
      "research",
      "commit",
    ]);

    expect(filterChatComposerSkills(["research", "commit"], match)).toEqual([
      "research",
    ]);
  });
});
