/**
 * @file src/bun/pi/sqlite-tools.ts
 * @description Project-scoped SQLite query tool definitions.
 */

import { Database } from "bun:sqlite";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  openSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { pathIsWithinRoot } from "../project-procedures/shared";
import { splitTopLevelSqlStatements } from "../sql-statement-split";
import {
  containsSqlFunctionCall,
  findSqlIdentifier,
  getFirstSqlIdentifier,
  getSqlIdentifierAt,
  skipSqlWhitespaceAndComments,
} from "../sql-first-identifier";
import { textToolResult } from "./metidos/shared";

const SQLITE_MAX_RENDER_ROWS = 200;
const SQLITE_MAX_ROWS_TO_READ = SQLITE_MAX_RENDER_ROWS + 1;
const SQLITE_TRUNCATION_NOTICE = `_Truncated to the first ${SQLITE_MAX_RENDER_ROWS} rows._`;

type PiSqliteToolScope = {
  worktreePathContext: string;
};

type SqliteQueryResultDetails = {
  columns: string[];
  path: string;
  relativePath: string;
  rowCount: number;
  rowsAffected: number | null;
  statementKind: "query" | "write";
  truncated: boolean;
};

const SqliteToolParameters = Type.Object({
  path: Type.String({
    description:
      "Path to the SQLite database file, relative to the current project root.",
    minLength: 1,
  }),
  query: Type.String({
    description: "Single SQLite statement to execute.",
    minLength: 1,
  }),
});

export function createPiSqliteTools(
  scope: PiSqliteToolScope,
): ToolDefinition[] {
  return [
    defineTool<typeof SqliteToolParameters, SqliteQueryResultDetails>({
      description:
        "Execute one read-only SQLite statement against a database file inside the current project. The database path must be relative to the project root. Query results are returned as markdown tables.",
      execute: async (_toolCallId, params) => {
        let resolvedPath = resolveRelativeSqliteToolPath(
          scope.worktreePathContext,
          params.path,
        );
        const statementText = requireSingleSqlStatement(params.query);
        assertSqliteStatementAllowed(statementText);
        assertSqliteReadStatementAllowed(statementText);
        if (!existsSync(resolvedPath)) {
          throw new Error(
            "SQLite database file must already exist for this tool.",
          );
        }
        resolvedPath = resolveRelativeSqliteToolPath(
          scope.worktreePathContext,
          params.path,
        );

        const database = new Database(resolvedPath, {
          create: false,
          strict: false,
        });
        try {
          const statement = database.prepare(statementText);
          const columns = [...statement.columnNames];
          if (columns.length > 0) {
            const { rows, truncated } =
              collectSqliteRowsForRendering(statement);
            const markdown = formatSqliteMarkdownTable(columns, rows, {
              truncated,
            });
            return textToolResult(markdown, {
              columns,
              path: resolvedPath,
              relativePath: params.path.trim(),
              rowCount: rows.length,
              rowsAffected: null,
              statementKind: "query",
              truncated,
            });
          }

          throw new Error(
            "Only read-only SQLite statements are allowed by the sqlite tool.",
          );
        } finally {
          database.close(false);
        }
      },
      label: "SQLite Query",
      name: "sqlite",
      parameters: SqliteToolParameters,
      promptGuidelines: [
        "Use this when you need to inspect a project-local SQLite database without using bash.",
        "The database path must stay relative to the current project root.",
        "Execute exactly one read-only SQLite statement per tool call.",
      ],
      promptSnippet:
        "Run one read-only SQLite statement against a project-local database file",
    }),
  ];
}

function collectSqliteRowsForRendering(
  statement: ReturnType<Database["prepare"]>,
): {
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
} {
  const rows: Array<Record<string, unknown>> = [];
  for (const row of statement.iterate() as Iterable<Record<string, unknown>>) {
    if (rows.length >= SQLITE_MAX_ROWS_TO_READ) {
      break;
    }
    rows.push(row);
  }
  const truncated = rows.length > SQLITE_MAX_RENDER_ROWS;
  if (truncated) {
    rows.length = SQLITE_MAX_RENDER_ROWS;
  }
  return { rows, truncated };
}

function resolveRelativeSqliteToolPath(
  worktreePath: string,
  candidatePath: string,
): string {
  const trimmedPath = candidatePath.trim();
  if (!trimmedPath) {
    throw new Error("Path is required.");
  }
  if (trimmedPath === ":memory:") {
    throw new Error(
      "In-memory SQLite databases are not allowed for this tool.",
    );
  }
  if (trimmedPath.startsWith("file:") || isAbsolute(trimmedPath)) {
    throw new Error("Path must be relative to the current project root.");
  }

  const absoluteWorktreePath = resolve(worktreePath);
  const absolutePath = resolve(absoluteWorktreePath, trimmedPath);
  if (!pathIsWithinRoot(absoluteWorktreePath, absolutePath)) {
    throw new Error(
      `Path is outside the current project root: ${candidatePath.trim()}`,
    );
  }

  const relativePath = relative(absoluteWorktreePath, absolutePath);
  if (relativePath === "" || relativePath.startsWith("..")) {
    throw new Error("Path must be relative to the current project root.");
  }
  if (!existsSync(absolutePath)) {
    return absolutePath;
  }
  const fileStat = lstatSync(absolutePath);
  if (fileStat.isSymbolicLink()) {
    throw new Error("SQLite database path must not be a symbolic link.");
  }
  const realWorktreePath = realpathSync(absoluteWorktreePath);
  const realDatabasePath = realpathSync(absolutePath);
  if (!pathIsWithinRoot(realWorktreePath, realDatabasePath)) {
    throw new Error(
      `Path resolves outside the current project root: ${candidatePath.trim()}`,
    );
  }

  const databaseHandle = openSync(realDatabasePath, sqliteDatabaseOpenFlags());
  closeSync(databaseHandle);

  return realDatabasePath;
}

function sqliteDatabaseOpenFlags(): number {
  return process.platform === "win32"
    ? fsConstants.O_RDONLY
    : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
}

function requireSingleSqlStatement(query: string): string {
  const statements = splitTopLevelSqlStatements(query);
  if (statements.length === 0) {
    throw new Error("Query is required.");
  }
  if (statements.length > 1) {
    throw new Error("Exactly one SQLite statement is required per tool call.");
  }
  return statements[0] ?? "";
}

function assertSqliteStatementAllowed(statementText: string): void {
  const firstIdentifier = getFirstSqlIdentifier(statementText);
  const firstKeyword = firstIdentifier?.value.toLowerCase() ?? "";

  if (firstKeyword === "attach") {
    throw new Error("ATTACH is not allowed by the sqlite tool.");
  }

  if (firstKeyword === "detach") {
    throw new Error("DETACH is not allowed by the sqlite tool.");
  }

  if (
    firstKeyword === "vacuum" &&
    firstIdentifier &&
    findSqlIdentifier(statementText, firstIdentifier.nextIndex, "into")
  ) {
    throw new Error("VACUUM INTO is not allowed by the sqlite tool.");
  }

  if (containsSqlFunctionCall(statementText, "load_extension")) {
    throw new Error("load_extension() is not allowed by the sqlite tool.");
  }

  assertSqlitePragmaAllowed(statementText);
}

function assertSqliteReadStatementAllowed(statementText: string): void {
  const firstKeyword =
    getFirstSqlIdentifier(statementText)?.value.toLowerCase() ?? "";
  if (firstKeyword !== "select" && firstKeyword !== "with") {
    throw new Error(
      "Only read-only SELECT statements are allowed by the sqlite tool.",
    );
  }
}

function assertSqlitePragmaAllowed(statementText: string): void {
  const firstIdentifier = getFirstSqlIdentifier(statementText);
  if (firstIdentifier?.value.toLowerCase() !== "pragma") {
    return;
  }

  const assignmentIndex = skipSqlWhitespaceAndComments(
    statementText,
    firstIdentifier.nextIndex,
  );
  if ((statementText[assignmentIndex] ?? "") === "=") {
    throw new Error(
      "Writable PRAGMA statements are not allowed by the sqlite tool.",
    );
  }
  if (containsSqlFunctionCall(statementText, "journal_mode")) {
    throw new Error(
      "Writable PRAGMA statements are not allowed by the sqlite tool.",
    );
  }

  const allowedReadOnlyPragmas = [
    "database_list",
    "foreign_key_list",
    "index_info",
    "index_list",
    "index_xinfo",
    "table_info",
    "table_xinfo",
  ];
  const pragmaNameIdentifier = getSqlIdentifierAt(
    statementText,
    firstIdentifier.nextIndex,
  );
  const pragmaName = pragmaNameIdentifier?.value.toLowerCase() ?? "";
  if (!allowedReadOnlyPragmas.includes(pragmaName)) {
    throw new Error(
      "Only read-only schema PRAGMA statements are allowed by the sqlite tool.",
    );
  }
}

function formatSqliteMarkdownTable(
  columns: string[],
  rows: Array<Record<string, unknown>>,
  options?: {
    truncated?: boolean;
  },
): string {
  const header = `| ${columns.map((column) => escapeMarkdownTableCell(column)).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const bodyRows =
    rows.length > 0
      ? rows.map(
          (row) =>
            `| ${columns
              .map((column) => formatMarkdownTableValue(row[column]))
              .join(" | ")} |`,
        )
      : [
          `| ${columns
            .map((_column, index) => (index === 0 ? "_No rows_" : ""))
            .join(" | ")} |`,
        ];

  return [
    header,
    separator,
    ...bodyRows,
    ...(options?.truncated ? ["", SQLITE_TRUNCATION_NOTICE] : []),
  ].join("\n");
}

function formatMarkdownTableValue(value: unknown): string {
  if (value === null || typeof value === "undefined") {
    return "NULL";
  }
  if (typeof value === "string") {
    return escapeMarkdownTableCell(value).replaceAll(/\r?\n/gu, "<br />");
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (value instanceof Uint8Array) {
    return `<binary ${value.byteLength} B>`;
  }
  if (value instanceof ArrayBuffer) {
    return `<binary ${value.byteLength} B>`;
  }
  try {
    return escapeMarkdownTableCell(JSON.stringify(value) ?? String(value));
  } catch {
    return escapeMarkdownTableCell(String(value));
  }
}

function escapeMarkdownTableCell(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}
