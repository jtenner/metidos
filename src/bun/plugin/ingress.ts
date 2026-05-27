/**
 * @file src/bun/plugin/ingress.ts
 * @description Host-owned Plugin System v1 request ingress contracts.
 *
 * These types intentionally keep external source identifiers separate from
 * Metidos users, threads, projects, worktrees, permissions, and memory paths.
 */

export const PLUGIN_REQUEST_INGRESS_PERMISSION = "plugin:request-ingress";
export const PLUGIN_REPLY_TO_SOURCE_PERMISSION = "plugin:reply-to-source";

export const PLUGIN_INGRESS_SOURCE_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
export const PLUGIN_INGRESS_SOURCE_ID_MAX_LENGTH = 64;
export const PLUGIN_INGRESS_EXTERNAL_ID_MAX_LENGTH = 256;
export const PLUGIN_INGRESS_MESSAGE_MAX_LENGTH = 16_000;
export const PLUGIN_INGRESS_PROMPT_TEMPLATE_MAX_LENGTH = 4_000;
export const PLUGIN_INGRESS_RENDERED_PROMPT_MAX_LENGTH = 24_000;
export const PLUGIN_INGRESS_RESPONSE_MESSAGE_MAX_LENGTH = 2_000;
export const PLUGIN_INGRESS_POLL_MAX_MESSAGES = 50;
export const PLUGIN_INGRESS_POLL_INTERVAL_MIN_MS = 5_000;
export const PLUGIN_INGRESS_POLL_INTERVAL_MAX_MS = 15 * 60_000;
export const PLUGIN_INGRESS_CALLBACK_TIMEOUT_MIN_MS = 1_000;
export const PLUGIN_INGRESS_CALLBACK_TIMEOUT_MAX_MS = 60_000;

export type PluginIngressImageAttachment = Readonly<{
  type: "image";
  data: string;
  mimeType: string;
}>;

export type PluginIngressMessage = Readonly<{
  /** Provider-local immutable message/update id. Never a Metidos id. */
  id: string;
  /** Provider-local external user id. Never a Metidos user id. */
  user_id: string;
  /** Optional provider-local chat/thread/conversation id. Never a Metidos id. */
  conversation_id?: string;
  /** Plain-text external request body or caption. */
  message: string;
  /** Optional bounded image attachments to include with the thread turn. */
  images?: readonly PluginIngressImageAttachment[];
}>;

export type PluginIngressPollResult = Readonly<{
  messages: readonly PluginIngressMessage[];
  cursor?: string;
}>;

export type PluginIngressPollContext = Readonly<{
  cursor?: string;
  maxMessages: number;
  /** Real sidecar-local cancellation signal supplied by the host runtime. */
  signal: AbortSignal;
}>;

export type PluginIngressPromptTemplateContext = Readonly<{
  sourceId: string;
  sourceName: string;
  external_message_id: string;
  external_user_id: string;
  external_conversation_id?: string;
}>;

export type PluginIngressPromptTemplate = (
  context: PluginIngressPromptTemplateContext,
) => string | Promise<string>;

export type PluginIngressResponseContext = Readonly<{
  external_message_id: string;
  external_user_id: string;
  external_conversation_id?: string;
}>;

export type PluginIngressResponsePayload = Readonly<{
  /** Explicit short message to send to the original external context only. */
  message: string;
}>;

export type PluginIngressSourceRegistration = Readonly<{
  id: string;
  name: string;
  description?: string;
  poll(
    context: PluginIngressPollContext,
  ): Promise<PluginIngressPollResult> | PluginIngressPollResult;
  promptTemplate: PluginIngressPromptTemplate;
  respond?(
    context: PluginIngressResponseContext,
    payload: PluginIngressResponsePayload,
  ): Promise<void> | void;
  supportsReplyToSource?: boolean;
  pollIntervalMs?: number;
  timeoutMs: number;
}>;

export type PluginIngressSourceHandle = Readonly<{
  id: string;
  pollHandle: string;
  promptTemplateHandle: string;
  respondHandle?: string;
  supportsReplyToSource: boolean;
  pollIntervalMs: number;
  timeoutMs: number;
}>;
