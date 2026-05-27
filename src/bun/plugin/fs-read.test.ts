/**
 * @file src/bun/plugin/fs-read.test.ts
 * @description Focused tests for Plugin System v1 metidos.fs read APIs.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type PluginCallbackContextKind, PluginContextError } from "./context";
import {
  type PluginFsReadContext,
  MAX_PLUGIN_FS_GLOB_RESULTS,
  MAX_PLUGIN_FS_READ_BYTES,
  PluginFsReadError,
  pluginFsExists,
  pluginFsRead,
  pluginFsGlob,
  pluginFsLs,
  pluginFsReadText,
  pluginFsStat,
} from "./fs-read";

const tempDirectories = new Set<string>();
const STORAGE_CALLBACK_CONTEXT_KINDS = [
  "threadTool",
  "cron",
  "gc",
  "init",
  "providerConfig",
  "providerExecution",
  "notificationProvider",
] as const satisfies readonly PluginCallbackContextKind[];
const NON_THREAD_CALLBACK_CONTEXT_KINDS = STORAGE_CALLBACK_CONTEXT_KINDS.filter(
  (contextKind) => contextKind !== "threadTool",
);

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

function createFixture(): {
  context: PluginFsReadContext;
  pluginPath: string;
  projectPath: string;
} {
  const rootPath = createTempDirectory("metidos-plugin-fs-read-");
  const pluginPath = join(rootPath, "plugins", "demo_plugin");
  const projectPath = join(rootPath, "worktree");
  mkdirSync(join(pluginPath, ".data", "notes"), { recursive: true });
  mkdirSync(join(projectPath, "src", "nested"), { recursive: true });
  mkdirSync(join(projectPath, "secret"), { recursive: true });
  writeFileSync(join(pluginPath, ".data", "notes", "a.txt"), "alpha\n");
  writeFileSync(join(pluginPath, ".data", "notes", "b.bin"), "beta");
  writeFileSync(join(projectPath, "src", "allowed.txt"), "allowed\n");
  writeFileSync(join(projectPath, "src", "nested", "also.txt"), "nested\n");
  writeFileSync(join(projectPath, "secret", "hidden.txt"), "hidden\n");
  return {
    context: {
      contextKind: "threadTool",
      filesReadAllowlist: ["./src/**"],
      permissions: ["storage:read", "files:read"],
      pluginPath,
      projectRootPath: projectPath,
    },
    pluginPath,
    projectPath,
  };
}

async function expectPluginFsReadError(
  operation: Promise<unknown>,
): Promise<PluginFsReadError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PluginFsReadError);
    return error as PluginFsReadError;
  }
  throw new Error("Expected plugin fs read operation to fail.");
}

async function expectPluginContextError(
  operation: Promise<unknown>,
): Promise<PluginContextError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PluginContextError);
    return error as PluginContextError;
  }
  throw new Error("Expected plugin context operation to fail.");
}

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("plugin fs read APIs", () => {
  it("reads and stats plugin-owned ~/ data with storage:read", async () => {
    const { context } = createFixture();

    for (const contextKind of STORAGE_CALLBACK_CONTEXT_KINDS) {
      await expect(
        pluginFsReadText({ ...context, contextKind }, "~/notes/a.txt"),
      ).resolves.toBe("alpha\n");
    }

    await expect(pluginFsReadText(context, "~/notes/a.txt")).resolves.toBe(
      "alpha\n",
    );
    await expect(pluginFsExists(context, "~/notes/missing.txt")).resolves.toBe(
      false,
    );
    await expect(pluginFsStat(context, "~/notes/a.txt")).resolves.toMatchObject(
      {
        kind: "file",
        size: 6,
        virtualPath: "~/notes/a.txt",
      },
    );
    await expect(pluginFsLs(context, "~/notes")).resolves.toEqual([
      { kind: "file", name: "a.txt", virtualPath: "~/notes/a.txt" },
      { kind: "file", name: "b.bin", virtualPath: "~/notes/b.bin" },
    ]);
  });

  it("rejects plugin fs reads above the fixed byte ceiling", async () => {
    const { context, pluginPath } = createFixture();
    writeFileSync(
      join(pluginPath, ".data", "notes", "large.bin"),
      Buffer.alloc(MAX_PLUGIN_FS_READ_BYTES + 1),
    );

    const error = await expectPluginFsReadError(
      pluginFsRead(context, "~/notes/large.bin"),
    );

    expect(error).toMatchObject({
      code: "read_failed",
      message: `Plugin fs read is limited to ${MAX_PLUGIN_FS_READ_BYTES} bytes.`,
      virtualPath: "~/notes/large.bin",
    });
  });

  it("requires storage:read for all read APIs", async () => {
    const { context } = createFixture();
    const error = await expectPluginFsReadError(
      pluginFsReadText(
        {
          ...context,
          permissions: ["files:read"],
        },
        "~/notes/a.txt",
      ),
    );

    expect(error).toMatchObject({
      code: "permission_denied",
      message: "Plugin fs reads require storage:read permission.",
      virtualPath: "~/notes/a.txt",
    });
    expect(error.message).not.toContain(context.pluginPath);
  });

  it("requires thread tool context and files.allow.read coverage for ./ reads", async () => {
    const { context, projectPath } = createFixture();

    await expect(pluginFsExists(context, "./src/allowed.txt")).resolves.toBe(
      true,
    );
    await expect(pluginFsExists(context, "./src/missing.txt")).resolves.toBe(
      false,
    );
    await expect(pluginFsReadText(context, "./src/allowed.txt")).resolves.toBe(
      "allowed\n",
    );

    for (const contextKind of NON_THREAD_CALLBACK_CONTEXT_KINDS) {
      const missingContext = await expectPluginContextError(
        pluginFsReadText(
          {
            ...context,
            contextKind,
          },
          "./src/allowed.txt",
        ),
      );
      expect(missingContext).toMatchObject({
        code: "project_context_unavailable",
        contextKind,
        virtualPath: "./src/allowed.txt",
      });
      expect(missingContext.message).not.toContain(projectPath);
    }

    const denied = await expectPluginFsReadError(
      pluginFsReadText(context, "./secret/hidden.txt"),
    );
    expect(denied).toMatchObject({
      code: "permission_denied",
      message: "Plugin fs ./ read path is not covered by files.allow.read.",
      virtualPath: "./secret/hidden.txt",
    });
    expect(denied.message).not.toContain(projectPath);
  });

  it("returns only virtual allowed paths from project glob results", async () => {
    const { context, projectPath } = createFixture();

    await expect(pluginFsGlob(context, "./**/*.txt")).resolves.toEqual([
      "./src/allowed.txt",
      "./src/nested/also.txt",
    ]);

    const results = await pluginFsGlob(context, "./**/*.txt");
    expect(results.every((result) => result.startsWith("./"))).toBe(true);
    expect(results.join("\n")).not.toContain(projectPath);
    expect(results.join("\n")).not.toContain("secret");
  });

  it("rejects plugin fs glob results above the fixed result ceiling", async () => {
    const { context, pluginPath } = createFixture();
    const manyPath = join(pluginPath, ".data", "many");
    mkdirSync(manyPath, { recursive: true });
    for (let index = 0; index <= MAX_PLUGIN_FS_GLOB_RESULTS; index += 1) {
      writeFileSync(
        join(manyPath, `${index.toString().padStart(5, "0")}.txt`),
        "x",
      );
    }

    const error = await expectPluginFsReadError(
      pluginFsGlob(context, "~/many/*.txt"),
    );

    expect(error).toMatchObject({
      code: "read_failed",
      message: `Plugin fs glob results are limited to ${MAX_PLUGIN_FS_GLOB_RESULTS} paths.`,
      virtualPath: "~/many/*.txt",
    });
  });

  it("applies manifest read denylists after broad allowlists", async () => {
    const { context } = createFixture();
    const broadContext: PluginFsReadContext = {
      ...context,
      filesReadAllowlist: ["./**"],
      filesReadDenylist: ["./secret/**"],
    };

    await expect(
      pluginFsReadText(broadContext, "./src/allowed.txt"),
    ).resolves.toBe("allowed\n");
    await expect(pluginFsGlob(broadContext, "./**/*.txt")).resolves.toEqual([
      "./src/allowed.txt",
      "./src/nested/also.txt",
    ]);
    const denied = await expectPluginFsReadError(
      pluginFsReadText(broadContext, "./secret/hidden.txt"),
    );
    expect(denied).toMatchObject({
      code: "permission_denied",
      message: "Plugin fs ./ read path is denied by files.deny.read.",
      virtualPath: "./secret/hidden.txt",
    });
  });

  it("filters ls entries and symlink escapes through allowlists and containment", async () => {
    const { context, pluginPath, projectPath } = createFixture();
    symlinkSync(
      join(projectPath, "secret"),
      join(projectPath, "src", "secret-link"),
      "dir",
    );
    symlinkSync(
      join(pluginPath, ".data", "notes", "a.txt"),
      join(projectPath, "src", "note-link.txt"),
      "file",
    );

    await expect(pluginFsLs(context, "./")).resolves.toEqual([
      { kind: "directory", name: "src", virtualPath: "./src" },
    ]);
    await expect(pluginFsGlob(context, "./src/**/*.txt")).resolves.toEqual([
      "./src/allowed.txt",
      "./src/nested/also.txt",
    ]);
  });

  it("keeps hard-denied project directories out of ls and glob results", async () => {
    const { context, projectPath } = createFixture();
    mkdirSync(join(projectPath, ".git"), { recursive: true });
    mkdirSync(join(projectPath, ".ssh"), { recursive: true });
    writeFileSync(join(projectPath, ".git", "config"), "[core]\n");
    writeFileSync(join(projectPath, ".ssh", "id_rsa"), "private\n");

    const broadContext: PluginFsReadContext = {
      ...context,
      filesReadAllowlist: ["./**"],
    };

    await expect(pluginFsLs(broadContext, "./")).resolves.toEqual([
      { kind: "directory", name: "secret", virtualPath: "./secret" },
      { kind: "directory", name: "src", virtualPath: "./src" },
    ]);
    await expect(pluginFsGlob(broadContext, "./**/*.txt")).resolves.toEqual([
      "./secret/hidden.txt",
      "./src/allowed.txt",
      "./src/nested/also.txt",
    ]);

    try {
      await pluginFsReadText(broadContext, "./.git/config");
      throw new Error("Expected hard-denied project path to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "forbidden_directory",
        virtualPath: "./.git/config",
      });
      expect((error as Error).message).not.toContain(projectPath);
    }
  });

  it("rejects invalid glob traversal without leaking host paths", async () => {
    const { context, projectPath } = createFixture();

    const error = await expectPluginFsReadError(
      pluginFsGlob(context, "./src/../secret/*.txt"),
    );

    expect(error).toMatchObject({
      code: "invalid_glob_pattern",
      message: "Plugin fs glob traversal is denied.",
      virtualPath: "./src/../secret/*.txt",
    });
    expect(error.message).not.toContain(projectPath);
  });
});
