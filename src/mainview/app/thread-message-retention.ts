import type {
  RpcChatImageAttachment,
  RpcThreadMessage,
} from "../../bun/rpc-schema";
import { estimateBase64ByteLength } from "../../shared/chat-images";

export const MAX_RETAINED_THREAD_MESSAGES = 500;
export const MAX_RETAINED_THREAD_MESSAGE_TEXT_BYTES = 4 * 1024 * 1024;
export const MAX_RETAINED_THREAD_MESSAGE_BODY_BYTES = 256 * 1024;

const TRUNCATED_MESSAGE_SUFFIX =
  "\n\n… [older transcript content was truncated from browser memory]";

function stringByteLength(value: string | null | undefined): number {
  return (value?.length ?? 0) * 2;
}

function truncateStringForRetention(value: string): {
  changed: boolean;
  value: string;
} {
  if (stringByteLength(value) <= MAX_RETAINED_THREAD_MESSAGE_BODY_BYTES) {
    return { changed: false, value };
  }

  const maxCharacters = Math.max(
    0,
    Math.floor(MAX_RETAINED_THREAD_MESSAGE_BODY_BYTES / 2) -
      TRUNCATED_MESSAGE_SUFFIX.length,
  );
  return {
    changed: true,
    value: `${value.slice(0, maxCharacters)}${TRUNCATED_MESSAGE_SUFFIX}`,
  };
}

function stripImagePayload(
  image: RpcChatImageAttachment,
): RpcChatImageAttachment {
  // Preserve object identity when payload data is already absent so retention
  // passes only mark chat images as changed when a base64 payload was actually
  // stripped from browser memory.
  if (!image.data) {
    return image;
  }
  return {
    ...image,
    byteSize: image.byteSize ?? estimateBase64ByteLength(image.data),
    data: "",
    dataLoaded: false,
  };
}

function compactThreadMessageForRetention(
  message: RpcThreadMessage,
): RpcThreadMessage {
  switch (message.kind) {
    case "chat": {
      const text = truncateStringForRetention(message.text);
      const images = message.images?.map(stripImagePayload);
      const imagesChanged = images?.some(
        (image, index) => image !== message.images?.[index],
      );
      if (!text.changed && !imagesChanged) {
        return message;
      }
      return {
        ...message,
        ...(text.changed ? { text: text.value } : {}),
        ...(images ? { images } : {}),
      };
    }
    case "reasoning": {
      const text = truncateStringForRetention(message.text);
      return text.changed ? { ...message, text: text.value } : message;
    }
    case "command": {
      const command = truncateStringForRetention(message.command);
      const output = truncateStringForRetention(message.output);
      if (!command.changed && !output.changed) {
        return message;
      }
      return {
        ...message,
        command: command.value,
        output: output.value,
        ...(output.changed ? { outputLoaded: false } : {}),
      };
    }
    case "tool_call": {
      const argumentsText = truncateStringForRetention(message.argumentsText);
      const output = truncateStringForRetention(message.output);
      if (!argumentsText.changed && !output.changed) {
        return message;
      }
      return {
        ...message,
        argumentsText: argumentsText.value,
        output: output.value,
        ...(output.changed ? { outputLoaded: false } : {}),
      };
    }
    case "file_change": {
      const diffText = truncateStringForRetention(message.diffText);
      return diffText.changed
        ? { ...message, diffLoaded: false, diffText: diffText.value }
        : message;
    }
    case "web_search": {
      const query = truncateStringForRetention(message.query);
      return query.changed ? { ...message, query: query.value } : message;
    }
    case "error": {
      const text = truncateStringForRetention(message.text);
      return text.changed ? { ...message, text: text.value } : message;
    }
  }
}

export function estimateThreadMessageRetainedBytes(
  message: RpcThreadMessage,
): number {
  switch (message.kind) {
    case "chat":
      return (
        stringByteLength(message.text) +
        (message.images ?? []).reduce(
          (totalBytes, image) =>
            totalBytes + estimateBase64ByteLength(image.data),
          0,
        )
      );
    case "reasoning":
      return stringByteLength(message.text);
    case "command":
      return (
        stringByteLength(message.command) + stringByteLength(message.output)
      );
    case "tool_call":
      return (
        stringByteLength(message.argumentsText) +
        stringByteLength(message.output)
      );
    case "file_change":
      return stringByteLength(message.diffText);
    case "web_search":
      return stringByteLength(message.query);
    case "error":
      return stringByteLength(message.text);
  }
}

export function estimateThreadMessagesRetainedBytes(
  messages: readonly RpcThreadMessage[],
): number {
  return messages.reduce(
    (totalBytes, message) =>
      totalBytes + estimateThreadMessageRetainedBytes(message),
    0,
  );
}

export function retainRecentThreadMessages(
  messages: RpcThreadMessage[],
): RpcThreadMessage[] {
  let retainedMessages = messages;
  let changed = false;

  if (retainedMessages.length > MAX_RETAINED_THREAD_MESSAGES) {
    retainedMessages = retainedMessages.slice(
      retainedMessages.length - MAX_RETAINED_THREAD_MESSAGES,
    );
    changed = true;
  }

  const compactedMessages = retainedMessages.map((message) => {
    const compacted = compactThreadMessageForRetention(message);
    if (compacted !== message) {
      changed = true;
    }
    return compacted;
  });

  let totalBytes = estimateThreadMessagesRetainedBytes(compactedMessages);
  while (
    compactedMessages.length > 1 &&
    totalBytes > MAX_RETAINED_THREAD_MESSAGE_TEXT_BYTES
  ) {
    const removedMessage = compactedMessages.shift();
    if (!removedMessage) {
      break;
    }
    totalBytes -= estimateThreadMessageRetainedBytes(removedMessage);
    changed = true;
  }

  return changed ? compactedMessages : messages;
}
