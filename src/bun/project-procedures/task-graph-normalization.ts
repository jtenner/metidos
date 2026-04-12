/**
 * @file src/bun/project-procedures/task-graph-normalization.ts
 * @description Canonical normalization helpers for the git-native task graph.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  normalizeTaskGraphTextFile,
  parseTaskGraphTomlDocumentText,
  TASK_GRAPH_BODY_FILENAME,
  TASK_GRAPH_CONFIG_FILENAME,
  TASK_GRAPH_ITEMS_DIRECTORY_NAME,
  TASK_GRAPH_MULTI_LINK_SECTION_NAMES,
  TASK_GRAPH_TAGS_FILENAME,
  TASK_GRAPH_TASK_FILENAME,
  TASK_GRAPH_TYPES_FILENAME,
} from "./task-graph-filesystem";

type TomlPrimitive = boolean | number | string;
type TomlRecord = Record<string, unknown>;
type NormalizedTaskGraphFileKind =
  | "body_md"
  | "config_toml"
  | "tags_toml"
  | "task_toml"
  | "types_toml";
type TaskGraphDocumentKind = "config" | "tags" | "task" | "types";

const TASK_TOML_SCALAR_KEY_ORDER = [
  "schema",
  "id",
  "title",
  "type",
  "status",
  "priority",
  "severity",
  "size",
  "created_at",
  "created_by",
  "assignees",
  "tags",
  "milestone",
  "closed_at",
] as const;

const CONFIG_TOML_SCALAR_KEY_ORDER = [
  "schema",
  "id_prefix",
  "body_format",
  "strict_tags",
  "strict_types",
] as const;

const DEFAULTS_TOML_SCALAR_KEY_ORDER = ["type", "status", "priority"] as const;
const TAG_ENTRY_KEY_ORDER = ["name", "description", "exclusive_group"] as const;
const TYPE_ENTRY_KEY_ORDER = ["name", "description"] as const;
const TASK_TOML_TABLE_KEY_ORDER = [
  ...TASK_GRAPH_MULTI_LINK_SECTION_NAMES,
  "parent",
] as const;
const CONFIG_TOML_TABLE_KEY_ORDER = ["defaults"] as const;
const TAGS_TOML_AOT_KEY_ORDER = ["tag"] as const;
const TYPES_TOML_AOT_KEY_ORDER = ["type"] as const;

export type NormalizeTaskGraphFilesystemInput = {
  taskIds?: string[];
};

export type NormalizeTaskGraphFilesystemFileResult = {
  changed: boolean;
  file_kind: NormalizedTaskGraphFileKind;
  path: string;
  task_id: string | null;
};

export type NormalizeTaskGraphFilesystemResult = {
  changed_files: NormalizeTaskGraphFilesystemFileResult[];
  normalized_task_ids: string[];
  root: string;
  unchanged_files: NormalizeTaskGraphFilesystemFileResult[];
};

function isRecord(value: unknown): value is TomlRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTomlPrimitive(value: unknown): value is TomlPrimitive {
  return (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  );
}

function isTomlPrimitiveArray(value: unknown): value is TomlPrimitive[] {
  return Array.isArray(value) && value.every((entry) => isTomlPrimitive(entry));
}

function isKnownArrayOfTablesKey(
  documentKind: TaskGraphDocumentKind,
  path: readonly string[],
  key: string,
): boolean {
  return (
    path.length === 0 &&
    ((documentKind === "tags" && key === "tag") ||
      (documentKind === "types" && key === "type"))
  );
}

function isTomlArrayOfRecords(
  value: unknown,
  documentKind: TaskGraphDocumentKind,
  path: readonly string[],
  key: string,
): value is TomlRecord[] {
  if (!Array.isArray(value)) {
    return false;
  }
  if (value.length === 0) {
    return isKnownArrayOfTablesKey(documentKind, path, key);
  }
  return value.every((entry) => isRecord(entry));
}

function uniqueSortedStringArray(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueRequestedTaskIds(taskIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const taskId of taskIds) {
    if (seen.has(taskId)) {
      continue;
    }
    seen.add(taskId);
    result.push(taskId);
  }
  return result;
}

function formatTomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/u.test(key) ? key : JSON.stringify(key);
}

function formatTomlSectionPath(path: readonly string[]): string {
  return path.map((segment) => formatTomlKey(segment)).join(".");
}

function formatTomlPrimitive(value: TomlPrimitive): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return Number.isFinite(value) ? `${value}` : JSON.stringify(`${value}`);
}

function formatTomlPrimitiveArray(values: readonly TomlPrimitive[]): string {
  return `[${values.map((value) => formatTomlPrimitive(value)).join(", ")}]`;
}

function canonicalizeScalarValue(
  documentKind: TaskGraphDocumentKind,
  path: readonly string[],
  key: string,
  value: unknown,
): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  if (!value.every((entry) => typeof entry === "string")) {
    return value;
  }

  if (documentKind === "task" && path.length === 0) {
    if (key === "assignees" || key === "tags") {
      return uniqueSortedStringArray(value);
    }
  }

  if (
    documentKind === "task" &&
    path.length === 1 &&
    TASK_GRAPH_MULTI_LINK_SECTION_NAMES.includes(path[0] as never) &&
    key === "tasks"
  ) {
    return uniqueSortedStringArray(value);
  }

  return value;
}

function orderedKeys(
  record: TomlRecord,
  keys: readonly string[],
  predicate: (key: string, value: unknown) => boolean,
): string[] {
  const originalKeys = Object.keys(record).filter((key) =>
    predicate(key, record[key]),
  );
  const prioritizedKeys = keys.filter((key) => originalKeys.includes(key));
  const prioritySet = new Set(prioritizedKeys);
  return [
    ...prioritizedKeys,
    ...originalKeys.filter((key) => !prioritySet.has(key)),
  ];
}

function topLevelScalarKeyOrder(
  documentKind: TaskGraphDocumentKind,
  path: readonly string[],
): readonly string[] {
  if (path.length > 0) {
    if (documentKind === "task" && path.length === 1) {
      if (TASK_GRAPH_MULTI_LINK_SECTION_NAMES.includes(path[0] as never)) {
        return ["tasks"];
      }
      if (path[0] === "parent") {
        return ["task"];
      }
      if (path[0] === "defaults") {
        return DEFAULTS_TOML_SCALAR_KEY_ORDER;
      }
      if (path[0] === "tag") {
        return TAG_ENTRY_KEY_ORDER;
      }
      if (path[0] === "type") {
        return TYPE_ENTRY_KEY_ORDER;
      }
    }
    if (
      documentKind === "config" &&
      path.length === 1 &&
      path[0] === "defaults"
    ) {
      return DEFAULTS_TOML_SCALAR_KEY_ORDER;
    }
    if (documentKind === "tags" && path.length === 1 && path[0] === "tag") {
      return TAG_ENTRY_KEY_ORDER;
    }
    if (documentKind === "types" && path.length === 1 && path[0] === "type") {
      return TYPE_ENTRY_KEY_ORDER;
    }
    return [];
  }

  switch (documentKind) {
    case "config":
      return CONFIG_TOML_SCALAR_KEY_ORDER;
    case "tags":
    case "types":
      return ["schema"];
    case "task":
      return TASK_TOML_SCALAR_KEY_ORDER;
  }
}

function topLevelTableKeyOrder(
  documentKind: TaskGraphDocumentKind,
  path: readonly string[],
): readonly string[] {
  if (path.length > 0) {
    return [];
  }
  switch (documentKind) {
    case "config":
      return CONFIG_TOML_TABLE_KEY_ORDER;
    case "task":
      return TASK_TOML_TABLE_KEY_ORDER;
    case "tags":
    case "types":
      return [];
  }
}

function topLevelArrayOfTablesKeyOrder(
  documentKind: TaskGraphDocumentKind,
  path: readonly string[],
): readonly string[] {
  if (path.length > 0) {
    return [];
  }
  switch (documentKind) {
    case "tags":
      return TAGS_TOML_AOT_KEY_ORDER;
    case "types":
      return TYPES_TOML_AOT_KEY_ORDER;
    case "config":
    case "task":
      return [];
  }
}

function sortArrayOfTableEntries(
  documentKind: TaskGraphDocumentKind,
  path: readonly string[],
  key: string,
  entries: readonly TomlRecord[],
): TomlRecord[] {
  if (
    path.length === 0 &&
    ((documentKind === "tags" && key === "tag") ||
      (documentKind === "types" && key === "type"))
  ) {
    return [...entries]
      .map((entry, index) => ({
        entry,
        index,
        name: typeof entry.name === "string" ? entry.name : null,
      }))
      .sort((left, right) => {
        if (left.name === null && right.name === null) {
          return left.index - right.index;
        }
        if (left.name === null) {
          return 1;
        }
        if (right.name === null) {
          return -1;
        }
        return left.name.localeCompare(right.name) || left.index - right.index;
      })
      .map(({ entry }) => entry);
  }
  return [...entries];
}

function serializeTomlRecord(
  record: TomlRecord,
  documentKind: TaskGraphDocumentKind,
  path: readonly string[] = [],
): string[] {
  const scalarKeys = orderedKeys(
    record,
    topLevelScalarKeyOrder(documentKind, path),
    (key, value) =>
      isTomlPrimitive(value) ||
      (isTomlPrimitiveArray(value) &&
        !isKnownArrayOfTablesKey(documentKind, path, key)),
  );
  const tableKeys = orderedKeys(
    record,
    topLevelTableKeyOrder(documentKind, path),
    (_key, value) => isRecord(value),
  );
  const arrayOfTableKeys = orderedKeys(
    record,
    topLevelArrayOfTablesKeyOrder(documentKind, path),
    (key, value) => isTomlArrayOfRecords(value, documentKind, path, key),
  );

  const lines: string[] = [];
  for (const key of scalarKeys) {
    const value = canonicalizeScalarValue(documentKind, path, key, record[key]);
    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      lines.push(
        `${formatTomlKey(key)} = ${formatTomlPrimitiveArray(
          value.filter((entry): entry is TomlPrimitive =>
            isTomlPrimitive(entry),
          ),
        )}`,
      );
      continue;
    }
    if (!isTomlPrimitive(value)) {
      throw new Error(
        `Unsupported TOML scalar value at ${formatTomlSectionPath([...path, key])}.`,
      );
    }
    lines.push(`${formatTomlKey(key)} = ${formatTomlPrimitive(value)}`);
  }

  for (const key of tableKeys) {
    const value = record[key];
    if (!isRecord(value)) {
      continue;
    }
    const childLines = serializeTomlRecord(value, documentKind, [...path, key]);
    if (childLines.length === 0) {
      continue;
    }
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(`[${formatTomlSectionPath([...path, key])}]`, ...childLines);
  }

  for (const key of arrayOfTableKeys) {
    const value = record[key];
    if (!isTomlArrayOfRecords(value, documentKind, path, key)) {
      continue;
    }
    for (const entry of sortArrayOfTableEntries(
      documentKind,
      path,
      key,
      value,
    )) {
      const childLines = serializeTomlRecord(entry, documentKind, [
        ...path,
        key,
      ]);
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(`[[${formatTomlSectionPath([...path, key])}]]`, ...childLines);
    }
  }

  return lines;
}

function normalizeTomlDocumentText(
  documentText: string,
  filePath: string,
  documentKind: TaskGraphDocumentKind,
): string {
  const document = parseTaskGraphTomlDocumentText(documentText, filePath);
  return `${serializeTomlRecord(document, documentKind).join("\n")}\n`;
}

async function writeNormalizedTextFileIfChanged(
  filePath: string,
  nextText: string,
): Promise<boolean> {
  const normalizedText = normalizeTaskGraphTextFile(nextText);
  const currentText = await readFile(filePath, "utf8");
  if (currentText === normalizedText) {
    return false;
  }
  await Bun.write(filePath, normalizedText);
  return true;
}

async function normalizeTaskGraphBodyFile(
  bodyPath: string,
  taskId: string,
): Promise<NormalizeTaskGraphFilesystemFileResult> {
  const currentBody = await readFile(bodyPath, "utf8");
  return {
    changed: await writeNormalizedTextFileIfChanged(bodyPath, currentBody),
    file_kind: "body_md",
    path: resolve(bodyPath),
    task_id: taskId,
  };
}

async function normalizeTaskGraphTomlFile(
  filePath: string,
  fileKind: Exclude<NormalizedTaskGraphFileKind, "body_md">,
  documentKind: TaskGraphDocumentKind,
  taskId: string | null,
): Promise<NormalizeTaskGraphFilesystemFileResult> {
  const currentText = await readFile(filePath, "utf8");
  return {
    changed: await writeNormalizedTextFileIfChanged(
      filePath,
      normalizeTomlDocumentText(currentText, filePath, documentKind),
    ),
    file_kind: fileKind,
    path: resolve(filePath),
    task_id: taskId,
  };
}

async function normalizeSelectedTaskDirectory(
  taskDirectoryPath: string,
  taskId: string,
): Promise<NormalizeTaskGraphFilesystemFileResult[]> {
  const taskTomlPath = join(taskDirectoryPath, TASK_GRAPH_TASK_FILENAME);
  const bodyPath = join(taskDirectoryPath, TASK_GRAPH_BODY_FILENAME);
  return Promise.all([
    normalizeTaskGraphTomlFile(taskTomlPath, "task_toml", "task", taskId),
    normalizeTaskGraphBodyFile(bodyPath, taskId),
  ]);
}

export async function normalizeTaskGraphFilesystem(
  rootPath: string,
  input: NormalizeTaskGraphFilesystemInput = {},
): Promise<NormalizeTaskGraphFilesystemResult> {
  const root = resolve(rootPath);
  const itemsPath = join(root, TASK_GRAPH_ITEMS_DIRECTORY_NAME);
  const configPath = join(root, TASK_GRAPH_CONFIG_FILENAME);
  const tagsPath = join(root, TASK_GRAPH_TAGS_FILENAME);
  const typesPath = join(root, TASK_GRAPH_TYPES_FILENAME);

  const changedFiles: NormalizeTaskGraphFilesystemFileResult[] = [];
  const unchangedFiles: NormalizeTaskGraphFilesystemFileResult[] = [];

  if (input.taskIds === undefined) {
    const rootFileResults: NormalizeTaskGraphFilesystemFileResult[] = [
      await normalizeTaskGraphTomlFile(
        configPath,
        "config_toml",
        "config",
        null,
      ),
    ];

    try {
      rootFileResults.push(
        await normalizeTaskGraphTomlFile(tagsPath, "tags_toml", "tags", null),
      );
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        )
      ) {
        throw error;
      }
    }

    try {
      rootFileResults.push(
        await normalizeTaskGraphTomlFile(
          typesPath,
          "types_toml",
          "types",
          null,
        ),
      );
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        )
      ) {
        throw error;
      }
    }

    for (const result of rootFileResults) {
      if (result.changed) {
        changedFiles.push(result);
      } else {
        unchangedFiles.push(result);
      }
    }
  }

  const itemEntries = await readdir(itemsPath, {
    encoding: "utf8",
    withFileTypes: true,
  });
  const taskDirectories = new Map<string, string>();
  for (const entry of itemEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    taskDirectories.set(entry.name, join(itemsPath, entry.name));
  }

  const normalizedTaskIds =
    input.taskIds === undefined
      ? [...taskDirectories.keys()].sort((left, right) =>
          left.localeCompare(right),
        )
      : uniqueRequestedTaskIds(input.taskIds);

  for (const taskId of normalizedTaskIds) {
    const taskDirectoryPath = taskDirectories.get(taskId);
    if (!taskDirectoryPath) {
      throw new Error(`Unknown task graph task id: ${taskId}`);
    }
    const taskResults = await normalizeSelectedTaskDirectory(
      taskDirectoryPath,
      taskId,
    );
    for (const result of taskResults) {
      if (result.changed) {
        changedFiles.push(result);
      } else {
        unchangedFiles.push(result);
      }
    }
  }

  return {
    changed_files: changedFiles,
    normalized_task_ids: normalizedTaskIds,
    root,
    unchanged_files: unchangedFiles,
  };
}
