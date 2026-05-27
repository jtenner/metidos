/**
 * @file src/bun/pi/metidos/model-discovery.ts
 * @description Pi-native Metidos model catalog discovery tools.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { RpcModelCatalog } from "../../rpc-schema";
import {
  type PiMetidosToolHost,
  textToolResult,
  withMetidosToolTelemetry,
} from "./shared";

const ModelsQueryToolParameters = Type.Object({
  provider: Type.String({
    description:
      "Exact model provider id from model_providers, for example openai-codex or openrouter.",
    minLength: 1,
  }),
  query: Type.String({
    description:
      "Case-insensitive model search text. Use an empty string to list every model for the provider.",
  }),
});

type ModelProviderRow = {
  available: boolean;
  modelCount: number;
  note: string | null;
  providerId: string;
  providerLabel: string;
};

type ModelQueryRow = {
  available: boolean;
  contextWindowTokens: number;
  label: string;
  model: string;
  modelId: string;
  providerId: string;
  providerLabel: string;
  reasoningEfforts: string[];
  supportsReasoningEffort: boolean;
};

function requireModelCatalogHost(
  host: PiMetidosToolHost,
): NonNullable<PiMetidosToolHost["getModelCatalog"]> {
  if (!host.getModelCatalog) {
    throw new Error(
      "Model discovery tools require a Metidos model catalog tool host.",
    );
  }
  return host.getModelCatalog;
}

function escapeCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  return String(Math.round(value));
}

function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSearchSeparators(value: string): string {
  return normalizeSearchQuery(value)
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchCompact(value: string): string {
  return normalizeSearchQuery(value).replace(/[^a-z0-9]+/g, "");
}

function matchesSearchQuery(
  query: string,
  ...values: Array<string | null | undefined>
): boolean {
  if (!query) {
    return true;
  }

  const normalizedQuery = normalizeSearchQuery(query);
  const separatedQuery = normalizeSearchSeparators(query);
  const compactQuery = normalizeSearchCompact(query);
  return values.some((value) => {
    if (!value) {
      return false;
    }

    const normalizedValue = normalizeSearchQuery(value);
    return (
      normalizedValue.includes(normalizedQuery) ||
      (!!separatedQuery &&
        normalizeSearchSeparators(value).includes(separatedQuery)) ||
      (!!compactQuery && normalizeSearchCompact(value).includes(compactQuery))
    );
  });
}

function providerRows(catalog: RpcModelCatalog): ModelProviderRow[] {
  const providers = new Map<string, ModelProviderRow>();
  for (const model of catalog.models) {
    const current = providers.get(model.providerId) ?? {
      available: model.providerAvailable ?? true,
      modelCount: 0,
      note: model.providerAvailabilityNote ?? null,
      providerId: model.providerId,
      providerLabel: model.providerLabel || model.group || model.providerId,
    };
    if (!model.isPlaceholder) {
      current.modelCount += 1;
    }
    if (model.providerAvailable === false) {
      current.available = false;
      current.note = model.providerAvailabilityNote ?? current.note;
    }
    providers.set(model.providerId, current);
  }
  return [...providers.values()];
}

function providersMarkdown(rows: readonly ModelProviderRow[]): string {
  const lines = [
    "| Provider id | Label | Models | Available | Note |",
    "|---|---|---:|---|---|",
    ...rows.map(
      (row) =>
        `| ${escapeCell(row.providerId)} | ${escapeCell(row.providerLabel)} | ${row.modelCount} | ${yesNo(row.available)} | ${escapeCell(row.note)} |`,
    ),
  ];
  return lines.join("\n");
}

function queryRows(
  catalog: RpcModelCatalog,
  providerId: string,
  query: string,
): ModelQueryRow[] {
  return catalog.models
    .filter(
      (model) =>
        model.providerId === providerId &&
        !model.isPlaceholder &&
        matchesSearchQuery(
          query,
          model.id,
          model.label,
          model.modelId,
          model.summary,
        ),
    )
    .map((model) => ({
      available: model.providerAvailable ?? true,
      contextWindowTokens: model.contextWindowTokens,
      label: model.label,
      model: model.id,
      modelId: model.modelId,
      providerId: model.providerId,
      providerLabel: model.providerLabel || model.group || model.providerId,
      reasoningEfforts:
        model.supportsReasoningEffort === true
          ? (model.supportedReasoningEfforts ?? [])
          : [],
      supportsReasoningEffort: model.supportsReasoningEffort,
    }));
}

function reasoningCell(row: ModelQueryRow): string {
  if (!row.supportsReasoningEffort) {
    return "no";
  }
  return row.reasoningEfforts.length > 0
    ? row.reasoningEfforts.join(", ")
    : "yes";
}

function modelsMarkdown(rows: readonly ModelQueryRow[]): string {
  const lines = [
    "| Model argument | Label | Provider | Provider model id | Reasoning efforts | Context tokens | Available |",
    "|---|---|---|---|---|---:|---|",
    ...rows.map(
      (row) =>
        `| ${escapeCell(row.model)} | ${escapeCell(row.label)} | ${escapeCell(row.providerId)} | ${escapeCell(row.modelId)} | ${escapeCell(reasoningCell(row))} | ${formatTokenCount(row.contextWindowTokens)} | ${yesNo(row.available)} |`,
    ),
  ];
  return lines.join("\n");
}

function exactProviderExists(
  catalog: RpcModelCatalog,
  providerId: string,
): boolean {
  return catalog.models.some((model) => model.providerId === providerId);
}

export function createPiMetidosModelDiscoveryTools(
  host: PiMetidosToolHost,
): ToolDefinition[] {
  return [
    withMetidosToolTelemetry(
      defineTool({
        description:
          "List exact model provider ids from the Pi-backed model catalog. Use the Provider id column as models_query.provider.",
        execute: async () => {
          const catalog = await requireModelCatalogHost(host)();
          const rows = providerRows(catalog);
          return textToolResult(
            rows.length === 0
              ? "No model providers found."
              : `Model providers. Use Provider id exactly as models_query.provider.\n\n${providersMarkdown(rows)}`,
            { providers: rows },
          );
        },
        label: "List Model Providers",
        name: "model_providers",
        parameters: Type.Object({}),
        promptGuidelines: [
          "Use this before models_query when you do not know the exact provider id.",
          "Copy Provider id exactly into models_query.provider.",
        ],
        promptSnippet:
          "List exact model provider ids for thread and cron model selection",
      }),
    ),
    withMetidosToolTelemetry(
      defineTool({
        description:
          "Search models for one exact provider id. The Model argument column is exactly what new_thread, new_cron, and update_cron accept as model.",
        execute: async (_toolCallId, params) => {
          const provider = params.provider.trim();
          const query = params.query.trim();
          const catalog = await requireModelCatalogHost(host)();
          if (!exactProviderExists(catalog, provider)) {
            throw new Error(
              `Model provider not found: ${provider}. Call model_providers and copy an exact Provider id.`,
            );
          }
          const rows = queryRows(catalog, provider, query);
          const heading = query
            ? `Models for provider ${provider} matching ${query}.`
            : `Models for provider ${provider}.`;
          return textToolResult(
            rows.length === 0
              ? `${heading}\n\nNo matching models found.`
              : `${heading} Use Model argument exactly as the model value for new_thread, new_cron, or update_cron. Reasoning is supplied separately as reasoningEffort.\n\n${modelsMarkdown(rows)}`,
            { models: rows, provider, query },
          );
        },
        label: "Search Models",
        name: "models_query",
        parameters: ModelsQueryToolParameters,
        promptGuidelines: [
          "provider must exactly match a Provider id from model_providers.",
          "Use the Model argument table column exactly as the model parameter for new_thread, new_cron, or update_cron.",
          "Pass reasoningEffort separately. Valid values shown in the Reasoning efforts column are minimal, low, medium, high, and xhigh.",
        ],
        promptSnippet: "Search exact thread/cron model arguments by provider",
      }),
    ),
  ];
}
