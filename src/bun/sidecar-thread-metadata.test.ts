import { describe, expect, it } from "bun:test";

import {
  normalizeOptionalSummary,
  type UpdateThreadMetadataRpc,
  updateThreadMetadataFromSidecar,
} from "./sidecar-thread-metadata";

describe("sidecar thread metadata updates", () => {
  it("normalizes blank summaries to null", () => {
    expect(normalizeOptionalSummary(undefined)).toBeUndefined();
    expect(normalizeOptionalSummary("   ")).toBeNull();
    expect(normalizeOptionalSummary(" Summary ")).toBe("Summary");
  });

  it("routes thread metadata changes through the authoritative RPC path", async () => {
    const calls: Array<{
      params: Parameters<UpdateThreadMetadataRpc>[0];
      options: Parameters<UpdateThreadMetadataRpc>[1];
    }> = [];
    const rpcCall: UpdateThreadMetadataRpc = async (params, options) => {
      calls.push({ options, params });
      return {
        id: 17,
        projectId: 4,
        worktreePath: "/repo",
        title: params.title ?? "Existing title",
        summary:
          typeof params.summary === "undefined"
            ? "Existing summary"
            : params.summary,
        model: "gpt-5.4",
        reasoningEffort: "medium",
        unsafeMode: false,
        codexThreadId: null,
        pinnedAt: params.pinned ? "2026-04-04T12:00:00.000Z" : null,
        createdAt: "2026-04-04T11:00:00.000Z",
        updatedAt: "2026-04-04T12:00:00.000Z",
        lastRunAt: null,
        usage: null,
        compaction: {
          estimatedTriggerTokens: 0,
          estimatedTriggerSource: "heuristic",
          maxObservedInputTokens: null,
          inferredCount: 0,
          lastInferredAt: null,
          lastInferredBeforeInputTokens: null,
          lastInferredAfterInputTokens: null,
        },
        runStatus: {
          state: "idle",
          startedAt: null,
          updatedAt: null,
          error: null,
          hasUnreadError: false,
        },
      };
    };

    const result = await updateThreadMetadataFromSidecar(
      rpcCall,
      {
        threadId: 17,
        title: "  Better title  ",
        summary: "   ",
        pinned: true,
      },
      {
        priority: "foreground",
        timeoutMs: 5_000,
      },
    );

    expect(calls).toEqual([
      {
        params: {
          threadId: 17,
          title: "Better title",
          summary: null,
          pinned: true,
        },
        options: {
          priority: "foreground",
          timeoutMs: 5_000,
        },
      },
    ]);
    expect(result.title).toBe("Better title");
    expect(result.summary).toBeNull();
    expect(result.pinnedAt).toBe("2026-04-04T12:00:00.000Z");
  });

  it("surfaces RPC timeouts instead of claiming success locally", async () => {
    let calls = 0;
    const rpcCall: UpdateThreadMetadataRpc = async () => {
      calls += 1;
      throw new Error('RPC "updateThreadMetadata" timed out after 5000ms.');
    };

    await expect(
      updateThreadMetadataFromSidecar(rpcCall, {
        threadId: 9,
        title: "Keep visible state honest",
      }),
    ).rejects.toThrow(
      'Thread metadata update did not reach the live app: RPC "updateThreadMetadata" timed out after 5000ms.',
    );

    expect(calls).toBe(1);
  });

  it("surfaces RPC connection failures instead of falling back to SQLite writes", async () => {
    let calls = 0;
    const rpcCall: UpdateThreadMetadataRpc = async () => {
      calls += 1;
      throw new Error(
        "Could not connect to Jolt RPC at ws://127.0.0.1:7599/rpc.",
      );
    };

    await expect(
      updateThreadMetadataFromSidecar(rpcCall, {
        threadId: 9,
        pinned: false,
      }),
    ).rejects.toThrow(
      "Thread metadata update did not reach the live app: Could not connect to Jolt RPC at ws://127.0.0.1:7599/rpc.",
    );

    expect(calls).toBe(1);
  });
});
