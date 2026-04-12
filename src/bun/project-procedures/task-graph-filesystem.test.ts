/**
 * @file src/bun/project-procedures/task-graph-filesystem.test.ts
 * @description Focused coverage for the git-native task graph filesystem model.
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
  buildDefaultTaskGraphConfig,
  initTaskGraphFilesystem,
  loadTaskGraphFilesystem,
  loadTaskGraphTaskFile,
  serializeTaskGraphConfigToml,
  serializeTaskGraphTagRegistryToml,
  serializeTaskGraphTaskToml,
  serializeTaskGraphTypeRegistryToml,
  type TaskGraphConfig,
  type TaskGraphTagRegistry,
  type TaskGraphTask,
  type TaskGraphTypeRegistry,
  writeTaskGraphTaskFile,
} from "./task-graph-filesystem";

const tempDirectories = new Set<string>();

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "metidos-task-graph-"));
  tempDirectories.add(directory);
  return directory;
}

function createFixtureTaskGraphRoot(): string {
  const root = join(createTempDirectory(), ".metidos", "tasks");
  mkdirSync(join(root, "items", "tg-01fixturetaskgraph0000000001"), {
    recursive: true,
  });
  return root;
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

describe("task graph filesystem model", () => {
  it("loads the live repository task graph and keeps link references as task ids", async () => {
    const graph = await loadTaskGraphFilesystem(".metidos/tasks");

    expect(graph.config.schema).toBe("metidos.task-graph/v2");
    expect(graph.tags?.schema).toBe("metidos.task-tags/v2");
    expect(graph.types).toBeNull();
    expect(graph.tasks.length).toBeGreaterThan(0);

    const task = graph.tasks_by_id.get("tg-01jv6xbw5g7k1n4r6v8x2z5cde");
    expect(task?.task.links.parent).toBe("tg-01jv6x6kh5z8y4v9m2c3d7pqra");
    expect(task?.task.links.blockers.length).toBeGreaterThan(0);
    expect(
      task?.task.links.blockers.every((taskId) => taskId.startsWith("tg-")),
    ).toBeTrue();
  });

  it("loads config, optional registries, and task files from a fixture graph", async () => {
    const root = createFixtureTaskGraphRoot();
    const config: TaskGraphConfig = {
      body_format: "markdown",
      defaults: {
        priority: "p2",
        status: "open",
        type: "task",
      },
      id_prefix: "tg",
      schema: "metidos.task-graph/v2",
      strict_tags: true,
      strict_types: true,
    };
    const tags: TaskGraphTagRegistry = {
      schema: "metidos.task-tags/v2",
      tag: [
        {
          description: "Task graph work",
          exclusive_group: "area",
          name: "area:task-graph",
        },
      ],
    };
    const types: TaskGraphTypeRegistry = {
      schema: "metidos.task-types/v2",
      type: [
        {
          description: "A custom repository-local type",
          name: "decision",
        },
      ],
    };

    writeFileSync(
      join(root, "config.toml"),
      serializeTaskGraphConfigToml(config),
    );
    writeFileSync(
      join(root, "tags.toml"),
      serializeTaskGraphTagRegistryToml(tags),
    );
    writeFileSync(
      join(root, "types.toml"),
      serializeTaskGraphTypeRegistryToml(types),
    );
    writeFileSync(
      join(root, "items", "tg-01fixturetaskgraph0000000001", "task.toml"),
      [
        'schema = "metidos.task/v2"',
        'id = "tg-01fixturetaskgraph0000000001"',
        'title = "Fixture task"',
        'type = "feature"',
        'status = "open"',
        'priority = "p1"',
        'created_at = "2026-04-12T20:00:00Z"',
        'tags = ["area:task-graph"]',
        "",
        "[blockers]",
        'tasks = ["tg-01otherfixturetask0000000002"]',
        "",
        "[parent]",
        'task = "tg-01epicfixturetask0000000003"',
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(root, "items", "tg-01fixturetaskgraph0000000001", "body.md"),
      "Fixture body.\n",
      "utf8",
    );

    const graph = await loadTaskGraphFilesystem(root);

    expect(graph.config).toEqual(config);
    expect(graph.tags).toEqual(tags);
    expect(graph.types).toEqual(types);
    expect(graph.tasks).toHaveLength(1);
    expect(graph.tasks[0]?.task).toEqual({
      assignees: [],
      closed_at: null,
      created_at: "2026-04-12T20:00:00Z",
      created_by: null,
      id: "tg-01fixturetaskgraph0000000001",
      links: {
        blockers: ["tg-01otherfixturetask0000000002"],
        caused_by: [],
        docs_for: [],
        duplicates: [],
        implements: [],
        mitigates: [],
        parent: "tg-01epicfixturetask0000000003",
        references: [],
        related: [],
        supersedes: [],
        tests_for: [],
      },
      milestone: null,
      priority: "p1",
      schema: "metidos.task/v2",
      severity: null,
      size: null,
      status: "open",
      tags: ["area:task-graph"],
      title: "Fixture task",
      type: "feature",
    } satisfies TaskGraphTask);
    expect(graph.tasks[0]?.body).toBe("Fixture body.\n");
  });

  it("serializes task metadata in canonical order and deduplicates sorted tags and links", () => {
    const task: TaskGraphTask = {
      assignees: ["agent", "reviewer", "agent"],
      closed_at: null,
      created_at: "2026-04-12T20:00:00Z",
      created_by: "codex",
      id: "tg-01fixturetaskgraph0000000001",
      links: {
        blockers: ["tg-b", "tg-a", "tg-b"],
        caused_by: [],
        docs_for: ["tg-doc-2", "tg-doc-1", "tg-doc-1"],
        duplicates: [],
        implements: [],
        mitigates: ["tg-risk-2", "tg-risk-1"],
        parent: "tg-parent",
        references: [],
        related: ["tg-related-2", "tg-related-1"],
        supersedes: [],
        tests_for: [],
      },
      milestone: "task-graph-admin-v1",
      priority: "p1",
      schema: "metidos.task/v2",
      severity: null,
      size: "m",
      status: "open",
      tags: ["theme:reliability", "area:task-graph", "theme:reliability"],
      title: "Fixture task",
      type: "feature",
    };

    expect(serializeTaskGraphTaskToml(task)).toBe(
      [
        'schema = "metidos.task/v2"',
        'id = "tg-01fixturetaskgraph0000000001"',
        'title = "Fixture task"',
        'type = "feature"',
        'status = "open"',
        'priority = "p1"',
        'size = "m"',
        'created_at = "2026-04-12T20:00:00Z"',
        'created_by = "codex"',
        'assignees = ["agent", "reviewer"]',
        'tags = ["area:task-graph", "theme:reliability"]',
        'milestone = "task-graph-admin-v1"',
        "",
        "[blockers]",
        'tasks = ["tg-a", "tg-b"]',
        "",
        "[docs_for]",
        'tasks = ["tg-doc-1", "tg-doc-2"]',
        "",
        "[mitigates]",
        'tasks = ["tg-risk-1", "tg-risk-2"]',
        "",
        "[related]",
        'tasks = ["tg-related-1", "tg-related-2"]',
        "",
        "[parent]",
        'task = "tg-parent"',
        "",
      ].join("\n"),
    );
  });

  it("writes canonical task files and avoids rewriting unchanged output", async () => {
    const root = createFixtureTaskGraphRoot();
    const taskDirectory = join(
      root,
      "items",
      "tg-01fixturetaskgraph0000000001",
    );

    const firstWrite = await writeTaskGraphTaskFile(taskDirectory, {
      body: "Body text without a trailing newline",
      task: {
        assignees: ["agent", "agent"],
        closed_at: null,
        created_at: "2026-04-12T20:00:00Z",
        created_by: "codex",
        id: "tg-01fixturetaskgraph0000000001",
        links: {
          blockers: ["tg-b", "tg-a"],
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
        },
        milestone: null,
        priority: "p1",
        schema: "metidos.task/v2",
        severity: null,
        size: "m",
        status: "open",
        tags: ["theme:reliability", "area:task-graph"],
        title: "Fixture task",
        type: "feature",
      },
    });

    const secondWrite = await writeTaskGraphTaskFile(taskDirectory, {
      body: "Body text without a trailing newline",
      task: {
        assignees: ["agent", "agent"],
        closed_at: null,
        created_at: "2026-04-12T20:00:00Z",
        created_by: "codex",
        id: "tg-01fixturetaskgraph0000000001",
        links: {
          blockers: ["tg-b", "tg-a"],
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
        },
        milestone: null,
        priority: "p1",
        schema: "metidos.task/v2",
        severity: null,
        size: "m",
        status: "open",
        tags: ["theme:reliability", "area:task-graph"],
        title: "Fixture task",
        type: "feature",
      },
    });

    expect(firstWrite.wrote_task_toml).toBeTrue();
    expect(firstWrite.wrote_body_md).toBeTrue();
    expect(secondWrite.wrote_task_toml).toBeFalse();
    expect(secondWrite.wrote_body_md).toBeFalse();

    const taskFile = await loadTaskGraphTaskFile(taskDirectory);
    expect(taskFile.body).toBe("Body text without a trailing newline\n");
    expect(taskFile.task.tags).toEqual([
      "area:task-graph",
      "theme:reliability",
    ]);
    expect(taskFile.task.links.blockers).toEqual(["tg-a", "tg-b"]);
  });

  it("initializes an empty task graph with canonical defaults and no registries by default", async () => {
    const root = join(createTempDirectory(), ".metidos", "tasks");

    const result = await initTaskGraphFilesystem(root);

    expect(result.config).toEqual(buildDefaultTaskGraphConfig());
    expect(result.status).toEqual({
      config: "created",
      items: "created",
      root: "created",
      tags: "skipped",
      types: "skipped",
    });
    expect(readFileSync(join(root, "config.toml"), "utf8")).toBe(
      serializeTaskGraphConfigToml(buildDefaultTaskGraphConfig()),
    );

    const graph = await loadTaskGraphFilesystem(root);
    expect(graph.config).toEqual(buildDefaultTaskGraphConfig());
    expect(graph.tags).toBeNull();
    expect(graph.types).toBeNull();
    expect(graph.tasks).toEqual([]);
  });

  it("creates requested empty registries and preserves existing files on rerun", async () => {
    const root = join(createTempDirectory(), ".metidos", "tasks");
    const initialInput = {
      createTagsRegistry: true,
      createTypesRegistry: true,
      idPrefix: "task",
      strictTags: true,
      strictTypes: true,
    } as const;

    const firstResult = await initTaskGraphFilesystem(root, initialInput);

    expect(firstResult.status).toEqual({
      config: "created",
      items: "created",
      root: "created",
      tags: "created",
      types: "created",
    });
    expect(readFileSync(join(root, "config.toml"), "utf8")).toBe(
      serializeTaskGraphConfigToml(buildDefaultTaskGraphConfig(initialInput)),
    );
    expect(readFileSync(join(root, "tags.toml"), "utf8")).toBe(
      serializeTaskGraphTagRegistryToml({
        schema: "metidos.task-tags/v2",
        tag: [],
      }),
    );
    expect(readFileSync(join(root, "types.toml"), "utf8")).toBe(
      serializeTaskGraphTypeRegistryToml({
        schema: "metidos.task-types/v2",
        type: [],
      }),
    );

    const secondResult = await initTaskGraphFilesystem(root, {
      idPrefix: "ignored",
      strictTags: false,
      strictTypes: false,
    });

    expect(secondResult.config).toEqual(
      buildDefaultTaskGraphConfig(initialInput),
    );
    expect(secondResult.status).toEqual({
      config: "existing",
      items: "existing",
      root: "existing",
      tags: "existing",
      types: "existing",
    });
    expect(readFileSync(join(root, "config.toml"), "utf8")).toBe(
      serializeTaskGraphConfigToml(buildDefaultTaskGraphConfig(initialInput)),
    );
  });
});
