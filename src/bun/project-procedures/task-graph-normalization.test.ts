/**
 * @file src/bun/project-procedures/task-graph-normalization.test.ts
 * @description Focused coverage for canonical git-native task graph normalization.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  initTaskGraphFilesystem,
  parseTaskGraphTomlDocumentText,
} from "./task-graph-filesystem";
import { normalizeTaskGraphFilesystem } from "./task-graph-normalization";

const tempDirectories = new Set<string>();

function createTempDirectory(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "metidos-task-graph-normalization-"),
  );
  tempDirectories.add(directory);
  return directory;
}

function createTaskGraphRoot(): string {
  return join(createTempDirectory(), ".metidos", "tasks");
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

describe("task graph normalization", () => {
  it("normalizes canonical files and becomes a no-op on repeated runs", async () => {
    const root = createTaskGraphRoot();
    const taskId = "tg-01kp173j32mypsecqdb45npq5v";
    mkdirSync(join(root, "items", taskId), {
      recursive: true,
    });

    writeFileSync(
      join(root, "config.toml"),
      [
        "strict_types = false\r",
        'body_format = "markdown"\r',
        'id_prefix = "tg"\r',
        'schema = "metidos.task-graph/v2"\r',
        "strict_tags = false\r",
        "\r",
        "[defaults]\r",
        'priority = "p2"\r',
        'status = "open"\r',
        'type = "task"\r',
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(root, "tags.toml"),
      [
        'schema = "metidos.task-tags/v2"',
        "",
        "[[tag]]",
        'name = "theme:reliability"',
        'description = "Reliability"',
        "",
        "[[tag]]",
        'name = "area:task-graph"',
        'description = "Task graph"',
        'exclusive_group = "area"',
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(root, "types.toml"),
      [
        'schema = "metidos.task-types/v2"',
        "",
        "[[type]]",
        'name = "research"',
        'description = "Research work"',
        "",
        "[[type]]",
        'name = "decision"',
        'description = "Decision work"',
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(root, "items", taskId, "task.toml"),
      [
        'priority = "p1"',
        'schema = "metidos.task/v2"',
        'created_at = "2026-04-12T20:00:00Z"',
        'title = "Normalization fixture"',
        'status = "open"',
        'type = "feature"',
        'id = "tg-01kp173j32mypsecqdb45npq5v"',
        'assignees = ["reviewer", "agent", "agent"]',
        'tags = ["theme:reliability", "area:task-graph", "theme:reliability"]',
        "",
        "[related]",
        "tasks = []",
        "",
        "[blockers]",
        'tasks = ["tg-b", "tg-a", "tg-a"]',
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(root, "items", taskId, "body.md"),
      "Normalization body without trailing newline\r\nsecond line",
      "utf8",
    );

    const firstResult = await normalizeTaskGraphFilesystem(root);
    const secondResult = await normalizeTaskGraphFilesystem(root);

    expect(
      firstResult.changed_files.map((file) => file.file_kind).sort(),
    ).toEqual([
      "body_md",
      "config_toml",
      "tags_toml",
      "task_toml",
      "types_toml",
    ]);
    expect(secondResult.changed_files).toEqual([]);
    expect(readFileSync(join(root, "config.toml"), "utf8")).toBe(
      [
        'schema = "metidos.task-graph/v2"',
        'id_prefix = "tg"',
        'body_format = "markdown"',
        "strict_tags = false",
        "strict_types = false",
        "",
        "[defaults]",
        'type = "task"',
        'status = "open"',
        'priority = "p2"',
        "",
      ].join("\n"),
    );
    expect(readFileSync(join(root, "tags.toml"), "utf8")).toBe(
      [
        'schema = "metidos.task-tags/v2"',
        "",
        "[[tag]]",
        'name = "area:task-graph"',
        'description = "Task graph"',
        'exclusive_group = "area"',
        "",
        "[[tag]]",
        'name = "theme:reliability"',
        'description = "Reliability"',
        "",
      ].join("\n"),
    );
    expect(readFileSync(join(root, "types.toml"), "utf8")).toBe(
      [
        'schema = "metidos.task-types/v2"',
        "",
        "[[type]]",
        'name = "decision"',
        'description = "Decision work"',
        "",
        "[[type]]",
        'name = "research"',
        'description = "Research work"',
        "",
      ].join("\n"),
    );
    expect(readFileSync(join(root, "items", taskId, "task.toml"), "utf8")).toBe(
      [
        'schema = "metidos.task/v2"',
        'id = "tg-01kp173j32mypsecqdb45npq5v"',
        'title = "Normalization fixture"',
        'type = "feature"',
        'status = "open"',
        'priority = "p1"',
        'created_at = "2026-04-12T20:00:00Z"',
        'assignees = ["agent", "reviewer"]',
        'tags = ["area:task-graph", "theme:reliability"]',
        "",
        "[blockers]",
        'tasks = ["tg-a", "tg-b"]',
        "",
      ].join("\n"),
    );
    expect(readFileSync(join(root, "items", taskId, "body.md"), "utf8")).toBe(
      "Normalization body without trailing newline\nsecond line\n",
    );
  });

  it("preserves unknown-but-valid task fields and tables while normalizing known metadata", async () => {
    const root = createTaskGraphRoot();
    const taskId = "tg-01xxxxxxxxxxxxxxxxxxxxxxxx";
    await initTaskGraphFilesystem(root);
    mkdirSync(join(root, "items", taskId), {
      recursive: true,
    });

    writeFileSync(
      join(root, "items", taskId, "task.toml"),
      [
        'title = "Unknown preservation fixture"',
        'schema = "metidos.task/v2"',
        'priority = "p1"',
        'status = "open"',
        'type = "feature"',
        'id = "tg-01xxxxxxxxxxxxxxxxxxxxxxxx"',
        'created_at = "2026-04-12T20:00:00Z"',
        'custom_field = "keep me"',
        'tags = ["theme:reliability", "area:task-graph", "theme:reliability"]',
        "",
        "[blockers]",
        'tasks = ["tg-b", "tg-a", "tg-a"]',
        "",
        "[custom_meta]",
        'note = "keep this table"',
        'extra = ["b", "a"]',
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(root, "items", taskId, "body.md"),
      "Body text.\n",
      "utf8",
    );

    await normalizeTaskGraphFilesystem(root, {
      taskIds: [taskId],
    });

    const normalizedTaskToml = readFileSync(
      join(root, "items", taskId, "task.toml"),
      "utf8",
    );
    const normalizedDocument = parseTaskGraphTomlDocumentText(
      normalizedTaskToml,
      join(root, "items", taskId, "task.toml"),
    );

    expect(normalizedTaskToml).toContain('custom_field = "keep me"');
    expect(normalizedTaskToml).toContain("[custom_meta]");
    expect(normalizedTaskToml).toContain('note = "keep this table"');
    expect(normalizedTaskToml).toContain('extra = ["b", "a"]');
    expect(normalizedTaskToml).toContain(
      'tags = ["area:task-graph", "theme:reliability"]',
    );
    expect(normalizedTaskToml).toContain('tasks = ["tg-a", "tg-b"]');
    expect(normalizedDocument.custom_field).toBe("keep me");
    expect(normalizedDocument.custom_meta).toEqual({
      extra: ["b", "a"],
      note: "keep this table",
    });
  });

  it("normalizes only the requested task ids when a subset is provided", async () => {
    const root = createTaskGraphRoot();
    const targetTaskId = "tg-01fixturetaskgraph0000000011";
    const untouchedTaskId = "tg-01fixturetaskgraph0000000012";
    mkdirSync(join(root, "items", targetTaskId), {
      recursive: true,
    });
    mkdirSync(join(root, "items", untouchedTaskId), {
      recursive: true,
    });

    const messyConfig = [
      "strict_types = false",
      'body_format = "markdown"',
      'id_prefix = "tg"',
      'schema = "metidos.task-graph/v2"',
      "strict_tags = false",
      "",
    ].join("\n");
    writeFileSync(join(root, "config.toml"), messyConfig, "utf8");
    writeFileSync(
      join(root, "items", targetTaskId, "task.toml"),
      [
        'priority = "p1"',
        'schema = "metidos.task/v2"',
        'created_at = "2026-04-12T20:00:00Z"',
        'title = "Target task"',
        'status = "open"',
        'type = "feature"',
        'id = "tg-01fixturetaskgraph0000000011"',
        'tags = ["theme:reliability", "area:task-graph", "theme:reliability"]',
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(root, "items", targetTaskId, "body.md"),
      "Target body without trailing newline",
      "utf8",
    );
    const untouchedTaskToml = [
      'priority = "p1"',
      'schema = "metidos.task/v2"',
      'created_at = "2026-04-12T20:00:00Z"',
      'title = "Untouched task"',
      'status = "open"',
      'type = "feature"',
      'id = "tg-01fixturetaskgraph0000000012"',
      'tags = ["theme:reliability", "area:task-graph", "theme:reliability"]',
      "",
    ].join("\n");
    writeFileSync(
      join(root, "items", untouchedTaskId, "task.toml"),
      untouchedTaskToml,
      "utf8",
    );
    writeFileSync(
      join(root, "items", untouchedTaskId, "body.md"),
      "Untouched body without trailing newline",
      "utf8",
    );

    const result = await normalizeTaskGraphFilesystem(root, {
      taskIds: [targetTaskId],
    });

    expect(result.normalized_task_ids).toEqual([targetTaskId]);
    expect(result.changed_files.map((file) => file.path).sort()).toEqual([
      join(root, "items", targetTaskId, "body.md"),
      join(root, "items", targetTaskId, "task.toml"),
    ]);
    expect(readFileSync(join(root, "config.toml"), "utf8")).toBe(messyConfig);
    expect(
      readFileSync(join(root, "items", untouchedTaskId, "task.toml"), "utf8"),
    ).toBe(untouchedTaskToml);
  });
});
