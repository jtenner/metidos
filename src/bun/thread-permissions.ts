/**
 * @file src/bun/thread-permissions.ts
 * @description Dynamic thread permission registry for native and plugin-provided access.
 */

import { DEFAULT_THREAD_ACCESS_PERMISSION_IDS } from "../shared/thread-access-projection";
import { isReservedPluginId } from "./plugin/identity";
import type { RpcPluginInventory } from "./rpc-schema";

export const METIDOS_PERMISSION_PROVIDER_ID = "metidos";
export const METIDOS_NATIVE_PROVIDER_DESCRIPTION = "Metidos native tools";

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const ACCESS_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const THREAD_PERMISSION_LIMIT = 200;

export type ThreadPermissionCategory =
  | "agent-runtime"
  | "browser"
  | "coordination"
  | "data"
  | "external"
  | "plugin"
  | "security";

export type ThreadPermissionDescriptor = {
  id: string;
  providerId: string;
  providerDescription: string;
  accessId: string;
  label: string;
  description: string;
  category: ThreadPermissionCategory;
  defaultEnabled: boolean;
  requiresApproval: boolean;
  unsafe: boolean;
  order: number;
};

export type ThreadPermissionRegistry = {
  descriptors: ThreadPermissionDescriptor[];
  byId: Map<string, ThreadPermissionDescriptor>;
};

export type ThreadPermissionDescriptorInput = Partial<
  Pick<
    ThreadPermissionDescriptor,
    | "category"
    | "defaultEnabled"
    | "label"
    | "order"
    | "requiresApproval"
    | "unsafe"
  >
> & {
  accessId: string;
  description: string;
  providerDescription: string;
  providerId: string;
};

export class ThreadPermissionRegistryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ThreadPermissionRegistryError";
    this.code = code;
  }
}

// Defaults mirror the local IDE's expected out-of-box agent workflow: web search
// and coordination helpers are available by default, while filesystem mutation,
// GitHub, local webserver, plugin, and unsafe capabilities remain opt-in.
const METIDOS_NATIVE_PERMISSION_INPUTS: ThreadPermissionDescriptorInput[] = [
  {
    accessId: "web-search",
    category: "external",
    defaultEnabled:
      DEFAULT_THREAD_ACCESS_PERMISSION_IDS.includes("metidos:web-search"),
    description: "Current-information web search/fetch capability.",
    providerDescription: METIDOS_NATIVE_PROVIDER_DESCRIPTION,
    providerId: METIDOS_PERMISSION_PROVIDER_ID,
  },
  {
    accessId: "webserver",
    category: "agent-runtime",
    defaultEnabled: false,
    description: "Project-scoped local web server helpers.",
    providerDescription: METIDOS_NATIVE_PROVIDER_DESCRIPTION,
    providerId: METIDOS_PERMISSION_PROVIDER_ID,
  },
  {
    accessId: "github",
    category: "external",
    defaultEnabled: false,
    description: "GitHub-native tool family.",
    providerDescription: METIDOS_NATIVE_PROVIDER_DESCRIPTION,
    providerId: METIDOS_PERMISSION_PROVIDER_ID,
  },
  {
    accessId: "git",
    category: "data",
    defaultEnabled: false,
    description: "Worktree-scoped local Git helpers.",
    providerDescription: METIDOS_NATIVE_PROVIDER_DESCRIPTION,
    providerId: METIDOS_PERMISSION_PROVIDER_ID,
  },
  {
    accessId: "sqlite",
    category: "data",
    defaultEnabled: false,
    description: "Project-scoped SQLite helper.",
    providerDescription: METIDOS_NATIVE_PROVIDER_DESCRIPTION,
    providerId: METIDOS_PERMISSION_PROVIDER_ID,
  },
  {
    accessId: "lancedb",
    category: "data",
    defaultEnabled: false,
    description: "Project-scoped LanceDB vector search helper.",
    providerDescription: METIDOS_NATIVE_PROVIDER_DESCRIPTION,
    providerId: METIDOS_PERMISSION_PROVIDER_ID,
  },
  {
    accessId: "agents",
    category: "coordination",
    defaultEnabled: false,
    description:
      "Pi-era coordination tools such as update_plan and delegate_task.",
    providerDescription: METIDOS_NATIVE_PROVIDER_DESCRIPTION,
    providerId: METIDOS_PERMISSION_PROVIDER_ID,
  },
  {
    accessId: "calendar",
    category: "data",
    defaultEnabled: false,
    description: "Calendar and calendar-event tools.",
    providerDescription: METIDOS_NATIVE_PROVIDER_DESCRIPTION,
    providerId: METIDOS_PERMISSION_PROVIDER_ID,
  },
  {
    accessId: "notifications",
    category: "external",
    defaultEnabled: false,
    description: "User notification tools.",
    providerDescription: METIDOS_NATIVE_PROVIDER_DESCRIPTION,
    providerId: METIDOS_PERMISSION_PROVIDER_ID,
  },
  {
    accessId: "threads",
    category: "coordination",
    defaultEnabled:
      DEFAULT_THREAD_ACCESS_PERMISSION_IDS.includes("metidos:threads"),
    description: "Thread listing and child thread creation tools.",
    providerDescription: METIDOS_NATIVE_PROVIDER_DESCRIPTION,
    providerId: METIDOS_PERMISSION_PROVIDER_ID,
  },
  {
    accessId: "crons",
    category: "coordination",
    defaultEnabled:
      DEFAULT_THREAD_ACCESS_PERMISSION_IDS.includes("metidos:crons"),
    description: "Cron listing, creation, update, and show tools.",
    providerDescription: METIDOS_NATIVE_PROVIDER_DESCRIPTION,
    providerId: METIDOS_PERMISSION_PROVIDER_ID,
  },
  {
    accessId: "unsafe",
    category: "security",
    defaultEnabled: false,
    description: "Unsafe execution/sandbox escalation permission.",
    providerDescription: METIDOS_NATIVE_PROVIDER_DESCRIPTION,
    providerId: METIDOS_PERMISSION_PROVIDER_ID,
    requiresApproval: true,
    unsafe: true,
  },
];

function assertProviderId(providerId: string): void {
  if (!PROVIDER_ID_PATTERN.test(providerId)) {
    throw new ThreadPermissionRegistryError(
      "invalid_permission_provider_id",
      `Invalid permission provider id ${providerId}. Expected a plugin id or metidos.`,
    );
  }
}

function assertAccessId(accessId: string): void {
  if (!ACCESS_ID_PATTERN.test(accessId)) {
    throw new ThreadPermissionRegistryError(
      "invalid_permission_access_id",
      `Invalid permission access id ${accessId}. Access ids must be lowercase and cannot contain ':'.`,
    );
  }
}

export function permissionIdFor(providerId: string, accessId: string): string {
  assertProviderId(providerId);
  assertAccessId(accessId);
  return `${providerId}:${accessId}`;
}

export function createThreadPermissionDescriptor(
  input: ThreadPermissionDescriptorInput,
): ThreadPermissionDescriptor {
  assertProviderId(input.providerId);
  assertAccessId(input.accessId);
  if (!input.providerDescription.trim()) {
    throw new ThreadPermissionRegistryError(
      "invalid_permission_provider_description",
      "Permission provider descriptions must be non-empty.",
    );
  }
  if (!input.description.trim()) {
    throw new ThreadPermissionRegistryError(
      "invalid_permission_description",
      "Permission descriptions must be non-empty.",
    );
  }

  const id = permissionIdFor(input.providerId, input.accessId);
  if (
    input.providerId === METIDOS_PERMISSION_PROVIDER_ID &&
    !id.startsWith("metidos:")
  ) {
    throw new ThreadPermissionRegistryError(
      "invalid_native_permission_id",
      "Metidos-native permissions must use the metidos: prefix.",
    );
  }

  return {
    accessId: input.accessId,
    category:
      input.category ??
      (input.providerId === METIDOS_PERMISSION_PROVIDER_ID
        ? "agent-runtime"
        : "plugin"),
    defaultEnabled: input.defaultEnabled === true,
    description: input.description.trim(),
    id,
    label: input.label?.trim() || input.accessId,
    order: input.order ?? 0,
    providerDescription: input.providerDescription.trim(),
    providerId: input.providerId,
    requiresApproval: input.requiresApproval === true,
    unsafe: input.unsafe === true,
  };
}

export function metidosNativePermissionDescriptors(): ThreadPermissionDescriptor[] {
  return METIDOS_NATIVE_PERMISSION_INPUTS.map((input, index) =>
    createThreadPermissionDescriptor({ ...input, order: index }),
  );
}

function sortDescriptors(
  left: ThreadPermissionDescriptor,
  right: ThreadPermissionDescriptor,
): number {
  const provider =
    left.providerId === METIDOS_PERMISSION_PROVIDER_ID &&
    right.providerId !== METIDOS_PERMISSION_PROVIDER_ID
      ? -1
      : right.providerId === METIDOS_PERMISSION_PROVIDER_ID &&
          left.providerId !== METIDOS_PERMISSION_PROVIDER_ID
        ? 1
        : left.providerId.localeCompare(right.providerId);
  if (provider !== 0) {
    return provider;
  }
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  return left.accessId.localeCompare(right.accessId);
}

export function createThreadPermissionRegistry(input?: {
  pluginDescriptors?: ThreadPermissionDescriptorInput[];
}): ThreadPermissionRegistry {
  for (const descriptor of input?.pluginDescriptors ?? []) {
    if (isReservedPluginId(descriptor.providerId)) {
      throw new ThreadPermissionRegistryError(
        "reserved_plugin_permission_provider_id",
        `Plugin permission provider id ${descriptor.providerId} is reserved for Metidos-native permissions.`,
      );
    }
  }
  const descriptors = [
    ...metidosNativePermissionDescriptors(),
    ...(input?.pluginDescriptors ?? []).map(createThreadPermissionDescriptor),
  ].sort(sortDescriptors);
  const byId = new Map<string, ThreadPermissionDescriptor>();
  for (const descriptor of descriptors) {
    const duplicate = byId.get(descriptor.id);
    if (duplicate) {
      throw new ThreadPermissionRegistryError(
        "duplicate_thread_permission_id",
        `Duplicate thread permission id ${descriptor.id}.`,
      );
    }
    byId.set(descriptor.id, descriptor);
  }
  return { byId, descriptors };
}

export function normalizeThreadPermissions(
  value: unknown,
  registry: ThreadPermissionRegistry = createThreadPermissionRegistry(),
): string[] {
  // The default registry intentionally contains only native Metidos
  // permissions. Request paths that allow plugin permissions must pass a
  // registry built from the current plugin inventory so inactive/unknown plugin
  // access cannot be smuggled through this native-only fallback.
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ThreadPermissionRegistryError(
      "invalid_thread_permissions",
      "Thread permissions must be an array of permission strings.",
    );
  }
  if (value.length > THREAD_PERMISSION_LIMIT) {
    throw new ThreadPermissionRegistryError(
      "too_many_thread_permissions",
      `Thread permissions are limited to ${THREAD_PERMISSION_LIMIT} entries.`,
    );
  }
  const normalized = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      throw new ThreadPermissionRegistryError(
        "invalid_thread_permission",
        "Thread permission entries must be strings.",
      );
    }
    const permission = item.trim();
    if (!permission) {
      continue;
    }
    if (!registry.byId.has(permission)) {
      throw new ThreadPermissionRegistryError(
        "unknown_thread_permission",
        `Unknown thread permission ${permission}.`,
      );
    }
    normalized.add(permission);
  }
  return [...normalized].sort((left, right) => left.localeCompare(right));
}

export function hasThreadPermission(
  permissions: readonly string[],
  id: string,
): boolean {
  return new Set(permissions).has(id);
}

export function defaultThreadPermissions(
  registry: ThreadPermissionRegistry = createThreadPermissionRegistry(),
): string[] {
  return registry.descriptors
    .filter((descriptor) => descriptor.defaultEnabled)
    .map((descriptor) => descriptor.id)
    .sort((left, right) => left.localeCompare(right));
}

export function permissionDescriptorsForAgentCatalog(
  registry: ThreadPermissionRegistry = createThreadPermissionRegistry(),
): ThreadPermissionDescriptor[] {
  return [...registry.descriptors];
}

function pluginIsActive(
  plugin: RpcPluginInventory["plugins"][number],
): boolean {
  return (
    plugin.group === "Active" &&
    plugin.lifecycle.state === "active" &&
    plugin.structurallyValid &&
    plugin.validationErrors.length === 0 &&
    !!plugin.pluginId &&
    !isReservedPluginId(plugin.pluginId)
  );
}

export function pluginPermissionDescriptorsFromInventory(
  inventory: RpcPluginInventory,
): ThreadPermissionDescriptorInput[] {
  const descriptors: ThreadPermissionDescriptorInput[] = [];
  for (const plugin of inventory.plugins) {
    if (!pluginIsActive(plugin) || !plugin.pluginId) {
      continue;
    }
    for (const group of plugin.manifest.access) {
      if (
        !group.id ||
        (group.tools.filter((tool) => tool.name).length === 0 &&
          (group.injects ?? []).filter((inject) => inject.name).length === 0)
      ) {
        continue;
      }
      descriptors.push({
        accessId: group.id,
        category: "plugin",
        defaultEnabled: false,
        description:
          group.description?.trim() ||
          group.name?.trim() ||
          `Plugin access ${group.id}.`,
        label: group.name?.trim() || group.id,
        providerDescription:
          plugin.description?.trim() || plugin.name?.trim() || "Plugin tools",
        providerId: plugin.pluginId,
      });
    }
  }
  return descriptors;
}
