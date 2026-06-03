/**
 * @file src/mainview/app/plugin-administration-panel.tsx
 * @description Plugin administration rendering modules composed by the settings panel.
 */

import {
  type ChangeEvent,
  type JSX,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";

import type {
  RpcModelOption,
  RpcPluginAccessGroupOption,
  RpcPluginAdminAction,
  RpcPluginAdminActionAvailability,
  RpcPluginIngressExternalBinding,
  RpcPluginIngressSourceDescriptor,
  RpcPluginInventory,
  RpcPluginInventoryGroupLabel,
  RpcPluginInventoryIssue,
  RpcPluginInventoryPlugin,
  RpcPluginLifecycleAction,
  RpcPluginManifestSettingSummary,
  RpcPluginSettingValueSummary,
  RpcPluginSidecarDiagnostics,
  RpcThreadPermissionDescriptor,
} from "../../bun/rpc-schema";
import { AppBadge } from "../controls/badge";
import { AppButton } from "../controls/button";
import { CodexModelSelector } from "../controls/codex-model-selector";
import { type AppIconName, materialSymbol } from "../controls/icons";
import { ModalDialogSurface } from "../controls/popover";
import { StatusIcon } from "../controls/status-icon";
import {
  ThreadAccessControl,
  type ThreadAccessValue,
} from "../controls/thread-access-control";
import { FolderPathSelectorControl } from "./folder-path-selector-control";
import { formatDirectoryPathForInput } from "./path-display-state";
import {
  allPluginsFromInventory,
  pluginDataUsageSummary,
  pluginHasSettings,
  pluginInventoryDisplayName,
  pluginInventoryIssueText,
  pluginInventoryStatusClassName,
  pluginInventoryStatusIconTone,
  pluginInventoryStatusLabel,
} from "./plugin-inventory-state";
import {
  pluginActionFeedbackState,
  pluginAdminActionKey,
  pluginIssuesExceptReviewHashChanged,
  pluginLifecycleActionButtonState,
} from "./plugin-lifecycle-action-state";
import {
  pluginSettingBooleanControlChecked,
  pluginSettingDeclarationForSummary,
  pluginSettingDescription,
  pluginSettingLabel,
  pluginSettingListControlValue,
  pluginSettingListItemKind,
  pluginSettingListItemPlaceholder,
  pluginSettingSecretClearPending,
  pluginSettingSecretReplacementPending,
  pluginSettingTextControlValue,
  pluginSettingTextInputPlaceholder,
  type PluginSettingFormValue,
  type PluginSettingFormValues,
  type PluginSettingsSnapshots,
} from "./plugin-settings-form-state";
import {
  defaultIngressRouteAccess,
  displayedIngressRouteFolderPath,
  pluginIngressBindingStatusText,
  pluginIngressBindingsForSource,
  pluginIngressIntervalSummary,
  pluginIngressLinkCodeExpiryText,
  pluginIngressLinkCodeKey,
  pluginIngressSourcesSummary,
  type PendingIngressRouteFolderCreate,
  type PluginIngressLinkCodeKey,
  type PluginIngressLinkCodes,
  type PluginIngressRouteDrafts,
} from "./plugin-ingress-route-state";

export function shouldLoadUserIngressSettings({
  active,
  open,
}: {
  active?: boolean;
  open: boolean;
}): boolean {
  return Boolean(active) && open;
}
function displayValue(value: string | null): string {
  return value?.trim() ? value : "Not declared";
}

function formatPluginTimestamp(value: string | null): string {
  if (!value) {
    return "Not recorded";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function pluginPermissionReviewText(permission: string): string {
  switch (permission) {
    case "plugin:request-ingress":
      return "plugin:request-ingress (offers a Metidos-owned external request ingress source; does not expose a thread tool or grant direct thread access)";
    case "plugin:reply-to-source":
      return "plugin:reply-to-source (replies only through verified ingress source metadata; does not grant general network, notification, or cross-source send access)";
    default:
      return permission;
  }
}

function pluginPermissionsSummary(plugin: RpcPluginInventoryPlugin): string {
  return plugin.manifest.permissions.length > 0
    ? plugin.manifest.permissions.map(pluginPermissionReviewText).join(", ")
    : "No host permissions declared";
}

function pluginNetworkPatternHostname(pattern: string): string | null {
  try {
    const normalizedPattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u.test(pattern)
      ? pattern
      : pattern.startsWith("//")
        ? `https:${pattern}`
        : `https://${pattern}`;
    return new URL(normalizedPattern).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function pluginDeclaresAllDomainNetwork(
  plugin: RpcPluginInventoryPlugin,
): boolean {
  const patterns = [
    ...(plugin.manifest.network?.allow ?? []),
    ...(plugin.manifest.network?.webSocketAllow ?? []),
  ];
  return patterns.some((pattern) => {
    const hostname = pluginNetworkPatternHostname(pattern);
    return hostname === "*" || hostname === "**";
  });
}

function pluginDeclaresLocalOrPrivateNetwork(
  plugin: RpcPluginInventoryPlugin,
): boolean {
  const patterns = [
    ...(plugin.manifest.network?.allow ?? []),
    ...(plugin.manifest.network?.webSocketAllow ?? []),
  ];
  return patterns.some((pattern) => {
    try {
      const hostname = pluginNetworkPatternHostname(pattern);
      if (!hostname) return false;
      return (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname === "127.0.0.1" ||
        hostname.startsWith("127.") ||
        hostname === "::1" ||
        hostname === "[::1]" ||
        hostname.startsWith("10.") ||
        hostname.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./u.test(hostname)
      );
    } catch {
      return false;
    }
  });
}

function pluginAccessGroupsSummary(plugin: RpcPluginInventoryPlugin): string {
  const names = plugin.manifest.access.map((group) =>
    displayValue(group.name ?? group.id),
  );
  return names.length > 0 ? names.join(", ") : "No access groups declared";
}

function pluginDiagnosticsForSelection(
  diagnostics: readonly RpcPluginSidecarDiagnostics[],
  plugin: RpcPluginInventoryPlugin,
): RpcPluginSidecarDiagnostics | null {
  return (
    diagnostics.find(
      (record) => record.directoryName === plugin.directoryName,
    ) ??
    diagnostics.find(
      (record) =>
        plugin.pluginId !== null && record.pluginId === plugin.pluginId,
    ) ??
    null
  );
}

type PluginDetailListItem = {
  content: ReactNode;
  key: string;
};

function pluginInventoryIssueListItem(
  issue: RpcPluginInventoryIssue,
  index: number,
): PluginDetailListItem {
  return {
    content: pluginInventoryIssueText(issue),
    key: [
      issue.path,
      issue.fileName ?? "",
      issue.code,
      issue.message,
      index,
    ].join("\u0000"),
  };
}

function pluginDiagnosticsFailureItems(
  diagnostics: RpcPluginSidecarDiagnostics | null,
): PluginDetailListItem[] {
  return (
    diagnostics?.failures.items.slice(-5).map((failure, index) => {
      const content = `${failure.observedAt} · ${failure.operation} · ${failure.code}: ${failure.message}`;
      return {
        content,
        key: [
          failure.observedAt,
          failure.operation,
          failure.code,
          failure.message,
          index,
        ].join("\u0000"),
      };
    }) ?? []
  );
}

function PluginDetailList({
  emptyText = "Not declared",
  items,
}: {
  emptyText?: string;
  items: PluginDetailListItem[];
}): JSX.Element {
  if (items.length === 0) {
    return <span className="text-text-muted">{emptyText}</span>;
  }
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li className="min-w-0 break-words" key={item.key}>
          {item.content}
        </li>
      ))}
    </ul>
  );
}

const SECRET_INPUT_ALLOWED_INPUT_TYPES = new Set([
  "deleteByCut",
  "deleteContentBackward",
  "deleteContentForward",
  "deleteContent",
  "historyRedo",
  "historyUndo",
  "insertCompositionText",
  "insertFromPaste",
  "insertText",
]);

function isAllowedSecretInputChange(
  event: ChangeEvent<HTMLInputElement>,
): boolean {
  const inputType = (event.nativeEvent as InputEvent).inputType;
  return (
    typeof inputType === "string" &&
    SECRET_INPUT_ALLOWED_INPUT_TYPES.has(inputType)
  );
}

export function pluginSettingListItemKeys(
  declarationKey: string | null,
  listValue: string[],
): string[] {
  const occurrences = new Map<string, number>();
  return listValue.map((item) => {
    const occurrence = occurrences.get(item) ?? 0;
    occurrences.set(item, occurrence + 1);
    return `${declarationKey ?? ""}:${item}:${occurrence}`;
  });
}

function PluginSettingControl({
  declaration,
  onChange,
  summary,
  value,
}: {
  declaration: RpcPluginManifestSettingSummary;
  onChange: (value: PluginSettingFormValue) => void;
  summary: RpcPluginSettingValueSummary;
  value: PluginSettingFormValue | undefined;
}): JSX.Element {
  const controlId = useId();
  const label = pluginSettingLabel(declaration);
  const description = pluginSettingDescription(declaration);
  const baseInputClassName =
    "h-8 w-full border border-border-default bg-surface-1 px-2 text-xs text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";
  const secretClearPending = pluginSettingSecretClearPending({
    declaration,
    summary,
    value,
  });
  const secretReplacementPending = pluginSettingSecretReplacementPending({
    declaration,
    value,
  });
  const secretBadgeLabel = secretClearPending
    ? "Clear pending"
    : secretReplacementPending
      ? summary.hasStoredValue
        ? "Replace pending"
        : "Save pending"
      : summary.secret && summary.hasStoredValue
        ? "Configured"
        : null;

  if (declaration.kind === "boolean") {
    return (
      <label className="grid gap-1 border-t border-border-subtle py-2 first:border-t-0">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text-primary">
          <input
            aria-label={label}
            checked={pluginSettingBooleanControlChecked(value)}
            className="h-4 w-4 accent-accent"
            name={`plugin-setting-${declaration.key}`}
            onChange={(event) => {
              onChange(event.currentTarget.checked);
            }}
            type="checkbox"
          />
          <span className="shrink-0">{label}</span>
          {description ? (
            <span className="min-w-0 truncate text-[11px] font-normal text-text-muted">
              - {description}
            </span>
          ) : null}
        </span>
      </label>
    );
  }

  if (declaration.kind === "list") {
    const listValue = pluginSettingListControlValue(value);
    const itemKind = pluginSettingListItemKind(declaration);
    const inputType =
      itemKind === "email" || itemKind === "number" || itemKind === "url"
        ? itemKind
        : "text";
    const listItemKeys = pluginSettingListItemKeys(declaration.key, listValue);
    return (
      <div className="grid gap-1 border-t border-border-subtle py-2 first:border-t-0">
        <div className="flex min-w-0 items-center gap-2">
          <div className="shrink-0 text-sm font-semibold text-text-primary">
            {label}
          </div>
          {description ? (
            <div className="min-w-0 flex-1 truncate text-[11px] text-text-muted">
              - {description}
            </div>
          ) : (
            <div className="min-w-0 flex-1" />
          )}
          <AppButton
            buttonStyle="muted"
            onClick={() => {
              onChange([...listValue, ""]);
            }}
          >
            {materialSymbol("plus", "text-[15px]")}
            Add Item
          </AppButton>
        </div>
        <div className="grid gap-1">
          {listValue.map((item, index) => (
            <div
              className="flex items-center gap-2"
              key={listItemKeys[index] ?? `${declaration.key}:${index}`}
            >
              <input
                aria-label={`${label} item ${index + 1}`}
                className={`${baseInputClassName} min-w-0 flex-1 font-mono`}
                inputMode={itemKind === "number" ? "decimal" : undefined}
                name={`plugin-setting-${declaration.key}-${index}`}
                onChange={(event) => {
                  const nextValue = [...listValue];
                  nextValue[index] = event.currentTarget.value;
                  onChange(nextValue);
                }}
                placeholder={pluginSettingListItemPlaceholder(itemKind)}
                type={inputType}
                value={item}
              />
              <AppButton
                aria-label={`Remove ${label} item ${index + 1}`}
                buttonStyle="muted"
                iconOnly
                onClick={() => {
                  onChange(
                    listValue.filter((_, itemIndex) => itemIndex !== index),
                  );
                }}
              >
                {materialSymbol("close", "text-[15px]")}
              </AppButton>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-1 border-t border-border-subtle py-2 first:border-t-0">
      <label className="flex min-w-0 items-baseline gap-2" htmlFor={controlId}>
        <span className="shrink-0 text-sm font-semibold text-text-primary">
          {label}
        </span>
        {description ? (
          <span className="min-w-0 truncate text-[11px] text-text-muted">
            - {description}
          </span>
        ) : null}
        {secretBadgeLabel ? (
          <AppBadge
            tone={
              secretClearPending || secretReplacementPending
                ? "warning"
                : "success"
            }
          >
            {secretBadgeLabel}
          </AppBadge>
        ) : null}
      </label>
      {declaration.kind === "enum" && declaration.options.length > 0 ? (
        <select
          className={baseInputClassName}
          id={controlId}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
          value={pluginSettingTextControlValue(value)}
        >
          {declaration.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <div className="relative">
          <input
            autoCapitalize="none"
            autoComplete={
              declaration.kind === "secret" ? "new-password" : "off"
            }
            autoCorrect="off"
            className={`${baseInputClassName} ${
              declaration.kind === "number" || declaration.kind === "date"
                ? "font-mono"
                : ""
            } ${declaration.kind === "secret" && summary.hasStoredValue ? "pr-10" : ""}`}
            data-1p-ignore={declaration.kind === "secret" ? "true" : undefined}
            data-bwignore={declaration.kind === "secret" ? "true" : undefined}
            data-form-type={declaration.kind === "secret" ? "other" : undefined}
            data-lpignore={declaration.kind === "secret" ? "true" : undefined}
            id={controlId}
            name={
              declaration.kind === "secret"
                ? `plugin-secret-${controlId}`
                : `plugin-setting-${declaration.key}`
            }
            onChange={(event) => {
              if (
                declaration.kind === "secret" &&
                !isAllowedSecretInputChange(event)
              ) {
                event.currentTarget.value =
                  pluginSettingTextControlValue(value);
                return;
              }
              onChange(event.currentTarget.value);
            }}
            placeholder={pluginSettingTextInputPlaceholder({
              secretClearPending,
              summary,
            })}
            spellCheck={false}
            type={
              declaration.kind === "date"
                ? "date"
                : declaration.kind === "number"
                  ? "number"
                  : declaration.kind === "secret"
                    ? "password"
                    : "text"
            }
            value={pluginSettingTextControlValue(value)}
          />
          {declaration.kind === "secret" && summary.hasStoredValue ? (
            <AppButton
              unstyled
              aria-label={`Clear stored ${label}`}
              className="absolute right-0 top-0 inline-flex h-8 w-8 items-center justify-center border-l border-border-default bg-surface-1 text-xl font-semibold leading-none text-text-primary transition-colors hover:bg-surface-2 hover:text-white focus-visible:border-focus-ring focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-[-1px]"
              onClick={() => {
                onChange(null);
              }}
              title={`Clear stored ${label}`}
              type="button"
            >
              ×
            </AppButton>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function PluginSettingsGroup({
  errors = {},
  header = true,
  onValueChange,
  plugin,
  snapshots,
  values,
}: {
  errors?: Record<string, string>;
  header?: boolean;
  onValueChange: (
    directoryName: string,
    key: string,
    value: PluginSettingFormValue,
  ) => void;
  plugin: RpcPluginInventoryPlugin;
  snapshots: PluginSettingsSnapshots;
  values: PluginSettingFormValues;
}): JSX.Element {
  const snapshot = snapshots[plugin.directoryName];
  const error = errors[plugin.directoryName] ?? "";
  const displayName = pluginInventoryDisplayName(plugin);
  const renderSettings = (
    summaries: RpcPluginSettingValueSummary[],
  ): JSX.Element | null => {
    const controls = summaries.flatMap((summary) => {
      const declaration = pluginSettingDeclarationForSummary(plugin, summary);
      if (!declaration?.key) {
        return [];
      }
      const settingKey = declaration.key;
      return [
        <PluginSettingControl
          declaration={declaration}
          key={settingKey}
          onChange={(nextValue) => {
            onValueChange(plugin.directoryName, settingKey, nextValue);
          }}
          summary={summary}
          value={values[plugin.directoryName]?.[settingKey]}
        />,
      ];
    });
    if (controls.length === 0) {
      return null;
    }
    return <div className="mt-2">{controls}</div>;
  };
  const renderedSettings = snapshot ? renderSettings(snapshot.settings) : null;

  return (
    <section className="border-t border-border-subtle py-3 first:border-t-0">
      {header ? (
        <div className="flex min-w-0 items-baseline gap-2">
          <div className="shrink-0 text-sm font-semibold text-text-primary">
            {displayName}
          </div>
          {plugin.description ? (
            <div className="min-w-0 truncate text-xs text-text-muted">
              - {plugin.description}
            </div>
          ) : null}
        </div>
      ) : null}
      {snapshot ? (
        renderedSettings ? (
          renderedSettings
        ) : (
          <div className="mt-2 border border-border-subtle bg-surface-2 px-3 py-2 text-xs text-text-muted">
            No plugin settings are declared.
          </div>
        )
      ) : error ? (
        <div className="mt-2 border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-text">
          {error}
        </div>
      ) : (
        <div className="mt-2 border border-border-subtle bg-surface-2 px-3 py-2 text-xs text-text-muted">
          Loading plugin settings...
        </div>
      )}
    </section>
  );
}

function pluginAdminActionButtonStyle(
  action: RpcPluginAdminActionAvailability,
): "error" | "muted" | "secondary" {
  if (action.destructive) {
    return "error";
  }
  return action.available ? "secondary" : "muted";
}

function PluginStatusBadge({
  group,
}: {
  group: RpcPluginInventoryGroupLabel;
}): JSX.Element {
  return (
    <span
      className={`inline-flex h-6 items-center gap-2 border px-2 text-xs font-semibold ${pluginInventoryStatusClassName(
        group,
      )}`}
    >
      <StatusIcon size="sm" tone={pluginInventoryStatusIconTone(group)} />
      {pluginInventoryStatusLabel(group)}
    </span>
  );
}

type PluginNoticeTone = "danger" | "info" | "success" | "warning";

function pluginNoticeClassName(tone: PluginNoticeTone): string {
  switch (tone) {
    case "danger":
      return "border-danger-border bg-danger-surface text-danger-text";
    case "info":
      return "border-accent bg-accent-surface text-accent";
    case "success":
      return "border-success-border bg-success-surface text-success-text";
    case "warning":
      return "border-warning-border bg-warning-surface text-warning-text";
  }
}

function pluginNoticeIcon(tone: PluginNoticeTone): AppIconName {
  switch (tone) {
    case "success":
      return "check_circle";
    case "danger":
    case "warning":
      return "warning";
    case "info":
      return "radio_button_unchecked";
  }
}

function PluginNotice({
  children,
  title,
  tone,
}: {
  children?: ReactNode;
  title: string;
  tone: PluginNoticeTone;
}): JSX.Element {
  return (
    <div
      className={`mt-3 flex items-start gap-3 border px-3 py-2 text-xs leading-5 ${pluginNoticeClassName(
        tone,
      )}`}
    >
      {materialSymbol(pluginNoticeIcon(tone), "mt-1 text-[17px]")}
      <div className="min-w-0">
        <div className="font-semibold text-current">{title}</div>
        {children ? <div className="text-current/90">{children}</div> : null}
      </div>
    </div>
  );
}

function PluginManagerSummaryRow({
  action,
  iconName,
  label,
  value,
}: {
  action?: ReactNode;
  iconName: AppIconName;
  label: string;
  value: ReactNode;
}): JSX.Element {
  return (
    <div className="grid min-h-11 grid-cols-1 gap-2 border-t border-border-subtle px-3 py-2 first:border-t-0 sm:grid-cols-[9.5rem_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
      <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-text-secondary">
        {materialSymbol(iconName, "text-[15px] text-text-muted")}
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div className="min-w-0 truncate text-xs leading-5 text-text-muted">
        {value}
      </div>
      {action ? <div className="flex justify-end">{action}</div> : null}
    </div>
  );
}

function PluginManagerSection({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}): JSX.Element {
  return (
    <section className="mt-3 border border-border-subtle">
      {title ? (
        <div className="border-b border-border-subtle bg-surface-2 px-3 py-2 font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-text-faint">
          {title}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function pluginValidationSummary(plugin: RpcPluginInventoryPlugin): string {
  if (plugin.validationErrors.length > 0) {
    return `${plugin.validationErrors.length.toLocaleString()} validation issue${
      plugin.validationErrors.length === 1 ? "" : "s"
    } found`;
  }
  if (plugin.reviewWarnings.length > 0) {
    return `${plugin.reviewWarnings.length.toLocaleString()} review warning${
      plugin.reviewWarnings.length === 1 ? "" : "s"
    }`;
  }
  return "No validation issues";
}

function pluginSettingsSummary(plugin: RpcPluginInventoryPlugin): string {
  const settings = plugin.manifest.settings.filter((setting) =>
    Boolean(setting.key),
  );
  if (settings.length === 0) {
    return "No settings declared";
  }
  return settings
    .slice(0, 3)
    .map((setting) => displayValue(setting.label ?? setting.key))
    .join(" · ");
}

function pluginApprovedHashSummary(plugin: RpcPluginInventoryPlugin): string {
  if (!plugin.approvedReviewHash) {
    return "No approval recorded";
  }
  const details = [
    plugin.approvedReviewHash.slice(0, 8),
    plugin.lifecycle.approvedBy
      ? `approved by ${plugin.lifecycle.approvedBy}`
      : null,
    plugin.lifecycle.approvedAt
      ? formatPluginTimestamp(plugin.lifecycle.approvedAt)
      : null,
  ].filter((item): item is string => Boolean(item));
  return details.join(" · ");
}

function pluginCurrentHashSummary(plugin: RpcPluginInventoryPlugin): string {
  if (!plugin.currentReviewHash) {
    return "No review hash recorded";
  }
  return plugin.currentReviewHash.slice(0, 8);
}

function PluginValidationValue({
  plugin,
}: {
  plugin: RpcPluginInventoryPlugin;
}): JSX.Element {
  const hasIssues = plugin.validationErrors.length > 0;
  const hasWarnings = plugin.reviewWarnings.length > 0;
  const toneClassName = hasIssues
    ? "text-danger-text"
    : hasWarnings
      ? "text-warning-text"
      : "text-success-text";
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${toneClassName}`}>
      {materialSymbol(
        hasIssues || hasWarnings ? "warning" : "check_circle",
        "text-[14px]",
      )}
      <span className="truncate">{pluginValidationSummary(plugin)}</span>
    </span>
  );
}

function PluginDiagnosticsBlock({
  diagnostics,
}: {
  diagnostics: RpcPluginSidecarDiagnostics | null;
}): JSX.Element | null {
  const stderrLines = diagnostics?.stderr.lines.slice(-8) ?? [];
  const failureItems = pluginDiagnosticsFailureItems(diagnostics);
  if (stderrLines.length === 0 && failureItems.length === 0) {
    return null;
  }
  return (
    <PluginManagerSection title="Diagnostics">
      {stderrLines.length > 0 ? (
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap border-b border-border-subtle bg-bg-app px-3 py-2 font-mono text-[11px] leading-5 text-text-secondary">
          {stderrLines
            .map((line) => `${line.observedAt}  ${line.line}`)
            .join("\n")}
        </pre>
      ) : null}
      {failureItems.length > 0 ? (
        <div className="px-3 py-2 text-xs leading-5 text-text-secondary">
          <PluginDetailList items={failureItems} />
        </div>
      ) : null}
    </PluginManagerSection>
  );
}

function PluginAdminActionsSection({
  actionLoadingKey,
  onAdminAction,
  plugin,
}: {
  actionLoadingKey: string | null;
  onAdminAction: (action: RpcPluginAdminActionAvailability) => void;
  plugin: RpcPluginInventoryPlugin;
}): JSX.Element | null {
  const footerActions = plugin.adminActions.filter(
    (action) => action.action === "reset_data" || action.action === "run_gc",
  );
  if (footerActions.length === 0 || plugin.status !== "active") {
    return null;
  }
  return (
    <PluginManagerSection title="Data Actions">
      <div className="px-3 py-2">
        <div className="mb-2 text-xs leading-5 text-text-muted">
          {pluginDataUsageSummary(plugin)}
        </div>
        <div className="flex flex-wrap gap-2">
          {footerActions.map((action) => {
            const actionKey = pluginAdminActionKey(plugin, action.action);
            const busy = actionLoadingKey === actionKey;
            return (
              <AppButton
                buttonStyle={pluginAdminActionButtonStyle(action)}
                disabled={!action.available || busy}
                key={action.action}
                onClick={() => {
                  onAdminAction(action);
                }}
                title={action.reason ?? action.path ?? undefined}
              >
                {action.action === "reset_data"
                  ? materialSymbol("delete", "text-[15px]")
                  : null}
                {action.action === "run_gc"
                  ? materialSymbol("history", "text-[15px]")
                  : null}
                {busy ? "Working..." : action.label}
              </AppButton>
            );
          })}
        </div>
      </div>
    </PluginManagerSection>
  );
}

function PluginReviewSummaryRows({
  includeApproved = false,
  plugin,
}: {
  includeApproved?: boolean;
  plugin: RpcPluginInventoryPlugin;
}): JSX.Element {
  return (
    <PluginManagerSection title="Review Summary">
      <PluginManagerSummaryRow
        iconName="account_circle"
        label="Name"
        value={pluginInventoryDisplayName(plugin)}
      />
      {includeApproved ? (
        <PluginManagerSummaryRow
          iconName="shield"
          label="Approved Hash"
          value={pluginApprovedHashSummary(plugin)}
        />
      ) : null}
      <PluginManagerSummaryRow
        iconName="history"
        label={includeApproved ? "Current Hash" : "Review Hash"}
        value={pluginCurrentHashSummary(plugin)}
      />
      <PluginManagerSummaryRow
        iconName="warning"
        label="Validation"
        value={<PluginValidationValue plugin={plugin} />}
      />
      <PluginManagerSummaryRow
        iconName="bolt"
        label="Permissions"
        value={pluginPermissionsSummary(plugin)}
      />
      <PluginManagerSummaryRow
        iconName="person"
        label="Access Groups"
        value={pluginAccessGroupsSummary(plugin)}
      />
      <PluginManagerSummaryRow
        iconName="settings"
        label="Settings"
        value={pluginSettingsSummary(plugin)}
      />
      <PluginManagerSummaryRow
        iconName="web_server"
        label="Ingress Sources"
        value={pluginIngressSourcesSummary(plugin)}
      />
    </PluginManagerSection>
  );
}

function PluginIngressSourcesSection({
  actionLoadingKey,
  bindings,
  linkCodes,
  onCreateLinkCode,
  onDeleteBinding,
  onSetBindingEnabled,
  plugin,
}: {
  actionLoadingKey: string | null;
  bindings: readonly RpcPluginIngressExternalBinding[];
  linkCodes: PluginIngressLinkCodes;
  onCreateLinkCode: (pluginId: string, sourceId: string) => void;
  onDeleteBinding: (binding: RpcPluginIngressExternalBinding) => void;
  onSetBindingEnabled: (
    binding: RpcPluginIngressExternalBinding,
    enabled: boolean,
  ) => void;
  plugin: RpcPluginInventoryPlugin;
}): JSX.Element | null {
  const sources = plugin.manifest.ingressSources ?? [];
  if (sources.length === 0) {
    return null;
  }
  return (
    <PluginManagerSection title="Ingress Sources">
      <div className="border-b border-border-subtle px-3 py-2 text-xs leading-5 text-text-secondary last:border-b-0">
        Registered sources are shown from the approved manifest. Generate a
        short-lived Link Code, send it through the external direct chat, then
        manage the verified bindings that appear here. Codes are one-time use
        and are not written to logs.
      </div>
      {sources.map((source) => {
        const sourceId = displayValue(source.id);
        const sourceName = displayValue(source.name ?? source.id);
        const sourceKey = [
          source.id ?? "unknown",
          source.name ?? "unnamed",
          source.pollIntervalMs ?? "unpolled",
        ].join(":");
        const sourceBindings = pluginIngressBindingsForSource(
          bindings,
          plugin.pluginId,
          source.id,
        );
        const sourceCode =
          plugin.pluginId && source.id
            ? linkCodes[pluginIngressLinkCodeKey(plugin.pluginId, source.id)]
            : undefined;
        const createActionKey =
          plugin.pluginId && source.id
            ? `ingress-link:${plugin.pluginId}:${source.id}`
            : null;
        return (
          <div
            className="border-b border-border-subtle px-3 py-2 text-xs leading-5 last:border-b-0"
            key={sourceKey}
          >
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_7rem] sm:items-start">
              <div className="min-w-0">
                <div className="truncate font-semibold text-text-secondary">
                  {sourceName}
                </div>
                <div className="truncate font-mono text-[11px] text-text-muted">
                  {sourceId}
                </div>
                {source.description ? (
                  <div className="mt-1 text-text-muted">
                    {source.description}
                  </div>
                ) : null}
              </div>
              <div className="min-w-0 text-text-muted">
                <div className="font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-text-faint">
                  Poll Interval
                </div>
                <div>{pluginIngressIntervalSummary(source.pollIntervalMs)}</div>
              </div>
              <div className="min-w-0 text-text-muted">
                <div className="font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-text-faint">
                  Replies
                </div>
                <div>
                  {source.supportsReplyToSource ? "Supported" : "Not declared"}
                </div>
              </div>
            </div>
            <div className="mt-2 border-t border-border-subtle pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <AppButton
                  buttonStyle="secondary"
                  disabled={
                    !plugin.pluginId ||
                    !source.id ||
                    actionLoadingKey === createActionKey
                  }
                  onClick={() => {
                    if (plugin.pluginId && source.id) {
                      onCreateLinkCode(plugin.pluginId, source.id);
                    }
                  }}
                >
                  {actionLoadingKey === createActionKey
                    ? "Generating..."
                    : "Generate Link Code"}
                </AppButton>
                {sourceCode ? (
                  <span className="font-mono text-sm font-semibold text-text-primary">
                    {sourceCode.code}
                  </span>
                ) : null}
                {sourceCode ? (
                  <span className="text-[11px] text-text-muted">
                    {pluginIngressLinkCodeExpiryText(sourceCode)}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-[11px] text-text-muted">
                Send the code from the external direct chat for this source. It
                expires after a short window and can be used once.
              </div>
              <div className="mt-2 border-t border-border-subtle">
                {sourceBindings.length === 0 ? (
                  <div className="py-2 text-[11px] text-text-muted">
                    No verified external bindings for this source.
                  </div>
                ) : (
                  sourceBindings.map((binding) => {
                    const mutationKey = `ingress-binding:${binding.id}`;
                    return (
                      <div
                        className="flex flex-wrap items-center gap-2 border-b border-border-subtle py-2 last:border-b-0"
                        key={binding.id}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[11px] text-text-secondary">
                            {binding.externalUserId}
                          </div>
                          <div className="text-[11px] text-text-muted">
                            {pluginIngressBindingStatusText(binding)} · updated{" "}
                            {formatPluginTimestamp(binding.updatedAt)}
                          </div>
                        </div>
                        <AppButton
                          buttonStyle="muted"
                          disabled={actionLoadingKey === mutationKey}
                          onClick={() => {
                            onSetBindingEnabled(binding, !binding.enabled);
                          }}
                        >
                          {binding.enabled ? "Disable" : "Enable"}
                        </AppButton>
                        <AppButton
                          buttonStyle="error"
                          disabled={actionLoadingKey === mutationKey}
                          onClick={() => {
                            onDeleteBinding(binding);
                          }}
                        >
                          Remove
                        </AppButton>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      })}
    </PluginManagerSection>
  );
}

export type UserIngressSourcesSectionProps = {
  actionError: string;
  actionLoadingKey: string | null;
  availablePluginAccessGroups: readonly RpcPluginAccessGroupOption[];
  availableThreadPermissionDescriptors: readonly RpcThreadPermissionDescriptor[];
  bindings: readonly RpcPluginIngressExternalBinding[];
  codexModels: readonly RpcModelOption[];
  homeDirectory: string;
  linkCodes: PluginIngressLinkCodes;
  loading: boolean;
  onCancelRouteFolderCreate: () => void;
  onConfirmRouteFolderCreate: () => void;
  onCreateLinkCode: (pluginId: string, sourceId: string) => void;
  onDeleteBinding: (binding: RpcPluginIngressExternalBinding) => void;
  onRefresh: () => void;
  onRouteAccessChange: (
    pluginId: string,
    sourceId: string,
    access: ThreadAccessValue,
  ) => void;
  onRouteModelChange: (
    pluginId: string,
    sourceId: string,
    model: string,
  ) => void;
  onRoutePathChange: (
    pluginId: string,
    sourceId: string,
    value: string,
  ) => void;
  onSaveRouteConfig: (pluginId: string, sourceId: string) => void;
  onSelectRouteDirectory: (
    pluginId: string,
    sourceId: string,
    directory: string,
  ) => void;
  onSetBindingEnabled: (
    binding: RpcPluginIngressExternalBinding,
    enabled: boolean,
  ) => void;
  routeDirectorySuggestions: readonly string[];
  routeDirectorySuggestionsKey: PluginIngressLinkCodeKey | null;
  routeDirectorySuggestionsLoading: boolean;
  routeCreateFolderPrompt: PendingIngressRouteFolderCreate | null;
  routeDrafts: PluginIngressRouteDrafts;
  routeHoveredDirectorySuggestion: string | null;
  setRouteHoveredDirectorySuggestion: (directory: string | null) => void;
  sources: readonly RpcPluginIngressSourceDescriptor[];
  supportsTildePath: boolean;
};

export function UserIngressSourcesSection({
  actionError,
  actionLoadingKey,
  availablePluginAccessGroups,
  availableThreadPermissionDescriptors,
  bindings,
  codexModels,
  homeDirectory,
  linkCodes,
  loading,
  onCancelRouteFolderCreate,
  onConfirmRouteFolderCreate,
  onCreateLinkCode,
  onDeleteBinding,
  onRefresh,
  onRouteAccessChange,
  onRouteModelChange,
  onRoutePathChange,
  onSaveRouteConfig,
  onSelectRouteDirectory,
  onSetBindingEnabled,
  routeDirectorySuggestions,
  routeDirectorySuggestionsKey,
  routeDirectorySuggestionsLoading,
  routeCreateFolderPrompt,
  routeDrafts,
  routeHoveredDirectorySuggestion,
  setRouteHoveredDirectorySuggestion,
  sources,
  supportsTildePath,
}: UserIngressSourcesSectionProps): JSX.Element {
  return (
    <section className="border-t border-border-subtle pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">
            Ingress Settings
          </div>
        </div>
        <AppButton buttonStyle="muted" disabled={loading} onClick={onRefresh}>
          {loading ? "Refreshing…" : "Refresh"}
        </AppButton>
      </div>

      {actionError ? (
        <div className="mt-3 border border-danger-border bg-danger-surface px-3 py-2 text-xs leading-5 text-danger-text">
          {actionError}
        </div>
      ) : null}

      {sources.length === 0 ? (
        <div className="mt-3 border border-border-subtle bg-surface-2 px-3 py-2 text-xs text-text-muted">
          No active ingress sources are available.
        </div>
      ) : (
        <div className="mt-3 border border-border-subtle">
          {sources.map((entry) => {
            const source = entry.source;
            const sourceId = source.id ?? "";
            const sourceKey = `${entry.pluginId}:${sourceId}`;
            const sourceCode = sourceId
              ? linkCodes[pluginIngressLinkCodeKey(entry.pluginId, sourceId)]
              : undefined;
            const createActionKey = sourceId
              ? `ingress-link:${entry.pluginId}:${sourceId}`
              : null;
            const sourceBindings = sourceId
              ? pluginIngressBindingsForSource(
                  bindings,
                  entry.pluginId,
                  sourceId,
                )
              : [];
            const routeKey = sourceId
              ? pluginIngressLinkCodeKey(entry.pluginId, sourceId)
              : null;
            const routeDraft = routeKey ? routeDrafts[routeKey] : undefined;
            const routeHoveredDirectory =
              routeKey && routeDirectorySuggestionsKey === routeKey
                ? routeHoveredDirectorySuggestion
                : null;
            const displayedRouteFolderPath = displayedIngressRouteFolderPath({
              homeDirectory,
              hoveredDirectorySuggestion: routeHoveredDirectory,
              supportsTildePath,
              worktreePath: routeDraft?.worktreePath ?? "",
            });
            const routeActionKey = sourceId
              ? `ingress-route:${entry.pluginId}:${sourceId}`
              : null;
            return (
              <div
                className="border-b border-border-subtle px-3 py-2 text-xs leading-5 last:border-b-0"
                key={sourceKey}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 text-sm font-semibold text-text-secondary">
                    {displayValue(source.name ?? entry.pluginName ?? sourceId)}
                    {source.description ? (
                      <span className="ml-2 text-xs font-normal text-text-muted">
                        - {source.description}
                      </span>
                    ) : null}
                  </div>
                  <AppButton
                    buttonStyle="secondary"
                    disabled={!sourceId || actionLoadingKey === createActionKey}
                    onClick={() => {
                      if (sourceId) onCreateLinkCode(entry.pluginId, sourceId);
                    }}
                  >
                    {actionLoadingKey === createActionKey
                      ? "Generating…"
                      : "Generate Link Code"}
                  </AppButton>
                </div>
                {sourceCode ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-text-primary">
                      {sourceCode.code}
                    </span>
                    <span className="text-xs text-text-muted">
                      {pluginIngressLinkCodeExpiryText(sourceCode)}
                    </span>
                  </div>
                ) : null}
                {sourceId && routeKey ? (
                  <div className="mt-3 border-t border-border-subtle pt-3">
                    <div className="mb-2 uppercase-label-sm text-accent">
                      Context
                    </div>
                    <FolderPathSelectorControl
                      addProjectError=""
                      addProjectInputIsPreviewing={Boolean(
                        routeHoveredDirectory,
                      )}
                      addProjectPath={routeDraft?.worktreePath ?? ""}
                      createFolderPromptPath={
                        routeCreateFolderPrompt?.pluginId === entry.pluginId &&
                        routeCreateFolderPrompt.sourceId === sourceId
                          ? routeCreateFolderPrompt.draft.worktreePath
                          : null
                      }
                      directorySuggestions={
                        routeDirectorySuggestionsKey === routeKey
                          ? [...routeDirectorySuggestions]
                          : []
                      }
                      directorySuggestionsLoading={
                        routeDirectorySuggestionsKey === routeKey &&
                        routeDirectorySuggestionsLoading
                      }
                      displayedAddProjectPath={displayedRouteFolderPath}
                      helpText=""
                      homeDirectory={homeDirectory}
                      hoveredDirectorySuggestion={routeHoveredDirectory}
                      inputName={`ingress-route-${entry.pluginId}-${sourceId}`}
                      isAddingProject={actionLoadingKey === routeActionKey}
                      label="Folder"
                      onAddProjectPathChange={(value) => {
                        onRoutePathChange(entry.pluginId, sourceId, value);
                      }}
                      onCancelCreateFolderPrompt={onCancelRouteFolderCreate}
                      onClose={() => {
                        onRoutePathChange(entry.pluginId, sourceId, "");
                      }}
                      onDirectorySuggestionEnter={
                        setRouteHoveredDirectorySuggestion
                      }
                      onDirectorySuggestionLeave={() => {
                        setRouteHoveredDirectorySuggestion(null);
                      }}
                      onSelectDirectorySuggestion={(directory) => {
                        onSelectRouteDirectory(
                          entry.pluginId,
                          sourceId,
                          formatDirectoryPathForInput(
                            directory,
                            homeDirectory,
                            supportsTildePath,
                          ),
                        );
                      }}
                      onConfirmCreateFolderPrompt={onConfirmRouteFolderCreate}
                      onSubmit={(event) => {
                        event.preventDefault();
                        onSaveRouteConfig(entry.pluginId, sourceId);
                      }}
                      cancelLabel="Clear"
                      submitLabel="Select"
                      submitLoadingLabel="Selecting"
                      supportsTildePath={supportsTildePath}
                    />
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <div className="min-w-64 flex-1">
                        <div className="mb-2 uppercase-label-sm text-accent">
                          Model
                        </div>
                        <CodexModelSelector
                          disabled={
                            actionLoadingKey === routeActionKey ||
                            codexModels.length === 0
                          }
                          models={[...codexModels]}
                          onChange={(model) => {
                            onRouteModelChange(entry.pluginId, sourceId, model);
                            return true;
                          }}
                          value={routeDraft?.model ?? codexModels[0]?.id ?? ""}
                          variant="desktop"
                        />
                      </div>
                      <div className="shrink-0">
                        <ThreadAccessControl
                          availablePluginAccessGroups={[
                            ...availablePluginAccessGroups,
                          ]}
                          availableThreadPermissionDescriptors={[
                            ...availableThreadPermissionDescriptors,
                          ]}
                          disabled={actionLoadingKey === routeActionKey}
                          onChange={(access) => {
                            onRouteAccessChange(
                              entry.pluginId,
                              sourceId,
                              access,
                            );
                          }}
                          showUnsafeMode={false}
                          title="Access"
                          value={
                            routeDraft?.access ?? defaultIngressRouteAccess()
                          }
                          variant="desktop"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
                {sourceBindings.length > 0 ? (
                  <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border-subtle pt-3">
                    {sourceBindings.map((binding) => {
                      const mutationKey = `ingress-binding:${binding.id}`;
                      return (
                        <div
                          className="flex items-center gap-2"
                          key={binding.id}
                        >
                          <AppButton
                            buttonStyle="muted"
                            disabled={actionLoadingKey === mutationKey}
                            onClick={() => {
                              onSetBindingEnabled(binding, !binding.enabled);
                            }}
                          >
                            {binding.enabled ? "Disable" : "Enable"}
                          </AppButton>
                          <AppButton
                            buttonStyle="error"
                            disabled={actionLoadingKey === mutationKey}
                            onClick={() => {
                              onDeleteBinding(binding);
                            }}
                          >
                            Remove
                          </AppButton>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function resolvePluginAdminActionConfirmation({
  action,
  plugin,
  promptForConfirmation = window.prompt,
}: {
  action: RpcPluginAdminActionAvailability;
  plugin: RpcPluginInventoryPlugin;
  promptForConfirmation?: (message: string) => string | null;
}): string | null | undefined {
  if (!action.destructive) {
    return undefined;
  }
  return promptForConfirmation(
    `Type ${plugin.directoryName} to confirm ${action.label}.`,
  );
}

function PluginManagerDialog({
  actionError,
  actionLoadingKey,
  actionMessage,
  diagnostics,
  ingressBindings,
  ingressLinkCodes,
  isAdmin,
  onAdminAction,
  onClose,
  onCreateIngressLinkCode,
  onDeleteIngressBinding,
  onLifecycleAction,
  onSetIngressBindingEnabled,
  onSettingValueChange,
  open,
  plugin,
  settingsErrors,
  settingsSnapshots,
  settingsValues,
}: {
  actionError: string;
  actionLoadingKey: string | null;
  actionMessage: string;
  diagnostics: RpcPluginSidecarDiagnostics | null;
  ingressBindings: readonly RpcPluginIngressExternalBinding[];
  ingressLinkCodes: PluginIngressLinkCodes;
  isAdmin: boolean;
  onAdminAction: (
    plugin: RpcPluginInventoryPlugin,
    action: RpcPluginAdminAction,
    confirmation?: string,
  ) => void;
  onClose: () => void;
  onCreateIngressLinkCode: (pluginId: string, sourceId: string) => void;
  onDeleteIngressBinding: (binding: RpcPluginIngressExternalBinding) => void;
  onLifecycleAction: (
    plugin: RpcPluginInventoryPlugin,
    action: RpcPluginLifecycleAction,
  ) => void;
  onSetIngressBindingEnabled: (
    binding: RpcPluginIngressExternalBinding,
    enabled: boolean,
  ) => void;
  onSettingValueChange: (
    directoryName: string,
    key: string,
    value: PluginSettingFormValue,
  ) => void;
  open: boolean;
  plugin: RpcPluginInventoryPlugin | null;
  settingsErrors: Record<string, string>;
  settingsSnapshots: PluginSettingsSnapshots;
  settingsValues: PluginSettingFormValues;
}): JSX.Element | null {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  if (!plugin) {
    return null;
  }

  const displayName = pluginInventoryDisplayName(plugin);
  const blockingErrors = pluginIssuesExceptReviewHashChanged(
    plugin.validationErrors,
  );
  const hasPluginSettings = pluginHasSettings(plugin);
  const hasBlockingErrors = blockingErrors.length > 0;
  const lifecycleActionState = (action: RpcPluginLifecycleAction) =>
    pluginLifecycleActionButtonState({
      action,
      actionLoadingKey,
      isAdmin,
      plugin,
    });
  const runAdminAction = (action: RpcPluginAdminActionAvailability): void => {
    const confirmation = resolvePluginAdminActionConfirmation({
      action,
      plugin,
    });
    if (confirmation === null) {
      return;
    }
    onAdminAction(plugin, action.action, confirmation);
  };
  const renderLifecycleAction = (
    action: RpcPluginLifecycleAction,
    buttonStyle: "error" | "muted" | "primary" | "secondary" = "secondary",
  ) => {
    const actionState = lifecycleActionState(action);
    return (
      <AppButton
        buttonStyle={buttonStyle}
        disabled={actionState.disabled}
        key={action}
        onClick={() => {
          onLifecycleAction(plugin, action);
        }}
        title={actionState.title}
      >
        {actionState.label}
      </AppButton>
    );
  };
  const settingsBlock = hasPluginSettings ? (
    <div className="mt-3 border border-border-subtle px-3">
      <PluginSettingsGroup
        errors={settingsErrors}
        header={false}
        onValueChange={onSettingValueChange}
        plugin={plugin}
        snapshots={settingsSnapshots}
        values={settingsValues}
      />
    </div>
  ) : null;
  const privateNetworkNotice = pluginDeclaresLocalOrPrivateNetwork(plugin) ? (
    <PluginNotice title="Private network allowlist declared" tone="warning">
      This plugin allowlists localhost or private LAN network targets. Safe
      runtime defaults still block those targets; access only works when the
      local operator starts Metidos with unsafe private-network mode and
      approves the plugin unsafe permission.
    </PluginNotice>
  ) : null;
  const allDomainNetworkNotice = pluginDeclaresAllDomainNetwork(plugin) ? (
    <PluginNotice title="All-domain network access declared" tone="warning">
      This plugin can request arbitrary public hosts covered by its URL pattern.
      All-domain network access requires the plugin unsafe permission and should
      be approved only when the plugin validates and distrusts fetched content.
    </PluginNotice>
  ) : null;
  const validationDetails =
    blockingErrors.length > 0 || plugin.reviewWarnings.length > 0 ? (
      <PluginManagerSection title="Validation Details">
        {blockingErrors.length > 0 ? (
          <div className="border-b border-border-subtle px-3 py-2 text-xs leading-5 text-danger-text last:border-b-0">
            <div className="font-semibold">Activation-blocking errors</div>
            <PluginDetailList
              items={blockingErrors.map(pluginInventoryIssueListItem)}
            />
          </div>
        ) : null}
        {plugin.reviewWarnings.length > 0 ? (
          <div className="px-3 py-2 text-xs leading-5 text-warning-text">
            <div className="font-semibold">Review warnings</div>
            <PluginDetailList
              items={plugin.reviewWarnings.map(pluginInventoryIssueListItem)}
            />
          </div>
        ) : null}
      </PluginManagerSection>
    ) : null;
  const lifecycleMessage = plugin.lifecycleMessage ? (
    <div className="mt-3 border border-border-subtle bg-surface-2 px-3 py-2 text-xs leading-5 text-text-secondary">
      {plugin.lifecycleMessage}
    </div>
  ) : null;
  const actionFeedbackState = pluginActionFeedbackState({
    error: actionError,
    message: actionMessage,
  });
  const actionFeedback = (
    <>
      {actionFeedbackState.hasMessage ? (
        <div className="mt-3 border border-success-border bg-success-surface px-3 py-2 text-xs leading-5 text-success-text">
          {actionFeedbackState.message}
        </div>
      ) : null}
      {actionFeedbackState.hasError ? (
        <div className="mt-3 border border-danger-border bg-danger-surface px-3 py-2 text-xs leading-5 text-danger-text">
          {actionFeedbackState.error}
        </div>
      ) : null}
    </>
  );
  const actionErrorFeedback = actionFeedbackState.hasError ? (
    <div className="mt-3 border border-danger-border bg-danger-surface px-3 py-2 text-xs leading-5 text-danger-text">
      {actionFeedbackState.error}
    </div>
  ) : null;
  const runtimeStateValue = (
    <span className="inline-flex min-w-0 items-center gap-2">
      <StatusIcon
        size="sm"
        tone={pluginInventoryStatusIconTone(plugin.group)}
      />
      <span className="min-w-0 truncate">
        {pluginInventoryStatusLabel(plugin.group)}
      </span>
    </span>
  );
  let body: ReactNode;
  switch (plugin.status) {
    case "uninitialized":
      body = (
        <>
          <PluginNotice title="Plugin folder discovered." tone="info">
            No approval has been recorded yet. Review the plugin details before
            activation.
          </PluginNotice>
          <PluginReviewSummaryRows plugin={plugin} />
          <PluginIngressSourcesSection
            actionLoadingKey={actionLoadingKey}
            bindings={ingressBindings}
            linkCodes={ingressLinkCodes}
            onCreateLinkCode={onCreateIngressLinkCode}
            onDeleteBinding={onDeleteIngressBinding}
            onSetBindingEnabled={onSetIngressBindingEnabled}
            plugin={plugin}
          />
          {privateNetworkNotice}
          {allDomainNetworkNotice}
          {validationDetails}
          {settingsBlock}
          {hasBlockingErrors ? (
            <PluginNotice title="Action needed" tone="warning">
              This plugin cannot be approved until validation issues are
              resolved.
            </PluginNotice>
          ) : null}
          {actionFeedback}
        </>
      );
      break;
    case "needs_review":
      body = (
        <>
          <PluginNotice
            title="Source or support files changed after approval"
            tone="warning"
          >
            Runtime loading is paused until you review and approve the current
            plugin files.
          </PluginNotice>
          <PluginReviewSummaryRows includeApproved plugin={plugin} />
          <PluginIngressSourcesSection
            actionLoadingKey={actionLoadingKey}
            bindings={ingressBindings}
            linkCodes={ingressLinkCodes}
            onCreateLinkCode={onCreateIngressLinkCode}
            onDeleteBinding={onDeleteIngressBinding}
            onSetBindingEnabled={onSetIngressBindingEnabled}
            plugin={plugin}
          />
          {privateNetworkNotice}
          {allDomainNetworkNotice}
          {validationDetails}
          {settingsBlock}
          {actionFeedback}
        </>
      );
      break;
    case "active":
      body = (
        <>
          <PluginNotice title="Plugin is active." tone="success">
            Approved runtime capabilities can load for this plugin.
          </PluginNotice>
          <PluginReviewSummaryRows includeApproved plugin={plugin} />
          <PluginIngressSourcesSection
            actionLoadingKey={actionLoadingKey}
            bindings={ingressBindings}
            linkCodes={ingressLinkCodes}
            onCreateLinkCode={onCreateIngressLinkCode}
            onDeleteBinding={onDeleteIngressBinding}
            onSetBindingEnabled={onSetIngressBindingEnabled}
            plugin={plugin}
          />
          {privateNetworkNotice}
          {allDomainNetworkNotice}
          {settingsBlock}
          <PluginAdminActionsSection
            actionLoadingKey={actionLoadingKey}
            onAdminAction={runAdminAction}
            plugin={plugin}
          />
          {actionErrorFeedback}
        </>
      );
      break;
    case "failed_degraded":
      body = (
        <>
          <PluginNotice title="Plugin failed to start." tone="danger">
            Review diagnostics, fix the underlying issue, then retry or disable.
          </PluginNotice>
          <PluginDiagnosticsBlock diagnostics={diagnostics} />
          <PluginManagerSection title="Runtime Summary">
            <PluginManagerSummaryRow
              iconName="account_circle"
              label="Name"
              value={displayName}
            />
            <PluginManagerSummaryRow
              iconName="shield"
              label="Approved Hash"
              value={pluginApprovedHashSummary(plugin)}
            />
            <PluginManagerSummaryRow
              iconName="warning"
              label="Failure Reason"
              value={
                plugin.lifecycle.failureReason ?? "No failure reason recorded"
              }
            />
            <PluginManagerSummaryRow
              iconName="schedule"
              label="Last Attempt"
              value={formatPluginTimestamp(plugin.lifecycle.lastActionAt)}
            />
            <PluginManagerSummaryRow
              iconName="history"
              label="Runtime State"
              value={runtimeStateValue}
            />
          </PluginManagerSection>
          {lifecycleMessage}
          {actionFeedback}
        </>
      );
      break;
    case "disabled_restart_required":
      body = (
        <>
          <PluginNotice title="This plugin is disabled." tone="info">
            Already-loaded capabilities remain available until Metidos restarts.
          </PluginNotice>
          <PluginManagerSection title="Plugin Details">
            <PluginManagerSummaryRow
              iconName="description"
              label="Version"
              value={displayValue(plugin.version)}
            />
            <PluginManagerSummaryRow
              iconName="schedule"
              label="Last Updated"
              value={formatPluginTimestamp(plugin.lifecycle.lastActionAt)}
            />
            <PluginManagerSummaryRow
              iconName="folder"
              label="Location"
              value={
                <span className="font-mono text-[11px]">
                  {plugin.folderPath}
                </span>
              }
            />
            <PluginManagerSummaryRow
              iconName="bolt"
              label="Permissions"
              value={pluginPermissionsSummary(plugin)}
            />
            <PluginManagerSummaryRow
              iconName="person"
              label="Access Groups"
              value={pluginAccessGroupsSummary(plugin)}
            />
          </PluginManagerSection>
          <PluginManagerSection title="Lifecycle">
            <PluginManagerSummaryRow
              iconName="radio_button_unchecked"
              label="Current State"
              value={runtimeStateValue}
            />
            <PluginManagerSummaryRow
              iconName="warning"
              label="Impact"
              value="Capabilities remain available until Metidos restarts."
            />
          </PluginManagerSection>
          {actionFeedback}
        </>
      );
      break;
    case "missing_unavailable":
      body = (
        <>
          <PluginNotice
            title="The plugin folder is missing or unreadable."
            tone="danger"
          >
            Metidos cannot load or review this plugin until it is restored on
            disk.
          </PluginNotice>
          <PluginManagerSection title="Recovery">
            <PluginManagerSummaryRow
              iconName="description"
              label="metidos-plugin.json"
              value="Plugin manifest and metadata"
            />
            <PluginManagerSummaryRow
              iconName="description"
              label="AGENTS.md"
              value="Operator and agent guidance"
            />
            <PluginManagerSummaryRow
              iconName="code"
              label="index.ts"
              value="Plugin entry point"
            />
          </PluginManagerSection>
          {lifecycleMessage}
          {actionFeedback}
        </>
      );
      break;
  }
  const footerActions: ReactNode[] = [
    <AppButton buttonStyle="muted" key="close" onClick={onClose}>
      Close
    </AppButton>,
  ];
  if (isAdmin) {
    if (plugin.status === "uninitialized") {
      footerActions.push(renderLifecycleAction("enable", "primary"));
    } else if (plugin.status === "needs_review") {
      footerActions.push(renderLifecycleAction("disable", "error"));
      footerActions.push(renderLifecycleAction("reapprove", "primary"));
    } else if (plugin.status === "active") {
      footerActions.push(renderLifecycleAction("disable", "error"));
    } else if (plugin.status === "failed_degraded") {
      footerActions.push(renderLifecycleAction("disable", "error"));
      footerActions.push(renderLifecycleAction("retry", "primary"));
    } else if (plugin.status === "disabled_restart_required") {
      footerActions.push(renderLifecycleAction("reapprove", "primary"));
    }
  }

  return (
    <ModalDialogSurface
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      backdropClassName="absolute inset-0 bg-bg-app/60"
      backdropLabel="Close plugin manager"
      className="flex max-h-[82dvh] w-full max-w-2xl flex-col overflow-hidden border border-border-default bg-surface-overlay text-text-primary shadow-overlay"
      initialFocusRef={closeButtonRef}
      onRequestClose={onClose}
      open={open}
      overlayClassName="fixed inset-0 z-[120] flex items-center justify-center px-4 py-6"
      restoreFocus={true}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border-subtle bg-surface-2 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-border-default bg-accent-surface text-accent">
            {materialSymbol("bolt", "text-[20px]")}
          </div>
          <div className="min-w-0">
            <div
              className="text-base font-semibold leading-5 text-text-primary"
              id={titleId}
            >
              Plugin Manager
            </div>
            <div
              className="mt-1 text-xs leading-5 text-text-muted"
              id={descriptionId}
            >
              Manage settings, permissions, and lifecycle for this plugin.
            </div>
          </div>
        </div>
        <AppButton
          aria-label="Close plugin manager"
          buttonStyle="muted"
          iconOnly
          onClick={onClose}
          ref={closeButtonRef}
        >
          {materialSymbol("close", "text-[15px]")}
        </AppButton>
      </div>

      <div className="min-h-0 overflow-y-auto px-4 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0 truncate text-base font-semibold text-text-primary">
            {displayName}
          </div>
          <PluginStatusBadge group={plugin.group} />
        </div>
        {body}
      </div>

      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border-subtle bg-surface-2 px-4 py-3">
        {footerActions}
      </div>
    </ModalDialogSurface>
  );
}

function PluginInventoryRow({
  isAdmin,
  onManage,
  plugin,
}: {
  isAdmin: boolean;
  onManage: () => void;
  plugin: RpcPluginInventoryPlugin;
}): JSX.Element {
  return (
    <div className="grid min-h-14 grid-cols-1 gap-2 border-t border-border-subtle px-3 py-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_12rem_7rem] md:items-center">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-text-primary">
          {pluginInventoryDisplayName(plugin)}
        </div>
        {plugin.description ? (
          <div className="mt-1 truncate text-xs text-text-muted md:hidden">
            {plugin.description}
          </div>
        ) : null}
      </div>
      <PluginStatusBadge group={plugin.group} />
      {isAdmin ? (
        <AppButton
          buttonStyle="muted"
          className="w-full justify-between"
          onClick={onManage}
        >
          Manage
          {materialSymbol("chevron_right", "text-[16px]")}
        </AppButton>
      ) : null}
    </div>
  );
}

export type PluginInventorySectionProps = {
  actionError?: string;
  actionLoadingKey?: string | null;
  actionMessage?: string;
  error: string;
  initialSelectedPluginFolderPath?: string | null;
  ingressBindings?: readonly RpcPluginIngressExternalBinding[];
  ingressLinkCodes?: PluginIngressLinkCodes;
  inventory: RpcPluginInventory | null;
  isAdmin: boolean;
  loading: boolean;
  onAdminAction?: (
    plugin: RpcPluginInventoryPlugin,
    action: RpcPluginAdminAction,
    confirmation?: string,
  ) => void;
  onCreateIngressLinkCode?: (pluginId: string, sourceId: string) => void;
  onDeleteIngressBinding?: (binding: RpcPluginIngressExternalBinding) => void;
  onLifecycleAction?: (
    plugin: RpcPluginInventoryPlugin,
    action: RpcPluginLifecycleAction,
  ) => void;
  onRefresh: () => void;
  onSetIngressBindingEnabled?: (
    binding: RpcPluginIngressExternalBinding,
    enabled: boolean,
  ) => void;
  onSettingValueChange?: (
    directoryName: string,
    key: string,
    value: PluginSettingFormValue,
  ) => void;
  sidecarDiagnostics?: RpcPluginSidecarDiagnostics[];
  settingsErrors?: Record<string, string>;
  settingsSnapshots?: PluginSettingsSnapshots;
  settingsValues?: PluginSettingFormValues;
};

export function PluginInventorySection({
  actionError = "",
  actionLoadingKey = null,
  actionMessage = "",
  error,
  initialSelectedPluginFolderPath = null,
  ingressBindings = [],
  ingressLinkCodes = {},
  inventory,
  isAdmin,
  loading,
  onAdminAction = () => {},
  onCreateIngressLinkCode = () => {},
  onDeleteIngressBinding = () => {},
  onLifecycleAction = () => {},
  onRefresh,
  onSetIngressBindingEnabled = () => {},
  onSettingValueChange = () => {},
  sidecarDiagnostics = [],
  settingsErrors = {},
  settingsSnapshots = {},
  settingsValues = {},
}: PluginInventorySectionProps): JSX.Element {
  const [selectedPluginFolderPath, setSelectedPluginFolderPath] = useState<
    string | null
  >(initialSelectedPluginFolderPath);
  const selectedPlugin =
    inventory?.plugins.find(
      (plugin) => plugin.folderPath === selectedPluginFolderPath,
    ) ??
    inventory?.groups
      .flatMap((group) => group.plugins)
      .find((plugin) => plugin.folderPath === selectedPluginFolderPath) ??
    null;
  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-base font-semibold text-text-primary">
            {materialSymbol("bolt", "text-[19px] text-accent")}
            <span className="min-w-0 truncate">Plugins</span>
          </div>
          <div className="mt-1 text-xs leading-5 text-text-muted">
            View and manage installed plugins. Click Manage to configure,
            inspect permissions, review, or troubleshoot.
          </div>
        </div>
        <AppButton buttonStyle="muted" disabled={loading} onClick={onRefresh}>
          {loading ? "Refreshing…" : "Refresh Plugins"}
        </AppButton>
      </div>

      {inventory ? (
        <div className="mt-2 text-[11px] leading-5 text-text-muted">
          Scanned {inventory.scannedAt}. Plugin folder:{" "}
          <span className="font-mono text-text-secondary">
            {inventory.pluginsDirectoryPath}
          </span>
        </div>
      ) : null}

      {loading && !inventory ? (
        <div className="mt-3 border border-border-subtle bg-surface-2 px-3 py-2 text-xs text-text-muted">
          Loading plugin inventory…
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-text">
          {error}
        </div>
      ) : null}

      {inventory?.issues.length ? (
        <div className="mt-3 border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-text">
          {inventory.issues[0]?.message}
        </div>
      ) : null}

      <PluginManagerDialog
        actionError={actionError}
        actionLoadingKey={actionLoadingKey}
        actionMessage={actionMessage}
        diagnostics={
          selectedPlugin
            ? pluginDiagnosticsForSelection(sidecarDiagnostics, selectedPlugin)
            : null
        }
        ingressBindings={ingressBindings}
        ingressLinkCodes={ingressLinkCodes}
        isAdmin={isAdmin}
        key={selectedPluginFolderPath ?? "closed"}
        onAdminAction={onAdminAction}
        onClose={() => {
          setSelectedPluginFolderPath(null);
        }}
        onCreateIngressLinkCode={onCreateIngressLinkCode}
        onDeleteIngressBinding={onDeleteIngressBinding}
        onLifecycleAction={onLifecycleAction}
        onSetIngressBindingEnabled={onSetIngressBindingEnabled}
        onSettingValueChange={onSettingValueChange}
        open={selectedPlugin !== null}
        plugin={selectedPlugin}
        settingsErrors={settingsErrors}
        settingsSnapshots={settingsSnapshots}
        settingsValues={settingsValues}
      />

      {inventory ? (
        <div className="mt-3 overflow-hidden border border-border-subtle">
          <div className="hidden grid-cols-[minmax(0,1fr)_12rem_7rem] border-b border-border-subtle bg-surface-2 px-3 py-2 font-label text-[10px] font-semibold uppercase tracking-[0.1em] text-text-faint md:grid">
            <div>Plugin Name</div>
            <div>Status</div>
            <div>Actions</div>
          </div>
          {allPluginsFromInventory(inventory).length > 0 ? (
            allPluginsFromInventory(inventory).map((plugin) => (
              <PluginInventoryRow
                isAdmin={isAdmin}
                key={plugin.folderPath}
                onManage={() => {
                  setSelectedPluginFolderPath(plugin.folderPath);
                }}
                plugin={plugin}
              />
            ))
          ) : (
            <div className="px-3 py-3 text-xs text-text-muted">
              No plugins discovered.
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
