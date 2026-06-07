/**
 * @file src/mainview/app/transcript-pipeline.test.ts
 * @description Characterization tests for transcript pipeline classification and row identity.
 */

import { describe, expect, it } from "bun:test";

import {
  buildTranscriptItemViewModels,
  classifyTranscriptPipelineItem,
  deriveGroupedVisibleMessages,
  deriveTranscriptItemViewModels,
  formatTranscriptDiffSummaryLabel,
  isPlainAssistantTranscriptTextMessage,
  isTranscriptAssistantVisibleMessage,
  parseTranscriptDiffText,
  prepareTranscriptDiffRendering,
  prepareTranscriptFileChangeRendering,
  prepareTranscriptToolCallRendering,
  resolveTranscriptItemExpansionState,
  routeTranscriptMarkdownText,
  shouldPrepareTranscriptMarkdownWithWorker,
  shouldWorkerizeTranscriptDiffParsing,
} from "./transcript-pipeline";
import type { VisibleMessage } from "./visible-message-state";

function buildLargePlainMessage(): string {
  return Array.from(
    { length: 1_400 },
    (_, index) => `plain transcript line ${index}`,
  ).join("\n");
}

function buildLargeMarkdownMessage(): string {
  return [
    "# Build log",
    "",
    "A very large assistant response with markdown-heavy structure follows.",
    "",
    "```ts",
    Array.from(
      { length: 260 },
      (_, index) => `console.log("line-${index}")`,
    ).join("\n"),
    "```",
    "",
    "Conclusion paragraph with [docs](https://example.com/docs).",
    "",
    Array.from({ length: 800 }, () => "extra markdown text").join(" "),
  ].join("\n");
}

function buildLargeUnifiedDiff(): string {
  return [
    "diff --git a/src/mainview/huge.ts b/src/mainview/huge.ts",
    "--- a/src/mainview/huge.ts",
    "+++ b/src/mainview/huge.ts",
    "@@ -1,900 +1,900 @@",
    ...Array.from({ length: 900 }, (_, index) => [
      ` context line ${index}`,
      `-removed transcript diff line ${index}`,
      `+added transcript diff line ${index}`,
    ]).flat(),
  ].join("\n");
}

function buildSampleDiff(): string {
  return [
    "diff --git a/src/mainview/App.tsx b/src/mainview/App.tsx",
    "--- a/src/mainview/App.tsx",
    "+++ b/src/mainview/App.tsx",
    "@@ -1,3 +1,4 @@",
    " import { App } from './app';",
    "-oldLine();",
    "+newLine();",
    "+extraLine();",
  ].join("\n");
}

function visibleChatMessage(
  key: string,
  speaker: "assistant" | "user",
  overrides?: Partial<Extract<VisibleMessage, { kind: "chat" }>>,
): Extract<VisibleMessage, { kind: "chat" }> {
  return {
    key,
    kind: "chat",
    messageId: Number(key.replace(/\D+/g, "") || 0),
    speaker,
    state: "completed",
    text: `${speaker} ${key}`,
    tone: "normal",
    ...overrides,
  };
}

describe("transcript markdown routing", () => {
  it("keeps plain transcript text on the lightweight route even when huge", () => {
    const text = buildLargePlainMessage();

    expect(shouldPrepareTranscriptMarkdownWithWorker(text)).toBeFalse();
    expect(routeTranscriptMarkdownText({ text })).toEqual({
      kind: "plain",
      segments: [{ key: "0:0", kind: "text", text }],
    });
  });

  it("routes large markdown-heavy transcript text through preprocessing", () => {
    const text = buildLargeMarkdownMessage();

    expect(shouldPrepareTranscriptMarkdownWithWorker(text)).toBeTrue();
    expect(routeTranscriptMarkdownText({ text })).toEqual({
      kind: "preprocessed",
    });
  });

  it("routes large in-progress markdown to plain text while streaming", () => {
    const text = buildLargeMarkdownMessage();

    const route = routeTranscriptMarkdownText({ state: "in_progress", text });

    expect(route.kind).toBe("plain");
    if (route.kind !== "plain") {
      throw new Error("Expected plain route");
    }
    expect(route.segments.map((segment) => segment.text).join("")).toBe(text);
  });

  it("routes in-progress markdown below the worker threshold to plain text", () => {
    const text = "## Working\n\n- item";

    expect(
      routeTranscriptMarkdownText({
        state: "in_progress",
        text,
      }),
    ).toEqual({
      kind: "plain",
      segments: [{ key: "0:0", kind: "text", text }],
    });
  });

  it("routes completed markdown below the worker threshold to rich markdown", () => {
    expect(routeTranscriptMarkdownText({ text: "## Done\n\n- item" })).toEqual({
      kind: "rich",
      streaming: false,
    });
  });

  it("segments plain assistant links before renderer components are selected", () => {
    expect(
      routeTranscriptMarkdownText({
        text: "Open https://example.com/docs for details.",
      }),
    ).toEqual({
      kind: "plain",
      segments: [
        { key: "0:5", kind: "text", text: "Open " },
        {
          href: "https://example.com/docs",
          key: "5:29",
          kind: "link",
          text: "https://example.com/docs",
        },
        { key: "29:42", kind: "text", text: " for details." },
      ],
    });
  });

  it("keeps markdown code-block routing behind the transcript pipeline", () => {
    expect(
      routeTranscriptMarkdownText({ text: "```ts\nconst ok = true;\n```" }),
    ).toEqual({
      kind: "rich",
      streaming: false,
    });
    expect(
      routeTranscriptMarkdownText({ text: buildLargeMarkdownMessage() }),
    ).toEqual({
      kind: "preprocessed",
    });
  });
});

describe("transcript tool-call rendering", () => {
  it("prepares Pi tool previews and display text through the pipeline", () => {
    expect(
      prepareTranscriptToolCallRendering({
        argumentsText: JSON.stringify({
          limit: 20,
          path: "/Users/example/project/src/mainview/App.tsx",
        }),
        displayOptions: {
          homeDirectory: "/Users/example",
          supportsTildePath: true,
        },
        output: "Read /Users/example/project/src/mainview/App.tsx",
        state: "completed",
        tool: "read",
      }),
    ).toEqual({
      displayArgumentsText:
        '{"limit":20,"path":"~/project/src/mainview/App.tsx"}',
      displayOutputText: "Read ~/project/src/mainview/App.tsx",
      outputLabel: "Contents",
      preview: "~/project/src/mainview/App.tsx (limit 20)",
      renderOutputAsMarkdown: false,
      stateLabel: "Completed",
    });
  });

  it("keeps failed tool output on the plain error route", () => {
    expect(
      prepareTranscriptToolCallRendering({
        argumentsText: "{}",
        displayOptions: {
          homeDirectory: "/Users/example",
          supportsTildePath: true,
        },
        output: "| id |",
        state: "failed",
        tool: "sqlite",
      }),
    ).toMatchObject({
      outputLabel: "Error",
      renderOutputAsMarkdown: false,
      stateLabel: "Failed",
    });
  });

  it("prepares command summaries and markdown-capable tool outputs consistently", () => {
    expect(
      prepareTranscriptToolCallRendering({
        argumentsText: JSON.stringify({
          command: "bun test src/mainview/app/transcript-pipeline.test.ts",
        }),
        displayOptions: {
          homeDirectory: "/Users/example",
          supportsTildePath: true,
        },
        output: "1 pass\n0 fail",
        state: "in_progress",
        tool: "bash",
      }),
    ).toMatchObject({
      outputLabel: "Command",
      preview: "bun test src/mainview/app/transcript-pipeline.test.ts",
      renderOutputAsMarkdown: false,
      stateLabel: "Running",
    });
    expect(
      prepareTranscriptToolCallRendering({
        argumentsText: "SELECT id, title FROM tasks",
        displayOptions: {
          homeDirectory: "/Users/example",
          supportsTildePath: true,
        },
        output: "| id | title |\n| --- | --- |\n| 1 | Ship it |",
        state: "completed",
        tool: "sqlite",
      }),
    ).toMatchObject({
      outputLabel: "Result",
      renderOutputAsMarkdown: true,
      stateLabel: "Completed",
    });
  });
});

describe("transcript diff rendering", () => {
  it("prepares parsed diff summaries and file-change labels through the pipeline", () => {
    const diffText = buildSampleDiff();
    const parsedDiffState = {
      isLoading: false,
      result: parseTranscriptDiffText(diffText),
    };

    expect(shouldWorkerizeTranscriptDiffParsing(diffText)).toBeFalse();
    expect(
      prepareTranscriptDiffRendering({ diffText, parsedDiffState }),
    ).toEqual({
      hasDiff: true,
      hunkLabel: "1 Hunk",
      lines: parsedDiffState.result.lines,
      parseState: parsedDiffState,
      summary: {
        additions: 2,
        deletions: 1,
        hunks: 1,
      },
      summaryLabel: "2 additions · 1 deletions",
    });
    expect(
      formatTranscriptDiffSummaryLabel(parsedDiffState.result.summary),
    ).toBe("2 additions · 1 deletions");
    expect(
      prepareTranscriptFileChangeRendering({
        changeKind: "update",
        diffLoaded: true,
        diffText,
        parsedDiffState,
        path: "src/mainview/App.tsx",
        state: "completed",
      }),
    ).toEqual({
      changeLabel: "Updated",
      diffRegionId: "file-change-diff-src-mainview-App-tsx",
      hasDiff: true,
      hunkLabel: "1 Hunk",
      stateLabel: "Updated",
      summary: {
        additions: 2,
        deletions: 1,
        hunks: 1,
      },
      summaryLabel: "2 additions · 1 deletions",
    });
  });

  it("keeps large diff parsing on the worker-capable transcript route", () => {
    const diffText = buildLargeUnifiedDiff();
    const parsedDiffState = {
      isLoading: false,
      result: parseTranscriptDiffText(diffText),
    };

    expect(shouldWorkerizeTranscriptDiffParsing(diffText)).toBeTrue();
    expect(
      prepareTranscriptDiffRendering({ diffText, parsedDiffState }),
    ).toMatchObject({
      hasDiff: true,
      hunkLabel: "1 Hunk",
      summary: {
        additions: 900,
        deletions: 900,
        hunks: 1,
      },
      summaryLabel: "900 additions · 900 deletions",
    });
  });
});

describe("transcript pipeline item classification", () => {
  it("classifies plain user and assistant chat without renderer component details", () => {
    const userMessage = visibleChatMessage("thread-message:1", "user", {
      images: [
        {
          byteSize: 128,
          mimeType: "image/png",
          payloadKey: "thread-message:1:image:0",
          type: "image",
        },
      ],
    });
    const assistantMessage = visibleChatMessage(
      "thread-message:2",
      "assistant",
    );

    expect(isTranscriptAssistantVisibleMessage(userMessage)).toBe(false);
    expect(isTranscriptAssistantVisibleMessage(assistantMessage)).toBe(true);
    expect(isPlainAssistantTranscriptTextMessage(assistantMessage)).toBe(true);

    expect(classifyTranscriptPipelineItem(userMessage)).toMatchObject({
      contentKind: "chat",
      deferredContent: false,
      expansion: { mode: "none" },
      itemKey: "thread-message:1",
      lifecycle: "completed",
      messageId: 1,
      rowIdentity: "thread-message:1",
      speaker: "user",
      textMode: "markdown-routed",
    });
    expect(classifyTranscriptPipelineItem(userMessage).mediaPayloads).toEqual([
      {
        byteSize: 128,
        kind: "image",
        mimeType: "image/png",
        payloadKey: "thread-message:1:image:0",
      },
    ]);
  });

  it("treats assistant working, error, and notice chat rows as status content", () => {
    for (const tone of ["working", "error", "notice"] as const) {
      const message = visibleChatMessage(`thread-${tone}`, "assistant", {
        state: tone === "working" ? "in_progress" : "completed",
        text: tone,
        tone,
      });

      expect(isPlainAssistantTranscriptTextMessage(message)).toBe(false);
      expect(classifyTranscriptPipelineItem(message)).toMatchObject({
        contentKind: "status",
        speaker: "assistant",
        textMode: "status",
      });
    }
  });

  it("preserves expansion and deferred-content semantics for command rows", () => {
    const command: VisibleMessage = {
      command: "bun test",
      exitCode: null,
      key: "thread-message:3",
      kind: "command",
      messageId: 3,
      output: "",
      outputLoaded: false,
      state: "in_progress",
    };

    expect(classifyTranscriptPipelineItem(command)).toEqual({
      contentKind: "command",
      deferredContent: true,
      expansion: {
        defaultExpanded: false,
        itemKey: "thread-message:3",
        mode: "optional",
        requestContent: "command_output",
      },
      itemKey: "thread-message:3",
      lifecycle: "in_progress",
      mediaPayloads: [],
      messageId: 3,
      rowIdentity: "thread-message:3",
      speaker: "assistant",
      textMode: "monospace-output",
    });
  });

  it("preserves diff expansion and deferred-content semantics for file changes", () => {
    const fileChange: VisibleMessage = {
      changeKind: "update",
      diffLoaded: false,
      diffText: "",
      key: "thread-message:4",
      kind: "file_change",
      messageId: 4,
      path: "src/mainview/App.tsx",
      state: "completed",
    };

    expect(classifyTranscriptPipelineItem(fileChange)).toMatchObject({
      contentKind: "file_change",
      deferredContent: true,
      expansion: {
        defaultExpanded: false,
        itemKey: "thread-message:4",
        mode: "optional",
        requestContent: "file_diff",
      },
      textMode: "diff",
    });
  });

  it("keeps tool-call default expansion and deferred output requests stable", () => {
    const toolCall: VisibleMessage = {
      argumentsText: "{}",
      key: "thread-message:5",
      kind: "tool_call",
      messageId: 5,
      output: "",
      outputLoaded: false,
      server: "pi",
      state: "completed",
      tool: "web_server_host",
    };

    expect(classifyTranscriptPipelineItem(toolCall)).toMatchObject({
      contentKind: "tool_call",
      deferredContent: true,
      expansion: {
        defaultExpanded: true,
        itemKey: "thread-message:5",
        mode: "optional",
        requestContent: "tool_output",
      },
      textMode: "tool-summary",
    });
    expect(resolveTranscriptItemExpansionState(toolCall, new Set())).toEqual({
      expanded: true,
      itemKey: "thread-message:5",
      messageId: 5,
      requestContent: "tool_output",
    });
    expect(
      resolveTranscriptItemExpansionState(
        toolCall,
        new Set(["thread-message:5"]),
      ),
    ).toMatchObject({ expanded: false });
  });

  it("builds transcript view-model items with prepared expansion and copy policy", () => {
    const assistant = visibleChatMessage("thread-message:7", "assistant", {
      text: "copyable",
    });
    const toolCall: VisibleMessage = {
      argumentsText: "{}",
      key: "thread-message:8",
      kind: "tool_call",
      messageId: 8,
      output: "",
      outputLoaded: false,
      server: "pi",
      state: "completed",
      tool: "web_server_host",
    };

    const items = buildTranscriptItemViewModels(
      [assistant, toolCall],
      new Set(["thread-message:8"]),
    );

    expect(items.map((item) => item.message)).toEqual([assistant, toolCall]);
    expect(items[0]).toMatchObject({
      expansionState: {
        expanded: false,
        itemKey: null,
        messageId: 7,
        requestContent: null,
      },
      isAssistantVisible: true,
      isPlainAssistantText: true,
      model: {
        contentKind: "chat",
        itemKey: "thread-message:7",
        textMode: "markdown-routed",
      },
    });
    expect(items[1]).toMatchObject({
      expansionState: {
        expanded: false,
        itemKey: "thread-message:8",
        messageId: 8,
        requestContent: "tool_output",
      },
      isAssistantVisible: true,
      isPlainAssistantText: false,
      model: {
        contentKind: "tool_call",
        deferredContent: true,
        textMode: "tool-summary",
      },
    });
  });

  it("reuses transcript view-model items for unchanged streaming rows", () => {
    const expandedItemIds = new Set<string>();
    const firstAssistant = visibleChatMessage("thread-message:11", "assistant");
    const streamingAssistant = visibleChatMessage(
      "thread-message:12",
      "assistant",
      {
        state: "in_progress",
        text: "partial",
      },
    );
    const firstCache = deriveTranscriptItemViewModels(
      [firstAssistant, streamingAssistant],
      expandedItemIds,
    );
    const nextStreamingAssistant = visibleChatMessage(
      "thread-message:12",
      "assistant",
      {
        state: "in_progress",
        text: "partial update",
      },
    );

    const nextCache = deriveTranscriptItemViewModels(
      [firstAssistant, nextStreamingAssistant],
      expandedItemIds,
      firstCache,
    );

    expect(nextCache.items).not.toBe(firstCache.items);
    expect(nextCache.items[0]).toBe(firstCache.items[0]);
    expect(nextCache.items[1]).not.toBe(firstCache.items[1]);
  });

  it("keeps large assistant text attached only to the source message", () => {
    const largeText = buildLargeMarkdownMessage();
    const [item] = buildTranscriptItemViewModels(
      [
        visibleChatMessage("thread-message:9", "assistant", {
          text: largeText,
        }),
      ],
      new Set(),
    );

    expect(item?.message.kind).toBe("chat");
    expect(item?.model).toMatchObject({
      contentKind: "chat",
      itemKey: "thread-message:9",
      textMode: "markdown-routed",
    });
    expect(JSON.stringify(item?.model)).not.toContain(
      'console.log("line-259")',
    );
  });

  it("carries media row descriptors on prepared view-model items", () => {
    const chatWithImage = visibleChatMessage("thread-message:10", "user", {
      images: [
        {
          byteSize: 1234,
          mimeType: "image/png",
          payloadKey: "thread-message:10:image:0",
          type: "image",
        },
      ],
    });

    const items = buildTranscriptItemViewModels([chatWithImage], new Set());

    expect(items.map((item) => item.model.mediaPayloads)).toEqual([
      [
        {
          byteSize: 1234,
          kind: "image",
          mimeType: "image/png",
          payloadKey: "thread-message:10:image:0",
        },
      ],
    ]);
  });
});

describe("transcript pipeline virtual row grouping", () => {
  it("groups adjacent assistant-visible items under the first row key", () => {
    const messages: VisibleMessage[] = [
      visibleChatMessage("thread-message:1", "user"),
      visibleChatMessage("thread-message:2", "assistant"),
      {
        key: "thread-message:3",
        kind: "reasoning",
        state: "completed",
        text: "thinking",
      },
      visibleChatMessage("thread-message:4", "user"),
      {
        key: "thread-message:5",
        kind: "web_search",
        query: "metidos",
        state: "completed",
      },
    ];

    const grouped = deriveGroupedVisibleMessages(7, messages, null);

    expect(grouped.groups).toEqual([
      { kind: "user", key: "thread-message:1", messageIndex: 0 },
      {
        endIndex: 3,
        key: "thread-message:2",
        kind: "assistant",
        startIndex: 1,
      },
      { kind: "user", key: "thread-message:4", messageIndex: 3 },
      {
        endIndex: 5,
        key: "thread-message:5",
        kind: "assistant",
        startIndex: 4,
      },
    ]);
  });

  it("reuses group rows when stable keys receive updated item objects", () => {
    const messages = [
      visibleChatMessage("thread-message:1", "assistant", { text: "old" }),
      visibleChatMessage("thread-message:2", "assistant", { text: "old" }),
    ];
    const previous = deriveGroupedVisibleMessages(7, messages, null);
    const refreshedMessages = [
      visibleChatMessage("thread-message:1", "assistant", { text: "new" }),
      visibleChatMessage("thread-message:2", "assistant", { text: "new" }),
    ];

    const refreshed = deriveGroupedVisibleMessages(
      7,
      refreshedMessages,
      previous,
    );

    expect(refreshed.groups).toBe(previous.groups);
    expect(refreshed.messages).toBe(refreshedMessages);
  });
});
