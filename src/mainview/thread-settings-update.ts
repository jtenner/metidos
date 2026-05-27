/**
 * @file src/mainview/thread-settings-update.ts
 * @description Helpers for applying asynchronous thread setting updates.
 */

export function shouldApplyThreadSettingUpdateToSelection({
  requestedThreadId,
  selectedThreadId,
}: {
  requestedThreadId: number;
  selectedThreadId: number | null;
}): boolean {
  return selectedThreadId === requestedThreadId;
}
