/**
 * @file src/bun/sidecar-thread-metadata.test.ts
 * @description Test file for sidecar thread metadata.
 */

import { describe, expect, it } from "bun:test";

import {
  isThreadAccessBlockedWhileProcessing,
  normalizeOptionalSummary,
  normalizeSidecarThreadMetadataParams,
  type UpdateThreadAccessRpc,
  type UpdateThreadMetadataRpc,
  updateThreadAccessFromSidecar,
  updateThreadFromSidecar,
  updateThreadMetadataFromSidecar,
} from "./sidecar-thread-metadata";

describe("sidecar thread metadata updates", () => {
  it("normalizes blank summaries to null", () => {
    expect(normalizeOptionalSummary(undefined)).toBeUndefined();
    expect(normalizeOptionalSummary("   ")).toBeNull();
    expect(normalizeOptionalSummary(" Summary ")).toBe("Summary");
  });

  it("treats null sidecar metadata fields as omitted and accepts description aliases", () => {
    expect(
      normalizeSidecarThreadMetadataParams({
        threadId: 17,
        title: null,
        summary: null,
        description: " Alias summary ",
        pinned: null,
      }),
    ).toEqual({
      threadId: 17,
      summary: "Alias summary",
    });

    expect(() =>
      normalizeSidecarThreadMetadataParams({
        threadId: 17,
        title: null,
        summary: null,
        description: null,
        pinned: null,
      }),
    ).toThrow(
      "At least one of title, summary, description, or pinned is required.",
    );
  });

  it("routes thread metadata changes through the authoritative RPC path", async () => {
    const calls: Array<{
      params: Parameters<UpdateThreadMetadataRpc>[0];
      options: Parameters<UpdateThreadMetadataRpc>[1];
    }> = [];
    /**
     * Performs rpcCall operation.
     * @param params - Parameters object.
     * @param options - Configuration options used by this operation.
     */
    const rpcCall: UpdateThreadMetadataRpc = async (params, options) => {
      calls.push({ options, params });
      return {
        id: 17,
        webSearchAccess: false,
        githubAccess: false,
        agentsAccess: false,
        metidosAccess: true,
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
        piSessionId: null,
        piSessionFile: null,
        piLeafEntryId: null,
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

  it("routes description aliases through the authoritative RPC path", async () => {
    const calls: Array<Parameters<UpdateThreadMetadataRpc>[0]> = [];
    const rpcCall: UpdateThreadMetadataRpc = async (params) => {
      calls.push(params);
      return {
        id: 17,
        webSearchAccess: false,
        githubAccess: false,
        agentsAccess: false,
        metidosAccess: true,
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
        piSessionId: null,
        piSessionFile: null,
        piLeafEntryId: null,
        pinnedAt: null,
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

    const result = await updateThreadMetadataFromSidecar(rpcCall, {
      threadId: 17,
      title: null,
      summary: null,
      description: "  Alias description  ",
      pinned: null,
    });

    expect(calls).toEqual([
      {
        threadId: 17,
        summary: "Alias description",
      },
    ]);
    expect(result.summary).toBe("Alias description");
  });

  it("routes thread access changes through the authoritative RPC path", async () => {
    const calls: Array<{
      params: Parameters<UpdateThreadAccessRpc>[0];
      options: Parameters<UpdateThreadAccessRpc>[1];
    }> = [];
    /**
     * Performs rpcCall operation.
     * @param params - Parameters object.
     * @param options - Configuration options used by this operation.
     */
    const rpcCall: UpdateThreadAccessRpc = async (params, options) => {
      calls.push({ options, params });
      return {
        id: 17,
        projectId: 4,
        worktreePath: "/repo",
        title: "Existing title",
        summary: "Existing summary",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        webSearchAccess: params.webSearchAccess ?? false,
        githubAccess: params.githubAccess ?? false,
        agentsAccess: params.agentsAccess ?? false,
        metidosAccess: params.metidosAccess ?? true,
        unsafeMode: params.unsafeMode ?? false,
        piSessionId: null,
        piSessionFile: null,
        piLeafEntryId: null,
        pinnedAt: null,
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

    const result = await updateThreadAccessFromSidecar(
      rpcCall,
      {
        threadId: 17,
        githubAccess: true,
        metidosAccess: false,
        unsafeMode: true,
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
          githubAccess: true,
          metidosAccess: false,
          unsafeMode: true,
        },
        options: {
          priority: "foreground",
          timeoutMs: 5_000,
        },
      },
    ]);
    expect(result.githubAccess).toBeTrue();
    expect(result.metidosAccess).toBeFalse();
    expect(result.unsafeMode).toBeTrue();
  });

  it("keeps metadata updates when access toggles are rejected mid-turn", async () => {
    const metadataCalls: Array<Parameters<UpdateThreadMetadataRpc>[0]> = [];
    const accessCalls: Array<Parameters<UpdateThreadAccessRpc>[0]> = [];
    const metadataRpcCall: UpdateThreadMetadataRpc = async (params) => {
      metadataCalls.push(params);
      return {
        id: 17,
        projectId: 4,
        worktreePath: "/repo",
        title: params.title ?? "Existing title",
        summary: params.summary ?? "Existing summary",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        webSearchAccess: false,
        githubAccess: false,
        agentsAccess: false,
        metidosAccess: true,
        unsafeMode: true,
        piSessionId: null,
        piSessionFile: null,
        piLeafEntryId: null,
        pinnedAt: null,
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
          state: "working",
          startedAt: "2026-04-04T12:00:00.000Z",
          updatedAt: "2026-04-04T12:00:05.000Z",
          error: null,
          hasUnreadError: false,
        },
      };
    };
    const accessRpcCall: UpdateThreadAccessRpc = async (params) => {
      accessCalls.push(params);
      throw new Error(
        "Thread access controls cannot change while a run is processing.",
      );
    };

    const result = await updateThreadFromSidecar(
      metadataRpcCall,
      accessRpcCall,
      {
        threadId: 17,
        title: "Keep this title",
        unsafeMode: false,
      },
      {
        priority: "foreground",
      },
    );

    expect(metadataCalls).toEqual([
      {
        threadId: 17,
        title: "Keep this title",
      },
    ]);
    expect(accessCalls).toEqual([
      {
        threadId: 17,
        unsafeMode: false,
      },
    ]);
    expect(result.thread.title).toBe("Keep this title");
    expect(result.thread.unsafeMode).toBeTrue();
    expect(result.accessUpdateWarning).toBe(
      "Thread access update did not reach the live app: Thread access controls cannot change while a run is processing.",
    );
  });

  it("still fails access-only updates that are rejected mid-turn", async () => {
    const metadataRpcCall: UpdateThreadMetadataRpc = async () => {
      throw new Error("Metadata RPC should not run.");
    };
    const accessRpcCall: UpdateThreadAccessRpc = async () => {
      throw new Error(
        "Thread access controls cannot change while a run is processing.",
      );
    };

    await expect(
      updateThreadFromSidecar(metadataRpcCall, accessRpcCall, {
        threadId: 17,
        unsafeMode: false,
      }),
    ).rejects.toThrow(
      "Thread access update did not reach the live app: Thread access controls cannot change while a run is processing.",
    );
  });

  it("recognizes blocked mid-turn access-update errors", () => {
    expect(
      isThreadAccessBlockedWhileProcessing(
        new Error(
          "Thread access update did not reach the live app: Thread access controls cannot change while a run is processing.",
        ),
      ),
    ).toBeTrue();
    expect(
      isThreadAccessBlockedWhileProcessing(
        new Error("Thread metadata update did not reach the live app: boom"),
      ),
    ).toBeFalse();
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
        "Could not connect to Metidos RPC at ws://127.0.0.1:7599/rpc.",
      );
    };

    await expect(
      updateThreadMetadataFromSidecar(rpcCall, {
        threadId: 9,
        pinned: false,
      }),
    ).rejects.toThrow(
      "Thread metadata update did not reach the live app: Could not connect to Metidos RPC at ws://127.0.0.1:7599/rpc.",
    );

    expect(calls).toBe(1);
  });
});
