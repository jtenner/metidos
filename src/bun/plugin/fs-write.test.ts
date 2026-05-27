/**
 * @file src/bun/plugin/fs-write.test.ts
 * @description Focused tests for Plugin System v1 metidos.fs write and delete APIs.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type PluginCallbackContextKind, PluginContextError } from "./context";
import type { PluginDataQuotaSettings } from "./data";
import {
  type PluginFsWriteContext,
  PluginFsWriteError,
  pluginFsCopy,
  pluginFsMkdir,
  pluginFsMove,
  pluginFsRm,
  pluginFsRmdir,
  pluginFsWriteText,
} from "./fs-write";

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

const DEFAULT_TEST_QUOTA: PluginDataQuotaSettings = {
  maxDataBytes: 1024,
  maxFileBytes: 512,
  maxFiles: 20,
};

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

function createFixture(): {
  context: PluginFsWriteContext;
  pluginPath: string;
  projectPath: string;
} {
  const rootPath = createTempDirectory("metidos-plugin-fs-write-");
  const pluginPath = join(rootPath, "plugins", "demo_plugin");
  const projectPath = join(rootPath, "worktree");
  mkdirSync(join(pluginPath, ".data", "notes"), { recursive: true });
  mkdirSync(join(projectPath, "src", "nested"), { recursive: true });
  mkdirSync(join(projectPath, "tmp", "empty"), { recursive: true });
  writeFileSync(join(pluginPath, ".data", "notes", "source.txt"), "alpha");
  writeFileSync(join(projectPath, "src", "allowed.txt"), "allowed");
  writeFileSync(join(projectPath, "tmp", "delete.txt"), "remove");

  return {
    context: {
      contextKind: "threadTool",
      filesDeleteAllowlist: ["./tmp/**"],
      filesReadAllowlist: ["./src/**", "./tmp/**"],
      filesWriteAllowlist: ["./src/**", "./tmp/**"],
      permissions: [
        "storage:read",
        "storage:write",
        "storage:delete",
        "files:read",
        "files:write",
        "files:delete",
      ],
      pluginPath,
      projectRootPath: projectPath,
      quota: DEFAULT_TEST_QUOTA,
    },
    pluginPath,
    projectPath,
  };
}

async function expectPluginFsWriteError(
  operation: Promise<unknown>,
): Promise<PluginFsWriteError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PluginFsWriteError);
    return error as PluginFsWriteError;
  }
  throw new Error("Expected plugin fs write operation to fail.");
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

describe("plugin fs write APIs", () => {
  it("writes plugin-owned ~/ data with storage:write and quota enforcement", async () => {
    const { context, pluginPath } = createFixture();

    for (const contextKind of STORAGE_CALLBACK_CONTEXT_KINDS) {
      await pluginFsWriteText(
        { ...context, contextKind },
        `~/notes/${contextKind}.txt`,
        contextKind,
      );
      expect(
        readFileSync(
          join(pluginPath, ".data", "notes", `${contextKind}.txt`),
          "utf8",
        ),
      ).toBe(contextKind);
    }

    await pluginFsWriteText(context, "~/notes/new.txt", "hello");
    expect(
      readFileSync(join(pluginPath, ".data", "notes", "new.txt"), "utf8"),
    ).toBe("hello");

    const permissionError = await expectPluginFsWriteError(
      pluginFsWriteText(
        {
          ...context,
          permissions: ["storage:read"],
        },
        "~/notes/nope.txt",
        "nope",
      ),
    );
    expect(permissionError).toMatchObject({
      code: "permission_denied",
      message: "Plugin fs writes require storage:write permission.",
      virtualPath: "~/notes/nope.txt",
    });

    const quotaError = await expect(
      pluginFsWriteText(
        {
          ...context,
          quota: { ...DEFAULT_TEST_QUOTA, maxFileBytes: 4 },
        },
        "~/notes/too-large.txt",
        "12345",
      ),
    ).rejects.toMatchObject({
      code: "plugin_data_quota_exceeded",
    });
    expect(quotaError).toBeUndefined();
    expect(
      existsSync(join(pluginPath, ".data", "notes", "too-large.txt")),
    ).toBe(false);
  });

  it("does not auto-create parents for write or writeText", async () => {
    const { context, pluginPath } = createFixture();

    const error = await expectPluginFsWriteError(
      pluginFsWriteText(context, "~/missing/child.txt", "child"),
    );

    expect(error).toMatchObject({
      code: "write_failed",
      virtualPath: "~/missing/child.txt",
    });
    expect(existsSync(join(pluginPath, ".data", "missing"))).toBe(false);
  });

  it("requires thread context and files.allow.write coverage for ./ writes", async () => {
    const { context, projectPath } = createFixture();

    await pluginFsWriteText(context, "./src/generated.txt", "generated");
    expect(
      readFileSync(join(projectPath, "src", "generated.txt"), "utf8"),
    ).toBe("generated");

    for (const contextKind of NON_THREAD_CALLBACK_CONTEXT_KINDS) {
      const missingContext = await expectPluginContextError(
        pluginFsWriteText(
          {
            ...context,
            contextKind,
          },
          "./src/nope.txt",
          "nope",
        ),
      );
      expect(missingContext).toMatchObject({
        code: "project_context_unavailable",
        contextKind,
        virtualPath: "./src/nope.txt",
      });
      expect(missingContext.message).not.toContain(projectPath);
    }

    const denied = await expectPluginFsWriteError(
      pluginFsWriteText(context, "./secret/hidden.txt", "secret"),
    );
    expect(denied).toMatchObject({
      code: "permission_denied",
      message: "Plugin fs ./ write path is not covered by files.allow.write.",
      virtualPath: "./secret/hidden.txt",
    });
  });

  it("allows recursive mkdir only when the final path has write access", async () => {
    const { context, projectPath } = createFixture();

    await pluginFsMkdir(context, "./src/generated/deep", { recursive: true });
    expect(existsSync(join(projectPath, "src", "generated", "deep"))).toBe(
      true,
    );

    const denied = await expectPluginFsWriteError(
      pluginFsMkdir(context, "./secret/generated/deep", { recursive: true }),
    );
    expect(denied).toMatchObject({
      code: "permission_denied",
      message: "Plugin fs ./ write path is not covered by files.allow.write.",
    });
  });

  it("removes files and empty directories only with delete permissions and allowlists", async () => {
    const { context, projectPath } = createFixture();

    await pluginFsRm(context, "./tmp/delete.txt");
    expect(existsSync(join(projectPath, "tmp", "delete.txt"))).toBe(false);
    await pluginFsRmdir(context, "./tmp/empty");
    expect(existsSync(join(projectPath, "tmp", "empty"))).toBe(false);

    const deniedByProjectAllowlist = await expectPluginFsWriteError(
      pluginFsRm(context, "./src/allowed.txt"),
    );
    expect(deniedByProjectAllowlist).toMatchObject({
      code: "permission_denied",
      message: "Plugin fs ./ delete path is not covered by files.allow.delete.",
    });
    expect(deniedByProjectAllowlist.message).not.toContain(projectPath);

    writeFileSync(join(projectPath, "tmp", "delete.txt"), "remove again");
    const deniedByStoragePermission = await expectPluginFsWriteError(
      pluginFsRm(
        {
          ...context,
          permissions: context.permissions.filter(
            (permission) => permission !== "storage:delete",
          ),
        },
        "./tmp/delete.txt",
      ),
    );
    expect(deniedByStoragePermission).toMatchObject({
      code: "permission_denied",
      message: "Plugin fs deletes require storage:delete permission.",
      virtualPath: "./tmp/delete.txt",
    });
    expect(existsSync(join(projectPath, "tmp", "delete.txt"))).toBe(true);
  });

  it("applies manifest write and delete denylists to direct and recursive operations", async () => {
    const { context, projectPath } = createFixture();
    mkdirSync(join(projectPath, "tmp", "blocked"), { recursive: true });
    writeFileSync(join(projectPath, "tmp", "blocked", "secret.txt"), "secret");

    const deniedWrite = await expectPluginFsWriteError(
      pluginFsWriteText(
        {
          ...context,
          filesWriteDenylist: ["./tmp/blocked/**"],
        },
        "./tmp/blocked/secret.txt",
        "changed",
      ),
    );
    expect(deniedWrite).toMatchObject({
      code: "permission_denied",
      message: "Plugin fs ./ write path is denied by files.deny.write.",
      virtualPath: "./tmp/blocked/secret.txt",
    });

    const deniedRecursiveDelete = await expectPluginFsWriteError(
      pluginFsRm(
        {
          ...context,
          filesDeleteAllowlist: ["./tmp", "./tmp/**"],
          filesDeleteDenylist: ["./tmp/blocked/**"],
        },
        "./tmp",
        { recursive: true },
      ),
    );
    expect(deniedRecursiveDelete).toMatchObject({
      code: "permission_denied",
      message: "Plugin fs ./ delete path is denied by files.deny.delete.",
    });
    expect(deniedRecursiveDelete.virtualPath).toStartWith("./tmp/blocked");

    const deniedThreadRootRecursiveDelete = await expectPluginFsWriteError(
      pluginFsRm(
        {
          ...context,
          filesDeleteAllowlist: ["./tmp", "./tmp/**"],
          filesDeleteDenylist: ["./tmp/blocked/**"],
          threadRootPath: projectPath,
        },
        "./tmp",
        { recursive: true },
      ),
    );
    expect(deniedThreadRootRecursiveDelete).toMatchObject({
      code: "permission_denied",
      message: "Plugin fs ./ delete path is denied by files.deny.delete.",
    });
    expect(deniedThreadRootRecursiveDelete.virtualPath).toStartWith(
      "./tmp/blocked",
    );
    expect(existsSync(join(projectPath, "tmp", "blocked", "secret.txt"))).toBe(
      true,
    );
  });

  it("enforces copy read-source and write-destination permissions", async () => {
    const { context, pluginPath, projectPath } = createFixture();

    await pluginFsCopy(
      context,
      "./src/allowed.txt",
      "~/notes/project-copy.txt",
    );
    expect(
      readFileSync(
        join(pluginPath, ".data", "notes", "project-copy.txt"),
        "utf8",
      ),
    ).toBe("allowed");

    await pluginFsCopy(context, "~/notes/source.txt", "./src/from-data.txt");
    expect(
      readFileSync(join(projectPath, "src", "from-data.txt"), "utf8"),
    ).toBe("alpha");

    const deniedSource = await expectPluginFsWriteError(
      pluginFsCopy(
        {
          ...context,
          filesReadAllowlist: ["./tmp/**"],
        },
        "./src/allowed.txt",
        "~/notes/denied.txt",
      ),
    );
    expect(deniedSource).toMatchObject({
      code: "permission_denied",
      message: "Plugin fs ./ read path is not covered by files.allow.read.",
    });
  });

  it("enforces plugin data quota before copy and move mutate storage", async () => {
    const { context, pluginPath, projectPath } = createFixture();
    writeFileSync(join(projectPath, "src", "large.txt"), "123456");

    await expect(
      pluginFsCopy(
        {
          ...context,
          quota: { ...DEFAULT_TEST_QUOTA, maxDataBytes: 10 },
        },
        "./src/large.txt",
        "~/notes/large-copy.txt",
      ),
    ).rejects.toMatchObject({ code: "plugin_data_quota_exceeded" });
    expect(
      existsSync(join(pluginPath, ".data", "notes", "large-copy.txt")),
    ).toBe(false);

    writeFileSync(join(projectPath, "tmp", "large.txt"), "123456");
    await expect(
      pluginFsMove(
        {
          ...context,
          quota: { ...DEFAULT_TEST_QUOTA, maxDataBytes: 10 },
        },
        "./tmp/large.txt",
        "~/notes/large-move.txt",
      ),
    ).rejects.toMatchObject({ code: "plugin_data_quota_exceeded" });
    expect(readFileSync(join(projectPath, "tmp", "large.txt"), "utf8")).toBe(
      "123456",
    );
    expect(
      existsSync(join(pluginPath, ".data", "notes", "large-move.txt")),
    ).toBe(false);
  });

  it("denies symlinks during recursive copy and move from thread roots", async () => {
    const { context, projectPath } = createFixture();
    const outsidePath = createTempDirectory(
      "metidos-plugin-fs-write-thread-outside-",
    );
    writeFileSync(join(outsidePath, "secret.txt"), "secret");
    const threadRootPath = join(projectPath, "src");
    mkdirSync(join(threadRootPath, "copy-source"));
    writeFileSync(join(threadRootPath, "copy-source", "safe.txt"), "safe");
    symlinkSync(outsidePath, join(threadRootPath, "copy-source", "outside"));
    mkdirSync(join(threadRootPath, "move-source"));
    writeFileSync(join(threadRootPath, "move-source", "safe.txt"), "safe");
    symlinkSync(outsidePath, join(threadRootPath, "move-source", "outside"));
    const threadContext: PluginFsWriteContext = {
      ...context,
      filesDeleteAllowlist: ["./**"],
      filesReadAllowlist: ["./**"],
      filesWriteAllowlist: ["./**"],
      threadRootPath,
    };

    const copyError = await expectPluginFsWriteError(
      pluginFsCopy(threadContext, "./copy-source", "./copy-target"),
    );
    expect(copyError).toMatchObject({
      code: "permission_denied",
      message:
        "Plugin fs recursive copy does not allow symlinks in project subtrees.",
      virtualPath: "./copy-source/outside",
    });
    expect(existsSync(join(threadRootPath, "copy-target"))).toBe(true);
    expect(existsSync(join(threadRootPath, "copy-target", "outside"))).toBe(
      false,
    );

    const moveError = await expectPluginFsWriteError(
      pluginFsMove(threadContext, "./move-source", "./move-target"),
    );
    expect(moveError).toMatchObject({
      code: "permission_denied",
      message:
        "Plugin fs recursive copy does not allow symlinks in project subtrees.",
      virtualPath: "./move-source/outside",
    });
    expect(existsSync(join(threadRootPath, "move-source"))).toBe(true);
    expect(existsSync(join(threadRootPath, "move-target"))).toBe(true);
    expect(existsSync(join(threadRootPath, "move-target", "outside"))).toBe(
      false,
    );
  });

  it("denies symlink escapes across write, mkdir, delete, copy, and move", async () => {
    const { context, pluginPath, projectPath } = createFixture();
    const outsidePath = createTempDirectory("metidos-plugin-fs-write-outside-");
    writeFileSync(join(outsidePath, "secret.txt"), "secret");
    symlinkSync(outsidePath, join(pluginPath, ".data", "outside"), "dir");
    symlinkSync(outsidePath, join(projectPath, "tmp", "outside"), "dir");

    for (const operation of [
      () => pluginFsWriteText(context, "~/outside/new.txt", "nope"),
      () => pluginFsMkdir(context, "~/outside/new-dir", { recursive: true }),
      () => pluginFsRm(context, "./tmp/outside/secret.txt"),
      () => pluginFsCopy(context, "./tmp/outside/secret.txt", "~/notes/nope"),
      () => pluginFsMove(context, "./tmp/outside/secret.txt", "~/notes/nope"),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        code: "path_outside_root",
      });
    }
    expect(readFileSync(join(outsidePath, "secret.txt"), "utf8")).toBe(
      "secret",
    );
  });

  it("does not follow final symlink targets when writing or copying", async () => {
    if (process.platform === "win32") {
      return;
    }

    const { context, projectPath } = createFixture();
    const outsidePath = createTempDirectory(
      "metidos-plugin-fs-write-target-outside-",
    );
    writeFileSync(join(outsidePath, "victim.txt"), "victim");
    symlinkSync(
      join(outsidePath, "victim.txt"),
      join(projectPath, "src", "target-link.txt"),
    );

    await expect(
      pluginFsWriteText(context, "./src/target-link.txt", "overwrite"),
    ).rejects.toMatchObject({ code: "path_outside_root" });
    await expect(
      pluginFsCopy(context, "./src/allowed.txt", "./src/target-link.txt"),
    ).rejects.toMatchObject({ code: "path_outside_root" });
    expect(readFileSync(join(outsidePath, "victim.txt"), "utf8")).toBe(
      "victim",
    );
  });

  it("requires read, write, and delete permissions for move", async () => {
    const { context, pluginPath, projectPath } = createFixture();

    await pluginFsMove(context, "~/notes/source.txt", "./tmp/moved.txt");
    expect(existsSync(join(pluginPath, ".data", "notes", "source.txt"))).toBe(
      false,
    );
    expect(readFileSync(join(projectPath, "tmp", "moved.txt"), "utf8")).toBe(
      "alpha",
    );

    writeFileSync(join(pluginPath, ".data", "notes", "again.txt"), "again");
    const deniedDelete = await expectPluginFsWriteError(
      pluginFsMove(
        {
          ...context,
          permissions: context.permissions.filter(
            (permission) => permission !== "storage:delete",
          ),
        },
        "~/notes/again.txt",
        "./tmp/again.txt",
      ),
    );
    expect(deniedDelete).toMatchObject({
      code: "permission_denied",
      message: "Plugin fs deletes require storage:delete permission.",
    });
    expect(existsSync(join(pluginPath, ".data", "notes", "again.txt"))).toBe(
      true,
    );
  });
});
