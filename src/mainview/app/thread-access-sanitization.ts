/**
 * @file src/mainview/app/thread-access-sanitization.ts
 * @description Helpers for dropping stale/inactive Thread Access Control permission ids from UI submissions.
 */

import type {
  RpcPluginAccessGroupOption,
  RpcThreadPermissionDescriptor,
} from "../../bun/rpc-schema";
import {
  LEGACY_THREAD_ACCESS_PERMISSION_IDS,
  projectThreadAccessControl,
} from "../../shared/thread-access-projection";
import type { ThreadAccessValue } from "../controls/thread-access-control";

function pluginAccessGroupPermissionId(
  group: RpcPluginAccessGroupOption,
): string {
  return `${group.pluginId}:${group.groupId}`;
}

function knownThreadPermissionIds({
  availablePluginAccessGroups,
  availableThreadPermissionDescriptors,
}: {
  availablePluginAccessGroups: readonly RpcPluginAccessGroupOption[];
  availableThreadPermissionDescriptors: readonly RpcThreadPermissionDescriptor[];
}): Set<string> {
  return new Set([
    ...Object.values(LEGACY_THREAD_ACCESS_PERMISSION_IDS),
    ...availableThreadPermissionDescriptors.map((descriptor) => descriptor.id),
    ...availablePluginAccessGroups.map(pluginAccessGroupPermissionId),
  ]);
}

/**
 * Remove permission ids that no longer have a live descriptor/access group.
 *
 * Disabled or needs-review plugins intentionally disappear from the selectable
 * permission registry. Existing threads/persisted defaults can still contain
 * their old ids, but the chat UI must not keep resubmitting those stale ids
 * when the user changes unrelated model or access settings.
 */
export function sanitizeThreadAccessValue({
  access,
  availablePluginAccessGroups,
  availableThreadPermissionDescriptors,
}: {
  access: ThreadAccessValue;
  availablePluginAccessGroups?: readonly RpcPluginAccessGroupOption[];
  availableThreadPermissionDescriptors?: readonly RpcThreadPermissionDescriptor[];
}): ThreadAccessValue {
  const knownPermissionIds = knownThreadPermissionIds({
    availablePluginAccessGroups: availablePluginAccessGroups ?? [],
    availableThreadPermissionDescriptors:
      availableThreadPermissionDescriptors ?? [],
  });
  const availablePluginAccessGroupKeys = new Set(
    (availablePluginAccessGroups ?? []).map((group) => group.key),
  );
  const permissions = (access.permissions ?? []).filter((permission) =>
    knownPermissionIds.has(permission),
  );
  return projectThreadAccessControl({
    ...access,
    permissions,
    pluginAccessGroups: (access.pluginAccessGroups ?? []).filter((group) =>
      availablePluginAccessGroupKeys.has(group),
    ),
  });
}

export function threadAccessPermissionsWereSanitized({
  access,
  sanitizedAccess,
}: {
  access: ThreadAccessValue;
  sanitizedAccess: ThreadAccessValue;
}): boolean {
  const permissions = access.permissions ?? [];
  const sanitizedPermissions = sanitizedAccess.permissions ?? [];
  if (permissions.length !== sanitizedPermissions.length) {
    return true;
  }
  const sanitizedSet = new Set(sanitizedPermissions);
  return permissions.some((permission) => !sanitizedSet.has(permission));
}
