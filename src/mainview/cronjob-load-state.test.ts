import { describe, expect, it } from "bun:test";

import {
  resolveCronJobsInvalidationBehavior,
  resolveCronJobsLoadBehavior,
} from "./cronjob-load-state";

describe("cron job list controller load state", () => {
  it("uses foreground RPC loading state for the first visible list request", () => {
    expect(
      resolveCronJobsLoadBehavior({
        hasInitializedCronJobs: false,
        isBackgroundRefresh: false,
        requestInFlight: false,
      }),
    ).toEqual({
      clearError: true,
      mode: "foreground",
      showLoadingState: true,
    });
  });

  it("keeps initialized refreshes in the background without clearing row state", () => {
    expect(
      resolveCronJobsLoadBehavior({
        hasInitializedCronJobs: true,
        isBackgroundRefresh: true,
        requestInFlight: false,
      }),
    ).toEqual({
      clearError: false,
      mode: "background",
      showLoadingState: false,
    });
  });

  it("skips duplicate list RPCs while a cron list request is already in flight", () => {
    expect(
      resolveCronJobsLoadBehavior({
        hasInitializedCronJobs: true,
        isBackgroundRefresh: true,
        requestInFlight: true,
      }),
    ).toEqual({
      clearError: false,
      mode: "skip",
      showLoadingState: false,
    });
  });
});

describe("cron job list refresh invalidation", () => {
  it("ignores hidden cron invalidations before the list has initialized", () => {
    expect(
      resolveCronJobsInvalidationBehavior({
        hasInitializedCronJobs: false,
        isDocumentVisible: false,
        requestInFlight: false,
      }),
    ).toEqual({ mode: "ignore" });
  });

  it("queues a single background refresh when invalidated during an in-flight RPC", () => {
    expect(
      resolveCronJobsInvalidationBehavior({
        hasInitializedCronJobs: true,
        isDocumentVisible: true,
        requestInFlight: true,
      }),
    ).toEqual({ mode: "queue-background-refresh" });
  });

  it("loads immediately after initialization using a background RPC refresh", () => {
    expect(
      resolveCronJobsInvalidationBehavior({
        hasInitializedCronJobs: true,
        isDocumentVisible: false,
        requestInFlight: false,
      }),
    ).toEqual({
      isBackgroundRefresh: true,
      mode: "load",
    });
  });

  it("loads immediately before initialization when the cron workspace is visible", () => {
    expect(
      resolveCronJobsInvalidationBehavior({
        hasInitializedCronJobs: false,
        isDocumentVisible: true,
        requestInFlight: false,
      }),
    ).toEqual({
      isBackgroundRefresh: false,
      mode: "load",
    });
  });
});
