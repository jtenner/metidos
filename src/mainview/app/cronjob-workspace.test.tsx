/**
 * @file src/mainview/app/cronjob-workspace.test.tsx
 * @description Focused tests for cron job workspace presentation states.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { RpcCronJob } from "../../bun/rpc-schema";
import { CronjobWorkspace } from "./cronjob-workspace";

function makeCronJob(overrides?: Partial<RpcCronJob>): RpcCronJob {
  return {
    agentsAccess: false,
    createdAt: "2026-06-02T00:00:00.000Z",
    deletedAt: null,
    description: "Cron fixture description.",
    enabled: 1,
    githubAccess: false,
    id: 42,
    lastRunDate: null,
    lastRunStatus: null,
    metidosAccess: false,
    model: "openai-codex:gpt-5-codex",
    nextRunDate: Date.UTC(2026, 5, 3, 14, 30, 0),
    prompt: "Run the cron fixture.",
    projectId: 7,
    reasoningEffort: "medium",
    schedule: "0 14 * * *",
    title: "Daily fixture cron",
    unsafeMode: false,
    updatedAt: "2026-06-02T00:00:00.000Z",
    webSearchAccess: false,
    worktreePath: "/tmp/metidos-demo",
    ...overrides,
  };
}

function renderCronWorkspace(props?: {
  cronJobs?: RpcCronJob[];
  cronJobsError?: string;
  deletingCronJobs?: Set<number>;
  isLoadingCronJobs?: boolean;
  runningCronJobs?: Set<number>;
}): string {
  return renderToStaticMarkup(
    <CronjobWorkspace
      cronJobs={props?.cronJobs ?? []}
      cronJobsError={props?.cronJobsError ?? ""}
      deletingCronJobs={props?.deletingCronJobs ?? new Set()}
      isLoadingCronJobs={props?.isLoadingCronJobs ?? false}
      onDeleteCron={() => undefined}
      onEditCron={() => undefined}
      onRunCron={() => undefined}
      runningCronJobs={props?.runningCronJobs ?? new Set()}
    />,
  );
}

describe("CronjobWorkspace presentation states", () => {
  it("renders loading, error, and empty states with safe status text", () => {
    expect(renderCronWorkspace({ isLoadingCronJobs: true })).toContain(
      "Loading cron jobs…",
    );
    expect(
      renderCronWorkspace({ cronJobsError: "Unable to load cron jobs." }),
    ).toContain("Unable to load cron jobs.");
    expect(renderCronWorkspace()).toContain("No cron jobs found.");
  });

  it("renders enabled cron rows with schedule and next-run summaries", () => {
    const markup = renderCronWorkspace({ cronJobs: [makeCronJob()] });

    expect(markup).toContain("Daily fixture cron");
    expect(markup).toContain("0 14 * * *");
    expect(markup).toContain("Enabled");
    expect(markup).toContain("At 02:00 PM");
    expect(markup).toContain("Run cron job Daily fixture cron");
    expect(markup).toContain("Delete cron job Daily fixture cron");
  });

  it("renders busy run/delete labels and disabled affordances per cron row", () => {
    const markup = renderCronWorkspace({
      cronJobs: [makeCronJob({ enabled: 0, id: 99, title: "Paused cleanup" })],
      deletingCronJobs: new Set([99]),
      runningCronJobs: new Set([99]),
    });

    expect(markup).toContain("Paused cleanup");
    expect(markup).toContain("Disabled");
    expect(markup).toContain("Cron job Paused cleanup is running");
    expect(markup).toContain("Cron job Paused cleanup is being deleted");
    expect(markup).toContain("Running…");
    expect(markup).toContain("Deleting…");
  });
});
