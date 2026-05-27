/**
 * @file src/shared/provider-refresh.ts
 * @description Shared refresh cadences for model-catalog polling and provider discovery.
 */

/**
 * Keep provider discovery TTLs at or below the visible mainview poll cadence so
 * newly available models can surface on the next background catalog refresh.
 */
export const MODEL_CATALOG_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export const OLLAMA_MODEL_DISCOVERY_TTL_MS = MODEL_CATALOG_REFRESH_INTERVAL_MS;

export const NVIDIA_BUILD_MODEL_DISCOVERY_TTL_MS =
  MODEL_CATALOG_REFRESH_INTERVAL_MS;

export const OPENAI_MODEL_DISCOVERY_TTL_MS = MODEL_CATALOG_REFRESH_INTERVAL_MS;

export function providerDiscoveryRefreshDue({
  lastAttemptedAt,
  nowMs = Date.now(),
  ttlMs,
}: {
  lastAttemptedAt: string | null | undefined;
  nowMs?: number;
  ttlMs: number;
}): boolean {
  if (!lastAttemptedAt) {
    return true;
  }
  const lastAttemptedAtMs = Date.parse(lastAttemptedAt);
  if (Number.isNaN(lastAttemptedAtMs)) {
    return true;
  }
  return nowMs - lastAttemptedAtMs >= ttlMs;
}
