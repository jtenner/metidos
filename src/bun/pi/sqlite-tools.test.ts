/**
 * @file src/bun/pi/sqlite-tools.test.ts
 * @description Tests for the project-scoped SQLite tool.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPiSqliteTools } from "./sqlite-tools";

const tempDirectories = new Set<string>();

function makeWorktree(): string {
  const directory = mkdtempSync(join(tmpdir(), "metidos-pi-sqlite-tool-"));
  tempDirectories.add(directory);
  return directory;
}

function getSqliteTool(worktreePath: string) {
  const tool = createPiSqliteTools({
    worktreePathContext: worktreePath,
  }).find((entry) => entry.name === "sqlite");
  if (!tool) {
    throw new Error("Expected sqlite tool to be registered.");
  }
  return tool;
}

async function executeSqliteTool(
  worktreePath: string,
  rawArgs: {
    path: string;
    query: string;
  },
) {
  const tool = getSqliteTool(worktreePath);
  const args = tool.prepareArguments ? tool.prepareArguments(rawArgs) : rawArgs;
  return tool.execute("call-1", args as never, undefined, async () => {}, {
    cwd: worktreePath,
  } as never);
}

function resultText(result: Awaited<ReturnType<typeof executeSqliteTool>>) {
  const firstContent = result.content[0];
  return firstContent && "text" in firstContent ? firstContent.text : "";
}

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("createPiSqliteTools", () => {
  it("renders SELECT results as a markdown table", async () => {
    const worktreePath = makeWorktree();
    mkdirSync(join(worktreePath, "data"), { recursive: true });
    const databasePath = join(worktreePath, "data", "notes.sqlite");
    const database = new Database(databasePath, { create: true });
    try {
      database.run(
        "CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT, done INTEGER)",
      );
      database.run("INSERT INTO notes (title, done) VALUES (?, ?), (?, ?)", [
        "Ship sqlite tool",
        0,
        "Render markdown table",
        1,
      ]);
    } finally {
      database.close(false);
    }

    const result = await executeSqliteTool(worktreePath, {
      path: "data/notes.sqlite",
      query: "SELECT id, title, done FROM notes ORDER BY id",
    });

    const text = resultText(result);
    expect(text).toContain("| id | title | done |");
    expect(text).toContain("| 1 | Ship sqlite tool | 0 |");
    expect(text).toContain("| 2 | Render markdown table | 1 |");
    expect(result.details).toMatchObject({
      columns: ["id", "title", "done"],
      relativePath: "data/notes.sqlite",
      rowCount: 2,
      rowsAffected: null,
      statementKind: "query",
      truncated: false,
    });
  });

  it("streams SELECT results only up to the render cap", async () => {
    const worktreePath = makeWorktree();
    const databasePath = join(worktreePath, "many.sqlite");
    const database = new Database(databasePath, { create: true });
    try {
      database.run("CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)");
      const insert = database.prepare("INSERT INTO items (label) VALUES (?)");
      for (let index = 0; index < 250; index += 1) {
        insert.run(`item-${index}`);
      }
    } finally {
      database.close(false);
    }

    const result = await executeSqliteTool(worktreePath, {
      path: "many.sqlite",
      query: "SELECT id, label FROM items ORDER BY id",
    });

    const text = resultText(result);
    expect(text).toContain("| 200 | item-199 |");
    expect(text).not.toContain("| 201 | item-200 |");
    expect(text).toContain("_Truncated to the first 200 rows._");
    expect(result.details).toMatchObject({
      rowCount: 200,
      truncated: true,
    });
  });

  it("rejects write statements", async () => {
    const worktreePath = makeWorktree();
    const databasePath = join(worktreePath, "state.sqlite");
    const database = new Database(databasePath, { create: true });
    try {
      database.run(
        "CREATE TABLE flags (id INTEGER PRIMARY KEY, enabled INTEGER)",
      );
      database.run("INSERT INTO flags (enabled) VALUES (0), (0), (1)");
    } finally {
      database.close(false);
    }

    await expect(
      executeSqliteTool(worktreePath, {
        path: "state.sqlite",
        query: "UPDATE flags SET enabled = 1 WHERE enabled = 0",
      }),
    ).rejects.toThrow(
      "Only read-only SELECT statements are allowed by the sqlite tool.",
    );
  });

  it("rejects missing database files instead of creating them", async () => {
    const worktreePath = makeWorktree();
    const missingPath = join(worktreePath, "missing.sqlite");

    await expect(
      executeSqliteTool(worktreePath, {
        path: "missing.sqlite",
        query: "SELECT 1",
      }),
    ).rejects.toThrow("SQLite database file must already exist for this tool.");
    expect(existsSync(missingPath)).toBeFalse();
  });

  it("rejects symlinked database paths outside the project root", async () => {
    if (process.platform === "win32") {
      return;
    }
    const worktreePath = makeWorktree();
    const outsidePath = makeWorktree();
    const outsideDatabasePath = join(outsidePath, "outside.sqlite");
    const database = new Database(outsideDatabasePath, { create: true });
    database.run("CREATE TABLE secrets (value TEXT)");
    database.close(false);
    symlinkSync(outsideDatabasePath, join(worktreePath, "linked.sqlite"));

    await expect(
      executeSqliteTool(worktreePath, {
        path: "linked.sqlite",
        query: "SELECT value FROM secrets",
      }),
    ).rejects.toThrow("must not be a symbolic link");
  });

  it("rejects paths outside the project root", async () => {
    const worktreePath = makeWorktree();
    await expect(
      executeSqliteTool(worktreePath, {
        path: "../outside.sqlite",
        query: "SELECT 1",
      }),
    ).rejects.toThrow("Path is outside the current project root");
  });

  it("rejects absolute database paths even when they point inside the worktree", async () => {
    const worktreePath = makeWorktree();
    await expect(
      executeSqliteTool(worktreePath, {
        path: join(worktreePath, "db.sqlite"),
        query: "SELECT 1",
      }),
    ).rejects.toThrow("Path must be relative to the current project root.");
  });

  it("rejects dangerous SQLite statements that escape the bound database path", async () => {
    const worktreePath = makeWorktree();
    const database = new Database(join(worktreePath, "db.sqlite"), {
      create: true,
    });
    database.close(false);

    await expect(
      executeSqliteTool(worktreePath, {
        path: "db.sqlite",
        query: "-- x\nATTACH DATABASE '/tmp/other.sqlite' AS other",
      }),
    ).rejects.toThrow("ATTACH is not allowed by the sqlite tool.");
    await expect(
      executeSqliteTool(worktreePath, {
        path: "db.sqlite",
        query: "PRAGMA journal_mode = OFF",
      }),
    ).rejects.toThrow(/allowed by the sqlite tool\./);
    await expect(
      executeSqliteTool(worktreePath, {
        path: "db.sqlite",
        query: "PRAGMA journal_mode(WAL)",
      }),
    ).rejects.toThrow(/allowed by the sqlite tool\./);
    await expect(
      executeSqliteTool(worktreePath, {
        path: "db.sqlite",
        query: "PRAGMA table_info(notes)",
      }),
    ).resolves.toBeDefined();
  });
});
