/**
 * @file src/mainview/app/chat-workspace.tsx
 * @description Module for chat workspace.
 */

import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { AppButton } from "../controls/button";
import {
  type CSSProperties,
  type FormEvent,
  type JSX,
  lazy,
  memo,
  type PointerEvent,
  Suspense,
  type TouchEvent,
  type UIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import type {
  RpcModelOption,
  RpcPluginAccessGroupOption,
  RpcReasoningEffort,
  RpcReasoningEffortOption,
  RpcTerminal,
  RpcThreadPermissionDescriptor,
} from "../../bun/rpc-schema";
import {
  describeChatImageAttachments,
  estimateBase64ByteLength,
  formatBytes,
} from "../../shared/chat-images";
import { brandLogoIcon } from "../controls/brand-logo";
import { ContextUsageMeter } from "../controls/ContextUsageMeter";
import { ChatComposerControl } from "../controls/chat-composer-control";
import { copyTextToClipboard } from "../controls/clipboard";
import { CodexModelSelector } from "../controls/codex-model-selector";
import { findCodexModel } from "../controls/codex-utils";
import { materialSymbol } from "../controls/icons";
import { ModalDialogSurface, PopoverSurface } from "../controls/popover";
import {
  ThreadAccessControl,
  type ThreadAccessValue,
} from "../controls/thread-access-control";
import { useDynamicCssVariablesClassName } from "../dynamic-css-variables";
import { mergeClassNames } from "../dynamic-styles";
import type { ThreadExtensionUiWidget } from "../thread-extension-ui";
import {
  type ChatTranscriptScrollDirection,
  type ChatTranscriptScrollState,
  captureTranscriptViewportAnchor,
  deriveChatTranscriptScrollState,
  deriveTranscriptHeightDeltaAdjustedScrollTop,
  isChatTranscriptAtBottom,
  restoreTranscriptViewportAnchorScrollTop,
  shouldForcePinChatTranscript,
  shouldNotAdjustScrollPositionOnTranscriptItemSizeChange,
  shouldRepinChatTranscriptOnItemSizeChange,
  type TranscriptViewportAnchor,
} from "./chat-transcript-scroll";
import { APP_TITLE } from "./mainview-ui-state";
import { useBase64ObjectUrl } from "./base64-object-url";
import { MarkdownMessage, TranscriptMessageContent } from "./message-ui";
import {
  buildTranscriptItemViewModels,
  deriveGroupedVisibleMessages,
  type GroupedVisibleMessagesCache,
  type TranscriptItemViewModel,
  type TranscriptPipelineGroup as TranscriptMessageGroup,
} from "./transcript-pipeline";
import type { InteractionMode } from "./use-terminals-controller";
import type {
  VisibleMediaPayloads,
  VisibleMessage,
} from "./visible-message-state";

const TerminalWorkspace = lazy(async () => {
  const module = await import("./terminal-workspace");
  return { default: module.TerminalWorkspace };
});

type SharedChatControlsProps = {
  activeCodexModel: string;
  activeReasoningEffort: RpcReasoningEffort;
  availablePluginAccessGroups?: RpcPluginAccessGroupOption[];
  availableThreadPermissionDescriptors?: RpcThreadPermissionDescriptor[];
  availableSkills?: string[] | undefined;
  composerActionDisabled: boolean;
  composerActionLabel: string;
  composerDisabled: boolean;
  composerDraftKey: string;
  hasSelectedThread: boolean;
  initialChatInput: string;
  isRefreshingModelCatalog?: boolean;
  isWorking: boolean;
  modelControlError: string;
  modelSelectorDisabled: boolean;
  onChangeModel: (value: string) => boolean | Promise<boolean>;
  onChangeReasoningEffort: (
    value: RpcReasoningEffort,
  ) => boolean | Promise<boolean>;
  onChangeThreadAccess: (value: ThreadAccessValue) => void;
  onRefreshModelCatalog?: () => void | Promise<void>;
  onComposerDraftChange?: (value: string) => void;
  onRequestMessageContent: (threadId: number, messageId: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitMessage: () => void;
  reasoningEffortControlError: string;
  reasoningEffortSelectorDisabled: boolean;
  reasoningEfforts: RpcReasoningEffortOption[];
  threadAccessControlError: string;
  threadAccessControlDisabled: boolean;
  threadAccessValue: ThreadAccessValue;
  showUnsafeModeControl: boolean;
  codexModels: RpcModelOption[];
  homeDirectory: string;
  supportsTildePath: boolean;
  extensionHiddenThinkingLabel: string | null;
  extensionStatusEntries: Array<{
    key: string;
    text: string;
  }>;
  extensionWidgetsAbove: ThreadExtensionUiWidget[];
  extensionWidgetsBelow: ThreadExtensionUiWidget[];
};

/**
 * Shared props for both desktop and mobile chat views.
 */
type TranscriptProps = {
  activeThreadId: number | null;
  expandedItemIds: ReadonlySet<string>;
  extensionHiddenThinkingLabel: string | null;
  homeDirectory: string;
  localUserLabel: string;
  supportsTildePath: boolean;
  mediaPayloads: VisibleMediaPayloads;
  messages: VisibleMessage[];
  transcriptIsBusy: boolean;
  onRequestMessageContent: (threadId: number, messageId: number) => void;
  onToggleItemExpanded: (messageKey: string) => void;
  paddingEndPx: number;
  paddingStartPx: number;
  scrollContainerClassName: string;
  scrollContainerStyle?: CSSProperties;
  topContent?: JSX.Element | null;
  variant: "desktop" | "mobile";
};

/** Renders the content portion for a single assistant-visible transcript item. */
type AssistantMessageRenderer = (item: TranscriptItemViewModel) => JSX.Element;

/**
 * Properties needed to render one grouped row in the transcript.
 */
type GroupRowProps = {
  activeThreadId: number | null;
  group: TranscriptMessageGroup;
  isLast: boolean;
  localUserLabel: string;
  mediaPayloads: VisibleMediaPayloads;
  items: TranscriptItemViewModel[];
  onRequestMessageContent: (threadId: number, messageId: number) => void;
  renderAssistantMessageContent: AssistantMessageRenderer;
};

type UnsafeModePopoverVisibilityOptions = {
  checked: boolean;
  isAnchorFocused: boolean;
  isAnchorHovered: boolean;
};

// Transcript groups vary widely (plain text, code, images); this estimate is
// only the virtualizer's first-pass seed before ResizeObserver measurement.
const CHAT_TRANSCRIPT_ESTIMATE_SIZE_PX = 160;
const estimateChatTranscriptRowSize = (): number =>
  CHAT_TRANSCRIPT_ESTIMATE_SIZE_PX;
const DESKTOP_CHAT_TRANSCRIPT_OVERSCAN = 10;
// Mobile devices have tighter CPU/layout budgets and smaller viewports, so keep
// fewer already-measured transcript groups mounted while still retaining enough
// buffer to avoid blanking during fast touch scrolls.
const MOBILE_CHAT_TRANSCRIPT_OVERSCAN = 5;
const DESKTOP_CHAT_PADDING_PX = 32;
const CHAT_TRANSCRIPT_TRAILING_SCROLL_SPACE_VH = 15;
const DESKTOP_TRANSCRIPT_GROUP_GAP_CLASS_NAME = "pb-10";
const DESKTOP_TRANSCRIPT_GROUP_LAST_CLASS_NAME = "pb-0";

export function shouldRenderUnsafeModePopover({
  checked,
  isAnchorFocused,
  isAnchorHovered,
}: UnsafeModePopoverVisibilityOptions): boolean {
  return checked && (isAnchorFocused || isAnchorHovered);
}

/**
 * Reads user group message data for text, attachments, and accessibility labels.
 */
function readUserGroupMessage(
  group: Extract<TranscriptMessageGroup, { kind: "user" }>,
  items: TranscriptItemViewModel[],
): Extract<VisibleMessage, { kind: "chat" }> | null {
  const message = items[group.messageIndex]?.message;
  return message?.kind === "chat" ? message : null;
}

function describeUserGroupAccessibilityLabel(
  group: Extract<TranscriptMessageGroup, { kind: "user" }>,
  items: TranscriptItemViewModel[],
): string {
  const message = readUserGroupMessage(group, items);
  return message
    ? describeTranscriptMessageAccessibilityLabel(message)
    : "User message";
}

function normalizeTranscriptAnnouncementText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateTranscriptAnnouncementText(
  text: string,
  maxLength = 140,
): string {
  const normalized = normalizeTranscriptAnnouncementText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function readTranscriptStateLabel(
  state: "completed" | "failed" | "in_progress" | "stopped",
): string {
  switch (state) {
    case "in_progress":
      return "in progress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
  }
}

export function describeTranscriptMessageAccessibilityLabel(
  message: VisibleMessage,
): string {
  if (message.kind === "chat") {
    const imageCount = message.images?.length ?? 0;
    const imageSuffix =
      imageCount > 0 ? ` with ${describeChatImageAttachments(imageCount)}` : "";
    if (message.speaker === "user") {
      return `User message${imageSuffix}: ${truncateTranscriptAnnouncementText(message.text)}`;
    }
    if (message.tone === "working") {
      return `Assistant status: ${truncateTranscriptAnnouncementText(message.text || "Processing")}`;
    }
    if (message.tone === "error") {
      return `Assistant error: ${truncateTranscriptAnnouncementText(message.text)}`;
    }
    if (message.tone === "notice") {
      return `Assistant notice: ${truncateTranscriptAnnouncementText(message.text)}`;
    }
    return `Assistant message: ${truncateTranscriptAnnouncementText(message.text)}`;
  }
  if (message.kind === "reasoning") {
    return `Reasoning ${readTranscriptStateLabel(message.state)}: ${truncateTranscriptAnnouncementText(message.text)}`;
  }
  if (message.kind === "command") {
    return `Command ${readTranscriptStateLabel(message.state)}: ${truncateTranscriptAnnouncementText(message.command)}`;
  }
  if (message.kind === "file_change") {
    return `${message.changeKind} file change ${readTranscriptStateLabel(message.state)} for ${message.path}`;
  }
  if (message.kind === "tool_call") {
    return `Tool call ${readTranscriptStateLabel(message.state)}: ${message.server}.${message.tool}`;
  }
  if (message.kind === "web_search") {
    return `Web search ${readTranscriptStateLabel(message.state)}: ${truncateTranscriptAnnouncementText(message.query)}`;
  }
  return `Error ${readTranscriptStateLabel(message.state)}: ${truncateTranscriptAnnouncementText(message.text)}`;
}

function hasImportantTranscriptUpdate(
  previousMessage: VisibleMessage,
  nextMessage: VisibleMessage,
): boolean {
  if (previousMessage.kind !== nextMessage.kind) {
    return true;
  }

  switch (nextMessage.kind) {
    case "chat": {
      if (previousMessage.kind !== "chat") {
        return true;
      }
      if (nextMessage.speaker === "user") {
        return false;
      }
      return (
        previousMessage.speaker !== nextMessage.speaker ||
        previousMessage.tone !== nextMessage.tone ||
        (nextMessage.tone !== "normal" &&
          previousMessage.text !== nextMessage.text)
      );
    }
    case "reasoning":
      return (
        previousMessage.kind !== "reasoning" ||
        previousMessage.state !== nextMessage.state ||
        previousMessage.text !== nextMessage.text
      );
    case "command":
      return (
        previousMessage.kind !== "command" ||
        previousMessage.state !== nextMessage.state
      );
    case "file_change":
      return (
        previousMessage.kind !== "file_change" ||
        previousMessage.state !== nextMessage.state
      );
    case "tool_call":
      return (
        previousMessage.kind !== "tool_call" ||
        previousMessage.state !== nextMessage.state
      );
    case "web_search":
      return (
        previousMessage.kind !== "web_search" ||
        previousMessage.state !== nextMessage.state
      );
    case "error":
      return (
        previousMessage.kind !== "error" ||
        previousMessage.state !== nextMessage.state ||
        previousMessage.text !== nextMessage.text
      );
  }
}

export function deriveTranscriptLiveAnnouncement({
  currentMessages,
  previousMessages,
}: {
  currentMessages: VisibleMessage[];
  previousMessages: VisibleMessage[];
}): string | null {
  const currentTailMessage = currentMessages.at(-1) ?? null;
  if (!currentTailMessage) {
    return null;
  }

  const previousTailMessage = previousMessages.at(-1) ?? null;

  if (previousTailMessage?.key === currentTailMessage.key) {
    return hasImportantTranscriptUpdate(previousTailMessage, currentTailMessage)
      ? describeTranscriptMessageAccessibilityLabel(currentTailMessage)
      : null;
  }

  let latestAnnouncement: string | null = null;

  if (
    previousMessages.length === 0 ||
    (previousMessages.length < currentMessages.length &&
      currentMessages[previousMessages.length - 1]?.key ===
        previousTailMessage?.key)
  ) {
    for (
      let index = previousMessages.length;
      index < currentMessages.length;
      index += 1
    ) {
      const message = currentMessages[index];
      if (!message || (message.kind === "chat" && message.speaker === "user")) {
        continue;
      }
      latestAnnouncement = describeTranscriptMessageAccessibilityLabel(message);
    }

    return latestAnnouncement;
  }

  for (let index = 0; index < currentMessages.length; index += 1) {
    const message = currentMessages[index];
    if (!message) {
      continue;
    }

    const previousMessage = previousMessages[index];
    if (!previousMessage || previousMessage.key !== message.key) {
      if (message.kind === "chat" && message.speaker === "user") {
        continue;
      }
      latestAnnouncement = describeTranscriptMessageAccessibilityLabel(message);
      continue;
    }

    if (hasImportantTranscriptUpdate(previousMessage, message)) {
      latestAnnouncement = describeTranscriptMessageAccessibilityLabel(message);
    }
  }

  return latestAnnouncement;
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
    previous.activeThreadId !== next.activeThreadId ||
    previous.group.kind !== next.group.kind ||
    previous.isLast !== next.isLast ||
    previous.localUserLabel !== next.localUserLabel ||
    previous.mediaPayloads !== next.mediaPayloads ||
    previous.onRequestMessageContent !== next.onRequestMessageContent ||
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
      if (previous.items[index] !== next.items[index]) {
        return false;
      }
    }

    return true;
  }

  if (previous.group.kind === "user" && next.group.kind === "user") {
    return (
      previous.group.messageIndex === next.group.messageIndex &&
      previous.group.key === next.group.key &&
      previous.items[previous.group.messageIndex] ===
        next.items[next.group.messageIndex]
    );
  }

  return false;
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

function UserChatImageAttachmentFigure({
  byteSize,
  data,
  index,
  mimeType,
  payloadKey,
  previewByteSize,
  previewMimeType,
  onOpen,
}: {
  byteSize: number;
  data: string;
  index: number;
  mimeType: string;
  payloadKey: string;
  previewByteSize?: number | undefined;
  previewMimeType?: string | undefined;
  onOpen: (target: ChatImageShadowboxTarget) => void;
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
  target,
  onClose,
}: {
  target: ChatImageShadowboxTarget | null;
  onClose: () => void;
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

function UserChatImageAttachments({
  activeThreadId,
  images,
  mediaPayloads,
  messageId,
  onRequestMessageContent,
}: {
  activeThreadId: number | null;
  images: NonNullable<Extract<VisibleMessage, { kind: "chat" }>["images"]>;
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
          <UserChatImageAttachmentFigure
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

function UserMessageContent({
  activeThreadId,
  mediaPayloads,
  message,
  onRequestMessageContent,
}: {
  activeThreadId: number | null;
  mediaPayloads: VisibleMediaPayloads;
  message: Extract<VisibleMessage, { kind: "chat" }> | null;
  onRequestMessageContent: (threadId: number, messageId: number) => void;
}): JSX.Element {
  const text = message?.text ?? "";
  const images = message?.images ?? [];

  return (
    <div className={images.length > 0 ? "space-y-3" : undefined}>
      {text ? <MarkdownMessage text={text} /> : null}
      {images.length > 0 ? (
        <UserChatImageAttachments
          activeThreadId={activeThreadId}
          images={images}
          mediaPayloads={mediaPayloads}
          messageId={message?.messageId}
          onRequestMessageContent={onRequestMessageContent}
        />
      ) : null}
    </div>
  );
}

const DesktopTranscriptGroupRow = memo(function DesktopTranscriptGroupRow({
  activeThreadId,
  group,
  isLast,
  localUserLabel,
  mediaPayloads,
  items,
  onRequestMessageContent,
  renderAssistantMessageContent,
}: GroupRowProps): JSX.Element {
  const groupBaseId = `transcript-group-${group.key}`;
  const speakerId = `${groupBaseId}-speaker`;
  const groupSummaryId = `${groupBaseId}-summary`;

  // Desktop rows separate assistant and user turns into distinct alignment/typography paths.
  return (
    <section
      aria-describedby={groupSummaryId}
      aria-labelledby={speakerId}
      className={mergeClassNames(
        "mx-auto w-full max-w-4xl min-w-0",
        isLast
          ? DESKTOP_TRANSCRIPT_GROUP_LAST_CLASS_NAME
          : DESKTOP_TRANSCRIPT_GROUP_GAP_CLASS_NAME,
      )}
    >
      {group.kind === "assistant" ? (
        <div className="group flex w-full min-w-0 items-start gap-6">
          <div className="mt-1 flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden">
            {brandLogoIcon("h-full w-full")}
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <h2
              className="uppercase-label-sm font-semibold text-accent-strong"
              id={speakerId}
            >
              {APP_TITLE}
            </h2>
            <p className="sr-only" id={groupSummaryId}>
              Assistant turn with {group.endIndex - group.startIndex} updates.
            </p>
            <div className="space-y-3">
              {Array.from(
                { length: group.endIndex - group.startIndex },
                (_, offset) => items[group.startIndex + offset],
              ).map((item) => {
                if (!item) {
                  return null;
                }

                const message = item.message;
                const messageLabelId = `transcript-message-${message.key}-label`;

                return (
                  <article
                    aria-labelledby={messageLabelId}
                    className={`min-w-0 ${item.isPlainAssistantText ? "py-3" : ""}`}
                    key={message.key}
                  >
                    <span className="sr-only" id={messageLabelId}>
                      {describeTranscriptMessageAccessibilityLabel(message)}
                    </span>
                    <div className="space-y-2">
                      <div className="min-w-0 max-w-full text-sm leading-relaxed text-text-primary">
                        {renderAssistantMessageContent(item)}
                      </div>
                      {item.isPlainAssistantText ? (
                        <AssistantMessageCopyButton
                          text={message.kind === "chat" ? message.text : ""}
                        />
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex w-full min-w-0 justify-end gap-6">
          <div className="min-w-0 w-full max-w-2xl space-y-3 text-right">
            <h2
              className="font-body text-[13px] font-semibold tracking-[0.01em] text-text-secondary"
              id={speakerId}
            >
              {localUserLabel}
            </h2>
            <p className="sr-only" id={groupSummaryId}>
              User turn.
            </p>
            <article
              aria-labelledby={`${groupBaseId}-message-label`}
              className="ml-auto max-w-full overflow-hidden bg-user-bubble p-4 text-left text-sm text-text-primary"
            >
              <span className="sr-only" id={`${groupBaseId}-message-label`}>
                {describeUserGroupAccessibilityLabel(group, items)}
              </span>
              <UserMessageContent
                activeThreadId={activeThreadId}
                mediaPayloads={mediaPayloads}
                message={readUserGroupMessage(group, items)}
                onRequestMessageContent={onRequestMessageContent}
              />
            </article>
          </div>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center bg-user-bubble">
            {materialSymbol("person")}
          </div>
        </div>
      )}
    </section>
  );
}, areGroupRowPropsEqual);

const MobileTranscriptGroupRow = memo(function MobileTranscriptGroupRow({
  activeThreadId,
  group,
  isLast,
  localUserLabel,
  mediaPayloads,
  items,
  onRequestMessageContent,
  renderAssistantMessageContent,
}: GroupRowProps): JSX.Element {
  const groupBaseId = `transcript-group-${group.key}`;
  const speakerId = `${groupBaseId}-speaker`;
  const groupSummaryId = `${groupBaseId}-summary`;

  // Mobile keeps cards narrower with larger spacing tuned for touch and small screens.
  return (
    <section
      aria-describedby={groupSummaryId}
      aria-labelledby={speakerId}
      className={mergeClassNames(
        "w-full",
        isLast
          ? MOBILE_TRANSCRIPT_GROUP_LAST_CLASS_NAME
          : MOBILE_TRANSCRIPT_GROUP_GAP_CLASS_NAME,
      )}
    >
      {group.kind === "assistant" ? (
        <div className="flex w-full max-w-full flex-col items-start gap-2">
          <div className="flex items-center gap-2 px-[2px] text-accent-strong">
            {brandLogoIcon("h-4 w-4")}
            <h2
              className="text-[10px] font-label font-semibold uppercase tracking-[0.1em]"
              id={speakerId}
            >
              {APP_TITLE}
            </h2>
          </div>
          <p className="sr-only" id={groupSummaryId}>
            Assistant turn with {group.endIndex - group.startIndex} updates.
          </p>
          <div
            className={mergeClassNames(
              "flex w-full flex-col",
              MOBILE_TRANSCRIPT_GROUP_ITEM_GAP_CLASS_NAME,
            )}
          >
            {Array.from(
              { length: group.endIndex - group.startIndex },
              (_, offset) => items[group.startIndex + offset],
            ).map((item) => {
              if (!item) {
                return null;
              }

              const message = item.message;
              const messageLabelId = `transcript-message-${message.key}-label`;

              if (item.isPlainAssistantText) {
                return (
                  <article
                    aria-labelledby={messageLabelId}
                    className="w-full bg-user-bubble px-[10px] py-[10px]"
                    key={message.key}
                  >
                    <span className="sr-only" id={messageLabelId}>
                      {describeTranscriptMessageAccessibilityLabel(message)}
                    </span>
                    <div className="space-y-2">
                      <div className="text-sm leading-relaxed text-text-primary">
                        {renderAssistantMessageContent(item)}
                      </div>
                      <AssistantMessageCopyButton
                        text={message.kind === "chat" ? message.text : ""}
                      />
                    </div>
                  </article>
                );
              }

              return (
                <article
                  aria-labelledby={messageLabelId}
                  className="w-full"
                  key={message.key}
                >
                  <span className="sr-only" id={messageLabelId}>
                    {describeTranscriptMessageAccessibilityLabel(message)}
                  </span>
                  {renderAssistantMessageContent(item)}
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex w-full justify-end">
          <div className="flex max-w-[92%] flex-col items-end gap-2">
            <div className="flex items-center gap-2 px-[2px] text-text-secondary">
              <h2
                className="font-body text-[13px] font-semibold tracking-[0.01em]"
                id={speakerId}
              >
                {localUserLabel}
              </h2>
              {materialSymbol("account_circle", "text-sm text-text-muted")}
            </div>
            <p className="sr-only" id={groupSummaryId}>
              User turn.
            </p>
            <article
              aria-labelledby={`${groupBaseId}-message-label`}
              className="w-fit max-w-full bg-user-bubble px-[10px] py-[10px] text-sm leading-relaxed text-text-primary "
            >
              <span className="sr-only" id={`${groupBaseId}-message-label`}>
                {describeUserGroupAccessibilityLabel(group, items)}
              </span>
              <UserMessageContent
                activeThreadId={activeThreadId}
                mediaPayloads={mediaPayloads}
                message={readUserGroupMessage(group, items)}
                onRequestMessageContent={onRequestMessageContent}
              />
            </article>
          </div>
        </div>
      )}
    </section>
  );
}, areGroupRowPropsEqual);

function AssistantMessageCopyButton({ text }: { text: string }): JSX.Element {
  const anchorRef = useRef<HTMLDivElement | null>(null);
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
    <div ref={anchorRef} className="inline-flex items-center">
      <AppButton
        unstyled
        aria-label="Copy assistant message"
        className="inline-flex items-center gap-1 rounded-sm border border-border-default bg-surface-2 px-2 py-1 text-[10px] font-medium tracking-wide text-text-muted transition-colors hover:border-border-default hover:bg-surface-1 hover:text-text-secondary"
        onClick={onCopy}
        title="Copy this message"
        type="button"
      >
        {materialSymbol("description", "text-[13px] leading-none")}
        <span>Copy</span>
      </AppButton>
      <PopoverSurface
        className={`pointer-events-none z-20 rounded-sm border border-border-default bg-surface-2 px-2 py-1 text-[10px] whitespace-nowrap text-accent transition-opacity duration-450 ${
          isCopyPopoverFading ? "opacity-0" : "opacity-100"
        }`}
        offsetPx={8}
        open={showCopied}
        placement="right"
        reference={anchorRef.current}
        role="status"
      >
        Message copied.
      </PopoverSurface>
    </div>
  );
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
        <div className="status-pill" key={entry.key}>
          <span className="text-text-faint">{entry.key}</span>
          <span className="mx-1 text-text-faint">/</span>
          <span className="text-text-primary">{entry.text}</span>
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
          className="border border-border-subtle bg-surface-1 px-3 py-3 text-sm text-text-secondary"
          key={widget.key}
        >
          <div className="mb-2 font-label text-[10px] uppercase tracking-[0.1em] text-accent">
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

const ChatTranscriptVirtualRow = memo(function ChatTranscriptVirtualRow({
  children,
  index,
  measureElement,
  startPx,
  transcriptScrollMarginPx,
}: {
  children: JSX.Element;
  index: number;
  measureElement: (node: HTMLLIElement | null) => void;
  startPx: number;
  transcriptScrollMarginPx: number;
}): JSX.Element {
  const rowClassName = useDynamicCssVariablesClassName(
    {
      "--chat-transcript-row-y": `${startPx - transcriptScrollMarginPx}px`,
    },
    {
      className:
        "chat-transcript-virtual-row absolute left-0 top-0 w-full list-none",
      prefix: "chat-transcript-virtual-row-vars",
    },
  );

  return (
    <li className={rowClassName} data-index={index} ref={measureElement}>
      {children}
    </li>
  );
});

const ChatTranscript = memo(function ChatTranscript({
  activeThreadId,
  expandedItemIds,
  extensionHiddenThinkingLabel,
  homeDirectory,
  localUserLabel,
  mediaPayloads,
  messages,
  transcriptIsBusy,
  onRequestMessageContent,
  onToggleItemExpanded,
  paddingEndPx,
  paddingStartPx,
  scrollContainerClassName,
  scrollContainerStyle,
  supportsTildePath,
  topContent = null,
  variant,
}: TranscriptProps): JSX.Element {
  /**
   * Keeps transcript scrolling local while always rendering the live message
   * list. Scroll state only controls whether we auto-follow the latest tail.
   */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const logRegionRef = useRef<HTMLDivElement | null>(null);
  const scrollStateRef = useRef<ChatTranscriptScrollState>("pinned");
  const viewportAnchorRef = useRef<TranscriptViewportAnchor | null>(null);
  const previousMeasuredGroupHeightsRef = useRef<Map<string, number>>(
    new Map(),
  );
  const transcriptVirtualizerRef = useRef<Virtualizer<
    HTMLDivElement,
    HTMLLIElement
  > | null>(null);
  const lastObservedScrollTopRef = useRef(0);
  const manualScrollDirectionRef =
    useRef<ChatTranscriptScrollDirection>("none");
  const previousThreadIdRef = useRef<number | null>(activeThreadId);
  const previousTailMessageKeyRef = useRef<string | null>(
    messages[messages.length - 1]?.key ?? null,
  );
  const previousAnnouncementThreadIdRef = useRef<number | null>(activeThreadId);
  const previousAnnouncementMessagesRef = useRef<VisibleMessage[]>(messages);
  const announcementTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const [transcriptScrollMarginPx, setTranscriptScrollMarginPx] = useState(0);
  const touchScrollYRef = useRef<number | null>(null);
  const groupedMessagesCacheRef = useRef<GroupedVisibleMessagesCache | null>(
    null,
  );
  const autoScrollResetRafRef = useRef<number | null>(null);
  const autoScrollGenerationRef = useRef(0);
  const pinnedResizeScrollRafRef = useRef<number | null>(null);
  const isAutoScrollingRef = useRef(false);
  const transcriptDescriptionId = "chat-transcript-description";
  const groupedMessagesCache = deriveGroupedVisibleMessages(
    activeThreadId,
    messages,
    groupedMessagesCacheRef.current,
  );
  groupedMessagesCacheRef.current = groupedMessagesCache;
  const groupedMessages = groupedMessagesCache.groups;
  const groupedMessageKeys = useMemo(
    () => groupedMessages.map((group) => group.key),
    [groupedMessages],
  );
  const groupedMessageKeysRef = useRef<readonly string[]>(groupedMessageKeys);
  // ResizeObserver measurements may be delivered after a React render that has
  // already replaced the transcript groups. Keep the latest keys in a ref so
  // scroll anchoring never relies on a stale measured-row closure.
  groupedMessageKeysRef.current = groupedMessageKeys;
  const transcriptItems = useMemo(
    () => buildTranscriptItemViewModels(messages, expandedItemIds),
    [expandedItemIds, messages],
  );
  const canVirtualizeTranscript =
    typeof window !== "undefined" && typeof document !== "undefined";

  const renderAssistantMessageContent = useCallback(
    (item: TranscriptItemViewModel): JSX.Element => (
      <TranscriptMessageContent
        activeThreadId={activeThreadId}
        extensionHiddenThinkingLabel={extensionHiddenThinkingLabel}
        homeDirectory={homeDirectory}
        item={item}
        mediaPayloads={mediaPayloads}
        onRequestMessageContent={onRequestMessageContent}
        onToggleItemExpanded={onToggleItemExpanded}
        supportsTildePath={supportsTildePath}
      />
    ),
    [
      activeThreadId,
      extensionHiddenThinkingLabel,
      homeDirectory,
      mediaPayloads,
      onRequestMessageContent,
      onToggleItemExpanded,
      supportsTildePath,
    ],
  );

  const finishProgrammaticScroll = useCallback((): void => {
    if (typeof window === "undefined") {
      autoScrollGenerationRef.current += 1;
      isAutoScrollingRef.current = false;
      autoScrollResetRafRef.current = null;
      return;
    }

    if (autoScrollResetRafRef.current !== null) {
      window.cancelAnimationFrame(autoScrollResetRafRef.current);
    }

    // Resize and pinned-scroll paths may schedule multiple programmatic scrolls
    // in one frame. A generation token prevents an old RAF from clearing the
    // auto-scroll guard after a newer programmatic scroll has taken over.
    const generation = autoScrollGenerationRef.current + 1;
    autoScrollGenerationRef.current = generation;
    autoScrollResetRafRef.current = window.requestAnimationFrame(() => {
      if (autoScrollGenerationRef.current !== generation) {
        return;
      }
      isAutoScrollingRef.current = false;
      autoScrollResetRafRef.current = null;
    });
  }, []);

  const setProgrammaticScrollTop = useCallback(
    (nextScrollTop: number): void => {
      const container = scrollRef.current;
      if (!container) {
        return;
      }

      const clampedScrollTop = Math.max(nextScrollTop, 0);
      if (Math.abs(container.scrollTop - clampedScrollTop) <= 0.5) {
        return;
      }

      isAutoScrollingRef.current = true;
      manualScrollDirectionRef.current = "none";
      container.scrollTop = clampedScrollTop;
      lastObservedScrollTopRef.current = container.scrollTop;
      finishProgrammaticScroll();
    },
    [finishProgrammaticScroll],
  );

  const schedulePinnedResizeScrollToBottom = useCallback((): void => {
    if (typeof window === "undefined") {
      return;
    }
    if (pinnedResizeScrollRafRef.current !== null) {
      window.cancelAnimationFrame(pinnedResizeScrollRafRef.current);
    }

    pinnedResizeScrollRafRef.current = window.requestAnimationFrame(() => {
      pinnedResizeScrollRafRef.current = null;
      const container = scrollRef.current;
      if (!container || scrollStateRef.current !== "pinned") {
        return;
      }
      setProgrammaticScrollTop(container.scrollHeight);
    });
  }, [setProgrammaticScrollTop]);

  const measureTranscriptRowElement = useCallback(
    (
      element: HTMLLIElement,
      _entry: ResizeObserverEntry | undefined,
      instance: Virtualizer<HTMLDivElement, HTMLLIElement>,
    ): number => {
      // This TanStack version exposes the adjustment hook on the instance; set it before resizeItem runs.
      instance.shouldAdjustScrollPositionOnItemSizeChange =
        shouldNotAdjustScrollPositionOnTranscriptItemSizeChange;
      const nextHeight = element.offsetHeight;
      const itemIndex = Number(element.dataset.index ?? -1);
      const currentGroupKeys = groupedMessageKeysRef.current;
      const groupKey = currentGroupKeys[itemIndex];

      if (groupKey) {
        const previousHeight =
          previousMeasuredGroupHeightsRef.current.get(groupKey);
        previousMeasuredGroupHeightsRef.current.set(groupKey, nextHeight);

        if (previousHeight !== undefined) {
          const heightDelta = nextHeight - previousHeight;
          const nextScrollTop = deriveTranscriptHeightDeltaAdjustedScrollTop({
            anchor: viewportAnchorRef.current,
            currentItemKeys: currentGroupKeys,
            currentScrollTop: scrollRef.current?.scrollTop ?? 0,
            delta: heightDelta,
            resizedItemIndex: itemIndex,
            scrollState: scrollStateRef.current,
          });

          if (nextScrollTop !== null) {
            setProgrammaticScrollTop(nextScrollTop);
          } else if (
            shouldRepinChatTranscriptOnItemSizeChange({
              delta: heightDelta,
              scrollState: scrollStateRef.current,
            })
          ) {
            schedulePinnedResizeScrollToBottom();
          }
        } else if (
          shouldRepinChatTranscriptOnItemSizeChange({
            delta: nextHeight,
            scrollState: scrollStateRef.current,
          })
        ) {
          schedulePinnedResizeScrollToBottom();
        }
      }

      return nextHeight;
    },
    [schedulePinnedResizeScrollToBottom, setProgrammaticScrollTop],
  );

  const getTranscriptItemKey = useCallback(
    (index: number) => groupedMessages[index]?.key ?? index,
    [groupedMessages],
  );
  const getTranscriptScrollElement = useCallback(() => scrollRef.current, []);
  const transcriptVirtualizer = useVirtualizer<HTMLDivElement, HTMLLIElement>({
    count: groupedMessages.length,
    estimateSize: estimateChatTranscriptRowSize,
    getItemKey: getTranscriptItemKey,
    getScrollElement: getTranscriptScrollElement,
    initialRect: {
      height: 768,
      width: 0,
    },
    measureElement: measureTranscriptRowElement,
    overscan:
      variant === "mobile"
        ? MOBILE_CHAT_TRANSCRIPT_OVERSCAN
        : DESKTOP_CHAT_TRANSCRIPT_OVERSCAN,
    scrollMargin: transcriptScrollMarginPx,
    useAnimationFrameWithResizeObserver: true,
  });
  transcriptVirtualizerRef.current = transcriptVirtualizer;
  const virtualRows = transcriptVirtualizer.getVirtualItems();
  const totalVirtualSize = transcriptVirtualizer.getTotalSize();

  const renderTranscriptGroupRow = useCallback(
    (group: TranscriptMessageGroup, index: number): JSX.Element =>
      variant === "desktop" ? (
        <DesktopTranscriptGroupRow
          activeThreadId={activeThreadId}
          group={group}
          isLast={index === groupedMessages.length - 1}
          localUserLabel={localUserLabel}
          mediaPayloads={mediaPayloads}
          items={transcriptItems}
          onRequestMessageContent={onRequestMessageContent}
          renderAssistantMessageContent={renderAssistantMessageContent}
        />
      ) : (
        <MobileTranscriptGroupRow
          activeThreadId={activeThreadId}
          group={group}
          isLast={index === groupedMessages.length - 1}
          localUserLabel={localUserLabel}
          mediaPayloads={mediaPayloads}
          items={transcriptItems}
          onRequestMessageContent={onRequestMessageContent}
          renderAssistantMessageContent={renderAssistantMessageContent}
        />
      ),
    [
      activeThreadId,
      groupedMessages.length,
      localUserLabel,
      mediaPayloads,
      transcriptItems,
      onRequestMessageContent,
      renderAssistantMessageContent,
      variant,
    ],
  );

  const updateScrollState = useCallback((container: HTMLDivElement): void => {
    if (isAutoScrollingRef.current) {
      return;
    }

    const nextScrollTop = container.scrollTop;
    const observedScrollDirection: ChatTranscriptScrollDirection =
      nextScrollTop < lastObservedScrollTopRef.current
        ? "up"
        : nextScrollTop > lastObservedScrollTopRef.current
          ? "down"
          : "none";
    const currentScrollState = scrollStateRef.current;
    const nextScrollState = deriveChatTranscriptScrollState({
      atBottom: isChatTranscriptAtBottom(container),
      currentState: currentScrollState,
      manualScrollDirection: manualScrollDirectionRef.current,
      observedScrollDirection,
    });

    scrollStateRef.current = nextScrollState;
    lastObservedScrollTopRef.current = nextScrollTop;
    manualScrollDirectionRef.current = "none";

    if (nextScrollState === "free") {
      viewportAnchorRef.current = captureTranscriptViewportAnchor(
        nextScrollTop,
        (transcriptVirtualizerRef.current?.getVirtualItems() ?? []).map(
          (item) => ({
            end: item.end,
            index: item.index,
            key: String(item.key),
            size: item.size,
            start: item.start,
          }),
        ),
      );
      return;
    }

    viewportAnchorRef.current = null;
  }, []);

  const handleTouchEndCapture = useCallback((): void => {
    touchScrollYRef.current = null;
  }, []);

  const handleTouchMoveCapture = useCallback(
    (event: TouchEvent<HTMLDivElement>): void => {
      const touchPoint = event.touches[0];
      if (!touchPoint) {
        return;
      }

      const previousTouchY = touchScrollYRef.current;
      touchScrollYRef.current = touchPoint.clientY;
      if (previousTouchY === null) {
        return;
      }

      if (touchPoint.clientY > previousTouchY) {
        manualScrollDirectionRef.current = "up";
        scrollStateRef.current = "free";
        return;
      }
      if (touchPoint.clientY < previousTouchY) {
        manualScrollDirectionRef.current = "down";
      }
    },
    [],
  );

  const handleTouchStartCapture = useCallback(
    (event: TouchEvent<HTMLDivElement>): void => {
      const touchPoint = event.touches[0];
      touchScrollYRef.current = touchPoint?.clientY ?? null;
    },
    [],
  );

  const handleWheelCapture = useCallback(
    (event: WheelEvent<HTMLDivElement>): void => {
      if (event.deltaY < 0) {
        manualScrollDirectionRef.current = "up";
        scrollStateRef.current = "free";
        return;
      }
      if (event.deltaY > 0) {
        manualScrollDirectionRef.current = "down";
      }
    },
    [],
  );

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>): void => {
      updateScrollState(event.currentTarget);
    },
    [updateScrollState],
  );

  const scrollToBottom = useCallback((): void => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    viewportAnchorRef.current = null;
    setProgrammaticScrollTop(container.scrollHeight);
  }, [setProgrammaticScrollTop]);

  const updateTranscriptScrollMargin = useCallback((): void => {
    if (!canVirtualizeTranscript) {
      return;
    }

    const container = scrollRef.current;
    const logRegion = logRegionRef.current;
    if (!container || !logRegion) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const logRegionRect = logRegion.getBoundingClientRect();
    const nextScrollMarginPx = Math.max(
      logRegionRect.top - containerRect.top + container.scrollTop,
      0,
    );

    setTranscriptScrollMarginPx((currentScrollMarginPx) =>
      Math.abs(currentScrollMarginPx - nextScrollMarginPx) <= 0.5
        ? currentScrollMarginPx
        : nextScrollMarginPx,
    );
  }, [canVirtualizeTranscript]);

  useEffect(() => {
    const previousThreadId = previousAnnouncementThreadIdRef.current;
    const previousMessages = previousAnnouncementMessagesRef.current;
    previousAnnouncementThreadIdRef.current = activeThreadId;
    previousAnnouncementMessagesRef.current = messages;

    if (activeThreadId !== previousThreadId) {
      if (announcementTimeoutRef.current !== null) {
        clearTimeout(announcementTimeoutRef.current);
        announcementTimeoutRef.current = null;
      }
      setLiveAnnouncement("");
      return;
    }

    const nextAnnouncement = deriveTranscriptLiveAnnouncement({
      currentMessages: messages,
      previousMessages,
    });
    if (!nextAnnouncement) {
      return;
    }
    if (announcementTimeoutRef.current !== null) {
      clearTimeout(announcementTimeoutRef.current);
      announcementTimeoutRef.current = null;
    }

    setLiveAnnouncement("");
    announcementTimeoutRef.current = setTimeout(() => {
      setLiveAnnouncement(nextAnnouncement);
      announcementTimeoutRef.current = null;
    }, 0);
  }, [activeThreadId, messages]);

  useEffect(() => {
    previousMeasuredGroupHeightsRef.current.clear();
    viewportAnchorRef.current = null;
  }, []);

  useEffect(() => {
    const activeKeys = new Set(groupedMessageKeys);
    for (const measuredKey of previousMeasuredGroupHeightsRef.current.keys()) {
      if (!activeKeys.has(measuredKey)) {
        previousMeasuredGroupHeightsRef.current.delete(measuredKey);
      }
    }
  }, [groupedMessageKeys]);

  useEffect(() => {
    return () => {
      if (announcementTimeoutRef.current !== null) {
        clearTimeout(announcementTimeoutRef.current);
        announcementTimeoutRef.current = null;
      }
      if (autoScrollResetRafRef.current !== null) {
        window.cancelAnimationFrame(autoScrollResetRafRef.current);
        autoScrollResetRafRef.current = null;
      }
      if (pinnedResizeScrollRafRef.current !== null) {
        window.cancelAnimationFrame(pinnedResizeScrollRafRef.current);
        pinnedResizeScrollRafRef.current = null;
      }
      autoScrollGenerationRef.current += 1;
      isAutoScrollingRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (!canVirtualizeTranscript) {
      return;
    }
    if (typeof ResizeObserver === "undefined") {
      updateTranscriptScrollMargin();
      return;
    }

    const container = scrollRef.current;
    const logRegion = logRegionRef.current;
    if (!container || !logRegion) {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateTranscriptScrollMargin();
    });
    observer.observe(container);
    observer.observe(logRegion);
    updateTranscriptScrollMargin();

    return () => {
      observer.disconnect();
    };
  }, [canVirtualizeTranscript, updateTranscriptScrollMargin]);

  useLayoutEffect(() => {
    const tailMessage = messages[messages.length - 1] ?? null;
    if (
      shouldForcePinChatTranscript(
        activeThreadId,
        previousThreadIdRef.current,
        previousTailMessageKeyRef.current,
        tailMessage,
      )
    ) {
      scrollStateRef.current = "pinned";
      viewportAnchorRef.current = null;
    }

    previousThreadIdRef.current = activeThreadId;
    previousTailMessageKeyRef.current = tailMessage?.key ?? null;

    if (scrollStateRef.current === "pinned") {
      scrollToBottom();
      return;
    }

    const restoredScrollTop = restoreTranscriptViewportAnchorScrollTop(
      viewportAnchorRef.current,
      transcriptVirtualizer.measurementsCache.map((item) => ({
        end: item.end,
        index: item.index,
        key: String(item.key),
        size: item.size,
        start: item.start,
      })),
    );

    if (restoredScrollTop !== null) {
      setProgrammaticScrollTop(restoredScrollTop);
    }
  }, [
    activeThreadId,
    messages,
    scrollToBottom,
    setProgrammaticScrollTop,
    transcriptVirtualizer,
  ]);

  const transcriptBottomInset = `calc(${paddingEndPx}px + ${CHAT_TRANSCRIPT_TRAILING_SCROLL_SPACE_VH}vh)`;
  const transcriptScrollContainerClassName = useDynamicCssVariablesClassName(
    {
      "--chat-transcript-scroll-padding-bottom": transcriptBottomInset,
      "--chat-transcript-scroll-padding-top": `${paddingStartPx}px`,
      "--chat-transcript-scroll-margin-left": scrollContainerStyle?.marginLeft,
      "--chat-transcript-scroll-margin-right":
        scrollContainerStyle?.marginRight,
      "--chat-transcript-scroll-padding-left":
        scrollContainerStyle?.paddingLeft,
      "--chat-transcript-scroll-padding-right":
        scrollContainerStyle?.paddingRight,
    },
    {
      className: mergeClassNames(
        "chat-transcript-scroll-container",
        scrollContainerClassName,
      ),
      prefix: "chat-transcript-scroll-container-vars",
    },
  );
  const transcriptPaddingTopClassName = useDynamicCssVariablesClassName(
    {
      "--chat-transcript-padding-top": `${paddingStartPx}px`,
    },
    {
      className: "chat-transcript-padding-top w-full",
      prefix: "chat-transcript-padding-top-vars",
    },
  );
  const transcriptVirtualHeightClassName = useDynamicCssVariablesClassName(
    {
      "--chat-transcript-virtual-height": `${totalVirtualSize}px`,
    },
    {
      className: "chat-transcript-virtual-height relative w-full",
      prefix: "chat-transcript-virtual-height-vars",
    },
  );
  const transcriptBottomInsetClassName = useDynamicCssVariablesClassName(
    {
      "--chat-transcript-bottom-inset": transcriptBottomInset,
    },
    {
      className: "chat-transcript-bottom-inset",
      prefix: "chat-transcript-bottom-inset-vars",
    },
  );

  return (
    <>
      <div
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        {/* Dedicated live announcements avoid making the whole virtualized
            transcript a noisy live region for screen-reader users. */}
        {liveAnnouncement}
      </div>
      <div
        className={transcriptScrollContainerClassName}
        onTouchEndCapture={handleTouchEndCapture}
        onTouchMoveCapture={handleTouchMoveCapture}
        onTouchStartCapture={handleTouchStartCapture}
        onWheelCapture={handleWheelCapture}
        onScroll={handleScroll}
        ref={scrollRef}
      >
        <div className={transcriptPaddingTopClassName}>
          {topContent}
          <p className="sr-only" id={transcriptDescriptionId}>
            Conversation transcript. New assistant messages and tool updates are
            announced automatically.
          </p>
          <div
            aria-busy={transcriptIsBusy}
            aria-describedby={transcriptDescriptionId}
            aria-label="Conversation transcript"
            aria-relevant="additions text"
            className="w-full"
            ref={logRegionRef}
            role="log"
          >
            {canVirtualizeTranscript ? (
              <div className={transcriptVirtualHeightClassName}>
                <ol className="m-0 list-none p-0">
                  {virtualRows.map((virtualRow) => {
                    const group = groupedMessages[virtualRow.index];
                    if (!group) {
                      return null;
                    }

                    return (
                      <ChatTranscriptVirtualRow
                        index={virtualRow.index}
                        key={group.key}
                        measureElement={transcriptVirtualizer.measureElement}
                        startPx={virtualRow.start}
                        transcriptScrollMarginPx={transcriptScrollMarginPx}
                      >
                        {renderTranscriptGroupRow(group, virtualRow.index)}
                      </ChatTranscriptVirtualRow>
                    );
                  })}
                </ol>
              </div>
            ) : (
              <ol className="m-0 list-none p-0">
                {groupedMessages.map((group, index) => (
                  <li className="list-none" key={group.key}>
                    {renderTranscriptGroupRow(group, index)}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div aria-hidden="true" className={transcriptBottomInsetClassName} />
        </div>
      </div>
    </>
  );
});

type DesktopChatViewProps = SharedChatControlsProps & {
  activeContextInputTokens: number;
  activeContextWindowTokens: number;
  activeScreenSubtitlePrimary: string;
  activeScreenSubtitleSecondary: string;
  activeScreenTitle: string;
  activeThreadId: number | null;
  activeTerminalId: string | null;
  canCreateTerminal: boolean;
  expandedItemIds: ReadonlySet<string>;
  interactionMode: InteractionMode;
  localUserLabel: string;
  onCloseTerminal: (terminal: RpcTerminal) => void;
  onCreateTerminal: (options?: { copyActive?: boolean }) => void;
  onRenameTerminal: (terminalId: string, title: string) => void;
  onSelectTerminal: (terminalId: string) => void;
  onSetInteractionMode: (mode: InteractionMode) => void;
  onToggleItemExpanded: (messageKey: string) => void;
  selectedThreadIsWorking: boolean;
  mediaPayloads: VisibleMediaPayloads;
  terminalAccessAllowed: boolean;
  terminals: RpcTerminal[];
  transcriptIsBusy: boolean;
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
  activeTerminalId,
  activeThreadId,
  availablePluginAccessGroups = [],
  availableThreadPermissionDescriptors = [],
  availableSkills,
  canCreateTerminal,
  codexModels,
  composerActionDisabled,
  composerActionLabel,
  composerDisabled,
  composerDraftKey,
  homeDirectory,
  supportsTildePath,
  extensionHiddenThinkingLabel,
  extensionStatusEntries,
  extensionWidgetsAbove,
  extensionWidgetsBelow,
  expandedItemIds,
  hasSelectedThread,
  initialChatInput,
  interactionMode,
  isRefreshingModelCatalog,
  isWorking,
  localUserLabel,
  mediaPayloads,
  messages,
  modelControlError,
  modelSelectorDisabled,
  onChangeModel,
  onChangeReasoningEffort,
  onChangeThreadAccess,
  onRefreshModelCatalog,
  onCloseTerminal,
  onComposerDraftChange,
  onCreateTerminal,
  onRenameTerminal,
  onSelectTerminal,
  onSetInteractionMode,
  onSubmit,
  onSubmitMessage,
  onRequestMessageContent,
  onToggleItemExpanded,
  reasoningEffortControlError,
  reasoningEffortSelectorDisabled,
  reasoningEfforts,
  selectedThreadIsWorking,
  terminalAccessAllowed,
  terminals,
  transcriptIsBusy,
  threadAccessControlError,
  threadAccessControlDisabled,
  threadAccessValue,
  showUnsafeModeControl,
}: DesktopChatViewProps & { messages: VisibleMessage[] }): JSX.Element {
  // Header stays inside the scrollable transcript pane but outside the log region.
  const [interactionPanelHeight, setInteractionPanelHeight] = useState(() =>
    clampDesktopInteractionPanelHeight(readDesktopInteractionPanelHeight()),
  );
  const resizeStartRef = useRef<{
    height: number;
    pointerY: number;
  } | null>(null);
  const beginInteractionPanelResize = useCallback(
    (event: PointerEvent<HTMLDivElement>): void => {
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeStartRef.current = {
        height: interactionPanelHeight,
        pointerY: event.clientY,
      };
    },
    [interactionPanelHeight],
  );
  const updateInteractionPanelResize = useCallback(
    (event: PointerEvent<HTMLDivElement>): void => {
      const start = resizeStartRef.current;
      if (!start) {
        return;
      }
      const nextHeight = clampDesktopInteractionPanelHeight(
        start.height + start.pointerY - event.clientY,
      );
      setInteractionPanelHeight(nextHeight);
    },
    [],
  );
  const finishInteractionPanelResize = useCallback((): void => {
    if (!resizeStartRef.current) {
      return;
    }
    resizeStartRef.current = null;
    window.localStorage.setItem(
      DESKTOP_INTERACTION_PANEL_HEIGHT_KEY,
      String(interactionPanelHeight),
    );
  }, [interactionPanelHeight]);
  const terminalCountLabel =
    terminals.length > 0 ? ` (${terminals.length})` : "";
  const activeModelSupportsImageInput =
    findCodexModel(codexModels, activeCodexModel)?.supportsImageInput === true;

  const interactionPanelClassName = useDynamicCssVariablesClassName(
    {
      "--desktop-interaction-panel-height": `${interactionPanelHeight}px`,
    },
    {
      className:
        "desktop-interaction-panel flex shrink-0 flex-col border-t border-composer-border bg-composer-bar",
      prefix: "desktop-interaction-panel-vars",
    },
  );

  const headerContent = useMemo(
    () => (
      <div className="mx-auto w-full max-w-4xl pb-12">
        <h1 className="mb-2 font-headline text-base font-bold text-text-primary">
          {activeScreenTitle}
        </h1>
        <p className="max-w-2xl font-body text-sm text-text-muted">
          <span className="text-text-secondary">
            {activeScreenSubtitlePrimary}
          </span>
          <span className="text-text-faint">
            {" - "}
            {activeScreenSubtitleSecondary}
          </span>
        </p>
      </div>
    ),
    [
      activeScreenSubtitlePrimary,
      activeScreenSubtitleSecondary,
      activeScreenTitle,
    ],
  );

  return (
    <>
      <ChatTranscript
        key={`desktop-transcript:${activeThreadId ?? "none"}`}
        activeThreadId={activeThreadId}
        expandedItemIds={expandedItemIds}
        extensionHiddenThinkingLabel={extensionHiddenThinkingLabel}
        homeDirectory={homeDirectory}
        localUserLabel={localUserLabel}
        mediaPayloads={mediaPayloads}
        messages={messages}
        transcriptIsBusy={transcriptIsBusy}
        onRequestMessageContent={onRequestMessageContent}
        onToggleItemExpanded={onToggleItemExpanded}
        paddingEndPx={DESKTOP_CHAT_PADDING_PX}
        paddingStartPx={DESKTOP_CHAT_PADDING_PX}
        scrollContainerClassName="app-scrollbar flex-1 overflow-y-auto px-6"
        supportsTildePath={supportsTildePath}
        topContent={headerContent}
        variant="desktop"
      />
      <section className={interactionPanelClassName}>
        <div
          className="h-1 cursor-row-resize bg-border-subtle transition-colors hover:bg-accent-emphasis"
          onPointerDown={beginInteractionPanelResize}
          onPointerMove={updateInteractionPanelResize}
          onPointerUp={finishInteractionPanelResize}
        />
        <div className="flex h-9 items-center gap-4 border-b border-composer-border px-4">
          <div className="flex items-center gap-4" role="tablist">
            <AppButton
              unstyled
              aria-selected={interactionMode === "chat"}
              className={`font-label text-xs uppercase tracking-[0.1em] ${
                interactionMode === "chat"
                  ? "border-b-2 border-accent text-accent-strong"
                  : "text-text-muted hover:text-text-primary"
              }`}
              onClick={() => {
                onSetInteractionMode("chat");
              }}
              role="tab"
              type="button"
            >
              Chat
            </AppButton>
            {terminalAccessAllowed ? (
              <AppButton
                unstyled
                aria-selected={interactionMode === "terminal"}
                className={`font-label text-xs uppercase tracking-[0.1em] ${
                  interactionMode === "terminal"
                    ? "border-b-2 border-accent text-accent-strong"
                    : "text-text-muted hover:text-text-primary"
                }`}
                onClick={() => {
                  if (terminals.length === 0 && canCreateTerminal) {
                    onCreateTerminal();
                  }
                  onSetInteractionMode("terminal");
                }}
                role="tab"
                type="button"
              >
                Terminal{terminalCountLabel}
              </AppButton>
            ) : null}
          </div>
        </div>
        {terminalAccessAllowed && interactionMode === "terminal" ? (
          <Suspense
            fallback={
              <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-text-muted">
                Loading terminal…
              </div>
            }
          >
            <TerminalWorkspace
              activeTerminalId={activeTerminalId}
              canCreateTerminal={canCreateTerminal}
              onCloseTerminal={onCloseTerminal}
              onCreateTerminal={() => {
                onCreateTerminal({ copyActive: true });
              }}
              onRenameTerminal={onRenameTerminal}
              onSelectTerminal={onSelectTerminal}
              terminals={terminals}
            />
          </Suspense>
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col p-4"
            onSubmit={onSubmit}
          >
            <div className="mx-auto flex h-full w-full max-w-4xl flex-col">
              {extensionWidgetsAbove.length > 0 ? (
                <ExtensionWidgetStack widgets={extensionWidgetsAbove} />
              ) : null}
              <div className="flex items-center gap-2 border-b border-composer-border p-2">
                <div className="min-w-[20rem] max-w-[28rem]">
                  <CodexModelSelector
                    models={codexModels}
                    value={activeCodexModel}
                    disabled={modelSelectorDisabled}
                    onChange={onChangeModel}
                    onChangeReasoningEffort={onChangeReasoningEffort}
                    onRefresh={onRefreshModelCatalog}
                    reasoningDisabled={reasoningEffortSelectorDisabled}
                    reasoningOptions={reasoningEfforts}
                    reasoningValue={activeReasoningEffort}
                    refreshing={isRefreshingModelCatalog}
                    variant="desktop"
                  />
                </div>
                <ThreadAccessControl
                  availablePluginAccessGroups={availablePluginAccessGroups}
                  availableThreadPermissionDescriptors={
                    availableThreadPermissionDescriptors
                  }
                  disabled={threadAccessControlDisabled}
                  onChange={onChangeThreadAccess}
                  showUnsafeMode={showUnsafeModeControl}
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
                <div className="mt-2 text-xs text-danger-text">
                  {modelControlError}
                </div>
              ) : null}
              {reasoningEffortControlError ? (
                <div className="mt-2 text-xs text-danger-text">
                  {reasoningEffortControlError}
                </div>
              ) : null}
              {threadAccessControlError ? (
                <div className="mt-2 text-xs text-danger-text">
                  {threadAccessControlError}
                </div>
              ) : null}
              <div className="min-h-0 flex-1">
                <ChatComposerControl
                  actionDisabled={composerActionDisabled}
                  actionLabel={composerActionLabel}
                  availableSkills={availableSkills}
                  disabled={composerDisabled}
                  draftKey={composerDraftKey}
                  fillHeight
                  hasSelectedThread={hasSelectedThread}
                  initialValue={initialChatInput}
                  isWorking={selectedThreadIsWorking || isWorking}
                  onDraftChange={onComposerDraftChange}
                  onSubmitMessage={onSubmitMessage}
                  supportsImageInput={activeModelSupportsImageInput}
                  variant="desktop"
                />
              </div>
              {extensionWidgetsBelow.length > 0 ? (
                <ExtensionWidgetStack widgets={extensionWidgetsBelow} />
              ) : null}
            </div>
          </form>
        )}
      </section>
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
  mediaPayloads: VisibleMediaPayloads;
  transcriptIsBusy: boolean;
};

/**
 * Mobile chat view with a fixed composer footer and dynamic bottom inset handling.
 */

const DESKTOP_INTERACTION_PANEL_HEIGHT_KEY =
  "metidos:desktop-interaction-panel-height";
const DESKTOP_INTERACTION_PANEL_DEFAULT_HEIGHT_PX = 360;
const DESKTOP_INTERACTION_PANEL_MIN_HEIGHT_PX = 160;

function readDesktopInteractionPanelHeight(): number {
  if (typeof window === "undefined") {
    return DESKTOP_INTERACTION_PANEL_DEFAULT_HEIGHT_PX;
  }
  const parsed = Number.parseInt(
    window.localStorage.getItem(DESKTOP_INTERACTION_PANEL_HEIGHT_KEY) ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DESKTOP_INTERACTION_PANEL_DEFAULT_HEIGHT_PX;
}

function clampDesktopInteractionPanelHeight(value: number): number {
  const max =
    typeof window === "undefined"
      ? 720
      : Math.max(240, Math.floor(window.innerHeight * 0.7));
  return Math.max(
    DESKTOP_INTERACTION_PANEL_MIN_HEIGHT_PX,
    Math.min(Math.floor(value), max),
  );
}

const MOBILE_CHAT_COMPOSER_GAP_PX = 34;
const MOBILE_CHAT_COMPOSER_FALLBACK_INSET_PX = 224;
const MOBILE_CHAT_TRANSCRIPT_END_BUFFER_PX = 96;
const MOBILE_CHAT_ITEM_GAP_PX = 10;
const MOBILE_TRANSCRIPT_GROUP_GAP_CLASS_NAME = "pb-2";
const MOBILE_TRANSCRIPT_GROUP_LAST_CLASS_NAME = "pb-0";
const MOBILE_TRANSCRIPT_GROUP_ITEM_GAP_CLASS_NAME = "gap-3";
/**
 * Inset constants that counterbalance left/right frame bleed in mobile layouts.
 */
const MOBILE_CHAT_SIDE_INSET_PX = 10;
const MOBILE_CHAT_PARENT_SIDE_PADDING_PX = 16;
const MOBILE_CHAT_SIDE_BLEED_PX =
  MOBILE_CHAT_PARENT_SIDE_PADDING_PX - MOBILE_CHAT_SIDE_INSET_PX;

export function deriveMobileChatTranscriptPaddingEnd(
  composerInsetPx: number,
): number {
  return composerInsetPx + MOBILE_CHAT_TRANSCRIPT_END_BUFFER_PX;
}

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
  availablePluginAccessGroups = [],
  availableThreadPermissionDescriptors = [],
  availableSkills,
  codexModels,
  composerActionDisabled,
  composerActionLabel,
  composerDisabled,
  composerDraftKey,
  homeDirectory,
  supportsTildePath,
  extensionHiddenThinkingLabel,
  extensionStatusEntries,
  extensionWidgetsAbove,
  extensionWidgetsBelow,
  expandedItemIds,
  hasSelectedThread,
  initialChatInput,
  isRefreshingModelCatalog,
  isWorking,
  localUserLabel,
  mediaPayloads,
  messages,
  modelControlError,
  modelSelectorDisabled,
  onChangeModel,
  onChangeReasoningEffort,
  onChangeThreadAccess,
  onRefreshModelCatalog,
  onComposerDraftChange,
  onSubmit,
  onSubmitMessage,
  onRequestMessageContent,
  onToggleItemExpanded,
  reasoningEffortControlError,
  reasoningEffortSelectorDisabled,
  reasoningEfforts,
  selectedThreadIsWorking,
  threadAccessControlError,
  threadAccessControlDisabled,
  threadAccessValue,
  showUnsafeModeControl,
  transcriptIsBusy,
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
      const footerRect = footer.getBoundingClientRect();
      const footerOverlayPx = Math.max(0, window.innerHeight - footerRect.top);
      setComposerInsetPx(
        Math.max(
          MOBILE_CHAT_COMPOSER_FALLBACK_INSET_PX,
          Math.ceil(footerOverlayPx) + MOBILE_CHAT_COMPOSER_GAP_PX,
        ),
      );
    };

    // Track the full fixed-footer overlay from its top edge to the viewport
    // bottom so transcript content can scroll completely past the composer.

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

  const transcriptPaddingEndPx =
    deriveMobileChatTranscriptPaddingEnd(composerInsetPx);
  const activeModelSupportsImageInput =
    findCodexModel(codexModels, activeCodexModel)?.supportsImageInput === true;

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
        <h2 className="font-headline text-base font-bold leading-tight text-text-primary">
          {activeScreenTitle}
        </h2>
        <p className="mt-2 text-xs text-text-muted">
          <span className="text-text-secondary">
            {activeScreenSubtitlePrimary}
          </span>
          <span className="text-text-faint">
            {" - "}
            {activeScreenSubtitleSecondary}
          </span>
        </p>
      </div>
      <ChatTranscript
        key={`mobile-transcript:${activeThreadId ?? "none"}`}
        activeThreadId={activeThreadId}
        expandedItemIds={expandedItemIds}
        extensionHiddenThinkingLabel={extensionHiddenThinkingLabel}
        homeDirectory={homeDirectory}
        localUserLabel={localUserLabel}
        mediaPayloads={mediaPayloads}
        messages={messages}
        transcriptIsBusy={transcriptIsBusy}
        onRequestMessageContent={onRequestMessageContent}
        onToggleItemExpanded={onToggleItemExpanded}
        paddingEndPx={transcriptPaddingEndPx}
        paddingStartPx={MOBILE_CHAT_ITEM_GAP_PX}
        scrollContainerClassName="flex min-h-0 flex-1 overflow-y-auto"
        scrollContainerStyle={chatScrollStyle}
        supportsTildePath={supportsTildePath}
        variant="mobile"
      />
      {/* Keep the composer mounted while file diffs expand so mobile users can keep chatting. */}
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
          <div className="overflow-visible border border-border-default bg-surface-1">
            <div className="border-b border-border-subtle px-2 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <CodexModelSelector
                    models={codexModels}
                    value={activeCodexModel}
                    disabled={modelSelectorDisabled}
                    onChange={onChangeModel}
                    onChangeReasoningEffort={onChangeReasoningEffort}
                    onRefresh={onRefreshModelCatalog}
                    reasoningDisabled={reasoningEffortSelectorDisabled}
                    reasoningOptions={reasoningEfforts}
                    reasoningValue={activeReasoningEffort}
                    refreshing={isRefreshingModelCatalog}
                    variant="mobile"
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ThreadAccessControl
                    availablePluginAccessGroups={availablePluginAccessGroups}
                    availableThreadPermissionDescriptors={
                      availableThreadPermissionDescriptors
                    }
                    disabled={threadAccessControlDisabled}
                    onChange={onChangeThreadAccess}
                    showUnsafeMode={showUnsafeModeControl}
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
              availableSkills={availableSkills}
              disabled={composerDisabled}
              draftKey={composerDraftKey}
              hasSelectedThread={hasSelectedThread}
              initialValue={initialChatInput}
              isWorking={selectedThreadIsWorking || isWorking}
              onDraftChange={onComposerDraftChange}
              onSubmitMessage={onSubmitMessage}
              supportsImageInput={activeModelSupportsImageInput}
              variant="mobile"
            />
          </div>
          {extensionWidgetsBelow.length > 0 ? (
            <ExtensionWidgetStack widgets={extensionWidgetsBelow} />
          ) : null}
          {modelControlError ? (
            <div className="text-xs text-danger-text">{modelControlError}</div>
          ) : null}
          {reasoningEffortControlError ? (
            <div className="text-xs text-danger-text">
              {reasoningEffortControlError}
            </div>
          ) : null}
          {threadAccessControlError ? (
            <div className="text-xs text-danger-text">
              {threadAccessControlError}
            </div>
          ) : null}
        </form>
      </footer>
    </>
  );
}
