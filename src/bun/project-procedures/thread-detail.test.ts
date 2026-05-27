import { describe, expect, it } from "bun:test";

import type { ThreadMessageRecord, ThreadRecord } from "../db";
import { encodePiWebSearchMarker } from "./pi-sdk-shapes";
import {
  threadRunStatusFromRecord,
  toRpcThread,
  toRpcThreadMessages,
  toRpcThreadMessagesWithPreviews,
} from "./thread-detail";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function buildThreadRecord(
  overrides: Partial<ThreadRecord> = {},
): ThreadRecord {
  return {
    id: 7,
    projectId: 3,
    worktreePath: "/tmp/worktree",
    cronJobId: null,
    title: "Thread",
    summary: null,
    model: "gpt-5.4",
    reasoningEffort: "medium",
    webSearchAccess: true,
    githubAccess: false,
    gitAccess: false,
    sqliteAccess: false,
    agentsAccess: false,
    metidosAccess: false,
    permissions: [],
    unsafeMode: 0,
    piSessionId: null,
    piSessionFile: null,
    piLeafEntryId: null,
    pinnedAt: null,
    createdAt: "2026-04-14T12:00:00.000Z",
    updatedAt: "2026-04-14T12:00:05.000Z",
    lastRunAt: null,
    lastInputTokens: null,
    lastCachedInputTokens: null,
    lastOutputTokens: null,
    maxInputTokens: null,
    estimatedCompactionTriggerTokens: null,
    compactionCount: 0,
    lastCompactionAt: null,
    lastCompactionBeforeInputTokens: null,
    lastCompactionAfterInputTokens: null,
    activeTurnStartedAt: null,
    lastErrorAt: null,
    lastErrorSeenAt: null,
    lastErrorMessage: null,
    ...overrides,
  };
}

function buildThreadMessageRecord(
  overrides: Partial<ThreadMessageRecord> = {},
): ThreadMessageRecord {
  return {
    id: 1,
    threadId: 7,
    role: "assistant",
    kind: "chat",
    itemId: "assistant:1",
    text: "Assistant text",
    state: "completed",
    payloadJson: null,
    createdAt: "2026-04-14T12:00:00.000Z",
    updatedAt: "2026-04-14T12:00:00.000Z",
    ...overrides,
  };
}

describe("threadRunStatusFromRecord", () => {
  it("treats persisted active turns as working without local runtime state", () => {
    const thread = buildThreadRecord({
      activeTurnStartedAt: "2026-04-14T12:00:03.000Z",
      updatedAt: "2026-04-14T12:00:05.000Z",
    });

    expect(threadRunStatusFromRecord(thread)).toEqual({
      state: "working",
      startedAt: "2026-04-14T12:00:03.000Z",
      updatedAt: "2026-04-14T12:00:05.000Z",
      error: null,
      hasUnreadError: false,
    });
  });

  it("ignores stale unread errors while a newer persisted turn is active", () => {
    const thread = buildThreadRecord({
      activeTurnStartedAt: "2026-04-14T12:05:00.000Z",
      updatedAt: "2026-04-14T12:05:04.000Z",
      lastErrorAt: "2026-04-14T12:04:30.000Z",
      lastErrorSeenAt: null,
      lastErrorMessage: "Thread run failed: stale error",
    });

    expect(threadRunStatusFromRecord(thread)).toEqual({
      state: "working",
      startedAt: "2026-04-14T12:05:00.000Z",
      updatedAt: "2026-04-14T12:05:04.000Z",
      error: null,
      hasUnreadError: false,
    });
  });
});

describe("toRpcThread", () => {
  it("projects only the RPC thread contract without DB-only status fields", () => {
    const thread = buildThreadRecord({
      id: 42,
      cronJobId: 12,
      model: "codex-mini",
      unsafeMode: 1,
      lastInputTokens: 1200,
      lastCachedInputTokens: 300,
      lastOutputTokens: 80,
      activeTurnStartedAt: "2026-04-14T12:00:03.000Z",
      lastErrorAt: "2026-04-14T12:00:04.000Z",
      lastErrorSeenAt: null,
      lastErrorMessage: "boom",
    });

    const rpcThread = toRpcThread(thread);

    expect(rpcThread).toEqual(
      expect.objectContaining({
        id: 42,
        projectId: 3,
        model: "azure-openai-responses:gpt-5.4",
        unsafeMode: true,
        usage: {
          inputTokens: 1200,
          cachedInputTokens: 300,
          outputTokens: 80,
        },
        runStatus: {
          state: "working",
          startedAt: "2026-04-14T12:00:03.000Z",
          updatedAt: "2026-04-14T12:00:05.000Z",
          error: null,
          hasUnreadError: false,
        },
      }),
    );
    expect(rpcThread).not.toHaveProperty("ownerUserId");
    expect(rpcThread).not.toHaveProperty("cronJobId");
    expect(rpcThread).not.toHaveProperty("lastInputTokens");
    expect(rpcThread).not.toHaveProperty("activeTurnStartedAt");
    expect(rpcThread).not.toHaveProperty("lastErrorMessage");
  });

  it("serializes less data than a spread-based projection on status-heavy records", () => {
    const thread = buildThreadRecord({
      cronJobId: 12,
      lastInputTokens: 1200,
      lastCachedInputTokens: 300,
      lastOutputTokens: 80,
      maxInputTokens: 4000,
      estimatedCompactionTriggerTokens: 100000,
      compactionCount: 2,
      lastCompactionAt: "2026-04-14T12:00:02.000Z",
      lastCompactionBeforeInputTokens: 4000,
      lastCompactionAfterInputTokens: 2000,
      activeTurnStartedAt: "2026-04-14T12:00:03.000Z",
      lastErrorAt: "2026-04-14T12:00:04.000Z",
      lastErrorSeenAt: null,
      lastErrorMessage: "boom",
    });
    const rpcThread = toRpcThread(thread);
    const spreadStyleProjection = {
      ...thread,
      unsafeMode: true,
      usage: rpcThread.usage,
      compaction: rpcThread.compaction,
      runStatus: rpcThread.runStatus,
    };

    expect(JSON.stringify(rpcThread).length).toBeLessThan(
      JSON.stringify(spreadStyleProjection).length,
    );
  });
});

describe("toRpcThreadMessages", () => {
  it("filters persisted marker-only native web-search chat leaks", () => {
    const marker = encodePiWebSearchMarker({
      id: "ws_1",
      query: "bun docs",
      state: "completed",
    }).slice(0, -1);

    expect(
      toRpcThreadMessages([
        buildThreadMessageRecord({
          id: 1,
          text: marker,
        }),
        buildThreadMessageRecord({
          id: 2,
          role: "user",
          text: "Next user message",
        }),
      ]),
    ).toEqual([
      expect.objectContaining({
        id: 2,
        kind: "chat",
        text: "Next user message",
      }),
    ]);
  });

  it("sanitizes embedded native web-search markers from persisted chat text", () => {
    const marker = encodePiWebSearchMarker({
      id: "ws_1",
      query: "bun docs",
      state: "completed",
    }).slice(0, -1);

    expect(
      toRpcThreadMessages([
        buildThreadMessageRecord({
          text: `Before ${marker} after`,
        }),
      ]),
    ).toEqual([
      expect.objectContaining({
        kind: "chat",
        text: "Before  after",
      }),
    ]);
  });

  it("returns persisted image attachments for chat messages", () => {
    expect(
      toRpcThreadMessages(
        [
          buildThreadMessageRecord({
            role: "user",
            text: "Describe this image.",
            payloadJson: JSON.stringify({
              images: [
                { data: ONE_PIXEL_PNG, mimeType: "image/png", type: "image" },
              ],
            }),
          }),
        ],
        { includeHeavyContent: true },
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "chat",
        role: "user",
        text: "Describe this image.",
        images: [
          {
            byteSize: 68,
            data: ONE_PIXEL_PNG,
            dataLoaded: true,
            mimeType: "image/png",
            type: "image",
          },
        ],
      }),
    ]);
  });

  it("omits chat image payloads when heavy content is excluded", () => {
    expect(
      toRpcThreadMessages([
        buildThreadMessageRecord({
          role: "user",
          text: "Describe this image.",
          payloadJson: JSON.stringify({
            images: [
              { data: ONE_PIXEL_PNG, mimeType: "image/png", type: "image" },
            ],
          }),
        }),
      ]),
    ).toEqual([
      expect.objectContaining({
        kind: "chat",
        role: "user",
        text: "Describe this image.",
        images: [
          {
            byteSize: 68,
            data: "",
            dataLoaded: false,
            mimeType: "image/png",
            type: "image",
          },
        ],
      }),
    ]);
  });

  it("sends generated thumbnail previews when heavy chat image content is excluded", async () => {
    const previousImage = (globalThis.Bun as unknown as { Image?: unknown })
      .Image;
    class FakeImage {
      resize() {
        return {
          webp() {
            return {
              async blob() {
                return new Blob([new Uint8Array([1])], { type: "image/webp" });
              },
            };
          },
        };
      }
    }
    (globalThis.Bun as unknown as { Image?: unknown }).Image = FakeImage;
    try {
      await expect(
        toRpcThreadMessagesWithPreviews([
          buildThreadMessageRecord({
            role: "assistant",
            text: "Generated.",
            payloadJson: JSON.stringify({
              images: [
                {
                  data: ONE_PIXEL_PNG,
                  mimeType: "image/png",
                  type: "image",
                },
              ],
            }),
          }),
        ]),
      ).resolves.toEqual([
        expect.objectContaining({
          images: [
            expect.objectContaining({
              data: "AQ==",
              dataLoaded: false,
              mimeType: "image/webp",
              previewByteSize: 1,
              previewMimeType: "image/webp",
            }),
          ],
          kind: "chat",
          text: "Generated.",
        }),
      ]);
    } finally {
      if (previousImage === undefined) {
        delete (globalThis.Bun as unknown as { Image?: unknown }).Image;
      } else {
        (globalThis.Bun as unknown as { Image?: unknown }).Image =
          previousImage;
      }
    }
  });

  it("can omit heavy activity content from thread detail messages", () => {
    expect(
      toRpcThreadMessages(
        [
          buildThreadMessageRecord({
            id: 1,
            kind: "command",
            itemId: "cmd:1",
            payloadJson: JSON.stringify({
              command: "bun test",
              output: "large command output",
              exitCode: 0,
            }),
          }),
          buildThreadMessageRecord({
            id: 2,
            kind: "tool_call",
            itemId: "tool:1",
            payloadJson: JSON.stringify({
              server: "pi",
              tool: "bash",
              argumentsText: "{}",
              output: "large tool output",
            }),
          }),
        ],
        { includeHeavyContent: false },
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "command",
        command: "bun test",
        output: "",
        outputLoaded: false,
      }),
      expect.objectContaining({
        kind: "tool_call",
        tool: "bash",
        argumentsText: "{}",
        output: "",
        outputLoaded: false,
      }),
    ]);
  });
});
