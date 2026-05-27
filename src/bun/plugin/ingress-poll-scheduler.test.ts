import { describe, expect, test } from "bun:test";
import {
  PLUGIN_INGRESS_POLL_INTERVAL_MAX_MS,
  PLUGIN_INGRESS_POLL_INTERVAL_MIN_MS,
} from "./ingress";
import {
  clampPluginIngressPollIntervalMs,
  isPluginIngressPollEligible,
  PluginIngressPollScheduler,
  type PluginIngressPollSchedulerClock,
} from "./ingress-poll-scheduler";

class ManualClock implements PluginIngressPollSchedulerClock {
  timers = new Map<number, () => void>();
  cleared = new Set<number>();
  nextId = 1;
  now(): number {
    return 0;
  }
  setTimeout(callback: () => void, _delayMs: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, callback);
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.cleared.add(handle as number);
    this.timers.delete(handle as number);
  }
}

describe("plugin ingress poll scheduler", () => {
  test("clamps effective intervals to host bounds", () => {
    expect(clampPluginIngressPollIntervalMs(undefined)).toBe(
      PLUGIN_INGRESS_POLL_INTERVAL_MIN_MS,
    );
    expect(clampPluginIngressPollIntervalMs(1)).toBe(
      PLUGIN_INGRESS_POLL_INTERVAL_MIN_MS,
    );
    expect(clampPluginIngressPollIntervalMs(30_000)).toBe(30_000);
    expect(clampPluginIngressPollIntervalMs(Number.MAX_SAFE_INTEGER)).toBe(
      PLUGIN_INGRESS_POLL_INTERVAL_MAX_MS,
    );
  });

  test("excludes inactive plugin and source lifecycle states", () => {
    expect(
      isPluginIngressPollEligible({
        pluginActive: true,
        pluginApproved: true,
        pluginCurrent: true,
        sourceEnabled: true,
      }),
    ).toBe(true);
    for (const pluginLifecycleStatus of [
      "needs_review",
      "disabled",
      "failed",
      "degraded",
      "missing",
      "unavailable",
    ] as const) {
      expect(
        isPluginIngressPollEligible({
          pluginActive: true,
          pluginApproved: true,
          pluginCurrent: true,
          sourceEnabled: true,
          pluginLifecycleStatus,
        }),
      ).toBe(false);
    }
    expect(
      isPluginIngressPollEligible({
        pluginActive: true,
        pluginApproved: true,
        pluginCurrent: true,
        sourceEnabled: false,
      }),
    ).toBe(false);
  });

  test("polls one source at a time, advances cursor only after batch handling, and resets failures on success", async () => {
    const clock = new ManualClock();
    const batches: unknown[] = [];
    let calls = 0;
    const scheduler = new PluginIngressPollScheduler({
      clock,
      hooks: {
        onBatch: (batch) => {
          batches.push(batch);
        },
      },
    });
    scheduler.upsertSource({
      pluginId: "plugin-a",
      sourceId: "direct",
      pollIntervalMs: 5_000,
      timeoutMs: 10_000,
      eligibility: {
        pluginActive: true,
        pluginApproved: true,
        pluginCurrent: true,
        sourceEnabled: true,
      },
      async poll(context) {
        calls += 1;
        expect(context.maxMessages).toBe(50);
        expect(context.cursor).toBeUndefined();
        await scheduler.pollNow("plugin-a", "direct");
        return {
          cursor: "cursor-1",
          messages: [{ id: "m1", user_id: "u1", message: "hello" }],
        };
      },
    });

    await scheduler.pollNow("plugin-a", "direct");

    expect(calls).toBe(1);
    expect(batches).toHaveLength(1);
    expect(scheduler.snapshot("plugin-a", "direct")).toMatchObject({
      cursor: "cursor-1",
      consecutiveFailures: 0,
      state: "healthy",
      inFlight: false,
    });
  });

  test("backs off failures, degrades only the source, and recovers after success", async () => {
    const clock = new ManualClock();
    let shouldFail = true;
    const scheduler = new PluginIngressPollScheduler({ clock });
    scheduler.upsertSource({
      pluginId: "plugin-a",
      sourceId: "direct",
      pollIntervalMs: 5_000,
      timeoutMs: 10_000,
      eligibility: {
        pluginActive: true,
        pluginApproved: true,
        pluginCurrent: true,
        sourceEnabled: true,
      },
      async poll() {
        if (shouldFail) throw new Error("provider failed");
        return { cursor: "good", messages: [] };
      },
    });

    for (let index = 0; index < 5; index += 1) {
      await scheduler.pollNow("plugin-a", "direct");
    }
    expect(scheduler.snapshot("plugin-a", "direct")).toMatchObject({
      consecutiveFailures: 5,
      state: "degraded",
      nextDelayMs: 20_000,
    });

    shouldFail = false;
    await scheduler.pollNow("plugin-a", "direct");
    expect(scheduler.snapshot("plugin-a", "direct")).toMatchObject({
      cursor: "good",
      consecutiveFailures: 0,
      state: "healthy",
      nextDelayMs: 5_000,
    });
  });

  test("shutdown cancels timers and in-flight work", () => {
    const clock = new ManualClock();
    const scheduler = new PluginIngressPollScheduler({ clock });
    scheduler.upsertSource({
      pluginId: "plugin-a",
      sourceId: "direct",
      pollIntervalMs: 5_000,
      timeoutMs: 10_000,
      eligibility: {
        pluginActive: true,
        pluginApproved: true,
        pluginCurrent: true,
        sourceEnabled: true,
      },
      async poll() {
        return { messages: [] };
      },
    });

    expect(clock.timers.size).toBe(1);
    scheduler.shutdown();
    expect(clock.timers.size).toBe(0);
    expect(clock.cleared.size).toBe(1);
  });
});
