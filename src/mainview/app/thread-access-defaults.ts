/**
 * @file src/mainview/app/thread-access-defaults.ts
 * @description Helpers for safe-by-default thread and cron access presets.
 */

import type { ThreadAccessValue } from "../controls/thread-access-control";

/**
 * Returns child thread or cron access defaults that preserve non-unsafe scopes
 * while requiring an explicit opt-in for unsafe execution.
 * @param access - Base access selection.
 */
export function deriveSafeChildAccessDefaults(
  access: ThreadAccessValue,
): ThreadAccessValue {
  return {
    webSearchAccess: access.webSearchAccess,
    githubAccess: access.githubAccess,
    agentsAccess: access.agentsAccess,
    metidosAccess: access.metidosAccess,
    unsafeMode: false,
  };
}
