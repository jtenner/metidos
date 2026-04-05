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

  postMessage(message: MessagePreprocessingWorkerRequest): void {
    this.requests.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

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
});
