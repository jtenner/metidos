/**
 * @file src/bun/project-procedures/task-graph-filesystem.ts
 * @description Shared reader and canonical writer helpers for the git-native task graph.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const TASK_GRAPH_CONFIG_FILENAME = "config.toml";
export const TASK_GRAPH_TAGS_FILENAME = "tags.toml";
export const TASK_GRAPH_TYPES_FILENAME = "types.toml";
export const TASK_GRAPH_ITEMS_DIRECTORY_NAME = "items";
export const TASK_GRAPH_TASK_FILENAME = "task.toml";
export const TASK_GRAPH_BODY_FILENAME = "body.md";

const TASK_GRAPH_MULTI_LINK_SECTION_ORDER = [
  "blockers",
  "caused_by",
  "docs_for",
  "duplicates",
  "implements",
  "mitigates",
  "references",
  "related",
  "supersedes",
  "tests_for",
] as const;

export type TaskGraphConfig = {
  body_format: string;
  defaults: {
    priority: string | null;
    status: string | null;
    type: string | null;
  };
  id_prefix: string;
  schema: string;
  strict_tags: boolean;
  strict_types: boolean;
};

export type TaskGraphTagRegistration = {
  description: string | null;
  exclusive_group: string | null;
  name: string;
};

export type TaskGraphTagRegistry = {
  schema: string;
  tag: TaskGraphTagRegistration[];
};

export type TaskGraphTypeRegistration = {
  description: string | null;
  name: string;
};

export type TaskGraphTypeRegistry = {
  schema: string;
  type: TaskGraphTypeRegistration[];
};

export type TaskGraphTaskLinks = {
  blockers: string[];
  caused_by: string[];
  docs_for: string[];
  duplicates: string[];
  implements: string[];
  mitigates: string[];
  parent: string | null;
  references: string[];
  related: string[];
  supersedes: string[];
  tests_for: string[];
};

export type TaskGraphTask = {
  assignees: string[];
  closed_at: string | null;
  created_at: string;
  created_by: string | null;
  id: string;
  links: TaskGraphTaskLinks;
  milestone: string | null;
  priority: string;
  schema: string;
  severity: string | null;
  size: string | null;
  status: string;
  tags: string[];
  title: string;
  type: string;
};

export type TaskGraphTaskFile = {
  body: string;
  paths: {
    body_md: string;
    directory: string;
    task_toml: string;
  };
  task: TaskGraphTask;
};

export type LoadedTaskGraphFilesystem = {
  config: TaskGraphConfig;
  paths: {
    config: string;
    items: string;
    root: string;
    tags: string | null;
    types: string | null;
  };
  tags: TaskGraphTagRegistry | null;
  tasks: TaskGraphTaskFile[];
  tasks_by_id: Map<string, TaskGraphTaskFile>;
  types: TaskGraphTypeRegistry | null;
};

export type InitTaskGraphFilesystemInput = {
  createTagsRegistry?: boolean;
  createTypesRegistry?: boolean;
  idPrefix?: string;
  strictTags?: boolean;
  strictTypes?: boolean;
};

export type TaskGraphInitializationStatus = "created" | "existing" | "skipped";

export type InitTaskGraphFilesystemResult = {
  config: TaskGraphConfig;
  paths: {
    config: string;
    items: string;
    root: string;
    tags: string | null;
    types: string | null;
  };
  status: {
    config: Exclude<TaskGraphInitializationStatus, "skipped">;
    items: Exclude<TaskGraphInitializationStatus, "skipped">;
    root: Exclude<TaskGraphInitializationStatus, "skipped">;
    tags: TaskGraphInitializationStatus;
    types: TaskGraphInitializationStatus;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseTomlDocument(
  documentText: string,
  filePath: string,
): Record<string, unknown> {
  try {
    const parsed = Bun.TOML.parse(documentText);
    if (!isRecord(parsed)) {
      throw new Error("TOML document did not parse into a table.");
    }
    return parsed;
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Failed to parse TOML document.";
    throw new Error(`${filePath}: ${message}`, {
      cause: error,
    });
  }
}

function optionalRecordField(
  record: Record<string, unknown>,
  fieldName: string,
  filePath: string,
): Record<string, unknown> | null {
  const value = record[fieldName];
  if (typeof value === "undefined") {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error(`${filePath}: expected [${fieldName}] to be a TOML table.`);
  }
  return value;
}

function requireStringField(
  record: Record<string, unknown>,
  fieldName: string,
  filePath: string,
): string {
  const value = record[fieldName];
  if (typeof value !== "string") {
    throw new Error(`${filePath}: expected ${fieldName} to be a string.`);
  }
  return value;
}

function optionalStringField(
  record: Record<string, unknown>,
  fieldName: string,
  filePath: string,
): string | null {
  const value = record[fieldName];
  if (typeof value === "undefined") {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${filePath}: expected ${fieldName} to be a string.`);
  }
  return value;
}

function optionalBooleanField(
  record: Record<string, unknown>,
  fieldName: string,
  filePath: string,
  defaultValue: boolean,
): boolean {
  const value = record[fieldName];
  if (typeof value === "undefined") {
    return defaultValue;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${filePath}: expected ${fieldName} to be a boolean.`);
  }
  return value;
}

function optionalStringArrayField(
  record: Record<string, unknown>,
  fieldName: string,
  filePath: string,
): string[] {
  const value = record[fieldName];
  if (typeof value === "undefined") {
    return [];
  }
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(
      `${filePath}: expected ${fieldName} to be an array of strings.`,
    );
  }
  return [...value];
}

function optionalArrayOfRecordsField(
  record: Record<string, unknown>,
  fieldName: string,
  filePath: string,
): Record<string, unknown>[] {
  const value = record[fieldName];
  if (typeof value === "undefined") {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => !isRecord(entry))) {
    throw new Error(
      `${filePath}: expected ${fieldName} to be an array of TOML tables.`,
    );
  }
  return [...value] as Record<string, unknown>[];
}

function parseTaskGraphConfig(
  document: Record<string, unknown>,
  filePath: string,
): TaskGraphConfig {
  const defaults = optionalRecordField(document, "defaults", filePath);
  return {
    body_format: requireStringField(document, "body_format", filePath),
    defaults: {
      priority: defaults
        ? optionalStringField(defaults, "priority", filePath)
        : null,
      status: defaults
        ? optionalStringField(defaults, "status", filePath)
        : null,
      type: defaults ? optionalStringField(defaults, "type", filePath) : null,
    },
    id_prefix: requireStringField(document, "id_prefix", filePath),
    schema: requireStringField(document, "schema", filePath),
    strict_tags: optionalBooleanField(document, "strict_tags", filePath, false),
    strict_types: optionalBooleanField(
      document,
      "strict_types",
      filePath,
      false,
    ),
  };
}

function parseTaskGraphTagRegistry(
  document: Record<string, unknown>,
  filePath: string,
): TaskGraphTagRegistry {
  return {
    schema: requireStringField(document, "schema", filePath),
    tag: optionalArrayOfRecordsField(document, "tag", filePath).map(
      (entry) => ({
        description: optionalStringField(entry, "description", filePath),
        exclusive_group: optionalStringField(
          entry,
          "exclusive_group",
          filePath,
        ),
        name: requireStringField(entry, "name", filePath),
      }),
    ),
  };
}

function parseTaskGraphTypeRegistry(
  document: Record<string, unknown>,
  filePath: string,
): TaskGraphTypeRegistry {
  return {
    schema: requireStringField(document, "schema", filePath),
    type: optionalArrayOfRecordsField(document, "type", filePath).map(
      (entry) => ({
        description: optionalStringField(entry, "description", filePath),
        name: requireStringField(entry, "name", filePath),
      }),
    ),
  };
}

function parseTaskGraphLinks(
  document: Record<string, unknown>,
  filePath: string,
): TaskGraphTaskLinks {
  const links: TaskGraphTaskLinks = {
    blockers: [],
    caused_by: [],
    docs_for: [],
    duplicates: [],
    implements: [],
    mitigates: [],
    parent: null,
    references: [],
    related: [],
    supersedes: [],
    tests_for: [],
  };

  for (const sectionName of TASK_GRAPH_MULTI_LINK_SECTION_ORDER) {
    const section = optionalRecordField(document, sectionName, filePath);
    links[sectionName] = section
      ? optionalStringArrayField(section, "tasks", filePath)
      : [];
  }

  const parent = optionalRecordField(document, "parent", filePath);
  links.parent = parent ? requireStringField(parent, "task", filePath) : null;
  return links;
}

function parseTaskGraphTask(
  document: Record<string, unknown>,
  filePath: string,
): TaskGraphTask {
  return {
    assignees: optionalStringArrayField(document, "assignees", filePath),
    closed_at: optionalStringField(document, "closed_at", filePath),
    created_at: requireStringField(document, "created_at", filePath),
    created_by: optionalStringField(document, "created_by", filePath),
    id: requireStringField(document, "id", filePath),
    links: parseTaskGraphLinks(document, filePath),
    milestone: optionalStringField(document, "milestone", filePath),
    priority: requireStringField(document, "priority", filePath),
    schema: requireStringField(document, "schema", filePath),
    severity: optionalStringField(document, "severity", filePath),
    size: optionalStringField(document, "size", filePath),
    status: requireStringField(document, "status", filePath),
    tags: optionalStringArrayField(document, "tags", filePath),
    title: requireStringField(document, "title", filePath),
    type: requireStringField(document, "type", filePath),
  };
}

async function readOptionalTomlFile<T>(
  filePath: string,
  parser: (document: Record<string, unknown>, filePath: string) => T,
): Promise<T | null> {
  try {
    const documentText = await readFile(filePath, "utf8");
    return parser(parseTomlDocument(documentText, filePath), filePath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export async function loadTaskGraphTaskFile(
  taskDirectoryPath: string,
): Promise<TaskGraphTaskFile> {
  const directory = resolve(taskDirectoryPath);
  const taskTomlPath = join(directory, TASK_GRAPH_TASK_FILENAME);
  const bodyPath = join(directory, TASK_GRAPH_BODY_FILENAME);
  const [taskTomlText, body] = await Promise.all([
    readFile(taskTomlPath, "utf8"),
    readFile(bodyPath, "utf8"),
  ]);
  return {
    body,
    paths: {
      body_md: bodyPath,
      directory,
      task_toml: taskTomlPath,
    },
    task: parseTaskGraphTask(
      parseTomlDocument(taskTomlText, taskTomlPath),
      taskTomlPath,
    ),
  };
}

export async function loadTaskGraphFilesystem(
  rootPath: string,
): Promise<LoadedTaskGraphFilesystem> {
  const resolvedRootPath = resolve(rootPath);
  const configPath = join(resolvedRootPath, TASK_GRAPH_CONFIG_FILENAME);
  const tagsPath = join(resolvedRootPath, TASK_GRAPH_TAGS_FILENAME);
  const typesPath = join(resolvedRootPath, TASK_GRAPH_TYPES_FILENAME);
  const itemsPath = join(resolvedRootPath, TASK_GRAPH_ITEMS_DIRECTORY_NAME);

  const [configText, tags, types, itemEntries] = await Promise.all([
    readFile(configPath, "utf8"),
    readOptionalTomlFile(tagsPath, parseTaskGraphTagRegistry),
    readOptionalTomlFile(typesPath, parseTaskGraphTypeRegistry),
    readdir(itemsPath, { withFileTypes: true }),
  ]);
  const tasks = await Promise.all(
    itemEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => loadTaskGraphTaskFile(join(itemsPath, entry.name))),
  );
  tasks.sort((left, right) => left.task.id.localeCompare(right.task.id));
  return {
    config: parseTaskGraphConfig(
      parseTomlDocument(configText, configPath),
      configPath,
    ),
    paths: {
      config: configPath,
      items: itemsPath,
      root: resolvedRootPath,
      tags: tags ? tagsPath : null,
      types: types ? typesPath : null,
    },
    tags,
    tasks,
    tasks_by_id: new Map(tasks.map((taskFile) => [taskFile.task.id, taskFile])),
    types,
  };
}

function uniqueValuesPreservingOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function canonicalizeSortedStringArray(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function formatTomlString(value: string): string {
  return JSON.stringify(value);
}

function formatTomlStringArray(values: readonly string[]): string {
  return `[${values.map((value) => formatTomlString(value)).join(", ")}]`;
}

function normalizeTextFile(text: string): string {
  const normalized = text.replace(/\r\n?/gu, "\n");
  if (!normalized) {
    return "";
  }
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

export function buildDefaultTaskGraphConfig(
  input: InitTaskGraphFilesystemInput = {},
): TaskGraphConfig {
  return {
    body_format: "markdown",
    defaults: {
      priority: "p2",
      status: "open",
      type: "task",
    },
    id_prefix: input.idPrefix ?? "tg",
    schema: "metidos.task-graph/v2",
    strict_tags: input.strictTags ?? false,
    strict_types: input.strictTypes ?? false,
  };
}

function buildEmptyTaskGraphTagRegistry(): TaskGraphTagRegistry {
  return {
    schema: "metidos.task-tags/v2",
    tag: [],
  };
}

function buildEmptyTaskGraphTypeRegistry(): TaskGraphTypeRegistry {
  return {
    schema: "metidos.task-types/v2",
    type: [],
  };
}

export function serializeTaskGraphConfigToml(config: TaskGraphConfig): string {
  const lines = [
    `schema = ${formatTomlString(config.schema)}`,
    `id_prefix = ${formatTomlString(config.id_prefix)}`,
    `body_format = ${formatTomlString(config.body_format)}`,
    `strict_tags = ${config.strict_tags ? "true" : "false"}`,
    `strict_types = ${config.strict_types ? "true" : "false"}`,
  ];
  const defaultLines: string[] = [];
  if (config.defaults.type !== null) {
    defaultLines.push(`type = ${formatTomlString(config.defaults.type)}`);
  }
  if (config.defaults.status !== null) {
    defaultLines.push(`status = ${formatTomlString(config.defaults.status)}`);
  }
  if (config.defaults.priority !== null) {
    defaultLines.push(
      `priority = ${formatTomlString(config.defaults.priority)}`,
    );
  }
  if (defaultLines.length > 0) {
    lines.push("", "[defaults]", ...defaultLines);
  }
  return `${lines.join("\n")}\n`;
}

export function serializeTaskGraphTagRegistryToml(
  registry: TaskGraphTagRegistry,
): string {
  const lines = [`schema = ${formatTomlString(registry.schema)}`];
  for (const entry of [...registry.tag].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    lines.push("", "[[tag]]", `name = ${formatTomlString(entry.name)}`);
    if (entry.description !== null) {
      lines.push(`description = ${formatTomlString(entry.description)}`);
    }
    if (entry.exclusive_group !== null) {
      lines.push(
        `exclusive_group = ${formatTomlString(entry.exclusive_group)}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function serializeTaskGraphTypeRegistryToml(
  registry: TaskGraphTypeRegistry,
): string {
  const lines = [`schema = ${formatTomlString(registry.schema)}`];
  for (const entry of [...registry.type].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    lines.push("", "[[type]]", `name = ${formatTomlString(entry.name)}`);
    if (entry.description !== null) {
      lines.push(`description = ${formatTomlString(entry.description)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function serializeTaskGraphTaskToml(task: TaskGraphTask): string {
  const lines = [
    `schema = ${formatTomlString(task.schema)}`,
    `id = ${formatTomlString(task.id)}`,
    `title = ${formatTomlString(task.title)}`,
    `type = ${formatTomlString(task.type)}`,
    `status = ${formatTomlString(task.status)}`,
    `priority = ${formatTomlString(task.priority)}`,
  ];
  if (task.severity !== null) {
    lines.push(`severity = ${formatTomlString(task.severity)}`);
  }
  if (task.size !== null) {
    lines.push(`size = ${formatTomlString(task.size)}`);
  }
  lines.push(`created_at = ${formatTomlString(task.created_at)}`);
  if (task.created_by !== null) {
    lines.push(`created_by = ${formatTomlString(task.created_by)}`);
  }

  const assignees = uniqueValuesPreservingOrder(task.assignees);
  if (assignees.length > 0) {
    lines.push(`assignees = ${formatTomlStringArray(assignees)}`);
  }

  const tags = canonicalizeSortedStringArray(task.tags);
  if (tags.length > 0) {
    lines.push(`tags = ${formatTomlStringArray(tags)}`);
  }

  if (task.milestone !== null) {
    lines.push(`milestone = ${formatTomlString(task.milestone)}`);
  }
  if (task.closed_at !== null) {
    lines.push(`closed_at = ${formatTomlString(task.closed_at)}`);
  }

  const linkTableLines: string[] = [];
  for (const sectionName of TASK_GRAPH_MULTI_LINK_SECTION_ORDER) {
    const values = canonicalizeSortedStringArray(task.links[sectionName]);
    if (values.length === 0) {
      continue;
    }
    if (linkTableLines.length > 0) {
      linkTableLines.push("");
    }
    linkTableLines.push(
      `[${sectionName}]`,
      `tasks = ${formatTomlStringArray(values)}`,
    );
  }

  if (task.links.parent !== null) {
    if (linkTableLines.length > 0) {
      linkTableLines.push("");
    }
    linkTableLines.push(
      "[parent]",
      `task = ${formatTomlString(task.links.parent)}`,
    );
  }

  if (linkTableLines.length > 0) {
    lines.push("", ...linkTableLines);
  }
  return `${lines.join("\n")}\n`;
}

async function writeTextFileIfChanged(
  filePath: string,
  nextText: string,
): Promise<boolean> {
  const normalizedText = normalizeTextFile(nextText);
  let currentText: string | null = null;
  try {
    currentText = await readFile(filePath, "utf8");
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
  if (currentText === normalizedText) {
    return false;
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, normalizedText, "utf8");
  return true;
}

async function ensureDirectoryExists(
  directoryPath: string,
): Promise<Exclude<TaskGraphInitializationStatus, "skipped">> {
  const resolvedPath = resolve(directoryPath);
  try {
    const currentStats = await stat(resolvedPath);
    if (!currentStats.isDirectory()) {
      throw new Error(`${resolvedPath}: expected a directory.`);
    }
    return "existing";
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

  await mkdir(resolvedPath, { recursive: true });
  return "created";
}

async function writeTextFileIfMissing(
  filePath: string,
  nextText: string,
): Promise<Exclude<TaskGraphInitializationStatus, "skipped">> {
  const resolvedPath = resolve(filePath);
  try {
    const currentStats = await stat(resolvedPath);
    if (!currentStats.isFile()) {
      throw new Error(`${resolvedPath}: expected a file.`);
    }
    return "existing";
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

  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, normalizeTextFile(nextText), {
    encoding: "utf8",
    flag: "wx",
  });
  return "created";
}

async function detectOptionalFileStatus(
  filePath: string,
): Promise<TaskGraphInitializationStatus> {
  const resolvedPath = resolve(filePath);
  try {
    const currentStats = await stat(resolvedPath);
    if (!currentStats.isFile()) {
      throw new Error(`${resolvedPath}: expected a file.`);
    }
    return "existing";
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return "skipped";
    }
    throw error;
  }
}

export async function initTaskGraphFilesystem(
  rootPath: string,
  input: InitTaskGraphFilesystemInput = {},
): Promise<InitTaskGraphFilesystemResult> {
  const root = resolve(rootPath);
  const configPath = join(root, TASK_GRAPH_CONFIG_FILENAME);
  const itemsPath = join(root, TASK_GRAPH_ITEMS_DIRECTORY_NAME);
  const tagsPath = join(root, TASK_GRAPH_TAGS_FILENAME);
  const typesPath = join(root, TASK_GRAPH_TYPES_FILENAME);

  const rootStatus = await ensureDirectoryExists(root);
  const itemsStatus = await ensureDirectoryExists(itemsPath);
  const configStatus = await writeTextFileIfMissing(
    configPath,
    serializeTaskGraphConfigToml(buildDefaultTaskGraphConfig(input)),
  );

  const tagsStatus =
    input.createTagsRegistry === true
      ? await writeTextFileIfMissing(
          tagsPath,
          serializeTaskGraphTagRegistryToml(buildEmptyTaskGraphTagRegistry()),
        )
      : await detectOptionalFileStatus(tagsPath);
  const typesStatus =
    input.createTypesRegistry === true
      ? await writeTextFileIfMissing(
          typesPath,
          serializeTaskGraphTypeRegistryToml(buildEmptyTaskGraphTypeRegistry()),
        )
      : await detectOptionalFileStatus(typesPath);

  const graph = await loadTaskGraphFilesystem(root);
  return {
    config: graph.config,
    paths: graph.paths,
    status: {
      config: configStatus,
      items: itemsStatus,
      root: rootStatus,
      tags: tagsStatus,
      types: typesStatus,
    },
  };
}

export async function writeTaskGraphTaskFile(
  taskDirectoryPath: string,
  taskFile: Pick<TaskGraphTaskFile, "body" | "task">,
): Promise<{
  paths: TaskGraphTaskFile["paths"];
  wrote_body_md: boolean;
  wrote_task_toml: boolean;
}> {
  const directory = resolve(taskDirectoryPath);
  const taskTomlPath = join(directory, TASK_GRAPH_TASK_FILENAME);
  const bodyPath = join(directory, TASK_GRAPH_BODY_FILENAME);
  const [wroteTaskToml, wroteBody] = await Promise.all([
    writeTextFileIfChanged(
      taskTomlPath,
      serializeTaskGraphTaskToml(taskFile.task),
    ),
    writeTextFileIfChanged(bodyPath, taskFile.body),
  ]);
  return {
    paths: {
      body_md: bodyPath,
      directory,
      task_toml: taskTomlPath,
    },
    wrote_body_md: wroteBody,
    wrote_task_toml: wroteTaskToml,
  };
}
