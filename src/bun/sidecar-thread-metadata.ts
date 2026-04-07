/**
 * @file src/bun/sidecar-thread-metadata.ts
 * @description Module for sidecar thread metadata.
 */

import type {
  AppRPCSchema,
  RpcProcedureCallOptions,
  RpcThread,
} from "./rpc-schema";

type UpdateThreadMetadataParams =
  AppRPCSchema["requests"]["updateThreadMetadata"]["params"];
type UpdateThreadAccessParams =
  AppRPCSchema["requests"]["updateThreadAccess"]["params"];

export type UpdateThreadMetadataRpc = (
  params: UpdateThreadMetadataParams,
  options?: RpcProcedureCallOptions,
) => Promise<RpcThread>;

export type UpdateThreadAccessRpc = (
  params: UpdateThreadAccessParams,
  options?: RpcProcedureCallOptions,
) => Promise<RpcThread>;

/**
 * Normalize summary values so callers can clear with blank input.
 */
export function normalizeOptionalSummary(
  summary: string | null | undefined,
): string | null | undefined {
  if (typeof summary === "undefined") {
    return undefined;
  }
  return summary?.trim() || null;
}

/**
 * Route sidecar thread metadata mutations through the authoritative RPC path.
 */
export async function updateThreadMetadataFromSidecar(
  rpcCall: UpdateThreadMetadataRpc,
  params: {
    threadId: number;
    title?: string;
    summary?: string | null;
    pinned?: boolean;
  },
  options?: RpcProcedureCallOptions,
): Promise<RpcThread> {
  if (
    typeof params.title === "undefined" &&
    typeof params.summary === "undefined" &&
    typeof params.pinned === "undefined"
  ) {
    throw new Error("At least one of title, summary, or pinned is required.");
  }

  const normalizedTitle =
    typeof params.title === "undefined" ? undefined : params.title.trim();
  if (typeof normalizedTitle !== "undefined" && !normalizedTitle) {
    throw new Error("Thread title is required.");
  }

  const normalizedSummary = normalizeOptionalSummary(params.summary);

  try {
    return await rpcCall(
      {
        threadId: params.threadId,
        ...(typeof normalizedTitle === "undefined"
          ? {}
          : { title: normalizedTitle }),
        ...(typeof normalizedSummary === "undefined"
          ? {}
          : { summary: normalizedSummary }),
        ...(typeof params.pinned === "boolean"
          ? { pinned: params.pinned }
          : {}),
      },
      options,
    );
  } catch (error) {
    throw new Error(
      `Thread metadata update did not reach the live app: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Route sidecar thread access mutations through the authoritative RPC path.
 */
export async function updateThreadAccessFromSidecar(
  rpcCall: UpdateThreadAccessRpc,
  params: {
    agentsAccess?: boolean;
    githubAccess?: boolean;
    joltAccess?: boolean;
    threadId: number;
    unsafeMode?: boolean;
  },
  options?: RpcProcedureCallOptions,
): Promise<RpcThread> {
  if (
    typeof params.githubAccess === "undefined" &&
    typeof params.agentsAccess === "undefined" &&
    typeof params.joltAccess === "undefined" &&
    typeof params.unsafeMode === "undefined"
  ) {
    throw new Error(
      "At least one of githubAccess, agentsAccess, joltAccess, or unsafeMode is required.",
    );
  }

  try {
    return await rpcCall(
      {
        threadId: params.threadId,
        ...(typeof params.githubAccess === "boolean"
          ? { githubAccess: params.githubAccess }
          : {}),
        ...(typeof params.agentsAccess === "boolean"
          ? { agentsAccess: params.agentsAccess }
          : {}),
        ...(typeof params.joltAccess === "boolean"
          ? { joltAccess: params.joltAccess }
          : {}),
        ...(typeof params.unsafeMode === "boolean"
          ? { unsafeMode: params.unsafeMode }
          : {}),
      },
      options,
    );
  } catch (error) {
    throw new Error(
      `Thread access update did not reach the live app: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
}
