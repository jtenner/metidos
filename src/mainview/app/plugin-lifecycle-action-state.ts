/**
 * @file src/mainview/app/plugin-lifecycle-action-state.ts
 * @description Shared view-state helpers for Plugin lifecycle action rendering.
 */

import type {
  RpcPluginAdminAction,
  RpcPluginInventoryIssue,
  RpcPluginInventoryPlugin,
  RpcPluginLifecycleAction,
} from "../../bun/rpc-schema";

export type PluginActionFeedbackState = {
  error: string;
  hasError: boolean;
  hasMessage: boolean;
  message: string;
};

export type PluginLifecycleActionViewState = {
  busy: boolean;
  disabled: boolean;
  disabledReason: string | null;
  key: string;
  label: string;
  title: string | undefined;
};

export type PluginLifecycleActionButtonState = PluginLifecycleActionViewState;

export function pluginLifecycleActionKey(
  plugin: RpcPluginInventoryPlugin,
  action: RpcPluginLifecycleAction,
): string {
  return `${plugin.directoryName}:${action}`;
}

export function pluginAdminActionKey(
  plugin: RpcPluginInventoryPlugin,
  action: RpcPluginAdminAction,
): string {
  return `${plugin.directoryName}:admin:${action}`;
}

export function pluginActionIsBusy({
  actionKey,
  actionLoadingKey,
}: {
  actionKey: string;
  actionLoadingKey: string | null;
}): boolean {
  return actionLoadingKey === actionKey;
}

export function clearPluginActionKey(
  currentActionKey: string | null,
  completedActionKey: string,
): string | null {
  return currentActionKey === completedActionKey ? null : currentActionKey;
}

export function pluginActionFeedbackState({
  error,
  message,
}: {
  error: string;
  message: string;
}): PluginActionFeedbackState {
  return {
    error,
    hasError: error.trim().length > 0,
    hasMessage: message.trim().length > 0,
    message,
  };
}

export function pluginLifecycleActionLabel(
  action: RpcPluginLifecycleAction,
): string {
  switch (action) {
    case "enable":
      return "Enable";
    case "review_changes":
      return "Review Plugin Changes";
    case "reapprove":
      return "Re-approve Plugin";
    case "disable":
      return "Disable";
    case "retry":
      return "Retry Plugin";
  }
}

export function pluginLifecycleActionDisplayLabel(
  plugin: RpcPluginInventoryPlugin,
  action: RpcPluginLifecycleAction,
): string {
  if (plugin.status === "disabled_restart_required" && action === "reapprove") {
    return "Enable";
  }
  if (plugin.status === "needs_review" && action === "reapprove") {
    return "Approve";
  }
  return pluginLifecycleActionLabel(action);
}

export function pluginIssuesExceptReviewHashChanged(
  issues: RpcPluginInventoryIssue[],
): RpcPluginInventoryIssue[] {
  return issues.filter((issue) => issue.code !== "review_hash_changed");
}

export function pluginLifecycleActionBlockingErrors(
  plugin: RpcPluginInventoryPlugin,
  action: RpcPluginLifecycleAction,
): RpcPluginInventoryIssue[] {
  if (action !== "reapprove") {
    return plugin.validationErrors;
  }
  return pluginIssuesExceptReviewHashChanged(plugin.validationErrors);
}

export function pluginLifecycleActionDisabledReason(
  plugin: RpcPluginInventoryPlugin,
  action: RpcPluginLifecycleAction,
): string | null {
  if (
    action !== "enable" &&
    action !== "review_changes" &&
    action !== "reapprove" &&
    action !== "retry"
  ) {
    return null;
  }
  return pluginLifecycleActionBlockingErrors(plugin, action).length > 0
    ? "Resolve activation-blocking errors before this lifecycle action."
    : null;
}

export function pluginLifecycleActionViewState({
  action,
  actionLoadingKey,
  plugin,
}: {
  action: RpcPluginLifecycleAction;
  actionLoadingKey: string | null;
  plugin: RpcPluginInventoryPlugin;
}): PluginLifecycleActionViewState {
  const key = pluginLifecycleActionKey(plugin, action);
  const disabledReason = pluginLifecycleActionDisabledReason(plugin, action);
  const busy = pluginActionIsBusy({ actionKey: key, actionLoadingKey });
  return {
    busy,
    disabled: actionLoadingKey !== null || disabledReason !== null,
    disabledReason,
    key,
    label: busy
      ? "Working..."
      : pluginLifecycleActionDisplayLabel(plugin, action),
    title: disabledReason ?? undefined,
  };
}

export function pluginLifecycleActionButtonState({
  action,
  actionLoadingKey,
  isAdmin,
  plugin,
}: {
  action: RpcPluginLifecycleAction;
  actionLoadingKey: string | null;
  isAdmin: boolean;
  plugin: RpcPluginInventoryPlugin;
}): PluginLifecycleActionButtonState {
  const viewState = pluginLifecycleActionViewState({
    action,
    actionLoadingKey,
    plugin,
  });
  return {
    ...viewState,
    disabled: !isAdmin || viewState.disabled,
  };
}
