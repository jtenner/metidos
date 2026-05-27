/**
 * @file src/bun/pi/native-web-search-provider.ts
 * @description Native OpenAI/Codex web-search stream wrappers and OpenRouter
 * image-output handling for chat transcript projection.
 */

import {
  type Api,
  type AssistantMessage,
  type Context,
  getEnvApiKey,
  getSupportedThinkingLevels,
  type Model,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import OpenAI from "openai";
import type {
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
} from "openai/resources/responses/responses.js";
import {
  convertMessages as convertOpenAICompletionMessages,
  streamSimpleOpenAICompletions,
} from "../../../node_modules/@mariozechner/pi-ai/dist/providers/openai-completions.js";
import {
  convertResponsesMessages,
  convertResponsesTools,
  processResponsesStream,
} from "../../../node_modules/@mariozechner/pi-ai/dist/providers/openai-responses-shared.js";
import {
  buildBaseOptions,
  clampReasoning,
} from "../../../node_modules/@mariozechner/pi-ai/dist/providers/simple-options.js";
import { AssistantMessageEventStream } from "../../../node_modules/@mariozechner/pi-ai/dist/utils/event-stream.js";

import { readLimitedTextResponse } from "../limited-json-response";
import {
  createSafeOutboundHttpFetch,
  type SafeOutboundFetch,
} from "../outbound-url-security";
import { encodePiWebSearchMarker } from "../project-procedures/pi-sdk-shapes";
import {
  MAX_CHAT_IMAGE_ATTACHMENTS,
  MAX_CHAT_IMAGE_BYTES,
  normalizeChatImageMimeType,
  parseChatImageDataUrl,
  type ChatImageAttachment,
} from "../../shared/chat-images";

const OPENAI_TOOL_CALL_PROVIDERS = new Set([
  "openai",
  "openai-codex",
  "opencode",
]);
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const MAX_CODEX_ERROR_RESPONSE_BYTES = 64 * 1024;
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const CODEX_TOOL_CALL_PROVIDERS = new Set([
  "openai",
  "openai-codex",
  "opencode",
]);
const CODEX_RESPONSE_STATUSES = new Set([
  "completed",
  "incomplete",
  "failed",
  "cancelled",
  "queued",
  "in_progress",
]);
const OPENAI_RESPONSE_FUNCTION_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

type NativeSearchMarkerState = "in_progress" | "completed" | "stopped";

function normalizeOpenAIResponseFunctionName(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return normalized.length > 0 ? normalized : "_";
}

export function normalizeOpenAIResponseFunctionCallNames(
  input: unknown[],
): unknown[] {
  return input.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return item;
    }
    const record = item as Record<string, unknown>;
    if (
      record.type !== "function_call" ||
      typeof record.name !== "string" ||
      OPENAI_RESPONSE_FUNCTION_NAME_PATTERN.test(record.name)
    ) {
      return item;
    }
    return {
      ...record,
      name: normalizeOpenAIResponseFunctionName(record.name),
    };
  });
}

type NativeWebSearchItem = {
  action?: {
    queries?: unknown;
    query?: unknown;
    type?: unknown;
  };
  id?: unknown;
  status?: unknown;
  type?: unknown;
};

function resolveCacheRetention(cacheRetention: string | undefined): string {
  if (cacheRetention) {
    return cacheRetention;
  }
  if (
    typeof process !== "undefined" &&
    process.env.PI_CACHE_RETENTION === "long"
  ) {
    return "long";
  }
  return "short";
}

function getPromptCacheRetention(
  baseUrl: string,
  cacheRetention: string,
): string | undefined {
  if (cacheRetention !== "long") {
    return undefined;
  }
  if (baseUrl.includes("api.openai.com")) {
    return "24h";
  }
  return undefined;
}

function createResponsesClient(
  model: Model<"openai-responses">,
  context: Context,
  apiKey: string,
  optionsHeaders?: Record<string, string>,
): OpenAI {
  if (!apiKey) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        "OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it as an argument.",
      );
    }
    apiKey = process.env.OPENAI_API_KEY;
  }

  const headers = { ...model.headers };
  void context;
  if (optionsHeaders) {
    Object.assign(headers, optionsHeaders);
  }

  return new OpenAI({
    apiKey,
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    defaultHeaders: headers,
  });
}

function buildResponsesParams(
  model: Model<"openai-responses">,
  context: Context,
  options?: Record<string, unknown>,
): ResponseCreateParamsStreaming {
  const messages = convertResponsesMessages(
    model,
    context,
    OPENAI_TOOL_CALL_PROVIDERS,
  );
  const cacheRetention = resolveCacheRetention(
    typeof options?.cacheRetention === "string"
      ? options.cacheRetention
      : undefined,
  );
  const params: ResponseCreateParamsStreaming = {
    model: model.id,
    input: messages,
    stream: true,
    store: false,
  };
  if (cacheRetention !== "none" && typeof options?.sessionId === "string") {
    params.prompt_cache_key = options.sessionId;
  }
  const promptCacheRetention = getPromptCacheRetention(
    model.baseUrl,
    cacheRetention,
  );
  if (promptCacheRetention !== undefined) {
    params.prompt_cache_retention = promptCacheRetention as NonNullable<
      ResponseCreateParamsStreaming["prompt_cache_retention"]
    >;
  }

  if (typeof options?.maxTokens === "number") {
    params.max_output_tokens = options.maxTokens;
  }
  if (typeof options?.temperature === "number") {
    params.temperature = options.temperature;
  }
  if (typeof options?.serviceTier === "string") {
    params.service_tier = options.serviceTier as NonNullable<
      ResponseCreateParamsStreaming["service_tier"]
    >;
  }
  if (context.tools) {
    params.tools = convertResponsesTools(context.tools);
  }
  if (model.reasoning) {
    if (options?.reasoningEffort || options?.reasoningSummary) {
      params.reasoning = {
        effort:
          (options?.reasoningEffort as
            | "minimal"
            | "low"
            | "medium"
            | "high"
            | "xhigh"
            | undefined) ?? "medium",
        summary:
          (options?.reasoningSummary as
            | "auto"
            | "detailed"
            | "concise"
            | null
            | undefined) ?? "auto",
      };
      params.include = ["reasoning.encrypted_content"];
    } else if (model.provider !== "github-copilot") {
      params.reasoning = { effort: "none" };
    }
  }
  return params;
}

function readWebSearchQuery(item: NativeWebSearchItem): string {
  const queries = item.action?.queries;
  if (Array.isArray(queries)) {
    const normalizedQueries = queries
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
    if (normalizedQueries.length > 0) {
      return normalizedQueries.join(" • ");
    }
  }

  const query = item.action?.query;
  return typeof query === "string" ? query.trim() : "";
}

function mapWebSearchTerminalState(
  item: NativeWebSearchItem,
): NativeSearchMarkerState {
  return item.status === "completed" ? "completed" : "stopped";
}

function buildSyntheticWebSearchMessageEvents(input: {
  itemId: string;
  markerState: NativeSearchMarkerState;
  outputIndex: number;
  query: string;
  sequenceNumber: number;
}): ResponseStreamEvent[] {
  const markerText = encodePiWebSearchMarker({
    id: input.itemId,
    query: input.query || "Web search",
    state: input.markerState,
  });
  const syntheticMessageId = `metidos-web-search-${input.itemId}-${input.markerState}`;

  return [
    {
      item: {
        content: [],
        id: syntheticMessageId,
        role: "assistant",
        status: "completed",
        type: "message",
      },
      output_index: input.outputIndex,
      sequence_number: input.sequenceNumber,
      type: "response.output_item.added",
    } as ResponseStreamEvent,
    {
      content_index: 0,
      item_id: syntheticMessageId,
      output_index: input.outputIndex,
      part: {
        annotations: [],
        text: "",
        type: "output_text",
      },
      sequence_number: input.sequenceNumber,
      type: "response.content_part.added",
    } as ResponseStreamEvent,
    {
      content_index: 0,
      delta: markerText,
      item_id: syntheticMessageId,
      output_index: input.outputIndex,
      sequence_number: input.sequenceNumber,
      type: "response.output_text.delta",
    } as ResponseStreamEvent,
    {
      item: {
        content: [
          {
            annotations: [],
            text: markerText,
            type: "output_text",
          },
        ],
        id: syntheticMessageId,
        role: "assistant",
        status: "completed",
        type: "message",
      },
      output_index: input.outputIndex,
      sequence_number: input.sequenceNumber,
      type: "response.output_item.done",
    } as ResponseStreamEvent,
  ];
}

async function* injectNativeWebSearchTranscriptMarkers(
  events: AsyncIterable<ResponseStreamEvent>,
): AsyncIterable<ResponseStreamEvent> {
  for await (const event of events) {
    if (
      event.type === "response.output_item.added" &&
      event.item?.type === "web_search_call"
    ) {
      const query = readWebSearchQuery(event.item as NativeWebSearchItem);
      if (query) {
        yield* buildSyntheticWebSearchMessageEvents({
          itemId: String(
            (event.item as NativeWebSearchItem).id ?? event.output_index,
          ),
          markerState: "in_progress",
          outputIndex: event.output_index,
          query,
          sequenceNumber: event.sequence_number,
        });
      }
    }

    if (
      event.type === "response.output_item.done" &&
      event.item?.type === "web_search_call"
    ) {
      const query = readWebSearchQuery(event.item as NativeWebSearchItem);
      if (query) {
        yield* buildSyntheticWebSearchMessageEvents({
          itemId: String(
            (event.item as NativeWebSearchItem).id ?? event.output_index,
          ),
          markerState: mapWebSearchTerminalState(
            event.item as NativeWebSearchItem,
          ),
          outputIndex: event.output_index,
          query,
          sequenceNumber: event.sequence_number,
        });
      }
    }

    yield event;
  }
}

export function streamSimpleOpenAIResponsesWithTranscriptMarkers(
  model: Model<"openai-responses">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const apiKey = options?.apiKey || getEnvApiKey(model.provider);
  if (!apiKey) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }

  const base = buildBaseOptions(model, options, apiKey);
  const reasoningEffort = getSupportedThinkingLevels(model).includes("xhigh")
    ? options?.reasoning
    : clampReasoning(options?.reasoning);
  const stream = new AssistantMessageEventStream();

  void (async () => {
    const output: AssistantMessage = {
      api: model.api,
      content: [],
      model: model.id,
      provider: model.provider,
      role: "assistant" as const,
      stopReason: "stop" as const,
      timestamp: Date.now(),
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 0,
          output: 0,
          total: 0,
        },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    };

    try {
      const client = createResponsesClient(
        model,
        context,
        apiKey,
        base.headers,
      );
      let params = buildResponsesParams(model, context, {
        ...base,
        reasoningEffort,
      });
      const nextParams = await base.onPayload?.(params, model);
      if (nextParams !== undefined) {
        params = nextParams as ResponseCreateParamsStreaming;
      }
      const openaiStream = await client.responses.create(
        params,
        base.signal ? { signal: base.signal } : undefined,
      );
      stream.push({ type: "start", partial: output });
      await processResponsesStream(
        injectNativeWebSearchTranscriptMarkers(openaiStream),
        output,
        stream,
        model,
      );
      if (base.signal?.aborted) {
        throw new Error("Request was aborted");
      }
      if (output.stopReason === "aborted" || output.stopReason === "error") {
        throw new Error("An unknown error occurred");
      }
      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      output.stopReason = base.signal?.aborted ? "aborted" : "error";
      output.errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

function clampCodexReasoningEffort(
  modelId: string,
  effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh",
): "none" | "low" | "medium" | "high" | "xhigh" {
  const id = modelId.includes("/")
    ? (modelId.split("/").pop() ?? modelId)
    : modelId;
  if (
    (id.startsWith("gpt-5.2") ||
      id.startsWith("gpt-5.3") ||
      id.startsWith("gpt-5.4") ||
      id.startsWith("gpt-5.5")) &&
    effort === "minimal"
  ) {
    return "low";
  }
  if (id === "gpt-5.1" && effort === "xhigh") {
    return "high";
  }
  if (id === "gpt-5.1-codex-mini") {
    return effort === "high" || effort === "xhigh" ? "high" : "medium";
  }
  return effort === "minimal" ? "low" : effort;
}

function resolveCodexUrl(baseUrl: string): string {
  const raw = baseUrl.trim().length > 0 ? baseUrl : DEFAULT_CODEX_BASE_URL;
  const normalized = raw.replace(/\/+$/, "");
  if (normalized.endsWith("/codex/responses")) {
    return normalized;
  }
  if (normalized.endsWith("/codex")) {
    return `${normalized}/responses`;
  }
  return `${normalized}/codex/responses`;
}

async function parseErrorResponse(response: Response): Promise<{
  friendlyMessage?: string;
  message: string;
}> {
  let raw = "";
  try {
    raw = await readLimitedTextResponse(response, {
      label: "Codex error response",
      maxBytes: MAX_CODEX_ERROR_RESPONSE_BYTES,
    });
  } catch (error) {
    raw = error instanceof Error ? error.message : String(error);
  }
  let message = raw || response.statusText || "Request failed";
  let friendlyMessage: string | undefined;

  try {
    const parsed = JSON.parse(raw) as {
      error?: {
        code?: string;
        message?: string;
        plan_type?: string;
        resets_at?: number;
        type?: string;
      };
    };
    const err = parsed?.error;
    if (err) {
      const code = err.code || err.type || "";
      if (
        /usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(
          code,
        ) ||
        response.status === 429
      ) {
        const plan = err.plan_type
          ? ` (${err.plan_type.toLowerCase()} plan)`
          : "";
        const mins =
          typeof err.resets_at === "number"
            ? Math.max(
                0,
                Math.round((err.resets_at * 1000 - Date.now()) / 60000),
              )
            : undefined;
        const when = mins !== undefined ? ` Try again in ~${mins} min.` : "";
        friendlyMessage =
          `You have hit your ChatGPT usage limit${plan}.${when}`.trim();
      }
      message = err.message || friendlyMessage || message;
    }
  } catch {
    // Error payload parsing is best-effort; preserve the generic upstream
    // message when the provider returns a non-JSON or malformed body.
  }

  return friendlyMessage === undefined
    ? { message }
    : { message, friendlyMessage };
}

function extractAccountId(token: string): string {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid token");
    }
    const payload = JSON.parse(
      Buffer.from(parts[1] ?? "", "base64url").toString("utf8"),
    ) as {
      [JWT_CLAIM_PATH]?: {
        chatgpt_account_id?: string;
      };
    };
    const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
    if (!accountId) {
      throw new Error("No account ID in token");
    }
    return accountId;
  } catch {
    throw new Error("Failed to extract accountId from token");
  }
}

function buildBaseCodexHeaders(
  initHeaders: Record<string, string> | undefined,
  additionalHeaders: Record<string, string> | undefined,
  accountId: string,
  token: string,
): Headers {
  const headers = new Headers(initHeaders);
  for (const [key, value] of Object.entries(additionalHeaders || {})) {
    headers.set(key, value);
  }
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("chatgpt-account-id", accountId);
  headers.set("originator", "pi");
  headers.set("User-Agent", "pi (metidos)");
  return headers;
}

function buildCodexSSEHeaders(
  initHeaders: Record<string, string> | undefined,
  additionalHeaders: Record<string, string> | undefined,
  accountId: string,
  token: string,
  sessionId?: string,
): Headers {
  const headers = buildBaseCodexHeaders(
    initHeaders,
    additionalHeaders,
    accountId,
    token,
  );
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");
  if (sessionId) {
    headers.set("session_id", sessionId);
  }
  return headers;
}

async function* parseSSE(
  response: Response,
): AsyncIterable<Record<string, unknown>> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());
        if (dataLines.length > 0) {
          const data = dataLines.join("\n").trim();
          if (data && data !== "[DONE]") {
            try {
              yield JSON.parse(data) as Record<string, unknown>;
            } catch {
              // Ignore malformed SSE data frames and keep consuming the stream;
              // upstream providers occasionally send keepalive/non-JSON chunks.
            }
          }
        }
        idx = buffer.indexOf("\n\n");
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Stream cancellation is best-effort cleanup after iteration ends.
    }
    try {
      reader.releaseLock();
    } catch {
      // The stream may already be released/closed by the reader implementation.
    }
  }
}

function normalizeCodexStatus(
  status: unknown,
):
  | "completed"
  | "incomplete"
  | "failed"
  | "cancelled"
  | "queued"
  | "in_progress"
  | undefined {
  if (typeof status !== "string") {
    return undefined;
  }
  return CODEX_RESPONSE_STATUSES.has(status)
    ? (status as
        | "completed"
        | "incomplete"
        | "failed"
        | "cancelled"
        | "queued"
        | "in_progress")
    : undefined;
}

async function* mapCodexEvents(
  events: AsyncIterable<Record<string, unknown>>,
): AsyncIterable<ResponseStreamEvent> {
  for await (const event of events) {
    const type = typeof event.type === "string" ? event.type : undefined;
    if (!type) {
      continue;
    }
    if (type === "error") {
      const code = typeof event.code === "string" ? event.code : "";
      const message = typeof event.message === "string" ? event.message : "";
      throw new Error(
        `Codex error: ${message || code || JSON.stringify(event)}`,
      );
    }
    if (type === "response.failed") {
      const response = event.response as
        | { error?: { message?: string } }
        | undefined;
      throw new Error(response?.error?.message || "Codex response failed");
    }
    if (
      type === "response.done" ||
      type === "response.completed" ||
      type === "response.incomplete"
    ) {
      const response = event.response as Record<string, unknown> | undefined;
      yield {
        ...(event as unknown as ResponseStreamEvent),
        response: response
          ? {
              ...response,
              status: normalizeCodexStatus(response.status),
            }
          : response,
        type: "response.completed",
      } as ResponseStreamEvent;
      return;
    }
    yield event as unknown as ResponseStreamEvent;
  }
}

function buildCodexRequestBody(
  model: Model<"openai-codex-responses">,
  context: Context,
  options?: Record<string, unknown>,
): Record<string, unknown> {
  const messages = normalizeOpenAIResponseFunctionCallNames(
    convertResponsesMessages(model, context, CODEX_TOOL_CALL_PROVIDERS, {
      includeSystemPrompt: false,
    }),
  );
  const body: Record<string, unknown> = {
    include: ["reasoning.encrypted_content"],
    input: messages,
    instructions: context.systemPrompt,
    model: model.id,
    parallel_tool_calls: true,
    prompt_cache_key:
      typeof options?.sessionId === "string" ? options.sessionId : undefined,
    store: false,
    stream: true,
    text: {
      verbosity:
        typeof options?.textVerbosity === "string"
          ? options.textVerbosity
          : "medium",
    },
    tool_choice: "auto",
  };
  if (typeof options?.temperature === "number") {
    body.temperature = options.temperature;
  }
  if (context.tools) {
    body.tools = convertResponsesTools(context.tools, {
      strict: null,
    });
  }
  if (typeof options?.reasoningEffort === "string") {
    body.reasoning = {
      effort: clampCodexReasoningEffort(
        model.id,
        options.reasoningEffort as
          | "none"
          | "minimal"
          | "low"
          | "medium"
          | "high"
          | "xhigh",
      ),
      summary:
        (options?.reasoningSummary as
          | "auto"
          | "concise"
          | "detailed"
          | "off"
          | "on"
          | null
          | undefined) ?? "auto",
    };
  }
  return body;
}

export function streamSimpleOpenAICodexResponsesWithTranscriptMarkers(
  model: Model<"openai-codex-responses">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const apiKey = options?.apiKey || getEnvApiKey(model.provider);
  if (!apiKey) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }

  const base = buildBaseOptions(model, options, apiKey);
  const reasoningEffort = getSupportedThinkingLevels(model).includes("xhigh")
    ? options?.reasoning
    : clampReasoning(options?.reasoning);
  const stream = new AssistantMessageEventStream();

  void (async () => {
    const output: AssistantMessage = {
      api: "openai-codex-responses" as const,
      content: [],
      model: model.id,
      provider: model.provider,
      role: "assistant" as const,
      stopReason: "stop" as const,
      timestamp: Date.now(),
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 0,
          output: 0,
          total: 0,
        },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    };

    try {
      const accountId = extractAccountId(apiKey);
      let body = buildCodexRequestBody(model, context, {
        ...base,
        reasoningEffort,
      });
      const nextBody = await base.onPayload?.(body, model);
      if (nextBody !== undefined) {
        body = nextBody as Record<string, unknown>;
      }
      const requestInit: RequestInit = {
        body: JSON.stringify(body),
        headers: buildCodexSSEHeaders(
          model.headers,
          base.headers,
          accountId,
          apiKey,
          typeof base.sessionId === "string" ? base.sessionId : undefined,
        ),
        method: "POST",
      };
      if (base.signal) {
        requestInit.signal = base.signal;
      }
      const response = await fetch(resolveCodexUrl(model.baseUrl), requestInit);
      if (!response.ok) {
        const info = await parseErrorResponse(response);
        throw new Error(info.friendlyMessage || info.message);
      }
      if (!response.body) {
        throw new Error("No response body");
      }

      stream.push({ type: "start", partial: output });
      await processResponsesStream(
        injectNativeWebSearchTranscriptMarkers(
          mapCodexEvents(parseSSE(response)),
        ),
        output,
        stream,
        model,
      );
      if (base.signal?.aborted) {
        throw new Error("Request was aborted");
      }
      if (output.stopReason === "aborted" || output.stopReason === "error") {
        throw new Error("An unknown error occurred");
      }
      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      output.stopReason = base.signal?.aborted ? "aborted" : "error";
      output.errorMessage =
        error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

type OpenRouterImageResponseMessage = {
  content?: unknown;
  images?: unknown;
};

type OpenRouterImageResponseImage = {
  b64_json?: unknown;
  b64Json?: unknown;
  data?: unknown;
  image_url?: { url?: unknown };
  imageUrl?: { url?: unknown };
  mime_type?: unknown;
  mimeType?: unknown;
  url?: unknown;
};

function emptyAssistantUsage(): AssistantMessage["usage"] {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: {
      cacheRead: 0,
      cacheWrite: 0,
      input: 0,
      output: 0,
      total: 0,
    },
    input: 0,
    output: 0,
    totalTokens: 0,
  };
}

function openRouterImageCompat(model: Model<Api>): {
  imageOnly: boolean;
  imageOutput: boolean;
} {
  const compat = model.compat as
    | { openRouterImageOnly?: unknown; openRouterImageOutput?: unknown }
    | undefined;
  return {
    imageOnly: compat?.openRouterImageOnly === true,
    imageOutput:
      model.baseUrl.includes("openrouter.ai") &&
      compat?.openRouterImageOutput === true,
  };
}

function extractOpenRouterMessageText(
  message: OpenRouterImageResponseMessage | undefined,
): string {
  const content = message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") {
        return [];
      }
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" && text.trim() ? [text] : [];
    })
    .join("\n\n")
    .trim();
}

function openRouterImageMimeType(
  rawImage: OpenRouterImageResponseImage,
): string {
  if (typeof rawImage.mimeType === "string") {
    return rawImage.mimeType;
  }
  if (typeof rawImage.mime_type === "string") {
    return rawImage.mime_type;
  }
  return "";
}

function openRouterImageCandidateValues(rawImage: unknown): string[] {
  if (typeof rawImage === "string") {
    return [rawImage];
  }
  if (!rawImage || typeof rawImage !== "object") {
    return [];
  }
  const image = rawImage as OpenRouterImageResponseImage;
  return [
    image.image_url?.url,
    image.imageUrl?.url,
    image.url,
    image.data,
    image.b64_json,
    image.b64Json,
  ].filter((value): value is string => typeof value === "string");
}

function chatImageFromOpenRouterBase64(
  data: string,
  mimeType: string,
): ChatImageAttachment | null {
  const normalizedData = data.trim().replace(/\s+/gu, "");
  if (!normalizedData) {
    return null;
  }
  const byteSize = Buffer.from(normalizedData, "base64").byteLength;
  if (!Number.isFinite(byteSize) || byteSize > MAX_CHAT_IMAGE_BYTES) {
    return null;
  }
  const normalized = normalizeChatImageMimeType(normalizedData, mimeType);
  if ("error" in normalized) {
    return null;
  }
  return {
    data: normalizedData,
    mimeType: normalized.mimeType,
    type: "image",
  };
}

async function fetchOpenRouterImageUrl(
  url: string,
  signal?: AbortSignal,
  fetchImage: SafeOutboundFetch = createSafeOutboundHttpFetch({
    label: "OpenRouter image URL",
  }),
): Promise<ChatImageAttachment | null> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return null;
  }

  const response = await fetchImage(parsedUrl, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new Error(
      `OpenRouter image generation returned an image URL that could not be fetched (${response.status}).`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(
      "OpenRouter image generation returned an image URL with a non-image content type.",
    );
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_CHAT_IMAGE_BYTES) {
    throw new Error("OpenRouter image generation returned an oversized image.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_CHAT_IMAGE_BYTES) {
    throw new Error("OpenRouter image generation returned an oversized image.");
  }
  const base64 = Buffer.from(bytes).toString("base64");
  return chatImageFromOpenRouterBase64(base64, contentType);
}

async function chatImageFromOpenRouterCandidate(
  rawImage: unknown,
  signal?: AbortSignal,
  fetchImage?: SafeOutboundFetch,
): Promise<ChatImageAttachment | null> {
  const mimeType =
    rawImage && typeof rawImage === "object"
      ? openRouterImageMimeType(rawImage as OpenRouterImageResponseImage)
      : "";
  for (const value of openRouterImageCandidateValues(rawImage)) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const parsedDataUrl = parseChatImageDataUrl(trimmed);
    if (!("error" in parsedDataUrl)) {
      return {
        data: parsedDataUrl.data,
        mimeType: parsedDataUrl.mimeType,
        type: "image",
      };
    }
    const fetched = await fetchOpenRouterImageUrl(trimmed, signal, fetchImage);
    if (fetched) {
      return fetched;
    }
    const base64Image = chatImageFromOpenRouterBase64(trimmed, mimeType);
    if (base64Image) {
      return base64Image;
    }
  }
  return null;
}

function openRouterMessageImageCandidates(
  message: OpenRouterImageResponseMessage | undefined,
): unknown[] {
  const contentImages = Array.isArray(message?.content)
    ? message.content.filter(
        (part) =>
          !!part &&
          typeof part === "object" &&
          ("image_url" in part ||
            "imageUrl" in part ||
            "url" in part ||
            "data" in part ||
            "b64_json" in part ||
            "b64Json" in part),
      )
    : [];
  return [
    ...(Array.isArray(message?.images) ? message.images : []),
    ...contentImages,
  ];
}

export async function extractOpenRouterMessageImages(
  message: OpenRouterImageResponseMessage | undefined,
  signal?: AbortSignal,
  fetchImage?: SafeOutboundFetch,
): Promise<ChatImageAttachment[]> {
  const images: ChatImageAttachment[] = [];
  for (const rawImage of openRouterMessageImageCandidates(message)) {
    const image = await chatImageFromOpenRouterCandidate(
      rawImage,
      signal,
      fetchImage,
    );
    if (!image) {
      continue;
    }
    images.push(image);
    if (images.length >= MAX_CHAT_IMAGE_ATTACHMENTS) {
      break;
    }
  }
  return images;
}

function assistantMessageForOpenRouterImages(input: {
  images: ChatImageAttachment[];
  model: Model<Api>;
  text: string;
}): AssistantMessage {
  const content: unknown[] = [];
  if (input.text) {
    content.push({ text: input.text, type: "text" });
  }
  content.push(...input.images);
  return {
    api: input.model.api,
    content: content as AssistantMessage["content"],
    model: input.model.id,
    provider: input.model.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp: Date.now(),
    usage: emptyAssistantUsage(),
  };
}

function streamSimpleOpenRouterImages(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const imageCompat = openRouterImageCompat(model);
  if (!imageCompat.imageOutput) {
    return streamSimpleOpenAICompletions(
      model as Model<"openai-completions">,
      context,
      options,
    );
  }

  const apiKey = options?.apiKey || getEnvApiKey(model.provider);
  if (!apiKey) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }

  const base = buildBaseOptions(model, options, apiKey);
  const stream = new AssistantMessageEventStream();

  void (async () => {
    let output = assistantMessageForOpenRouterImages({
      images: [],
      model,
      text: "",
    });
    try {
      stream.push({ partial: output, type: "start" });
      const client = new OpenAI({
        apiKey,
        baseURL: model.baseUrl,
        dangerouslyAllowBrowser: true,
        defaultHeaders: { ...model.headers, ...base.headers },
      });
      let params: Record<string, unknown> = {
        messages: convertOpenAICompletionMessages(
          model as Model<"openai-completions">,
          context,
          {} as never,
        ) as unknown,
        modalities: imageCompat.imageOnly ? ["image"] : ["image", "text"],
        model: model.id,
        stream: false,
      };
      if (typeof base.maxTokens === "number") {
        params.max_tokens = base.maxTokens;
      }
      if (typeof base.temperature === "number") {
        params.temperature = base.temperature;
      }
      const nextParams = await base.onPayload?.(params, model);
      if (nextParams !== undefined) {
        params = nextParams as Record<string, unknown>;
      }

      const response = (await client.chat.completions.create(params as never, {
        ...(base.signal ? { signal: base.signal } : {}),
        ...(base.timeoutMs !== undefined ? { timeout: base.timeoutMs } : {}),
        ...(base.maxRetries !== undefined
          ? { maxRetries: base.maxRetries }
          : {}),
      })) as {
        choices?: Array<{ message?: OpenRouterImageResponseMessage }>;
      };
      const message = response.choices?.[0]?.message;
      const text = extractOpenRouterMessageText(message);
      const images = await extractOpenRouterMessageImages(message, base.signal);
      output = assistantMessageForOpenRouterImages({ images, model, text });
      if (text) {
        stream.push({ contentIndex: 0, partial: output, type: "text_start" });
        stream.push({
          contentIndex: 0,
          delta: text,
          partial: output,
          type: "text_delta",
        });
        stream.push({
          content: text,
          contentIndex: 0,
          partial: output,
          type: "text_end",
        });
      }
      if (!text && images.length === 0) {
        throw new Error(
          "OpenRouter image generation returned no text or images.",
        );
      }
      stream.push({ message: output, reason: "stop", type: "done" });
      stream.end();
    } catch (error) {
      output.stopReason = base.signal?.aborted ? "aborted" : "error";
      output.errorMessage =
        error instanceof Error ? error.message : String(error);
      stream.push({ error: output, reason: output.stopReason, type: "error" });
      stream.end();
    }
  })();

  return stream;
}

export function registerPiNativeWebSearchProviderOverrides(
  modelRegistry: ModelRegistry,
): void {
  modelRegistry.registerProvider("openrouter", {
    api: "openai-completions",
    streamSimple: (model, context, options) =>
      streamSimpleOpenRouterImages(model, context, options),
  });
  modelRegistry.registerProvider("openai", {
    api: "openai-responses",
    streamSimple: (model, context, options) =>
      streamSimpleOpenAIResponsesWithTranscriptMarkers(
        model as Model<"openai-responses">,
        context,
        options,
      ),
  });
  modelRegistry.registerProvider("openai-codex", {
    api: "openai-codex-responses",
    streamSimple: (model, context, options) =>
      streamSimpleOpenAICodexResponsesWithTranscriptMarkers(
        model as Model<"openai-codex-responses">,
        context,
        options,
      ),
  });
}
