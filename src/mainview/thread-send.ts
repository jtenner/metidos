/**
 * @file src/mainview/thread-send.ts
 * @description Thread send turn orchestration for Mainview.
 */

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  ProjectProcedures,
  RpcChatThreadMessage,
  RpcModelOption,
  RpcThread,
  RpcThreadDetail,
  RpcThreadMessage,
  RpcThreadRunStatus,
} from "../bun/rpc-schema";
import { resolveChatPromptText } from "../shared/chat-images";
import { logClientError } from "./client-logging";
import { mergeThreadMessageHistory } from "./app/transcript-state";
import {
  readChatComposerDraft,
  setChatComposerDraft,
} from "./controls/chat-composer-draft-store";
import {
  clearChatComposerImageAttachments,
  readChatComposerImageAttachments,
  readChatComposerPendingImageAttachmentReads,
  setChatComposerImageAttachments,
  waitForChatComposerImageAttachments,
} from "./controls/chat-composer-image-attachments";
import { findCodexModel } from "./controls/codex-utils";
import { buildSelectedThreadDetailRefreshKey } from "./thread-status-refresh";

type ThreadSendFailureSelectionOptions = {
  requestedThreadId: number;
  selectedThreadId: number | null;
};

type SentThreadDetailSelectionOptions = ThreadSendFailureSelectionOptions & {
  detail: Pick<RpcThreadDetail, "thread">;
};

type OptimisticUserMessageInput = {
  createdAt: string;
  id: number;
  images?: RpcChatThreadMessage["images"];
  text: string;
  threadId: number;
};

type SendThreadTurnProcedures = Pick<ProjectProcedures, "sendThreadMessage">;

export const SEND_THREAD_MESSAGE_TIMEOUT_MS = 120_000;

function logChatImageSendEvent(
  event: string,
  details?: Record<string, unknown>,
): void {
  console.info("[metidos chat images]", event, details ?? {});
}

function warnChatImageSendEvent(
  event: string,
  details?: Record<string, unknown>,
): void {
  console.warn("[metidos chat images]", event, details ?? {});
}

type SendThreadTurnOptions = {
  activeCodexModel: string;
  codexModels: RpcModelOption[];
  draftKey?: string | null;
  initialChatInput: string;
  isSending: boolean;
  optimisticThreadMessageIdRef: MutableRefObject<number>;
  procedures: SendThreadTurnProcedures;
  selectedThread: RpcThread | null;
  selectedThreadDetailRefreshKeyRef: MutableRefObject<string | null>;
  selectedThreadIdRef: MutableRefObject<number | null>;
  selectedThreadIsWorking: boolean;
  selectedThreadRunStateRef: MutableRefObject<RpcThreadRunStatus["state"]>;
  setChatError: Dispatch<SetStateAction<string>>;
  setIsSending: Dispatch<SetStateAction<boolean>>;
  setThreadMessages: Dispatch<SetStateAction<RpcThreadMessage[]>>;
  ensureSelectedThread?: (() => Promise<RpcThreadDetail | null>) | undefined;
  getThreadById?: ((threadId: number) => RpcThread | null) | undefined;
  upsertThread: (thread: RpcThread) => void;
};

/**
 * Only surface a send-message failure in the current workspace when the failed
 * request still targets the selected thread.
 */
export function shouldApplyThreadSendFailureToSelection(
  options: ThreadSendFailureSelectionOptions,
): boolean {
  return options.selectedThreadId === options.requestedThreadId;
}

/**
 * Only replace the visible transcript when the send completion still belongs
 * to the selected thread that initiated the request.
 */
export function shouldApplySentThreadDetailToSelection(
  options: SentThreadDetailSelectionOptions,
): boolean {
  return (
    shouldApplyThreadSendFailureToSelection(options) &&
    options.detail.thread.id === options.requestedThreadId
  );
}

export function buildOptimisticUserThreadMessage(
  input: OptimisticUserMessageInput,
): RpcChatThreadMessage {
  return {
    id: input.id,
    threadId: input.threadId,
    role: "user",
    kind: "chat",
    itemId: null,
    text: input.text,
    ...(input.images && input.images.length > 0
      ? { images: input.images }
      : {}),
    state: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

export function hydrateSentThreadDetailImagePayloads(
  detail: RpcThreadDetail,
  input: string,
  images: NonNullable<RpcChatThreadMessage["images"]>,
): RpcThreadDetail {
  if (images.length === 0 || detail.messages.length === 0) {
    return detail;
  }

  let matched = false;
  const messages = [...detail.messages];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const messageImages = message?.kind === "chat" ? message.images : null;
    if (
      !message ||
      message.kind !== "chat" ||
      message.role !== "user" ||
      message.text !== input ||
      !messageImages ||
      messageImages.length !== images.length
    ) {
      continue;
    }

    const hydratedImages = messageImages.map((image, imageIndex) =>
      image.data
        ? image
        : {
            ...image,
            data: images[imageIndex]?.data ?? "",
            dataLoaded: true,
          },
    );

    messages[index] = {
      ...message,
      images: hydratedImages,
    };
    matched = true;
    break;
  }

  return matched ? { ...detail, messages } : detail;
}

export function removeOptimisticThreadMessageById<
  Message extends { id: number },
>(messages: readonly Message[], messageId: number): Message[] {
  let removed = false;
  const next: Message[] = [];
  for (const message of messages) {
    if (message.id === messageId) {
      removed = true;
      continue;
    }
    next.push(message);
  }
  return removed ? next : [...messages];
}

export function isPersistedThreadId(threadId: number | null): boolean {
  return typeof threadId === "number" && threadId > 0;
}

export function sendThreadTurn({
  activeCodexModel,
  codexModels,
  draftKey,
  ensureSelectedThread,
  initialChatInput,
  isSending,
  optimisticThreadMessageIdRef,
  procedures,
  selectedThread,
  selectedThreadDetailRefreshKeyRef,
  selectedThreadIdRef,
  selectedThreadIsWorking,
  selectedThreadRunStateRef,
  setChatError,
  setIsSending,
  setThreadMessages,
  getThreadById,
  upsertThread,
}: SendThreadTurnOptions): void {
  const text = readChatComposerDraft(initialChatInput, draftKey).trim();
  const pendingImageReads =
    readChatComposerPendingImageAttachmentReads(draftKey);
  const initialImages = readChatComposerImageAttachments(draftKey);
  if (pendingImageReads > 0 || initialImages.length > 0) {
    logChatImageSendEvent("sendThreadTurn starting with image state", {
      draftKey: draftKey ?? null,
      initialImageCount: initialImages.length,
      initialImages: initialImages.map((image) => ({
        byteSize: image.byteSize,
        id: image.id,
        mimeType: image.mimeType,
        type: image.type,
      })),
      pendingImageReads,
    });
  }
  if (isSending || selectedThreadIsWorking) {
    return;
  }
  if (!text && pendingImageReads === 0 && initialImages.length === 0) {
    return;
  }
  const activeSelectedThreadId = selectedThreadIdRef.current;
  const initialThreadId = isPersistedThreadId(activeSelectedThreadId)
    ? activeSelectedThreadId
    : null;
  if (!initialThreadId && !ensureSelectedThread) {
    setChatError("Create or select a thread before sending a message.");
    return;
  }
  const previousThread = initialThreadId
    ? (getThreadById?.(initialThreadId) ??
      (selectedThread?.id === initialThreadId ? selectedThread : null))
    : null;
  const optimisticStartedAt = new Date().toISOString();
  const optimisticMessageId = optimisticThreadMessageIdRef.current;
  optimisticThreadMessageIdRef.current -= 1;
  setIsSending(true);
  setChatError("");
  void (async () => {
    let sendingThreadId = initialThreadId;
    let targetThread = previousThread;
    let pendingImages = initialImages;
    try {
      if (pendingImageReads > 0) {
        logChatImageSendEvent("Waiting for pending image reads before send", {
          draftKey: draftKey ?? null,
          pendingImageReads,
        });
        await waitForChatComposerImageAttachments(draftKey);
      }
      pendingImages = readChatComposerImageAttachments(draftKey);
      logChatImageSendEvent("Resolved image attachments for send", {
        imageCount: pendingImages.length,
        images: pendingImages.map((image) => ({
          byteSize: image.byteSize,
          id: image.id,
          mimeType: image.mimeType,
          type: image.type,
        })),
      });
      const pendingInput = resolveChatPromptText(text, pendingImages.length);
      if (!pendingInput) {
        warnChatImageSendEvent("Send aborted because resolved input is empty", {
          imageCount: pendingImages.length,
        });
        return;
      }
      if (pendingImages.length > 0) {
        const activeModel = findCodexModel(codexModels, activeCodexModel);
        if (activeModel?.supportsImageInput !== true) {
          warnChatImageSendEvent(
            "Send rejected because active model metadata lacks image support",
            {
              activeCodexModel,
              imageCount: pendingImages.length,
            },
          );
          setChatError("Current model does not support images.");
          return;
        }
      }
      const pendingDisplayText = pendingInput;
      setChatComposerDraft("", draftKey);
      clearChatComposerImageAttachments(draftKey);
      if (!sendingThreadId) {
        const createdDetail = await ensureSelectedThread?.();
        if (!createdDetail) {
          throw new Error(
            "Create or select a thread before sending a message.",
          );
        }
        sendingThreadId = createdDetail.thread.id;
        targetThread = createdDetail.thread;
        upsertThread(createdDetail.thread);
      }
      if (sendingThreadId === null) {
        throw new Error("Create or select a thread before sending a message.");
      }
      const requestThreadId = sendingThreadId;

      setThreadMessages((current) => [
        ...current,
        buildOptimisticUserThreadMessage({
          createdAt: optimisticStartedAt,
          id: optimisticMessageId,
          images: pendingImages.map(({ data, mimeType, type }) => ({
            data,
            mimeType,
            type,
          })),
          text: pendingDisplayText,
          threadId: requestThreadId,
        }),
      ]);
      if (targetThread) {
        selectedThreadRunStateRef.current = "working";
        upsertThread({
          ...targetThread,
          updatedAt: optimisticStartedAt,
          runStatus: {
            ...targetThread.runStatus,
            state: "working",
            startedAt: optimisticStartedAt,
            updatedAt: optimisticStartedAt,
            error: null,
            hasUnreadError: false,
          },
        });
      }

      const sentImages = pendingImages.map(({ data, mimeType, type }) => ({
        data,
        mimeType,
        type,
      }));
      logChatImageSendEvent("Calling sendThreadMessage RPC", {
        imageCount: sentImages.length,
        images: sentImages.map((image) => ({
          base64Length: image.data.length,
          mimeType: image.mimeType,
          type: image.type,
        })),
        threadId: requestThreadId,
      });
      const detail = hydrateSentThreadDetailImagePayloads(
        await procedures.sendThreadMessage(
          {
            threadId: requestThreadId,
            input: pendingInput,
            images: sentImages,
          },
          { timeoutMs: SEND_THREAD_MESSAGE_TIMEOUT_MS },
        ),
        pendingInput,
        sentImages,
      );
      logChatImageSendEvent("sendThreadMessage RPC resolved", {
        messageCount: detail.messages.length,
        threadId: detail.thread.id,
      });
      upsertThread(detail.thread);
      if (
        shouldApplySentThreadDetailToSelection({
          detail,
          requestedThreadId: requestThreadId,
          selectedThreadId: selectedThreadIdRef.current,
        })
      ) {
        selectedThreadRunStateRef.current = detail.thread.runStatus.state;
        selectedThreadDetailRefreshKeyRef.current =
          buildSelectedThreadDetailRefreshKey(detail.thread);
        setThreadMessages((current) =>
          mergeThreadMessageHistory(
            removeOptimisticThreadMessageById(current, optimisticMessageId),
            detail.messages,
          ),
        );
      }
    } catch (error) {
      warnChatImageSendEvent("sendThreadTurn failed", {
        error: error instanceof Error ? error.message : String(error),
        pendingImageCount: pendingImages.length,
        pendingImages: pendingImages.map((image) => ({
          byteSize: image.byteSize,
          id: image.id,
          mimeType: image.mimeType,
          type: image.type,
        })),
        sendingThreadId,
      });
      if (
        sendingThreadId === null ||
        shouldApplyThreadSendFailureToSelection({
          requestedThreadId: sendingThreadId,
          selectedThreadId: selectedThreadIdRef.current,
        })
      ) {
        setThreadMessages((current) =>
          removeOptimisticThreadMessageById(current, optimisticMessageId),
        );
        if (previousThread) {
          selectedThreadRunStateRef.current = previousThread.runStatus.state;
          upsertThread(previousThread);
        }
        setChatError(error instanceof Error ? error.message : String(error));
        if (!readChatComposerDraft("", draftKey)) {
          setChatComposerDraft(text, draftKey);
        }
        if (readChatComposerImageAttachments(draftKey).length === 0) {
          warnChatImageSendEvent(
            "Restoring image attachments after send failure",
            {
              imageCount: pendingImages.length,
            },
          );
          setChatComposerImageAttachments(pendingImages, draftKey);
        }
      } else {
        if (!readChatComposerDraft("", draftKey)) {
          setChatComposerDraft(text, draftKey);
        }
        if (readChatComposerImageAttachments(draftKey).length === 0) {
          warnChatImageSendEvent(
            "Restoring image attachments after stale-selection send failure",
            {
              imageCount: pendingImages.length,
            },
          );
          setChatComposerImageAttachments(pendingImages, draftKey);
        }
        logClientError(
          "Failed to send message for stale thread selection",
          error,
          {
            context: `threadId:${sendingThreadId}`,
          },
        );
      }
    } finally {
      setIsSending(false);
    }
  })();
}
