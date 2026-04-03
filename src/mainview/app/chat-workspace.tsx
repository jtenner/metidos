import { useVirtualizer } from "@tanstack/react-virtual";
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
import { APP_TITLE, type MessageGroup, type VisibleMessage } from "./state";

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
  group: MessageGroup;
  isLast: boolean;
  localUserLabel: string;
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

/**
 * Group assistant-visible messages into adjacent assistant-only rows to render as
 * conversational turns; user messages stay as one-row entries.
 */
function groupVisibleMessages(messages: VisibleMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];

  for (const message of messages) {
    if (isAssistantVisibleMessage(message)) {
      const lastGroup = groups.at(-1);
      if (lastGroup?.kind === "assistant") {
        lastGroup.messages.push(message);
        continue;
      }
      groups.push({
        kind: "assistant",
        key: message.key,
        messages: [message],
      });
      continue;
    }

    groups.push({
      kind: "user",
      key: message.key,
      text: message.kind === "chat" ? message.text : "",
    });
  }

  return groups;
}

function UnsafeModeToggle({
  checked,
  disabled,
  onChange,
  variant,
}: UnsafeModeToggleProps): JSX.Element {
  // Compact mode reduces horizontal space on narrow viewports and keeps controls readable.
  const compact = variant === "mobile";
  return (
    <label
      className={[
        "inline-flex items-center gap-2 rounded-full border transition-colors",
        compact ? "px-2.5 py-1.5" : "px-3 py-1.5",
        checked
          ? "border-[#d89256] bg-[#2d1d12] text-[#ffd3a6]"
          : "border-[#3d3d3d] bg-[#171717] text-[#b3afad]",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      ].join(" ")}
      title="Uses the danger-full-access sandbox for this thread. Unsafe-mode changes are also recorded in the local security audit log."
    >
      <input
        checked={checked}
        className="h-3.5 w-3.5 accent-[#d89256]"
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      <span className="font-body text-[0.68rem] font-semibold uppercase tracking-[0.18em]">
        Unsafe
      </span>
    </label>
  );
}

function UnsafeModeWarningBanner(): JSX.Element {
  return (
    <div className="mt-2 border border-[#6d5930] bg-[#261f12] px-3 py-3 text-xs text-[#f2d79b]">
      Unsafe mode is enabled for this thread. Codex can use the
      danger-full-access sandbox, and unsafe-mode changes are recorded in the
      local security audit log.
    </div>
  );
}

function DesktopTranscriptGroupRow({
  group,
  isLast,
  localUserLabel,
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
              {group.messages.map((message) => (
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
              ))}
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
              <MarkdownMessage text={group.text} />
            </div>
          </div>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[#262626]">
            {materialSymbol("person")}
          </div>
        </div>
      )}
    </div>
  );
}

function MobileTranscriptGroupRow({
  group,
  isLast,
  localUserLabel,
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
            {group.messages.map((message) => {
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
              <MarkdownMessage text={group.text} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
  const groupedMessages = useMemo<MessageGroup[]>(
    () => groupVisibleMessages(messages),
    [messages],
  );
  const hasTopContent = topContent !== null;
  const rowCount = groupedMessages.length + (hasTopContent ? 1 : 0);

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

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rowCount,
    estimateSize: (index) => {
      // Keep top content and row estimates separate because header height differs from messages.
      if (hasTopContent && index === 0) {
        return 140;
      }
      return variant === "desktop"
        ? DESKTOP_CHAT_TRANSCRIPT_ESTIMATE_PX
        : MOBILE_CHAT_TRANSCRIPT_ESTIMATE_PX;
    },
    getItemKey: (index) => {
      // Row 0 may be header; otherwise map to groupedMessages with offset.
      if (hasTopContent && index === 0) {
        return `chat-header:${activeThreadId ?? "none"}`;
      }
      return groupedMessages[index - (hasTopContent ? 1 : 0)]?.key ?? index;
    },
    getScrollElement: () => scrollRef.current,
    overscan:
      variant === "desktop"
        ? DESKTOP_CHAT_TRANSCRIPT_OVERSCAN
        : MOBILE_CHAT_TRANSCRIPT_OVERSCAN,
    paddingEnd: paddingEndPx,
    paddingStart: paddingStartPx,
    scrollPaddingEnd: paddingEndPx,
    scrollPaddingStart: paddingStartPx,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
  });

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

  useLayoutEffect(() => {
    void totalSize;
    // On thread change, force pin-to-bottom behavior so new thread opens scrolled to latest.
    const threadChanged = previousThreadIdRef.current !== activeThreadId;
    if (threadChanged) {
      pinnedToBottomRef.current = true;
      previousThreadIdRef.current = activeThreadId;
    }
    if (pinnedToBottomRef.current) {
      scrollToBottom();
    }
  }, [activeThreadId, scrollToBottom, totalSize]);

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
                    renderAssistantMessageContent={
                      renderAssistantMessageContent
                    }
                  />
                ) : (
                  <MobileTranscriptGroupRow
                    group={group}
                    isLast={isLastGroup}
                    localUserLabel={localUserLabel}
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
        scrollContainerClassName="flex-1 overflow-y-auto px-6 hide-scrollbar"
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
          {activeUnsafeMode ? <UnsafeModeWarningBanner /> : null}
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
          {activeUnsafeMode ? <UnsafeModeWarningBanner /> : null}
        </form>
      </footer>
    </>
  );
}
