/**
 * @file src/mainview/app/model-catalog-events.ts
 * @description Browser event channel for pushed model catalog updates.
 */

import type { RpcModelCatalog } from "../../bun/rpc-schema";

export const MODEL_CATALOG_CHANGED_EVENT_NAME = "metidos:model-catalog-changed";

function modelOptionsEqual(
  left: RpcModelCatalog["models"][number],
  right: RpcModelCatalog["models"][number],
): boolean {
  return (
    left.id === right.id &&
    left.modelId === right.modelId &&
    left.label === right.label &&
    left.group === right.group &&
    left.providerId === right.providerId &&
    left.providerLabel === right.providerLabel &&
    left.providerAvailable === right.providerAvailable &&
    left.providerAvailabilityNote === right.providerAvailabilityNote &&
    left.summary === right.summary &&
    left.contextWindowTokens === right.contextWindowTokens &&
    left.supportsReasoningEffort === right.supportsReasoningEffort &&
    left.supportsImageInput === right.supportsImageInput &&
    left.deprecated === right.deprecated &&
    left.isPlaceholder === right.isPlaceholder
  );
}

function reasoningEffortsEqual(
  left: RpcModelCatalog["reasoningEfforts"][number],
  right: RpcModelCatalog["reasoningEfforts"][number],
): boolean {
  return left.id === right.id && left.label === right.label;
}

export function modelCatalogsEqual(
  left: RpcModelCatalog | null | undefined,
  right: RpcModelCatalog | null | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.defaultModel === right.defaultModel &&
    left.defaultReasoningEffort === right.defaultReasoningEffort &&
    left.models.length === right.models.length &&
    left.models.every((model, index) => {
      const rightModel = right.models[index];
      return Boolean(rightModel && modelOptionsEqual(model, rightModel));
    }) &&
    left.reasoningEfforts.length === right.reasoningEfforts.length &&
    left.reasoningEfforts.every((effort, index) => {
      const rightEffort = right.reasoningEfforts[index];
      return Boolean(rightEffort && reasoningEffortsEqual(effort, rightEffort));
    })
  );
}

export function publishModelCatalogChanged(
  modelCatalog: RpcModelCatalog,
): void {
  window.dispatchEvent(
    new CustomEvent<RpcModelCatalog>(MODEL_CATALOG_CHANGED_EVENT_NAME, {
      detail: modelCatalog,
    }),
  );
}

export function subscribeToModelCatalogChanged(
  listener: (modelCatalog: RpcModelCatalog) => void,
): () => void {
  const handleModelCatalogChanged = (event: Event): void => {
    listener((event as CustomEvent<RpcModelCatalog>).detail);
  };

  window.addEventListener(
    MODEL_CATALOG_CHANGED_EVENT_NAME,
    handleModelCatalogChanged,
  );
  return () => {
    window.removeEventListener(
      MODEL_CATALOG_CHANGED_EVENT_NAME,
      handleModelCatalogChanged,
    );
  };
}
