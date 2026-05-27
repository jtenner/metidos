/**
 * @file src/bun/project-procedures/model-catalog-cache.ts
 * @description Shared invalidation counter for the Pi model catalog cache.
 */

let modelCatalogStateGeneration = 0;

export function invalidateModelCatalogState(): void {
  modelCatalogStateGeneration += 1;
}

export function getModelCatalogStateGeneration(): number {
  return modelCatalogStateGeneration;
}
