/**
 * @file src/bun/project-procedures/task-graph-validation.test.ts
 * @description Focused coverage for structured git-native task graph validation.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildDefaultTaskGraphConfig,
  initTaskGraphFilesystem,
  serializeTaskGraphConfigToml,
  serializeTaskGraphTagRegistryToml,
  serializeTaskGraphTypeRegistryToml,
  type TaskGraphTask,
  writeTaskGraphTaskFile,
} from "./task-graph-filesystem";
import { validateTaskGraphFilesystem } from "./task-graph-validation";

const tempDirectories = new Set<string>();

function createTempDirectory(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "metidos-task-graph-validation-"),
  );
  tempDirectories.add(directory);
  return directory;
}

function buildFixtureTask(
  id: string,
  overrides: Partial<TaskGraphTask> = {},
): TaskGraphTask {
  const { links: overrideLinks, ...overrideTask } = overrides;
  return {
    assignees: [],
    closed_at: null,
    created_at: "2026-04-12T20:00:00Z",
    created_by: "codex",
    id,
    links: {
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
      ...overrideLinks,
    },
    milestone: null,
    priority: "p2",
    schema: "metidos.task/v2",
    severity: null,
    size: null,
    status: "open",
    tags: ["area:task-graph"],
    title: `Task ${id}`,
    type: "task",
    ...overrideTask,
  };
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

describe("task graph validation", () => {
  it("validates the live repository task graph with no findings", async () => {
    const result = await validateTaskGraphFilesystem(".metidos/tasks");

    expect(result.ok).toBeTrue();
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.validated_task_ids.length).toBeGreaterThan(0);
  });

  it("reports structured errors and warnings for invalid repositories", async () => {
    const root = join(createTempDirectory(), ".metidos", "tasks");
    await initTaskGraphFilesystem(root, {
      createTagsRegistry: true,
      createTypesRegistry: true,
      strictTags: true,
      strictTypes: true,
    });

    writeFileSync(
      join(root, "tags.toml"),
      serializeTaskGraphTagRegistryToml({
        schema: "metidos.task-tags/v2",
        tag: [
          {
            description: "Task graph work",
            exclusive_group: "area",
            name: "area:task-graph",
          },
        ],
      }),
      "utf8",
    );
    writeFileSync(
      join(root, "types.toml"),
      serializeTaskGraphTypeRegistryToml({
        schema: "metidos.task-types/v2",
        type: [
          {
            description: "Decision records",
            name: "decision",
          },
        ],
      }),
      "utf8",
    );

    const epicId = "tg-01jv6x6kh5z8y4v9m2c3d7pqra";
    const docsId = "tg-01jv6x9u3d5g8j2m4q6s9v2xzb";
    const testId = "tg-01jv6xaw4f6j9m3q5t7w9y2bcd";
    const invalidShapeId = "tg-01jv6xbw5g7k1n4r6v8x2z5cde";
    const duplicateId = "tg-01jv6xcy6h8m2p5s7w9z3b6dfg";
    const missingBodyId = "tg-01jv6xdz7j9n3q6t8x2a4c7efh";

    await writeTaskGraphTaskFile(join(root, "items", epicId), {
      body: "Epic body.\n",
      task: buildFixtureTask(epicId, {
        priority: "p1",
        title: "Epic task",
        type: "epic",
      }),
    });
    await writeTaskGraphTaskFile(join(root, "items", docsId), {
      body: "Docs task without docs_for.\n",
      task: buildFixtureTask(docsId, {
        links: {
          blockers: ["tg-01missingtaskgraph0000000000"],
          caused_by: [],
          docs_for: [],
          duplicates: [],
          implements: [],
          mitigates: [],
          parent: epicId,
          references: [],
          related: [],
          supersedes: [],
          tests_for: [],
        },
        tags: ["area:unknown"],
        title: "Docs task",
        type: "docs",
      }),
    });
    await writeTaskGraphTaskFile(join(root, "items", testId), {
      body: "Test task.\n",
      task: buildFixtureTask(testId, {
        links: {
          blockers: [testId],
          caused_by: [],
          docs_for: [],
          duplicates: [],
          implements: [],
          mitigates: [],
          parent: "tg-01missingparent000000000000",
          references: [],
          related: [],
          supersedes: [],
          tests_for: [],
        },
        title: "Test task",
        type: "test",
      }),
    });
    await writeTaskGraphTaskFile(join(root, "items", invalidShapeId), {
      body: "Task with invalid metadata values.\n",
      task: buildFixtureTask(invalidShapeId, {
        priority: "p9",
        schema: "metidos.task/v1",
        severity: "urgent",
        size: "xxl",
        status: "started",
        tags: ["Bad Tag"],
        title: "Invalid shape task",
        type: "custom",
      }),
    });
    await writeTaskGraphTaskFile(join(root, "items", duplicateId), {
      body: "Canonical duplicate id holder.\n",
      task: buildFixtureTask(duplicateId, {
        title: "First duplicate task",
      }),
    });
    await writeTaskGraphTaskFile(
      join(root, "items", "tg-01kp16yacq91qm303xgnq7n1n8"),
      {
        body: "Second duplicate id holder.\n",
        task: buildFixtureTask(duplicateId, {
          title: "Second duplicate task",
        }),
      },
    );
    await writeTaskGraphTaskFile(join(root, "items", missingBodyId), {
      body: "Temporary body that will be removed.\n",
      task: buildFixtureTask(missingBodyId, {
        title: "Missing body task",
      }),
    });
    rmSync(join(root, "items", missingBodyId, "body.md"));

    const missingTaskTomlId = "tg-01fixturetaskgraph0000000013";

    mkdirSync(join(root, "items", missingTaskTomlId), {
      recursive: true,
    });
    writeFileSync(
      join(root, "items", missingTaskTomlId, "body.md"),
      "Missing task.toml fixture.\n",
      "utf8",
    );
    writeFileSync(
      join(root, "config.toml"),
      serializeTaskGraphConfigToml({
        ...buildDefaultTaskGraphConfig({
          strictTags: true,
          strictTypes: true,
        }),
        body_format: "plaintext",
      }),
      "utf8",
    );

    const result = await validateTaskGraphFilesystem(root);
    const errorCodes = new Set(result.errors.map((finding) => finding.code));
    const warningCodes = new Set(
      result.warnings.map((finding) => finding.code),
    );

    expect(result.ok).toBeFalse();
    expect(errorCodes).toContain("invalid_body_format");
    expect(errorCodes).toContain("invalid_tag");
    expect(errorCodes).toContain("missing_link_target");
    expect(errorCodes).toContain("self_reference");
    expect(errorCodes).toContain("invalid_parent_reference");
    expect(errorCodes).toContain("invalid_task_schema");
    expect(errorCodes).toContain("invalid_status");
    expect(errorCodes).toContain("invalid_priority");
    expect(errorCodes).toContain("invalid_type");
    expect(errorCodes).toContain("invalid_severity");
    expect(errorCodes).toContain("invalid_size");
    expect(errorCodes).toContain("missing_body_md");
    expect(errorCodes).toContain("missing_task_toml");
    expect(errorCodes).toContain("duplicate_task_id");
    expect(warningCodes).toContain("missing_docs_for");
    expect(warningCodes).toContain("missing_tests_for");
    expect(warningCodes).toContain("noncanonical_tag_shape");

    const missingBodyFinding = result.errors.find(
      (finding) => finding.code === "missing_body_md",
    );
    expect(missingBodyFinding?.path.endsWith("/body.md")).toBeTrue();
    expect(missingBodyFinding?.task_id).toBe(missingBodyId);

    const invalidTagFinding = result.errors.find(
      (finding) => finding.code === "invalid_tag",
    );
    expect(invalidTagFinding?.severity).toBe("error");
    expect(invalidTagFinding?.task_id).toBe(docsId);
    expect(invalidTagFinding?.field).toBe("tags");
  });

  it("supports task id subsets while resolving references against the full graph", async () => {
    const root = join(createTempDirectory(), ".metidos", "tasks");
    const parentId = "tg-01zzzzzzzzzzzzzzzzzzzzzzzz";
    const childId = "tg-01yyyyyyyyyyyyyyyyyyyyyyyy";
    await initTaskGraphFilesystem(root);

    await writeTaskGraphTaskFile(join(root, "items", parentId), {
      body: "Parent task.\n",
      task: buildFixtureTask(parentId, {
        title: "Parent task",
        type: "epic",
      }),
    });
    await writeTaskGraphTaskFile(join(root, "items", childId), {
      body: "Child task.\n",
      task: buildFixtureTask(childId, {
        links: {
          blockers: [],
          caused_by: [],
          docs_for: [],
          duplicates: [],
          implements: [],
          mitigates: [],
          parent: parentId,
          references: [],
          related: [],
          supersedes: [],
          tests_for: [],
        },
        title: "Child task",
      }),
    });

    const result = await validateTaskGraphFilesystem(root, {
      taskIds: [childId],
    });

    expect(result.ok).toBeTrue();
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.validated_task_ids).toEqual([childId]);
  });
});
