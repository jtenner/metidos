/**
 * @file src/mainview/app/chat-workspace.tsx
 * @description Module for chat workspace.
 */

import {
  measureElement as defaultMeasureElement,
  type ReactVirtualizerOptions,
  useVirtualizer,
  type Virtualizer,
} from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type FormEvent,
  type JSX,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  RpcModelOption,
  RpcReasoningEffort,
  RpcReasoningEffortOption,
} from "../../bun/rpc-schema";
import { brandLogoIcon } from "../controls/brand-logo";
import { ContextUsageMeter } from "../controls/ContextUsageMeter";
import { ChatComposerControl } from "../controls/chat-composer-control";
import { CodexModelSelector } from "../controls/codex-model-selector";
import { materialSymbol } from "../controls/icons";
import {
  ThreadAccessControl,
  type ThreadAccessValue,
} from "../controls/thread-access-control";
import type { ThreadExtensionUiWidget } from "../thread-extension-ui";
import {
  ChatErrorMessage,
  ChatNoticeMessage,
  CommandExecutionMessage,
  ErrorItemMessage,
  FileChangeMessage,
  isAssistantVisibleMessage,
  isPlainAssistantTextMessage,
  MarkdownMessage,
  ProcessingMessage,
  ReasoningMessage,
  ToolCallMessage,
  WebSearchMessage,
} from "./message-ui";
import { APP_TITLE, type VisibleMessage } from "./state";

type SharedChatControlsProps = {
  activeCodexModel: string;
  activeReasoningEffort: RpcReasoningEffort;
  composerActionDisabled: boolean;
  composerActionLabel: string;
  composerDisabled: boolean;
  hasSelectedThread: boolean;
  initialChatInput: string;
  isWorking: boolean;
  modelControlError: string;
  modelSelectorDisabled: boolean;
  onChangeModel: (value: string) => void;
  onChangeReasoningEffort: (value: RpcReasoningEffort) => void;
  onChangeThreadAccess: (value: ThreadAccessValue) => void;
  onComposerDraftChange?: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitMessage: () => void;
  reasoningEffortControlError: string;
  reasoningEffortSelectorDisabled: boolean;
  reasoningEfforts: RpcReasoningEffortOption[];
  threadAccessControlError: string;
  threadAccessControlDisabled: boolean;
  threadAccessValue: ThreadAccessValue;
  codexModels: RpcModelOption[];
  extensionHiddenThinkingLabel: string | null;
  extensionStatusEntries: Array<{
    key: string;
    text: string;
  }>;
  extensionWidgetsAbove: ThreadExtensionUiWidget[];
  extensionWidgetsBelow: ThreadExtensionUiWidget[];
};

type TranscriptMessageGroup =
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

type GroupedVisibleMessagesCache = {
  activeThreadId: number | null;
  firstMessageKey: string | null;
  groups: TranscriptMessageGroup[];
  lastMessageKey: string | null;
  messages: VisibleMessage[];
};

type TranscriptMeasurementRow = {
  cacheKey: string;
  contentKey: string;
  estimatedSize: number;
};

type TranscriptMeasurementCacheEntry = {
  contentKey: string;
  size: number;
};

type ChatVirtualizerOptions = ReactVirtualizerOptions<
  HTMLDivElement,
  HTMLDivElement
> & {
  shouldAdjustScrollPositionOnItemSizeChange?: (item: {
    index: number;
  }) => boolean;
};

/**
 * Shared props for both desktop and mobile chat views.
 */
type TranscriptProps = {
  activeThreadId: number | null;
  expandedItemIds: ReadonlySet<string>;
  extensionHiddenThinkingLabel: string | null;
  localUserLabel: string;
  messages: VisibleMessage[];
  onToggleItemExpanded: (messageKey: string) => void;
  paddingEndPx: number;
  paddingStartPx: number;
  scrollContainerClassName: string;
  scrollContainerStyle?: CSSProperties;
  topContent?: JSX.Element | null;
  variant: "desktop" | "mobile";
};

/** Renders the content portion for a single assistant-visible message. */
type AssistantMessageRenderer = (message: VisibleMessage) => JSX.Element;

/**
 * Properties needed to render one grouped row in the transcript.
 */
type GroupRowProps = {
  group: TranscriptMessageGroup;
  isLast: boolean;
  localUserLabel: string;
  messages: VisibleMessage[];
  renderAssistantMessageContent: AssistantMessageRenderer;
};

type UnsafeModePopoverVisibilityOptions = {
  checked: boolean;
  isAnchorFocused: boolean;
  isAnchorHovered: boolean;
};

const CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 24;
const DESKTOP_CHAT_PADDING_PX = 32;
const DESKTOP_CHAT_TRANSCRIPT_ESTIMATE_PX = 168;
const DESKTOP_CHAT_TRANSCRIPT_GAP_PX = 40;
const DESKTOP_CHAT_TRANSCRIPT_OVERSCAN = 6;
const MOBILE_CHAT_TRANSCRIPT_ESTIMATE_PX = 128;
const MOBILE_CHAT_TRANSCRIPT_OVERSCAN = 5;

export function shouldRenderUnsafeModePopover({
  checked,
  isAnchorFocused,
  isAnchorHovered,
}: UnsafeModePopoverVisibilityOptions): boolean {
  return checked && (isAnchorFocused || isAnchorHovered);
}

/**
 * Checks whether the transcript viewport is effectively pinned to the bottom.
 * @param container - Scroll container for the chat transcript.
 */
export function isChatTranscriptAtBottom(
  container: Pick<
    HTMLDivElement,
    "clientHeight" | "scrollHeight" | "scrollTop"
  >,
): boolean {
  return (
    Math.max(
      container.scrollHeight - container.scrollTop - container.clientHeight,
      0,
    ) <= CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD_PX
  );
}

/**
 * Performs hashMeasurementText operation.
 * @param text - Input text content.
 */
function hashMeasurementText(text: string): string {
  let hash = 5381;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}

/**
 * Performs visibleMessageMeasurementFingerprint operation.
 * @param message - Message payload.
 * @param expanded - Whether the section is expanded.
 */
function visibleMessageMeasurementFingerprint(
  message: VisibleMessage,
  expanded: boolean,
): string {
  if (message.kind === "chat") {
    return [
      message.kind,
      message.speaker,
      message.tone ?? "normal",
      message.text.length,
      hashMeasurementText(message.text),
    ].join(":");
  }

  if (message.kind === "reasoning" || message.kind === "error") {
    return [
      message.kind,
      message.state,
      message.text.length,
      hashMeasurementText(message.text),
    ].join(":");
  }

  if (message.kind === "command") {
    return [
      message.kind,
      message.state,
      message.exitCode ?? "none",
      expanded ? "expanded" : "collapsed",
      message.command.length,
      hashMeasurementText(message.command),
      message.output.length,
      hashMeasurementText(message.output),
    ].join(":");
  }

  if (message.kind === "tool_call") {
    return [
      message.kind,
      message.state,
      expanded ? "expanded" : "collapsed",
      message.server,
      message.tool,
      message.argumentsText.length,
      hashMeasurementText(message.argumentsText),
      message.output.length,
      hashMeasurementText(message.output),
    ].join(":");
  }

  if (message.kind === "web_search") {
    return [
      message.kind,
      message.state,
      message.query.length,
      hashMeasurementText(message.query),
    ].join(":");
  }

  return [
    message.kind,
    message.state,
    message.changeKind,
    expanded ? "expanded" : "collapsed",
    message.path.length,
    hashMeasurementText(message.path),
    message.diffText.length,
    hashMeasurementText(message.diffText),
  ].join(":");
}

/**
 * Derives transcript measurement rows.
 * @param activeThreadId - activeThreadId identifier.
 * @param expandedItemIds - expandedItemIds argument for deriveTranscriptMeasurementRows.
 * @param groupedMessages - groupedMessages argument for deriveTranscriptMeasurementRows.
 * @param hasTopContent - hasTopContent argument for deriveTranscriptMeasurementRows.
 * @param messages - Message list.
 * @param variant - variant argument for deriveTranscriptMeasurementRows.
 */
export function deriveTranscriptMeasurementRows({
  activeThreadId,
  expandedItemIds,
  groupedMessages,
  hasTopContent,
  messages,
  variant,
}: {
  activeThreadId: number | null;
  expandedItemIds: ReadonlySet<string>;
  groupedMessages: TranscriptMessageGroup[];
  hasTopContent: boolean;
  messages: VisibleMessage[];
  variant: "desktop" | "mobile";
}): TranscriptMeasurementRow[] {
  const rows: TranscriptMeasurementRow[] = [];
  const threadKey = activeThreadId ?? "none";

  if (hasTopContent) {
    rows.push({
      cacheKey: `chat-header:${threadKey}:${variant}`,
      contentKey: `chat-header:${threadKey}:${variant}`,
      estimatedSize: 140,
    });
  }

  for (const group of groupedMessages) {
    if (group.kind === "assistant") {
      const contentKey = Array.from(
        { length: group.endIndex - group.startIndex },
        (_, offset) => messages[group.startIndex + offset],
      )
        .filter((message): message is VisibleMessage => message !== undefined)
        .map((message) =>
          visibleMessageMeasurementFingerprint(
            message,
            expandedItemIds.has(message.key),
          ),
        )
        .join("|");

      rows.push({
        cacheKey: `chat-group:${threadKey}:${group.key}`,
        contentKey,
        estimatedSize:
          variant === "desktop"
            ? DESKTOP_CHAT_TRANSCRIPT_ESTIMATE_PX
            : MOBILE_CHAT_TRANSCRIPT_ESTIMATE_PX,
      });
      continue;
    }

    const message = messages[group.messageIndex];
    rows.push({
      cacheKey: `chat-group:${threadKey}:${group.key}`,
      contentKey: message
        ? visibleMessageMeasurementFingerprint(
            message,
            expandedItemIds.has(message.key),
          )
        : "missing",
      estimatedSize:
        variant === "desktop"
          ? DESKTOP_CHAT_TRANSCRIPT_ESTIMATE_PX
          : MOBILE_CHAT_TRANSCRIPT_ESTIMATE_PX,
    });
  }

  return rows;
}

/**
 * Append assistant/user transcript group structure for one contiguous message range.
 */
function appendGroupedVisibleMessages(
  groups: TranscriptMessageGroup[],
  messages: VisibleMessage[],
  startIndex: number,
): TranscriptMessageGroup[] {
  const nextGroups = groups.slice();

  for (let index = startIndex; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (isAssistantVisibleMessage(message)) {
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
): TranscriptMessageGroup[] {
  return appendGroupedVisibleMessages([], messages, 0);
}

/**
 * Derives grouped visible messages.
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

/**
 * Reads user group text.
 * @param group - group argument for readUserGroupText.
 * @param messages - Message list.
 */
function readUserGroupText(
  group: Extract<TranscriptMessageGroup, { kind: "user" }>,
  messages: VisibleMessage[],
): string {
  const message = messages[group.messageIndex];
  return message?.kind === "chat" ? message.text : "";
}

/**
 * Performs areGroupRowPropsEqual operation.
 * @param previous - previous argument for areGroupRowPropsEqual.
 * @param next - next argument for areGroupRowPropsEqual.
 */
function areGroupRowPropsEqual(
  previous: Readonly<GroupRowProps>,
  next: Readonly<GroupRowProps>,
): boolean {
  if (
    previous.group.kind !== next.group.kind ||
    previous.isLast !== next.isLast ||
    previous.localUserLabel !== next.localUserLabel ||
    previous.renderAssistantMessageContent !==
      next.renderAssistantMessageContent
  ) {
    return false;
  }

  if (previous.group.kind === "assistant" && next.group.kind === "assistant") {
    if (
      previous.group.startIndex !== next.group.startIndex ||
      previous.group.endIndex !== next.group.endIndex ||
      previous.group.key !== next.group.key
    ) {
      return false;
    }

    for (
      let index = previous.group.startIndex;
      index < previous.group.endIndex;
      index += 1
    ) {
      if (previous.messages[index] !== next.messages[index]) {
        return false;
      }
    }

    return true;
  }

  if (previous.group.kind === "user" && next.group.kind === "user") {
    return (
      previous.group.messageIndex === next.group.messageIndex &&
      previous.group.key === next.group.key &&
      previous.messages[previous.group.messageIndex] ===
        next.messages[next.group.messageIndex]
    );
  }

  return false;
}

const DesktopTranscriptGroupRow = memo(function DesktopTranscriptGroupRow({
  group,
  isLast,
  localUserLabel,
  messages,
  renderAssistantMessageContent,
}: GroupRowProps): JSX.Element {
  // Desktop rows separate assistant and user turns into distinct alignment/typography paths.
  return (
    <div
      className="mx-auto w-full max-w-4xl min-w-0"
      style={{
        paddingBottom: isLast ? 0 : `${DESKTOP_CHAT_TRANSCRIPT_GAP_PX}px`,
      }}
    >
      {group.kind === "assistant" ? (
        <div className="group flex w-full min-w-0 items-start gap-6">
          <div className="mt-0.5 flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-[#10161d]">
            {brandLogoIcon("h-full w-full")}
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <div className="font-label text-[10px] font-bold uppercase tracking-widest text-[#bdd5e6]">
              {APP_TITLE}
            </div>
            <div className="space-y-3">
              {Array.from(
                { length: group.endIndex - group.startIndex },
                (_, offset) => messages[group.startIndex + offset],
              ).map((message) =>
                message ? (
                  <div
                    className={`min-w-0 ${
                      isPlainAssistantTextMessage(message) ? "py-3" : ""
                    }`}
                    key={message.key}
                  >
                    <div className="space-y-2">
                      <div className="min-w-0 max-w-full text-sm leading-relaxed text-[#ffffff]">
                        {renderAssistantMessageContent(message)}
                      </div>
                      {isPlainAssistantTextMessage(message) ? (
                        <AssistantMessageCopyButton
                          text={message.kind === "chat" ? message.text : ""}
                        />
                      ) : null}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex w-full min-w-0 justify-end gap-6">
          <div className="min-w-0 w-full max-w-2xl space-y-3 text-right">
            <div className="font-body text-[13px] font-semibold tracking-[0.01em] text-[#b7b3b1]">
              {localUserLabel}
            </div>
            <div className="ml-auto max-w-full overflow-hidden rounded-sm bg-[#262626] p-4 text-left text-sm text-[#ffffff]">
              <MarkdownMessage text={readUserGroupText(group, messages)} />
            </div>
          </div>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[#262626]">
            {materialSymbol("person")}
          </div>
        </div>
      )}
    </div>
  );
}, areGroupRowPropsEqual);

const MobileTranscriptGroupRow = memo(function MobileTranscriptGroupRow({
  group,
  isLast,
  localUserLabel,
  messages,
  renderAssistantMessageContent,
}: GroupRowProps): JSX.Element {
  // Mobile keeps cards narrower with larger spacing tuned for touch and small screens.
  return (
    <div
      className="w-full"
      style={{ paddingBottom: isLast ? 0 : `${MOBILE_CHAT_ITEM_GAP_PX}px` }}
    >
      {group.kind === "assistant" ? (
        <div className="flex w-full max-w-full flex-col items-start gap-1.5">
          <div className="flex items-center gap-2 px-[2px] text-[#bdd5e6]">
            {brandLogoIcon("h-4 w-4")}
            <span className="text-[10px] font-label font-bold uppercase tracking-wider">
              {APP_TITLE}
            </span>
          </div>
          <div
            className="flex w-full flex-col"
            style={{ gap: `${MOBILE_CHAT_ITEM_GAP_PX}px` }}
          >
            {Array.from(
              { length: group.endIndex - group.startIndex },
              (_, offset) => messages[group.startIndex + offset],
            ).map((message) => {
              if (!message) {
                return null;
              }

              if (isPlainAssistantTextMessage(message)) {
                return (
                  <div
                    className="w-full bg-[#262a2d] px-[10px] py-[10px]"
                    key={message.key}
                  >
                    <div className="space-y-2">
                      <div className="text-sm leading-relaxed text-[#ffffff]">
                        {renderAssistantMessageContent(message)}
                      </div>
                      <AssistantMessageCopyButton
                        text={message.kind === "chat" ? message.text : ""}
                      />
                    </div>
                  </div>
                );
              }

              return (
                <div className="w-full" key={message.key}>
                  {renderAssistantMessageContent(message)}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex w-full justify-end">
          <div className="flex max-w-[92%] flex-col items-end gap-1.5">
            <div className="flex items-center gap-2 px-[2px] text-[#b7b3b1]">
              <span className="font-body text-[13px] font-semibold tracking-[0.01em]">
                {localUserLabel}
              </span>
              {materialSymbol("account_circle", "text-sm text-[#9f9b99]")}
            </div>
            <div className="w-fit max-w-full bg-[#30353a] px-[10px] py-[10px] text-sm leading-relaxed text-[#ffffff] shadow-sm">
              <MarkdownMessage text={readUserGroupText(group, messages)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}, areGroupRowPropsEqual);

function AssistantMessageCopyButton({ text }: { text: string }): JSX.Element {
  const [showCopied, setShowCopied] = useState(false);
  const [isCopyPopoverFading, setIsCopyPopoverFading] = useState(false);
  const hideCopiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const fadeCopiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const clearCopyStateTimeouts = useCallback((): void => {
    if (hideCopiedTimeoutRef.current !== null) {
      clearTimeout(hideCopiedTimeoutRef.current);
      hideCopiedTimeoutRef.current = null;
    }
    if (fadeCopiedTimeoutRef.current !== null) {
      clearTimeout(fadeCopiedTimeoutRef.current);
      fadeCopiedTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearCopyStateTimeouts();
    };
  }, [clearCopyStateTimeouts]);

  const payload = text.trim();

  const onCopy = (): void => {
    if (!payload) {
      return;
    }
    copyTextToClipboard(payload);
    clearCopyStateTimeouts();
    setIsCopyPopoverFading(false);
    setShowCopied(true);
    hideCopiedTimeoutRef.current = setTimeout(() => {
      setIsCopyPopoverFading(true);
    }, 1400);
    fadeCopiedTimeoutRef.current = setTimeout(() => {
      setShowCopied(false);
      setIsCopyPopoverFading(false);
    }, 1845);
  };

  return (
    <div className="relative inline-flex items-center">
      <button
        aria-label="Copy assistant message"
        className="inline-flex items-center gap-1 rounded border border-[#2f3d45] bg-[#11161b] px-2 py-1 text-[10px] font-medium tracking-wide text-[#98b3c7] transition-colors hover:border-[#4c606f] hover:bg-[#1c2730] hover:text-[#c7d7e2]"
        onClick={onCopy}
        title="Copy this message"
        type="button"
      >
        {materialSymbol("description", "text-[12px] leading-none")}
        <span>Copy</span>
      </button>
      {showCopied ? (
        <span
          className={`pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 rounded border border-[#2f3d45] bg-[#11161b] px-2 py-1 text-[10px] whitespace-nowrap text-[#9fd0f2] transition-opacity duration-450 ${
            isCopyPopoverFading ? "opacity-0" : "opacity-100"
          }`}
        >
          Message copied.
        </span>
      ) : null}
    </div>
  );
}

function copyTextToClipboard(text: string): void {
  const payload = text.trim();
  if (!payload) {
    return;
  }

  const fallbackCopy = (): boolean => {
    if (typeof document === "undefined") {
      return false;
    }
    const textarea = document.createElement("textarea");
    textarea.value = payload;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  };

  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    navigator.clipboard.writeText
  ) {
    void navigator.clipboard.writeText(payload).catch(() => {
      fallbackCopy();
    });
    return;
  }

  fallbackCopy();
}

function ExtensionStatusPills({
  entries,
}: {
  entries: Array<{
    key: string;
    text: string;
  }>;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {entries.map((entry) => (
        <div
          className="border border-[#2f3b43] bg-[#182026] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[#bcd1df]"
          key={entry.key}
        >
          <span className="text-[#7f9aab]">{entry.key}</span>
          <span className="mx-1 text-[#50616d]">/</span>
          <span className="text-[#e5edf3]">{entry.text}</span>
        </div>
      ))}
    </div>
  );
}

function ExtensionWidgetStack({
  widgets,
}: {
  widgets: ThreadExtensionUiWidget[];
}): JSX.Element {
  return (
    <div className="mb-3 space-y-2">
      {widgets.map((widget) => (
        <div
          className="border border-[#2e3941] bg-[#141a1d] px-3 py-3 text-sm text-[#d6e7f2]"
          key={widget.key}
        >
          <div className="mb-2 font-label text-[10px] uppercase tracking-[0.16em] text-[#8fb5cd]">
            {widget.key}
          </div>
          <div className="space-y-1">
            {widget.lines.map((line) => (
              <div key={`${widget.key}:${line}`}>{line}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const ChatTranscript = memo(function ChatTranscript({
  activeThreadId,
  expandedItemIds,
  extensionHiddenThinkingLabel,
  localUserLabel,
  messages,
  onToggleItemExpanded,
  paddingEndPx,
  paddingStartPx,
  scrollContainerClassName,
  scrollContainerStyle,
  topContent = null,
  variant,
}: TranscriptProps): JSX.Element {
  /**
   * Manages virtualized transcript rendering with optional header content while
   * keeping scroll-position and grouping logic local to the message stream.
   */
  // Memoize grouped rows so expensive message mapping is not repeated across renders.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);
  const previousThreadIdRef = useRef<number | null>(activeThreadId);
  const groupedMessagesCacheRef = useRef<GroupedVisibleMessagesCache | null>(
    null,
  );
  const autoScrollResetRafRef = useRef<number | null>(null);
  const isAutoScrollingRef = useRef(false);
  const groupedMessagesCache = deriveGroupedVisibleMessages(
    activeThreadId,
    messages,
    groupedMessagesCacheRef.current,
  );
  groupedMessagesCacheRef.current = groupedMessagesCache;
  const groupedMessages = groupedMessagesCache.groups;
  const hasTopContent = topContent !== null;
  const rowCount = groupedMessages.length + (hasTopContent ? 1 : 0);
  const transcriptMeasurementRows = useMemo(
    () =>
      deriveTranscriptMeasurementRows({
        activeThreadId,
        expandedItemIds,
        groupedMessages,
        hasTopContent,
        messages,
        variant,
      }),
    [
      activeThreadId,
      expandedItemIds,
      groupedMessages,
      hasTopContent,
      messages,
      variant,
    ],
  );
  const transcriptMeasurementCacheRef = useRef<
    Map<string, TranscriptMeasurementCacheEntry>
  >(new Map());

  useEffect(() => {
    const validCacheKeys = new Set(
      transcriptMeasurementRows.map((row) => row.cacheKey),
    );
    for (const cacheKey of transcriptMeasurementCacheRef.current.keys()) {
      if (!validCacheKeys.has(cacheKey)) {
        transcriptMeasurementCacheRef.current.delete(cacheKey);
      }
    }
  }, [transcriptMeasurementRows]);

  const renderAssistantMessageContent = useCallback(
    (message: VisibleMessage): JSX.Element => {
      if (message.kind === "chat") {
        if (message.tone === "working") {
          return <ProcessingMessage />;
        }
        if (message.tone === "error") {
          return <ChatErrorMessage text={message.text} />;
        }
        if (message.tone === "notice") {
          return <ChatNoticeMessage text={message.text} />;
        }
        return <MarkdownMessage text={message.text} />;
      }
      if (message.kind === "reasoning") {
        return (
          <ReasoningMessage
            label={extensionHiddenThinkingLabel ?? "Thinking"}
            text={message.text}
          />
        );
      }
      if (message.kind === "command") {
        return (
          <CommandExecutionMessage
            command={message.command}
            exitCode={message.exitCode}
            expanded={expandedItemIds.has(message.key)}
            onToggleExpanded={() => {
              onToggleItemExpanded(message.key);
            }}
            output={message.output}
            state={message.state}
          />
        );
      }
      if (message.kind === "tool_call") {
        return (
          <ToolCallMessage
            argumentsText={message.argumentsText}
            expanded={expandedItemIds.has(message.key)}
            messageKey={message.key}
            onToggleExpanded={() => {
              onToggleItemExpanded(message.key);
            }}
            output={message.output}
            server={message.server}
            state={message.state}
            tool={message.tool}
          />
        );
      }
      if (message.kind === "web_search") {
        return <WebSearchMessage query={message.query} state={message.state} />;
      }
      if (message.kind === "error") {
        return <ErrorItemMessage state={message.state} text={message.text} />;
      }
      return (
        <FileChangeMessage
          changeKind={message.changeKind}
          diffText={message.diffText}
          expanded={expandedItemIds.has(message.key)}
          onToggleExpanded={() => {
            onToggleItemExpanded(message.key);
          }}
          path={message.path}
          state={message.state}
        />
      );
    },
    [expandedItemIds, extensionHiddenThinkingLabel, onToggleItemExpanded],
  );

  const measureTranscriptRowElement = useCallback(
    (
      element: HTMLDivElement,
      entry: ResizeObserverEntry | undefined,
      instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
    ): number => {
      const index = Number(element.dataset.index ?? "-1");
      const row = transcriptMeasurementRows[index];
      if (!row) {
        return defaultMeasureElement(element, entry, instance);
      }

      const cached = transcriptMeasurementCacheRef.current.get(row.cacheKey);
      if (
        entry === undefined &&
        cached &&
        cached.contentKey === row.contentKey
      ) {
        return cached.size;
      }

      const size = defaultMeasureElement(element, entry, instance);
      transcriptMeasurementCacheRef.current.set(row.cacheKey, {
        contentKey: row.contentKey,
        size,
      });
      return size;
    },
    [transcriptMeasurementRows],
  );

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rowCount,
    estimateSize: (index) => {
      const row = transcriptMeasurementRows[index];
      if (!row) {
        return variant === "desktop"
          ? DESKTOP_CHAT_TRANSCRIPT_ESTIMATE_PX
          : MOBILE_CHAT_TRANSCRIPT_ESTIMATE_PX;
      }

      const cached = transcriptMeasurementCacheRef.current.get(row.cacheKey);
      if (cached && cached.contentKey === row.contentKey) {
        return cached.size;
      }

      return row.estimatedSize;
    },
    getItemKey: (index) => {
      return transcriptMeasurementRows[index]?.cacheKey ?? index;
    },
    getScrollElement: () => scrollRef.current,
    measureElement: measureTranscriptRowElement,
    overscan:
      variant === "desktop"
        ? DESKTOP_CHAT_TRANSCRIPT_OVERSCAN
        : MOBILE_CHAT_TRANSCRIPT_OVERSCAN,
    shouldAdjustScrollPositionOnItemSizeChange: (item: { index: number }) => {
      if (!pinnedToBottomRef.current) {
        return false;
      }
      return item.index === rowCount - 1;
    },
    paddingEnd: paddingEndPx,
    paddingStart: paddingStartPx,
    scrollPaddingEnd: paddingEndPx,
    scrollPaddingStart: paddingStartPx,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
  } as ChatVirtualizerOptions);

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const updatePinnedToBottom = useCallback(
    (container: HTMLDivElement): void => {
      if (isAutoScrollingRef.current) {
        return;
      }

      // Update auto-scroll state only when transcript is near bottom; avoids fighting
      // manual user scrolling while new messages stream in.
      pinnedToBottomRef.current = isChatTranscriptAtBottom(container);
    },
    [],
  );

  const scrollToBottom = useCallback((): void => {
    const container = scrollRef.current;
    if (!container || rowCount <= 0) {
      return;
    }
    if (autoScrollResetRafRef.current !== null) {
      window.cancelAnimationFrame(autoScrollResetRafRef.current);
    }

    isAutoScrollingRef.current = true;
    container.scrollTop = container.scrollHeight;
    autoScrollResetRafRef.current = window.requestAnimationFrame(() => {
      isAutoScrollingRef.current = false;
      autoScrollResetRafRef.current = null;
    });
  }, [rowCount]);

  useEffect(() => {
    return () => {
      if (autoScrollResetRafRef.current !== null) {
        window.cancelAnimationFrame(autoScrollResetRafRef.current);
        autoScrollResetRafRef.current = null;
      }
      isAutoScrollingRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    // On thread change, force pin-to-bottom behavior so new thread opens scrolled to latest.
    const threadChanged = previousThreadIdRef.current !== activeThreadId;
    if (threadChanged) {
      pinnedToBottomRef.current = true;
      previousThreadIdRef.current = activeThreadId;
    }
    if (pinnedToBottomRef.current) {
      scrollToBottom();
    }
  }, [activeThreadId, scrollToBottom]);

  return (
    <div
      className={scrollContainerClassName}
      onScroll={(event) => {
        updatePinnedToBottom(event.currentTarget);
      }}
      ref={scrollRef}
      style={{
        ...scrollContainerStyle,
        overflowAnchor: "none",
        scrollPaddingBottom: `${paddingEndPx}px`,
        scrollPaddingTop: `${paddingStartPx}px`,
      }}
    >
      <div
        className="relative w-full"
        style={{
          height: `${totalSize}px`,
        }}
      >
        {virtualRows.map((virtualRow) => {
          const isHeaderRow = hasTopContent && virtualRow.index === 0;
          const group = isHeaderRow
            ? null
            : groupedMessages[virtualRow.index - (hasTopContent ? 1 : 0)];
          const isLastGroup = virtualRow.index === rowCount - 1;

          return (
            <div
              className="absolute left-0 top-0 w-full"
              data-index={virtualRow.index}
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              style={{
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {/* Map virtual rows either to header content or assistant/user group component. */}
              {isHeaderRow ? (
                topContent
              ) : group ? (
                variant === "desktop" ? (
                  <DesktopTranscriptGroupRow
                    group={group}
                    isLast={isLastGroup}
                    localUserLabel={localUserLabel}
                    messages={messages}
                    renderAssistantMessageContent={
                      renderAssistantMessageContent
                    }
                  />
                ) : (
                  <MobileTranscriptGroupRow
                    group={group}
                    isLast={isLastGroup}
                    localUserLabel={localUserLabel}
                    messages={messages}
                    renderAssistantMessageContent={
                      renderAssistantMessageContent
                    }
                  />
                )
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
});

type DesktopChatViewProps = SharedChatControlsProps & {
  activeContextInputTokens: number;
  activeContextWindowTokens: number;
  activeScreenSubtitlePrimary: string;
  activeScreenSubtitleSecondary: string;
  activeScreenTitle: string;
  activeThreadId: number | null;
  expandedItemIds: ReadonlySet<string>;
  localUserLabel: string;
  onToggleItemExpanded: (messageKey: string) => void;
  selectedThreadIsWorking: boolean;
};

/**
 * Main desktop chat experience: transcript, model/reasoning controls, and composer.
 */
export function DesktopChatView({
  activeCodexModel,
  activeContextInputTokens,
  activeContextWindowTokens,
  activeReasoningEffort,
  activeScreenSubtitlePrimary,
  activeScreenSubtitleSecondary,
  activeScreenTitle,
  activeThreadId,
  codexModels,
  composerActionDisabled,
  composerActionLabel,
  composerDisabled,
  extensionHiddenThinkingLabel,
  extensionStatusEntries,
  extensionWidgetsAbove,
  extensionWidgetsBelow,
  expandedItemIds,
  hasSelectedThread,
  initialChatInput,
  isWorking,
  localUserLabel,
  messages,
  modelControlError,
  modelSelectorDisabled,
  onChangeModel,
  onChangeReasoningEffort,
  onChangeThreadAccess,
  onComposerDraftChange,
  onSubmit,
  onSubmitMessage,
  onToggleItemExpanded,
  reasoningEffortControlError,
  reasoningEffortSelectorDisabled,
  reasoningEfforts,
  selectedThreadIsWorking,
  threadAccessControlError,
  threadAccessControlDisabled,
  threadAccessValue,
}: DesktopChatViewProps & { messages: VisibleMessage[] }): JSX.Element {
  // Header is passed as topContent into virtualized transcript for stable positioning.
  const headerContent = (
    <div className="mx-auto w-full max-w-4xl pb-12">
      <h1 className="mb-2 font-headline text-4xl font-extrabold tracking-tight text-[#ffffff]">
        {activeScreenTitle}
      </h1>
      <p className="max-w-2xl font-body text-sm text-[#b3afad]">
        <span className="text-[#ddd8d5]">{activeScreenSubtitlePrimary}</span>
        <span className="text-[#7f7c79]">
          {" "}
          | {activeScreenSubtitleSecondary}
        </span>
      </p>
    </div>
  );

  return (
    <>
      <ChatTranscript
        activeThreadId={activeThreadId}
        expandedItemIds={expandedItemIds}
        extensionHiddenThinkingLabel={extensionHiddenThinkingLabel}
        localUserLabel={localUserLabel}
        messages={messages}
        onToggleItemExpanded={onToggleItemExpanded}
        paddingEndPx={DESKTOP_CHAT_PADDING_PX}
        paddingStartPx={DESKTOP_CHAT_PADDING_PX}
        scrollContainerClassName="app-scrollbar flex-1 overflow-y-auto px-6"
        topContent={headerContent}
        variant="desktop"
      />
      <form
        className="border-t border-[#262626] bg-[#131313] p-6"
        onSubmit={onSubmit}
      >
        <div className="mx-auto max-w-4xl">
          {extensionWidgetsAbove.length > 0 ? (
            <ExtensionWidgetStack widgets={extensionWidgetsAbove} />
          ) : null}
          <div className="flex items-center gap-2 border-b border-[#484848]/10 p-2">
            <div className="min-w-[20rem] max-w-[28rem]">
              <CodexModelSelector
                models={codexModels}
                value={activeCodexModel}
                disabled={modelSelectorDisabled}
                onChange={onChangeModel}
                onChangeReasoningEffort={onChangeReasoningEffort}
                reasoningDisabled={reasoningEffortSelectorDisabled}
                reasoningOptions={reasoningEfforts}
                reasoningValue={activeReasoningEffort}
                variant="desktop"
              />
            </div>
            <ThreadAccessControl
              disabled={threadAccessControlDisabled}
              onChange={onChangeThreadAccess}
              value={threadAccessValue}
              variant="desktop"
            />
            {extensionStatusEntries.length > 0 ? (
              <ExtensionStatusPills entries={extensionStatusEntries} />
            ) : null}
            <div className="flex-1" />
            <ContextUsageMeter
              inputTokens={activeContextInputTokens}
              contextWindowTokens={activeContextWindowTokens}
            />
          </div>
          {modelControlError ? (
            <div className="mt-2 text-xs text-[#ff6e84]">
              {modelControlError}
            </div>
          ) : null}
          {reasoningEffortControlError ? (
            <div className="mt-2 text-xs text-[#ff6e84]">
              {reasoningEffortControlError}
            </div>
          ) : null}
          {threadAccessControlError ? (
            <div className="mt-2 text-xs text-[#ff6e84]">
              {threadAccessControlError}
            </div>
          ) : null}
          <ChatComposerControl
            actionDisabled={composerActionDisabled}
            actionLabel={composerActionLabel}
            disabled={composerDisabled}
            hasSelectedThread={hasSelectedThread}
            initialValue={initialChatInput}
            isWorking={selectedThreadIsWorking || isWorking}
            onDraftChange={onComposerDraftChange}
            onSubmitMessage={onSubmitMessage}
            variant="desktop"
          />
          {extensionWidgetsBelow.length > 0 ? (
            <ExtensionWidgetStack widgets={extensionWidgetsBelow} />
          ) : null}
        </div>
      </form>
    </>
  );
}

type MobileChatViewProps = SharedChatControlsProps & {
  activeScreenSubtitlePrimary: string;
  activeScreenSubtitleSecondary: string;
  activeScreenTitle: string;
  activeThreadId: number | null;
  expandedItemIds: ReadonlySet<string>;
  localUserLabel: string;
  onToggleItemExpanded: (messageKey: string) => void;
  selectedThreadIsWorking: boolean;
};

/**
 * Mobile chat view with a fixed composer footer and dynamic bottom inset handling.
 */

const MOBILE_CHAT_COMPOSER_GAP_PX = 34;
const MOBILE_CHAT_COMPOSER_FALLBACK_INSET_PX = 224;
const MOBILE_CHAT_ITEM_GAP_PX = 10;
/**
 * Inset constants that counterbalance left/right frame bleed in mobile layouts.
 */
const MOBILE_CHAT_SIDE_INSET_PX = 10;
const MOBILE_CHAT_PARENT_SIDE_PADDING_PX = 16;
const MOBILE_CHAT_SIDE_BLEED_PX =
  MOBILE_CHAT_PARENT_SIDE_PADDING_PX - MOBILE_CHAT_SIDE_INSET_PX;

/**
 * Shared state/actions differ from desktop only in spacing and control layout.
 */
export function MobileChatView({
  activeCodexModel,
  activeReasoningEffort,
  activeScreenSubtitlePrimary,
  activeScreenSubtitleSecondary,
  activeScreenTitle,
  activeThreadId,
  codexModels,
  composerActionDisabled,
  composerActionLabel,
  composerDisabled,
  extensionHiddenThinkingLabel,
  extensionStatusEntries,
  extensionWidgetsAbove,
  extensionWidgetsBelow,
  expandedItemIds,
  hasSelectedThread,
  initialChatInput,
  isWorking,
  localUserLabel,
  messages,
  modelControlError,
  modelSelectorDisabled,
  onChangeModel,
  onChangeReasoningEffort,
  onChangeThreadAccess,
  onComposerDraftChange,
  onSubmit,
  onSubmitMessage,
  onToggleItemExpanded,
  reasoningEffortControlError,
  reasoningEffortSelectorDisabled,
  reasoningEfforts,
  selectedThreadIsWorking,
  threadAccessControlError,
  threadAccessControlDisabled,
  threadAccessValue,
}: MobileChatViewProps & { messages: VisibleMessage[] }): JSX.Element {
  const footerRef = useRef<HTMLElement | null>(null);
  const [composerInsetPx, setComposerInsetPx] = useState(
    MOBILE_CHAT_COMPOSER_FALLBACK_INSET_PX,
  );

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) {
      return;
    }

    const updateComposerInset = (): void => {
      setComposerInsetPx(
        Math.max(
          MOBILE_CHAT_COMPOSER_FALLBACK_INSET_PX,
          Math.ceil(footer.getBoundingClientRect().height) +
            MOBILE_CHAT_COMPOSER_GAP_PX,
        ),
      );
    };

    // Track composer height directly from DOM so transcript avoids overlapping controls.
    // This keeps input always visible when soft keyboard/keyboard-safe areas change.

    updateComposerInset();

    const resizeObserver = new ResizeObserver(() => {
      updateComposerInset();
    });
    resizeObserver.observe(footer);
    window.addEventListener("resize", updateComposerInset);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateComposerInset);
    };
  }, []);

  const chatScrollStyle: CSSProperties = {
    // Apply mirrored side bleed so content stretches edge-to-edge on narrow screens.
    marginLeft: `-${MOBILE_CHAT_SIDE_BLEED_PX}px`,
    marginRight: `-${MOBILE_CHAT_SIDE_BLEED_PX}px`,
    paddingLeft: `${MOBILE_CHAT_SIDE_INSET_PX}px`,
    paddingRight: `${MOBILE_CHAT_SIDE_INSET_PX}px`,
  };

  return (
    <>
      <div className="mt-2 shrink-0">
        <h2 className="font-headline text-[1.85rem] font-extrabold leading-tight tracking-tight text-[#ffffff]">
          {activeScreenTitle}
        </h2>
        <p className="mt-2 text-xs text-[#b3afad]">
          <span className="text-[#ddd8d5]">{activeScreenSubtitlePrimary}</span>
          <span className="text-[#7f7c79]">
            {" "}
            | {activeScreenSubtitleSecondary}
          </span>
        </p>
      </div>
      <ChatTranscript
        activeThreadId={activeThreadId}
        expandedItemIds={expandedItemIds}
        extensionHiddenThinkingLabel={extensionHiddenThinkingLabel}
        localUserLabel={localUserLabel}
        messages={messages}
        onToggleItemExpanded={onToggleItemExpanded}
        paddingEndPx={composerInsetPx}
        paddingStartPx={MOBILE_CHAT_ITEM_GAP_PX}
        scrollContainerClassName="flex min-h-0 flex-1 overflow-y-auto hide-scrollbar"
        scrollContainerStyle={chatScrollStyle}
        variant="mobile"
      />
      <footer
        className="fixed bottom-16 left-0 right-0 z-40 px-[10px] pb-[10px]"
        ref={footerRef}
      >
        <form
          className="mx-auto flex max-w-2xl flex-col gap-3"
          onSubmit={onSubmit}
        >
          {extensionWidgetsAbove.length > 0 ? (
            <ExtensionWidgetStack widgets={extensionWidgetsAbove} />
          ) : null}
          <div className="overflow-visible border border-[#384249] bg-[#181b1e] shadow-[0_24px_60px_rgba(0,0,0,0.42)]">
            <div className="border-b border-[#313a40] px-2 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <CodexModelSelector
                    models={codexModels}
                    value={activeCodexModel}
                    disabled={modelSelectorDisabled}
                    onChange={onChangeModel}
                    onChangeReasoningEffort={onChangeReasoningEffort}
                    reasoningDisabled={reasoningEffortSelectorDisabled}
                    reasoningOptions={reasoningEfforts}
                    reasoningValue={activeReasoningEffort}
                    variant="mobile"
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ThreadAccessControl
                    disabled={threadAccessControlDisabled}
                    onChange={onChangeThreadAccess}
                    value={threadAccessValue}
                    variant="mobile"
                  />
                </div>
              </div>
              {extensionStatusEntries.length > 0 ? (
                <div className="mt-2">
                  <ExtensionStatusPills entries={extensionStatusEntries} />
                </div>
              ) : null}
            </div>
            <ChatComposerControl
              actionDisabled={composerActionDisabled}
              actionLabel={composerActionLabel}
              disabled={composerDisabled}
              hasSelectedThread={hasSelectedThread}
              initialValue={initialChatInput}
              isWorking={selectedThreadIsWorking || isWorking}
              onDraftChange={onComposerDraftChange}
              onSubmitMessage={onSubmitMessage}
              variant="mobile"
            />
          </div>
          {extensionWidgetsBelow.length > 0 ? (
            <ExtensionWidgetStack widgets={extensionWidgetsBelow} />
          ) : null}
          {modelControlError ? (
            <div className="text-xs text-[#ff6e84]">{modelControlError}</div>
          ) : null}
          {reasoningEffortControlError ? (
            <div className="text-xs text-[#ff6e84]">
              {reasoningEffortControlError}
            </div>
          ) : null}
          {threadAccessControlError ? (
            <div className="text-xs text-[#ff6e84]">
              {threadAccessControlError}
            </div>
          ) : null}
        </form>
      </footer>
    </>
  );
}
