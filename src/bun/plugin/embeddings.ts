/**
 * @file src/bun/plugin/embeddings.ts
 * @description Plugin System v1 embedding permissions and host API helpers.
 */

import { PluginPermissionError } from "./context";

export const PLUGIN_PROVIDES_EMBEDDINGS_PERMISSION =
  "metidos:provides_embeddings";
export const PLUGIN_CAN_EMBED_PERMISSION = "metidos:can_embed";

export type PluginEmbeddingInput = string | number[] | Uint8Array | ArrayBuffer;

export type PluginEmbeddingRequest = {
  input: unknown;
  payload: unknown;
};

export type PluginEmbeddingHost = (request: {
  context?: unknown;
  deadlineMs?: unknown;
  input: unknown;
  payload: unknown;
}) => Promise<unknown>;

export function assertPluginCanEmbedPermission(
  permissions: readonly string[],
): void {
  if (permissions.includes(PLUGIN_CAN_EMBED_PERMISSION)) {
    return;
  }
  throw new PluginPermissionError({
    message: `Plugin embeddings require ${PLUGIN_CAN_EMBED_PERMISSION}.`,
    permission: PLUGIN_CAN_EMBED_PERMISSION,
  });
}

export function normalizeEmbeddingVector(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error("Embedding result must be an array of finite numbers.");
  }
  const vector = value.map((item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error("Embedding result must contain only finite numbers.");
    }
    return item;
  });
  if (vector.length === 0) {
    throw new Error("Embedding result must not be empty.");
  }
  return vector;
}

export function normalizeEmbeddingResult(result: unknown): number[] {
  if (Array.isArray(result)) {
    return normalizeEmbeddingVector(result);
  }
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const record = result as Record<string, unknown>;
    if (Array.isArray(record.embedding)) {
      return normalizeEmbeddingVector(record.embedding);
    }
    if (Array.isArray(record.embeddings) && record.embeddings.length === 1) {
      return normalizeEmbeddingVector(record.embeddings[0]);
    }
  }
  throw new Error("Embedding provider returned an invalid embedding result.");
}
