/**
 * @file src/mainview/app/transcript-pipeline.ts
 * @description Transcript pipeline item contract, classification, and virtual row grouping helpers.
 */

import {
  type DiffLineKind,
  type DiffParseResult,
  type DiffSummary,
  parseUnifiedDiffText,
  shouldWorkerizeDiffParsing,
} from "./diff-parsing";
import {
  type DiffParseSnapshot,
  useDiffParseResult,
} from "./diff-parsing-client";
import {
  type PlainTextMessageSegment,
  shouldUseRichMarkdownRenderer,
  splitPlainTextMessage,
} from "./message-markdown-routing";
import { shouldWorkerizeMessagePreprocessing } from "./message-preprocessing";
import {
  describeToolCall,
  formatToolCallTextForDisplay,
  type ToolCallDisplayOptions,
  type ToolCallMessageState,
} from "./tool-call-rendering";
import type { VisibleMessage } from "./visible-message-state";

export type TranscriptPipelineContentKind =
  | "chat"
  | "command"
  | "error"
  | "file_change"
  | "reasoning"
  | "status"
  | "tool_call"
  | "web_search";

export type TranscriptPipelineTextMode =
  | "diff"
  | "markdown-routed"
  | "media"
  | "monospace-output"
  | "status"
  | "tool-summary";

export type TranscriptMarkdownMessageState =
  | "completed"
  | "in_progress"
  | "stopped";

export type TranscriptMarkdownRenderRoute =
  | {
      kind: "plain";
      segments: PlainTextMessageSegment[];
    }
  | {
      kind: "preprocessed";
    }
  | {
      kind: "rich";
      streaming: boolean;
    };

export type { PlainTextMessageSegment };

export type TranscriptPipelineExpansion =
  | {
      mode: "none";
    }
  | {
      defaultExpanded: boolean;
      itemKey: string;
      mode: "optional";
      requestContent: "command_output" | "file_diff" | "tool_output" | null;
    };

export type TranscriptPipelineMediaPayload = {
  byteSize: number;
  kind: "image";
  mimeType: string;
  payloadKey: string;
};

/**
 * Stable item model that the future transcript pipeline should hand to chat
 * surfaces before any renderer-specific component selection occurs.
 */
export type TranscriptPipelineItemModel = {
  contentKind: TranscriptPipelineContentKind;
  deferredContent: boolean;
  expansion: TranscriptPipelineExpansion;
  itemKey: string;
  lifecycle: "completed" | "failed" | "in_progress" | "stopped";
  mediaPayloads: TranscriptPipelineMediaPayload[];
  messageId: number | null;
  rowIdentity: string;
  speaker: "assistant" | "user";
  textMode: TranscriptPipelineTextMode;
};

/**
 * View-model item consumed by transcript surfaces after pure classification and
 * expansion policy have been applied. The source message remains attached for
 * renderers that need payload text, but callers no longer need to recompute
 * expansion, assistant visibility, or copy-affordance policy.
 */
export type TranscriptItemViewModel = {
  expansionState: TranscriptExpansionState;
  isAssistantVisible: boolean;
  isPlainAssistantText: boolean;
  message: VisibleMessage;
  model: TranscriptPipelineItemModel;
};

export type TranscriptItemViewModelsCache = {
  expandedItemIds: ReadonlySet<string>;
  items: TranscriptItemViewModel[];
  messages: VisibleMessage[];
};

export type TranscriptPipelineGroup =
  | {
      kind: "assistant";
      endIndex: number;
      key: string;
      startIndex: number;
    }
  | {
      kind: "user";
      key: string;
      messageIndex: number;
    };

export type GroupedVisibleMessagesCache = {
  activeThreadId: number | null;
  firstMessageKey: string | null;
  groups: TranscriptPipelineGroup[];
  lastMessageKey: string | null;
  messages: VisibleMessage[];
};

export function isTranscriptAssistantVisibleMessage(
  message: VisibleMessage,
): boolean {
  return message.kind !== "chat" || message.speaker === "assistant";
}

export function isPlainAssistantTranscriptTextMessage(
  message: VisibleMessage,
): boolean {
  return (
    message.kind === "chat" &&
    message.speaker === "assistant" &&
    message.tone !== "working" &&
    message.tone !== "error" &&
    message.tone !== "notice"
  );
}

export function splitTranscriptPlainTextMessage(
  text: string,
): PlainTextMessageSegment[] {
  return splitPlainTextMessage(text);
}

export function shouldPrepareTranscriptMarkdownWithWorker(
  text: string,
): boolean {
  return (
    shouldUseRichMarkdownRenderer(text) &&
    shouldWorkerizeMessagePreprocessing(text)
  );
}

/**
 * Resolve markdown/plain/preprocessed rendering before renderer components are
 * selected. This keeps routing and worker-threshold policy in the transcript
 * pipeline while message UI remains responsible only for component composition.
 */
export function routeTranscriptMarkdownText({
  state = "completed",
  text,
}: {
  state?: TranscriptMarkdownMessageState | undefined;
  text: string;
}): TranscriptMarkdownRenderRoute {
  const shouldUseRichRenderer = shouldUseRichMarkdownRenderer(text);

  if (!shouldUseRichRenderer || state === "in_progress") {
    // Streaming rich markdown reparses the full growing string on every chunk.
    // Keep active assistant output on the lightweight text path, then render the
    // completed message with markdown once content stops changing.
    return {
      kind: "plain",
      segments: splitTranscriptPlainTextMessage(text),
    };
  }

  if (shouldWorkerizeMessagePreprocessing(text)) {
    return { kind: "preprocessed" };
  }

  return {
    kind: "rich",
    streaming: false,
  };
}

export type TranscriptToolCallRendering = {
  displayArgumentsText: string;
  displayOutputText: string;
  outputLabel: string;
  preview: string | null;
  renderOutputAsMarkdown: boolean;
  stateLabel: string;
};

export type TranscriptToolCallRenderingInput = {
  argumentsText: string;
  displayOptions: ToolCallDisplayOptions;
  output: string;
  state: ToolCallMessageState;
  tool: string;
};

export function shouldRenderTranscriptToolCallOutputAsMarkdown({
  state,
  tool,
}: {
  state: ToolCallMessageState;
  tool: string;
}): boolean {
  return (
    state !== "failed" && (tool === "sqlite" || tool === "web_server_host")
  );
}

export function transcriptToolCallStateLabel(
  state: ToolCallMessageState,
): string {
  if (state === "in_progress") {
    return "Running";
  }
  if (state === "stopped") {
    return "Stopped";
  }
  if (state === "failed") {
    return "Failed";
  }
  return "Completed";
}

/**
 * Prepare tool-call transcript header and output decisions before the renderer
 * chooses text, markdown, or collapsed-detail components.
 */
export function prepareTranscriptToolCallRendering({
  argumentsText,
  displayOptions,
  output,
  state,
  tool,
}: TranscriptToolCallRenderingInput): TranscriptToolCallRendering {
  const presentation = describeToolCall(
    tool,
    argumentsText,
    state,
    displayOptions,
  );

  return {
    displayArgumentsText: formatToolCallTextForDisplay(
      argumentsText,
      displayOptions,
    ),
    displayOutputText: formatToolCallTextForDisplay(output, displayOptions),
    outputLabel: presentation.outputLabel,
    preview: presentation.preview,
    renderOutputAsMarkdown: shouldRenderTranscriptToolCallOutputAsMarkdown({
      state,
      tool,
    }),
    stateLabel: transcriptToolCallStateLabel(state),
  };
}

export type TranscriptDiffLineKind = DiffLineKind;
export type TranscriptDiffParseSnapshot = DiffParseSnapshot;
export type TranscriptDiffSummary = DiffSummary;

export type TranscriptDiffRendering = {
  hasDiff: boolean;
  hunkLabel: string | null;
  lines: DiffParseResult["lines"];
  parseState: DiffParseSnapshot;
  summary: DiffSummary;
  summaryLabel: string | null;
};

export type TranscriptFileChangeRendering = {
  changeLabel: string;
  diffRegionId: string;
  hasDiff: boolean;
  hunkLabel: string | null;
  stateLabel: string;
  summary: DiffSummary | null;
  summaryLabel: string | null;
};

export function parseTranscriptDiffText(diffText: string): DiffParseResult {
  return parseUnifiedDiffText(diffText);
}

export function shouldWorkerizeTranscriptDiffParsing(
  diffText: string,
): boolean {
  return shouldWorkerizeDiffParsing(diffText);
}

export function useTranscriptDiffParseResult(
  diffText: string,
): DiffParseSnapshot {
  return useDiffParseResult(diffText);
}

export function formatTranscriptDiffHunkLabel(summary: DiffSummary): string {
  return `${summary.hunks} ${summary.hunks === 1 ? "Hunk" : "Hunks"}`;
}

export function formatTranscriptDiffSummaryLabel(summary: DiffSummary): string {
  return `${summary.additions} additions · ${summary.deletions} deletions`;
}

export function prepareTranscriptDiffRendering({
  diffText,
  parsedDiffState,
}: {
  diffText: string;
  parsedDiffState: DiffParseSnapshot;
}): TranscriptDiffRendering {
  const hasDiff = diffText.trim().length > 0;
  const summary = parsedDiffState.result.summary;

  return {
    hasDiff,
    hunkLabel:
      hasDiff && !parsedDiffState.isLoading
        ? formatTranscriptDiffHunkLabel(summary)
        : null,
    lines: parsedDiffState.result.lines,
    parseState: parsedDiffState,
    summary,
    summaryLabel:
      hasDiff && !parsedDiffState.isLoading
        ? formatTranscriptDiffSummaryLabel(summary)
        : null,
  };
}

function transcriptFileChangeLabel(
  changeKind: "add" | "delete" | "update",
): string {
  if (changeKind === "add") {
    return "Added";
  }
  if (changeKind === "delete") {
    return "Deleted";
  }
  return "Updated";
}

function transcriptFileChangeStateLabel({
  changeKind,
  state,
}: {
  changeKind: "add" | "delete" | "update";
  state: "in_progress" | "completed" | "failed" | "stopped";
}): string {
  if (state === "failed") {
    return "Failed";
  }
  if (state === "stopped") {
    return "Stopped";
  }
  if (state === "in_progress") {
    return "Working";
  }
  return transcriptFileChangeLabel(changeKind);
}

function transcriptDomIdFragment(value: string): string {
  return (
    value.replaceAll(/[^a-zA-Z0-9_-]+/g, "-").replaceAll(/^-+|-+$/g, "") ||
    "content"
  );
}

/**
 * Prepare file-change transcript labels, expansion identity, and optional parsed
 * diff summaries without forcing a synchronous parse for collapsed large diffs.
 */
export function prepareTranscriptFileChangeRendering({
  changeKind,
  diffLoaded,
  diffText,
  parsedDiffState,
  path,
  state,
}: {
  changeKind: "add" | "delete" | "update";
  diffLoaded: boolean;
  diffText: string;
  parsedDiffState?: DiffParseSnapshot | undefined;
  path: string;
  state: "in_progress" | "completed" | "failed" | "stopped";
}): TranscriptFileChangeRendering {
  const hasDiff = diffText.trim().length > 0 || !diffLoaded;
  const summary = parsedDiffState?.result.summary ?? null;
  const summaryReady = summary !== null && !parsedDiffState?.isLoading;

  return {
    changeLabel: transcriptFileChangeLabel(changeKind),
    diffRegionId: `file-change-diff-${transcriptDomIdFragment(path)}`,
    hasDiff,
    hunkLabel: summaryReady ? formatTranscriptDiffHunkLabel(summary) : null,
    stateLabel: transcriptFileChangeStateLabel({ changeKind, state }),
    summary,
    summaryLabel: summaryReady
      ? formatTranscriptDiffSummaryLabel(summary)
      : null,
  };
}

function visibleMessageLifecycle(
  message: VisibleMessage,
): TranscriptPipelineItemModel["lifecycle"] {
  if (message.kind === "chat") {
    return message.state ?? "completed";
  }
  return message.state;
}

function visibleMessageSpeaker(message: VisibleMessage): "assistant" | "user" {
  return message.kind === "chat" ? message.speaker : "assistant";
}

function visibleMessageId(message: VisibleMessage): number | null {
  return "messageId" in message ? (message.messageId ?? null) : null;
}

function visibleMessageContentKind(
  message: VisibleMessage,
): TranscriptPipelineContentKind {
  if (message.kind === "chat") {
    return message.tone && message.tone !== "normal" ? "status" : "chat";
  }
  return message.kind;
}

function visibleMessageTextMode(
  message: VisibleMessage,
): TranscriptPipelineTextMode {
  switch (message.kind) {
    case "chat":
    case "reasoning":
      return message.kind === "chat" &&
        message.tone &&
        message.tone !== "normal"
        ? "status"
        : "markdown-routed";
    case "command":
      return "monospace-output";
    case "file_change":
      return "diff";
    case "tool_call":
      return "tool-summary";
    case "web_search":
    case "error":
      return "status";
  }
}

function visibleMessageDeferredContent(message: VisibleMessage): boolean {
  if (message.kind === "command" || message.kind === "tool_call") {
    return !message.outputLoaded;
  }
  if (message.kind === "file_change") {
    return !message.diffLoaded;
  }
  return false;
}

function visibleMessageExpansion(
  message: VisibleMessage,
): TranscriptPipelineExpansion {
  if (message.kind === "command") {
    return {
      defaultExpanded: false,
      itemKey: message.key,
      mode: "optional",
      requestContent: message.outputLoaded ? null : "command_output",
    };
  }
  if (message.kind === "tool_call") {
    return {
      defaultExpanded: message.tool === "web_server_host",
      itemKey: message.key,
      mode: "optional",
      requestContent: message.outputLoaded ? null : "tool_output",
    };
  }
  if (message.kind === "file_change") {
    return {
      defaultExpanded: false,
      itemKey: message.key,
      mode: "optional",
      requestContent: message.diffLoaded ? null : "file_diff",
    };
  }
  return { mode: "none" };
}

function visibleMessageMediaPayloads(
  message: VisibleMessage,
): TranscriptPipelineMediaPayload[] {
  if (message.kind === "chat") {
    return (message.images ?? []).map((image) => ({
      byteSize: image.byteSize,
      kind: "image",
      mimeType: image.mimeType,
      payloadKey: image.payloadKey,
    }));
  }
  if (message.kind === "tool_call") {
    return (message.outputImages ?? []).map((image) => ({
      byteSize: image.byteSize,
      kind: "image",
      mimeType: image.mimeType,
      payloadKey: image.payloadKey,
    }));
  }
  return [];
}

export function classifyTranscriptPipelineItem(
  message: VisibleMessage,
): TranscriptPipelineItemModel {
  return {
    contentKind: visibleMessageContentKind(message),
    deferredContent: visibleMessageDeferredContent(message),
    expansion: visibleMessageExpansion(message),
    itemKey: message.key,
    lifecycle: visibleMessageLifecycle(message),
    mediaPayloads: visibleMessageMediaPayloads(message),
    messageId: visibleMessageId(message),
    rowIdentity: message.key,
    speaker: visibleMessageSpeaker(message),
    textMode: visibleMessageTextMode(message),
  };
}

export type TranscriptExpansionState = {
  expanded: boolean;
  itemKey: string | null;
  messageId: number | null;
  requestContent: "command_output" | "file_diff" | "tool_output" | null;
};

function resolveTranscriptPipelineItemExpansionState(
  item: TranscriptPipelineItemModel,
  expandedItemIds: ReadonlySet<string>,
): TranscriptExpansionState {
  if (item.expansion.mode === "none") {
    return {
      expanded: false,
      itemKey: null,
      messageId: item.messageId,
      requestContent: null,
    };
  }

  const hasExplicitToggle = expandedItemIds.has(item.expansion.itemKey);
  return {
    expanded: item.expansion.defaultExpanded
      ? !hasExplicitToggle
      : hasExplicitToggle,
    itemKey: item.expansion.itemKey,
    messageId: item.messageId,
    requestContent: item.expansion.requestContent,
  };
}

export function resolveTranscriptItemExpansionState(
  message: VisibleMessage,
  expandedItemIds: ReadonlySet<string>,
): TranscriptExpansionState {
  return resolveTranscriptPipelineItemExpansionState(
    classifyTranscriptPipelineItem(message),
    expandedItemIds,
  );
}

/**
 * Build transcript view-model items from visible rows and persisted expansion
 * state. Chat surfaces should render these prepared items instead of repeating
 * classification and expansion decisions at every desktop/mobile call site.
 */
function buildTranscriptItemViewModel(
  message: VisibleMessage,
  expandedItemIds: ReadonlySet<string>,
): TranscriptItemViewModel {
  const item = classifyTranscriptPipelineItem(message);
  return {
    expansionState: resolveTranscriptPipelineItemExpansionState(
      item,
      expandedItemIds,
    ),
    isAssistantVisible: isTranscriptAssistantVisibleMessage(message),
    isPlainAssistantText: isPlainAssistantTranscriptTextMessage(message),
    message,
    model: item,
  };
}

export function deriveTranscriptItemViewModels(
  messages: VisibleMessage[],
  expandedItemIds: ReadonlySet<string>,
  previous: TranscriptItemViewModelsCache | null = null,
): TranscriptItemViewModelsCache {
  if (
    previous &&
    previous.messages === messages &&
    previous.expandedItemIds === expandedItemIds
  ) {
    return previous;
  }

  const canReuseItems = previous?.expandedItemIds === expandedItemIds;
  const reusableItemsByMessage = new Map<
    VisibleMessage,
    TranscriptItemViewModel
  >();
  if (previous && canReuseItems) {
    previous.messages.forEach((message, index) => {
      const item = previous.items[index];
      if (item) {
        reusableItemsByMessage.set(message, item);
      }
    });
  }

  let orderChanged = previous?.messages.length !== messages.length;
  const items = messages.map((message, index) => {
    const reusedItem = canReuseItems
      ? reusableItemsByMessage.get(message)
      : undefined;
    if (reusedItem) {
      if (previous?.items[index] !== reusedItem) {
        orderChanged = true;
      }
      return reusedItem;
    }

    orderChanged = true;
    return buildTranscriptItemViewModel(message, expandedItemIds);
  });

  if (previous && !orderChanged) {
    return previous;
  }

  return {
    expandedItemIds,
    items,
    messages,
  };
}

export function buildTranscriptItemViewModels(
  messages: VisibleMessage[],
  expandedItemIds: ReadonlySet<string>,
): TranscriptItemViewModel[] {
  return deriveTranscriptItemViewModels(messages, expandedItemIds).items;
}

/**
 * Append assistant/user transcript group structure for one contiguous message range.
 */
function appendGroupedVisibleMessages(
  groups: TranscriptPipelineGroup[],
  messages: VisibleMessage[],
  startIndex: number,
): TranscriptPipelineGroup[] {
  const nextGroups = groups.slice();

  for (let index = startIndex; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (isTranscriptAssistantVisibleMessage(message)) {
      const lastGroup = nextGroups.at(-1);
      if (lastGroup?.kind === "assistant" && lastGroup.endIndex === index) {
        nextGroups[nextGroups.length - 1] = {
          ...lastGroup,
          endIndex: index + 1,
        };
        continue;
      }
      nextGroups.push({
        kind: "assistant",
        endIndex: index + 1,
        key: message.key,
        startIndex: index,
      });
      continue;
    }

    nextGroups.push({
      kind: "user",
      key: message.key,
      messageIndex: index,
    });
  }

  return nextGroups;
}

/**
 * Group assistant-visible messages into adjacent assistant-only rows to render as
 * conversational turns; user messages stay as one-row entries.
 */
function groupVisibleMessages(
  messages: VisibleMessage[],
): TranscriptPipelineGroup[] {
  return appendGroupedVisibleMessages([], messages, 0);
}

/**
 * Derives grouped visible messages for transcript virtualization.
 * @param activeThreadId - activeThreadId identifier.
 * @param messages - Message list.
 * @param previousCache - previousCache argument for deriveGroupedVisibleMessages.
 */
export function deriveGroupedVisibleMessages(
  activeThreadId: number | null,
  messages: VisibleMessage[],
  previousCache: GroupedVisibleMessagesCache | null,
): GroupedVisibleMessagesCache {
  const firstMessageKey = messages[0]?.key ?? null;
  const lastMessageKey = messages.at(-1)?.key ?? null;

  if (
    previousCache &&
    previousCache.activeThreadId === activeThreadId &&
    previousCache.messages === messages
  ) {
    return previousCache;
  }

  if (
    previousCache &&
    previousCache.activeThreadId === activeThreadId &&
    previousCache.messages.length === messages.length &&
    previousCache.firstMessageKey === firstMessageKey &&
    previousCache.lastMessageKey === lastMessageKey
  ) {
    // Group boundaries only depend on message ordering and assistant/user classification.
    return {
      ...previousCache,
      messages,
    };
  }

  if (
    previousCache &&
    previousCache.activeThreadId === activeThreadId &&
    previousCache.messages.length > 0 &&
    previousCache.messages.length < messages.length &&
    previousCache.firstMessageKey === firstMessageKey &&
    messages[previousCache.messages.length - 1]?.key ===
      previousCache.lastMessageKey
  ) {
    return {
      activeThreadId,
      firstMessageKey,
      groups: appendGroupedVisibleMessages(
        previousCache.groups,
        messages,
        previousCache.messages.length,
      ),
      lastMessageKey,
      messages,
    };
  }

  return {
    activeThreadId,
    firstMessageKey,
    groups: groupVisibleMessages(messages),
    lastMessageKey,
    messages,
  };
}
