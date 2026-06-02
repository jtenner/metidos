/**
 * @file src/mainview/app/mainview-cron-workspace-controller.test.ts
 * @description Tests for cron workspace controller mutation helpers.
 */

import { describe, expect, it } from "bun:test";

import type { RpcReasoningEffort } from "../../bun/rpc-schema";
import {
  buildCronEditMutationPayload,
  describeCronEditorMutationState,
  executeCronDeleteMutation,
  executeCronEditMutation,
  executeCronRunNowMutation,
} from "./mainview-cron-workspace-controller";

type CronDraftOverrides = Partial<
  Parameters<typeof buildCronEditMutationPayload>[0]
>;

function draft(
  overrides?: CronDraftOverrides,
): Parameters<typeof buildCronEditMutationPayload>[0] {
  return {
    activeCodexModel: "openai-codex:gpt-5-codex",
    cronCreatorModel: "",
    cronCreatorReasoningEffort: "medium" as RpcReasoningEffort,
    cronEditDescription: " Fixture description ",
    cronEditEnabled: true,
    cronEditPermissions: ["metidos:threads"],
    cronEditProjectId: 7,
    cronEditPrompt: " Run the fixture. ",
    cronEditSchedule: " */5 * * * * ",
    cronEditTitle: " Fixture cron ",
    cronEditWorktreePath: "/tmp/metidos-demo",
    defaultCodexModel: "openai-codex:gpt-5-codex-mini",
    defaultCodexReasoningEffort: "low" as RpcReasoningEffort,
    ...overrides,
  };
}

describe("cron workspace controller mutation helpers", () => {
  it("describes create, edit, run-now, and delete busy affordances", () => {
    expect(
      describeCronEditorMutationState({
        currentEditingCronJobId: null,
        isCreatingCronJob: false,
        isEditingCronDeleting: false,
        isEditingCronRunning: false,
      }),
    ).toEqual({
      deleteDisabled: false,
      deleteLabel: "Delete",
      runNowDisabled: false,
      runNowLabel: "Run Now",
      submitLabel: "Create Cron",
    });

    expect(
      describeCronEditorMutationState({
        currentEditingCronJobId: 42,
        isCreatingCronJob: true,
        isEditingCronDeleting: false,
        isEditingCronRunning: false,
      }),
    ).toMatchObject({
      deleteDisabled: true,
      runNowDisabled: true,
      submitLabel: "Saving…",
    });

    expect(
      describeCronEditorMutationState({
        currentEditingCronJobId: 42,
        isCreatingCronJob: false,
        isEditingCronDeleting: true,
        isEditingCronRunning: true,
      }),
    ).toMatchObject({
      deleteDisabled: true,
      deleteLabel: "Deleting…",
      runNowDisabled: true,
      runNowLabel: "Running…",
      submitLabel: "Save",
    });
  });

  it("builds create/edit payloads with trimmed fields and disabled cron state", () => {
    expect(
      buildCronEditMutationPayload(
        draft({
          cronCreatorModel: " openai-codex:gpt-5.1-codex ",
          cronEditEnabled: false,
        }),
      ),
    ).toEqual({
      description: "Fixture description",
      enabled: false,
      model: "openai-codex:gpt-5.1-codex",
      permissions: ["metidos:threads"],
      projectId: 7,
      prompt: "Run the fixture.",
      reasoningEffort: "medium",
      schedule: "*/5 * * * *",
      title: "Fixture cron",
      worktreePath: "/tmp/metidos-demo",
    });
  });

  it("routes create and edit mutations through mocked cron RPCs then reloads", async () => {
    const calls: string[] = [];
    const createPayloads: unknown[] = [];
    const updatePayloads: unknown[] = [];

    await expect(
      executeCronEditMutation({
        cronEditingCronJobId: null,
        draft: draft(),
        loadCronJobs: async () => {
          calls.push("reload-create");
        },
        newCron: async (payload) => {
          createPayloads.push(payload);
          calls.push("create");
        },
        updateCron: async (payload) => {
          updatePayloads.push(payload);
          calls.push("unexpected-update");
        },
      }),
    ).resolves.toBe("created");

    await expect(
      executeCronEditMutation({
        cronEditingCronJobId: 42,
        draft: draft({ cronEditEnabled: false }),
        loadCronJobs: async () => {
          calls.push("reload-update");
        },
        newCron: async (payload) => {
          createPayloads.push(payload);
          calls.push("unexpected-create");
        },
        updateCron: async (payload) => {
          updatePayloads.push(payload);
          calls.push("update");
        },
      }),
    ).resolves.toBe("updated");

    expect(calls).toEqual([
      "create",
      "reload-create",
      "update",
      "reload-update",
    ]);
    expect(createPayloads).toHaveLength(1);
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({ cronJobId: 42, enabled: false }),
    );
  });

  it("surfaces validation and mocked mutation failures without reloading", async () => {
    expect(() =>
      buildCronEditMutationPayload(draft({ cronEditSchedule: "   " })),
    ).toThrow("Cron schedule is required.");

    let reloaded = false;
    await expect(
      executeCronEditMutation({
        cronEditingCronJobId: null,
        draft: draft(),
        loadCronJobs: async () => {
          reloaded = true;
        },
        newCron: async () => {
          throw new Error("create failed");
        },
        updateCron: async () => undefined,
      }),
    ).rejects.toThrow("create failed");
    expect(reloaded).toBeFalse();
  });

  it("runs a cron now, opens the thread, reloads, and clears busy state", async () => {
    const calls: string[] = [];
    let running = false;

    await expect(
      executeCronRunNowMutation({
        cronJobId: 42,
        isCurrentRequest: () => true,
        loadCronJobs: async () => {
          calls.push("reload");
        },
        markNotRunning: () => {
          running = false;
          calls.push("not-running");
        },
        markRunning: () => {
          running = true;
          calls.push("running");
        },
        openCronThreadInRecent: async (threadId) => {
          calls.push(`open:${threadId}`);
        },
        runCronNow: async (payload) => {
          calls.push(`run:${payload.cronJobId}`);
          return { success: true, threadId: 99 };
        },
        setCronJobsError: (message) => {
          calls.push(`error:${message}`);
        },
      }),
    ).resolves.toBe("started");

    expect(running).toBeFalse();
    expect(calls).toEqual([
      "running",
      "error:",
      "run:42",
      "open:99",
      "reload",
      "not-running",
    ]);
  });

  it("guards stale run-now requests after start and still clears busy state", async () => {
    const calls: string[] = [];
    let current = true;
    let running = false;

    await expect(
      executeCronRunNowMutation({
        cronJobId: 42,
        isCurrentRequest: () => current,
        loadCronJobs: async () => {
          calls.push("unexpected-reload");
        },
        markNotRunning: () => {
          running = false;
          calls.push("not-running");
        },
        markRunning: () => {
          running = true;
          calls.push("running");
        },
        openCronThreadInRecent: async () => {
          calls.push("unexpected-open");
        },
        runCronNow: async () => {
          current = false;
          calls.push("run");
          return { success: true, threadId: 99 };
        },
        setCronJobsError: (message) => {
          calls.push(`error:${message}`);
        },
      }),
    ).resolves.toBe("stale");

    expect(running).toBeFalse();
    expect(calls).toEqual(["running", "error:", "run", "not-running"]);
  });

  it("surfaces run-now failures without opening or reloading and clears busy state", async () => {
    const calls: string[] = [];
    let running = false;

    await expect(
      executeCronRunNowMutation({
        cronJobId: 42,
        isCurrentRequest: () => true,
        loadCronJobs: async () => {
          calls.push("unexpected-reload");
        },
        markNotRunning: () => {
          running = false;
          calls.push("not-running");
        },
        markRunning: () => {
          running = true;
          calls.push("running");
        },
        openCronThreadInRecent: async () => {
          calls.push("unexpected-open");
        },
        runCronNow: async () => ({ success: false, threadId: 0 }),
        setCronJobsError: (message) => {
          calls.push(`error:${message}`);
        },
      }),
    ).rejects.toThrow("Cron job 42 did not start.");

    expect(running).toBeFalse();
    expect(calls).toEqual([
      "running",
      "error:",
      "error:Cron job 42 did not start.",
      "not-running",
    ]);
  });

  it("deletes a cron, closes the editor, reloads, and clears busy state", async () => {
    const calls: string[] = [];
    let deleting = false;

    await expect(
      executeCronDeleteMutation({
        closeCronCreatorIfEditing: (cronJobId) => {
          calls.push(`close:${cronJobId}`);
        },
        cronJob: { id: 42 },
        isCurrentRequest: () => true,
        loadCronJobs: () => {
          calls.push("reload");
        },
        markDeleting: () => {
          deleting = true;
          calls.push("deleting");
        },
        markNotDeleting: () => {
          deleting = false;
          calls.push("not-deleting");
        },
        removeCronJob: (cronJobId) => {
          calls.push(`remove:${cronJobId}`);
        },
        setCronJobsError: (message) => {
          calls.push(`error:${message}`);
        },
        updateCron: async (payload) => {
          calls.push(`delete:${payload.cronJobId}:${payload.deleted}`);
        },
      }),
    ).resolves.toBe("deleted");

    expect(deleting).toBeFalse();
    expect(calls).toEqual([
      "deleting",
      "error:",
      "delete:42:true",
      "remove:42",
      "close:42",
      "reload",
      "not-deleting",
    ]);
  });

  it("guards stale delete-confirm success and delete failures", async () => {
    const staleCalls: string[] = [];
    let current = true;

    await expect(
      executeCronDeleteMutation({
        closeCronCreatorIfEditing: () => staleCalls.push("unexpected-close"),
        cronJob: { id: 42 },
        isCurrentRequest: () => current,
        loadCronJobs: () => {
          staleCalls.push("unexpected-reload");
        },
        markDeleting: () => staleCalls.push("deleting"),
        markNotDeleting: () => staleCalls.push("not-deleting"),
        removeCronJob: () => staleCalls.push("unexpected-remove"),
        setCronJobsError: (message) => staleCalls.push(`error:${message}`),
        updateCron: async () => {
          current = false;
          staleCalls.push("delete");
        },
      }),
    ).resolves.toBe("stale");
    expect(staleCalls).toEqual([
      "deleting",
      "error:",
      "delete",
      "not-deleting",
    ]);

    const failureCalls: string[] = [];
    await expect(
      executeCronDeleteMutation({
        closeCronCreatorIfEditing: () => failureCalls.push("unexpected-close"),
        cronJob: { id: 7 },
        isCurrentRequest: () => true,
        loadCronJobs: () => {
          failureCalls.push("unexpected-reload");
        },
        markDeleting: () => failureCalls.push("deleting"),
        markNotDeleting: () => failureCalls.push("not-deleting"),
        removeCronJob: () => failureCalls.push("unexpected-remove"),
        setCronJobsError: (message) => failureCalls.push(`error:${message}`),
        updateCron: async () => {
          throw new Error("delete failed");
        },
      }),
    ).rejects.toThrow("delete failed");
    expect(failureCalls).toEqual([
      "deleting",
      "error:",
      "error:delete failed",
      "not-deleting",
    ]);
  });
});
