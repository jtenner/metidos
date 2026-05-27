/**
 * @file src/bun/pi/metidos/permission-normalization.ts
 * @description Shared permission-array normalization for agent-facing thread and cron tools.
 */

import {
  createThreadPermissionDescriptor,
  createThreadPermissionRegistry,
  normalizeThreadPermissions,
  pluginPermissionDescriptorsFromInventory,
  type ThreadPermissionDescriptorInput,
  type ThreadPermissionRegistry,
} from "../../thread-permissions";
import type { PiMetidosToolHost } from "./shared";

export const METIDOS_UNSAFE_PERMISSION = "metidos:unsafe";

async function loadPluginPermissionDescriptors(
  host: PiMetidosToolHost,
): Promise<ThreadPermissionDescriptorInput[]> {
  if (!host.getPluginInventory) {
    return [];
  }

  const inventory = await host.getPluginInventory(undefined);
  const descriptors = pluginPermissionDescriptorsFromInventory(inventory);
  const accepted: ThreadPermissionDescriptorInput[] = [];
  for (const descriptor of descriptors) {
    try {
      createThreadPermissionDescriptor(descriptor);
      accepted.push(descriptor);
    } catch {
      // Invalid plugin descriptors are omitted from the registry. The list tool
      // reports descriptor diagnostics; mutation tools only need the accepted set.
    }
  }
  return accepted;
}

export async function loadThreadPermissionRegistry(
  host: PiMetidosToolHost,
): Promise<ThreadPermissionRegistry> {
  return createThreadPermissionRegistry({
    pluginDescriptors: await loadPluginPermissionDescriptors(host),
  });
}

export async function normalizeRequestedPermissions(
  value: unknown,
  host: PiMetidosToolHost,
): Promise<string[]> {
  try {
    return normalizeThreadPermissions(
      value,
      await loadThreadPermissionRegistry(host),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid permissions.";
    throw new Error(
      `${message} Call metidos_list_permissions to inspect valid permission strings.`,
    );
  }
}

export function preparePermissionArrayArguments<T>(value: unknown): T {
  if (!value || typeof value !== "object") {
    return value as T;
  }
  const record = { ...(value as Record<string, unknown>) };
  if (Array.isArray(record.permissions)) {
    const normalized = new Set<string>();
    for (const item of record.permissions) {
      if (typeof item !== "string") {
        continue;
      }
      const permission = item.trim();
      if (permission) {
        normalized.add(permission);
      }
    }
    record.permissions = [...normalized].sort((left, right) =>
      left.localeCompare(right),
    );
  }
  return record as T;
}

export function requestedUnsafePermission(
  permissions: readonly string[] | null | undefined,
): boolean {
  return permissions?.includes(METIDOS_UNSAFE_PERMISSION) === true;
}
