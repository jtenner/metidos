/**
 * @file src/mainview/app/mainview-cron-workspace-controller.test.ts
 * @description Tests for cron workspace controller mutation helpers.
 */

import { describe, expect, it } from "bun:test";

import type { RpcReasoningEffort } from "../../bun/rpc-schema";
import {
  buildCronEditMutationPayload,
  describeCronEditorMutationState,
  executeCronEditMutation,
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
});
