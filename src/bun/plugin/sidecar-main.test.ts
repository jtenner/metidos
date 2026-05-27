/**
 * @file src/bun/plugin/sidecar-main.test.ts
 * @description Tests for sidecar-local host-operation guards.
 */

import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertSidecarHostOperationAllowed,
  executeSidecarLocalFsOperation,
  PLUGIN_HOST_REQUEST_TIMEOUT_MAX_MS,
  normalizeSidecarHostRequestDeadlineMs,
} from "./sidecar-main";

async function expectEarlyDeny(input: {
  operation: string;
  params?: unknown;
  permissions?: readonly string[];
}) {
  try {
    await assertSidecarHostOperationAllowed({
      permissions: input.permissions ?? [],
      operation: input.operation,
      params: input.params,
    });
  } catch (error) {
    return error;
  }
  throw new Error(`Expected ${input.operation} to be early-denied.`);
}

describe("plugin sidecar host-operation deadlines", () => {
  it("clamps plugin-supplied host request deadlines", () => {
    const nowMs = 1_000_000;

    expect(normalizeSidecarHostRequestDeadlineMs(undefined, nowMs)).toEqual({
      deadlineMs: nowMs + 60_000,
      timeoutMs: 60_000,
    });
    expect(
      normalizeSidecarHostRequestDeadlineMs(
        nowMs + PLUGIN_HOST_REQUEST_TIMEOUT_MAX_MS + 1,
        nowMs,
      ),
    ).toEqual({
      deadlineMs: nowMs + PLUGIN_HOST_REQUEST_TIMEOUT_MAX_MS,
      timeoutMs: PLUGIN_HOST_REQUEST_TIMEOUT_MAX_MS,
    });
    expect(normalizeSidecarHostRequestDeadlineMs(nowMs - 5_000, nowMs)).toEqual(
      {
        deadlineMs: nowMs + 1,
        timeoutMs: 1,
      },
    );
  });
});

describe("plugin sidecar host-operation early deny", () => {
  it("matches maincar missing-permission errors for representative host APIs", async () => {
    await expect(
      expectEarlyDeny({ operation: "terminal.create" }),
    ).resolves.toMatchObject({
      code: "plugin_permission_error",
      message: "metidos.terminal.create requires terminal:create.",
      name: "PluginPermissionError",
      permission: "terminal:create",
    });

    await expect(
      expectEarlyDeny({ operation: "notifications.send" }),
    ).resolves.toMatchObject({
      code: "plugin_permission_error",
      message: "metidos.notifications.send requires notification:send.",
      name: "PluginPermissionError",
      permission: "notification:send",
    });
  });

  it("allows maincar-owned calls when the sidecar snapshot has enough local evidence", async () => {
    await expect(
      assertSidecarHostOperationAllowed({
        operation: "terminal.read",
        params: {
          context: {
            contextKind: "threadTool",
            projectId: 1,
            threadId: 2,
            worktreePath: "/tmp/project",
          },
        },
        permissions: ["terminal:read"],
      }),
    ).resolves.toBeUndefined();

    await expect(
      assertSidecarHostOperationAllowed({
        operation: "metidos.log",
        permissions: [],
      }),
    ).resolves.toBeUndefined();
  });
});

describe("plugin sidecar local fs execution", () => {
  async function startupPayload() {
    const root = await mkdtemp(join(tmpdir(), "metidos-sidecar-fs-"));
    const pluginPath = join(root, "plugin");
    const worktreePath = join(root, "worktree");
    await mkdir(join(pluginPath, ".data"), { recursive: true });
    await mkdir(worktreePath, { recursive: true });
    return {
      pluginPath,
      worktreePath,
      startup: {
        apiVersion: "v1" as const,
        env: [],
        fs: {
          files: {
            allow: {
              delete: ["./allowed/**"],
              read: ["./allowed/**"],
              write: ["./allowed/**"],
            },
            deny: {
              delete: [],
              read: ["./allowed/secret.txt"],
              write: ["./allowed/blocked.txt"],
            },
          },
          pluginPath,
          quota: {
            maxDataBytes: 1024 * 1024,
            maxFileBytes: 1024 * 1024,
            maxFiles: 100,
          },
        },
        permissions: [
          "storage:delete",
          "storage:read",
          "storage:write",
          "files:delete",
          "files:read",
          "files:write",
        ],
        protocolVersion: 1 as const,
        reviewHash: "test",
      },
    };
  }

  it("executes allowed reads and writes without host request frames", async () => {
    const { startup, worktreePath } = await startupPayload();
    await mkdir(join(worktreePath, "allowed"), { recursive: true });
    await writeFile(join(worktreePath, "allowed", "readme.txt"), "hello");

    await expect(
      executeSidecarLocalFsOperation({
        operation: "fs.readText",
        permissions: startup.permissions,
        request: {
          context: { contextKind: "threadTool", worktreePath },
          params: { path: "./allowed/readme.txt" },
        },
        startup,
      }),
    ).resolves.toBe("hello");

    await executeSidecarLocalFsOperation({
      operation: "fs.writeText",
      permissions: startup.permissions,
      request: {
        context: { contextKind: "threadTool", worktreePath },
        params: { path: "./allowed/output.txt", contents: "written" },
      },
      startup,
    });

    const outputPath = join(worktreePath, "allowed", "output.txt");
    await expect(readFile(outputPath, "utf8")).resolves.toBe("written");

    await executeSidecarLocalFsOperation({
      operation: "fs.rm",
      permissions: startup.permissions,
      request: {
        context: { contextKind: "threadTool", worktreePath },
        params: { path: "./allowed/output.txt" },
      },
      startup,
    });

    await expect(readFile(outputPath, "utf8")).rejects.toThrow();
  });

  it("denies reads, writes, and missing project context locally", async () => {
    const { startup, worktreePath } = await startupPayload();
    await mkdir(join(worktreePath, "allowed"), { recursive: true });
    await writeFile(join(worktreePath, "allowed", "secret.txt"), "secret");

    await expect(
      executeSidecarLocalFsOperation({
        operation: "fs.readText",
        permissions: startup.permissions,
        request: {
          context: { contextKind: "threadTool", worktreePath },
          params: { path: "./allowed/secret.txt" },
        },
        startup,
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });

    await expect(
      executeSidecarLocalFsOperation({
        operation: "fs.writeText",
        permissions: startup.permissions,
        request: {
          context: { contextKind: "threadTool", worktreePath },
          params: { path: "./allowed/blocked.txt", contents: "nope" },
        },
        startup,
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });

    await expect(
      executeSidecarLocalFsOperation({
        operation: "fs.readText",
        permissions: startup.permissions,
        request: {
          context: { contextKind: "startup" },
          params: { path: "./allowed/readme.txt" },
        },
        startup,
      }),
    ).rejects.toMatchObject({ name: "PluginContextError" });
  });
});
