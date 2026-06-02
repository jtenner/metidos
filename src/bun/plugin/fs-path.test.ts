/**
 * @file src/bun/plugin/fs-path.test.ts
 * @description Focused tests for Plugin System v1 metidos.fs virtual path containment.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  constants as fsConstants,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeValidatedPluginFsFileDescriptor,
  mkdirValidatedPluginFsPathSync,
  openValidatedPluginFsPathSync,
  PluginFsPathError,
  pluginFsReadOpenFlags,
  pluginFsWriteOpenFlags,
  readValidatedPluginFsFileDescriptor,
  resolvePluginFsVirtualPath,
  splitRelativePathSegments,
  toPluginFsVirtualPath,
} from "./fs-path";

const tempDirectories = new Set<string>();

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

function createPluginFixture(): { pluginPath: string; projectPath: string } {
  const rootPath = createTempDirectory("metidos-plugin-fs-path-");
  const pluginPath = join(rootPath, "plugins", "demo_plugin");
  const projectPath = join(rootPath, "worktree");
  mkdirSync(join(pluginPath, ".data", "nested"), { recursive: true });
  mkdirSync(join(projectPath, "src"), { recursive: true });
  writeFileSync(join(pluginPath, "metidos-plugin.json"), "{}\n");
  writeFileSync(join(pluginPath, "index.ts"), "export {};\n");
  writeFileSync(join(pluginPath, ".data", "nested", "note.txt"), "note\n");
  if (process.platform !== "win32") {
    writeFileSync(
      join(pluginPath, ".data", "nested", "foo\\bar.txt"),
      "backslash\n",
    );
  }
  writeFileSync(join(projectPath, "src", "inside.txt"), "inside\n");
  return { pluginPath, projectPath };
}

async function expectPluginFsPathError(
  operation: Promise<unknown>,
): Promise<PluginFsPathError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PluginFsPathError);
    return error as PluginFsPathError;
  }
  throw new Error("Expected plugin fs path operation to fail.");
}

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("plugin fs realpath segments", () => {
  it("splits Windows-style relative paths into forbidden directory segments", () => {
    expect(splitRelativePathSegments(".git\\config")).toEqual([
      ".git",
      "config",
    ]);
    expect(splitRelativePathSegments("src\\.ssh\\id_rsa")).toEqual([
      "src",
      ".ssh",
      "id_rsa",
    ]);
  });
});

describe("plugin fs virtual path resolver", () => {
  it("maps ~/ to plugin .data and ./ to the current thread or project root", async () => {
    const { pluginPath, projectPath } = createPluginFixture();
    const threadPath = join(projectPath, "src");

    await expect(
      resolvePluginFsVirtualPath({
        pluginPath,
        virtualPath: "~/nested/note.txt",
      }),
    ).resolves.toMatchObject({
      absolutePath: join(pluginPath, ".data", "nested", "note.txt"),
      exists: true,
      realPath: join(pluginPath, ".data", "nested", "note.txt"),
      rootKind: "pluginData",
      rootPath: join(pluginPath, ".data"),
      virtualPath: "~/nested/note.txt",
    });

    await expect(
      resolvePluginFsVirtualPath({
        pluginPath,
        projectRootPath: projectPath,
        virtualPath: "./src/inside.txt",
      }),
    ).resolves.toMatchObject({
      absolutePath: join(projectPath, "src", "inside.txt"),
      rootKind: "project",
      virtualPath: "./src/inside.txt",
    });

    await expect(
      resolvePluginFsVirtualPath({
        pluginPath,
        projectRootPath: projectPath,
        threadRootPath: threadPath,
        virtualPath: "./inside.txt",
      }),
    ).resolves.toMatchObject({
      absolutePath: join(threadPath, "inside.txt"),
      rootKind: "thread",
      virtualPath: "./inside.txt",
    });
  });

  it("treats backslash as a filename character on POSIX", async () => {
    if (process.platform === "win32") {
      return;
    }
    const { pluginPath } = createPluginFixture();

    await expect(
      resolvePluginFsVirtualPath({
        pluginPath,
        virtualPath: "~/nested/foo\\bar.txt",
      }),
    ).resolves.toMatchObject({
      absolutePath: join(pluginPath, ".data", "nested", "foo\\bar.txt"),
      virtualPath: "~/nested/foo\\bar.txt",
    });
  });

  it("rejects backslash-separated traversal in virtual paths on Windows", async () => {
    if (process.platform !== "win32") {
      return;
    }
    const { pluginPath } = createPluginFixture();

    await expect(
      expectPluginFsPathError(
        resolvePluginFsVirtualPath({
          pluginPath,
          virtualPath: "~/.git\\config",
        }),
      ),
    ).resolves.toMatchObject({
      code: "forbidden_directory",
      virtualPath: "~/.git/config",
    });
  });

  it("normalizes virtual paths and exposes virtual paths for absolute results", async () => {
    const { pluginPath } = createPluginFixture();

    const resolved = await resolvePluginFsVirtualPath({
      pluginPath,
      virtualPath: "~/nested/./note.txt",
    });

    expect(resolved.virtualPath).toBe("~/nested/note.txt");
    expect(
      toPluginFsVirtualPath({
        absolutePath: resolved.absolutePath,
        rootKind: resolved.rootKind,
        rootPath: resolved.rootPath,
      }),
    ).toBe("~/nested/note.txt");
  });

  it("rejects absolute and NUL virtual paths before resolving host paths", async () => {
    const { pluginPath } = createPluginFixture();
    const absolutePluginDataPath = join(
      pluginPath,
      ".data",
      "nested",
      "note.txt",
    );

    const absolutePathError = await expectPluginFsPathError(
      resolvePluginFsVirtualPath({
        pluginPath,
        virtualPath: absolutePluginDataPath,
      }),
    );
    expect(absolutePathError).toMatchObject({
      code: "invalid_virtual_path",
      message: "Plugin fs virtual paths must start with ~/ or ./.",
      virtualPath: absolutePluginDataPath,
    });
    expect(absolutePathError.message).not.toContain(pluginPath);

    const nulPathError = await expectPluginFsPathError(
      resolvePluginFsVirtualPath({
        pluginPath,
        virtualPath: "~/nested/evil\0.txt",
      }),
    );
    expect(nulPathError).toMatchObject({
      code: "invalid_virtual_path",
      message: "Plugin fs virtual paths cannot contain NUL bytes.",
      virtualPath: "~/nested/evil\0.txt",
    });
    expect(nulPathError.message).not.toContain(pluginPath);
  });

  it("denies traversal and missing ./ context before returning host paths", async () => {
    const { pluginPath } = createPluginFixture();

    const traversal = await expectPluginFsPathError(
      resolvePluginFsVirtualPath({
        pluginPath,
        virtualPath: "~/nested/../metidos-plugin.json",
      }),
    );
    expect(traversal).toMatchObject({
      code: "path_outside_root",
      message: "Plugin fs virtual path traversal is denied.",
      virtualPath: "~/nested/../metidos-plugin.json",
    });
    expect(traversal.message).not.toContain(pluginPath);

    const missingContext = await expectPluginFsPathError(
      resolvePluginFsVirtualPath({
        pluginPath,
        virtualPath: "./src/inside.txt",
      }),
    );
    expect(missingContext).toMatchObject({
      code: "missing_project_context",
      virtualPath: "./src/inside.txt",
    });
    expect(missingContext.message).not.toContain(pluginPath);
  });

  it("denies symlink escapes for existing reads and missing write leaves", async () => {
    const { pluginPath } = createPluginFixture();
    const outsidePath = createTempDirectory("metidos-plugin-fs-outside-");
    writeFileSync(join(outsidePath, "secret.txt"), "secret\n");
    symlinkSync(outsidePath, join(pluginPath, ".data", "outside"), "dir");

    const existingEscape = await expectPluginFsPathError(
      resolvePluginFsVirtualPath({
        pluginPath,
        virtualPath: "~/outside/secret.txt",
      }),
    );
    expect(existingEscape).toMatchObject({
      code: "path_outside_root",
      message: "Plugin fs symlink escape is denied.",
      virtualPath: "~/outside/secret.txt",
    });
    expect(existingEscape.message).not.toContain(outsidePath);

    const writeEscape = await expectPluginFsPathError(
      resolvePluginFsVirtualPath({
        access: "write",
        pluginPath,
        virtualPath: "~/outside/new.txt",
      }),
    );
    expect(writeEscape).toMatchObject({
      code: "path_outside_root",
      virtualPath: "~/outside/new.txt",
    });
    expect(writeEscape.message).not.toContain(outsidePath);
  });

  it("denies .git and .ssh segments directly and after realpathing symlinks", async () => {
    const { pluginPath, projectPath } = createPluginFixture();
    mkdirSync(join(projectPath, ".git"), { recursive: true });
    writeFileSync(join(projectPath, ".git", "config"), "[core]\n");
    symlinkSync(
      join(projectPath, ".git"),
      join(projectPath, "git-link"),
      "dir",
    );

    const direct = await expectPluginFsPathError(
      resolvePluginFsVirtualPath({
        pluginPath,
        projectRootPath: projectPath,
        virtualPath: "./.git/config",
      }),
    );
    expect(direct).toMatchObject({
      code: "forbidden_directory",
      virtualPath: "./.git/config",
    });

    const symlinked = await expectPluginFsPathError(
      resolvePluginFsVirtualPath({
        pluginPath,
        projectRootPath: projectPath,
        virtualPath: "./git-link/config",
      }),
    );
    expect(symlinked).toMatchObject({
      code: "forbidden_directory",
      virtualPath: "./git-link/config",
    });
  });

  it("denies plugin source through ./ roots but permits plugin data with source-like filenames", async () => {
    const { pluginPath } = createPluginFixture();
    writeFileSync(
      join(pluginPath, ".data", "metidos-plugin.json"),
      '{"data":true}\n',
    );

    await expect(
      resolvePluginFsVirtualPath({
        pluginPath,
        projectRootPath: pluginPath,
        virtualPath: "~/metidos-plugin.json",
      }),
    ).resolves.toMatchObject({
      absolutePath: join(pluginPath, ".data", "metidos-plugin.json"),
      rootKind: "pluginData",
      virtualPath: "~/metidos-plugin.json",
    });

    const manifestAccess = await expectPluginFsPathError(
      resolvePluginFsVirtualPath({
        pluginPath,
        projectRootPath: pluginPath,
        virtualPath: "./metidos-plugin.json",
      }),
    );
    expect(manifestAccess).toMatchObject({
      code: "plugin_source_denied",
      message: "Plugin fs access to plugin source files is denied.",
      virtualPath: "./metidos-plugin.json",
    });
    expect(manifestAccess.message).not.toContain(pluginPath);

    const sourceAccess = await expectPluginFsPathError(
      resolvePluginFsVirtualPath({
        pluginPath,
        projectRootPath: pluginPath,
        virtualPath: "./index.ts",
      }),
    );
    expect(sourceAccess).toMatchObject({
      code: "plugin_source_denied",
      virtualPath: "./index.ts",
    });
  });

  it("denies ./ project paths when the plugin installation path cannot be resolved", async () => {
    const { pluginPath, projectPath } = createPluginFixture();
    rmSync(pluginPath, { force: true, recursive: true });

    const denied = await expectPluginFsPathError(
      resolvePluginFsVirtualPath({
        pluginPath,
        projectRootPath: projectPath,
        virtualPath: "./src/inside.txt",
      }),
    );
    expect(denied).toMatchObject({
      code: "plugin_source_denied",
      virtualPath: "./src/inside.txt",
    });
  });

  it("fails closed for deleted roots and permits write paths through missing ancestors", async () => {
    const { pluginPath, projectPath } = createPluginFixture();

    const nestedWrite = await resolvePluginFsVirtualPath({
      access: "write",
      pluginPath,
      virtualPath: "~/missing/parent/new.txt",
    });
    expect(nestedWrite).toMatchObject({
      absolutePath: join(pluginPath, ".data", "missing", "parent", "new.txt"),
      exists: false,
      realPath: join(pluginPath, ".data", "missing", "parent", "new.txt"),
      rootKind: "pluginData",
      rootPath: join(pluginPath, ".data"),
      virtualPath: "~/missing/parent/new.txt",
    });

    rmSync(join(pluginPath, ".data"), { force: true, recursive: true });
    const deletedPluginData = await expectPluginFsPathError(
      resolvePluginFsVirtualPath({
        access: "write",
        pluginPath,
        virtualPath: "~/missing/parent/new.txt",
      }),
    );
    expect(deletedPluginData).toMatchObject({
      code: "root_unavailable",
      virtualPath: "~/missing/parent/new.txt",
    });

    rmSync(projectPath, { force: true, recursive: true });
    const deletedProjectRoot = await expectPluginFsPathError(
      resolvePluginFsVirtualPath({
        access: "write",
        pluginPath,
        projectRootPath: projectPath,
        virtualPath: "./new.txt",
      }),
    );
    expect(deletedProjectRoot).toMatchObject({
      code: "root_unavailable",
      virtualPath: "./new.txt",
    });
  });

  it("creates recursive directories without following a newly planted symlink parent", async () => {
    if (process.platform === "win32") {
      return;
    }
    const { pluginPath } = createPluginFixture();
    const outsidePath = createTempDirectory("metidos-plugin-fs-mkdir-outside-");
    const resolved = await resolvePluginFsVirtualPath({
      access: "write",
      pluginPath,
      virtualPath: "~/new-parent/nested",
    });

    symlinkSync(outsidePath, join(pluginPath, ".data", "new-parent"), "dir");

    expect(() =>
      mkdirValidatedPluginFsPathSync({
        options: { recursive: true },
        resolved,
      }),
    ).toThrow(PluginFsPathError);
  });

  it("creates recursive directories one segment at a time inside the validated root", async () => {
    const { pluginPath } = createPluginFixture();
    const resolved = await resolvePluginFsVirtualPath({
      access: "write",
      pluginPath,
      virtualPath: "~/safe-parent/nested",
    });

    mkdirValidatedPluginFsPathSync({
      options: { recursive: true },
      resolved,
    });

    await expect(
      resolvePluginFsVirtualPath({
        pluginPath,
        virtualPath: "~/safe-parent/nested",
      }),
    ).resolves.toMatchObject({
      exists: true,
      virtualPath: "~/safe-parent/nested",
    });
  });

  it("uses O_NOFOLLOW for plugin fs open flags on supported platforms", () => {
    if (process.platform === "win32") {
      expect(pluginFsReadOpenFlags() & fsConstants.O_NOFOLLOW).toBe(0);
      expect(pluginFsWriteOpenFlags() & fsConstants.O_NOFOLLOW).toBe(0);
      return;
    }

    expect(pluginFsReadOpenFlags() & fsConstants.O_NOFOLLOW).toBe(
      fsConstants.O_NOFOLLOW,
    );
    expect(pluginFsWriteOpenFlags() & fsConstants.O_NOFOLLOW).toBe(
      fsConstants.O_NOFOLLOW,
    );
  });

  it("opens validated plugin paths with a synchronous lstat/open pair", async () => {
    const { pluginPath } = createPluginFixture();
    const resolved = await resolvePluginFsVirtualPath({
      pluginPath,
      virtualPath: "~/nested/note.txt",
    });
    const fd = openValidatedPluginFsPathSync({
      flags: pluginFsReadOpenFlags(),
      resolved,
    });
    try {
      expect(
        new TextDecoder().decode(
          readValidatedPluginFsFileDescriptor({
            fd,
            maxBytes: 1024,
            virtualPath: resolved.virtualPath,
          }),
        ),
      ).toBe("note\n");
    } finally {
      closeValidatedPluginFsFileDescriptor(fd);
    }
  });

  it("rejects symlink leaves during validated plugin fs open", async () => {
    const { pluginPath } = createPluginFixture();
    const targetPath = join(pluginPath, ".data", "nested", "note.txt");
    const resolved = await resolvePluginFsVirtualPath({
      pluginPath,
      virtualPath: "~/nested/note.txt",
    });
    rmSync(targetPath);
    const outsidePath = createTempDirectory("metidos-plugin-fs-open-outside-");
    writeFileSync(join(outsidePath, "secret.txt"), "secret\n");
    symlinkSync(join(outsidePath, "secret.txt"), targetPath);

    expect(() =>
      openValidatedPluginFsPathSync({
        flags: pluginFsReadOpenFlags(),
        resolved,
      }),
    ).toThrow(PluginFsPathError);
  });
});
