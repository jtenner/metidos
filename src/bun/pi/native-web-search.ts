/**
 * @file src/bun/pi/native-web-search.ts
 * @description Provider-native web-search helpers for the embedded Pi runtime.
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";

import { recordNativeWebSearchDecision } from "../runtime-stats";

export type PiNativeWebSearchProvider = "openai" | "openai-codex";
export type PiWebSearchRuntimeMode = "disabled" | "native" | "brave";

type NativeWebSearchPayload = {
  tool_choice?: unknown;
  tools?: unknown;
};

function isOpenAINativeWebSearchModelId(modelId: string): boolean {
  return (
    modelId.startsWith("gpt-5") ||
    modelId.startsWith("o3") ||
    modelId.startsWith("o4") ||
    modelId.startsWith("codex-mini")
  );
}

export function resolvePiNativeWebSearchProvider(
  model: Pick<Model<Api>, "api" | "id" | "provider"> | null | undefined,
): PiNativeWebSearchProvider | null {
  if (!model) {
    return null;
  }

  if (model.provider === "openai") {
    return model.api === "openai-responses" &&
      isOpenAINativeWebSearchModelId(model.id)
      ? "openai"
      : null;
  }

  if (model.provider === "openai-codex") {
    return model.api === "openai-codex-responses" &&
      isOpenAINativeWebSearchModelId(model.id)
      ? "openai-codex"
      : null;
  }

  return null;
}

export function usesPiNativeWebSearch(
  model: Pick<Model<Api>, "api" | "id" | "provider"> | null | undefined,
): boolean {
  return resolvePiNativeWebSearchProvider(model) !== null;
}

export function resolvePiWebSearchRuntimeMode(input: {
  model: Pick<Model<Api>, "api" | "id" | "provider"> | null | undefined;
  webSearchAccess: boolean | null | undefined;
}): PiWebSearchRuntimeMode {
  if (input.webSearchAccess === false) {
    return "disabled";
  }
  return usesPiNativeWebSearch(input.model) ? "native" : "brave";
}

export function buildPiWebSearchPromptLine(
  model: Pick<Model<Api>, "api" | "id" | "provider"> | null | undefined,
): string {
  const provider = resolvePiNativeWebSearchProvider(model);
  if (provider === "openai") {
    return "Provider-native web search is enabled for this runtime through the OpenAI Responses API. Use built-in web search when current information or citations are needed.";
  }
  if (provider === "openai-codex") {
    return "Provider-native web search is enabled for this runtime through the OpenAI Codex Responses API. Use built-in web search when current information or citations are needed.";
  }
  return "Web search tools are installed in this runtime: web_search and web_fetch. When a provider does not offer native web search, web_search uses the Brave Search API through BRAVE_SEARCH_API_KEY and web_fetch performs a direct fetch-based page read.";
}

function hasNativeWebSearchTool(tools: readonly unknown[]): boolean {
  return tools.some(
    (tool) =>
      !!tool &&
      typeof tool === "object" &&
      "type" in tool &&
      tool.type === "web_search",
  );
}

function injectNativeWebSearchTool(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const candidate = payload as NativeWebSearchPayload & Record<string, unknown>;
  const existingTools = Array.isArray(candidate.tools) ? candidate.tools : [];
  if (hasNativeWebSearchTool(existingTools)) {
    return payload;
  }

  return {
    ...candidate,
    ...(typeof candidate.tool_choice === "undefined"
      ? {
          tool_choice: "auto",
        }
      : {}),
    tools: [...existingTools, { type: "web_search" }],
  } satisfies NativeWebSearchPayload;
}

export function createPiNativeWebSearchExtension(thread: {
  webSearchAccess?: boolean | null;
}): ExtensionFactory {
  return (pi) => {
    pi.on("before_provider_request", (event, ctx) => {
      if (thread.webSearchAccess === false) {
        return undefined;
      }

      const provider = resolvePiNativeWebSearchProvider(ctx.model);
      if (!provider) {
        return undefined;
      }

      const nextPayload = injectNativeWebSearchTool(event.payload);
      if (nextPayload === event.payload) {
        recordNativeWebSearchDecision({
          decision: "skipped",
          provider,
        });
        return undefined;
      }

      recordNativeWebSearchDecision({
        decision: "injected",
        provider,
      });
      return nextPayload;
    });
  };
}
