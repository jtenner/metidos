/**
 * @file src/bun/thread-metadata-normalization.ts
 * @description Shared thread metadata input normalization helpers.
 */

export type ThreadMetadataPatchInput = {
  description?: string | null;
  pinned?: boolean | null;
  summary?: string | null;
  title?: string | null;
};

export type NormalizedThreadMetadataPatch = {
  pinned?: boolean;
  summary?: string | null;
  title?: string;
};

export function normalizeOptionalThreadSummary(
  summary: string | null | undefined,
): string | null | undefined {
  if (typeof summary === "undefined") {
    return undefined;
  }
  return summary?.trim() || null;
}

export function normalizeOptionalThreadTitle(
  title: string | null | undefined,
): string | undefined {
  if (typeof title !== "string") {
    return undefined;
  }

  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    throw new Error("Thread title is required.");
  }
  return normalizedTitle;
}

export function normalizeThreadMetadataPatch(
  patch: ThreadMetadataPatchInput,
): NormalizedThreadMetadataPatch {
  const normalizedTitle = normalizeOptionalThreadTitle(patch.title);
  const normalizedSummaryInput =
    typeof patch.summary === "string" || patch.summary === null
      ? patch.summary
      : typeof patch.description === "string" || patch.description === null
        ? patch.description
        : undefined;
  const normalizedSummary = normalizeOptionalThreadSummary(
    normalizedSummaryInput,
  );
  const normalizedPinned =
    typeof patch.pinned === "boolean" ? patch.pinned : undefined;

  return {
    ...(typeof normalizedTitle === "undefined"
      ? {}
      : { title: normalizedTitle }),
    ...(typeof normalizedSummary === "undefined"
      ? {}
      : { summary: normalizedSummary }),
    ...(typeof normalizedPinned === "undefined"
      ? {}
      : { pinned: normalizedPinned }),
  };
}

export function hasNormalizedThreadMetadataPatch(
  patch: NormalizedThreadMetadataPatch,
): boolean {
  return (
    typeof patch.title !== "undefined" ||
    typeof patch.summary !== "undefined" ||
    typeof patch.pinned !== "undefined"
  );
}
