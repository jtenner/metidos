/**
 * @file src/bun/pi/rpc-probe-extension.ts
 *
 * Minimal Pi extension used by the runtime probe's Node RPC fallback path.
 * It registers the same mock provider contract used by the direct Bun SDK probe,
 * but stays self-contained so Pi's extension loader does not need to execute
 * the probe CLI module.
 */

import type {
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PROVIDER = "metidos-pi-probe";
const MODEL_ID = "probe-1";
const API_KEY_ENV = "METIDOS_PI_PROBE_API_KEY";
const API = "anthropic-messages";
const REPLY_PREFIX = "pi-runtime-probe";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(new Error("aborted"));
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      resolvePromise();
    }, ms);
    const onAbort = () => {
      cleanup();
      rejectPromise(new Error("aborted"));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function chunkText(text: string): string[] {
  if (text.length === 0) {
    return [""];
  }

  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += 8) {
    chunks.push(text.slice(index, index + 8));
  }
  return chunks;
}

function buildAssistantMessage(model: Model<string>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function extractLastUserText(context: Context): string {
  const lastUserMessage = [...context.messages]
    .reverse()
    .find((message) => message.role === "user");
  if (!lastUserMessage || typeof lastUserMessage.content === "string") {
    return typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : "no-user-message";
  }

  const textParts = lastUserMessage.content
    .filter((content) => content.type === "text")
    .map((content) => content.text.trim())
    .filter(Boolean);

  return textParts.join(" ") || "empty-user-message";
}

function createProbeReply(
  model: Model<string>,
  context: Context,
  options?: SimpleStreamOptions,
): string {
  const apiKey = options?.apiKey ?? "missing";
  const authorization = options?.headers?.Authorization ?? "missing";
  const lastUserText = extractLastUserText(context);
  return `${REPLY_PREFIX} provider=${model.provider} model=${model.id} apiKey=${apiKey} auth=${authorization} prompt=${lastUserText}`;
}

export default function piRpcProbeExtension(pi: ExtensionAPI) {
  pi.registerProvider(PROVIDER, {
    baseUrl: "https://pi-runtime-probe.invalid",
    apiKey: API_KEY_ENV,
    authHeader: true,
    api: API,
    models: [
      {
        id: MODEL_ID,
        name: "Metidos Pi Runtime Probe",
        api: API,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8_192,
        maxTokens: 1_024,
      },
    ],
    streamSimple(model, context, streamOptions) {
      const stream = createAssistantMessageEventStream();
      const output = buildAssistantMessage(model);
      const reply = createProbeReply(model, context, streamOptions);

      void (async () => {
        output.content.push({ type: "text", text: "" });
        stream.push({ type: "start", partial: structuredClone(output) });
        stream.push({
          type: "text_start",
          contentIndex: 0,
          partial: structuredClone(output),
        });

        for (const chunk of chunkText(reply)) {
          await sleep(25, streamOptions?.signal);
          const firstContent = output.content[0];
          if (firstContent?.type !== "text") {
            throw new Error("probe stream lost text content block");
          }
          firstContent.text += chunk;
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: chunk,
            partial: structuredClone(output),
          });
        }

        stream.push({
          type: "text_end",
          contentIndex: 0,
          content: reply,
          partial: structuredClone(output),
        });
        stream.push({
          type: "done",
          reason: "stop",
          message: structuredClone(output),
        });
        stream.end();
      })().catch((error) => {
        output.stopReason = streamOptions?.signal?.aborted
          ? "aborted"
          : "error";
        output.errorMessage = streamOptions?.signal?.aborted
          ? "Request was aborted."
          : error instanceof Error
            ? error.message
            : String(error);
        stream.push({
          type: "error",
          reason: output.stopReason === "aborted" ? "aborted" : "error",
          error: structuredClone(output),
        });
        stream.end();
      });

      return stream;
    },
  });
}
