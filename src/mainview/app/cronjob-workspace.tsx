/**
 * @file src/mainview/app/cronjob-workspace.tsx
 * @description Module for cronjob workspace.
 */

import * as cronstrue from "cronstrue";
import type { JSX } from "react";
import type { RpcCronJob } from "../../bun/rpc-schema";

type CronjobWorkspaceProps = {
  cronJobs: RpcCronJob[];
  cronJobsError: string;
  isLoadingCronJobs: boolean;
  onRunCron: (cronJobId: number) => void;
  runningCronJobs: Set<number>;
};

function formatLastRunDate(lastRunDate: number | null): string {
  if (lastRunDate === null) {
    return "Never";
  }
  const parsedDate = new Date(lastRunDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Unknown";
  }
  return parsedDate.toLocaleString();
}

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

function CronjobStatus({
  enabled,
}: {
  enabled: RpcCronJob["enabled"];
}): JSX.Element {
  const label = enabled === 1 ? "Enabled" : "Disabled";
  const colorClass = enabled === 1 ? "text-[#7ce38d]" : "text-[#9ca6ae]";

  return (
    <span className={`text-[10px] font-semibold ${colorClass}`}>{label}</span>
  );
}

/**
 * Renders a simple grid listing for available cron jobs.
 */
export function CronjobWorkspace({
  cronJobs,
  cronJobsError,
  isLoadingCronJobs,
  onRunCron,
  runningCronJobs,
}: CronjobWorkspaceProps): JSX.Element {
  if (isLoadingCronJobs) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-[#232f36] bg-[#161a1d] px-4 py-8 text-sm text-[#9aa7b1]">
        Loading cron jobs…
      </div>
    );
  }

  if (cronJobsError) {
    return (
      <div className="min-h-0 rounded-md border border-[#4b2f2f] bg-[#2a1515] px-4 py-3 text-sm text-[#ffd0d0]">
        {cronJobsError}
      </div>
    );
  }

  if (cronJobs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-[#232f36] bg-[#161a1d] px-4 py-8 text-sm text-[#95a0aa]">
        No cron jobs found.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cronJobs.map((cronJob) => (
        <article
          className="rounded-md border border-[#2b3a45] bg-[#161a1d] p-3"
          key={cronJob.id}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-[#f2f0ef]">
              {cronJob.title || "Untitled cron job"}
            </h3>
            <CronjobStatus enabled={cronJob.enabled} />
          </div>
          <div className="space-y-2 text-xs">
            <div className="text-[#9aa6b1]">
              <span className="mr-1 font-label uppercase tracking-widest text-[#7b8893]">
                ID:
              </span>
              {cronJob.id}
            </div>
            <div className="text-[#9aa6b1] break-all">
              <span className="mr-1 font-label uppercase tracking-widest text-[#7b8893]">
                Project:
              </span>
              {cronJob.projectId}
            </div>
            <div className="text-[#9aa6b1] break-all">
              <span className="mr-1 font-label uppercase tracking-widest text-[#7b8893]">
                Worktree:
              </span>
              {cronJob.worktreePath}
            </div>
            <div className="text-[#9aa6b1]">
              <span className="mr-1 font-label uppercase tracking-widest text-[#7b8893]">
                Schedule:
              </span>
              <span className="group relative inline-flex">
                <span className="cursor-help rounded border-b border-[#3f5765] border-dotted text-[#d7e5ee] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#7aa5c4] focus-visible:ring-offset-1 focus-visible:ring-offset-[#0e0e0e] group-hover:text-[#f4f8fb] group-focus-within:text-[#f4f8fb]">
                  {cronJob.schedule}
                </span>
                <span
                  className="pointer-events-none absolute left-0 top-full z-50 mt-1 w-[16rem] max-w-[min(90vw,16rem)] rounded border border-[#3c5462] bg-[#141b20] px-2.5 py-2 text-left text-[11px] leading-5 text-[#e2eef7] opacity-0 shadow-[0_18px_38px_rgba(0,0,0,0.42)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
                  role="tooltip"
                  aria-hidden="true"
                >
                  {describeCronSchedule(cronJob.schedule)}
                </span>
              </span>
            </div>
            <div className="text-[#99a3ae] h-14 overflow-y-auto break-all">
              {cronJob.prompt}
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#7f8d97]">
              <span>Last run</span>
              <span>{formatLastRunDate(cronJob.lastRunDate)}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#7f8d97]">
              <span>Next run</span>
              <span>{formatNextRunDate(cronJob.nextRunDate)}</span>
            </div>
            {cronJob.lastRunStatus ? (
              <div className="flex items-center justify-between text-[11px] text-[#7f8d97]">
                <span>Last status</span>
                <span>{cronJob.lastRunStatus}</span>
              </div>
            ) : null}
            <div className="pt-1">
              <button
                type="button"
                className="rounded border border-[#2c8e47] bg-[#1d6f35] px-3 py-1.5 text-[11px] font-label uppercase tracking-[0.14em] text-[#ebffee] transition-colors hover:bg-[#247b3f] hover:border-[#37a657] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  runningCronJobs.has(cronJob.id) || cronJob.enabled !== 1
                }
                onClick={() => {
                  onRunCron(cronJob.id);
                }}
              >
                {runningCronJobs.has(cronJob.id) ? "Running…" : "Run"}
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
