/**
 * @file src/mainview/app/cronjob-workspace.tsx
 * @description Cronjob list view.
 */

import * as cronstrue from "cronstrue";
import type { JSX } from "react";
import type { RpcCronJob } from "../../bun/rpc-schema";
import { AppButton } from "../controls/button";
import { materialSymbol } from "../controls/icons";

type CronjobWorkspaceProps = {
  cronJobs: RpcCronJob[];
  cronJobsError: string;
  deletingCronJobs: Set<number>;
  isLoadingCronJobs: boolean;
  onDeleteCron: (cronJob: RpcCronJob) => void;
  onEditCron: (cronJob: RpcCronJob) => void;
  onRunCron: (cronJobId: number) => void;
  runningCronJobs: Set<number>;
};

function formatNextRunDate(nextRunDate: number | null): string {
  if (nextRunDate === null) {
    return "Unavailable";
  }
  const parsedDate = new Date(nextRunDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Unknown";
  }
  return parsedDate.toLocaleString();
}

function describeCronSchedule(schedule: string): string {
  try {
    return cronstrue.toString(schedule);
  } catch {
    return "Unable to parse this cron schedule.";
  }
}

function CronjobListRow({
  cronJob,
  deleting,
  onDelete,
  onEdit,
  onRun,
  running,
}: {
  cronJob: RpcCronJob;
  deleting: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onRun: () => void;
  running: boolean;
}): JSX.Element {
  const statusColor =
    cronJob.enabled === 1 ? "text-success-text" : "text-text-muted";
  const statusLabel = cronJob.enabled === 1 ? "Enabled" : "Disabled";
  const title = cronJob.title || "Untitled cron job";

  return (
    <div className="flex w-full min-h-11 items-center gap-2 px-3 py-2 text-text-secondary transition-colors hover:bg-surface-1 focus-within:bg-surface-1">
      <AppButton
        unstyled
        type="button"
        aria-label={`Edit cron job ${title}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-2"
        onClick={onEdit}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-surface-3 text-accent">
          {materialSymbol("schedule", "text-[15px]")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold leading-4 text-text-primary">
              {title}
            </span>
            <span className="font-mono text-[11px] leading-4 text-text-muted">
              {cronJob.schedule}
            </span>
          </span>
          <span className="mt-1 block truncate text-[11px] leading-4">
            <span className={statusColor}>{statusLabel}</span>
            <span className="mx-1.5 text-text-faint">·</span>
            <span className="text-text-muted">
              {describeCronSchedule(cronJob.schedule)}
            </span>
            <span className="mx-1.5 text-text-faint">·</span>
            <span className="text-text-muted">
              Next {formatNextRunDate(cronJob.nextRunDate)}
            </span>
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
  cronJobs,
  cronJobsError,
  deletingCronJobs,
  isLoadingCronJobs,
  onDeleteCron,
  onEditCron,
  onRunCron,
  runningCronJobs,
}: CronjobWorkspaceProps): JSX.Element {
  if (isLoadingCronJobs) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center border border-border-subtle bg-surface-1 px-4 py-8 text-sm text-text-muted">
        Loading cron jobs…
      </div>
    );
  }

  if (cronJobsError) {
    return (
      <div className="min-h-0 border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-text">
        {cronJobsError}
      </div>
    );
  }

  if (cronJobs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center border border-border-subtle bg-surface-1 px-4 py-8 text-sm text-text-muted">
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
          cronJob={cronJob}
          deleting={deletingCronJobs.has(cronJob.id)}
          running={runningCronJobs.has(cronJob.id)}
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
