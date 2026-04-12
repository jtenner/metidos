/**
 * @file src/bun/project-procedures/task-graph-validation.ts
 * @description Structured validator for the git-native task graph.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  buildDefaultTaskGraphConfig,
  parseTaskGraphConfigText,
  parseTaskGraphTagRegistryText,
  parseTaskGraphTaskText,
  parseTaskGraphTypeRegistryText,
  TASK_GRAPH_BODY_FILENAME,
  TASK_GRAPH_CONFIG_FILENAME,
  TASK_GRAPH_ITEMS_DIRECTORY_NAME,
  TASK_GRAPH_MULTI_LINK_SECTION_NAMES,
  TASK_GRAPH_TAGS_FILENAME,
  TASK_GRAPH_TASK_FILENAME,
  TASK_GRAPH_TYPES_FILENAME,
  type TaskGraphConfig,
  type TaskGraphTagRegistry,
  type TaskGraphTask,
  type TaskGraphTypeRegistry,
} from "./task-graph-filesystem";

const CORE_TASK_TYPES: ReadonlySet<string> = new Set([
  "task",
  "feature",
  "bug",
  "docs",
  "risk",
  "blocker",
  "epic",
  "spike",
  "chore",
  "decision",
  "test",
  "refactor",
  "research",
] as const);

const CORE_STATUSES: ReadonlySet<string> = new Set([
  "open",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
  "duplicate",
] as const);

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "done",
  "cancelled",
  "duplicate",
] as const);
const CORE_PRIORITIES: ReadonlySet<string> = new Set([
  "p0",
  "p1",
  "p2",
  "p3",
  "p4",
] as const);
const CORE_SEVERITIES: ReadonlySet<string> = new Set([
  "critical",
  "high",
  "medium",
  "low",
] as const);
const CORE_SIZES: ReadonlySet<string> = new Set([
  "xs",
  "s",
  "m",
  "l",
  "xl",
] as const);
const TAG_SHAPE_PATTERN =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[a-z0-9]+(?:[._-][a-z0-9]+)*)?$/u;
const BLOCKER_JUSTIFICATION_PATTERNS = [
  "blocked by",
  "depends on",
  "waiting on",
  "waiting for",
  "requires ",
  "cannot proceed",
  "can't proceed",
  "until ",
  "once ",
  "because ",
] as const;

export type TaskGraphValidationSeverity = "error" | "warning";

export type TaskGraphValidationFinding = {
  code: string;
  field: string | null;
  message: string;
  path: string;
  related_task_id: string | null;
  severity: TaskGraphValidationSeverity;
  task_id: string | null;
};

export type ValidateTaskGraphFilesystemInput = {
  taskIds?: string[];
};

export type ValidateTaskGraphFilesystemResult = {
  errors: TaskGraphValidationFinding[];
  findings: TaskGraphValidationFinding[];
  ok: boolean;
  root: string;
  validated_task_ids: string[];
  warnings: TaskGraphValidationFinding[];
};

type ParsedTaskGraphRecord = {
  body: string | null;
  directory_name: string;
  paths: {
    body_md: string;
    directory: string;
    task_toml: string;
  };
  task: TaskGraphTask | null;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function taskIdPatternForPrefix(idPrefix: string): RegExp {
  return new RegExp(`^${escapeRegExp(idPrefix)}-[0-9a-hjkmnp-tv-z]{26}$`, "u");
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

function compareFindings(
  left: TaskGraphValidationFinding,
  right: TaskGraphValidationFinding,
): number {
  const severityOrder = { error: 0, warning: 1 } as const;
  return (
    severityOrder[left.severity] - severityOrder[right.severity] ||
    left.path.localeCompare(right.path) ||
    (left.task_id ?? "").localeCompare(right.task_id ?? "") ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}

function bodyHasBlockerJustification(body: string | null): boolean {
  if (!body) {
    return false;
  }
  const normalizedBody = body.toLowerCase();
  return BLOCKER_JUSTIFICATION_PATTERNS.some((pattern) =>
    normalizedBody.includes(pattern),
  );
}

function createFinding(
  severity: TaskGraphValidationSeverity,
  code: string,
  message: string,
  path: string,
  options: {
    field?: string;
    related_task_id?: string;
    task_id?: string;
  } = {},
): TaskGraphValidationFinding {
  return {
    code,
    field: options.field ?? null,
    message,
    path,
    related_task_id: options.related_task_id ?? null,
    severity,
    task_id: options.task_id ?? null,
  };
}

async function readRequiredTextFile(filePath: string): Promise<
  | {
      exists: true;
      text: string;
    }
  | {
      exists: false;
      reason: "missing";
    }
> {
  try {
    return {
      exists: true,
      text: await readFile(filePath, "utf8"),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return {
        exists: false,
        reason: "missing",
      };
    }
    throw error;
  }
}

async function readOptionalTextFile(filePath: string): Promise<
  | {
      exists: true;
      text: string;
    }
  | {
      exists: false;
    }
> {
  const fileResult = await readRequiredTextFile(filePath);
  if (!fileResult.exists) {
    return { exists: false };
  }
  return fileResult;
}

function validateConfig(
  config: TaskGraphConfig,
  configPath: string,
  findings: TaskGraphValidationFinding[],
  types: TaskGraphTypeRegistry | null,
): void {
  if (config.schema !== "metidos.task-graph/v2") {
    findings.push(
      createFinding(
        "error",
        "invalid_config_schema",
        `Expected config schema "metidos.task-graph/v2" but found "${config.schema}".`,
        configPath,
        { field: "schema" },
      ),
    );
  }
  if (config.body_format !== "markdown") {
    findings.push(
      createFinding(
        "error",
        "invalid_body_format",
        `Expected body_format "markdown" but found "${config.body_format}".`,
        configPath,
        { field: "body_format" },
      ),
    );
  }
  if (
    config.defaults.status !== null &&
    !CORE_STATUSES.has(config.defaults.status)
  ) {
    findings.push(
      createFinding(
        "error",
        "invalid_default_status",
        `Default status "${config.defaults.status}" is not a supported core status.`,
        configPath,
        { field: "defaults.status" },
      ),
    );
  }
  if (
    config.defaults.priority !== null &&
    !CORE_PRIORITIES.has(config.defaults.priority)
  ) {
    findings.push(
      createFinding(
        "error",
        "invalid_default_priority",
        `Default priority "${config.defaults.priority}" is not a supported core priority.`,
        configPath,
        { field: "defaults.priority" },
      ),
    );
  }
  if (config.defaults.type === null) {
    return;
  }
  if (CORE_TASK_TYPES.has(config.defaults.type)) {
    return;
  }
  const registeredTypes = new Set(types?.type.map((entry) => entry.name) ?? []);
  if (config.strict_types && !registeredTypes.has(config.defaults.type)) {
    findings.push(
      createFinding(
        "error",
        "invalid_default_type",
        `Default type "${config.defaults.type}" is not valid for this repository configuration.`,
        configPath,
        { field: "defaults.type" },
      ),
    );
  }
}

function validateRegistrySchemas(
  tags: TaskGraphTagRegistry | null,
  tagsPath: string,
  types: TaskGraphTypeRegistry | null,
  typesPath: string,
  findings: TaskGraphValidationFinding[],
): void {
  if (tags !== null && tags.schema !== "metidos.task-tags/v2") {
    findings.push(
      createFinding(
        "error",
        "invalid_tags_schema",
        `Expected tags registry schema "metidos.task-tags/v2" but found "${tags.schema}".`,
        tagsPath,
        { field: "schema" },
      ),
    );
  }
  if (types !== null && types.schema !== "metidos.task-types/v2") {
    findings.push(
      createFinding(
        "error",
        "invalid_types_schema",
        `Expected types registry schema "metidos.task-types/v2" but found "${types.schema}".`,
        typesPath,
        { field: "schema" },
      ),
    );
  }
}

function validateTaskShape(
  record: ParsedTaskGraphRecord,
  config: TaskGraphConfig,
  registeredTags: Set<string>,
  registeredTypes: Set<string>,
  knownTaskIds: Set<string>,
  incomingReferenceCounts: Map<string, number>,
  childCounts: Map<string, number>,
  duplicateTaskIds: Set<string>,
  findings: TaskGraphValidationFinding[],
): void {
  const task = record.task;
  if (task === null) {
    return;
  }

  const taskIdPattern = taskIdPatternForPrefix(config.id_prefix);
  if (!taskIdPattern.test(task.id)) {
    findings.push(
      createFinding(
        "error",
        "invalid_task_id",
        `Task id "${task.id}" does not match the expected "${config.id_prefix}-<lowercase-ulid>" format.`,
        record.paths.task_toml,
        {
          field: "id",
          task_id: task.id,
        },
      ),
    );
  }
  if (record.directory_name !== task.id) {
    findings.push(
      createFinding(
        "error",
        "task_directory_id_mismatch",
        `Task directory "${record.directory_name}" does not match task id "${task.id}".`,
        record.paths.directory,
        {
          field: "id",
          task_id: task.id,
        },
      ),
    );
  }
  if (task.schema !== "metidos.task/v2") {
    findings.push(
      createFinding(
        "error",
        "invalid_task_schema",
        `Expected task schema "metidos.task/v2" but found "${task.schema}".`,
        record.paths.task_toml,
        {
          field: "schema",
          task_id: task.id,
        },
      ),
    );
  }
  if (duplicateTaskIds.has(task.id)) {
    findings.push(
      createFinding(
        "error",
        "duplicate_task_id",
        `Task id "${task.id}" is duplicated elsewhere in the task graph.`,
        record.paths.task_toml,
        {
          field: "id",
          task_id: task.id,
        },
      ),
    );
  }
  if (!CORE_STATUSES.has(task.status)) {
    findings.push(
      createFinding(
        "error",
        "invalid_status",
        `Task status "${task.status}" is not a supported core status.`,
        record.paths.task_toml,
        {
          field: "status",
          task_id: task.id,
        },
      ),
    );
  }
  if (!CORE_PRIORITIES.has(task.priority)) {
    findings.push(
      createFinding(
        "error",
        "invalid_priority",
        `Task priority "${task.priority}" is not a supported core priority.`,
        record.paths.task_toml,
        {
          field: "priority",
          task_id: task.id,
        },
      ),
    );
  }
  if (task.severity !== null && !CORE_SEVERITIES.has(task.severity)) {
    findings.push(
      createFinding(
        "error",
        "invalid_severity",
        `Task severity "${task.severity}" is not a supported severity value.`,
        record.paths.task_toml,
        {
          field: "severity",
          task_id: task.id,
        },
      ),
    );
  }
  if (task.size !== null && !CORE_SIZES.has(task.size)) {
    findings.push(
      createFinding(
        "error",
        "invalid_size",
        `Task size "${task.size}" is not a supported size value.`,
        record.paths.task_toml,
        {
          field: "size",
          task_id: task.id,
        },
      ),
    );
  }
  if (
    config.strict_types &&
    !CORE_TASK_TYPES.has(task.type) &&
    !registeredTypes.has(task.type)
  ) {
    findings.push(
      createFinding(
        "error",
        "invalid_type",
        `Task type "${task.type}" is not a core type or registered repository type.`,
        record.paths.task_toml,
        {
          field: "type",
          task_id: task.id,
        },
      ),
    );
  }

  const seenTags = new Set<string>();
  for (const tag of task.tags) {
    if (seenTags.has(tag)) {
      findings.push(
        createFinding(
          "error",
          "duplicate_tag",
          `Task tag "${tag}" is duplicated.`,
          record.paths.task_toml,
          {
            field: "tags",
            task_id: task.id,
          },
        ),
      );
      continue;
    }
    seenTags.add(tag);
    if (!TAG_SHAPE_PATTERN.test(tag)) {
      findings.push(
        createFinding(
          "warning",
          "noncanonical_tag_shape",
          `Task tag "${tag}" does not match the recommended canonical tag shape.`,
          record.paths.task_toml,
          {
            field: "tags",
            task_id: task.id,
          },
        ),
      );
    }
    if (config.strict_tags && !registeredTags.has(tag)) {
      findings.push(
        createFinding(
          "error",
          "invalid_tag",
          `Task tag "${tag}" is not registered in tags.toml while strict_tags is enabled.`,
          record.paths.task_toml,
          {
            field: "tags",
            task_id: task.id,
          },
        ),
      );
    }
  }

  for (const sectionName of TASK_GRAPH_MULTI_LINK_SECTION_NAMES) {
    const linkTargets = task.links[sectionName];
    const seenTargets = new Set<string>();
    for (const targetTaskId of linkTargets) {
      if (seenTargets.has(targetTaskId)) {
        findings.push(
          createFinding(
            "error",
            "duplicate_link_target",
            `Link section "${sectionName}" references "${targetTaskId}" more than once.`,
            record.paths.task_toml,
            {
              field: sectionName,
              related_task_id: targetTaskId,
              task_id: task.id,
            },
          ),
        );
        continue;
      }
      seenTargets.add(targetTaskId);
      if (targetTaskId === task.id) {
        findings.push(
          createFinding(
            "error",
            "self_reference",
            `Link section "${sectionName}" cannot reference the task itself.`,
            record.paths.task_toml,
            {
              field: sectionName,
              related_task_id: targetTaskId,
              task_id: task.id,
            },
          ),
        );
      }
      if (!knownTaskIds.has(targetTaskId)) {
        findings.push(
          createFinding(
            "error",
            "missing_link_target",
            `Link section "${sectionName}" references missing task "${targetTaskId}".`,
            record.paths.task_toml,
            {
              field: sectionName,
              related_task_id: targetTaskId,
              task_id: task.id,
            },
          ),
        );
      }
    }
  }

  if (task.links.parent !== null) {
    if (task.links.parent === task.id) {
      findings.push(
        createFinding(
          "error",
          "self_reference",
          "Parent link cannot reference the task itself.",
          record.paths.task_toml,
          {
            field: "parent",
            related_task_id: task.links.parent,
            task_id: task.id,
          },
        ),
      );
    }
    if (!knownTaskIds.has(task.links.parent)) {
      findings.push(
        createFinding(
          "error",
          "invalid_parent_reference",
          `Parent link references missing task "${task.links.parent}".`,
          record.paths.task_toml,
          {
            field: "parent",
            related_task_id: task.links.parent,
            task_id: task.id,
          },
        ),
      );
    }
  }

  if (task.status === "duplicate" && task.links.duplicates.length === 0) {
    findings.push(
      createFinding(
        "warning",
        "missing_duplicates_link",
        'Duplicate tasks should usually include a "[duplicates]" link to the canonical task.',
        record.paths.task_toml,
        {
          field: "duplicates",
          task_id: task.id,
        },
      ),
    );
  }
  if (task.type === "docs" && task.links.docs_for.length === 0) {
    findings.push(
      createFinding(
        "warning",
        "missing_docs_for",
        'Docs tasks should usually include a "[docs_for]" link.',
        record.paths.task_toml,
        {
          field: "docs_for",
          task_id: task.id,
        },
      ),
    );
  }
  if (task.type === "test" && task.links.tests_for.length === 0) {
    findings.push(
      createFinding(
        "warning",
        "missing_tests_for",
        'Test tasks should usually include a "[tests_for]" link.',
        record.paths.task_toml,
        {
          field: "tests_for",
          task_id: task.id,
        },
      ),
    );
  }
  if (
    task.type === "blocker" &&
    (incomingReferenceCounts.get(task.id) ?? 0) === 0 &&
    !bodyHasBlockerJustification(record.body)
  ) {
    findings.push(
      createFinding(
        "warning",
        "unreferenced_blocker",
        "Blocker tasks should usually have an incoming reference or a strong justification in body.md.",
        record.paths.task_toml,
        {
          task_id: task.id,
        },
      ),
    );
  }
  if (task.type === "epic" && (childCounts.get(task.id) ?? 0) === 0) {
    findings.push(
      createFinding(
        "warning",
        "empty_epic",
        "Epic tasks should usually have child tasks pointing at them through [parent].",
        record.paths.task_toml,
        {
          task_id: task.id,
        },
      ),
    );
  }
  if (task.closed_at !== null && !TERMINAL_STATUSES.has(task.status)) {
    findings.push(
      createFinding(
        "warning",
        "unexpected_closed_at",
        "closed_at should usually be omitted for non-terminal statuses.",
        record.paths.task_toml,
        {
          field: "closed_at",
          task_id: task.id,
        },
      ),
    );
  }
  if (task.closed_at === null && TERMINAL_STATUSES.has(task.status)) {
    findings.push(
      createFinding(
        "warning",
        "missing_closed_at",
        "Terminal task statuses should usually include closed_at.",
        record.paths.task_toml,
        {
          field: "closed_at",
          task_id: task.id,
        },
      ),
    );
  }
}

export async function validateTaskGraphFilesystem(
  rootPath: string,
  input: ValidateTaskGraphFilesystemInput = {},
): Promise<ValidateTaskGraphFilesystemResult> {
  const root = resolve(rootPath);
  const findings: TaskGraphValidationFinding[] = [];
  const configPath = join(root, TASK_GRAPH_CONFIG_FILENAME);
  const itemsPath = join(root, TASK_GRAPH_ITEMS_DIRECTORY_NAME);
  const tagsPath = join(root, TASK_GRAPH_TAGS_FILENAME);
  const typesPath = join(root, TASK_GRAPH_TYPES_FILENAME);

  let config = buildDefaultTaskGraphConfig();
  const configFile = await readRequiredTextFile(configPath);
  if (!configFile.exists) {
    findings.push(
      createFinding(
        "error",
        "missing_config",
        "Task graph config.toml is required.",
        configPath,
      ),
    );
  } else {
    try {
      config = parseTaskGraphConfigText(configFile.text, configPath);
    } catch (error) {
      findings.push(
        createFinding(
          "error",
          "invalid_config",
          error instanceof Error
            ? error.message
            : "Failed to parse config.toml.",
          configPath,
        ),
      );
    }
  }

  let tags: TaskGraphTagRegistry | null = null;
  const tagsFile = await readOptionalTextFile(tagsPath);
  if (tagsFile.exists) {
    try {
      tags = parseTaskGraphTagRegistryText(tagsFile.text, tagsPath);
    } catch (error) {
      findings.push(
        createFinding(
          "error",
          "invalid_tags_registry",
          error instanceof Error ? error.message : "Failed to parse tags.toml.",
          tagsPath,
        ),
      );
    }
  }

  let types: TaskGraphTypeRegistry | null = null;
  const typesFile = await readOptionalTextFile(typesPath);
  if (typesFile.exists) {
    try {
      types = parseTaskGraphTypeRegistryText(typesFile.text, typesPath);
    } catch (error) {
      findings.push(
        createFinding(
          "error",
          "invalid_types_registry",
          error instanceof Error
            ? error.message
            : "Failed to parse types.toml.",
          typesPath,
        ),
      );
    }
  }

  validateRegistrySchemas(tags, tagsPath, types, typesPath, findings);
  validateConfig(config, configPath, findings, types);
  if (config.strict_tags && !tagsFile.exists) {
    findings.push(
      createFinding(
        "error",
        "missing_tags_registry",
        "strict_tags is enabled, but tags.toml is missing.",
        tagsPath,
      ),
    );
  }

  const taskRecords: ParsedTaskGraphRecord[] = [];
  let itemEntries: Array<{ isDirectory(): boolean; name: string }> = [];
  try {
    itemEntries = await readdir(itemsPath, {
      encoding: "utf8",
      withFileTypes: true,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      findings.push(
        createFinding(
          "error",
          "missing_items_directory",
          "Task graph items/ directory is required.",
          itemsPath,
        ),
      );
    } else {
      throw error;
    }
  }

  for (const entry of itemEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const taskDirectory = join(itemsPath, entry.name);
    const taskTomlPath = join(taskDirectory, TASK_GRAPH_TASK_FILENAME);
    const bodyPath = join(taskDirectory, TASK_GRAPH_BODY_FILENAME);
    const record: ParsedTaskGraphRecord = {
      body: null,
      directory_name: entry.name,
      paths: {
        body_md: bodyPath,
        directory: taskDirectory,
        task_toml: taskTomlPath,
      },
      task: null,
    };

    const taskToml = await readRequiredTextFile(taskTomlPath);
    if (!taskToml.exists) {
      findings.push(
        createFinding(
          "error",
          "missing_task_toml",
          "Task directories must contain task.toml.",
          taskTomlPath,
          { task_id: entry.name },
        ),
      );
    } else {
      try {
        record.task = parseTaskGraphTaskText(taskToml.text, taskTomlPath);
      } catch (error) {
        findings.push(
          createFinding(
            "error",
            "invalid_task_toml",
            error instanceof Error
              ? error.message
              : "Failed to parse task.toml.",
            taskTomlPath,
            { task_id: entry.name },
          ),
        );
      }
    }

    const bodyMd = await readRequiredTextFile(bodyPath);
    if (!bodyMd.exists) {
      findings.push(
        createFinding(
          "error",
          "missing_body_md",
          "Task directories must contain body.md.",
          bodyPath,
          {
            task_id: record.task?.id ?? entry.name,
          },
        ),
      );
    } else {
      record.body = bodyMd.text;
    }

    taskRecords.push(record);
  }

  const taskRecordsById = new Map<string, ParsedTaskGraphRecord[]>();
  for (const record of taskRecords) {
    if (record.task === null) {
      continue;
    }
    const existingRecords = taskRecordsById.get(record.task.id);
    if (existingRecords) {
      existingRecords.push(record);
    } else {
      taskRecordsById.set(record.task.id, [record]);
    }
  }

  const duplicateTaskIds = new Set<string>();
  for (const [taskId, records] of taskRecordsById) {
    if (records.length > 1) {
      duplicateTaskIds.add(taskId);
    }
  }

  const knownTaskIds = new Set(taskRecordsById.keys());
  const incomingReferenceCounts = new Map<string, number>();
  const childCounts = new Map<string, number>();
  for (const record of taskRecords) {
    const task = record.task;
    if (task === null) {
      continue;
    }
    for (const sectionName of TASK_GRAPH_MULTI_LINK_SECTION_NAMES) {
      for (const targetTaskId of task.links[sectionName]) {
        incomingReferenceCounts.set(
          targetTaskId,
          (incomingReferenceCounts.get(targetTaskId) ?? 0) + 1,
        );
      }
    }
    if (task.links.parent !== null) {
      incomingReferenceCounts.set(
        task.links.parent,
        (incomingReferenceCounts.get(task.links.parent) ?? 0) + 1,
      );
      childCounts.set(
        task.links.parent,
        (childCounts.get(task.links.parent) ?? 0) + 1,
      );
    }
  }

  const requestedTaskIds = uniqueValuesPreservingOrder(input.taskIds ?? []);
  if (requestedTaskIds.length === 0 && input.taskIds !== undefined) {
    // No-op subset is allowed, but still returns global config and filesystem findings.
  } else {
    for (const taskId of requestedTaskIds) {
      if (!knownTaskIds.has(taskId)) {
        findings.push(
          createFinding(
            "error",
            "unknown_requested_task_id",
            `Requested task "${taskId}" was not found in the task graph.`,
            itemsPath,
            { task_id: taskId },
          ),
        );
      }
    }
  }

  const validatedTaskIds =
    input.taskIds === undefined
      ? [...knownTaskIds].sort((left, right) => left.localeCompare(right))
      : requestedTaskIds.filter((taskId) => knownTaskIds.has(taskId));
  const validatedTaskIdSet = new Set(validatedTaskIds);

  const registeredTags = new Set(tags?.tag.map((entry) => entry.name) ?? []);
  const registeredTypes = new Set(types?.type.map((entry) => entry.name) ?? []);
  for (const record of taskRecords) {
    if (record.task === null || !validatedTaskIdSet.has(record.task.id)) {
      continue;
    }
    validateTaskShape(
      record,
      config,
      registeredTags,
      registeredTypes,
      knownTaskIds,
      incomingReferenceCounts,
      childCounts,
      duplicateTaskIds,
      findings,
    );
  }

  const errors = findings
    .filter((finding) => finding.severity === "error")
    .sort(compareFindings);
  const warnings = findings
    .filter((finding) => finding.severity === "warning")
    .sort(compareFindings);
  return {
    errors,
    findings: [...errors, ...warnings],
    ok: errors.length === 0,
    root,
    validated_task_ids: validatedTaskIds,
    warnings,
  };
}
