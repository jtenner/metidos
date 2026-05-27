/**
 * @file src/bun/plugin/embedding-capability.ts
 * @description Internal capability seam for Plugin System v1 embedding-provider execution.
 */

import { resolveSingletonLocalSettingsUserId } from "../db";
import {
  normalizeEmbeddingResult,
  type PluginEmbeddingHost,
} from "./embeddings";
import {
  type PluginModelProviderRegistration,
  resolvedPluginProviderRegistryId,
} from "./model-providers";

export type PluginEmbeddingExecutionContext = {
  contextKind: "providerExecution";
  ownerUserId?: number | null;
  projectId: number;
  threadId: number;
  worktreePath: string;
};

export type PluginEmbeddingProviderInvocation = {
  context: PluginEmbeddingExecutionContext;
  input: unknown;
  model: Record<string, unknown>;
  options?: unknown;
  registration: PluginModelProviderRegistration;
};

export type PluginEmbeddingRuntimeSettings = {
  embeddingModel: string;
};

export type PluginEmbeddingModelSelection = {
  modelId: string;
  providerRegistryId: string;
};

function contextRecordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function pluginEmbeddingExecutionContextFromUnknown(input: {
  context?: unknown;
  ownerUserId: number;
}): PluginEmbeddingExecutionContext {
  const context = contextRecordFromUnknown(input.context);
  return {
    contextKind: "providerExecution",
    ownerUserId: input.ownerUserId,
    projectId: isFiniteNumber(context.projectId) ? context.projectId : -1,
    threadId: isFiniteNumber(context.threadId) ? context.threadId : -1,
    worktreePath:
      typeof context.worktreePath === "string" ? context.worktreePath : "",
  };
}

export function localOperatorUserIdFromPluginEmbeddingContext(
  _context: unknown,
): number {
  return resolveSingletonLocalSettingsUserId();
}

export function parsePluginEmbeddingModelSelection(
  modelKey: string,
): PluginEmbeddingModelSelection {
  const normalizedModelKey = modelKey.trim();
  if (!normalizedModelKey) {
    throw new Error("No embedding model is configured for the local operator.");
  }
  const slashSeparator = normalizedModelKey.lastIndexOf("/");
  const colonSeparator = normalizedModelKey.indexOf(":");
  const separator = slashSeparator > 0 ? slashSeparator : colonSeparator;
  if (separator <= 0 || separator === normalizedModelKey.length - 1) {
    throw new Error(
      "Configured embedding model must include a provider and model id.",
    );
  }
  return {
    modelId: normalizedModelKey.slice(separator + 1),
    providerRegistryId: normalizedModelKey.slice(0, separator),
  };
}

export function pluginModelProviderRegistrationProvidesEmbeddingModel(input: {
  modelId: string;
  providerRegistryId: string;
  registration: PluginModelProviderRegistration;
}): boolean {
  return Boolean(
    input.registration.providesEmbeddings &&
      input.registration.embedHandle &&
      resolvedPluginProviderRegistryId(input.registration) ===
        input.providerRegistryId &&
      Array.isArray(input.registration.configuration.models) &&
      input.registration.configuration.models.some(
        (model) =>
          model &&
          typeof model === "object" &&
          !Array.isArray(model) &&
          (model as Record<string, unknown>).id === input.modelId,
      ),
  );
}

export async function executePluginEmbeddingRequest(input: {
  context?: unknown;
  invokeProviderEmbedding: (
    invocation: PluginEmbeddingProviderInvocation,
  ) => Promise<unknown>;
  input: unknown;
  listProviderRegistrations: () => readonly PluginModelProviderRegistration[];
  payload: unknown;
  readRuntimeSettings: (ownerUserId: number) => PluginEmbeddingRuntimeSettings;
}): Promise<number[]> {
  const ownerUserId = localOperatorUserIdFromPluginEmbeddingContext(
    input.context,
  );
  const settings = input.readRuntimeSettings(ownerUserId);
  const { modelId, providerRegistryId } = parsePluginEmbeddingModelSelection(
    settings.embeddingModel,
  );
  const registration = input.listProviderRegistrations().find((candidate) =>
    pluginModelProviderRegistrationProvidesEmbeddingModel({
      modelId,
      providerRegistryId,
      registration: candidate,
    }),
  );
  if (!registration) {
    throw new Error("Configured embedding model is unavailable.");
  }
  const result = await input.invokeProviderEmbedding({
    context: pluginEmbeddingExecutionContextFromUnknown({
      context: input.context,
      ownerUserId,
    }),
    input: input.input,
    model: { id: modelId, provider: providerRegistryId },
    options: input.payload,
    registration,
  });
  return normalizeEmbeddingResult(result);
}

export function createPluginEmbeddingHost(input: {
  execute: (request: Parameters<PluginEmbeddingHost>[0]) => Promise<number[]>;
}): PluginEmbeddingHost {
  return input.execute;
}
