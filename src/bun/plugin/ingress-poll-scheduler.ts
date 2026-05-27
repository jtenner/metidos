/**
 * @file src/bun/plugin/ingress-poll-scheduler.ts
 * @description Host-owned scheduler policy for Plugin System v1 request ingress polling.
 */

import {
  estimateBase64ByteLength,
  isChatImageByteSizeAllowed,
  MAX_CHAT_IMAGE_ATTACHMENTS,
  normalizeChatImageMimeType,
} from "../../shared/chat-images";
import {
  PLUGIN_INGRESS_POLL_INTERVAL_MAX_MS,
  PLUGIN_INGRESS_POLL_INTERVAL_MIN_MS,
  PLUGIN_INGRESS_POLL_MAX_MESSAGES,
  type PluginIngressMessage,
  type PluginIngressPollContext,
  type PluginIngressPollResult,
} from "./ingress";

export const PLUGIN_INGRESS_POLL_FAILURES_UNTIL_DEGRADED = 5;

export type PluginIngressPollSourceState = "healthy" | "degraded";

export type PluginIngressPollSourceEligibility = Readonly<{
  pluginActive: boolean;
  pluginApproved: boolean;
  pluginCurrent: boolean;
  pluginLifecycleStatus?:
    | "active"
    | "approved"
    | "current"
    | "needs_review"
    | "disabled"
    | "disabled_restart_required"
    | "failed"
    | "failed_degraded"
    | "degraded"
    | "missing"
    | "missing_unavailable"
    | "unavailable"
    | "uninitialized";
  sourceEnabled: boolean;
}>;

export type PluginIngressPollSourceRegistration = Readonly<{
  pluginId: string;
  sourceId: string;
  pollIntervalMs?: number | null;
  timeoutMs: number;
  maxMessages?: number | null;
  initialCursor?: string | null;
  eligibility: PluginIngressPollSourceEligibility;
  poll(context: PluginIngressPollContext): Promise<PluginIngressPollResult>;
}>;

export type PluginIngressPollSchedulerClock = Readonly<{
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

export type PluginIngressPollMessageBatch = Readonly<{
  pluginId: string;
  sourceId: string;
  cursor?: string;
  messages: readonly PluginIngressMessage[];
}>;

export type PluginIngressPollFailure = Readonly<{
  pluginId: string;
  sourceId: string;
  error: unknown;
}>;

export type PluginIngressPollSchedulerHooks = Readonly<{
  onBatch?: (batch: PluginIngressPollMessageBatch) => void | Promise<void>;
  onFailure?: (failure: PluginIngressPollFailure) => void;
  onStateChange?: (snapshot: PluginIngressPollSourceSnapshot) => void;
}>;

export type PluginIngressPollSourceSnapshot = Readonly<{
  pluginId: string;
  sourceId: string;
  cursor?: string;
  inFlight: boolean;
  consecutiveFailures: number;
  state: PluginIngressPollSourceState;
  nextDelayMs: number;
}>;

type MutableSource = {
  registration: PluginIngressPollSourceRegistration;
  cursor?: string;
  inFlight: boolean;
  consecutiveFailures: number;
  state: PluginIngressPollSourceState;
  timer: unknown | null;
  abortController: AbortController | null;
  nextDelayMs: number;
};

const DEFAULT_CLOCK: PluginIngressPollSchedulerClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return timer;
  },
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function clampPluginIngressPollIntervalMs(
  value: number | null | undefined,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return PLUGIN_INGRESS_POLL_INTERVAL_MIN_MS;
  }
  return Math.min(
    PLUGIN_INGRESS_POLL_INTERVAL_MAX_MS,
    Math.max(PLUGIN_INGRESS_POLL_INTERVAL_MIN_MS, value),
  );
}

export function isPluginIngressPollEligible(
  eligibility: PluginIngressPollSourceEligibility,
): boolean {
  if (
    !eligibility.pluginActive ||
    !eligibility.pluginApproved ||
    !eligibility.pluginCurrent ||
    !eligibility.sourceEnabled
  ) {
    return false;
  }
  return !new Set([
    "needs_review",
    "disabled",
    "disabled_restart_required",
    "failed",
    "failed_degraded",
    "degraded",
    "missing",
    "missing_unavailable",
    "unavailable",
    "uninitialized",
  ]).has(eligibility.pluginLifecycleStatus ?? "active");
}

export class PluginIngressPollScheduler {
  private readonly sources = new Map<string, MutableSource>();
  private readonly clock: PluginIngressPollSchedulerClock;
  private readonly hooks: PluginIngressPollSchedulerHooks;
  private stopped = false;

  constructor(
    options: {
      clock?: PluginIngressPollSchedulerClock;
      hooks?: PluginIngressPollSchedulerHooks;
    } = {},
  ) {
    this.clock = options.clock ?? DEFAULT_CLOCK;
    this.hooks = options.hooks ?? {};
  }

  upsertSource(registration: PluginIngressPollSourceRegistration): void {
    const key = this.key(registration.pluginId, registration.sourceId);
    const existing = this.sources.get(key);
    if (existing) {
      existing.registration = registration;
      if (registration.initialCursor === null) {
        delete existing.cursor;
      } else if (registration.initialCursor !== undefined) {
        existing.cursor = registration.initialCursor;
      }
      existing.nextDelayMs = clampPluginIngressPollIntervalMs(
        registration.pollIntervalMs,
      );
      this.reschedule(existing, existing.nextDelayMs);
      return;
    }
    const source: MutableSource = {
      registration,
      ...(registration.initialCursor === undefined ||
      registration.initialCursor === null
        ? {}
        : { cursor: registration.initialCursor }),
      inFlight: false,
      consecutiveFailures: 0,
      state: "healthy",
      timer: null,
      abortController: null,
      nextDelayMs: clampPluginIngressPollIntervalMs(
        registration.pollIntervalMs,
      ),
    };
    this.sources.set(key, source);
    this.reschedule(source, source.nextDelayMs);
  }

  removeSource(pluginId: string, sourceId: string): void {
    const source = this.sources.get(this.key(pluginId, sourceId));
    if (!source) return;
    this.cancel(source);
    this.sources.delete(this.key(pluginId, sourceId));
  }

  removePlugin(pluginId: string): void {
    for (const source of [...this.sources.values()]) {
      if (source.registration.pluginId === pluginId) {
        this.removeSource(pluginId, source.registration.sourceId);
      }
    }
  }

  snapshot(
    pluginId: string,
    sourceId: string,
  ): PluginIngressPollSourceSnapshot | null {
    const source = this.sources.get(this.key(pluginId, sourceId));
    return source ? this.toSnapshot(source) : null;
  }

  shutdown(): void {
    this.stopped = true;
    for (const source of this.sources.values()) this.cancel(source);
    this.sources.clear();
  }

  async pollNow(pluginId: string, sourceId: string): Promise<void> {
    const source = this.sources.get(this.key(pluginId, sourceId));
    if (!source || this.stopped || source.inFlight) return;
    if (!isPluginIngressPollEligible(source.registration.eligibility)) return;

    source.inFlight = true;
    const abortController = new AbortController();
    source.abortController = abortController;
    const timeout = this.clock.setTimeout(
      () => abortController.abort(),
      source.registration.timeoutMs,
    );
    try {
      const pollContext: PluginIngressPollContext = {
        ...(source.cursor !== undefined ? { cursor: source.cursor } : {}),
        maxMessages: Math.min(
          source.registration.maxMessages ?? PLUGIN_INGRESS_POLL_MAX_MESSAGES,
          PLUGIN_INGRESS_POLL_MAX_MESSAGES,
        ),
        signal: abortController.signal,
      };
      const result = await source.registration.poll(pollContext);
      this.validateResult(result);
      if (this.hooks.onBatch) {
        const batch: PluginIngressPollMessageBatch = {
          pluginId: source.registration.pluginId,
          sourceId: source.registration.sourceId,
          ...(result.cursor !== undefined ? { cursor: result.cursor } : {}),
          messages: result.messages,
        };
        await this.hooks.onBatch(batch);
      }
      if (result.cursor !== undefined) source.cursor = result.cursor;
      source.consecutiveFailures = 0;
      source.state = "healthy";
      source.nextDelayMs = clampPluginIngressPollIntervalMs(
        source.registration.pollIntervalMs,
      );
    } catch (error) {
      source.consecutiveFailures += 1;
      source.nextDelayMs = this.failureDelay(source);
      if (
        source.consecutiveFailures >=
        PLUGIN_INGRESS_POLL_FAILURES_UNTIL_DEGRADED
      )
        source.state = "degraded";
      this.hooks.onFailure?.({
        pluginId: source.registration.pluginId,
        sourceId: source.registration.sourceId,
        error,
      });
    } finally {
      this.clock.clearTimeout(timeout);
      source.inFlight = false;
      source.abortController = null;
      this.hooks.onStateChange?.(this.toSnapshot(source));
      this.reschedule(source, source.nextDelayMs);
    }
  }

  private validateResult(result: PluginIngressPollResult): void {
    if (
      !result ||
      !Array.isArray(result.messages) ||
      result.messages.length > PLUGIN_INGRESS_POLL_MAX_MESSAGES
    ) {
      throw new Error("Invalid plugin ingress poll result");
    }
    for (const message of result.messages) {
      this.validateMessage(message);
    }
  }

  private validateMessage(message: PluginIngressMessage): void {
    if (!message || typeof message !== "object") {
      throw new Error("Invalid plugin ingress poll result");
    }
    const images = message.images ?? [];
    if (!Array.isArray(images) || images.length > MAX_CHAT_IMAGE_ATTACHMENTS) {
      throw new Error("Invalid plugin ingress image attachments");
    }
    for (const image of images) {
      if (image?.type !== "image" || typeof image.data !== "string") {
        throw new Error("Invalid plugin ingress image attachment");
      }
      const mimeType = typeof image.mimeType === "string" ? image.mimeType : "";
      if ("error" in normalizeChatImageMimeType(image.data, mimeType)) {
        throw new Error("Invalid plugin ingress image attachment");
      }
      if (!isChatImageByteSizeAllowed(estimateBase64ByteLength(image.data))) {
        throw new Error("Plugin ingress image attachment is too large");
      }
    }
  }

  private failureDelay(source: MutableSource): number {
    const base = clampPluginIngressPollIntervalMs(
      source.registration.pollIntervalMs,
    );
    const multiplier = Math.min(
      4,
      2 ** Math.max(0, source.consecutiveFailures - 1),
    );
    return Math.min(PLUGIN_INGRESS_POLL_INTERVAL_MAX_MS, base * multiplier);
  }

  private reschedule(source: MutableSource, delayMs: number): void {
    if (source.timer) this.clock.clearTimeout(source.timer);
    source.timer = null;
    if (
      this.stopped ||
      !isPluginIngressPollEligible(source.registration.eligibility)
    )
      return;
    source.timer = this.clock.setTimeout(() => {
      source.timer = null;
      void this.pollNow(
        source.registration.pluginId,
        source.registration.sourceId,
      );
    }, delayMs);
  }

  private cancel(source: MutableSource): void {
    if (source.timer) this.clock.clearTimeout(source.timer);
    source.abortController?.abort();
    source.timer = null;
    source.abortController = null;
    source.inFlight = false;
  }

  private toSnapshot(source: MutableSource): PluginIngressPollSourceSnapshot {
    return {
      pluginId: source.registration.pluginId,
      sourceId: source.registration.sourceId,
      ...(source.cursor !== undefined ? { cursor: source.cursor } : {}),
      inFlight: source.inFlight,
      consecutiveFailures: source.consecutiveFailures,
      state: source.state,
      nextDelayMs: source.nextDelayMs,
    };
  }

  private key(pluginId: string, sourceId: string): string {
    return `${pluginId}\u0000${sourceId}`;
  }
}
