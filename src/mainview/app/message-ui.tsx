/**
 * @file src/mainview/app/message-ui.tsx
 * @description Module for message ui.
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import { AppButton } from "../controls/button";
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
import { copyTextToClipboard } from "../controls/clipboard";
import { materialSymbol } from "../controls/icons";
import {
  createPointReference,
  ModalDialogSurface,
  PopoverSurface,
} from "../controls/popover";
import { useDynamicCssVariablesClassName } from "../dynamic-css-variables";
import { mergeClassNames } from "../dynamic-styles";
import { MainviewErrorBoundary } from "./error-boundary";
import { useBase64ObjectUrl } from "./base64-object-url";
import {
  LazyPreparedRichMarkdownMessage,
  LazyRichMarkdownMessage,
} from "./message-markdown-loader";
import { usePreparedMessageRenderPlan } from "./message-preprocessing-client";
import {
  prepareTranscriptDiffRendering,
  prepareTranscriptFileChangeRendering,
  prepareTranscriptToolCallRendering,
  type PlainTextMessageSegment,
  routeTranscriptMarkdownText,
  splitTranscriptPlainTextMessage,
  type TranscriptDiffLineKind,
  type TranscriptDiffParseSnapshot,
  type TranscriptItemViewModel,
  type TranscriptMarkdownMessageState,
  useTranscriptDiffParseResult,
} from "./transcript-pipeline";
import {
  describeChatImageAttachments,
  estimateBase64ByteLength,
  formatBytes,
} from "../../shared/chat-images";
import type {
  VisibleChatImageAttachment,
  VisibleMediaPayloads,
} from "./visible-message-state";

const DIFF_LINE_ESTIMATE_PX = 24;
const estimateDiffLineSize = (): number => DIFF_LINE_ESTIMATE_PX;
const DIFF_VIRTUALIZATION_OVERSCAN = 20;
const MIN_VIRTUALIZED_DIFF_LINES = 80;
const MARKDOWN_LINK_CLASS_NAME =
  "text-text-secondary underline decoration-accent underline-offset-2 transition-colors hover:text-text-primary";
const INLINE_COMMAND_COPY_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-1 rounded-sm border border-border-subtle bg-surface-1 px-2 py-1 text-[10px] font-medium tracking-wide text-accent transition-colors hover:border-border-default hover:bg-surface-2 hover:text-text-secondary";
const COMMAND_PREVIEW_BORDER_PX = 1;
const COMMAND_PREVIEW_PADDING_X_PX = 12;
const PlainTextMessage = memo(function PlainTextMessage({
  segments,
  text,
}: {
  segments?: PlainTextMessageSegment[];
  text: string;
}): JSX.Element {
  const memoizedSegments = useMemo(
    () => (text.length > 2_000 ? splitTranscriptPlainTextMessage(text) : null),
    [text],
  );
  const resolvedSegments =
    segments ?? memoizedSegments ?? splitTranscriptPlainTextMessage(text);

  return (
    <div className="whitespace-pre-wrap break-words">
      {resolvedSegments.map((segment) =>
        segment.kind === "link" ? (
          <a
            aria-label={`${segment.text} (opens in a new tab)`}
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
    <div className="border border-border-subtle bg-surface-1 px-3 py-3 text-sm text-text-secondary">
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
    <MainviewErrorBoundary
      context="message-markdown:prepared"
      fallback={<PlainTextMessage text={text} />}
      message="Failed to render prepared markdown message"
    >
      <Suspense fallback={<PreparingLargeMarkdownMessage />}>
        <LazyPreparedRichMarkdownMessage plan={preprocessedMessage.plan} />
      </Suspense>
    </MainviewErrorBoundary>
  );
}

export const MarkdownMessage = memo(function MarkdownMessage({
  state = "completed",
  text,
}: {
  state?: TranscriptMarkdownMessageState | undefined;
  text: string;
}): JSX.Element {
  const renderRoute = useMemo(
    () => routeTranscriptMarkdownText({ state, text }),
    [state, text],
  );

  if (renderRoute.kind === "plain") {
    return <PlainTextMessage segments={renderRoute.segments} text={text} />;
  }

  if (renderRoute.kind === "preprocessed") {
    return <LargeMarkdownMessage text={text} />;
  }

  return (
    <MainviewErrorBoundary
      context="message-markdown:rich"
      fallback={<PlainTextMessage text={text} />}
      message="Failed to render markdown message"
    >
      <Suspense fallback={<PlainTextMessage text={text} />}>
        <LazyRichMarkdownMessage
          streaming={renderRoute.streaming}
          text={text}
        />
      </Suspense>
    </MainviewErrorBoundary>
  );
});

export function ProcessingMessage(): JSX.Element {
  return (
    <div
      aria-live="polite"
      className="inline-flex items-center gap-3 border border-border-default bg-surface-2 px-3 py-2 text-sm text-text-secondary"
      role="status"
    >
      <span aria-hidden="true" className="processing-dot-loader">
        <span />
        <span />
        <span />
      </span>
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
    <div className="border border-danger-border bg-danger-surface px-3 py-3 text-sm text-danger-text">
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
    <div className="border border-warning-border bg-warning-surface px-3 py-3 text-sm text-warning-text">
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
function diffLineClassName(kind: TranscriptDiffLineKind): string {
  if (kind === "meta") {
    return "bg-surface-1 text-text-muted";
  }
  if (kind === "file") {
    return "bg-surface-2 text-text-secondary";
  }
  if (kind === "hunk") {
    return "bg-surface-3 text-warning-text";
  }
  if (kind === "add") {
    return "bg-success-surface text-success-text";
  }
  if (kind === "remove") {
    return "bg-danger-surface text-danger-text";
  }
  return "text-text-primary";
}

/**
 * Render a unified diff block with simple line-kind based coloring.
 * Keeps lines with empty bodies as non-empty whitespace so row heights stay stable.
 */
function VirtualDiffLine({
  className,
  index,
  measureElement,
  startPx,
  text,
}: {
  className: string;
  index: number;
  measureElement: (node: HTMLDivElement | null) => void;
  startPx: number;
  text: string;
}): JSX.Element {
  const rowClassName = useDynamicCssVariablesClassName(
    {
      "--diff-virtual-row-y": `${startPx}px`,
    },
    {
      className: mergeClassNames(
        "diff-virtual-row absolute left-0 top-0 w-full font-mono px-3 py-1 whitespace-pre-wrap",
        className,
      ),
      prefix: "diff-virtual-row-vars",
    },
  );

  return (
    <div data-index={index} ref={measureElement} className={rowClassName}>
      {text || " "}
    </div>
  );
}

export function DiffViewer({
  className,
  diffText,
  parsedDiffState,
  scrollable = true,
  viewportClassName,
}: {
  className?: string;
  diffText: string;
  parsedDiffState?: TranscriptDiffParseSnapshot;
  scrollable?: boolean;
  viewportClassName?: string;
}): JSX.Element {
  const internalParsedDiffState = useTranscriptDiffParseResult(diffText);
  const effectiveParsedDiffState = parsedDiffState ?? internalParsedDiffState;
  const diffRendering = prepareTranscriptDiffRendering({
    diffText,
    parsedDiffState: effectiveParsedDiffState,
  });
  const lines = diffRendering.lines;
  const scrollRef = useRef<HTMLElement | null>(null);
  const useVirtualizedDiff =
    scrollable && lines.length >= MIN_VIRTUALIZED_DIFF_LINES;
  const getDiffScrollElement = useCallback(() => scrollRef.current, []);
  const virtualizer = useVirtualizer({
    count: lines.length,
    estimateSize: estimateDiffLineSize,
    getScrollElement: getDiffScrollElement,
    overscan: DIFF_VIRTUALIZATION_OVERSCAN,
    useAnimationFrameWithResizeObserver: true,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const diffVirtualHeightClassName = useDynamicCssVariablesClassName(
    {
      "--diff-virtual-height": `${totalSize}px`,
    },
    {
      className: "diff-virtual-height relative w-full",
      prefix: "diff-virtual-height-vars",
    },
  );

  if (diffRendering.parseState.isLoading) {
    return (
      <div
        aria-live="polite"
        className="border border-border-default bg-surface-2 px-3 py-3 text-xs text-text-secondary"
        role="status"
      >
        Preparing diff...
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="border border-border-subtle bg-surface-1 px-3 py-3 text-xs text-text-muted">
        No diff available.
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden border border-border-subtle bg-surface-1 ${className ?? ""}`.trim()}
    >
      <section
        aria-label="Diff content"
        className={`text-[11px] leading-5 ${
          scrollable
            ? `diff-scroll-container app-scrollbar overflow-auto ${
                viewportClassName ?? "max-h-[60vh] md:max-h-[28rem]"
              }`
            : `overflow-visible ${viewportClassName ?? ""}`
        }`.trim()}
        ref={scrollRef}
      >
        {useVirtualizedDiff ? (
          <div className={diffVirtualHeightClassName}>
            {virtualRows.map((virtualRow) => {
              const line = lines[virtualRow.index];
              if (!line) {
                return null;
              }

              return (
                <VirtualDiffLine
                  className={diffLineClassName(line.kind)}
                  index={virtualRow.index}
                  key={line.key}
                  measureElement={virtualizer.measureElement}
                  startPx={virtualRow.start}
                  text={line.text}
                />
              );
            })}
          </div>
        ) : (
          lines.map((line) => (
            <div
              key={line.key}
              className={`font-mono px-3 py-1 whitespace-pre-wrap ${diffLineClassName(line.kind)}`}
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
 * @param homeDirectory - homeDirectory value.
 * @param supportsTildePath - supportsTildePath value.
 * @param state - Current state value.
 */
export function ToolCallMessage({
  messageKey,
  server,
  tool,
  argumentsText,
  output,
  outputLoaded = true,
  outputImages = [],
  mediaPayloads,
  activeThreadId,
  messageId,
  onRequestMessageContent,
  homeDirectory,
  supportsTildePath,
  state,
  expanded,
  onToggleExpanded,
}: {
  messageKey: string;
  server: string;
  tool: string;
  argumentsText: string;
  output: string;
  outputLoaded?: boolean;
  outputImages?: readonly VisibleChatImageAttachment[] | undefined;
  mediaPayloads: VisibleMediaPayloads;
  activeThreadId: number | null;
  messageId: number | undefined;
  onRequestMessageContent: (threadId: number, messageId: number) => void;
  homeDirectory: string;
  state: "in_progress" | "completed" | "failed" | "stopped";
  supportsTildePath: boolean;
  expanded?: boolean;
  onToggleExpanded?: (() => void) | undefined;
}): JSX.Element {
  const hasArguments = argumentsText.trim().length > 0;
  const hasDeferredOutput = !outputLoaded;
  const hasOutput = output.trim().length > 0;
  const hasOutputImages = outputImages.length > 0;
  const hasDetails =
    hasArguments || hasOutput || hasOutputImages || hasDeferredOutput;
  const [localIsExpanded, setLocalIsExpanded] = useState(false);
  const isExpanded = expanded ?? localIsExpanded;
  const detailsRegionId = useMemo(
    () =>
      `tool-call-details-${
        messageKey
          .replaceAll(/[^a-zA-Z0-9_-]+/g, "-")
          .replaceAll(/^-+|-+$/g, "") || "content"
      }`,
    [messageKey],
  );
  const rendering = useMemo(
    () =>
      prepareTranscriptToolCallRendering({
        argumentsText,
        displayOptions: {
          homeDirectory,
          supportsTildePath,
        },
        output,
        state,
        tool,
      }),
    [argumentsText, homeDirectory, output, state, supportsTildePath, tool],
  );

  const toggleExpanded = (): void => {
    if (!hasDetails) {
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
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 uppercase-label text-accent">Tool</span>
          <span className="shrink-0 text-sm text-text-muted">-</span>
          <span className="shrink-0 font-mono text-sm text-text-primary">
            {tool}
          </span>
          {rendering.preview ? (
            <span
              className="min-w-0 flex-1 truncate font-mono text-sm text-text-muted"
              title={rendering.preview}
            >
              {rendering.preview}
            </span>
          ) : null}
        </div>
        {server !== "pi" ? (
          <div className="mt-1 text-[11px] text-text-muted">{server}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="status-pill">{rendering.stateLabel}</div>
        {hasDetails ? (
          <span className="text-text-muted">
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
    <div className="overflow-hidden border border-border-subtle bg-surface-1">
      <div className="flex items-center gap-3 px-4 py-4">
        {hasDetails ? (
          <AppButton
            unstyled
            aria-controls={detailsRegionId}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} details for ${tool}`}
            className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-inset"
            onClick={toggleExpanded}
            type="button"
          >
            {headerContent}
          </AppButton>
        ) : (
          <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
            {headerContent}
          </div>
        )}
      </div>
      {hasDetails && isExpanded ? (
        <div className="space-y-3 px-4 pb-4" id={detailsRegionId}>
          {hasArguments ? (
            <div className="space-y-2">
              <div className="uppercase-label text-accent">Arguments</div>
              <pre className="app-scrollbar max-h-[12rem] overflow-auto border border-border-subtle bg-surface-1 px-3 py-3 text-[11px] leading-5 text-text-secondary whitespace-pre-wrap font-mono">
                {rendering.displayArgumentsText}
              </pre>
            </div>
          ) : null}
          {hasDeferredOutput ? (
            <div className="border border-border-subtle bg-surface-1 px-3 py-3 text-[12px] text-text-muted">
              Loading output...
            </div>
          ) : hasOutput || hasOutputImages ? (
            <div className="space-y-2">
              <div className="uppercase-label text-accent">
                {rendering.outputLabel}
              </div>
              {hasOutput ? (
                rendering.renderOutputAsMarkdown ? (
                  <div className="app-scrollbar max-h-[16rem] overflow-auto border border-border-subtle bg-surface-1 px-3 py-3 text-[13px] leading-6 text-text-secondary">
                    <MarkdownMessage text={rendering.displayOutputText} />
                  </div>
                ) : (
                  <pre className="app-scrollbar max-h-[16rem] overflow-auto border border-border-subtle bg-surface-1 px-3 py-3 text-[11px] leading-5 text-text-secondary whitespace-pre-wrap font-mono">
                    {rendering.displayOutputText}
                  </pre>
                )
              ) : null}
              {hasOutputImages ? (
                <ChatImageAttachments
                  activeThreadId={activeThreadId}
                  images={outputImages}
                  mediaPayloads={mediaPayloads}
                  messageId={messageId}
                  onRequestMessageContent={onRequestMessageContent}
                />
              ) : null}
            </div>
          ) : null}
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
    <div
      aria-live="polite"
      className="overflow-hidden space-y-3 border border-border-default bg-surface-1 p-4"
      role="status"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 overflow-hidden">
          <div className="font-label text-[10px] uppercase tracking-[0.1em] text-accent">
            Web Search
          </div>
          <div className="mt-1 overflow-hidden whitespace-pre-wrap break-words text-sm leading-6 text-text-primary">
            {query}
          </div>
        </div>
        <div className="shrink-0 self-start status-pill">
          {webSearchStateLabel(state)}
        </div>
      </div>
    </div>
  );
}

type ChatImageShadowboxTarget = {
  byteSize: number;
  data: string;
  index: number;
  isFullLoaded: boolean;
  mimeType: string;
  payloadKey: string;
  previewByteSize?: number | undefined;
};

function isFullImagePayloadLoaded(data: string, byteSize: number): boolean {
  return data.length > 0 && estimateBase64ByteLength(data) >= byteSize;
}

function ChatImageAttachmentFigure({
  byteSize,
  data,
  index,
  mimeType,
  onOpen,
  payloadKey,
  previewByteSize,
  previewMimeType,
}: {
  byteSize: number;
  data: string;
  index: number;
  mimeType: string;
  onOpen: (target: ChatImageShadowboxTarget) => void;
  payloadKey: string;
  previewByteSize?: number | undefined;
  previewMimeType?: string | undefined;
}): JSX.Element {
  const isFullLoaded = isFullImagePayloadLoaded(data, byteSize);
  const displayMimeType = isFullLoaded
    ? mimeType
    : (previewMimeType ?? mimeType);
  const imageSource = useBase64ObjectUrl(data, displayMimeType);
  const previewLabel = previewByteSize
    ? `preview ${formatBytes(previewByteSize)}`
    : "preview";
  const openAttachment = () =>
    onOpen({
      byteSize,
      data,
      index,
      isFullLoaded,
      mimeType: displayMimeType,
      payloadKey,
      previewByteSize,
    });

  return (
    <figure className="space-y-1" key={payloadKey}>
      <AppButton
        aria-label={`Open attachment ${index + 1} full size`}
        className="block max-w-full border border-border-subtle bg-surface-2 p-0 text-left hover:border-border-strong focus-visible:ring-2 focus-visible:ring-accent"
        onClick={openAttachment}
        unstyled
      >
        {imageSource ? (
          <img
            alt={`Attachment ${index + 1} preview`}
            className="max-h-48 max-w-full object-contain"
            loading="lazy"
            src={imageSource}
          />
        ) : (
          <span className="block px-2 py-1 text-[12px] text-text-muted">
            Image preview unavailable — open to load full image
          </span>
        )}
      </AppButton>
      <figcaption className="font-mono text-[10px] text-text-muted">
        Image {index + 1} · {formatBytes(byteSize)} ·{" "}
        {isFullLoaded ? "full" : previewLabel}
      </figcaption>
    </figure>
  );
}

function ChatImageShadowbox({
  onClose,
  target,
}: {
  onClose: () => void;
  target: ChatImageShadowboxTarget | null;
}): JSX.Element | null {
  const imageSource = useBase64ObjectUrl(
    target?.data ?? "",
    target?.mimeType ?? "",
  );
  if (!target) {
    return null;
  }

  const titleId = `chat-image-shadowbox-${target.payloadKey.replace(
    /[^a-z0-9_-]/giu,
    "-",
  )}`;
  return (
    <ModalDialogSurface
      aria-labelledby={titleId}
      backdropLabel="Close image preview"
      className="relative flex max-h-[92vh] w-full max-w-5xl flex-col border border-border-default bg-bg-canvas text-text-primary shadow-overlay"
      onRequestClose={onClose}
      open
      overlayClassName="fixed inset-0 z-[170] flex items-center justify-center bg-black/70 px-4 py-6"
      restoreFocus={true}
    >
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <div>
          <div className="text-sm font-semibold" id={titleId}>
            Attachment {target.index + 1}
          </div>
          <div className="font-mono text-[11px] text-text-muted">
            {target.isFullLoaded ? "Full image" : "Loading full image…"} ·{" "}
            {formatBytes(target.byteSize)}
          </div>
        </div>
        <AppButton
          aria-label="Close image preview"
          buttonStyle="muted"
          onClick={onClose}
        >
          Close
        </AppButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {imageSource ? (
          <img
            alt={`Attachment ${target.index + 1}`}
            className="mx-auto max-h-[78vh] max-w-full object-contain"
            src={imageSource}
          />
        ) : (
          <div className="text-sm text-text-secondary">Loading image…</div>
        )}
      </div>
    </ModalDialogSurface>
  );
}

function ChatImageAttachments({
  activeThreadId,
  images,
  mediaPayloads,
  messageId,
  onRequestMessageContent,
}: {
  activeThreadId: number | null;
  images: readonly VisibleChatImageAttachment[];
  mediaPayloads: VisibleMediaPayloads;
  messageId: number | undefined;
  onRequestMessageContent: (threadId: number, messageId: number) => void;
}): JSX.Element {
  const [shadowboxTarget, setShadowboxTarget] =
    useState<ChatImageShadowboxTarget | null>(null);
  const openShadowbox = useCallback(
    (target: ChatImageShadowboxTarget) => {
      setShadowboxTarget(target);
      if (
        !target.isFullLoaded &&
        activeThreadId !== null &&
        messageId !== undefined
      ) {
        onRequestMessageContent(activeThreadId, messageId);
      }
    },
    [activeThreadId, messageId, onRequestMessageContent],
  );

  useEffect(() => {
    if (!shadowboxTarget) {
      return;
    }
    const image = images.find(
      (candidate) => candidate.payloadKey === shadowboxTarget.payloadKey,
    );
    if (!image) {
      setShadowboxTarget(null);
      return;
    }
    const data = mediaPayloads.get(image.payloadKey) ?? "";
    const isFullLoaded = isFullImagePayloadLoaded(data, image.byteSize);
    const mimeType = isFullLoaded
      ? image.mimeType
      : (image.previewMimeType ?? image.mimeType);
    if (
      data === shadowboxTarget.data &&
      isFullLoaded === shadowboxTarget.isFullLoaded &&
      mimeType === shadowboxTarget.mimeType
    ) {
      return;
    }
    setShadowboxTarget({
      byteSize: image.byteSize,
      data,
      index: shadowboxTarget.index,
      isFullLoaded,
      mimeType,
      payloadKey: image.payloadKey,
      previewByteSize: image.previewByteSize,
    });
  }, [images, mediaPayloads, shadowboxTarget]);

  return (
    <>
      <fieldset className="grid gap-2 pt-1">
        <legend className="sr-only">
          {describeChatImageAttachments(images.length)}
        </legend>
        {images.map((image, index) => (
          <ChatImageAttachmentFigure
            byteSize={image.byteSize}
            data={mediaPayloads.get(image.payloadKey) ?? ""}
            index={index}
            key={image.payloadKey}
            mimeType={image.mimeType}
            onOpen={openShadowbox}
            payloadKey={image.payloadKey}
            previewByteSize={image.previewByteSize}
            previewMimeType={image.previewMimeType}
          />
        ))}
      </fieldset>
      <ChatImageShadowbox
        onClose={() => setShadowboxTarget(null)}
        target={shadowboxTarget}
      />
    </>
  );
}

function ChatMessageWithImages({
  activeThreadId,
  mediaPayloads,
  message,
  onRequestMessageContent,
}: {
  activeThreadId: number | null;
  mediaPayloads: VisibleMediaPayloads;
  message: Extract<TranscriptItemViewModel["message"], { kind: "chat" }>;
  onRequestMessageContent: (threadId: number, messageId: number) => void;
}): JSX.Element {
  const images = message.images ?? [];
  return (
    <div className={images.length > 0 ? "space-y-3" : undefined}>
      {message.text ? (
        <MarkdownMessage state={message.state} text={message.text} />
      ) : null}
      {images.length > 0 ? (
        <ChatImageAttachments
          activeThreadId={activeThreadId}
          images={images}
          mediaPayloads={mediaPayloads}
          messageId={message.messageId}
          onRequestMessageContent={onRequestMessageContent}
        />
      ) : null}
    </div>
  );
}

type TranscriptMessageContentProps = {
  activeThreadId: number | null;
  extensionHiddenThinkingLabel: string | null;
  homeDirectory: string;
  item: TranscriptItemViewModel;
  mediaPayloads: VisibleMediaPayloads;
  onRequestMessageContent: (threadId: number, messageId: number) => void;
  onToggleItemExpanded: (messageKey: string) => void;
  supportsTildePath: boolean;
};

function maybeRequestTranscriptDeferredContent({
  activeThreadId,
  item,
  onRequestMessageContent,
}: {
  activeThreadId: number | null;
  item: TranscriptItemViewModel;
  onRequestMessageContent: (threadId: number, messageId: number) => void;
}): void {
  const { messageId, requestContent } = item.expansionState;
  if (requestContent && activeThreadId !== null && messageId !== null) {
    onRequestMessageContent(activeThreadId, messageId);
  }
}

/**
 * Renders one prepared transcript view-model item. Chat layouts own grouping,
 * spacing, and virtualization; message UI owns component composition for each
 * already-classified transcript item.
 */
export function TranscriptMessageContent({
  activeThreadId,
  extensionHiddenThinkingLabel,
  homeDirectory,
  item,
  mediaPayloads,
  onRequestMessageContent,
  onToggleItemExpanded,
  supportsTildePath,
}: TranscriptMessageContentProps): JSX.Element {
  const message = item.message;
  const { expanded, messageId, requestContent } = item.expansionState;

  useEffect(() => {
    if (
      expanded &&
      requestContent &&
      activeThreadId !== null &&
      messageId !== null
    ) {
      onRequestMessageContent(activeThreadId, messageId);
    }
  }, [
    activeThreadId,
    expanded,
    messageId,
    onRequestMessageContent,
    requestContent,
  ]);

  const toggleExpanded = (): void => {
    maybeRequestTranscriptDeferredContent({
      activeThreadId,
      item,
      onRequestMessageContent,
    });
    if (item.expansionState.itemKey) {
      onToggleItemExpanded(item.expansionState.itemKey);
    }
  };

  switch (item.model.contentKind) {
    case "chat": {
      return message.kind === "chat" ? (
        <ChatMessageWithImages
          activeThreadId={activeThreadId}
          mediaPayloads={mediaPayloads}
          message={message}
          onRequestMessageContent={onRequestMessageContent}
        />
      ) : (
        <ChatErrorMessage text="Unsupported chat transcript item." />
      );
    }
    case "status": {
      if (message.kind === "chat" && message.tone === "working") {
        return <ProcessingMessage />;
      }
      if (message.kind === "chat" && message.tone === "error") {
        return <ChatErrorMessage text={message.text} />;
      }
      if (message.kind === "chat" && message.tone === "notice") {
        return <ChatNoticeMessage text={message.text} />;
      }
      if (message.kind === "web_search") {
        return <WebSearchMessage query={message.query} state={message.state} />;
      }
      if (message.kind === "error") {
        return <ErrorItemMessage state={message.state} text={message.text} />;
      }
      return <ChatErrorMessage text="Unsupported status transcript item." />;
    }
    case "reasoning": {
      return message.kind === "reasoning" ? (
        <ReasoningMessage
          label={extensionHiddenThinkingLabel ?? "Thinking"}
          text={message.text}
        />
      ) : (
        <ChatErrorMessage text="Unsupported reasoning transcript item." />
      );
    }
    case "command": {
      return message.kind === "command" ? (
        <CommandExecutionMessage
          command={message.command}
          exitCode={message.exitCode}
          expanded={item.expansionState.expanded}
          onToggleExpanded={toggleExpanded}
          output={message.output}
          outputLoaded={message.outputLoaded}
          state={message.state}
        />
      ) : (
        <ChatErrorMessage text="Unsupported command transcript item." />
      );
    }
    case "tool_call": {
      return message.kind === "tool_call" ? (
        <ToolCallMessage
          activeThreadId={activeThreadId}
          argumentsText={message.argumentsText}
          expanded={item.expansionState.expanded}
          homeDirectory={homeDirectory}
          mediaPayloads={mediaPayloads}
          messageId={message.messageId}
          messageKey={message.key}
          onRequestMessageContent={onRequestMessageContent}
          onToggleExpanded={toggleExpanded}
          output={message.output}
          outputImages={message.outputImages}
          outputLoaded={message.outputLoaded}
          server={message.server}
          state={message.state}
          supportsTildePath={supportsTildePath}
          tool={message.tool}
        />
      ) : (
        <ChatErrorMessage text="Unsupported tool-call transcript item." />
      );
    }
    case "web_search": {
      return message.kind === "web_search" ? (
        <WebSearchMessage query={message.query} state={message.state} />
      ) : (
        <ChatErrorMessage text="Unsupported web-search transcript item." />
      );
    }
    case "error": {
      return message.kind === "error" ? (
        <ErrorItemMessage state={message.state} text={message.text} />
      ) : (
        <ChatErrorMessage text="Unsupported error transcript item." />
      );
    }
    case "file_change": {
      return message.kind === "file_change" ? (
        <FileChangeMessage
          changeKind={message.changeKind}
          diffLoaded={message.diffLoaded}
          diffText={message.diffText}
          expanded={item.expansionState.expanded}
          onToggleExpanded={toggleExpanded}
          path={message.path}
          state={message.state}
        />
      ) : (
        <ChatErrorMessage text="Unsupported file-change transcript item." />
      );
    }
  }
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
    <div className="space-y-3 border border-warning-border bg-warning-surface p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-label text-[10px] uppercase tracking-[0.1em] text-warning-text">
            Error
          </h3>
        </div>
        <div className="shrink-0 border border-warning-border bg-warning-surface px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-warning-text">
          {errorItemStateLabel(state)}
        </div>
      </div>
      <div className="text-sm leading-6 text-warning-text">{text}</div>
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
  outputLoaded = true,
  state,
  exitCode,
  expanded,
  onToggleExpanded,
}: {
  command: string;
  output: string;
  outputLoaded?: boolean;
  state: "in_progress" | "completed" | "failed" | "stopped";
  exitCode: number | null;
  expanded?: boolean;
  onToggleExpanded?: (() => void) | undefined;
}): JSX.Element {
  // Command rows should remain expandable even after a successful command
  // produces an empty output stream. Otherwise the controlled expansion state can
  // say "open" while the row hides its caret and output pane.
  const hasVisibleOutput = output.trim().length > 0;
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

  const commandPreviewClassName = useDynamicCssVariablesClassName(
    {
      "--command-preview-left": `${commandPreviewLayout.left}px`,
      "--command-preview-top": `${commandPreviewLayout.top}px`,
      "--command-preview-width": `${commandPreviewLayout.width + COMMAND_PREVIEW_PADDING_X_PX + COMMAND_PREVIEW_BORDER_PX}px`,
    },
    {
      className:
        "command-preview-popover pointer-events-none invisible absolute z-30 opacity-0 transition-opacity duration-150 group-hover/command-preview:visible group-hover/command-preview:pointer-events-auto group-hover/command-preview:opacity-100 group-focus-within/command-preview:visible group-focus-within/command-preview:pointer-events-auto group-focus-within/command-preview:opacity-100",
      prefix: "command-preview-popover-vars",
    },
  );

  return (
    <div className="relative border border-border-subtle bg-surface-1">
      <div
        className="relative flex items-start justify-between gap-4 px-4 py-4"
        ref={commandHeaderRef}
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 uppercase-label text-accent">CMD</span>
            <div className="group/command-preview min-w-0 flex-1">
              <AppButton
                unstyled
                aria-expanded={isExpanded}
                aria-label={`Toggle command output for ${command}`}
                className="block max-w-full truncate font-mono text-left text-sm text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
                onClick={toggleExpanded}
                ref={setCommandPreviewAnchor}
                type="button"
              >
                {command}
              </AppButton>
              <div className={commandPreviewClassName}>
                <div className="relative box-border w-full border border-border-default bg-surface-1 px-3 py-3 pr-16 shadow-overlay">
                  <AppButton
                    unstyled
                    aria-label="Copy full command"
                    className={`absolute right-2 top-2 ${INLINE_COMMAND_COPY_BUTTON_CLASS_NAME}`}
                    onClick={onCopyCommand}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                    }}
                    title="Copy full command"
                    type="button"
                  >
                    {materialSymbol("description", "text-[12px] leading-none")}
                    <span>{commandCopied ? "Copied" : "Copy"}</span>
                  </AppButton>
                  <div className="select-text font-mono text-sm leading-6 text-text-primary whitespace-pre-wrap break-all">
                    {command}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="status-pill">{stateLabel}</div>
          <AppButton
            unstyled
            aria-expanded={isExpanded}
            aria-label={`Toggle command output for ${command}`}
            className="flex items-center text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-inset"
            onClick={toggleExpanded}
            type="button"
          >
            {materialSymbol(
              isExpanded ? "expand_less" : "expand_more",
              "text-base",
            )}
          </AppButton>
        </div>
      </div>
      {isExpanded ? (
        <div className="px-4 pb-4">
          {!outputLoaded ? (
            <div className="border border-border-subtle bg-surface-1 px-3 py-3 text-[12px] text-text-muted">
              Loading output...
            </div>
          ) : hasVisibleOutput ? (
            <pre className="app-scrollbar max-h-[16rem] overflow-auto border border-border-subtle bg-surface-1 px-3 py-3 text-[11px] leading-5 text-text-secondary">
              {output}
            </pre>
          ) : (
            <div className="border border-border-subtle bg-surface-1 px-3 py-3 text-[12px] text-text-muted">
              No command output.
            </div>
          )}
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
  text,
}: {
  label?: string;
  text: string;
}): JSX.Element {
  // Render internal reasoning with the same markdown path as assistant messages.
  return (
    <div className="border border-border-subtle bg-surface-1 px-4 py-3">
      <h3 className="uppercase-label text-accent">{label}</h3>
      <div className="mt-2 text-sm leading-6 text-text-secondary">
        <MarkdownMessage text={text} />
      </div>
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
  diffLoaded = true,
  changeKind,
  state,
  expanded,
  onToggleExpanded,
}: {
  path: string;
  diffText: string;
  diffLoaded?: boolean;
  changeKind: "add" | "delete" | "update";
  state: "in_progress" | "completed" | "failed" | "stopped";
  expanded?: boolean;
  onToggleExpanded?: (() => void) | undefined;
}): JSX.Element {
  const rendering = useMemo(
    () =>
      prepareTranscriptFileChangeRendering({
        changeKind,
        diffLoaded,
        diffText,
        path,
        state,
      }),
    [changeKind, diffLoaded, diffText, path, state],
  );
  const [localIsExpanded, setLocalIsExpanded] = useState(false);
  const isExpanded = expanded ?? localIsExpanded;
  // Keep IDs stable/deterministic for aria-controls and screen-reader navigation.
  const toggleExpanded = (): void => {
    if (!rendering.hasDiff) {
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
      <div className="min-w-0 flex-1">
        <div className="uppercase-label text-accent">
          File Change -{" "}
          <span className="font-mono text-text-primary break-words">
            {path}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 self-start">
        <div className="status-pill">{rendering.stateLabel}</div>
        {rendering.hasDiff ? (
          <span className="text-text-muted">
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
    <div className="overflow-hidden border border-border-subtle bg-surface-1">
      <div className="flex items-center gap-3 px-4 py-4">
        {rendering.hasDiff ? (
          <AppButton
            unstyled
            type="button"
            className="flex min-w-0 flex-1 items-start justify-between gap-4 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-inset"
            onClick={toggleExpanded}
            aria-controls={rendering.diffRegionId}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} diff for ${path}`}
          >
            {headerContent}
          </AppButton>
        ) : (
          <div className="flex min-w-0 flex-1 items-start justify-between gap-4">
            {headerContent}
          </div>
        )}
      </div>
      {rendering.hasDiff && isExpanded ? (
        <div className="px-4 pb-4" id={rendering.diffRegionId}>
          {!diffLoaded ? (
            <div className="border border-border-subtle bg-surface-1 px-3 py-3 text-[12px] text-text-muted">
              Loading diff...
            </div>
          ) : (
            <DiffViewer diffText={diffText} />
          )}
        </div>
      ) : null}
    </div>
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
    <PopoverSurface
      className="pointer-events-none z-[110] max-w-[22rem] rounded-sm border border-danger-border bg-danger-surface px-3 py-2 text-xs leading-5 text-danger-text shadow-overlay backdrop-blur-sm"
      offsetPx={0}
      open={true}
      placement="bottom-start"
      reference={createPointReference({
        x,
        y,
      })}
    >
      <div className="mb-1 uppercase-label text-danger-text">Error Preview</div>
      <div className="whitespace-pre-wrap break-words">{text}</div>
    </PopoverSurface>
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
    <PopoverSurface
      className="pointer-events-none z-[108] hidden max-w-[22rem] rounded-sm border border-border-default bg-surface-overlay px-3 py-3 text-xs leading-5 text-text-secondary shadow-overlay backdrop-blur-sm md:block"
      offsetPx={0}
      open={true}
      placement="bottom-start"
      reference={createPointReference({
        x,
        y,
      })}
    >
      <div className="mb-1 uppercase-label text-accent">Thread Summary</div>
      <div className="mb-2 text-sm font-semibold text-text-primary">
        {title}
      </div>
      <div className="whitespace-pre-wrap break-words text-text-secondary">
        {summary}
      </div>
    </PopoverSurface>
  );
}
