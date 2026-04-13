/**
 * @file src/mainview/cronjob-load-state.ts
 * @description Module for cronjob list load behavior.
 */

export type CronJobsLoadBehavior = {
  clearError: boolean;
  mode: "background" | "foreground" | "skip";
  showLoadingState: boolean;
};

export function resolveCronJobsLoadBehavior(options: {
  hasInitializedCronJobs: boolean;
  isBackgroundRefresh: boolean;
  requestInFlight: boolean;
}): CronJobsLoadBehavior {
  const { hasInitializedCronJobs, isBackgroundRefresh, requestInFlight } =
    options;
  if (requestInFlight) {
    return {
      clearError: false,
      mode: "skip",
      showLoadingState: false,
    };
  }

  const mode = isBackgroundRefresh ? "background" : "foreground";
  return {
    clearError: mode === "foreground",
    mode,
    showLoadingState: mode === "foreground" && !hasInitializedCronJobs,
  };
}
