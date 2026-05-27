import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeAppDatabase,
  ensureProjectWorktreeVisible,
  initAppDatabase,
  resetResolvedAppDataDirectory,
  upsertProject,
} from "../db";
import { getPluginsDirectoryPath } from "../plugin/discovery";
import { consumePluginIngressLinkCode } from "../plugin/ingress-store";
import { runPluginLifecycleAction } from "../plugin/lifecycle";
import type { RpcRequestContext } from "../rpc-schema";
import {
  createPluginIngressLinkCodeProcedure,
  deletePluginIngressExternalBindingProcedure,
  listPluginIngressExternalBindingsProcedure,
  listPluginIngressSourcesProcedure,
  setPluginIngressExternalBindingEnabledProcedure,
  upsertPluginIngressRouteConfigProcedure,
} from "./plugin-procedures";

const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
const tempDirectories = new Set<string>();

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-plugin-ingress-rpc-"));
  tempDirectories.add(path);
  return path;
}

function useTempAppData(): string {
  closeAppDatabase();
  const appDataDir = createTempDirectory();
  process.env.METIDOS_APP_DATA_DIR = appDataDir;
  resetResolvedAppDataDirectory();
  return appDataDir;
}

function writeTestPlugin(appDataDir: string, directoryName: string): void {
  const pluginPath = join(
    getPluginsDirectoryPath({ appDataDir }),
    directoryName,
  );
  mkdirSync(pluginPath, { recursive: true });
  writeFileSync(
    join(pluginPath, "metidos-plugin.json"),
    `${JSON.stringify({
      id: directoryName,
      name: "Chat Plugin",
      description: "Test chat plugin.",
      version: "1.0.0",
      metidosApiVersion: "v1",
      main: "./index.ts",
      permissions: ["plugin:request-ingress"],
      ingressSources: [
        {
          id: "dm",
          name: "Direct messages",
          description: "External direct messages",
        },
      ],
    })}\n`,
  );
  writeFileSync(join(pluginPath, "AGENTS.md"), "# Test plugin\n");
  writeFileSync(join(pluginPath, "index.ts"), "export default {};\n");
}

async function approveTestPlugin(
  appDataDir: string,
  directoryName: string,
): Promise<void> {
  await runPluginLifecycleAction(
    { action: "enable", directoryName },
    {
      appDataDir,
      now: () => new Date("2026-05-08T18:00:00.000Z"),
      username: "admin",
    },
  );
}

function contextFor(input: {
  isAdmin?: boolean;
  userId: number;
  username: string;
}): RpcRequestContext {
  return {
    auth: {
      isAdmin: input.isAdmin === true,
      sessionId: `session-${input.userId}`,
      userId: input.userId,
      username: input.username,
    },
    priority: "foreground",
    signal: new AbortController().signal,
    timeoutMs: null,
  };
}

afterEach(() => {
  closeAppDatabase();
  if (originalAppDataDir === undefined) {
    delete process.env.METIDOS_APP_DATA_DIR;
  } else {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  }
  resetResolvedAppDataDirectory();
  for (const directory of tempDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("plugin ingress binding procedures", () => {
  it("lists active ingress sources for authenticated local sessions without plugin inventory access", async () => {
    const appDataDir = useTempAppData();
    writeTestPlugin(appDataDir, "chat_plugin");
    await approveTestPlugin(appDataDir, "chat_plugin");
    initAppDatabase();
    const context = contextFor({ userId: 1, username: "owner" });

    const sources = await listPluginIngressSourcesProcedure(undefined, context);

    expect(sources).toEqual([
      {
        pluginId: "chat_plugin",
        pluginName: "Chat Plugin",
        source: {
          id: "dm",
          name: "Direct messages",
          description: "External direct messages",
          pollIntervalMs: null,
          timeoutMs: null,
          supportsReplyToSource: false,
        },
      },
    ]);
  });

  it("creates short-lived link codes and lets users manage their bindings", async () => {
    useTempAppData();
    const database = initAppDatabase();
    const context = contextFor({ userId: 1, username: "owner" });

    const linkCode = await createPluginIngressLinkCodeProcedure(
      { pluginId: "chat-plugin", sourceId: "dm" },
      context,
    );

    expect(linkCode).toMatchObject({
      pluginId: "chat-plugin",
      sourceId: "dm",
    });
    expect(linkCode.code).toMatch(/^[A-Z0-9]{8}$/);

    const consumed = consumePluginIngressLinkCode(database, {
      pluginId: "chat-plugin",
      sourceId: "dm",
      externalUserId: "external-user-1",
      code: linkCode.code,
    });
    if (!consumed.ok) throw new Error("Expected link code consumption.");

    const listed = await listPluginIngressExternalBindingsProcedure(
      undefined,
      context,
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      enabled: true,
      externalUserId: "external-user-1",
    });

    const disabled = await setPluginIngressExternalBindingEnabledProcedure(
      { enabled: false, id: listed[0]?.id ?? 0 },
      context,
    );
    expect(disabled.binding.enabled).toBe(false);
    expect(disabled.bindings[0]?.enabled).toBe(false);

    const removed = await deletePluginIngressExternalBindingProcedure(
      { id: listed[0]?.id ?? 0 },
      context,
    );
    expect(removed.binding.externalUserId).toBe("external-user-1");
    expect(removed.bindings).toEqual([]);
  });

  it("normalizes ingress route worktree paths through the workspace path policy", async () => {
    useTempAppData();
    const database = initAppDatabase();
    const projectPath = createTempDirectory();
    const project = upsertProject(database, {
      name: "Ingress Project",
      projectPath,
    });
    const context = contextFor({ userId: 1, username: "owner" });

    const result = await upsertPluginIngressRouteConfigProcedure(
      {
        enabled: true,
        model: null,
        permissions: [],
        pluginId: "chat-plugin",
        projectId: project.id,
        sourceId: "dm",
        worktreePath: join(projectPath, "."),
      },
      context,
    );

    expect(result.worktreePath).toBe(project.path);
  });

  it("rejects ingress route worktree paths that are not tracked after policy normalization", async () => {
    useTempAppData();
    const database = initAppDatabase();
    const projectPath = createTempDirectory();
    const project = upsertProject(database, {
      name: "Ingress Project",
      projectPath,
    });
    const worktreePath = join(projectPath, "feature");
    ensureProjectWorktreeVisible(database, project.id, worktreePath);
    const context = contextFor({ userId: 1, username: "owner" });

    await expect(
      upsertPluginIngressRouteConfigProcedure(
        {
          enabled: true,
          model: null,
          permissions: [],
          pluginId: "chat-plugin",
          projectId: project.id,
          sourceId: "dm",
          worktreePath: join(worktreePath, "..", "untracked"),
        },
        context,
      ),
    ).rejects.toThrow(
      "Ingress route worktree is not tracked for this project.",
    );
  });

  it("allows any authenticated local session to mutate ingress bindings", async () => {
    useTempAppData();
    const database = initAppDatabase();
    const ownerContext = contextFor({
      userId: 1,
      username: "owner",
    });
    const otherContext = contextFor({
      userId: 2,
      username: "other",
    });
    const linkCode = await createPluginIngressLinkCodeProcedure(
      { pluginId: "chat-plugin", sourceId: "dm" },
      ownerContext,
    );
    const consumed = consumePluginIngressLinkCode(database, {
      pluginId: "chat-plugin",
      sourceId: "dm",
      externalUserId: "external-user-1",
      code: linkCode.code,
    });
    if (!consumed.ok) throw new Error("Expected link code consumption.");

    const updated = await setPluginIngressExternalBindingEnabledProcedure(
      { enabled: false, id: consumed.binding.id },
      otherContext,
    );
    expect(updated.binding.enabled).toBe(false);
  });
});
