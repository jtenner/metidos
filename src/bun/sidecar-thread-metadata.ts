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

type SidecarThreadUpdateParams = {
  agentsAccess?: boolean;
  description?: string | null;
  githubAccess?: boolean;
  metidosAccess?: boolean;
  pinned?: boolean | null;
  summary?: string | null;
  threadId: number;
  title?: string | null;
  unsafeMode?: boolean;
  webSearchAccess?: boolean;
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
  return (
    typeof params.webSearchAccess !== "undefined" ||
    typeof params.githubAccess !== "undefined" ||
    typeof params.agentsAccess !== "undefined" ||
    typeof params.metidosAccess !== "undefined" ||
    typeof params.unsafeMode !== "undefined"
  );
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
export function normalizeOptionalSummary(
  summary: string | null | undefined,
): string | null | undefined {
  if (typeof summary === "undefined") {
    return undefined;
  }
  return summary?.trim() || null;
}

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
  const normalizedTitle =
    typeof params.title === "string" ? params.title.trim() : undefined;
  if (typeof normalizedTitle !== "undefined" && !normalizedTitle) {
    throw new Error("Thread title is required.");
  }

  const normalizedSummaryInput =
    typeof params.summary === "string"
      ? params.summary
      : typeof params.description === "string"
        ? params.description
        : undefined;
  const normalizedSummary = normalizeOptionalSummary(normalizedSummaryInput);
  const normalizedPinned =
    typeof params.pinned === "boolean" ? params.pinned : undefined;

  if (
    typeof normalizedTitle === "undefined" &&
    typeof normalizedSummary === "undefined" &&
    typeof normalizedPinned === "undefined"
  ) {
    throw new Error(
      "At least one of title, summary, description, or pinned is required.",
    );
  }

  return {
    threadId: params.threadId,
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
    agentsAccess?: boolean;
    githubAccess?: boolean;
    metidosAccess?: boolean;
    threadId: number;
    unsafeMode?: boolean;
    webSearchAccess?: boolean;
  },
  options?: RpcProcedureCallOptions,
): Promise<RpcThread> {
  if (
    typeof params.webSearchAccess === "undefined" &&
    typeof params.githubAccess === "undefined" &&
    typeof params.agentsAccess === "undefined" &&
    typeof params.metidosAccess === "undefined" &&
    typeof params.unsafeMode === "undefined"
  ) {
    throw new Error(
      "At least one of webSearchAccess, githubAccess, agentsAccess, metidosAccess, or unsafeMode is required.",
    );
  }

  try {
    return await rpcCall(
      {
        threadId: params.threadId,
        ...(typeof params.webSearchAccess === "boolean"
          ? { webSearchAccess: params.webSearchAccess }
          : {}),
        ...(typeof params.githubAccess === "boolean"
          ? { githubAccess: params.githubAccess }
          : {}),
        ...(typeof params.agentsAccess === "boolean"
          ? { agentsAccess: params.agentsAccess }
          : {}),
        ...(typeof params.metidosAccess === "boolean"
          ? { metidosAccess: params.metidosAccess }
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

/**
 * Route mixed sidecar thread updates through the authoritative RPC path.
 * Metadata updates are preserved even when access toggles are rejected mid-turn.
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
      "At least one of title, summary, description, pinned, webSearchAccess, githubAccess, agentsAccess, metidosAccess, or unsafeMode is required.",
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
          threadId: params.threadId,
          ...(typeof params.githubAccess === "undefined"
            ? {}
            : { githubAccess: params.githubAccess }),
          ...(typeof params.agentsAccess === "undefined"
            ? {}
            : { agentsAccess: params.agentsAccess }),
          ...(typeof params.metidosAccess === "undefined"
            ? {}
            : { metidosAccess: params.metidosAccess }),
          ...(typeof params.unsafeMode === "undefined"
            ? {}
            : { unsafeMode: params.unsafeMode }),
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
