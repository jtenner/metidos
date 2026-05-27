/**
 * @file src/mainview/app/plugin-inventory-state.ts
 * @description Shared view-state helpers for Plugin inventory rendering.
 */

import type {
  RpcPluginInventory,
  RpcPluginInventoryGroupLabel,
  RpcPluginInventoryIssue,
  RpcPluginInventoryPlugin,
} from "../../bun/rpc-schema";

export type PluginInventoryRowIssue = {
  issue: RpcPluginInventoryIssue | null;
  tone: "danger" | "muted" | "warning";
  text: string;
};

export type PluginInventoryAttentionState = {
  fingerprint: string;
  tone: "danger" | "warning";
};

export type PluginInventoryStatusIconTone =
  | "danger"
  | "neutral"
  | "success"
  | "warning";

export function pluginInventoryDisplayName(
  plugin: RpcPluginInventoryPlugin,
): string {
  return plugin.name ?? plugin.pluginId ?? plugin.directoryName;
}

export function pluginInventoryIssueText(
  issue: RpcPluginInventoryIssue,
): string {
  const details = [issue.path, issue.code].filter((item): item is string =>
    Boolean(item),
  );
  return details.length > 0
    ? `${issue.message} (${details.join("; ")})`
    : issue.message;
}

export function shouldLoadSettingsPluginInventory({
  active,
  isAdmin,
  open,
}: {
  active?: boolean;
  isAdmin: boolean;
  open: boolean;
}): boolean {
  return Boolean(active) && isAdmin && open;
}

export function pluginInventoryRowIssue(
  plugin: RpcPluginInventoryPlugin,
): PluginInventoryRowIssue {
  const validationError = plugin.validationErrors[0];
  if (validationError) {
    return {
      issue: validationError,
      text: pluginInventoryIssueText(validationError),
      tone: "danger",
    };
  }

  const reviewWarning = plugin.reviewWarnings[0];
  if (reviewWarning) {
    return {
      issue: reviewWarning,
      text: pluginInventoryIssueText(reviewWarning),
      tone: "warning",
    };
  }

  return {
    issue: null,
    text: plugin.structurallyValid
      ? "Ready for review."
      : "Waiting for a complete plugin folder.",
    tone: "muted",
  };
}

export function pluginInventoryStatusClassName(
  group: RpcPluginInventoryGroupLabel,
): string {
  switch (group) {
    case "Active":
      return "border-success-border bg-success-surface text-success-text";
    case "Failed/Degraded":
      return "border-danger-border bg-danger-surface text-danger-text";
    case "Disabled/Restart Required":
      return "border-warning-border bg-warning-surface text-warning-text";
    case "Missing/Unavailable":
      return "border-danger-border bg-danger-surface text-danger-text";
    case "Needs Review":
      return "border-warning-border bg-warning-surface text-warning-text";
    case "Uninitialized":
      return "border-border-default bg-surface-2 text-text-muted";
  }
}

export function pluginInventoryStatusIconTone(
  group: RpcPluginInventoryGroupLabel,
): PluginInventoryStatusIconTone {
  switch (group) {
    case "Active":
      return "success";
    case "Failed/Degraded":
    case "Missing/Unavailable":
      return "danger";
    case "Disabled/Restart Required":
    case "Needs Review":
      return "warning";
    case "Uninitialized":
      return "neutral";
  }
}

export function pluginInventoryAttentionState(
  inventory: RpcPluginInventory | null,
): PluginInventoryAttentionState | null {
  if (!inventory) {
    return null;
  }
  const failingPlugins = inventory.plugins.filter(
    (plugin) =>
      plugin.status === "failed_degraded" ||
      plugin.status === "missing_unavailable" ||
      plugin.validationErrors.length > 0,
  );
  if (inventory.issues.length > 0 || failingPlugins.length > 0) {
    return {
      fingerprint: [
        "danger",
        ...inventory.issues.map((issue) => issue.code),
        ...failingPlugins.map(
          (plugin) =>
            `${plugin.directoryName}:${plugin.status}:${plugin.validationErrors.length}`,
        ),
      ].join("|"),
      tone: "danger",
    };
  }
  const reviewPlugins = inventory.plugins.filter(
    (plugin) => plugin.status === "needs_review",
  );
  if (reviewPlugins.length > 0) {
    return {
      fingerprint: [
        "warning",
        ...reviewPlugins.map(
          (plugin) =>
            `${plugin.directoryName}:${plugin.currentReviewHash ?? ""}`,
        ),
      ].join("|"),
      tone: "warning",
    };
  }
  return null;
}

export function pluginInventoryStatusLabel(
  group: RpcPluginInventoryGroupLabel,
): string {
  switch (group) {
    case "Failed/Degraded":
      return "Failed / Degraded";
    case "Disabled/Restart Required":
      return "Disabled";
    case "Missing/Unavailable":
      return "Missing";
    default:
      return group;
  }
}

function compactBytesValue(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let unitIndex = 0;
  let displayValue = value;
  while (displayValue >= 1024 && unitIndex < units.length - 1) {
    displayValue /= 1024;
    unitIndex += 1;
  }
  const formatted =
    unitIndex === 0 || Number.isInteger(displayValue)
      ? Math.round(displayValue).toLocaleString()
      : displayValue.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}

export function pluginDataUsageSummary(
  plugin: RpcPluginInventoryPlugin,
): string {
  const quota = plugin.lifecycle.settings.quota;
  return `Plugin data usage: ${compactBytesValue(plugin.dataUsage.bytes)} / ${compactBytesValue(quota.maxDataBytes)} · Files: ${plugin.dataUsage.files.toLocaleString()} / ${quota.maxFiles.toLocaleString()}`;
}

export function allPluginsFromInventory(
  inventory: RpcPluginInventory | null,
): RpcPluginInventoryPlugin[] {
  if (!inventory) {
    return [];
  }
  const plugins = new Map<string, RpcPluginInventoryPlugin>();
  for (const plugin of inventory.plugins) {
    plugins.set(plugin.folderPath, plugin);
  }
  for (const group of inventory.groups) {
    for (const plugin of group.plugins) {
      plugins.set(plugin.folderPath, plugin);
    }
  }
  return [...plugins.values()];
}

export function pluginHasSettings(plugin: RpcPluginInventoryPlugin): boolean {
  return plugin.manifest.settings.some((setting) => Boolean(setting.key));
}

export function pluginsWithDeclaredSettings(
  inventory: RpcPluginInventory | null,
): RpcPluginInventoryPlugin[] {
  return allPluginsFromInventory(inventory).filter(
    (plugin) =>
      plugin.structurallyValid &&
      plugin.manifest.settings.some((setting) => Boolean(setting.key)),
  );
}

export function pluginsWithDeclaredSettingsForScope(
  inventory: RpcPluginInventory | null,
  _scope: "settings",
): RpcPluginInventoryPlugin[] {
  return allPluginsFromInventory(inventory).filter(
    (plugin) => plugin.structurallyValid && pluginHasSettings(plugin),
  );
}
