/**
 * @file src/shared/chat-images.ts
 * @description Shared helpers for chat image attachments.
 */

export type ChatImageAttachment = {
  type: "image";
  data: string;
  mimeType: string;
};

export type ChatImageDraftAttachment = ChatImageAttachment & {
  byteSize: number;
  id: string;
};

export const MAX_CHAT_IMAGE_ATTACHMENTS = 4;
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;

export function isChatImageByteSizeAllowed(byteSize: number): boolean {
  return Number.isFinite(byteSize) && byteSize <= MAX_CHAT_IMAGE_BYTES;
}

const SUPPORTED_CHAT_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function normalizeChatImageMimeTypeAlias(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

export function isSupportedChatImageMimeType(mimeType: string): boolean {
  return SUPPORTED_CHAT_IMAGE_MIME_TYPES.has(
    normalizeChatImageMimeTypeAlias(mimeType),
  );
}

export function estimateBase64ByteLength(data: string): number {
  const normalized = data.trim();
  if (!normalized) {
    return 0;
  }
  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function decodeBase64PrefixBytes(
  data: string,
  byteCount: number,
): Uint8Array | null {
  const normalized = data.trim();
  if (
    !normalized ||
    normalized.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) ||
    /=/.test(normalized.slice(0, -2))
  ) {
    return null;
  }

  try {
    const prefixLength = Math.min(
      normalized.length,
      Math.ceil(byteCount / 3) * 4,
    );
    const decoded = globalThis.atob(normalized.slice(0, prefixLength));
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function startsWithBytes(
  bytes: Uint8Array,
  signature: readonly number[],
): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function bytesToAscii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function detectedChatImageMimeType(bytes: Uint8Array): string | null {
  if (
    startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return "image/png";
  }
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    bytesToAscii(bytes, 0, 6) === "GIF87a" ||
    bytesToAscii(bytes, 0, 6) === "GIF89a"
  ) {
    return "image/gif";
  }
  if (
    bytesToAscii(bytes, 0, 4) === "RIFF" &&
    bytesToAscii(bytes, 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function normalizeChatImageMimeType(
  data: string,
  mimeType: string,
): { error: string } | { mimeType: string } {
  const normalizedMimeType = normalizeChatImageMimeTypeAlias(mimeType);
  const bytes = decodeBase64PrefixBytes(data, 16);
  if (!bytes) {
    return { error: "Image data must be valid base64." };
  }

  const detectedMimeType = detectedChatImageMimeType(bytes);
  if (!detectedMimeType) {
    return { error: "Image data does not match a supported image type." };
  }
  if (!normalizedMimeType) {
    return { mimeType: detectedMimeType };
  }
  if (!isSupportedChatImageMimeType(normalizedMimeType)) {
    return { error: "Only PNG, JPEG, GIF, and WebP images are supported." };
  }

  if (normalizedMimeType === detectedMimeType) {
    return { mimeType: detectedMimeType };
  }

  return { error: "Image data does not match the declared image type." };
}

export function validateChatImageData(
  data: string,
  mimeType: string,
): string | null {
  const result = normalizeChatImageMimeType(data, mimeType);
  return "error" in result ? result.error : null;
}

export function parseChatImageDataUrl(
  src: string,
):
  | { data: string; mimeType: string; byteSize: number; src: string }
  | { error: string } {
  const trimmed = src.trim();
  const match = trimmed.match(/^data:([^;,\s]+);base64,([A-Za-z0-9+/=\s]+)$/u);
  if (!match) {
    return { error: "Image data URL must use base64 image data." };
  }

  const declaredMimeType = match[1] ?? "";
  const data = (match[2] ?? "").replace(/\s+/gu, "");
  const normalized = normalizeChatImageMimeType(data, declaredMimeType);
  if ("error" in normalized) {
    return { error: normalized.error };
  }
  const byteSize = estimateBase64ByteLength(data);
  if (!isChatImageByteSizeAllowed(byteSize)) {
    return { error: "Image data is too large." };
  }

  return {
    data,
    mimeType: normalized.mimeType,
    byteSize,
    src: `data:${normalized.mimeType};base64,${data}`,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function describeChatImageAttachments(count: number): string {
  return count === 1 ? "1 image" : `${count} images`;
}

export function defaultPromptForChatImages(count: number): string {
  return count === 1 ? "Describe this image." : "Describe these images.";
}

export function resolveChatPromptText(
  text: string,
  imageCount: number,
): string {
  const trimmed = text.trim();
  return (
    trimmed || (imageCount > 0 ? defaultPromptForChatImages(imageCount) : "")
  );
}

export function formatChatMessageTextForDisplay(
  text: string,
  images: readonly ChatImageAttachment[],
): string {
  return resolveChatPromptText(text, images.length);
}
