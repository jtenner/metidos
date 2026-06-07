/**
 * @file src/mainview/app/diff-parsing.test.ts
 * @description Test file for diff parsing.
 */

import { describe, expect, it } from "bun:test";

import {
  parseUnifiedDiffText,
  shouldWorkerizeDiffParsing,
} from "./diff-parsing";
import {
  DiffParseRequestManager,
  type DiffParseSnapshot,
  diffTextCacheKey,
  estimateDiffParseResultRetainedBytes,
} from "./diff-parsing-client";
import type {
  DiffParsingWorkerRequest,
  DiffParsingWorkerResponse,
} from "./diff-parsing-worker";

class FakeDiffWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<DiffParsingWorkerResponse>) => void) | null =
    null;
  requests: DiffParsingWorkerRequest[] = [];
  terminated = false;
  /**
   * Performs postMessage operation.
   * @param message - Message payload.
   */

  postMessage(message: DiffParsingWorkerRequest): void {
    this.requests.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }
  /**
   * Resolves last request.
   * @param response - Response payload.
   */

  resolveLastRequest(response: DiffParsingWorkerResponse): void {
    this.onmessage?.({
      data: response,
    } as MessageEvent<DiffParsingWorkerResponse>);
  }
}

function buildLargeDiff(): string {
  return Array.from({ length: 4000 }, (_, index) => `+line-${index}`).join(
    "\n",
  );
}

describe("parseUnifiedDiffText", () => {
  it("parses lines and summary counts in one pass", () => {
    expect(
      parseUnifiedDiffText(
        [
          "diff --git a/src/example.ts b/src/example.ts",
          "--- a/src/example.ts",
          "+++ b/src/example.ts",
          "@@ -1,2 +1,2 @@",
          "-oldValue",
          "+newValue",
          " unchanged",
        ].join("\n"),
      ),
    ).toEqual({
      lines: [
        {
          key: "0:diff --git a/src/example.ts b/src/example.ts",
          kind: "meta",
          text: "diff --git a/src/example.ts b/src/example.ts",
        },
        {
          key: "1:--- a/src/example.ts",
          kind: "file",
          text: "--- a/src/example.ts",
        },
        {
          key: "2:+++ b/src/example.ts",
          kind: "file",
          text: "+++ b/src/example.ts",
        },
        {
          key: "3:@@ -1,2 +1,2 @@",
          kind: "hunk",
          text: "@@ -1,2 +1,2 @@",
        },
        {
          key: "4:-oldValue",
          kind: "remove",
          text: "-oldValue",
        },
        {
          key: "5:+newValue",
          kind: "add",
          text: "+newValue",
        },
        {
          key: "6: unchanged",
          kind: "context",
          text: " unchanged",
        },
      ],
      summary: {
        additions: 1,
        deletions: 1,
        hunks: 1,
      },
    });
  });

  it("workerizes materially large diff bodies and dense many-line diffs", () => {
    expect(shouldWorkerizeDiffParsing("+small change")).toBeFalse();
    expect(shouldWorkerizeDiffParsing(buildLargeDiff())).toBeTrue();
    expect(
      shouldWorkerizeDiffParsing(
        Array.from({ length: 180 }, () => "+").join("\n"),
      ),
    ).toBeTrue();
  });
});

describe("diffTextCacheKey", () => {
  it("does not embed large diff text in cache keys", () => {
    const largeDiff = `${"+alpha\n".repeat(4000)}needle${"-bravo\n".repeat(4000)}`;
    const key = diffTextCacheKey(largeDiff);

    expect(key).not.toContain(largeDiff);
    expect(key).not.toContain("needle");
    expect(key.length).toBeLessThan(32);
  });

  it("distinguishes different same-length diff bodies", () => {
    expect(diffTextCacheKey("+abc\n-def")).not.toBe(
      diffTextCacheKey("+abd\n-dec"),
    );
  });
});

describe("DiffParseRequestManager", () => {
  it("deduplicates large-diff worker requests and reuses the cached result", () => {
    const fakeWorker = new FakeDiffWorker();
    const manager = new DiffParseRequestManager({
      canUseWorker: () => true,
      createWorker: () => fakeWorker,
    });
    const diffText = buildLargeDiff();
    const updates: DiffParseSnapshot[] = [];

    const initialSnapshot = manager.read(diffText);
    const duplicateSnapshot = manager.read(diffText);
    const unsubscribe = manager.subscribe(diffText, (snapshot) => {
      updates.push(snapshot);
    });

    expect(initialSnapshot.isLoading).toBeTrue();
    expect(duplicateSnapshot).toBe(initialSnapshot);
    expect(fakeWorker.requests).toHaveLength(1);

    const response = parseUnifiedDiffText(diffText);
    fakeWorker.resolveLastRequest({
      id: fakeWorker.requests[0]?.id ?? -1,
      ok: true,
      result: response,
    });

    expect(updates).toEqual([
      {
        isLoading: false,
        result: response,
      },
    ]);
    expect(manager.read(diffText)).toEqual({
      isLoading: false,
      result: response,
    });

    unsubscribe();
  });

  it("drops abandoned pending worker parses when the last listener unsubscribes", () => {
    const fakeWorker = new FakeDiffWorker();
    const manager = new DiffParseRequestManager({
      canUseWorker: () => true,
      createWorker: () => fakeWorker,
    });
    const diffText = buildLargeDiff();

    const firstSnapshot = manager.read(diffText);
    const unsubscribe = manager.subscribe(diffText, () => {});
    unsubscribe();
    const secondSnapshot = manager.read(diffText);

    expect(firstSnapshot.isLoading).toBeTrue();
    expect(secondSnapshot.isLoading).toBeTrue();
    expect(secondSnapshot).not.toBe(firstSnapshot);
    expect(fakeWorker.requests).toHaveLength(2);
  });

  it("falls back to synchronous parsing when the pending worker queue is full", () => {
    const fakeWorker = new FakeDiffWorker();
    const manager = new DiffParseRequestManager({
      canUseWorker: () => true,
      createWorker: () => fakeWorker,
      maxPendingWorkerRequests: 1,
    });
    const firstDiff = buildLargeDiff();
    const secondDiff = `${buildLargeDiff()}\n+second`;

    expect(manager.read(firstDiff).isLoading).toBeTrue();
    expect(manager.read(secondDiff)).toEqual({
      isLoading: false,
      result: parseUnifiedDiffText(secondDiff),
    });
    expect(fakeWorker.requests).toHaveLength(1);
  });

  it("falls back to synchronous parsing when worker creation is unavailable", () => {
    const manager = new DiffParseRequestManager({
      canUseWorker: () => false,
    });
    const diffText = buildLargeDiff();

    expect(manager.read(diffText)).toEqual({
      isLoading: false,
      result: parseUnifiedDiffText(diffText),
    });
  });

  it("evicts parsed diff cache entries by retained byte budget", () => {
    let parseCount = 0;
    const firstDiff = ["+first", "+alpha", "+omega"].join("\n");
    const secondDiff = ["+second", "+bravo", "+delta"].join("\n");
    const firstBytes = estimateDiffParseResultRetainedBytes(
      parseUnifiedDiffText(firstDiff),
    );
    const secondBytes = estimateDiffParseResultRetainedBytes(
      parseUnifiedDiffText(secondDiff),
    );
    const manager = new DiffParseRequestManager({
      canUseWorker: () => false,
      maxCacheBytes: firstBytes + secondBytes - 1,
      parseSynchronously: (diffText) => {
        parseCount += 1;
        return parseUnifiedDiffText(diffText);
      },
    });

    manager.read(firstDiff);
    manager.read(secondDiff);
    manager.read(firstDiff);

    expect(parseCount).toBe(3);
  });
});
