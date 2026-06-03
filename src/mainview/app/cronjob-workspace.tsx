/**
 * @file src/mainview/app/cronjob-workspace.tsx
 * @description Cronjob list view.
 */

import * as cronstrue from "cronstrue";
import {
  type JSX,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  RpcCronJob,
  RpcPluginAccessGroupOption,
  RpcThreadPermissionDescriptor,
} from "../../bun/rpc-schema";
import { LEGACY_THREAD_ACCESS_PERMISSION_IDS } from "../../shared/thread-access-projection";
import { AppButton } from "../controls/button";
import { type AppIconName, materialSymbol } from "../controls/icons";
import { PopoverSurface } from "../controls/popover";
import { TintedCheckboxRow } from "../controls/tinted-checkbox-row";
import { useDynamicCssVariablesClassName } from "../dynamic-css-variables";
import { formatPathForDisplay } from "./path-display-state";
import { accessPermissionsFromCronJob } from "./use-access-permissions";

type CronjobWorkspaceProps = {
  availablePluginAccessGroups: RpcPluginAccessGroupOption[];
  availableThreadPermissionDescriptors: RpcThreadPermissionDescriptor[];
  cronJobs: RpcCronJob[];
  cronJobsError: string;
  deletingCronJobs: Set<number>;
  homeDirectory: string;
  isLoadingCronJobs: boolean;
  onDeleteCron: (cronJob: RpcCronJob) => void;
  onEditCron: (cronJob: RpcCronJob) => void;
  onRunCron: (cronJobId: number) => void;
  runningCronJobs: Set<number>;
  supportsTildePath: boolean;
};

function describeCronSchedule(schedule: string): string {
  try {
    return cronstrue.toString(schedule);
  } catch {
    return "Unable to parse this cron schedule.";
  }
}

const ACCESS_TINT_GIT = "var(--color-access-git)";
const ACCESS_TINT_METIDOS = "var(--color-access-metidos)";
const ACCESS_TINT_WARNING = "var(--color-warning-text)";
const ACCESS_TINT_WEB = "var(--color-accent-strong)";

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

type CronPermissionItem = {
  description: string;
  iconName: AppIconName;
  id: string;
  label: string;
  order: number;
  tintColor: string;
};

function pluginAccessGroupPermission(
  group: RpcPluginAccessGroupOption,
): string {
  return `${group.pluginId}:${group.groupId}`;
}

function tintForPermission(
  descriptor: Pick<
    RpcThreadPermissionDescriptor,
    "accessId" | "id" | "providerId" | "unsafe"
  >,
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

function labelFromPermissionId(permissionId: string): string {
  const [, accessId = permissionId] = permissionId.split(":");
  return accessId
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function describeCronWorkspace(
  cronJob: RpcCronJob,
  homeDirectory = "",
  supportsTildePath = false,
): string {
  const worktreePath = cronJob.worktreePath.trim();
  return worktreePath
    ? formatPathForDisplay(worktreePath, homeDirectory, supportsTildePath)
    : "No worktree path";
}

export function cronPermissionItems(
  cronJob: RpcCronJob,
  availableThreadPermissionDescriptors: readonly RpcThreadPermissionDescriptor[] = [],
  availablePluginAccessGroups: readonly RpcPluginAccessGroupOption[] = [],
): CronPermissionItem[] {
  const access = accessPermissionsFromCronJob(cronJob);
  const permissionIds = new Set(access.permissions);
  if (!Array.isArray(cronJob.permissions)) {
    for (const [key, permissionId] of Object.entries(
      LEGACY_THREAD_ACCESS_PERMISSION_IDS,
    )) {
      if (cronJob[key as keyof RpcCronJob] === true) {
        permissionIds.add(permissionId);
      }
    }
    if (cronJob.metidosAccess) {
      permissionIds.add(LEGACY_THREAD_ACCESS_PERMISSION_IDS.threadsAccess);
      permissionIds.add(LEGACY_THREAD_ACCESS_PERMISSION_IDS.cronsAccess);
    }
  }
  for (const group of access.pluginAccessGroups) {
    const separator = group.includes("/") ? "/" : ":";
    const [pluginId, groupId] = group.split(separator);
    if (pluginId && groupId) {
      permissionIds.add(`${pluginId}:${groupId}`);
    }
  }

  const pluginGroupDescriptors = availablePluginAccessGroups.map((group) => ({
    accessId: group.groupId,
    category: "plugin" as const,
    defaultEnabled: false,
    description:
      group.description ??
      `Expose plugin tools from ${group.pluginName ?? group.pluginId}.`,
    id: pluginAccessGroupPermission(group),
    label: group.groupName ?? group.groupId,
    order: 1000,
    providerDescription: group.pluginName ?? group.pluginId,
    providerId: group.pluginId,
    requiresApproval: false,
    unsafe: false,
  }));
  const descriptors = [
    ...availableThreadPermissionDescriptors,
    ...pluginGroupDescriptors,
  ];
  const descriptorById = new Map(
    descriptors.map((descriptor) => [descriptor.id, descriptor]),
  );

  return [...permissionIds]
    .filter((permissionId) => permissionId.trim() !== "")
    .map((permissionId) => {
      const descriptor = descriptorById.get(permissionId);
      const pluginGroup = availablePluginAccessGroups.find(
        (group) => pluginAccessGroupPermission(group) === permissionId,
      );
      return {
        description: descriptor?.description ?? permissionId,
        iconName: NATIVE_PERMISSION_ICONS[permissionId] ?? "settings",
        id: permissionId,
        label: descriptor?.label ?? labelFromPermissionId(permissionId),
        order: descriptor?.order ?? 2000,
        tintColor: descriptor
          ? tintForPermission(descriptor, pluginGroup?.color)
          : ACCESS_TINT_METIDOS,
      };
    })
    .sort(
      (left, right) =>
        left.order - right.order || left.label.localeCompare(right.label),
    );
}

export function describeCronPermissions(
  cronJob: RpcCronJob,
  availableThreadPermissionDescriptors: readonly RpcThreadPermissionDescriptor[] = [],
  availablePluginAccessGroups: readonly RpcPluginAccessGroupOption[] = [],
): string {
  const count = cronPermissionItems(
    cronJob,
    availableThreadPermissionDescriptors,
    availablePluginAccessGroups,
  ).length;
  return `${count} permission${count === 1 ? "" : "s"}`;
}

function ReadonlyPermissionCheckboxItem({
  item,
}: {
  item: CronPermissionItem;
}): JSX.Element {
  const iconClassName = useDynamicCssVariablesClassName(
    {
      "--thread-access-icon-color": item.tintColor,
    },
    {
      className:
        "thread-access-icon flex h-4 w-4 shrink-0 items-center justify-center",
      prefix: "cron-permission-icon-vars",
    },
  );

  return (
    <TintedCheckboxRow
      checked
      checkboxLabel={`${item.label} access`}
      className="bg-surface-1"
      disabled
      onChange={() => undefined}
      tintColor={item.tintColor}
    >
      <span aria-hidden="true" className={iconClassName}>
        {materialSymbol(item.iconName, "text-[14px]")}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold leading-4 uppercase tracking-[0.1em] text-text-primary">
          {item.label}
        </span>
        <span className="block truncate text-[10px] leading-4 text-text-muted">
          {item.id}
        </span>
      </span>
    </TintedCheckboxRow>
  );
}

function CronPermissionsPopover({
  countLabel,
  items,
}: {
  countLabel: string;
  items: CronPermissionItem[];
}): JSX.Element {
  const popoverId = useId();
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openPopover = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const scheduleClosePopover = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, 120);
  }, [clearCloseTimer]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  return (
    <span className="inline-flex">
      <AppButton
        unstyled
        ref={anchorRef}
        aria-describedby={open ? popoverId : undefined}
        className="text-text-muted underline decoration-border-default decoration-dotted underline-offset-2 transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
        onBlur={scheduleClosePopover}
        onFocus={openPopover}
        onMouseEnter={openPopover}
        onMouseLeave={scheduleClosePopover}
        type="button"
      >
        {countLabel}
      </AppButton>
      <PopoverSurface
        className="z-[109] w-[18rem] max-w-[min(76vw,18rem)] border border-border-default bg-surface-2 p-2 text-left shadow-overlay"
        id={popoverId}
        offsetPx={8}
        open={open}
        placement="bottom-start"
        reference={anchorRef.current}
        role="tooltip"
        onMouseEnter={openPopover}
        onMouseLeave={scheduleClosePopover}
      >
        <div className="mb-2 px-1 font-label text-[10px] uppercase tracking-[0.1em] text-text-faint">
          Permissions
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {items.length > 0 ? (
            items.map((item) => (
              <ReadonlyPermissionCheckboxItem key={item.id} item={item} />
            ))
          ) : (
            <div className="px-1 py-1 text-[11px] text-text-muted">
              No permissions enabled.
            </div>
          )}
        </div>
      </PopoverSurface>
    </span>
  );
}

function CronjobListRow({
  availablePluginAccessGroups,
  availableThreadPermissionDescriptors,
  cronJob,
  deleting,
  homeDirectory,
  onDelete,
  onEdit,
  onRun,
  running,
  supportsTildePath,
}: {
  availablePluginAccessGroups: RpcPluginAccessGroupOption[];
  availableThreadPermissionDescriptors: RpcThreadPermissionDescriptor[];
  cronJob: RpcCronJob;
  deleting: boolean;
  homeDirectory: string;
  onDelete: () => void;
  onEdit: () => void;
  onRun: () => void;
  running: boolean;
  supportsTildePath: boolean;
}): JSX.Element {
  const title = cronJob.title || "Untitled cron job";
  const permissionItems = useMemo(
    () =>
      cronPermissionItems(
        cronJob,
        availableThreadPermissionDescriptors,
        availablePluginAccessGroups,
      ),
    [
      availablePluginAccessGroups,
      availableThreadPermissionDescriptors,
      cronJob,
    ],
  );
  const permissionCountLabel = describeCronPermissions(
    cronJob,
    availableThreadPermissionDescriptors,
    availablePluginAccessGroups,
  );

  return (
    <div className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-text-secondary transition-colors hover:bg-surface-1 focus-within:bg-surface-1">
      <AppButton
        unstyled
        type="button"
        aria-label={`Edit cron job ${title}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-2"
        onClick={onEdit}
      >
        <span className="shrink-0 text-text-muted" aria-hidden="true">
          {materialSymbol("schedule", "text-[15px]")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-semibold leading-4 text-text-primary">
              {title}
            </span>
            <span className="min-w-0 truncate text-[11px] leading-4 text-text-muted">
              <span className="font-mono">{cronJob.schedule}</span>
              <span className="mx-1.5 text-text-faint">·</span>
              <span>{describeCronSchedule(cronJob.schedule)}</span>
              <span className="mx-1.5 text-text-faint">-</span>
              <CronPermissionsPopover
                countLabel={permissionCountLabel}
                items={permissionItems}
              />
            </span>
          </span>
          <span className="mt-1 block truncate text-[11px] leading-4 text-text-muted">
            {describeCronWorkspace(cronJob, homeDirectory, supportsTildePath)}
          </span>
        </span>
      </AppButton>
      <div className="flex shrink-0 items-center gap-1">
        <AppButton
          aria-label={
            running ? `Cron job ${title} is running` : `Run cron job ${title}`
          }
          buttonStyle="muted"
          className="h-7 px-2 text-[11px]"
          disabled={running || deleting}
          onClick={onRun}
          type="button"
        >
          {running ? "Running…" : "Run"}
        </AppButton>
        <AppButton
          aria-label={
            deleting
              ? `Cron job ${title} is being deleted`
              : `Delete cron job ${title}`
          }
          buttonStyle="muted"
          className="h-7 px-2 text-[11px] text-danger-text"
          disabled={running || deleting}
          onClick={onDelete}
          type="button"
        >
          {deleting ? "Deleting…" : "Delete"}
        </AppButton>
      </div>
    </div>
  );
}

export function CronjobWorkspace({
  availablePluginAccessGroups,
  availableThreadPermissionDescriptors,
  cronJobs,
  cronJobsError,
  deletingCronJobs,
  homeDirectory,
  isLoadingCronJobs,
  onDeleteCron,
  onEditCron,
  onRunCron,
  runningCronJobs,
  supportsTildePath,
}: CronjobWorkspaceProps): JSX.Element {
  if (isLoadingCronJobs) {
    return (
      <div className="min-h-0 px-3 py-2 text-xs text-text-muted" role="status">
        Loading cron jobs…
      </div>
    );
  }

  if (cronJobsError) {
    return (
      <div className="min-h-0 px-3 py-2 text-xs text-danger-text" role="alert">
        {cronJobsError}
      </div>
    );
  }

  if (cronJobs.length === 0) {
    return (
      <div className="min-h-0 px-3 py-2 text-xs text-text-muted">
        No cron jobs found.
      </div>
    );
  }

  return (
    <fieldset className="divide-y divide-border-subtle border border-border-subtle p-0">
      <legend className="sr-only">Cron jobs</legend>
      {cronJobs.map((cronJob) => (
        <CronjobListRow
          key={cronJob.id}
          availablePluginAccessGroups={availablePluginAccessGroups}
          availableThreadPermissionDescriptors={
            availableThreadPermissionDescriptors
          }
          cronJob={cronJob}
          deleting={deletingCronJobs.has(cronJob.id)}
          homeDirectory={homeDirectory}
          running={runningCronJobs.has(cronJob.id)}
          supportsTildePath={supportsTildePath}
          onDelete={() => {
            onDeleteCron(cronJob);
          }}
          onEdit={() => {
            onEditCron(cronJob);
          }}
          onRun={() => {
            onRunCron(cronJob.id);
          }}
        />
      ))}
    </fieldset>
  );
}
