import {
  estimateBase64ByteLength,
  MAX_CHAT_IMAGE_ATTACHMENTS,
  MAX_CHAT_IMAGE_BYTES,
} from "../../shared/chat-images";

export const TRANSCRIPT_MEDIA_PAYLOAD_CACHE_MAX_ENTRIES = 32;
export const TRANSCRIPT_MEDIA_PAYLOAD_CACHE_MAX_BYTES =
  MAX_CHAT_IMAGE_ATTACHMENTS * MAX_CHAT_IMAGE_BYTES;

export type TranscriptMediaPayloadCacheEntry = {
  byteSize: number;
  data: string;
};

function estimateTranscriptMediaPayloadBytes(data: string): number {
  return estimateBase64ByteLength(data);
}

function totalTranscriptMediaPayloadBytes(
  cache: ReadonlyMap<string, TranscriptMediaPayloadCacheEntry>,
): number {
  let totalBytes = 0;
  for (const entry of cache.values()) {
    totalBytes += entry.byteSize;
  }
  return totalBytes;
}

export function writeTranscriptMediaPayloads(
  current: ReadonlyMap<string, TranscriptMediaPayloadCacheEntry>,
  payloads: ReadonlyMap<string, string>,
  options?: {
    maxBytes?: number;
    maxEntries?: number;
  },
): ReadonlyMap<string, TranscriptMediaPayloadCacheEntry> {
  const maxBytes =
    options?.maxBytes ?? TRANSCRIPT_MEDIA_PAYLOAD_CACHE_MAX_BYTES;
  const maxEntries =
    options?.maxEntries ?? TRANSCRIPT_MEDIA_PAYLOAD_CACHE_MAX_ENTRIES;
  const next = new Map(current);
  const protectedKeys = new Set(payloads.keys());

  for (const [payloadKey, data] of payloads) {
    next.delete(payloadKey);
    next.set(payloadKey, {
      byteSize: estimateTranscriptMediaPayloadBytes(data),
      data,
    });
  }

  const deleteOldestUnprotected = (): boolean => {
    for (const key of next.keys()) {
      if (!protectedKeys.has(key)) {
        next.delete(key);
        return true;
      }
    }
    return false;
  };

  while (next.size > maxEntries) {
    if (!deleteOldestUnprotected()) {
      const oldestKey = next.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      next.delete(oldestKey);
    }
  }

  while (next.size > 1 && totalTranscriptMediaPayloadBytes(next) > maxBytes) {
    if (!deleteOldestUnprotected()) {
      break;
    }
  }

  return next;
}

export function mergeTranscriptMediaPayloadData(
  visiblePayloads: ReadonlyMap<string, string>,
  loadedPayloads: ReadonlyMap<string, TranscriptMediaPayloadCacheEntry>,
): ReadonlyMap<string, string> {
  if (loadedPayloads.size === 0) {
    return visiblePayloads;
  }

  const merged = new Map(visiblePayloads);
  for (const [payloadKey, entry] of loadedPayloads) {
    merged.set(payloadKey, entry.data);
  }
  return merged;
}
