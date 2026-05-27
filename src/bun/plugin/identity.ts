/**
 * @file src/bun/plugin/identity.ts
 * @description Shared Plugin System v1 identity, namespace, and identifier rules.
 */

export const RESERVED_PLUGIN_IDS = ["metidos"] as const;
export const RESERVED_PLUGIN_ID_SET = new Set<string>(RESERVED_PLUGIN_IDS);

export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
export const PLUGIN_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const PLUGIN_TOOL_ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export function isReservedPluginId(pluginId: string): boolean {
  return RESERVED_PLUGIN_ID_SET.has(pluginId.trim().toLowerCase());
}

export function isReservedPluginDisplayName(name: string): boolean {
  return name.trim().toLowerCase() === "metidos";
}
