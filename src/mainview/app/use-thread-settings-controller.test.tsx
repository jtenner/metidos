import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type {
  ProjectProcedures,
  RpcReasoningEffort,
  RpcThread,
} from "../../bun/rpc-schema";
import type { ThreadAccessValue } from "../controls/thread-access-control";
import {
  type ThreadSettingsController,
  useThreadSettingsController,
} from "./use-thread-settings-controller";

const BASE_ACCESS_VALUE: ThreadAccessValue = {
  agentsAccess: false,
  gitAccess: false,
  githubAccess: false,
  metidosAccess: false,
  sqliteAccess: false,
  unsafeMode: false,
  webSearchAccess: false,
};

function thread(overrides: Partial<RpcThread> = {}): RpcThread {
  return {
    id: 11,
    model: "openai/gpt-4.1",
    permissions: [],
    pluginAccessGroups: [],
    projectId: 7,
    reasoningEffort: "medium",
    runStatus: {
      error: null,
      hasUnreadError: false,
      startedAt: null,
      state: "idle",
      updatedAt: null,
    },
    updatedAt: "2026-06-03T00:00:00.000Z",
    worktreePath: "/repo",
    ...overrides,
  } as RpcThread;
}

function accessValue(permissions: string[]): ThreadAccessValue {
  return {
    ...BASE_ACCESS_VALUE,
    gitAccess: permissions.includes("metidos:git"),
    permissions,
  };
}

function renderController(input?: {
  isUpdatingThreadAccess?: boolean;
  isUpdatingThreadModel?: boolean;
  isUpdatingThreadReasoningEffort?: boolean;
  procedures?: Partial<ProjectProcedures>;
  selectedThread?: RpcThread | null;
  selectedThreadIdRef?: { current: number | null };
}): {
  controller: ThreadSettingsController;
  readState: () => {
    accessError: string;
    modelError: string;
    pendingAccess: ThreadAccessValue | null;
    pendingModel: string;
    pendingReasoningEffort: RpcReasoningEffort;
    reasoningEffortError: string;
    upsertedThreads: RpcThread[];
    updatingAccessCalls: boolean[];
    updatingModelCalls: boolean[];
    updatingReasoningEffortCalls: boolean[];
  };
  selectedThreadIdRef: { current: number | null };
} {
  let controller: ThreadSettingsController | null = null;
  let accessError = "";
  let modelError = "";
  let pendingAccess: ThreadAccessValue | null = null;
  let pendingModel = "";
  let pendingReasoningEffort: RpcReasoningEffort = "medium";
  let reasoningEffortError = "";
  const selectedThread =
    input && "selectedThread" in input ? input.selectedThread : thread();
  const selectedThreadIdRef = input?.selectedThreadIdRef ?? {
    current: selectedThread?.id ?? null,
  };
  const updatingAccessCalls: boolean[] = [];
  const updatingModelCalls: boolean[] = [];
  const updatingReasoningEffortCalls: boolean[] = [];
  const upsertedThreads: RpcThread[] = [];

  function TestHarness(): null {
    controller = useThreadSettingsController({
      availablePluginAccessGroups: [],
      availableThreadPermissionDescriptors: [
        {
          accessId: "git",
          category: "builtin",
          defaultEnabled: false,
          description: "Git access",
          id: "metidos:git",
          label: "Git",
          order: 0,
          providerDescription: "Metidos",
          providerId: "metidos",
          requiresApproval: false,
          unsafe: false,
        },
      ],
      defaultCodexModel: "openai/gpt-4.1-mini",
      defaultCodexReasoningEffort: "low",
      isUpdatingThreadAccess: input?.isUpdatingThreadAccess ?? false,
      isUpdatingThreadModel: input?.isUpdatingThreadModel ?? false,
      isUpdatingThreadReasoningEffort:
        input?.isUpdatingThreadReasoningEffort ?? false,
      procedures: {
        updateThreadAccess: async ({ permissions }) =>
          thread({ permissions, updatedAt: "2026-06-03T00:01:00.000Z" }),
        updateThreadModel: async ({ model }) =>
          thread({ model, updatedAt: "2026-06-03T00:01:00.000Z" }),
        updateThreadReasoningEffort: async ({ reasoningEffort }) =>
          thread({
            reasoningEffort,
            updatedAt: "2026-06-03T00:01:00.000Z",
          }),
        ...input?.procedures,
      } as ProjectProcedures,
      selectedThread,
      selectedThreadIdRef,
      setIsUpdatingThreadAccess: (value) => {
        updatingAccessCalls.push(Boolean(value));
      },
      setIsUpdatingThreadModel: (value) => {
        updatingModelCalls.push(Boolean(value));
      },
      setIsUpdatingThreadReasoningEffort: (value) => {
        updatingReasoningEffortCalls.push(Boolean(value));
      },
      setModelControlError: (value) => {
        modelError = typeof value === "function" ? value(modelError) : value;
      },
      setPendingThreadAccessValue: (value) => {
        pendingAccess = value;
      },
      setPendingThreadModel: (value) => {
        pendingModel =
          typeof value === "function" ? value(pendingModel) : value;
      },
      setPendingThreadReasoningEffort: (value) => {
        pendingReasoningEffort =
          typeof value === "function" ? value(pendingReasoningEffort) : value;
      },
      setReasoningEffortControlError: (value) => {
        reasoningEffortError =
          typeof value === "function" ? value(reasoningEffortError) : value;
      },
      setThreadAccessControlError: (value) => {
        accessError = typeof value === "function" ? value(accessError) : value;
      },
      upsertThread: (updatedThread) => {
        upsertedThreads.push(updatedThread);
      },
    });
    return null;
  }

  renderToString(<TestHarness />);
  if (!controller) {
    throw new Error("Expected test harness to expose controller.");
  }

  return {
    controller,
    readState: () => ({
      accessError,
      modelError,
      pendingAccess,
      pendingModel,
      pendingReasoningEffort,
      reasoningEffortError,
      upsertedThreads,
      updatingAccessCalls,
      updatingModelCalls,
      updatingReasoningEffortCalls,
    }),
    selectedThreadIdRef,
  };
}

describe("useThreadSettingsController", () => {
  it("updates draft model locally without issuing an RPC before a Thread is selected", async () => {
    let rpcCalls = 0;
    const { controller, readState } = renderController({
      procedures: {
        updateThreadModel: async () => {
          rpcCalls += 1;
          return thread();
        },
      },
      selectedThread: null,
      selectedThreadIdRef: { current: null },
    });

    await expect(
      controller.updateActiveCodexModel("openai/gpt-5-mini"),
    ).resolves.toBe(true);

    expect(rpcCalls).toBe(0);
    expect(readState()).toMatchObject({
      modelError: "",
      pendingModel: "openai/gpt-5-mini",
      updatingModelCalls: [],
    });
  });

  it("upserts successful reasoning-effort changes and refreshes the selected draft value", async () => {
    const { controller, readState } = renderController();

    await expect(controller.updateActiveReasoningEffort("high")).resolves.toBe(
      true,
    );

    expect(readState().upsertedThreads).toHaveLength(1);
    expect(readState()).toMatchObject({
      pendingReasoningEffort: "high",
      reasoningEffortError: "",
      updatingReasoningEffortCalls: [true, false],
    });
  });

  it("keeps stale model failures from overwriting a newly selected Thread", async () => {
    const { controller, readState, selectedThreadIdRef } = renderController({
      procedures: {
        updateThreadModel: async () => {
          selectedThreadIdRef.current = 99;
          throw new Error("provider unavailable");
        },
      },
    });

    await expect(
      controller.updateActiveCodexModel("openai/gpt-5"),
    ).resolves.toBe(false);

    expect(readState()).toMatchObject({
      modelError: "",
      pendingModel: "openai/gpt-5",
      updatingModelCalls: [true, false],
    });
  });

  it("sanitizes stale access permissions before updating a selected Thread", async () => {
    const receivedPermissions: string[][] = [];
    const { controller, readState } = renderController({
      procedures: {
        updateThreadAccess: async ({ permissions }) => {
          receivedPermissions.push(permissions);
          return thread({ permissions });
        },
      },
    });

    await controller.updateActiveThreadAccess(
      accessValue(["metidos:git", "stale-plugin:tool"]),
    );

    expect(receivedPermissions).toEqual([["metidos:git"]]);
    expect(readState().pendingAccess).toMatchObject({
      gitAccess: true,
      permissions: ["metidos:git"],
    });
    expect(readState().updatingAccessCalls).toEqual([true, false]);
  });
});
