/**
 * @file src/mainview/app/cron-describe-thread-access.ts
 * @description Access helpers for natural-language cron creation threads.
 */

export const DESCRIBE_CRON_THREAD_PERMISSION_ID = "metidos:crons";

export function permissionsForDescribeCronThread(
  cronPermissions: string[],
): string[] {
  if (cronPermissions.includes(DESCRIBE_CRON_THREAD_PERMISSION_ID)) {
    return cronPermissions;
  }
  return [...cronPermissions, DESCRIBE_CRON_THREAD_PERMISSION_ID];
}
