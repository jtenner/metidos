/**
 * @file src/bun/plugin/core-agent-memory-plugin.test.ts
 * @description Coverage for the core Agent Memory plugin registrations and host API usage.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const AGENT_MEMORY_PLUGIN_ROOT = join("core_plugins", "agent_memory");

type ToolRegistration = {
  actionHandle: string;
  tool: string;
  validatePropsHandle: string;
};

type RuntimeSetup = {
  tools: ToolRegistration[];
};

type MarkdownResult = {
  markdown: string;
  type: string;
};

function manifest(): RpcPluginInventoryPlugin["manifest"] {
  const manifestPath = join(AGENT_MEMORY_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Agent Memory plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function startAgentMemoryPlugin() {
  const parsedManifest = manifest();
  expect(parsedManifest.permissions).toEqual(
    expect.arrayContaining(["storage:read"]),
  );
  const fsRequests: unknown[] = [];
  const embeddingRequests: unknown[] = [];
  const lancedbRequests: unknown[] = [];
  const logRequests: unknown[] = [];
  const build = await buildPluginEntrypoint({
    pluginRoot: AGENT_MEMORY_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      embeddings: async (request) => {
        embeddingRequests.push(request);
        return [1, 0, embeddingRequests.length];
      },
      fs: async (operation, request) => {
        fsRequests.push({ operation, request });
        const params =
          request && typeof request === "object" && "params" in request
            ? ((request as { params?: unknown }).params as Record<
                string,
                unknown
              >)
            : {};
        if (operation === "fs.readText") {
          if (String(params.path).startsWith("~/memory/files/")) {
            return [
              "# Alpha",
              "",
              "id: mem-test-alpha",
              "created_at: 2026-05-09T00:00:00.000Z",
              "title: Alpha",
              "source: direct payload",
              "chunk_count: 2",
              "memory_truncated: false",
              "index_truncated: false",
              "",
              "---",
              "",
              "Old memory contents",
            ].join("\n");
          }
          return "File memory contents";
        }
        return { ok: true };
      },
      lancedb: async (operation, request) => {
        lancedbRequests.push({ operation, request });
        if (operation === "lancedb.delete") {
          return { deleted: true, id: "deleted" };
        }
        if (operation === "lancedb.query") {
          return [
            {
              id: "mem-test:chunk:0",
              props: {
                chunk: "Remembered alpha context.",
                chunkCount: 1,
                chunkIndex: 0,
                filePath: "~/memory/files/mem-test.md",
                memoryId: "mem-test",
                source: "direct payload",
                title: "Alpha",
              },
              score: 0.98,
            },
          ];
        }
        return { count: 1, ids: ["mem-test:chunk:0"] };
      },
      log: async (request) => {
        logRequests.push(request);
        return { ok: true };
      },
      permissions: [
        "files:read",
        "metidos:can_embed",
        "metidos:lancedb",
        "storage:read",
        "storage:write",
        "storage:delete",
        "log:write",
      ],
    },
    startupTimeoutMs: 1000,
  });
  const setup = runtime.setupResult as RuntimeSetup;
  expect(setup.tools.map((tool) => tool.tool)).toEqual([
    "remember",
    "remember_file",
    "recall",
    "forget",
    "modify",
  ]);
  expect(() =>
    validatePluginStartupRegistrations(setup, {
      manifest: parsedManifest,
      pluginId: "agent_memory",
    } as RpcPluginInventoryPlugin),
  ).not.toThrow();
  return {
    embeddingRequests,
    fsRequests,
    lancedbRequests,
    logRequests,
    runtime,
    setup,
  };
}

function tool(setup: RuntimeSetup, toolName: string): ToolRegistration {
  const registration = setup.tools.find(
    (candidate) => candidate.tool === toolName,
  );
  if (!registration) {
    throw new Error(`Missing tool ${toolName}.`);
  }
  return registration;
}

describe("core Agent Memory plugin", () => {
  it("registers memory tools and indexes project files with remember_file", async () => {
    const { embeddingRequests, fsRequests, lancedbRequests, runtime, setup } =
      await startAgentMemoryPlugin();
    try {
      const rememberFileTool = tool(setup, "remember_file");
      const props = await runtime.invokeCallback({
        args: [{ path: "./docs/memory.md", title: "Docs memory" }],
        deadlineMs: Date.now() + 1000,
        handle: rememberFileTool.validatePropsHandle,
        label: "remember_file validateProps",
      });
      expect(props).toEqual({ path: "./docs/memory.md", title: "Docs memory" });

      const result = (await runtime.invokeCallback({
        args: [{ contextKind: "threadTool", ownerUserId: 1 }, props],
        deadlineMs: Date.now() + 5000,
        handle: rememberFileTool.actionHandle,
        label: "remember_file action",
      })) as MarkdownResult;
      expect(result.markdown).toContain("Stored Agent Memory `mem-");
      expect(result.markdown).toContain("from `./docs/memory.md`");
      expect(
        fsRequests.map((entry) => (entry as { operation: string }).operation),
      ).toEqual(["fs.readText", "fs.mkdir", "fs.writeText"]);
      expect(embeddingRequests).toHaveLength(1);
      expect(lancedbRequests).toEqual([
        {
          operation: "lancedb.upsert",
          request: expect.objectContaining({
            params: expect.objectContaining({
              path: "~/memory/chunks",
              rows: [
                expect.objectContaining({
                  chunk: "File memory contents",
                  source: "./docs/memory.md",
                  title: "Docs memory",
                }),
              ],
            }),
          }),
        },
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("forgets a memory file and linked chunks", async () => {
    const { fsRequests, lancedbRequests, runtime, setup } =
      await startAgentMemoryPlugin();
    try {
      const forgetTool = tool(setup, "forget");
      const props = await runtime.invokeCallback({
        args: [{ file: "mem-test-alpha.md" }],
        deadlineMs: Date.now() + 1000,
        handle: forgetTool.validatePropsHandle,
        label: "forget validateProps",
      });
      expect(props).toEqual({ file: "mem-test-alpha.md" });

      const result = (await runtime.invokeCallback({
        args: [{ contextKind: "threadTool", ownerUserId: 1 }, props],
        deadlineMs: Date.now() + 5000,
        handle: forgetTool.actionHandle,
        label: "forget action",
      })) as MarkdownResult;
      expect(result.markdown).toContain("Forgot Agent Memory `mem-test-alpha`");
      expect(
        fsRequests.map((entry) => (entry as { operation: string }).operation),
      ).toEqual(["fs.readText", "fs.rm"]);
      expect(lancedbRequests).toEqual([
        {
          operation: "lancedb.delete",
          request: expect.objectContaining({
            params: { id: "mem-test-alpha:chunk:0", path: "~/memory/chunks" },
          }),
        },
        {
          operation: "lancedb.delete",
          request: expect.objectContaining({
            params: { id: "mem-test-alpha:chunk:1", path: "~/memory/chunks" },
          }),
        },
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("modifies a memory by clearing stale chunks and re-indexing under the same file", async () => {
    const { embeddingRequests, fsRequests, lancedbRequests, runtime, setup } =
      await startAgentMemoryPlugin();
    try {
      const modifyTool = tool(setup, "modify");
      const props = await runtime.invokeCallback({
        args: [
          {
            file: "~/memory/files/mem-test-alpha.md",
            payload: "Corrected memory contents.",
            title: "Corrected Alpha",
          },
        ],
        deadlineMs: Date.now() + 1000,
        handle: modifyTool.validatePropsHandle,
        label: "modify validateProps",
      });
      expect(props).toEqual({
        file: "~/memory/files/mem-test-alpha.md",
        payload: "Corrected memory contents.",
        title: "Corrected Alpha",
      });

      const result = (await runtime.invokeCallback({
        args: [{ contextKind: "threadTool", ownerUserId: 1 }, props],
        deadlineMs: Date.now() + 5000,
        handle: modifyTool.actionHandle,
        label: "modify action",
      })) as MarkdownResult;
      expect(result.markdown).toContain(
        "Modified Agent Memory `mem-test-alpha`",
      );
      expect(result.markdown).toContain("indexed 1 fresh chunk(s)");
      expect(
        fsRequests.map((entry) => (entry as { operation: string }).operation),
      ).toEqual(["fs.readText", "fs.mkdir", "fs.writeText"]);
      expect(embeddingRequests).toEqual([
        expect.objectContaining({
          params: expect.objectContaining({
            input: "Corrected memory contents.",
          }),
        }),
      ]);
      expect(lancedbRequests).toEqual([
        {
          operation: "lancedb.delete",
          request: expect.objectContaining({
            params: { id: "mem-test-alpha:chunk:0", path: "~/memory/chunks" },
          }),
        },
        {
          operation: "lancedb.delete",
          request: expect.objectContaining({
            params: { id: "mem-test-alpha:chunk:1", path: "~/memory/chunks" },
          }),
        },
        {
          operation: "lancedb.upsert",
          request: expect.objectContaining({
            params: expect.objectContaining({
              path: "~/memory/chunks",
              rows: [
                expect.objectContaining({
                  chunk: "Corrected memory contents.",
                  filePath: "~/memory/files/mem-test-alpha.md",
                  id: "mem-test-alpha:chunk:0",
                  memoryId: "mem-test-alpha",
                  title: "Corrected Alpha",
                }),
              ],
            }),
          }),
        },
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("registers memory tools and routes remember/recall through storage, embeddings, and LanceDB", async () => {
    const {
      embeddingRequests,
      fsRequests,
      lancedbRequests,
      logRequests,
      runtime,
      setup,
    } = await startAgentMemoryPlugin();
    try {
      const rememberTool = tool(setup, "remember");
      const rememberProps = await runtime.invokeCallback({
        args: [{ payload: "Remembered alpha context.", title: "Alpha" }],
        deadlineMs: Date.now() + 1000,
        handle: rememberTool.validatePropsHandle,
        label: "remember validateProps",
      });
      expect(rememberProps).toEqual({
        payload: "Remembered alpha context.",
        title: "Alpha",
      });

      const rememberResult = (await runtime.invokeCallback({
        args: [{ contextKind: "threadTool", ownerUserId: 1 }, rememberProps],
        deadlineMs: Date.now() + 5000,
        handle: rememberTool.actionHandle,
        label: "remember action",
      })) as MarkdownResult;
      expect(rememberResult.markdown).toContain("Stored Agent Memory `mem-");
      expect(rememberResult.markdown).toContain("~/memory/files/mem-");

      const recallTool = tool(setup, "recall");
      const recallProps = await runtime.invokeCallback({
        args: [{ limit: 3, query: "alpha" }],
        deadlineMs: Date.now() + 1000,
        handle: recallTool.validatePropsHandle,
        label: "recall validateProps",
      });
      expect(recallProps).toEqual({ limit: 3, query: "alpha" });

      const recallResult = (await runtime.invokeCallback({
        args: [{ contextKind: "threadTool", ownerUserId: 1 }, recallProps],
        deadlineMs: Date.now() + 5000,
        handle: recallTool.actionHandle,
        label: "recall action",
      })) as MarkdownResult;
      expect(recallResult.markdown).toContain("# Recalled Agent Memory chunks");
      expect(recallResult.markdown).toContain("Remembered alpha context.");
      expect(recallResult.markdown).toContain("~/memory/files/mem-test.md");

      expect(fsRequests).toEqual([
        {
          operation: "fs.mkdir",
          request: {
            context: { contextKind: "threadTool", ownerUserId: 1 },
            deadlineMs: expect.any(Number),
            params: { options: { recursive: true }, path: "~/memory/files" },
          },
        },
        {
          operation: "fs.writeText",
          request: {
            context: { contextKind: "threadTool", ownerUserId: 1 },
            deadlineMs: expect.any(Number),
            params: {
              contents: expect.stringContaining("Remembered alpha context."),
              path: expect.stringMatching(/^~\/memory\/files\/mem-.+\.md$/u),
            },
          },
        },
      ]);
      expect(embeddingRequests).toEqual([
        {
          context: { contextKind: "threadTool", ownerUserId: 1 },
          deadlineMs: expect.any(Number),
          params: {
            input: "Remembered alpha context.",
            payload: expect.objectContaining({
              chunkIndex: 0,
              purpose: "agent_memory.remember.chunk",
            }),
          },
        },
        {
          context: { contextKind: "threadTool", ownerUserId: 1 },
          deadlineMs: expect.any(Number),
          params: {
            input: "alpha",
            payload: { purpose: "agent_memory.recall.query" },
          },
        },
      ]);
      expect(lancedbRequests).toEqual([
        {
          operation: "lancedb.upsert",
          request: {
            context: { contextKind: "threadTool", ownerUserId: 1 },
            deadlineMs: expect.any(Number),
            params: {
              path: "~/memory/chunks",
              rows: [
                expect.objectContaining({
                  chunk: "Remembered alpha context.",
                  chunkCount: 1,
                  chunkIndex: 0,
                  filePath: expect.stringMatching(
                    /^~\/memory\/files\/mem-.+\.md$/u,
                  ),
                  id: expect.stringMatching(/^mem-.+:chunk:0$/u),
                  source: "direct payload",
                  title: "Alpha",
                  vector: [1, 0, 1],
                }),
              ],
            },
          },
        },
        {
          operation: "lancedb.query",
          request: {
            context: { contextKind: "threadTool", ownerUserId: 1 },
            deadlineMs: expect.any(Number),
            params: { limit: 3, path: "~/memory/chunks", vector: [1, 0, 2] },
          },
        },
      ]);
      expect(logRequests).toHaveLength(1);
    } finally {
      runtime.dispose();
    }
  });
});
