/**
 * @file src/mainview/app/use-visible-messages.ts
 * @description Visible thread-message mapping and cache extraction for App.tsx.
 */

import { useEffect, useMemo, useRef } from "react";
import type {
  RpcProject,
  RpcThread,
  RpcThreadMessage,
} from "../../bun/rpc-schema";
import { APP_TITLE, type VisibleMessage } from "./state";

export function mergeThreadMessageHistory(
  current: RpcThreadMessage[],
  incoming: RpcThreadMessage[],
): RpcThreadMessage[] {
  if (incoming.length === 0) {
    return current;
  }
  if (current.length === 0) {
    return incoming;
  }

  const currentLastMessageId = current[current.length - 1]?.id ?? 0;
  const incomingFirstMessageId = incoming[0]?.id ?? 0;
  if (currentLastMessageId < incomingFirstMessageId) {
    let canAppendIncomingRange = true;
    let previousMessageId = currentLastMessageId;
    for (const message of incoming) {
      if (message.id <= previousMessageId) {
        canAppendIncomingRange = false;
        break;
      }
      previousMessageId = message.id;
    }
    if (canAppendIncomingRange) {
      return [...current, ...incoming];
    }
  }

  const messagesById = new Map<number, RpcThreadMessage>();
  for (const message of current) {
    messagesById.set(message.id, message);
  }
  for (const message of incoming) {
    messagesById.set(message.id, message);
  }

  return Array.from(messagesById.values()).sort(
    (left, right) => left.id - right.id,
  );
}

type VisibleMessageCacheEntry = {
  signature: string;
  value: VisibleMessage;
};

function readCachedVisibleMessage(
  cache: Map<string, VisibleMessageCacheEntry>,
  cacheKey: string,
  signature: string,
  createValue: () => VisibleMessage,
): VisibleMessage {
  const existing = cache.get(cacheKey);
  if (existing && existing.signature === signature) {
    return existing.value;
  }

  const nextValue = createValue();
  cache.set(cacheKey, {
    signature,
    value: nextValue,
  });
  return nextValue;
}

function threadMessageVisibleSignature(message: RpcThreadMessage): string {
  switch (message.kind) {
    case "reasoning":
      return `reasoning:${message.state}:${message.text}`;
    case "command":
      return `command:${message.state}:${message.exitCode ?? "null"}:${message.command}:${message.output}`;
    case "file_change":
      return `file_change:${message.state}:${message.changeKind}:${message.path}:${message.diffText}`;
    case "tool_call":
      return `tool_call:${message.state}:${message.server}:${message.tool}:${message.argumentsText}:${message.output}`;
    case "web_search":
      return `web_search:${message.state}:${message.query}`;
    case "error":
      return `error:${message.state}:${message.text}`;
    case "chat":
      return `chat:${message.state}:${message.role}:${message.text}`;
  }
}

function buildThreadVisibleMessage(message: RpcThreadMessage): VisibleMessage {
  const key = `thread-message:${message.id}`;
  switch (message.kind) {
    case "reasoning":
      return {
        key,
        kind: "reasoning",
        text: message.text,
        state: message.state,
      };
    case "command":
      return {
        key,
        kind: "command",
        command: message.command,
        output: message.output,
        state: message.state,
        exitCode: message.exitCode,
      };
    case "file_change":
      return {
        key,
        kind: "file_change",
        path: message.path,
        diffText: message.diffText,
        changeKind: message.changeKind,
        state: message.state,
      };
    case "tool_call":
      return {
        key,
        kind: "tool_call",
        server: message.server,
        tool: message.tool,
        argumentsText: message.argumentsText,
        output: message.output,
        state: message.state,
      };
    case "web_search":
      return {
        key,
        kind: "web_search",
        query: message.query,
        state: message.state,
      };
    case "error":
      return {
        key,
        kind: "error",
        text: message.text,
        state: message.state,
      };
    case "chat":
      return {
        key,
        kind: "chat",
        speaker: message.role,
        tone: "normal",
        text: message.text,
      };
  }
}

type UseVisibleMessagesParams = {
  activeChatError: string;
  activeChatNotice: string;
  activeSelectedWorktreeFolder: string;
  activeSelectedWorktreePath: string | null;
  activeThreadWorkingMessage: string | null | undefined;
  isThreadLoading: boolean;
  selectedProject: RpcProject | null;
  selectedThread: RpcThread | null;
  selectedThreadId: number | null;
  threadMessages: RpcThreadMessage[];
};

/**
 * Map thread detail plus shell-level loading/error affordances into visible rows
 * while reusing stable cached row objects when their signatures are unchanged.
 */
export function useVisibleMessages({
  activeChatError,
  activeChatNotice,
  activeSelectedWorktreeFolder,
  activeSelectedWorktreePath,
  activeThreadWorkingMessage,
  isThreadLoading,
  selectedProject,
  selectedThread,
  selectedThreadId,
  threadMessages,
}: UseVisibleMessagesParams): VisibleMessage[] {
  const visibleMessageCacheRef = useRef(
    new Map<string, VisibleMessageCacheEntry>(),
  );

  useEffect(() => {
    void selectedThreadId;
    visibleMessageCacheRef.current.clear();
  }, [selectedThreadId]);

  return useMemo<VisibleMessage[]>(() => {
    const visibleMessageCache = visibleMessageCacheRef.current;
    let messages: VisibleMessage[];
    const hasInProgressAssistantChat = threadMessages.some(
      (message) =>
        message.kind === "chat" &&
        message.role === "assistant" &&
        message.state === "in_progress",
    );
    if (isThreadLoading) {
      messages = [
        readCachedVisibleMessage(
          visibleMessageCache,
          `thread-loading:${selectedThreadId ?? "none"}`,
          "chat:normal:assistant:Loading thread history...",
          () => ({
            key: `thread-loading:${selectedThreadId ?? "none"}`,
            kind: "chat",
            speaker: "assistant",
            tone: "normal",
            text: "Loading thread history...",
          }),
        ),
      ];
    } else if (!selectedThread) {
      const emptyThreadMessageText = selectedProject
        ? `Use the Threads panel or the selected worktree popover in the sidebar to create or open a ${APP_TITLE} thread.`
        : "Add a project, choose a worktree, and create a thread to begin.";
      messages = [
        readCachedVisibleMessage(
          visibleMessageCache,
          `thread-empty:${selectedProject?.id ?? "none"}:${activeSelectedWorktreePath ?? "none"}`,
          `chat:normal:assistant:${emptyThreadMessageText}`,
          () => ({
            key: `thread-empty:${selectedProject?.id ?? "none"}:${activeSelectedWorktreePath ?? "none"}`,
            kind: "chat",
            speaker: "assistant",
            tone: "normal",
            text: emptyThreadMessageText,
          }),
        ),
      ];
    } else if (threadMessages.length === 0) {
      const threadReadyMessageText = `Thread ready in ${activeSelectedWorktreeFolder}. Ask ${APP_TITLE} to inspect, refactor, or debug this worktree.`;
      messages = [
        readCachedVisibleMessage(
          visibleMessageCache,
          `thread-ready:${selectedThread.id}`,
          `chat:normal:assistant:${threadReadyMessageText}`,
          () => ({
            key: `thread-ready:${selectedThread.id}`,
            kind: "chat",
            speaker: "assistant",
            tone: "normal",
            text: threadReadyMessageText,
          }),
        ),
      ];
    } else {
      messages = threadMessages.map((message) =>
        readCachedVisibleMessage(
          visibleMessageCache,
          `thread-message:${message.id}`,
          threadMessageVisibleSignature(message),
          () => buildThreadVisibleMessage(message),
        ),
      );
    }
    if (
      selectedThread?.runStatus.state === "working" &&
      !hasInProgressAssistantChat
    ) {
      const workingMessageText =
        activeThreadWorkingMessage?.trim() || "Processing";
      messages.push(
        readCachedVisibleMessage(
          visibleMessageCache,
          `thread-working:${selectedThread.id}:${selectedThread.updatedAt}`,
          `chat:working:assistant:${workingMessageText}`,
          () => ({
            key: `thread-working:${selectedThread.id}:${selectedThread.updatedAt}`,
            kind: "chat",
            speaker: "assistant",
            tone: "working",
            text: workingMessageText,
          }),
        ),
      );
    }
    if (activeChatError) {
      messages.push(
        readCachedVisibleMessage(
          visibleMessageCache,
          `thread-chat-error:${selectedThread?.id ?? "none"}:${activeChatError}`,
          `chat:error:assistant:${activeChatError}`,
          () => ({
            key: `thread-chat-error:${selectedThread?.id ?? "none"}:${activeChatError}`,
            kind: "chat",
            speaker: "assistant",
            tone: "error",
            text: activeChatError,
          }),
        ),
      );
    }
    if (activeChatNotice) {
      messages.push(
        readCachedVisibleMessage(
          visibleMessageCache,
          `thread-chat-notice:${selectedThread?.id ?? "none"}:${activeChatNotice}`,
          `chat:notice:assistant:${activeChatNotice}`,
          () => ({
            key: `thread-chat-notice:${selectedThread?.id ?? "none"}:${activeChatNotice}`,
            kind: "chat",
            speaker: "assistant",
            tone: "notice",
            text: activeChatNotice,
          }),
        ),
      );
    }
    return messages;
  }, [
    activeChatError,
    activeChatNotice,
    activeSelectedWorktreeFolder,
    activeSelectedWorktreePath,
    activeThreadWorkingMessage,
    isThreadLoading,
    selectedProject,
    selectedThread,
    selectedThreadId,
    threadMessages,
  ]);
}
