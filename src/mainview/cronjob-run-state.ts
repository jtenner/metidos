/**
 * @file src/mainview/cronjob-run-state.ts
 * @description Helpers for Mainview cron job run guards.
 */

export function claimCronJobRun(
  runningCronJobIds: Set<number>,
  cronJobId: number,
): boolean {
  if (runningCronJobIds.has(cronJobId)) {
    return false;
  }
  runningCronJobIds.add(cronJobId);
  return true;
}

export function releaseCronJobRun(
  runningCronJobIds: Set<number>,
  cronJobId: number,
): void {
  runningCronJobIds.delete(cronJobId);
}
