/**
 * @file src/mainview/app/cronjob-workspace.tsx
 * @description Module for cronjob workspace.
 */

import * as cronstrue from "cronstrue";
import { type JSX, Suspense } from "react";
import type { RpcCronJob } from "../../bun/rpc-schema";
import { LazyRichMarkdownMessage } from "./message-markdown-loader";

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

function CronjobPromptMarkdown({ prompt }: { prompt: string }): JSX.Element {
  if (!prompt.trim()) {
    return (
      <div className="text-sm leading-6 text-[#9aa3ae]">No prompt text.</div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="whitespace-pre-wrap break-words text-sm leading-6 text-[#dce7ee]">
          {prompt}
        </div>
      }
    >
      <LazyRichMarkdownMessage text={prompt} />
    </Suspense>
  );
}

/**
 * Renders a grid listing for available cron jobs with prominent cron text.
 */
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
          className="rounded-md border border-[#2b3a45] bg-[#161a1d] p-4"
          key={cronJob.id}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <h3 className="truncate text-sm font-semibold text-[#f2f0ef]">
                {cronJob.title || "Untitled cron job"}
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-label text-[10px] uppercase tracking-[0.16em] text-[#7b8893]">
                  Schedule
                </span>
                <span className="group relative inline-flex max-w-full">
                  <span className="cursor-help rounded-full border border-[#3f5765] bg-[#10171c] px-2.5 py-1 font-mono text-[11px] leading-5 text-[#d7e5ee] transition-colors group-hover:border-[#4d687a] group-hover:text-[#f4f8fb] group-focus-within:border-[#5d7e93] group-focus-within:text-[#f4f8fb]">
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
            </div>
            <CronjobStatus enabled={cronJob.enabled} />
          </div>
          <div className="mt-3 rounded-md border border-[#283742] bg-[#0f1418] p-3 text-sm leading-6 text-[#dce7ee]">
            <div className="mb-2 font-label text-[10px] uppercase tracking-[0.16em] text-[#8aa4b6]">
              Cron text
            </div>
            <div className="max-h-40 overflow-y-auto pr-1">
              <CronjobPromptMarkdown prompt={cronJob.prompt} />
            </div>
          </div>
          <div className="mt-3 space-y-2 text-[11px] text-[#7f8d97]">
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
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                className="rounded border border-[#39464f] bg-[#1a242b] px-3 py-1.5 text-[11px] font-label uppercase tracking-[0.14em] text-[#9ab2c0] transition-colors hover:border-[#4a5e6c] hover:bg-[#242f38] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={deletingCronJobs.has(cronJob.id)}
                onClick={() => {
                  onEditCron(cronJob);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="rounded border border-[#5c2030] bg-[#2c1117] px-3 py-1.5 text-[11px] font-label uppercase tracking-[0.14em] text-[#ff9db0] transition-colors hover:border-[#7a3246] hover:bg-[#39161f] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={deletingCronJobs.has(cronJob.id)}
                onClick={() => {
                  onDeleteCron(cronJob);
                }}
              >
                {deletingCronJobs.has(cronJob.id) ? "Deleting…" : "Delete"}
              </button>
              <button
                type="button"
                className="rounded border border-[#2c8e47] bg-[#1d6f35] px-3 py-1.5 text-[11px] font-label uppercase tracking-[0.14em] text-[#ebffee] transition-colors hover:border-[#37a657] hover:bg-[#247b3f] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  deletingCronJobs.has(cronJob.id) ||
                  runningCronJobs.has(cronJob.id) ||
                  cronJob.enabled !== 1
                }
                onClick={() => {
                  onRunCron(cronJob.id);
                }}
              >
                {runningCronJobs.has(cronJob.id) ? "Running…" : "Run now"}
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
