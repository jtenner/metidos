/**
 * @file src/bun/project-procedures.notifications.test.ts
 * @description Regression tests for Metidos notification tool delivery semantics.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeAppDatabase,
  initAppDatabase,
  resetResolvedAppDataDirectory,
} from "./db";
import { listUserNotificationDeliveries } from "./user-notifications";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;

type ProjectProceduresModule = typeof import("./project-procedures");

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-notifications-"));
  tempDirectories.add(path);
  return path;
}

async function loadProjectProcedures(): Promise<ProjectProceduresModule> {
  return (await import(
    `./project-procedures?notifications=${Date.now()}-${Math.random()}`
  )) as ProjectProceduresModule;
}

beforeEach(() => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  process.env.METIDOS_APP_DATA_DIR = createTempDirectory();
});

afterEach(() => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  if (typeof originalAppDataDir === "string") {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.METIDOS_APP_DATA_DIR;
  }
  for (const path of tempDirectories) {
    rmSync(path, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("Metidos notification tool delivery", () => {
  it("treats the local inbox as successful delivery when provider runtime is absent", async () => {
    const { createPiMetidosToolHost } = await loadProjectProcedures();
    const host = createPiMetidosToolHost(1);

    const result = await host.notifyUser?.({
      body: "The build finished.",
      clickUrl: null,
      priority: "low",
      sourceThreadId: 123,
      sourceType: "ai_tool",
      tags: ["build"],
      title: "Build done",
    });

    expect(result).toMatchObject({
      lastError: null,
      message:
        "Recorded in Metidos inbox #1. External notification provider runtime is not available.",
      receipts: [],
      status: "delivered",
    });
    expect(listUserNotificationDeliveries(initAppDatabase())).toMatchObject([
      {
        body: "The build finished.",
        pluginId: "metidos",
        status: "sent",
        tagsJson: '["build"]',
        title: "Build done",
        userId: 1,
      },
    ]);
  });

  it("treats missing external provider receipts as a non-error local delivery", async () => {
    const { createPiMetidosToolHost, setPiPluginSidecarManager } =
      await loadProjectProcedures();
    const dispatches: unknown[] = [];
    setPiPluginSidecarManager({
      dispatchPluginNotificationProviders: async (input: unknown) => {
        dispatches.push(input);
        return [];
      },
    } as unknown as Parameters<typeof setPiPluginSidecarManager>[0]);
    const host = createPiMetidosToolHost(1);

    const result = await host.notifyUser?.({
      body: "The report is ready.",
      clickUrl: null,
      priority: "default",
      sourceThreadId: 456,
      sourceType: "ai_tool",
      tags: [],
      title: "Report ready",
    });

    expect(result).toMatchObject({
      deliveryId: 1,
      lastError: null,
      message:
        "Recorded in Metidos inbox #1. No external notification provider receipts were returned.",
      receipts: [],
      status: "delivered",
    });
    expect(dispatches).toHaveLength(1);
  });
});
