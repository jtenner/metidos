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
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  RpcCodexModelOption,
  RpcCodexReasoningEffort,
  RpcCodexReasoningEffortOption,
  RpcProjectTask,
} from "../../bun/rpc-schema";
import { ChatComposerControl } from "../controls/chat-composer-control";
import { CodexModelSelector } from "../controls/codex-model-selector";
import { brandBoltIcon, materialSymbol } from "../controls/icons";
import { ProjectTaskSelector } from "../controls/project-task-selector";
import { ReasoningEffortSelector } from "../controls/reasoning-effort-selector";
import {
  ChatErrorMessage,
  ChatNoticeMessage,
  CommandExecutionMessage,
  ContextUsageMeter,
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
  activeReasoningEffort: RpcCodexReasoningEffort;
  activeUnsafeMode: boolean;
  composerActionDisabled: boolean;
  composerActionLabel: string;
  composerDisabled: boolean;
  hasSelectedThread: boolean;
  initialChatInput: string;
  isLoadingProjectTasks: boolean;
  isWorking: boolean;
  modelControlError: string;
  modelSelectorDisabled: boolean;
  onChangeModel: (value: string) => void;
  onChangeReasoningEffort: (value: RpcCodexReasoningEffort) => void;
  onChangeUnsafeMode: (value: boolean) => void;
  onSelectTask: (task: RpcProjectTask) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitMessage: () => void;
  projectTasks: RpcProjectTask[];
  reasoningEffortControlError: string;
  reasoningEffortSelectorDisabled: boolean;
  reasoningEfforts: RpcCodexReasoningEffortOption[];
  taskControlError: string;
  taskSelectorDisabled: boolean;
  unsafeModeControlError: string;
  unsafeModeToggleDisabled: boolean;
  codexModels: RpcCodexModelOption[];
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

/**
 * Props for the unsafe mode toggle control.
 */
type UnsafeModeToggleProps = {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  variant: "desktop" | "mobile";
};

const CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 24;
const DESKTOP_CHAT_PADDING_PX = 32;
const DESKTOP_CHAT_TRANSCRIPT_ESTIMATE_PX = 168;
const DESKTOP_CHAT_TRANSCRIPT_GAP_PX = 40;
const DESKTOP_CHAT_TRANSCRIPT_OVERSCAN = 6;
const MOBILE_CHAT_TRANSCRIPT_ESTIMATE_PX = 128;
const MOBILE_CHAT_TRANSCRIPT_OVERSCAN = 5;
const UNSAFE_MODE_DESCRIPTION =
  "Unsafe mode is enabled for this thread. Codex can use the danger-full-access sandbox, and unsafe-mode changes are recorded in the local security audit log.";

/**
 * Function of hashMeasurementText.
 * @param text - The value of `text`.
 */
function hashMeasurementText(text: string): string {
  let hash = 5381;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}

/**
 * Function of visibleMessageMeasurementFingerprint.
 * @param message - The value of `message`.
 * @param expanded - The value of `expanded`.
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
 * Function of deriveTranscriptMeasurementRows.
 * @param activeThreadId - The value of `activeThreadId`.
 * @param expandedItemIds - The value of `expandedItemIds`.
 * @param groupedMessages - The value of `groupedMessages`.
 * @param hasTopContent - The value of `hasTopContent`.
 * @param messages - The value of `messages`.
 * @param variant - The value of `variant`.
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
 * Function of deriveGroupedVisibleMessages.
 * @param activeThreadId - The value of `activeThreadId`.
 * @param messages - The value of `messages`.
 * @param previousCache - The value of `previousCache`.
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
 * Function of readUserGroupText.
 * @param group - The value of `group`.
 * @param messages - The value of `messages`.
 */
function readUserGroupText(
  group: Extract<TranscriptMessageGroup, { kind: "user" }>,
  messages: VisibleMessage[],
): string {
  const message = messages[group.messageIndex];
  return message?.kind === "chat" ? message.text : "";
}

/**
 * Function of UnsafeModeToggle.
 * @param checked - The value of `checked`.
 * @param disabled - The value of `disabled`.
 * @param onChange - The value of `onChange`.
 * @param variant - The value of `variant`.
 */
function UnsafeModeToggle({
  checked,
  disabled,
  onChange,
  variant,
}: UnsafeModeToggleProps): JSX.Element {
  // Compact mode reduces horizontal space on narrow viewports and keeps controls readable.
  const compact = variant === "mobile";
  const popoverId = useId();
  return (
    <div className="group relative inline-flex overflow-visible">
      <label
        className={[
          "inline-flex items-center gap-2 rounded-full border transition-colors",
          compact ? "px-2.5 py-1.5" : "px-3 py-1.5",
          checked
            ? "border-[#d89256] bg-[#2d1d12] text-[#ffd3a6]"
            : "border-[#3d3d3d] bg-[#171717] text-[#b3afad]",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        ].join(" ")}
      >
        <span className="relative inline-flex overflow-visible">
          <input
            aria-describedby={checked ? popoverId : undefined}
            checked={checked}
            className="h-3.5 w-3.5 accent-[#d89256]"
            disabled={disabled}
            onChange={(event) => onChange(event.currentTarget.checked)}
            type="checkbox"
          />
          {checked ? (
            <div
              className={[
                "absolute z-50 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
                compact
                  ? "bottom-[calc(100%+0.5rem)] right-0 w-[18rem] max-w-[calc(100vw-2rem)]"
                  : "bottom-[calc(100%+0.5rem)] left-1/2 -translate-x-1/2 w-[28rem] max-w-[calc(100vw-4rem)]",
              ].join(" ")}
              id={popoverId}
              role="tooltip"
            >
              <div className="border border-[#6d5930] bg-[#261f12] px-3 py-2 text-xs leading-5 text-[#f2d79b] shadow-[0_18px_38px_rgba(0,0,0,0.42)]">
                {UNSAFE_MODE_DESCRIPTION}
              </div>
            </div>
          ) : null}
        </span>
        <span className="font-body text-[0.68rem] font-semibold uppercase tracking-[0.18em]">
          Unsafe
        </span>
      </label>
    </div>
  );
}

/**
 * Function of areGroupRowPropsEqual.
 * @param previous - The value of `previous`.
 * @param next - The value of `next`.
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
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center bg-[#adcbe0]">
            {brandBoltIcon("text-sm text-[#224259]")}
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
                    <div className="min-w-0 max-w-full text-sm leading-relaxed text-[#ffffff]">
                      {renderAssistantMessageContent(message)}
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
            {brandBoltIcon("text-sm")}
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
                    <div className="text-sm leading-relaxed text-[#ffffff]">
                      {renderAssistantMessageContent(message)}
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

const ChatTranscript = memo(function ChatTranscript({
  activeThreadId,
  expandedItemIds,
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
  const autoscrollRafRef = useRef<number | null>(null);
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
        return <ReasoningMessage state={message.state} text={message.text} />;
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
    [expandedItemIds, onToggleItemExpanded],
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
      // Update auto-scroll state only when transcript is near bottom; avoids fighting
      // manual user scrolling while new messages stream in.
      pinnedToBottomRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight <=
        CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
    },
    [],
  );

  const scrollToBottom = useCallback((): void => {
    if (rowCount <= 0) {
      return;
    }
    virtualizer.scrollToIndex(rowCount - 1, {
      align: "end",
      behavior: "auto",
    });
  }, [rowCount, virtualizer]);

  useEffect(() => {
    // On thread change, force pin-to-bottom behavior so new thread opens scrolled to latest.
    const threadChanged = previousThreadIdRef.current !== activeThreadId;
    if (threadChanged) {
      pinnedToBottomRef.current = true;
      previousThreadIdRef.current = activeThreadId;
    }
    if (pinnedToBottomRef.current) {
      if (autoscrollRafRef.current !== null) {
        window.cancelAnimationFrame(autoscrollRafRef.current);
      }
      autoscrollRafRef.current = window.requestAnimationFrame(() => {
        scrollToBottom();
        autoscrollRafRef.current = null;
      });
    }
    return () => {
      if (autoscrollRafRef.current !== null) {
        window.cancelAnimationFrame(autoscrollRafRef.current);
        autoscrollRafRef.current = null;
      }
    };
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
 * Main desktop chat experience: transcript, model/reasoning/task controls, and composer.
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
  activeUnsafeMode,
  codexModels,
  composerActionDisabled,
  composerActionLabel,
  composerDisabled,
  expandedItemIds,
  hasSelectedThread,
  initialChatInput,
  isLoadingProjectTasks,
  isWorking,
  localUserLabel,
  messages,
  modelControlError,
  modelSelectorDisabled,
  onChangeModel,
  onChangeReasoningEffort,
  onChangeUnsafeMode,
  onSelectTask,
  onSubmit,
  onSubmitMessage,
  onToggleItemExpanded,
  projectTasks,
  reasoningEffortControlError,
  reasoningEffortSelectorDisabled,
  reasoningEfforts,
  selectedThreadIsWorking,
  taskControlError,
  taskSelectorDisabled,
  unsafeModeControlError,
  unsafeModeToggleDisabled,
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
          <div className="flex items-center gap-2 border-b border-[#484848]/10 p-2">
            <div className="min-w-[15rem] max-w-[22rem]">
              <CodexModelSelector
                models={codexModels}
                value={activeCodexModel}
                disabled={modelSelectorDisabled}
                onChange={onChangeModel}
                variant="desktop"
              />
            </div>
            <div className="min-w-[7.5rem] max-w-[8.5rem]">
              <ReasoningEffortSelector
                options={reasoningEfforts}
                value={activeReasoningEffort}
                disabled={reasoningEffortSelectorDisabled}
                onChange={onChangeReasoningEffort}
                variant="desktop"
              />
            </div>
            <ProjectTaskSelector
              tasks={projectTasks}
              loading={isLoadingProjectTasks}
              disabled={taskSelectorDisabled}
              onSelect={onSelectTask}
              variant="desktop"
            />
            <UnsafeModeToggle
              checked={activeUnsafeMode}
              disabled={unsafeModeToggleDisabled}
              onChange={onChangeUnsafeMode}
              variant="desktop"
            />
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
          {taskControlError ? (
            <div className="mt-2 text-xs text-[#ff6e84]">
              {taskControlError}
            </div>
          ) : null}
          {unsafeModeControlError ? (
            <div className="mt-2 text-xs text-[#ff6e84]">
              {unsafeModeControlError}
            </div>
          ) : null}
          <ChatComposerControl
            actionDisabled={composerActionDisabled}
            actionLabel={composerActionLabel}
            disabled={composerDisabled}
            hasSelectedThread={hasSelectedThread}
            initialValue={initialChatInput}
            isWorking={selectedThreadIsWorking || isWorking}
            onSubmitMessage={onSubmitMessage}
            variant="desktop"
          />
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
  activeUnsafeMode,
  codexModels,
  composerActionDisabled,
  composerActionLabel,
  composerDisabled,
  expandedItemIds,
  hasSelectedThread,
  initialChatInput,
  isLoadingProjectTasks,
  isWorking,
  localUserLabel,
  messages,
  modelControlError,
  modelSelectorDisabled,
  onChangeModel,
  onChangeReasoningEffort,
  onChangeUnsafeMode,
  onSelectTask,
  onSubmit,
  onSubmitMessage,
  onToggleItemExpanded,
  projectTasks,
  reasoningEffortControlError,
  reasoningEffortSelectorDisabled,
  reasoningEfforts,
  selectedThreadIsWorking,
  taskControlError,
  taskSelectorDisabled,
  unsafeModeControlError,
  unsafeModeToggleDisabled,
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
          <div className="overflow-visible border border-[#384249] bg-[#181b1e] shadow-[0_24px_60px_rgba(0,0,0,0.42)]">
            <div className="border-b border-[#313a40] px-2 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 w-1/2">
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
                <div className="flex min-w-0 w-1/2 items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <ProjectTaskSelector
                      tasks={projectTasks}
                      loading={isLoadingProjectTasks}
                      disabled={taskSelectorDisabled}
                      onSelect={onSelectTask}
                      variant="mobile"
                    />
                  </div>
                  <UnsafeModeToggle
                    checked={activeUnsafeMode}
                    disabled={unsafeModeToggleDisabled}
                    onChange={onChangeUnsafeMode}
                    variant="mobile"
                  />
                </div>
              </div>
            </div>
            <ChatComposerControl
              actionDisabled={composerActionDisabled}
              actionLabel={composerActionLabel}
              disabled={composerDisabled}
              hasSelectedThread={hasSelectedThread}
              initialValue={initialChatInput}
              isWorking={selectedThreadIsWorking || isWorking}
              onSubmitMessage={onSubmitMessage}
              variant="mobile"
            />
          </div>
          {modelControlError ? (
            <div className="text-xs text-[#ff6e84]">{modelControlError}</div>
          ) : null}
          {reasoningEffortControlError ? (
            <div className="text-xs text-[#ff6e84]">
              {reasoningEffortControlError}
            </div>
          ) : null}
          {taskControlError ? (
            <div className="text-xs text-[#ff6e84]">{taskControlError}</div>
          ) : null}
          {unsafeModeControlError ? (
            <div className="text-xs text-[#ff6e84]">
              {unsafeModeControlError}
            </div>
          ) : null}
        </form>
      </footer>
    </>
  );
}
