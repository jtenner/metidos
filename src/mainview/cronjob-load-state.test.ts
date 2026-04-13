/**
 * @file src/mainview/cronjob-load-state.test.ts
 * @description Test file for cronjob list load behavior.
 */

import { describe, expect, it } from "bun:test";

import { resolveCronJobsLoadBehavior } from "./cronjob-load-state";

describe("resolveCronJobsLoadBehavior", () => {
  it("shows the loading state only for the first foreground load", () => {
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

  it("keeps initialized empty-state refreshes in the background", () => {
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

  it("keeps manual refreshes foreground without re-showing the spinner", () => {
    expect(
      resolveCronJobsLoadBehavior({
        hasInitializedCronJobs: true,
        isBackgroundRefresh: false,
        requestInFlight: false,
      }),
    ).toEqual({
      clearError: true,
      mode: "foreground",
      showLoadingState: false,
    });
  });

  it("skips duplicate requests while a cron load is already running", () => {
    expect(
      resolveCronJobsLoadBehavior({
        hasInitializedCronJobs: true,
        isBackgroundRefresh: false,
        requestInFlight: true,
      }),
    ).toEqual({
      clearError: false,
      mode: "skip",
      showLoadingState: false,
    });
  });
});
