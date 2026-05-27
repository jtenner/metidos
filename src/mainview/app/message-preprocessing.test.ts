/**
 * @file src/mainview/app/message-preprocessing.test.ts
 * @description Test file for message preprocessing.
 */

import { describe, expect, it } from "bun:test";

import {
  prepareMessageRenderPlan,
  shouldSkipSyntaxHighlighting,
  shouldWorkerizeMessagePreprocessing,
} from "./message-preprocessing";
import {
  estimatePreparedMessageRenderPlanBytes,
  MessagePreprocessingRequestManager,
  type MessagePreprocessingSnapshot,
} from "./message-preprocessing-client";
import type {
  MessagePreprocessingWorkerRequest,
  MessagePreprocessingWorkerResponse,
} from "./message-preprocessing-worker";

class FakeMessagePreprocessingWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage:
    | ((event: MessageEvent<MessagePreprocessingWorkerResponse>) => void)
    | null = null;
  requests: MessagePreprocessingWorkerRequest[] = [];
  terminated = false;
  /**
   * Performs postMessage operation.
   * @param message - Message payload.
   */

  postMessage(message: MessagePreprocessingWorkerRequest): void {
    this.requests.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }
  /**
   * Resolves last request.
   * @param response - Response payload.
   */

  resolveLastRequest(response: MessagePreprocessingWorkerResponse): void {
    this.onmessage?.({
      data: response,
    } as MessageEvent<MessagePreprocessingWorkerResponse>);
  }
}

function buildLargeMarkdownMessage(): string {
  const code = Array.from(
    { length: 260 },
    (_, index) => `console.log("line-${index}")`,
  ).join("\n");

  return [
    "# Build log",
    "",
    "A very large assistant response with a lot of code follows.",
    "",
    "```ts",
    code,
    "```",
    "",
    "Conclusion paragraph with [docs](https://example.com/docs).",
    "",
    "Additional filler to force the worker path.",
    Array.from({ length: 800 }, () => "extra markdown text").join(" "),
  ].join("\n");
}

function getManagerCacheKeys(
  manager: MessagePreprocessingRequestManager,
): string[] {
  return [
    ...(
      manager as unknown as {
        cache: Map<string, MessagePreprocessingSnapshot>;
      }
    ).cache.keys(),
  ];
}

function getManagerCacheBytes(
  manager: MessagePreprocessingRequestManager,
): number {
  return (manager as unknown as { cacheBytes: number }).cacheBytes;
}

function getManagerPendingKeys(
  manager: MessagePreprocessingRequestManager,
): string[] {
  return [
    ...(
      manager as unknown as {
        pendingByCacheKey: Map<string, unknown>;
      }
    ).pendingByCacheKey.keys(),
  ];
}

describe("prepareMessageRenderPlan", () => {
  it("keeps plain messages on the lightweight text path", () => {
    expect(
      prepareMessageRenderPlan("Plain response https://example.com/docs"),
    ).toEqual({
      kind: "plain",
      segments: [
        {
          key: "0:15",
          kind: "text",
          text: "Plain response ",
        },
        {
          href: "https://example.com/docs",
          key: "15:39",
          kind: "link",
          text: "https://example.com/docs",
        },
      ],
    });
  });

  it("prepares rich markdown into markdown and code blocks", () => {
    const plan = prepareMessageRenderPlan(buildLargeMarkdownMessage());

    expect(plan.kind).toBe("rich");
    if (plan.kind !== "rich") {
      throw new Error("Expected rich render plan");
    }

    expect(plan.blocks[0]).toEqual({
      key: "markdown:0",
      kind: "markdown",
      text: "# Build log\n\nA very large assistant response with a lot of code follows.\n",
    });
    expect(plan.blocks[1]).toEqual({
      code: Array.from(
        { length: 260 },
        (_, index) => `console.log("line-${index}")`,
      ).join("\n"),
      key: "code:1",
      kind: "code",
      language: "ts",
      shouldHighlight: false,
    });
    expect(plan.blocks[2]?.kind).toBe("markdown");
  });

  it("prepares fenced code blocks with full info strings", () => {
    const plan = prepareMessageRenderPlan(
      [
        "Intro paragraph.",
        "",
        "```javascript const measureTranscriptRowElement = useCallback(",
        "const nextHeight = element.offsetHeight;",
        "```",
        "",
        "Outro paragraph.",
      ].join("\n"),
    );

    expect(plan.kind).toBe("rich");
    if (plan.kind !== "rich") {
      throw new Error("Expected rich render plan");
    }

    expect(plan.blocks).toEqual([
      {
        key: "markdown:0",
        kind: "markdown",
        text: "Intro paragraph.\n",
      },
      {
        code: "const nextHeight = element.offsetHeight;",
        key: "code:1",
        kind: "code",
        language: "javascript",
        shouldHighlight: true,
      },
      {
        key: "markdown:2",
        kind: "markdown",
        text: "\nOutro paragraph.",
      },
    ]);
  });

  it("only workerizes materially large markdown payloads", () => {
    expect(
      shouldWorkerizeMessagePreprocessing("## short\n\n- item"),
    ).toBeFalse();
    expect(
      shouldWorkerizeMessagePreprocessing(buildLargeMarkdownMessage()),
    ).toBeTrue();
  });

  it("skips syntax highlighting for oversized code blocks", () => {
    expect(shouldSkipSyntaxHighlighting("const value = 1;")).toBeFalse();
    expect(
      shouldSkipSyntaxHighlighting(
        Array.from({ length: 300 }, () => "console.log('value')").join("\n"),
      ),
    ).toBeTrue();
  });
});

describe("MessagePreprocessingRequestManager", () => {
  it("deduplicates worker preprocessing requests and reuses cached plans", () => {
    const fakeWorker = new FakeMessagePreprocessingWorker();
    const manager = new MessagePreprocessingRequestManager({
      canUseWorker: () => true,
      createWorker: () => fakeWorker,
    });
    const text = buildLargeMarkdownMessage();
    const updates: MessagePreprocessingSnapshot[] = [];

    const initialSnapshot = manager.read(text);
    const duplicateSnapshot = manager.read(text);
    const unsubscribe = manager.subscribe(text, (snapshot) => {
      updates.push(snapshot);
    });

    expect(initialSnapshot.isLoading).toBeTrue();
    expect(duplicateSnapshot).toBe(initialSnapshot);
    expect(fakeWorker.requests).toHaveLength(1);

    const plan = prepareMessageRenderPlan(text);
    fakeWorker.resolveLastRequest({
      id: fakeWorker.requests[0]?.id ?? -1,
      ok: true,
      plan,
    });

    expect(updates).toEqual([
      {
        isLoading: false,
        plan,
      },
    ]);
    expect(manager.read(text)).toEqual({
      isLoading: false,
      plan,
    });

    unsubscribe();
  });

  it("drops abandoned pending worker preprocessing when the last listener unsubscribes", () => {
    const fakeWorker = new FakeMessagePreprocessingWorker();
    const manager = new MessagePreprocessingRequestManager({
      canUseWorker: () => true,
      createWorker: () => fakeWorker,
    });
    const text = buildLargeMarkdownMessage();

    const firstSnapshot = manager.read(text);
    const unsubscribe = manager.subscribe(text, () => {});
    unsubscribe();
    const secondSnapshot = manager.read(text);

    expect(firstSnapshot.isLoading).toBeTrue();
    expect(secondSnapshot.isLoading).toBeTrue();
    expect(secondSnapshot).not.toBe(firstSnapshot);
    expect(fakeWorker.requests).toHaveLength(2);
  });

  it("falls back to synchronous preprocessing when the pending worker queue is full", () => {
    const fakeWorker = new FakeMessagePreprocessingWorker();
    const manager = new MessagePreprocessingRequestManager({
      canUseWorker: () => true,
      createWorker: () => fakeWorker,
      maxPendingWorkerRequests: 1,
    });
    const firstText = buildLargeMarkdownMessage();
    const secondText = `${buildLargeMarkdownMessage()}\nsecond`;

    expect(manager.read(firstText).isLoading).toBeTrue();
    expect(manager.read(secondText)).toEqual({
      isLoading: false,
      plan: prepareMessageRenderPlan(secondText),
    });
    expect(fakeWorker.requests).toHaveLength(1);
  });

  it("does not cache a prepared plan above the per-entry byte budget", () => {
    const text = `${"# Huge response\n\n"}${"body ".repeat(1024)}`;
    const manager = new MessagePreprocessingRequestManager({
      canUseWorker: () => false,
      maxCacheEntryBytes: 128,
    });
    const snapshot = manager.read(text);

    expect(snapshot.isLoading).toBe(false);
    expect(
      estimatePreparedMessageRenderPlanBytes(snapshot.plan),
    ).toBeGreaterThan(128);
    expect(getManagerCacheKeys(manager)).toHaveLength(0);
    expect(getManagerCacheBytes(manager)).toBe(0);
  });

  it("evicts prepared plans to keep the total cache byte budget bounded", () => {
    const manager = new MessagePreprocessingRequestManager({
      canUseWorker: () => false,
      maxCacheBytes: 500,
      maxCacheEntryBytes: 500,
      maxCacheEntries: 16,
    });

    manager.read(`# First\n\n${"first ".repeat(20)}`);
    manager.read(`# Second\n\n${"second ".repeat(20)}`);
    manager.read(`# Third\n\n${"third ".repeat(20)}`);

    expect(getManagerCacheBytes(manager)).toBeLessThanOrEqual(500);
    expect(getManagerCacheKeys(manager).length).toBeLessThan(3);
  });

  it("falls back to synchronous preprocessing when a worker is unavailable", () => {
    const manager = new MessagePreprocessingRequestManager({
      canUseWorker: () => false,
    });
    const text = buildLargeMarkdownMessage();

    expect(manager.read(text)).toEqual({
      isLoading: false,
      plan: prepareMessageRenderPlan(text),
    });
  });

  it("uses compact cache and pending keys instead of retaining full message text", () => {
    const fakeWorker = new FakeMessagePreprocessingWorker();
    const workerManager = new MessagePreprocessingRequestManager({
      canUseWorker: () => true,
      createWorker: () => fakeWorker,
    });
    const text = buildLargeMarkdownMessage();

    workerManager.read(text);
    expect(getManagerPendingKeys(workerManager)).toHaveLength(1);
    expect(getManagerPendingKeys(workerManager)).not.toContain(text);

    fakeWorker.resolveLastRequest({
      id: fakeWorker.requests[0]?.id ?? -1,
      ok: true,
      plan: prepareMessageRenderPlan(text),
    });

    expect(getManagerCacheKeys(workerManager)).toHaveLength(1);
    expect(getManagerCacheKeys(workerManager)).not.toContain(text);

    const syncManager = new MessagePreprocessingRequestManager({
      canUseWorker: () => false,
    });
    syncManager.read(text);

    expect(getManagerCacheKeys(syncManager)).toHaveLength(1);
    expect(getManagerCacheKeys(syncManager)).not.toContain(text);
  });
});
