/**
 * @file src/bun/plugin/sqlite.test.ts
 * @description Tests for Plugin System v1 SQLite host API containment and permissions.
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
import { join, normalize } from "node:path";

import { PluginPermissionError } from "./context";
import { calculatePluginDataQuotaUsage, PluginDataQuotaError } from "./data";
import {
  closePluginSqliteConnections,
  createPluginSqliteNativeSecurityDiagnostic,
  executePluginSqliteOperation,
  getPluginSqliteConnectionCacheStats,
  getPluginSqliteNativeSecurityDiagnostic,
  PLUGIN_SQLITE_NATIVE_SECURITY_MODE_ENV,
  PluginSqliteError,
  resetPluginSqliteNativeSecurityDiagnosticForTest,
} from "./sqlite";

const tempDirectories = new Set<string>();

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

function createPluginFixture(): { pluginPath: string; rootPath: string } {
  const rootPath = createTempDirectory("metidos-plugin-sqlite-");
  const pluginPath = join(rootPath, "plugins", "demo_plugin");
  mkdirSync(join(pluginPath, ".data", "db"), { recursive: true });
  return { pluginPath, rootPath };
}

async function expectPluginSqliteError(
  operation: Promise<unknown>,
): Promise<PluginSqliteError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PluginSqliteError);
    return error as PluginSqliteError;
  }
  throw new Error("Expected plugin SQLite operation to fail.");
}

afterEach(() => {
  closePluginSqliteConnections();
  delete process.env[PLUGIN_SQLITE_NATIVE_SECURITY_MODE_ENV];
  resetPluginSqliteNativeSecurityDiagnosticForTest();
  for (const path of tempDirectories) {
    rmSync(path, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("getPluginSqliteNativeSecurityDiagnostic", () => {
  it("reports intentionally disabled native SQLite security as an informational posture", () => {
    process.env[PLUGIN_SQLITE_NATIVE_SECURITY_MODE_ENV] = "disabled";

    expect(getPluginSqliteNativeSecurityDiagnostic()).toMatchObject({
      action:
        "No action required when this deployment intentionally disables the native extension; TypeScript SQL guards remain active.",
      extensionPath: null,
      mode: "disabled",
      severity: "info",
      status: "disabled",
    });
  });

  it("looks for the native SQLite security artifact under the repository native directory", () => {
    const diagnostic = getPluginSqliteNativeSecurityDiagnostic();

    if (diagnostic.extensionPath) {
      const normalizedPath = normalize(diagnostic.extensionPath);
      expect(normalizedPath).toContain(
        normalize(join("native", "sqlite-security-extension", "dist")),
      );
      expect(normalizedPath).not.toContain(
        normalize(join("src", "native", "sqlite-security-extension")),
      );
    }
  });

  it("adds local action and warning severity to missing or failed native SQLite security states", () => {
    expect(
      createPluginSqliteNativeSecurityDiagnostic({
        checkedAt: "2026-05-03T21:15:00.000Z",
        extensionPath: "/opt/metidos/native/missing.so",
        message: "Native plugin SQLite security extension artifact is missing.",
        mode: "optional",
        status: "missing",
        target: "x86_64-linux-gnu",
      }),
    ).toMatchObject({
      action:
        "Build or install the native plugin SQLite security extension for this platform, or disable it explicitly if the degraded posture is intentional.",
      severity: "warning",
      status: "missing",
      target: "x86_64-linux-gnu",
    });

    expect(
      createPluginSqliteNativeSecurityDiagnostic({
        checkedAt: "2026-05-03T21:16:00.000Z",
        extensionPath: "/opt/metidos/native/broken.so",
        message: "Native plugin SQLite security extension failed to load: boom",
        mode: "optional",
        status: "failed",
        target: "x86_64-linux-gnu",
      }),
    ).toMatchObject({
      action:
        "Rebuild or reinstall the native plugin SQLite security extension for this platform, or disable it explicitly if the degraded posture is intentional.",
      severity: "warning",
      status: "failed",
    });
  });

  it("reports loaded native SQLite security without remediation", () => {
    expect(
      createPluginSqliteNativeSecurityDiagnostic({
        checkedAt: "2026-05-03T21:17:00.000Z",
        extensionPath: "/opt/metidos/native/loaded.so",
        message: "Native plugin SQLite security extension loaded successfully.",
        mode: "optional",
        status: "loaded",
        target: "x86_64-linux-gnu",
      }),
    ).toMatchObject({
      action: null,
      severity: "info",
      status: "loaded",
    });
  });
});

describe("executePluginSqliteOperation", () => {
  it("runs SQLite statements only against plugin ~/ data", async () => {
    const { pluginPath } = createPluginFixture();
    const permissions = ["sqlite", "storage:write"];

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.run",
        params: {
          path: "~/db/state.sqlite",
          statement:
            "create table notes (id integer primary key, title text not null)",
        },
        permissions,
        pluginPath,
      }),
    ).resolves.toMatchObject({ changes: 0 });

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.run",
        params: {
          bindings: { $title: "hello" },
          path: "~/db/state.sqlite",
          statement: "insert into notes (title) values ($title)",
        },
        permissions,
        pluginPath,
      }),
    ).resolves.toMatchObject({ changes: 1, lastInsertRowid: 1 });

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.all",
        params: {
          path: "~/db/state.sqlite",
          statement: "select id, title from notes order by id",
        },
        permissions,
        pluginPath,
      }),
    ).resolves.toEqual({ rows: [{ id: 1, title: "hello" }] });

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.get",
        params: {
          bindings: [1],
          path: "~/db/state.sqlite",
          statement: "select title from notes where id = ?",
        },
        permissions,
        pluginPath,
      }),
    ).resolves.toEqual({ row: { title: "hello" } });
  });

  it("reuses cached connections and closes them on plugin teardown", async () => {
    const { pluginPath } = createPluginFixture();
    const permissions = ["sqlite", "storage:write"];

    await executePluginSqliteOperation({
      operation: "sqlite.run",
      params: {
        path: "~/db/state.sqlite",
        statement: "create table notes (title text not null)",
      },
      permissions,
      pluginPath,
    });
    expect(getPluginSqliteConnectionCacheStats().entries).toBe(1);

    await executePluginSqliteOperation({
      operation: "sqlite.run",
      params: {
        bindings: ["cached"],
        path: "~/db/state.sqlite",
        statement: "insert into notes (title) values (?)",
      },
      permissions,
      pluginPath,
    });
    expect(getPluginSqliteConnectionCacheStats().entries).toBe(1);

    closePluginSqliteConnections(pluginPath);
    expect(getPluginSqliteConnectionCacheStats().entries).toBe(0);
  });

  it("prunes cached connections by least-recent use", async () => {
    const permissions = ["sqlite", "storage:write"];
    const fixtures = Array.from({ length: 65 }, () => createPluginFixture());

    for (const { pluginPath } of fixtures.slice(0, 64)) {
      await executePluginSqliteOperation({
        operation: "sqlite.run",
        params: {
          path: "~/db/state.sqlite",
          statement: "create table notes (title text not null)",
        },
        permissions,
        pluginPath,
      });
    }
    expect(getPluginSqliteConnectionCacheStats().entries).toBe(64);

    const hotFixture = fixtures[0];
    const evictedFixture = fixtures[1];
    const newFixture = fixtures[64];
    if (!hotFixture || !evictedFixture || !newFixture) {
      throw new Error("Expected SQLite cache pruning fixtures to be present.");
    }

    await executePluginSqliteOperation({
      operation: "sqlite.run",
      params: {
        path: "~/db/state.sqlite",
        statement: "insert into notes (title) values ('still hot')",
      },
      permissions,
      pluginPath: hotFixture.pluginPath,
    });

    await executePluginSqliteOperation({
      operation: "sqlite.run",
      params: {
        path: "~/db/state.sqlite",
        statement: "create table notes (title text not null)",
      },
      permissions,
      pluginPath: newFixture.pluginPath,
    });

    const stats = getPluginSqliteConnectionCacheStats();
    expect(stats.entries).toBe(64);
    expect(stats.keys.some((key) => key.includes(hotFixture.pluginPath))).toBe(
      true,
    );
    expect(
      stats.keys.some((key) => key.includes(evictedFixture.pluginPath)),
    ).toBe(false);
    expect(stats.keys.some((key) => key.includes(newFixture.pluginPath))).toBe(
      true,
    );
  });

  it("requires both sqlite and storage:write permissions", async () => {
    const { pluginPath } = createPluginFixture();

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.run",
        params: { path: "~/db/state.sqlite", statement: "select 1" },
        permissions: ["storage:write"],
        pluginPath,
      }),
    ).rejects.toBeInstanceOf(PluginPermissionError);
    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.run",
        params: { path: "~/db/state.sqlite", statement: "select 1" },
        permissions: ["storage:write"],
        pluginPath,
      }),
    ).rejects.toMatchObject({
      code: "plugin_permission_error",
      permission: "sqlite",
    });

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.run",
        params: { path: "~/db/state.sqlite", statement: "select 1" },
        permissions: ["sqlite"],
        pluginPath,
      }),
    ).rejects.toBeInstanceOf(PluginPermissionError);
    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.run",
        params: { path: "~/db/state.sqlite", statement: "select 1" },
        permissions: ["sqlite"],
        pluginPath,
      }),
    ).rejects.toMatchObject({
      code: "plugin_permission_error",
      permission: "storage:write",
    });
  });

  it("rejects project, memory, traversal, and symlink-escaped paths", async () => {
    const { pluginPath, rootPath } = createPluginFixture();
    const permissions = ["sqlite", "storage:write"];
    const outsidePath = join(rootPath, "outside.sqlite");
    writeFileSync(outsidePath, "");
    symlinkSync(outsidePath, join(pluginPath, ".data", "db", "outside.sqlite"));

    for (const path of [
      "./app.sqlite",
      ":memory:",
      "file:~/db/state.sqlite",
      "~/../app.sqlite",
      "~/db/outside.sqlite",
    ]) {
      const error = await expectPluginSqliteError(
        executePluginSqliteOperation({
          operation: "sqlite.run",
          params: { path, statement: "select 1" },
          permissions,
          pluginPath,
        }),
      );
      expect(error.virtualPath).toBe(path);
      expect(error.message).not.toContain(rootPath);
    }
  });

  it("caps sqlite.all rows before returning results", async () => {
    const { pluginPath } = createPluginFixture();
    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.all",
        params: {
          path: "~/db/state.sqlite",
          statement:
            "with recursive t(n) as (select 1 union all select n + 1 from t where n <= 1000) select n from t",
        },
        permissions: ["sqlite", "storage:write"],
        pluginPath,
      }),
    ).rejects.toMatchObject({
      code: "plugin_sqlite_result_limit_exceeded",
    });
  });

  it("caps sqlite.get result bytes before returning generated blobs", async () => {
    const { pluginPath } = createPluginFixture();

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.get",
        params: {
          path: "~/db/state.sqlite",
          statement: "select zeroblob(1048577) as payload",
        },
        permissions: ["sqlite", "storage:write"],
        pluginPath,
      }),
    ).rejects.toMatchObject({
      code: "plugin_sqlite_result_limit_exceeded",
      message: "Plugin SQLite sqlite.get result is too large.",
    });
  });

  it("caps sqlite.all serialized result bytes incrementally", async () => {
    const { pluginPath } = createPluginFixture();

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.all",
        params: {
          path: "~/db/state.sqlite",
          statement:
            "with recursive t(n) as (select 1 union all select n + 1 from t where n < 600) select printf('%02000d', n) as payload from t",
        },
        permissions: ["sqlite", "storage:write"],
        pluginPath,
      }),
    ).rejects.toMatchObject({
      code: "plugin_sqlite_result_limit_exceeded",
      message: "Plugin SQLite sqlite.all result is too large.",
    });
  });

  it("rejects invalid SQLite quota values before configuring PRAGMA limits", async () => {
    const { pluginPath } = createPluginFixture();

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.run",
        params: {
          path: "~/db/state.sqlite",
          statement: "create table notes (title text not null)",
        },
        permissions: ["sqlite", "storage:write"],
        pluginPath,
        quota: { maxDataBytes: Number.NaN, maxFileBytes: 1, maxFiles: 10 },
      }),
    ).rejects.toMatchObject({
      code: "plugin_data_quota_unavailable",
      message: "Plugin SQLite total storage quota is invalid.",
    });
  });

  it("rolls back quota-failed SQLite writes and closes failed handles", async () => {
    const { pluginPath } = createPluginFixture();
    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.run",
        params: {
          path: "~/db/state.sqlite",
          statement: "create table notes (title text not null)",
        },
        permissions: ["sqlite", "storage:write"],
        pluginPath,
        quota: { maxDataBytes: 100_000, maxFileBytes: 1, maxFiles: 10 },
      }),
    ).rejects.toBeInstanceOf(PluginDataQuotaError);
    expect(getPluginSqliteConnectionCacheStats().entries).toBe(0);

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.run",
        params: {
          path: "~/db/state.sqlite",
          statement: "insert into notes (title) values ('side effect')",
        },
        permissions: ["sqlite", "storage:write"],
        pluginPath,
        quota: { maxDataBytes: 100_000, maxFileBytes: 100_000, maxFiles: 10 },
      }),
    ).rejects.toMatchObject({
      code: "plugin_sqlite_failed",
    });
  });

  it("amortizes full quota scans after successful SQLite writes", async () => {
    const { pluginPath } = createPluginFixture();
    const permissions = ["sqlite", "storage:write"];
    const quota = {
      maxDataBytes: 10 * 1024 * 1024,
      maxFileBytes: 10 * 1024 * 1024,
      maxFiles: 4,
    };
    await executePluginSqliteOperation({
      operation: "sqlite.run",
      params: {
        path: "~/db/state.sqlite",
        statement: "create table notes (title text not null)",
      },
      permissions,
      pluginPath,
      quota,
    });

    const usageAfterInitialScan = await calculatePluginDataQuotaUsage({
      pluginPath,
    });
    for (
      let index = 0;
      index <= quota.maxFiles - usageAfterInitialScan.files;
      index += 1
    ) {
      writeFileSync(join(pluginPath, ".data", `quota-extra-${index}.txt`), "x");
    }

    for (let index = 0; index < 7; index += 1) {
      await executePluginSqliteOperation({
        operation: "sqlite.run",
        params: {
          bindings: [`note-${index}`],
          path: "~/db/state.sqlite",
          statement: "insert into notes (title) values (?)",
        },
        permissions,
        pluginPath,
        quota,
      });
    }

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.run",
        params: {
          bindings: ["note-7"],
          path: "~/db/state.sqlite",
          statement: "insert into notes (title) values (?)",
        },
        permissions,
        pluginPath,
        quota,
      }),
    ).rejects.toBeInstanceOf(PluginDataQuotaError);
  });

  it("rejects mutating sqlite.get statements before they can write", async () => {
    const { pluginPath } = createPluginFixture();
    const permissions = ["sqlite", "storage:write"];
    await executePluginSqliteOperation({
      operation: "sqlite.run",
      params: {
        path: "~/db/state.sqlite",
        statement: "create table notes (title text not null)",
      },
      permissions,
      pluginPath,
    });

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.get",
        params: {
          path: "~/db/state.sqlite",
          statement:
            "insert into notes (title) values ('side effect') returning title",
        },
        permissions,
        pluginPath,
      }),
    ).rejects.toMatchObject({
      code: "disallowed_plugin_sqlite_statement",
    });

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.get",
        params: {
          path: "~/db/state.sqlite",
          statement: "select count(*) as count from notes",
        },
        permissions,
        pluginPath,
      }),
    ).resolves.toEqual({ row: { count: 0 } });
  });

  it("rejects PRAGMA and CTE writes from read operations", async () => {
    const { pluginPath } = createPluginFixture();
    const permissions = ["sqlite", "storage:write"];
    await executePluginSqliteOperation({
      operation: "sqlite.run",
      params: {
        path: "~/db/state.sqlite",
        statement: "create table notes (title text not null)",
      },
      permissions,
      pluginPath,
    });

    for (const statement of [
      "pragma journal_mode = wal",
      "pragma table_info(notes)",
      "with changed as (insert into notes (title) values ('side effect') returning title) select title from changed",
      "with changed as (update notes set title = 'side effect' returning title) select title from changed",
      "with changed as (delete from notes returning title) select title from changed",
      "with ignored as (select 'insert into notes values (1)' as text) insert into notes (title) values ('side effect') returning title",
    ]) {
      await expect(
        executePluginSqliteOperation({
          operation: "sqlite.all",
          params: { path: "~/db/state.sqlite", statement },
          permissions,
          pluginPath,
        }),
      ).rejects.toMatchObject({
        code: "disallowed_plugin_sqlite_statement",
      });
    }

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.get",
        params: {
          path: "~/db/state.sqlite",
          statement: "select count(*) as count from notes",
        },
        permissions,
        pluginPath,
      }),
    ).resolves.toEqual({ row: { count: 0 } });
  });

  it("allows read statements with disallowed words in inert SQL contexts", async () => {
    const { pluginPath } = createPluginFixture();
    const permissions = ["sqlite", "storage:write"];

    await executePluginSqliteOperation({
      operation: "sqlite.run",
      params: {
        path: "~/db/state.sqlite",
        statement:
          'create table "update" (id integer primary key, "drop" text not null)',
      },
      permissions,
      pluginPath,
    });
    await executePluginSqliteOperation({
      operation: "sqlite.run",
      params: {
        bindings: ["quoted schema"],
        path: "~/db/state.sqlite",
        statement: 'insert into "update" ("drop") values (?)',
      },
      permissions,
      pluginPath,
    });

    for (const statement of [
      "select 'insert update delete drop pragma' as literal_text",
      "select 1 as updated_at, 2 as dropbox_count",
      'select "drop" from "update"',
      "select [drop] from [update]",
      "select `drop` from `update`",
      "-- insert into notes values (1)\nselect 1",
      "select 1 /* update notes set title = 'side effect' */",
    ]) {
      await expect(
        executePluginSqliteOperation({
          operation: "sqlite.all",
          params: { path: "~/db/state.sqlite", statement },
          permissions,
          pluginPath,
        }),
      ).resolves.toMatchObject({ rows: expect.any(Array) });
    }
  });

  it("allows load_extension text and quoted aliases when they are not function calls", async () => {
    const { pluginPath } = createPluginFixture();
    const permissions = ["sqlite", "storage:write"];

    for (const statement of [
      "select 'load_extension(' as literal_text",
      'select 1 as "load_extension"',
      "select 1 as [load_extension]",
      "select 1 as `load_extension`",
      "select 1 -- load_extension('extension')",
      "select 1 /* load_extension('extension') */",
    ]) {
      await expect(
        executePluginSqliteOperation({
          operation: "sqlite.get",
          params: { path: "~/db/state.sqlite", statement },
          permissions,
          pluginPath,
        }),
      ).resolves.toMatchObject({ row: expect.any(Object) });
    }
  });

  it("allows plugins to fully control their own SQLite schema", async () => {
    const { pluginPath } = createPluginFixture();
    const permissions = ["sqlite", "storage:write"];

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.run",
        params: {
          path: "~/db/state.sqlite",
          statement:
            "create table notes (id integer primary key, title text not null)",
        },
        permissions,
        pluginPath,
      }),
    ).resolves.toMatchObject({ changes: 0 });

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.run",
        params: {
          path: "~/db/state.sqlite",
          statement:
            "create trigger notes_title_trim after insert on notes begin update notes set title = trim(new.title) where id = new.id; end",
        },
        permissions,
        pluginPath,
      }),
    ).resolves.toMatchObject({ changes: 0 });

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.run",
        params: {
          path: "~/db/state.sqlite",
          statement: "create virtual table notes_search using fts5(title)",
        },
        permissions,
        pluginPath,
      }),
    ).resolves.toMatchObject({ changes: expect.any(Number) });

    await executePluginSqliteOperation({
      operation: "sqlite.run",
      params: {
        path: "~/db/state.sqlite",
        statement: "insert into notes (title) values ('  owned schema  ')",
      },
      permissions,
      pluginPath,
    });

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.get",
        params: {
          path: "~/db/state.sqlite",
          statement: "select title from notes where id = 1",
        },
        permissions,
        pluginPath,
      }),
    ).resolves.toEqual({ row: { title: "owned schema" } });

    await expect(
      executePluginSqliteOperation({
        operation: "sqlite.run",
        params: {
          path: "~/db/state.sqlite",
          statement: "drop table notes_search",
        },
        permissions,
        pluginPath,
      }),
    ).resolves.toMatchObject({ changes: 0 });
  });

  it("blocks statements that can open or write other database files", async () => {
    const { pluginPath } = createPluginFixture();
    const permissions = ["sqlite", "storage:write"];

    for (const statement of [
      "attach database 'other.sqlite' as other",
      "detach database other",
      "vacuum into 'copy.sqlite'",
      "/**/ attach database 'other.sqlite' as other",
      "/**/ detach database other",
      "/**/ vacuum into 'copy.sqlite'",
      "-- comment\nattach database 'other.sqlite' as other",
      "-- comment\nvacuum into 'copy.sqlite'",
      "select load_extension('extension')",
      "select load_extension\n\t('extension')",
      "select/**/load_extension('extension')",
      "select load_extension/* comment */('extension')",
      "select load_extension /* comment */ ('extension')",
      "select \"load_extension\"('extension')",
      "select [load_extension]('extension')",
      "select `load_extension`('extension')",
      "pragma journal_mode = wal",
      "pragma table_info(notes)",
      "begin transaction",
      "commit",
      "rollback",
      "savepoint plugin_controlled",
      "release plugin_controlled",
      "select 1; select 2",
    ]) {
      await expect(
        executePluginSqliteOperation({
          operation: "sqlite.run",
          params: { path: "~/db/state.sqlite", statement },
          permissions,
          pluginPath,
        }),
      ).rejects.toBeInstanceOf(PluginSqliteError);
    }
  });
});
