import type { RpcReasoningEffort } from "./model-catalog";

export type RpcThreadStartRequest = {
  requestId: string;
  projectId: number;
  projectPath: string;
  worktreePath: string;
  input: string;
  model: string | null;
  reasoningEffort: RpcReasoningEffort | null;
  webSearchAccess: boolean | null;
  githubAccess: boolean | null;
  gitAccess?: boolean | null;
  sqliteAccess?: boolean | null;
  webServerAccess?: boolean | null;
  agentsAccess: boolean | null;
  calendarAccess?: boolean | null;
  notificationsAccess?: boolean | null;
  weatherAccess?: boolean | null;
  threadsAccess?: boolean | null;
  cronsAccess?: boolean | null;
  metidosAccess: boolean | null;
  pluginAccessGroups?: string[] | null;
  permissions?: string[] | null;
  unsafeMode: boolean | null;
  autoStart: boolean | null;
  threadId: number | null;
  title: string | null;
  summary: string | null;
  pinned: boolean | null;
  pinnedAt: string | null;
  createdAt: string;
};

export type RpcThreadStartRequestResolved = {
  requestId: string;
};

export type RpcChatImageAttachment = {
  type: "image";
  data: string;
  mimeType: string;
  byteSize?: number;
  dataLoaded?: boolean;
  previewByteSize?: number;
  previewMimeType?: string;
};

export type RpcThreadRunStatus = {
  state: "idle" | "working" | "failed" | "stopped";
  startedAt: string | null;
  updatedAt: string | null;
  error: string | null;
  hasUnreadError: boolean;
  phase?: "streaming" | "compacting";
  queue?: RpcThreadQueueStatus;
};

export type RpcThreadUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  contextWindowTokens?: number | null;
};

export type RpcThreadCompaction = {
  estimatedTriggerTokens: number;
  estimatedTriggerSource: "heuristic" | "observed";
  maxObservedInputTokens: number | null;
  inferredCount: number;
  lastInferredAt: string | null;
  lastInferredBeforeInputTokens: number | null;
  lastInferredAfterInputTokens: number | null;
};

export type RpcThreadQueueStatus = {
  pendingMessageCount: number;
  steeringMessageCount: number;
  followUpMessageCount: number;
};

export type RpcThread = {
  id: number;
  projectId: number;
  worktreePath: string;
  title: string;
  summary: string | null;
  model: string;
  reasoningEffort: RpcReasoningEffort;
  webSearchAccess: boolean;
  githubAccess: boolean;
  gitAccess?: boolean;
  sqliteAccess?: boolean;
  webServerAccess?: boolean;
  agentsAccess: boolean;
  calendarAccess?: boolean;
  notificationsAccess?: boolean;
  weatherAccess?: boolean;
  threadsAccess?: boolean;
  cronsAccess?: boolean;
  metidosAccess: boolean;
  pluginAccessGroups?: string[];
  permissions?: string[];
  unsafeMode: boolean;
  piSessionId: string | null;
  piSessionFile: string | null;
  piLeafEntryId: string | null;
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  usage: RpcThreadUsage | null;
  compaction: RpcThreadCompaction;
  runStatus: RpcThreadRunStatus;
};

export type RpcChatThreadMessage = {
  id: number;
  threadId: number;
  role: "assistant" | "user";
  kind: "chat";
  itemId: string | null;
  text: string;
  images?: RpcChatImageAttachment[];
  state: "in_progress" | "completed" | "failed" | "stopped" | null;
  createdAt: string;
  updatedAt: string;
};

export type RpcReasoningThreadMessage = {
  id: number;
  threadId: number;
  role: "assistant";
  kind: "reasoning";
  itemId: string;
  text: string;
  state: "in_progress" | "completed" | "stopped";
  createdAt: string;
  updatedAt: string;
};

export type RpcCommandThreadMessage = {
  id: number;
  threadId: number;
  role: "assistant";
  kind: "command";
  itemId: string;
  text: string;
  state: "in_progress" | "completed" | "failed" | "stopped";
  command: string;
  output: string;
  outputLoaded?: boolean;
  exitCode: number | null;
  createdAt: string;
  updatedAt: string;
};

export type RpcFileChangeThreadMessage = {
  id: number;
  threadId: number;
  role: "assistant";
  kind: "file_change";
  itemId: string;
  text: string;
  state: "in_progress" | "completed" | "failed" | "stopped";
  path: string;
  changeKind: "add" | "delete" | "update";
  diffText: string;
  diffLoaded?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RpcToolCallThreadMessage = {
  id: number;
  threadId: number;
  role: "assistant";
  kind: "tool_call";
  itemId: string;
  text: string;
  state: "in_progress" | "completed" | "failed" | "stopped";
  server: string;
  tool: string;
  argumentsText: string;
  output: string;
  outputLoaded?: boolean;
  outputImages?: RpcChatImageAttachment[];
  createdAt: string;
  updatedAt: string;
};

export type RpcWebSearchThreadMessage = {
  id: number;
  threadId: number;
  role: "assistant";
  kind: "web_search";
  itemId: string;
  text: string;
  state: "in_progress" | "completed" | "stopped";
  query: string;
  createdAt: string;
  updatedAt: string;
};

export type RpcErrorThreadMessage = {
  id: number;
  threadId: number;
  role: "assistant";
  kind: "error";
  itemId: string;
  text: string;
  state: "in_progress" | "completed" | "stopped";
  createdAt: string;
  updatedAt: string;
};

/**
 * Union of all RPC thread message kinds returned by backend thread reads.
 */
export type RpcThreadMessage =
  | RpcChatThreadMessage
  | RpcReasoningThreadMessage
  | RpcCommandThreadMessage
  | RpcFileChangeThreadMessage
  | RpcToolCallThreadMessage
  | RpcWebSearchThreadMessage
  | RpcErrorThreadMessage;

export type RpcThreadDetail = {
  thread: RpcThread;
  messages: RpcThreadMessage[];
  nextCursor: number | null;
};

/**
 * Full schema of client-callable RPC request/response pairs.
 */
