/**
 * @file src/mainview/app/persisted-mainview-state.test.ts
 * @description Tests for persisted Mainview browser storage helpers.
 */

import { afterEach, describe, expect, it } from "bun:test";

import {
  defaultPersistedMainviewState,
  MAINVIEW_STATE_STORAGE_KEY,
  MAINVIEW_STATE_STORAGE_VERSION,
  readPersistedMainviewState,
  readPersistedTreeViewState,
  TREE_VIEW_STATE_STORAGE_KEY,
  TREE_VIEW_STATE_STORAGE_VERSION,
  writePersistedMainviewState,
} from "./persisted-mainview-state";

type StorageRecord = Record<string, string>;

function installWindowStorage(
  initialEntries: StorageRecord = {},
): StorageRecord {
  const entries: StorageRecord = { ...initialEntries };
  const localStorage = {
    getItem(key: string): string | null {
      return Object.hasOwn(entries, key) ? (entries[key] ?? null) : null;
    },
    setItem(key: string, value: string): void {
      entries[key] = value;
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });

  return entries;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("persisted mainview state", () => {
  it("normalizes selected context, permissions, and open worktrees", () => {
    installWindowStorage({
      [MAINVIEW_STATE_STORAGE_KEY]: JSON.stringify({
        version: MAINVIEW_STATE_STORAGE_VERSION,
        selectedProjectId: 3,
        selectedWorktreePath: "/repo",
        selectedThreadId: 9,
        pendingThreadModel: "model-a",
        pendingThreadReasoningEffort: "medium",
        pendingThreadPermissions: ["metidos:threads", "", "metidos:threads"],
        chatInput: "stale draft",
        sidebarCollapsed: true,
        sidebarSearchQuery: "agent",
        openWorktrees: [
          { projectId: 3, worktreePath: "/repo" },
          { projectId: 3, worktreePath: "/repo" },
          { projectId: -1, worktreePath: "/bad" },
          { projectId: 4, worktreePath: "" },
        ],
      }),
    });

    expect(readPersistedMainviewState()).toEqual({
      version: MAINVIEW_STATE_STORAGE_VERSION,
      selectedProjectId: 3,
      selectedWorktreePath: "/repo",
      selectedThreadId: 9,
      pendingThreadModel: "model-a",
      pendingThreadReasoningEffort: "medium",
      pendingThreadPermissions: ["metidos:threads"],
      chatInput: "",
      sidebarCollapsed: true,
      sidebarSearchQuery: "agent",
      openWorktrees: [{ projectId: 3, worktreePath: "/repo" }],
    });
  });

  it("serializes only durable mainview state fields", () => {
    const entries = installWindowStorage();
    writePersistedMainviewState({
      ...defaultPersistedMainviewState(),
      selectedProjectId: 5,
      chatInput: "do not persist drafts",
      pendingThreadUnsafeMode: true,
    });

    const stored = JSON.parse(entries[MAINVIEW_STATE_STORAGE_KEY] ?? "{}");
    expect(stored.selectedProjectId).toBe(5);
    expect(stored.chatInput).toBeUndefined();
    expect(stored.pendingThreadUnsafeMode).toBeUndefined();
  });
});

describe("persisted tree view state", () => {
  it("normalizes sidebar expansion defaults and open project paths", () => {
    installWindowStorage({
      [TREE_VIEW_STATE_STORAGE_KEY]: JSON.stringify({
        version: TREE_VIEW_STATE_STORAGE_VERSION,
        foldersSectionOpen: false,
        workspaceSectionOpen: true,
        workspaceActiveSectionOpen: false,
        projectsSectionOpen: true,
        threadsSectionOpen: false,
        gitSectionOpen: true,
        openProjectPaths: [" /repo ", "/repo", "", 42],
      }),
    });

    expect(readPersistedTreeViewState()).toEqual({
      version: TREE_VIEW_STATE_STORAGE_VERSION,
      foldersSectionOpen: false,
      workspaceSectionOpen: true,
      workspaceActiveSectionOpen: false,
      projectsSectionOpen: true,
      threadsSectionOpen: false,
      gitSectionOpen: true,
      openProjectPaths: ["/repo"],
    });
  });
});
