/**
 * @file src/mainview/app/use-mainview-staleness-refresh-controller.ts
 * @description Detects long main-thread gaps and requests a background state refresh.
 */

import { useEffect, useRef } from "react";

export const MAINVIEW_STALENESS_REFRESH_INTERVAL_MS = 5_000;
export const MAINVIEW_STALENESS_REFRESH_GAP_MS = 45_000;
export const MAINVIEW_STALENESS_REFRESH_COOLDOWN_MS = 30_000;

export type MainviewStalenessRefreshDecision =
  | {
      shouldRefresh: true;
      nextObservedAt: number;
      nextRefreshRequestedAt: number;
    }
  | {
      shouldRefresh: false;
      nextObservedAt: number;
      nextRefreshRequestedAt: number;
    };

export function resolveMainviewStalenessRefreshDecision(options: {
  now: number;
  previousObservedAt: number;
  lastRefreshRequestedAt: number;
  gapThresholdMs?: number;
  cooldownMs?: number;
}): MainviewStalenessRefreshDecision {
  const gapThresholdMs =
    options.gapThresholdMs ?? MAINVIEW_STALENESS_REFRESH_GAP_MS;
  const cooldownMs =
    options.cooldownMs ?? MAINVIEW_STALENESS_REFRESH_COOLDOWN_MS;
  const gapMs = options.now - options.previousObservedAt;
  const cooldownElapsedMs = options.now - options.lastRefreshRequestedAt;
  const shouldRefresh =
    gapMs >= gapThresholdMs && cooldownElapsedMs >= cooldownMs;

  return {
    shouldRefresh,
    nextObservedAt: options.now,
    nextRefreshRequestedAt: shouldRefresh
      ? options.now
      : options.lastRefreshRequestedAt,
  };
}

export function useMainviewStalenessRefreshController(options: {
  enabled: boolean;
  requestRefresh: (reason: "event-loop-gap" | "visibility-return") => void;
  gapThresholdMs?: number;
  intervalMs?: number;
  cooldownMs?: number;
}): void {
  const requestRefreshRef = useRef(options.requestRefresh);
  const lastObservedAtRef = useRef(Date.now());
  const hiddenAtRef = useRef<number | null>(
    typeof document === "undefined" || document.visibilityState === "visible"
      ? null
      : Date.now(),
  );
  const lastRefreshRequestedAtRef = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    requestRefreshRef.current = options.requestRefresh;
  }, [options.requestRefresh]);

  useEffect(() => {
    if (!options.enabled) {
      lastObservedAtRef.current = Date.now();
      return;
    }

    const gapThresholdMs =
      options.gapThresholdMs ?? MAINVIEW_STALENESS_REFRESH_GAP_MS;
    const cooldownMs =
      options.cooldownMs ?? MAINVIEW_STALENESS_REFRESH_COOLDOWN_MS;
    const intervalMs =
      options.intervalMs ?? MAINVIEW_STALENESS_REFRESH_INTERVAL_MS;

    const observe = (reason: "event-loop-gap" | "visibility-return"): void => {
      const decision = resolveMainviewStalenessRefreshDecision({
        now: Date.now(),
        previousObservedAt: lastObservedAtRef.current,
        lastRefreshRequestedAt: lastRefreshRequestedAtRef.current,
        gapThresholdMs,
        cooldownMs,
      });
      lastObservedAtRef.current = decision.nextObservedAt;
      lastRefreshRequestedAtRef.current = decision.nextRefreshRequestedAt;
      if (decision.shouldRefresh) {
        requestRefreshRef.current(reason);
      }
    };

    const handleVisibilityChange = (): void => {
      const now = Date.now();
      if (document.visibilityState !== "visible") {
        hiddenAtRef.current = now;
        lastObservedAtRef.current = now;
        return;
      }

      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt !== null) {
        lastObservedAtRef.current = hiddenAt;
      }
      observe("visibility-return");
    };

    lastObservedAtRef.current = Date.now();
    const timer = window.setInterval(
      () => observe("event-loop-gap"),
      intervalMs,
    );
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    options.cooldownMs,
    options.enabled,
    options.gapThresholdMs,
    options.intervalMs,
  ]);
}
