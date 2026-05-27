/**
 * @file src/bun/sidecar-thread-metadata.ts
 * @description Module for sidecar thread metadata.
 */

import type {
  AppRPCSchema,
  RpcProcedureCallOptions,
  RpcThread,
} from "./rpc-schema";
import {
  hasNormalizedThreadMetadataPatch,
  normalizeOptionalThreadSummary,
  normalizeThreadMetadataPatch,
} from "./thread-metadata-normalization";

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

type SidecarThreadUpdateParams = {
  description?: string | null;
  permissions?: string[];
  pinned?: boolean | null;
  summary?: string | null;
  threadId: number;
  title?: string | null;
};

export type UpdateThreadFromSidecarResult = {
  accessUpdateWarning: string | null;
  thread: RpcThread;
};

function hasThreadMetadataUpdate(params: SidecarThreadUpdateParams): boolean {
  return (
    typeof params.title === "string" ||
    typeof params.summary === "string" ||
    typeof params.description === "string" ||
    typeof params.pinned === "boolean"
  );
}

function hasThreadAccessUpdate(params: SidecarThreadUpdateParams): boolean {
  return Array.isArray(params.permissions);
}

function threadAccessBlockedWhileProcessingMessage(): string {
  return "Thread access update did not reach the live app: Thread access controls cannot change while a run is processing.";
}

export function isThreadAccessBlockedWhileProcessing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(threadAccessBlockedWhileProcessingMessage()) ||
    message.includes(
      "Thread access update did not reach the live app: Thread access controls cannot change while Codex is processing.",
    )
  );
}

/**
 * Normalize summary values so callers can clear with blank input.
 */
export const normalizeOptionalSummary = normalizeOptionalThreadSummary;

export function normalizeSidecarThreadMetadataParams(params: {
  description?: string | null;
  pinned?: boolean | null;
  summary?: string | null;
  threadId: number;
  title?: string | null;
}): {
  pinned?: boolean;
  summary?: string | null;
  threadId: number;
  title?: string;
} {
  const normalizedPatch = normalizeThreadMetadataPatch({
    ...(typeof params.description === "string"
      ? { description: params.description }
      : {}),
    ...(typeof params.pinned === "boolean" ? { pinned: params.pinned } : {}),
    ...(typeof params.summary === "string" ? { summary: params.summary } : {}),
    ...(typeof params.title === "string" || params.title === null
      ? { title: params.title }
      : {}),
  });

  if (!hasNormalizedThreadMetadataPatch(normalizedPatch)) {
    throw new Error(
      "At least one of title, summary, description, or pinned is required.",
    );
  }

  return {
    threadId: params.threadId,
    ...normalizedPatch,
  };
}

/**
 * Route sidecar thread metadata mutations through the authoritative RPC path.
 */
export async function updateThreadMetadataFromSidecar(
  rpcCall: UpdateThreadMetadataRpc,
  params: {
    description?: string | null;
    pinned?: boolean | null;
    summary?: string | null;
    threadId: number;
    title?: string | null;
  },
  options?: RpcProcedureCallOptions,
): Promise<RpcThread> {
  const normalizedParams = normalizeSidecarThreadMetadataParams(params);

  try {
    return await rpcCall(
      {
        threadId: normalizedParams.threadId,
        ...(typeof normalizedParams.title === "undefined"
          ? {}
          : { title: normalizedParams.title }),
        ...(typeof normalizedParams.summary === "undefined"
          ? {}
          : { summary: normalizedParams.summary }),
        ...(typeof normalizedParams.pinned === "boolean"
          ? { pinned: normalizedParams.pinned }
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
    permissions?: string[];
    threadId: number;
  },
  options?: RpcProcedureCallOptions,
): Promise<RpcThread> {
  if (!Array.isArray(params.permissions)) {
    throw new Error(
      "Thread permissions must be supplied as an array of permission strings.",
    );
  }

  try {
    return await rpcCall(
      {
        permissions: params.permissions,
        threadId: params.threadId,
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

/**
 * Route mixed sidecar thread updates through the authoritative RPC path.
 * Metadata updates are preserved even when access updates are rejected mid-turn.
 */
export async function updateThreadFromSidecar(
  metadataRpcCall: UpdateThreadMetadataRpc,
  accessRpcCall: UpdateThreadAccessRpc,
  params: SidecarThreadUpdateParams,
  options?: RpcProcedureCallOptions,
): Promise<UpdateThreadFromSidecarResult> {
  const hasMetadataUpdate = hasThreadMetadataUpdate(params);
  const hasAccessUpdate = hasThreadAccessUpdate(params);

  if (!hasMetadataUpdate && !hasAccessUpdate) {
    throw new Error(
      "At least one of title, summary, description, pinned, or permissions is required.",
    );
  }

  let accessUpdateWarning: string | null = null;
  let thread: RpcThread | null = null;

  if (hasMetadataUpdate) {
    thread = await updateThreadMetadataFromSidecar(
      metadataRpcCall,
      {
        threadId: params.threadId,
        ...(typeof params.title === "undefined" ? {} : { title: params.title }),
        ...(typeof params.summary === "undefined"
          ? {}
          : { summary: params.summary }),
        ...(typeof params.description === "undefined"
          ? {}
          : { description: params.description }),
        ...(typeof params.pinned === "undefined"
          ? {}
          : { pinned: params.pinned }),
      },
      options,
    );
  }

  if (hasAccessUpdate) {
    try {
      thread = await updateThreadAccessFromSidecar(
        accessRpcCall,
        {
          permissions: params.permissions ?? [],
          threadId: params.threadId,
        },
        options,
      );
    } catch (error) {
      if (!thread || !isThreadAccessBlockedWhileProcessing(error)) {
        throw error;
      }
      accessUpdateWarning =
        error instanceof Error ? error.message : String(error);
    }
  }

  if (!thread) {
    throw new Error("Thread update did not return a result.");
  }

  return {
    accessUpdateWarning,
    thread,
  };
}
