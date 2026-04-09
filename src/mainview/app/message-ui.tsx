/**
 * @file src/mainview/app/message-ui.tsx
 * @description Module for message ui.
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Fragment,
  type JSX,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BeatLoader } from "react-spinners";

import { brandBoltIcon, materialSymbol } from "../controls/icons";
import type { DiffLineKind } from "./diff-parsing";
import {
  type DiffParseSnapshot,
  useDiffParseResult,
} from "./diff-parsing-client";
import {
  LazyPreparedRichMarkdownMessage,
  LazyRichMarkdownMessage,
} from "./message-markdown-loader";
import {
  type PlainTextMessageSegment,
  shouldUseRichMarkdownRenderer,
  splitPlainTextMessage,
} from "./message-markdown-routing";
import { shouldWorkerizeMessagePreprocessing } from "./message-preprocessing";
import { usePreparedMessageRenderPlan } from "./message-preprocessing-client";
import type {
  GitHistoryModalState,
  MessageGroup,
  VisibleMessage,
} from "./state";
import { APP_TITLE, formatGitHistoryTimestamp } from "./state";

const DIFF_LINE_ESTIMATE_PX = 24;
const DIFF_VIRTUALIZATION_OVERSCAN = 20;
const MIN_VIRTUALIZED_DIFF_LINES = 400;
const MARKDOWN_LINK_CLASS_NAME =
  "text-[#c6dae9] underline decoration-[#7aa5c4] underline-offset-2 transition-colors hover:text-[#e3edf5]";
const COPY_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-1 rounded border border-[#2f3d45] bg-[#11161b] px-2 py-1 text-[10px] font-medium tracking-wide text-[#98b3c7] transition-colors hover:border-[#4c606f] hover:bg-[#1c2730] hover:text-[#c7d7e2]";
const INLINE_COMMAND_COPY_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-1 rounded border border-[#2f3d45] bg-[#11161b] px-2 py-1 text-[9px] font-medium tracking-wide text-[#98b3c7] transition-colors hover:border-[#4c606f] hover:bg-[#1c2730] hover:text-[#c7d7e2]";
const COMMAND_PREVIEW_BORDER_PX = 1;
const COMMAND_PREVIEW_PADDING_X_PX = 12;
const COMMAND_PREVIEW_PADDING_Y_PX = 12;
const COMMAND_PREVIEW_TOP_NUDGE_PX = 1;

const PlainTextMessage = memo(function PlainTextMessage({
  segments,
  text,
}: {
  segments?: PlainTextMessageSegment[];
  text: string;
}): JSX.Element {
  const resolvedSegments = useMemo(
    () => segments ?? splitPlainTextMessage(text),
    [segments, text],
  );

  return (
    <div className="whitespace-pre-wrap break-words">
      {resolvedSegments.map((segment) =>
        segment.kind === "link" ? (
          <a
            href={segment.href}
            key={segment.key}
            target="_blank"
            rel="noreferrer"
            className={`${MARKDOWN_LINK_CLASS_NAME} break-all`}
          >
            {segment.text}
          </a>
        ) : (
          <Fragment key={segment.key}>{segment.text}</Fragment>
        ),
      )}
    </div>
  );
});

function PreparingLargeMarkdownMessage(): JSX.Element {
  return (
    <div className="border border-[#283239] bg-[#151b20] px-3 py-3 text-sm text-[#d4e4ef]">
      Preparing formatted response...
    </div>
  );
}

/**
 * Performs LargeMarkdownMessage operation.
 * @param text - Input text content.
 */
function LargeMarkdownMessage({ text }: { text: string }): JSX.Element {
  const preprocessedMessage = usePreparedMessageRenderPlan(text);

  if (preprocessedMessage.isLoading) {
    return <PreparingLargeMarkdownMessage />;
  }

  if (preprocessedMessage.plan.kind === "plain") {
    return (
      <PlainTextMessage
        segments={preprocessedMessage.plan.segments}
        text={text}
      />
    );
  }

  return (
    <Suspense fallback={<PreparingLargeMarkdownMessage />}>
      <LazyPreparedRichMarkdownMessage plan={preprocessedMessage.plan} />
    </Suspense>
  );
}

export const MarkdownMessage = memo(function MarkdownMessage({
  text,
}: {
  text: string;
}): JSX.Element {
  if (shouldWorkerizeMessagePreprocessing(text)) {
    return <LargeMarkdownMessage text={text} />;
  }

  if (!shouldUseRichMarkdownRenderer(text)) {
    return <PlainTextMessage text={text} />;
  }

  return (
    <Suspense fallback={<PlainTextMessage text={text} />}>
      <LazyRichMarkdownMessage text={text} />
    </Suspense>
  );
});

/**
 * Performs ContextUsageMeter operation.
 * @param inputTokens - inputTokens value.
 * @param contextWindowTokens - contextWindowTokens value.
 */
export function ContextUsageMeter({
  inputTokens,
  contextWindowTokens,
}: {
  inputTokens: number;
  contextWindowTokens: number;
}): JSX.Element {
  const safeContextWindowTokens = Math.max(1, contextWindowTokens);
  const clampedInputTokens = Math.min(
    Math.max(inputTokens, 0),
    safeContextWindowTokens,
  );
  const progress = clampedInputTokens / safeContextWindowTokens;

  // Use conic-gradient ring for compact token usage indicator with accessible <meter> semantics.
  return (
    <div className="shrink-0">
      <div className="relative h-6 w-6">
        <meter
          aria-label="Context usage"
          className="sr-only"
          max={safeContextWindowTokens}
          min={0}
          value={clampedInputTokens}
        >
          {inputTokens.toLocaleString()} of{" "}
          {contextWindowTokens.toLocaleString()} context tokens used
        </meter>
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-full border border-[#31404a]"
        >
          <div
            className="absolute inset-[1px] rounded-full"
            style={{
              background: `conic-gradient(from -90deg, #bdd5e6 0deg ${
                progress * 360
              }deg, #24313a ${progress * 360}deg 360deg)`,
            }}
          />
          <div className="absolute inset-[4px] rounded-full bg-[#131313]" />
        </div>
      </div>
    </div>
  );
}

/**
 * Is assistant visible message.
 * @param message - Message payload.
 */
export function isAssistantVisibleMessage(message: VisibleMessage): boolean {
  // Non-chat entries (system/tool messages etc.) are always shown in conversation history.
  return message.kind !== "chat" || message.speaker === "assistant";
}

/**
 * Is plain assistant text message.
 * @param message - Message payload.
 */
export function isPlainAssistantTextMessage(message: VisibleMessage): boolean {
  // Exclude status-like tones so plain text bubbles keep spacing consistent.
  return (
    message.kind === "chat" &&
    message.speaker === "assistant" &&
    message.tone !== "working" &&
    message.tone !== "error" &&
    message.tone !== "notice"
  );
}

function getCopyTextForVisibleMessage(message: VisibleMessage): string {
  if (message.kind === "chat") {
    return message.text;
  }
  if (message.kind === "reasoning" || message.kind === "error") {
    return message.text;
  }
  if (message.kind === "command") {
    return `Command:\n${message.command}\n\nOutput:\n${message.output}`;
  }
  if (message.kind === "tool_call") {
    return `Tool call: ${message.server}.${message.tool}\n\nArguments:\n${message.argumentsText}\n\nOutput:\n${message.output}`;
  }
  if (message.kind === "web_search") {
    return message.query;
  }

  return `${message.changeKind} ${message.path}\n\n${message.diffText}`;
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

function AssistantMessageCopyButton({
  message,
}: {
  message: VisibleMessage;
}): JSX.Element {
  const text = getCopyTextForVisibleMessage(message).trim();
  const [showCopied, setShowCopied] = useState(false);
  const [isCopyPopoverFading, setIsCopyPopoverFading] = useState(false);
  const hideCopiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const fadeCopiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const clearCopyStateTimeouts = useCallback(() => {
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

  const onCopy = (): void => {
    if (!text) {
      return;
    }
    copyTextToClipboard(text);
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
        className={COPY_BUTTON_CLASS_NAME}
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

export function ProcessingMessage(): JSX.Element {
  return (
    <div className="inline-flex items-center gap-3 border border-[#31404a] bg-[#182025] px-3 py-2 text-sm text-[#dfebf3]">
      <BeatLoader color="#bdd5e6" margin={1} size={5} speedMultiplier={0.85} />
      <span>Processing</span>
    </div>
  );
}

/**
 * Performs ChatErrorMessage operation.
 * @param text - Input text content.
 */
export function ChatErrorMessage({ text }: { text: string }): JSX.Element {
  return (
    <div className="border border-[#5c2030] bg-[#2c1117] px-3 py-3 text-sm text-[#ff9db0]">
      {text}
    </div>
  );
}

/**
 * Performs ChatNoticeMessage operation.
 * @param text - Input text content.
 */
export function ChatNoticeMessage({ text }: { text: string }): JSX.Element {
  return (
    <div className="border border-[#6d5930] bg-[#261f12] px-3 py-3 text-sm text-[#f2d79b]">
      {text}
    </div>
  );
}

/**
 * Performs commandStateLabel operation.
 * @param state - Current state value.
 * @param exitCode - exitCode value.
 */
function commandStateLabel(
  state: "in_progress" | "completed" | "failed" | "stopped",
  exitCode: number | null,
): string {
  if (state === "in_progress") {
    return "Running";
  }
  if (state === "stopped") {
    return "Stopped";
  }
  if (state === "failed") {
    return exitCode === null ? "Failed" : `Failed (${exitCode})`;
  }
  return exitCode === null ? "Completed" : `Completed (${exitCode})`;
}

/**
 * Performs toolCallStateLabel operation.
 * @param state - Current state value.
 */
function toolCallStateLabel(
  state: "in_progress" | "completed" | "failed" | "stopped",
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
 * Performs webSearchStateLabel operation.
 * @param state - Current state value.
 */
function webSearchStateLabel(
  state: "in_progress" | "completed" | "stopped",
): string {
  if (state === "in_progress") {
    return "Searching";
  }
  if (state === "stopped") {
    return "Stopped";
  }
  return "Completed";
}

/**
 * Performs errorItemStateLabel operation.
 * @param state - Current state value.
 */
function errorItemStateLabel(
  state: "in_progress" | "completed" | "stopped",
): string {
  if (state === "in_progress") {
    return "Working";
  }
  if (state === "stopped") {
    return "Stopped";
  }
  return "Noted";
}

/**
 * Performs diffLineClassName operation.
 * @param kind - kind value.
 */
function diffLineClassName(kind: DiffLineKind): string {
  if (kind === "meta") {
    return "bg-[#0f1418] text-[#8aa6ba]";
  }
  if (kind === "file") {
    return "bg-[#12191e] text-[#b7d0e1]";
  }
  if (kind === "hunk") {
    return "bg-[#182229] text-[#f0d79a]";
  }
  if (kind === "add") {
    return "bg-[#112118] text-[#9fe2b1]";
  }
  if (kind === "remove") {
    return "bg-[#27141a] text-[#ffb1bf]";
  }
  return "text-[#c9d2d8]";
}

/**
 * Render a unified diff block with simple line-kind based coloring.
 * Keeps lines with empty bodies as non-empty whitespace so row heights stay stable.
 */
export function DiffViewer({
  className,
  diffText,
  parsedDiffState,
  viewportClassName,
}: {
  className?: string;
  diffText: string;
  parsedDiffState?: DiffParseSnapshot;
  viewportClassName?: string;
}): JSX.Element {
  const internalParsedDiffState = useDiffParseResult(diffText);
  const effectiveParsedDiffState = parsedDiffState ?? internalParsedDiffState;
  const lines = effectiveParsedDiffState.result.lines;
  const scrollRef = useRef<HTMLElement | null>(null);
  const useVirtualizedDiff = lines.length >= MIN_VIRTUALIZED_DIFF_LINES;
  const virtualizer = useVirtualizer({
    count: lines.length,
    estimateSize: () => DIFF_LINE_ESTIMATE_PX,
    getScrollElement: () => scrollRef.current,
    overscan: DIFF_VIRTUALIZATION_OVERSCAN,
    useAnimationFrameWithResizeObserver: true,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  if (effectiveParsedDiffState.isLoading) {
    return (
      <div className="border border-[#283239] bg-[#151b20] px-3 py-3 text-xs text-[#d4e4ef]">
        Preparing diff...
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="border border-[#252f36] bg-[#111518] px-3 py-3 text-xs text-[#7f8c95]">
        No diff available.
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden border border-[#252f36] bg-[#111518] ${className ?? ""}`.trim()}
    >
      <section
        aria-label="Diff content"
        className={`app-scrollbar overflow-auto text-[11px] leading-5 ${
          viewportClassName ?? "max-h-[28rem]"
        }`.trim()}
        ref={scrollRef}
      >
        {useVirtualizedDiff ? (
          <div
            className="relative w-full"
            style={{
              height: `${totalSize}px`,
            }}
          >
            {virtualRows.map((virtualRow) => {
              const line = lines[virtualRow.index];
              if (!line) {
                return null;
              }

              return (
                <div
                  data-index={virtualRow.index}
                  key={line.key}
                  ref={virtualizer.measureElement}
                  className={`absolute left-0 top-0 w-full font-mono px-3 py-0.5 whitespace-pre-wrap ${diffLineClassName(line.kind)}`}
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {line.text || " "}
                </div>
              );
            })}
          </div>
        ) : (
          lines.map((line) => (
            <div
              key={line.key}
              className={`font-mono px-3 py-0.5 whitespace-pre-wrap ${diffLineClassName(line.kind)}`}
            >
              {line.text || " "}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

/**
 * Performs ToolCallMessage operation.
 * @param server - server value.
 * @param tool - tool value.
 * @param argumentsText - argumentsText value.
 * @param output - output value.
 * @param state - Current state value.
 */
export function ToolCallMessage({
  server,
  tool,
  argumentsText,
  output,
  state,
}: {
  server: string;
  tool: string;
  argumentsText: string;
  output: string;
  state: "in_progress" | "completed" | "failed" | "stopped";
}): JSX.Element {
  // Tool messages show tool identity, arguments, and output/error with bounded scrolling.
  return (
    <div className="space-y-3 border border-[#2c353c] bg-[#13181b] p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
            Tool Call
          </div>
          <div className="mt-1 truncate font-mono text-sm text-[#f2f0ef]">
            {tool}
          </div>
          <div className="mt-1 text-[11px] text-[#8f9aa2]">{server}</div>
        </div>
        <div className="shrink-0 border border-[#31404a] bg-[#182025] px-2 py-1 text-[10px] uppercase tracking-widest text-[#cfe0eb]">
          {toolCallStateLabel(state)}
        </div>
      </div>
      {argumentsText.trim() ? (
        <div className="space-y-2">
          <div className="font-label text-[10px] uppercase tracking-widest text-[#8ca6b9]">
            Arguments
          </div>
          <pre className="app-scrollbar max-h-[12rem] overflow-auto border border-[#252f36] bg-[#0f1316] px-3 py-3 text-[11px] leading-5 text-[#d4dde4] whitespace-pre-wrap">
            {argumentsText}
          </pre>
        </div>
      ) : null}
      {output.trim() ? (
        <div className="space-y-2">
          <div className="font-label text-[10px] uppercase tracking-widest text-[#8ca6b9]">
            {state === "failed" ? "Error" : "Output"}
          </div>
          <pre className="app-scrollbar max-h-[16rem] overflow-auto border border-[#252f36] bg-[#0f1316] px-3 py-3 text-[11px] leading-5 text-[#d4dde4] whitespace-pre-wrap">
            {output}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Performs WebSearchMessage operation.
 * @param query - Query string.
 * @param state - Current state value.
 */
export function WebSearchMessage({
  query,
  state,
}: {
  query: string;
  state: "in_progress" | "completed" | "stopped";
}): JSX.Element {
  // Search result card is lightweight; only query and lifecycle state are surfaced.
  return (
    <div className="space-y-3 border border-[#2c353c] bg-[#13181b] p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
            Web Search
          </div>
          <div className="mt-1 text-sm leading-6 text-[#f2f0ef]">{query}</div>
        </div>
        <div className="shrink-0 border border-[#31404a] bg-[#182025] px-2 py-1 text-[10px] uppercase tracking-widest text-[#cfe0eb]">
          {webSearchStateLabel(state)}
        </div>
      </div>
    </div>
  );
}

/**
 * Performs ErrorItemMessage operation.
 * @param text - Input text content.
 * @param state - Current state value.
 */
export function ErrorItemMessage({
  text,
  state,
}: {
  text: string;
  state: "in_progress" | "completed" | "stopped";
}): JSX.Element {
  // Generic inline error item used for non-blocking notices from backend execution.
  return (
    <div className="space-y-3 border border-[#6d5930] bg-[#261f12] p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-label text-[10px] uppercase tracking-widest text-[#f2d79b]">
            Error
          </div>
        </div>
        <div className="shrink-0 border border-[#8f7341] bg-[#342914] px-2 py-1 text-[10px] uppercase tracking-widest text-[#f2d79b]">
          {errorItemStateLabel(state)}
        </div>
      </div>
      <div className="text-sm leading-6 text-[#f2d79b]">{text}</div>
    </div>
  );
}

/**
 * Performs CommandExecutionMessage operation.
 * @param command - command value.
 * @param output - output value.
 * @param state - Current state value.
 * @param exitCode - exitCode value.
 * @param expanded - Whether the section is expanded.
 * @param onToggleExpanded - Callback invoked when expansion changes.
 */
export function CommandExecutionMessage({
  command,
  output,
  state,
  exitCode,
  expanded,
  onToggleExpanded,
}: {
  command: string;
  output: string;
  state: "in_progress" | "completed" | "failed" | "stopped";
  exitCode: number | null;
  expanded?: boolean;
  onToggleExpanded?: (() => void) | undefined;
}): JSX.Element {
  const hasOutput = output.trim().length > 0;
  const [localIsExpanded, setLocalIsExpanded] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const [commandPreviewLayout, setCommandPreviewLayout] = useState({
    left: 0,
    top: 0,
    width: 0,
  });
  const isExpanded = expanded ?? localIsExpanded;
  const stateLabel = commandStateLabel(state, exitCode);
  const commandHeaderRef = useRef<HTMLDivElement | null>(null);
  const commandPreviewAnchorRef = useRef<HTMLElement | null>(null);
  const hideCommandCopiedTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const clearCommandCopyTimeout = useCallback((): void => {
    if (hideCommandCopiedTimeoutRef.current !== null) {
      clearTimeout(hideCommandCopiedTimeoutRef.current);
      hideCommandCopiedTimeoutRef.current = null;
    }
  }, []);

  const updateCommandPreviewLayout = useCallback((): void => {
    const headerElement = commandHeaderRef.current;
    const anchorElement = commandPreviewAnchorRef.current;
    if (headerElement === null || anchorElement === null) {
      return;
    }
    const headerRect = headerElement.getBoundingClientRect();
    const anchorRect = anchorElement.getBoundingClientRect();
    const nextLeft = Math.max(0, anchorRect.left - headerRect.left);
    const nextTop = Math.max(0, anchorRect.top - headerRect.top);
    const nextWidth = Math.max(anchorRect.width, headerRect.width - nextLeft);
    setCommandPreviewLayout((current) => {
      if (
        current.left === nextLeft &&
        current.top === nextTop &&
        current.width === nextWidth
      ) {
        return current;
      }
      return {
        left: nextLeft,
        top: nextTop,
        width: nextWidth,
      };
    });
  }, []);

  const setCommandPreviewAnchor = useCallback(
    (element: HTMLButtonElement | HTMLDivElement | null): void => {
      commandPreviewAnchorRef.current = element;
      updateCommandPreviewLayout();
    },
    [updateCommandPreviewLayout],
  );

  // Supports controlled expansion from parent when needed; otherwise local toggle state.
  const toggleExpanded = (): void => {
    if (expanded === undefined) {
      setLocalIsExpanded((current) => !current);
      return;
    }
    onToggleExpanded?.();
  };

  useEffect(() => {
    return () => {
      clearCommandCopyTimeout();
    };
  }, [clearCommandCopyTimeout]);

  useEffect(() => {
    const headerElement = commandHeaderRef.current;
    if (headerElement === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      updateCommandPreviewLayout();
    });
    observer.observe(headerElement);
    return () => {
      observer.disconnect();
    };
  }, [updateCommandPreviewLayout]);

  const onCopyCommand = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!command.trim()) {
      return;
    }
    copyTextToClipboard(command);
    clearCommandCopyTimeout();
    setCommandCopied(true);
    hideCommandCopiedTimeoutRef.current = setTimeout(() => {
      setCommandCopied(false);
      hideCommandCopiedTimeoutRef.current = null;
    }, 1400);
  };

  return (
    <div className="relative border border-[#2c353c] bg-[#13181b]">
      <div
        className="relative flex items-start justify-between gap-4 px-4 py-4"
        ref={commandHeaderRef}
      >
        <div className="min-w-0 flex-1">
          <div className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
            Command
          </div>
          <div className="mt-1">
            <div className="group/command-preview inline-block max-w-full align-top">
              {hasOutput ? (
                <button
                  aria-expanded={isExpanded}
                  aria-label={`Toggle command output for ${command}`}
                  className="block max-w-full truncate font-mono text-left text-sm text-[#f2f0ef] transition-colors hover:text-[#ffffff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa5c4]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#13181b]"
                  onClick={toggleExpanded}
                  ref={setCommandPreviewAnchor}
                  type="button"
                >
                  {command}
                </button>
              ) : (
                <div
                  className="max-w-full truncate font-mono text-sm text-[#f2f0ef]"
                  ref={setCommandPreviewAnchor}
                >
                  {command}
                </div>
              )}
              <div
                className="pointer-events-none invisible absolute z-30 opacity-0 transition-opacity duration-150 group-hover/command-preview:visible group-hover/command-preview:pointer-events-auto group-hover/command-preview:opacity-100 group-focus-within/command-preview:visible group-focus-within/command-preview:pointer-events-auto group-focus-within/command-preview:opacity-100"
                style={{
                  left: `${commandPreviewLayout.left}px`,
                  top: `${commandPreviewLayout.top}px`,
                  transform: `translate(-${COMMAND_PREVIEW_PADDING_X_PX + COMMAND_PREVIEW_BORDER_PX}px, -${COMMAND_PREVIEW_PADDING_Y_PX + COMMAND_PREVIEW_BORDER_PX + COMMAND_PREVIEW_TOP_NUDGE_PX}px)`,
                  width: `${commandPreviewLayout.width + COMMAND_PREVIEW_PADDING_X_PX + COMMAND_PREVIEW_BORDER_PX}px`,
                }}
              >
                <div className="relative box-border w-full border border-[#31404a] bg-[#13181b] px-3 py-3 pr-16 shadow-[0_18px_42px_rgba(0,0,0,0.56)]">
                  <button
                    aria-label="Copy full command"
                    className={`absolute right-2 top-2 ${INLINE_COMMAND_COPY_BUTTON_CLASS_NAME}`}
                    onClick={onCopyCommand}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                    }}
                    title="Copy full command"
                    type="button"
                  >
                    {materialSymbol("description", "text-[11px] leading-none")}
                    <span>{commandCopied ? "Copied" : "Copy"}</span>
                  </button>
                  <div className="select-text font-mono text-sm leading-6 text-[#f2f0ef] whitespace-pre-wrap break-all">
                    {command}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="border border-[#31404a] bg-[#182025] px-2 py-1 text-[10px] uppercase tracking-widest text-[#cfe0eb]">
            {stateLabel}
          </div>
          {hasOutput ? (
            <button
              aria-expanded={isExpanded}
              aria-label={`Toggle command output for ${command}`}
              className="flex items-center text-[#8ca6b9] transition-colors hover:text-[#d7e5ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa5c4]/60 focus-visible:ring-inset"
              onClick={toggleExpanded}
              type="button"
            >
              {materialSymbol(
                isExpanded ? "expand_less" : "expand_more",
                "text-base",
              )}
            </button>
          ) : null}
        </div>
      </div>
      {hasOutput && isExpanded ? (
        <div className="px-4 pb-4">
          <pre className="app-scrollbar max-h-[16rem] overflow-auto border border-[#252f36] bg-[#0f1316] px-3 py-3 text-[11px] leading-5 text-[#d4dde4]">
            {output}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Performs ReasoningMessage operation.
 * @param state - Current state value.
 * @param text - Input text content.
 */
export function ReasoningMessage({
  label = "Thinking",
  state,
  text,
}: {
  label?: string;
  state: "in_progress" | "completed" | "stopped";
  text: string;
}): JSX.Element {
  // Assistant internal thinking payloads are shown with a compact status pill.
  return (
    <div className="border border-[#2a3339] bg-[#11171a] px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="font-label text-[10px] uppercase tracking-widest text-[#8fb5cd]">
          {label}
        </div>
        <div className="text-[10px] uppercase tracking-widest text-[#70808c]">
          {state === "completed"
            ? "Complete"
            : state === "stopped"
              ? "Stopped"
              : "Working"}
        </div>
      </div>
      <div className="mt-2 text-sm leading-6 text-[#d6e7f2]">{text}</div>
    </div>
  );
}

/**
 * Performs FileChangeMessage operation.
 * @param path - Filesystem path.
 * @param diffText - Diff content to process.
 * @param changeKind - changeKind value.
 * @param state - Current state value.
 * @param expanded - Whether the section is expanded.
 * @param onToggleExpanded - Callback invoked when expansion changes.
 */
export function FileChangeMessage({
  path,
  diffText,
  changeKind,
  state,
  expanded,
  onToggleExpanded,
}: {
  path: string;
  diffText: string;
  changeKind: "add" | "delete" | "update";
  state: "in_progress" | "completed" | "failed" | "stopped";
  expanded?: boolean;
  onToggleExpanded?: (() => void) | undefined;
}): JSX.Element {
  const changeLabel =
    changeKind === "add"
      ? "Added"
      : changeKind === "delete"
        ? "Deleted"
        : "Updated";
  const stateLabel =
    state === "failed"
      ? "Failed"
      : state === "stopped"
        ? "Stopped"
        : state === "in_progress"
          ? "Working"
          : changeLabel;
  const hasDiff = diffText.trim().length > 0;
  const [localIsExpanded, setLocalIsExpanded] = useState(false);
  const isExpanded = expanded ?? localIsExpanded;
  const diffRegionId = `file-change-diff-${
    path.replaceAll(/[^a-zA-Z0-9_-]+/g, "-").replaceAll(/^-+|-+$/g, "") ||
    "content"
  }`;
  // Keep IDs stable/deterministic for aria-controls and screen-reader navigation.
  const toggleExpanded = (): void => {
    if (!hasDiff) {
      return;
    }
    if (expanded === undefined) {
      setLocalIsExpanded((current) => !current);
      return;
    }
    onToggleExpanded?.();
  };

  const headerContent = (
    <>
      <div className="min-w-0">
        <div className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
          File Change -{" "}
          <span className="truncate font-mono text-[10px] text-[#f2f0ef]">
            {path}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="border border-[#31404a] bg-[#182025] px-2 py-1 text-[10px] uppercase tracking-widest text-[#cfe0eb]">
          {stateLabel}
        </div>
        {hasDiff ? (
          <span className="text-[#8ca6b9]">
            {materialSymbol(
              isExpanded ? "expand_less" : "expand_more",
              "text-base",
            )}
          </span>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="overflow-hidden border border-[#2c353c] bg-[#13181b]">
      <div className="flex items-center gap-3 px-4 py-4">
        {hasDiff ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left transition-colors hover:bg-[#161d21] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa5c4]/60 focus-visible:ring-inset"
            onClick={toggleExpanded}
            aria-controls={diffRegionId}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} diff for ${path}`}
          >
            {headerContent}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
            {headerContent}
          </div>
        )}
      </div>
      {hasDiff && isExpanded ? (
        <div className="px-4 pb-4" id={diffRegionId}>
          <DiffViewer diffText={diffText} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders the GitHistoryDiffModal component.
 * @param state - Current state value.
 * @param onClose - onClose value.
 */
export function GitHistoryDiffModal({
  state,
  onClose,
}: {
  state: GitHistoryModalState;
  onClose: () => void;
}): JSX.Element {
  const dialogTitleId = `git-history-modal-title-${state.entry.hash}`;
  const dialogDescriptionId = `git-history-modal-description-${state.entry.hash}`;
  const dialogBodyId = `git-history-modal-body-${state.entry.hash}`;
  // Reset body key when async state transitions to force fresh dialog content lifecycle.
  const dialogBodyResetKey = `${state.projectId}:${state.worktreePath}:${state.entry.hash}:${state.loading ? "loading" : state.error ? "error" : "ready"}:${state.diffText.length}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        aria-label="Close commit diff"
        className="absolute inset-0 bg-black/65"
        onClick={onClose}
        type="button"
      />
      <dialog
        aria-describedby={dialogDescriptionId}
        aria-labelledby={dialogTitleId}
        aria-modal="true"
        className="relative mx-auto my-auto flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden border border-[#35414a] bg-[#101518] p-0 shadow-[0_24px_60px_rgba(0,0,0,0.65)]"
        open
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#2b343b] bg-[#141b1f] px-4 py-4">
          <div className="min-w-0">
            <div className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
              Commit Diff
            </div>
            <div
              className="mt-1 truncate text-sm font-semibold text-[#f2f0ef]"
              id={dialogTitleId}
            >
              {state.entry.subject}
            </div>
            <div
              className="mt-1 text-[11px] text-[#8f9aa2]"
              id={dialogDescriptionId}
            >
              {state.entry.shortHash} · {state.entry.authorName} ·{" "}
              {formatGitHistoryTimestamp(state.entry.committedAt)}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close commit diff"
            className="flex h-8 w-8 shrink-0 items-center justify-center border border-[#303940] bg-[#1a2025] text-[#acb8c1] transition-colors hover:bg-[#242d33] hover:text-[#f2f0ef]"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div
          className="app-scrollbar flex-1 overflow-auto px-4 py-4"
          id={dialogBodyId}
          key={dialogBodyResetKey}
        >
          {state.loading ? (
            <div className="border border-[#283239] bg-[#151b20] px-3 py-3 text-sm text-[#d4e4ef]">
              Loading diff...
            </div>
          ) : state.error ? (
            <div className="border border-[#5c2030] bg-[#2c1117] px-3 py-3 text-sm text-[#ff9db0]">
              {state.error}
            </div>
          ) : (
            <DiffViewer diffText={state.diffText} />
          )}
        </div>
      </dialog>
    </div>
  );
}

/**
 * Performs DesktopMessageGroups operation.
 * @param groups - groups value.
 * @param localUserLabel - localUserLabel value.
 * @param renderAssistantMessageContent - renderAssistantMessageContent value.
 */
export function DesktopMessageGroups({
  groups,
  localUserLabel,
  renderAssistantMessageContent,
}: {
  groups: MessageGroup[];
  localUserLabel: string;
  renderAssistantMessageContent: (message: VisibleMessage) => JSX.Element;
}): JSX.Element {
  // Desktop layout arranges assistant and user bubbles in two fixed columns with avatars.
  return (
    <>
      {groups.map((group) => {
        if (group.kind === "assistant") {
          return (
            <div
              className="group flex w-full min-w-0 items-start gap-6"
              key={group.key}
            >
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
                      <div className="space-y-2">
                        <div className="min-w-0 max-w-full text-sm leading-relaxed text-[#ffffff]">
                          {renderAssistantMessageContent(message)}
                        </div>
                        <AssistantMessageCopyButton message={message} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        }

        return (
          <div
            className="flex w-full min-w-0 justify-end gap-6"
            key={group.key}
          >
            <div className="min-w-0 w-full max-w-2xl space-y-3 text-right">
              <div className="font-body text-[13px] font-semibold tracking-[0.01em] text-[#b7b3b1]">
                {localUserLabel}
              </div>
              <div className="ml-auto max-w-full overflow-hidden bg-[#262626] p-4 text-left text-sm text-[#ffffff]">
                <MarkdownMessage text={group.text} />
              </div>
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#262626]">
              <span className="material-symbols-outlined text-[18px] text-[#b7b3b1]">
                person
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * Performs MobileMessageGroups operation.
 * @param groups - groups value.
 * @param localUserLabel - localUserLabel value.
 * @param renderAssistantMessageContent - renderAssistantMessageContent value.
 */
export function MobileMessageGroups({
  groups,
  localUserLabel,
  renderAssistantMessageContent,
}: {
  groups: MessageGroup[];
  localUserLabel: string;
  renderAssistantMessageContent: (message: VisibleMessage) => JSX.Element;
}): JSX.Element {
  // Mobile layout uses stacked cards to maximize readibility on narrow widths.
  return (
    <>
      {groups.map((group) => {
        if (group.kind === "assistant") {
          return (
            <div
              className="flex max-w-full flex-col items-start gap-3"
              key={group.key}
            >
              <div className="flex items-center gap-2 px-1 text-[#bdd5e6]">
                {brandBoltIcon("text-sm")}
                <span className="text-[10px] font-label font-bold uppercase tracking-wider">
                  {APP_TITLE}
                </span>
              </div>
              <div className="flex w-full flex-col gap-3">
                {group.messages.map((message) => (
                  <div
                    className={`w-full ${
                      isPlainAssistantTextMessage(message) ? "py-3" : ""
                    }`}
                    key={message.key}
                  >
                    <div className="glass-panel flex w-full flex-col gap-4 border border-[#bdd5e6]/10 p-5">
                      <div className="space-y-3">
                        <div className="text-sm leading-relaxed text-[#ffffff]">
                          {renderAssistantMessageContent(message)}
                        </div>
                        <AssistantMessageCopyButton message={message} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        return (
          <div
            className="flex max-w-[90%] self-end flex-col items-end gap-2"
            key={group.key}
          >
            <div className="flex items-center gap-2 px-1 text-[#b7b3b1]">
              <span className="font-body text-[13px] font-semibold tracking-[0.01em]">
                {localUserLabel}
              </span>
              <span className="material-symbols-outlined text-sm text-[#9f9b99]">
                account_circle
              </span>
            </div>
            <div className="rounded-tr-none bg-[#1f2020] p-4 text-sm leading-relaxed text-[#ffffff] shadow-sm">
              <MarkdownMessage text={group.text} />
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * Performs ErrorPreviewPopover operation.
 * @param text - Input text content.
 * @param x - x value.
 * @param y - y value.
 */
export function ErrorPreviewPopover({
  text,
  x,
  y,
}: {
  text: string;
  x: number;
  y: number;
}): JSX.Element {
  // Lightweight tooltip-style preview; uses fixed positioning coordinates.
  return (
    <div
      className="pointer-events-none fixed z-[110] max-w-[22rem] rounded-md border border-[#7a2030] bg-[#341019]/96 px-3 py-2 text-xs leading-5 text-[#ffb1bf] shadow-[0_18px_42px_rgba(0,0,0,0.56)] backdrop-blur-sm"
      style={{
        left: x,
        top: y,
      }}
    >
      <div className="mb-1 font-label text-[9px] uppercase tracking-[0.16em] text-[#ff8698]">
        Error Preview
      </div>
      <div className="whitespace-pre-wrap break-words">{text}</div>
    </div>
  );
}

/**
 * Performs ThreadSummaryPopover operation.
 * @param title - title value.
 * @param summary - summary value.
 * @param x - x value.
 * @param y - y value.
 */
export function ThreadSummaryPopover({
  title,
  summary,
  x,
  y,
}: {
  title: string;
  summary: string;
  x: number;
  y: number;
}): JSX.Element {
  // Position-aware summary tooltip with title + summary content.
  return (
    <div
      className="pointer-events-none fixed z-[108] hidden max-w-[22rem] rounded-md border border-[#31404a] bg-[#13191d]/96 px-3 py-3 text-xs leading-5 text-[#d6e7f2] shadow-[0_18px_42px_rgba(0,0,0,0.56)] backdrop-blur-sm md:block"
      style={{
        left: x,
        top: y,
      }}
    >
      <div className="mb-1 font-label text-[9px] uppercase tracking-[0.16em] text-[#8fb5cd]">
        Thread Summary
      </div>
      <div className="mb-2 text-sm font-semibold text-[#f2f0ef]">{title}</div>
      <div className="whitespace-pre-wrap break-words text-[#bfd1dc]">
        {summary}
      </div>
    </div>
  );
}
