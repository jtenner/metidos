/**
 * @file src/mainview/cronjob-load-state.ts
 * @description Module for cronjob list load behavior.
 */

export type CronJobsLoadBehavior = {
  clearError: boolean;
  mode: "background" | "foreground" | "skip";
  showLoadingState: boolean;
};

export type CronJobsInvalidationBehavior =
  | { mode: "ignore" }
  | { mode: "queue-background-refresh" }
  | { isBackgroundRefresh: boolean; mode: "load" };

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

export function resolveCronJobsInvalidationBehavior(options: {
  hasInitializedCronJobs: boolean;
  isDocumentVisible: boolean;
  requestInFlight: boolean;
}): CronJobsInvalidationBehavior {
  const { hasInitializedCronJobs, isDocumentVisible, requestInFlight } =
    options;
  if (!hasInitializedCronJobs && !isDocumentVisible) return { mode: "ignore" };
  if (requestInFlight) return { mode: "queue-background-refresh" };
  return {
    isBackgroundRefresh: hasInitializedCronJobs,
    mode: "load",
  };
}
