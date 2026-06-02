/**
 * @file src/mainview/controls/thread-access-control.tsx
 * @description Module for thread access control.
 */

import {
  Fragment,
  type JSX,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { AppButton } from "./button";

import type {
  RpcPluginAccessGroupOption,
  RpcThreadPermissionDescriptor,
} from "../../bun/rpc-schema";
import { useAccessPermissions } from "../app/use-access-permissions";
import { useDynamicCssVariablesClassName } from "../dynamic-css-variables";
import { DropdownControl } from "./dropdown";
import { type AppIconName, materialSymbol } from "./icons";
import { PopoverSurface } from "./popover";
import { TintedCheckboxRow } from "./tinted-checkbox-row";

const ACCESS_TINT_GIT = "var(--color-access-git)";
const ACCESS_TINT_METIDOS = "var(--color-access-metidos)";
const ACCESS_TINT_WARNING = "var(--color-warning-text)";
const ACCESS_TINT_WEB = "var(--color-accent-strong)";

const FALLBACK_NATIVE_PERMISSION_DESCRIPTORS: RpcThreadPermissionDescriptor[] =
  [
    {
      accessId: "web-search",
      category: "external",
      defaultEnabled: true,
      description: "Current-information web search/fetch capability.",
      id: "metidos:web-search",
      label: "Web Search",
      order: 0,
      providerDescription: "Metidos native tools",
      providerId: "metidos",
      requiresApproval: false,
      unsafe: false,
    },
    {
      accessId: "webserver",
      category: "agent-runtime",
      defaultEnabled: false,
      description: "Project-scoped local web server helpers.",
      id: "metidos:webserver",
      label: "WebServer",
      order: 2,
      providerDescription: "Metidos native tools",
      providerId: "metidos",
      requiresApproval: false,
      unsafe: false,
    },
    {
      accessId: "github",
      category: "external",
      defaultEnabled: false,
      description: "GitHub-native tool family.",
      id: "metidos:github",
      label: "GitHub",
      order: 3,
      providerDescription: "Metidos native tools",
      providerId: "metidos",
      requiresApproval: false,
      unsafe: false,
    },
    {
      accessId: "git",
      category: "data",
      defaultEnabled: false,
      description: "Worktree-scoped local Git helpers.",
      id: "metidos:git",
      label: "Git",
      order: 4,
      providerDescription: "Metidos native tools",
      providerId: "metidos",
      requiresApproval: false,
      unsafe: false,
    },
    {
      accessId: "sqlite",
      category: "data",
      defaultEnabled: false,
      description: "Project-scoped SQLite helper.",
      id: "metidos:sqlite",
      label: "SQLite",
      order: 5,
      providerDescription: "Metidos native tools",
      providerId: "metidos",
      requiresApproval: false,
      unsafe: false,
    },
    {
      accessId: "lancedb",
      category: "data",
      defaultEnabled: false,
      description: "Project-scoped LanceDB vector search helper.",
      id: "metidos:lancedb",
      label: "LanceDB",
      order: 6,
      providerDescription: "Metidos native tools",
      providerId: "metidos",
      requiresApproval: false,
      unsafe: false,
    },
    {
      accessId: "agents",
      category: "coordination",
      defaultEnabled: false,
      description: "Plan updates and delegated helper tasks.",
      id: "metidos:agents",
      label: "Agents",
      order: 7,
      providerDescription: "Metidos native tools",
      providerId: "metidos",
      requiresApproval: false,
      unsafe: false,
    },
    {
      accessId: "calendar",
      category: "data",
      defaultEnabled: false,
      description: "Calendar and calendar-event tools.",
      id: "metidos:calendar",
      label: "Calendar",
      order: 8,
      providerDescription: "Metidos native tools",
      providerId: "metidos",
      requiresApproval: false,
      unsafe: false,
    },
    {
      accessId: "notifications",
      category: "external",
      defaultEnabled: false,
      description: "Notification delivery tools.",
      id: "metidos:notifications",
      label: "Notifications",
      order: 9,
      providerDescription: "Metidos native tools",
      providerId: "metidos",
      requiresApproval: false,
      unsafe: false,
    },
    {
      accessId: "threads",
      category: "coordination",
      defaultEnabled: true,
      description: "Thread listing and child thread creation tools.",
      id: "metidos:threads",
      label: "Threads",
      order: 10,
      providerDescription: "Metidos native tools",
      providerId: "metidos",
      requiresApproval: false,
      unsafe: false,
    },
    {
      accessId: "crons",
      category: "coordination",
      defaultEnabled: true,
      description: "Cron listing, creation, update, and show tools.",
      id: "metidos:crons",
      label: "Crons",
      order: 11,
      providerDescription: "Metidos native tools",
      providerId: "metidos",
      requiresApproval: false,
      unsafe: false,
    },
    {
      accessId: "unsafe",
      category: "security",
      defaultEnabled: false,
      description: "Unsafe execution/sandbox escalation permission.",
      id: "metidos:unsafe",
      label: "Unsafe",
      order: 12,
      providerDescription: "Metidos native tools",
      providerId: "metidos",
      requiresApproval: true,
      unsafe: true,
    },
  ];

const HIDDEN_THREAD_PERMISSION_IDS = new Set<string>();

const NATIVE_PERMISSION_ICONS: Partial<Record<string, AppIconName>> = {
  "metidos:agents": "checklist",
  "metidos:calendar": "schedule",
  "metidos:crons": "schedule",
  "metidos:git": "history",
  "metidos:github": "code",
  "metidos:lancedb": "search",
  "metidos:notifications": "bolt",
  "metidos:sqlite": "description",
  "metidos:threads": "folder_open",
  "metidos:unsafe": "terminal",
  "metidos:web-search": "public",
  "metidos:webserver": "web_server",
};

function tintForPermission(
  descriptor: RpcThreadPermissionDescriptor,
  pluginColor?: string | null,
): string {
  if (descriptor.providerId !== "metidos" && pluginColor) {
    return pluginColor;
  }
  if (descriptor.unsafe || descriptor.id === "metidos:unsafe") {
    return ACCESS_TINT_WARNING;
  }
  if (descriptor.providerId !== "metidos") {
    return ACCESS_TINT_METIDOS;
  }
  if (["git", "github"].includes(descriptor.accessId)) {
    return ACCESS_TINT_GIT;
  }
  if (["web-search", "webserver"].includes(descriptor.accessId)) {
    return ACCESS_TINT_WEB;
  }
  return ACCESS_TINT_METIDOS;
}

function groupPermissionDescriptors(
  descriptors: RpcThreadPermissionDescriptor[],
): [string, RpcThreadPermissionDescriptor[]][] {
  const groups = new Map<string, RpcThreadPermissionDescriptor[]>();
  for (const descriptor of descriptors) {
    const key = `${descriptor.providerId}\u0000${descriptor.providerDescription}`;
    groups.set(key, [...(groups.get(key) ?? []), descriptor]);
  }
  return [...groups.entries()].map(([key, values]) => [key, values]);
}

function pluginAccessGroupPermission(
  group: RpcPluginAccessGroupOption,
): string {
  return `${group.pluginId}:${group.groupId}`;
}

export type ThreadAccessValue = {
  permissions?: string[];
  pluginAccessGroups?: string[];
  agentsAccess: boolean;
  calendarAccess?: boolean;
  gitAccess: boolean;
  githubAccess: boolean;
  threadsAccess?: boolean;
  cronsAccess?: boolean;
  metidosAccess: boolean;
  notificationsAccess?: boolean;
  weatherAccess?: boolean;
  sqliteAccess: boolean;
  webServerAccess?: boolean;
  unsafeMode: boolean;
  webSearchAccess: boolean;
};

type ThreadAccessControlProps = {
  availablePluginAccessGroups?: RpcPluginAccessGroupOption[];
  availableThreadPermissionDescriptors?: RpcThreadPermissionDescriptor[];
  disabled: boolean;
  onChange: (value: ThreadAccessValue) => void;
  showUnsafeMode?: boolean;
  title?: string;
  value: ThreadAccessValue;
  variant: "desktop" | "mobile";
};

export function accessDescriptionPopoverPlacement(
  variant: ThreadAccessControlProps["variant"],
): "left" | "right" {
  return variant === "desktop" ? "right" : "left";
}

function AccessDescriptionPopover({
  description,
  label,
  variant,
}: {
  description: string;
  label: string;
  variant: ThreadAccessControlProps["variant"];
}): JSX.Element {
  const tooltipId = useId();
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const placement = accessDescriptionPopoverPlacement(variant);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openTooltip = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const closeTooltip = useCallback(() => {
    clearCloseTimer();
    setOpen(false);
  }, [clearCloseTimer]);

  const scheduleCloseTooltip = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, 120);
  }, [clearCloseTimer]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  return (
    <span className="shrink-0 self-center">
      <AppButton
        unstyled
        aria-describedby={open ? tooltipId : undefined}
        aria-label={`About ${label} access`}
        className="inline-flex h-7 w-7 items-center justify-center border border-transparent text-[11px] font-semibold leading-none text-text-muted transition-colors hover:border-border-default hover:text-text-primary focus-visible:border-accent focus-visible:text-text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1"
        onBlur={closeTooltip}
        onFocus={openTooltip}
        onMouseEnter={openTooltip}
        onMouseLeave={scheduleCloseTooltip}
        ref={anchorRef}
        type="button"
      >
        ?
      </AppButton>
      <PopoverSurface
        className="z-[109] w-[15rem] max-w-[min(72vw,15rem)] border border-border-default bg-surface-2 px-3 py-2 text-left text-[11px] leading-5 text-text-secondary shadow-overlay"
        id={tooltipId}
        offsetPx={8}
        open={open}
        placement={placement}
        reference={anchorRef.current}
        role="tooltip"
        onMouseEnter={openTooltip}
        onMouseLeave={scheduleCloseTooltip}
      >
        {description}
      </PopoverSurface>
    </span>
  );
}

function AccessRow({
  checked,
  description,
  disabled,
  iconColor,
  iconName,
  label,
  onChange,
  tintColor,
  variant,
}: {
  checked: boolean;
  description: string;
  disabled: boolean;
  iconColor?: string;
  iconName?: AppIconName;
  label: string;
  onChange: (checked: boolean) => void;
  tintColor: string;
  variant: ThreadAccessControlProps["variant"];
}): JSX.Element {
  const iconClassName = useDynamicCssVariablesClassName(
    {
      "--thread-access-icon-color": iconColor ?? tintColor,
    },
    {
      className:
        "thread-access-icon flex h-4 w-4 shrink-0 items-center justify-center",
      prefix: "thread-access-icon-vars",
    },
  );

  return (
    <TintedCheckboxRow
      checked={checked}
      checkboxLabel={`${label} access`}
      disabled={disabled}
      onChange={onChange}
      tintColor={tintColor}
      trailing={
        <AccessDescriptionPopover
          description={description}
          label={label}
          variant={variant}
        />
      }
    >
      {iconName ? (
        <span aria-hidden="true" className={iconClassName}>
          {materialSymbol(iconName, "text-[14px]")}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold leading-4 uppercase tracking-[0.1em] text-text-primary">
          {label}
        </span>
      </span>
    </TintedCheckboxRow>
  );
}

/**
 * Thread-level access selector used for thread creation, thread updates, and cron jobs.
 */
export function ThreadAccessControl({
  availablePluginAccessGroups = [],
  availableThreadPermissionDescriptors,
  disabled,
  onChange,
  showUnsafeMode = true,
  title = "Access controls for the current thread or cron job.",
  value,
  variant,
}: ThreadAccessControlProps): JSX.Element {
  const accessPermissions = useAccessPermissions({ onChange, value });
  const { access } = accessPermissions;
  const compact = variant === "mobile";
  const panelId = useId();
  const panelTitleId = `${panelId}-title`;
  const panelDescriptionId = `${panelId}-description`;
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const pluginGroupDescriptors = availablePluginAccessGroups.map((group) => ({
    accessId: group.groupId,
    category: "plugin" as const,
    defaultEnabled: false,
    description:
      group.description ??
      `Expose plugin tools from ${group.pluginName ?? group.pluginId}.`,
    id: pluginAccessGroupPermission(group),
    label: group.groupName ?? group.groupId,
    order: 0,
    providerDescription: group.pluginName ?? group.pluginId,
    providerId: group.pluginId,
    requiresApproval: false,
    unsafe: false,
  }));
  const permissionDescriptors = [
    ...(availableThreadPermissionDescriptors ??
      FALLBACK_NATIVE_PERMISSION_DESCRIPTORS),
    ...pluginGroupDescriptors.filter(
      (pluginDescriptor) =>
        !(availableThreadPermissionDescriptors ?? []).some(
          (descriptor) => descriptor.id === pluginDescriptor.id,
        ),
    ),
  ].filter(
    (descriptor) =>
      !HIDDEN_THREAD_PERMISSION_IDS.has(descriptor.id) &&
      (descriptor.id !== "metidos:unsafe" || showUnsafeMode),
  );
  const descriptorGroups = groupPermissionDescriptors(permissionDescriptors);

  return (
    <DropdownControl
      canOpen={!disabled}
      closeOnDisable={false}
      disabled={disabled}
      panelClassName={[
        "z-[108] overflow-visible border border-border-default bg-surface-1 shadow-overlay",
        compact
          ? "w-[18rem] max-w-[calc(100vw-1rem)]"
          : "w-[20rem] max-w-[calc(100vw-2rem)]",
      ].join(" ")}
      panelDescribedBy={panelDescriptionId}
      panelId={panelId}
      panelInitialFocusRef={closeButtonRef}
      panelLabelledBy={panelTitleId}
      panelMode="nonmodal-dialog"
      panelPlacement="top-end"
      rootClassName="relative inline-flex overflow-visible"
      title={`${title}`}
      renderButton={({ buttonRef, open, toggle }) => (
        <AppButton
          unstyled
          aria-controls={panelId}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={[
            "inline-flex h-8 items-center gap-2 border px-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors",
            disabled
              ? "cursor-not-allowed border-border-default bg-surface-1 text-text-muted opacity-70"
              : open
                ? "border-accent bg-surface-2 text-text-primary"
                : "border-border-default bg-surface-1 text-text-secondary hover:border-border-default hover:bg-surface-2",
          ].join(" ")}
          disabled={disabled}
          onClick={toggle}
          ref={buttonRef}
          type="button"
        >
          <span className="flex items-center gap-2">
            {materialSymbol("shield", "text-[16px] leading-none")}
            <span>Access</span>
          </span>
          <span className="ml-1 flex min-w-0 items-center gap-1 text-[10px] font-medium tracking-[0.1em] text-text-muted">
            <span aria-hidden="true" className="text-text-muted">
              {materialSymbol(
                open ? "expand_less" : "expand_more",
                "text-[16px]",
              )}
            </span>
          </span>
        </AppButton>
      )}
      renderPanel={({ close }) => (
        <>
          <p className="sr-only" id={panelDescriptionId}>
            {title}
          </p>
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <div
              className="font-label text-[10px] uppercase tracking-[0.1em] text-accent"
              id={panelTitleId}
            >
              Access controls
            </div>
            <AppButton
              unstyled
              aria-label="Close access controls"
              className="inline-flex h-7 w-7 items-center justify-center border border-border-default text-[13px] font-semibold text-text-secondary transition hover:border-accent hover:text-text-primary"
              onClick={close}
              ref={closeButtonRef}
              type="button"
            >
              {materialSymbol("close", "text-[15px]")}
            </AppButton>
          </div>
          <div className="max-h-[50vw] space-y-2 overflow-y-auto p-3">
            {descriptorGroups.map(([groupKey, groupDescriptors]) => (
              <Fragment key={groupKey}>
                {groupDescriptors.map((descriptor) => {
                  const pluginGroup = availablePluginAccessGroups.find(
                    (group) =>
                      pluginAccessGroupPermission(group) === descriptor.id,
                  );
                  return (
                    <AccessRow
                      key={descriptor.id}
                      tintColor={tintForPermission(
                        descriptor,
                        pluginGroup?.color,
                      )}
                      checked={access.permissions.includes(descriptor.id)}
                      description={`${descriptor.id}: ${descriptor.description}`}
                      disabled={disabled}
                      iconName={
                        NATIVE_PERMISSION_ICONS[descriptor.id] ?? "settings"
                      }
                      label={descriptor.label}
                      onChange={(checked) => {
                        if (pluginGroup) {
                          accessPermissions.setPluginAccessGroup(
                            pluginGroup.key,
                            checked,
                          );
                          return;
                        }
                        accessPermissions.setPermission(descriptor.id, checked);
                      }}
                      variant={variant}
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
        </>
      )}
    />
  );
}
