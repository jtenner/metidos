/**
 * @file src/bun/plugin/tool-access.ts
 * @description Thread-scoped Plugin System v1 access group helpers.
 */

import type {
  RpcPluginAccessGroupOption,
  RpcPluginInventory,
  RpcPluginInventoryPlugin,
} from "../rpc-schema/plugin";
import { evaluatePluginStaticCapability } from "./capability-gate";
import { isReservedPluginId } from "./identity";
import type { PluginStartupToolRegistration } from "./startup-registrations";

const THREAD_PLUGIN_ACCESS_GROUP_LIMIT = 100;
// Access group keys intentionally use `plugin_id/group_id`; the pattern
// rejects additional slashes, and reserved/native plugin ids are blocked below.
const THREAD_PLUGIN_ACCESS_GROUP_KEY_PATTERN =
  /^[a-z][a-z0-9_]*(?:[.-]?[a-z0-9_]+)*\/[a-z][a-z0-9_]*(?:[.-]?[a-z0-9_]+)*$/;

export function pluginAccessGroupKey(
  pluginId: string,
  groupId: string,
): string {
  return `${pluginId}/${groupId}`;
}

export function normalizeThreadPluginAccessGroups(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(
      "Plugin access groups must be an array of access group keys.",
    );
  }
  if (value.length > THREAD_PLUGIN_ACCESS_GROUP_LIMIT) {
    throw new Error(
      `Plugin access groups are limited to ${THREAD_PLUGIN_ACCESS_GROUP_LIMIT} entries per thread.`,
    );
  }

  const normalized = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error("Plugin access group keys must be strings.");
    }
    const key = item.trim();
    if (!key) {
      continue;
    }
    if (!THREAD_PLUGIN_ACCESS_GROUP_KEY_PATTERN.test(key)) {
      throw new Error(
        `Invalid plugin access group key ${key}. Expected plugin_id/group_id.`,
      );
    }
    const [pluginId] = key.split("/", 1);
    if (pluginId && isReservedPluginId(pluginId)) {
      throw new Error(
        `Invalid plugin access group key ${key}. Plugin id ${pluginId} is reserved.`,
      );
    }
    normalized.add(key);
  }

  return [...normalized].sort((left, right) => left.localeCompare(right));
}

export function serializeThreadPluginAccessGroups(value: unknown): string {
  return JSON.stringify(normalizeThreadPluginAccessGroups(value));
}

export function parseThreadPluginAccessGroups(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    return normalizeThreadPluginAccessGroups(JSON.parse(value));
  } catch {
    return [];
  }
}

function pluginIsActive(plugin: RpcPluginInventoryPlugin): boolean {
  return (
    plugin.group === "Active" &&
    plugin.lifecycle.state === "active" &&
    plugin.structurallyValid &&
    plugin.validationErrors.length === 0 &&
    !!plugin.pluginId &&
    !isReservedPluginId(plugin.pluginId)
  );
}

export function listAvailablePluginAccessGroupsFromInventory(
  inventory: RpcPluginInventory,
): RpcPluginAccessGroupOption[] {
  const options: RpcPluginAccessGroupOption[] = [];
  for (const plugin of inventory.plugins) {
    if (!pluginIsActive(plugin) || !plugin.pluginId) {
      continue;
    }
    for (const group of plugin.manifest.access) {
      if (!group.id) {
        continue;
      }
      const tools = group.tools.filter((tool) => tool.name);
      const injects = (group.injects ?? []).filter((inject) => inject.name);
      if (tools.length === 0 && injects.length === 0) {
        continue;
      }
      options.push({
        color: group.color ?? null,
        description: group.description,
        groupId: group.id,
        groupName: group.name,
        key: pluginAccessGroupKey(plugin.pluginId, group.id),
        pluginDirectoryName: plugin.directoryName,
        pluginId: plugin.pluginId,
        pluginName: plugin.name,
        tools,
        injects,
      });
    }
  }
  return options.sort((left, right) => left.key.localeCompare(right.key));
}

export function enabledPluginToolRuntimeIds(input: {
  enabledAccessGroups: readonly string[];
  plugin: RpcPluginInventoryPlugin;
}): Set<string> {
  const runtimeIds = new Set<string>();
  if (!pluginIsActive(input.plugin) || !input.plugin.pluginId) {
    return runtimeIds;
  }

  const enabled = new Set(
    normalizeThreadPluginAccessGroups(input.enabledAccessGroups),
  );
  for (const group of input.plugin.manifest.access) {
    if (!group.id) {
      continue;
    }
    const groupKey = pluginAccessGroupKey(input.plugin.pluginId, group.id);
    const decision = evaluatePluginStaticCapability({
      context: {
        enabledAccessGroups: [...enabled],
        permissions: [],
        pluginId: input.plugin.pluginId,
      },
      request: { kind: "accessGroup", groupId: group.id },
    });
    if (!decision.allowed || !enabled.has(groupKey)) {
      continue;
    }
    for (const tool of group.tools) {
      if (tool.name) {
        runtimeIds.add(`${input.plugin.pluginId}_${tool.name}`);
      }
    }
  }
  return runtimeIds;
}

export function filterPluginToolRegistrationsForThread(input: {
  enabledAccessGroups: readonly string[];
  plugin: RpcPluginInventoryPlugin;
  tools: readonly PluginStartupToolRegistration[];
}): PluginStartupToolRegistration[] {
  const runtimeIds = enabledPluginToolRuntimeIds({
    enabledAccessGroups: input.enabledAccessGroups,
    plugin: input.plugin,
  });
  if (runtimeIds.size === 0) {
    return [];
  }
  return input.tools.filter((tool) => runtimeIds.has(tool.runtimeId));
}
