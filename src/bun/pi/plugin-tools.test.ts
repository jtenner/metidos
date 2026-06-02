/**
 * @file src/bun/pi/plugin-tools.test.ts
 * @description Tests for Pi wrappers around Plugin System v1 agent tools.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type PluginAgentToolRegistrationForThread,
  type PluginSidecarProcessManager,
  PluginSidecarToolCallError,
} from "../plugin/sidecar-manager";
import {
  createPiPluginTools,
  PLUGIN_TOOL_MAX_TEXT_RESULT_BYTES,
  PluginToolResultError,
} from "./plugin-tools";

const TOOL_REGISTRATION: PluginAgentToolRegistrationForThread = {
  directoryName: "hello_plugin",
  filesReadAllowlist: [],
  filesReadDenylist: [],
  permissions: [],
  pluginId: "hello_plugin",
  pluginPath: "/plugins/hello_plugin",
  registration: {
    actionHandle: "tool:action:2",
    description: "Return a greeting.",
    name: "Hello world",
    runtimeId: "hello_plugin_hello_world",
    timeoutMs: 5_000,
    tool: "hello_world",
    validatePropsHandle: "tool:validateProps:1",
  },
};

const tempDirectories = new Set<string>();

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

function toolWithManagerResult(
  result: unknown,
  registration: PluginAgentToolRegistrationForThread = TOOL_REGISTRATION,
) {
  const manager = {
    invokeAgentTool: async () => result,
    listAgentToolRegistrationsForThread: () => [registration],
  } as unknown as PluginSidecarProcessManager;

  const [tool] = createPiPluginTools({
    context: {
      contextKind: "threadTool",
      ownerUserId: 9,
      projectId: 3,
      threadId: 7,
      worktreePath: "/repo",
    },
    enabledPermissions: ["hello_plugin:hello_tools"],
    manager,
  });
  if (!tool) {
    throw new Error("Expected plugin tool.");
  }
  return tool;
}

async function executeTool(result: unknown) {
  return await toolWithManagerResult(result).execute(
    "tool-call-1",
    { name: "Ada" },
    undefined,
    undefined,
    {} as never,
  );
}

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("createPiPluginTools", () => {
  it("requests no plugin registrations without matching plugin permissions", () => {
    const manager = {
      invokeAgentTool: async () => ({ ok: true }),
      listAgentToolRegistrationsForThread: (groups: readonly string[]) => {
        expect(groups).toEqual([]);
        return [];
      },
    } as unknown as PluginSidecarProcessManager;

    const tools = createPiPluginTools({
      context: {
        contextKind: "threadTool",
        ownerUserId: 9,
        projectId: 3,
        threadId: 7,
        worktreePath: "/repo",
      },
      enabledPermissions: ["metidos:git", "metidos:unsafe"],
      manager,
    });

    expect(tools).toEqual([]);
  });

  it("passes only well-formed plugin permission ids to the sidecar manager", () => {
    const manager = {
      invokeAgentTool: async () => ({ ok: true }),
      listAgentToolRegistrationsForThread: (groups: readonly string[]) => {
        expect(groups).toEqual(["hello_plugin/hello_tools"]);
        return [];
      },
    } as unknown as PluginSidecarProcessManager;

    createPiPluginTools({
      context: {
        contextKind: "threadTool",
        ownerUserId: 9,
        projectId: 3,
        threadId: 7,
        worktreePath: "/repo",
      },
      enabledPermissions: [
        "metidos:git",
        "hello_plugin:hello_tools",
        "malformed",
        "too:many:parts",
      ],
      manager,
    });
  });

  it("exposes selected plugin tools using provider-safe plugin_id_tool_name runtime ids", async () => {
    const calls: unknown[] = [];
    const manager = {
      invokeAgentTool: async (input: unknown) => {
        calls.push(input);
        return { greeting: "hello" };
      },
      listAgentToolRegistrationsForThread: (groups: readonly string[]) => {
        expect(groups).toEqual(["hello_plugin/hello_tools"]);
        return [TOOL_REGISTRATION];
      },
    } as unknown as PluginSidecarProcessManager;

    const tools = createPiPluginTools({
      context: {
        contextKind: "threadTool",
        ownerUserId: 9,
        projectId: 3,
        threadId: 7,
        worktreePath: "/repo",
      },
      enabledPermissions: ["metidos:git", "hello_plugin:hello_tools"],
      manager,
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "hello_plugin_hello_world",
    ]);
    expect(tools[0]?.name).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(tools[0]?.parameters).toMatchObject({
      additionalProperties: true,
      properties: {},
      type: "object",
    });
    const [tool] = tools;
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("Expected plugin tool.");
    }
    const result = await tool.execute(
      "tool-call-1",
      { name: "Ada" },
      undefined,
      undefined,
      {} as never,
    );

    expect(result.content).toEqual([
      { text: '{\n  "greeting": "hello"\n}', type: "text" },
    ]);
    expect(result.details).toEqual({
      pluginId: "hello_plugin",
      result: { greeting: "hello" },
      resultKind: "json",
      runtimeId: "hello_plugin_hello_world",
      tool: "hello_world",
    });
    expect(calls).toEqual([
      {
        context: {
          contextKind: "threadTool",
          ownerUserId: 9,
          projectId: 3,
          threadId: 7,
          worktreePath: "/repo",
        },
        params: { name: "Ada" },
        registration: TOOL_REGISTRATION,
      },
    ]);
  });

  it("converts explicit text, markdown, and image URL tool results", async () => {
    await expect(
      executeTool({ text: "hello", type: "text" }),
    ).resolves.toMatchObject({
      content: [{ text: "hello", type: "text" }],
      details: { resultKind: "text" },
    });

    await expect(
      executeTool({ markdown: "**hello**", type: "markdown" }),
    ).resolves.toMatchObject({
      content: [{ text: "**hello**", type: "text" }],
      details: { resultKind: "markdown" },
    });

    await expect(
      executeTool({
        alt: "diagram",
        type: "image:url",
        url: "https://example.test/image.png",
      }),
    ).resolves.toMatchObject({
      content: [
        {
          text: "Plugin image URL (diagram): https://example.test/image.png",
          type: "text",
        },
      ],
      details: { resultKind: "image:url" },
    });
  });

  it("surfaces plugin tool diagnostic messages when sidecar calls fail", async () => {
    const manager = {
      invokeAgentTool: async () => {
        throw new PluginSidecarToolCallError({
          code: "plugin_network_failed",
          diagnosticMessage: "UploadThing request failed (401): unauthorized",
        });
      },
      listAgentToolRegistrationsForThread: () => [TOOL_REGISTRATION],
    } as unknown as PluginSidecarProcessManager;
    const [tool] = createPiPluginTools({
      context: {
        contextKind: "threadTool",
        ownerUserId: 9,
        projectId: 3,
        threadId: 7,
        worktreePath: "/repo",
      },
      enabledPermissions: ["hello_plugin:hello_tools"],
      manager,
    });

    if (!tool) {
      throw new Error("Expected plugin tool.");
    }
    await expect(
      tool.execute("tool-call-1", {}, undefined, undefined, {} as never),
    ).rejects.toThrow(
      "Plugin tool hello_plugin_hello_world failed (plugin_network_failed): UploadThing request failed (401): unauthorized",
    );
  });

  it("fails safely when text or markdown results exceed 256 KB", async () => {
    const oversized = "x".repeat(PLUGIN_TOOL_MAX_TEXT_RESULT_BYTES + 1);

    await expect(
      executeTool({ text: oversized, type: "text" }),
    ).rejects.toThrow(PluginToolResultError);
    await expect(
      executeTool({ markdown: oversized, type: "markdown" }),
    ).rejects.toThrow("Plugin tool markdown result exceeds the 256 KB limit.");
  });

  it("requires storage read permission for image file results", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-tool-result-");
    mkdirSync(join(pluginPath, ".data"), { recursive: true });
    writeFileSync(join(pluginPath, ".data", "tiny.png"), "image-bytes");

    const registration = {
      ...TOOL_REGISTRATION,
      pluginPath,
    } satisfies PluginAgentToolRegistrationForThread;

    const tool = toolWithManagerResult(
      { mimeType: "image/png", path: "~/tiny.png", type: "image:file" },
      registration,
    );

    await expect(
      tool.execute("tool-call-1", {}, undefined, undefined, {} as never),
    ).rejects.toThrow(
      "Plugin image file result could not be read with declared permissions.",
    );
  });

  it("converts permitted image file results to Pi image content", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-tool-result-");
    mkdirSync(join(pluginPath, ".data"), { recursive: true });
    writeFileSync(join(pluginPath, ".data", "tiny.png"), "image-bytes");

    const registration = {
      ...TOOL_REGISTRATION,
      permissions: ["storage:read"],
      pluginPath,
    } satisfies PluginAgentToolRegistrationForThread;

    const result = await toolWithManagerResult(
      {
        alt: "tiny",
        mimeType: "image/png",
        path: "~/tiny.png",
        type: "image:file",
      },
      registration,
    ).execute("tool-call-1", {}, undefined, undefined, {} as never);

    expect(result.content).toEqual([
      { text: "Plugin image file (tiny): ~/tiny.png", type: "text" },
      {
        data: Buffer.from("image-bytes").toString("base64"),
        mimeType: "image/png",
        type: "image",
      },
    ]);
    expect(result.details).toMatchObject({ resultKind: "image:file" });
  });

  it("requires files read allowlist coverage for project image file results", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-tool-result-");
    const projectPath = createTempDirectory("metidos-plugin-tool-project-");
    mkdirSync(join(pluginPath, ".data"), { recursive: true });
    mkdirSync(join(projectPath, "public"), { recursive: true });
    writeFileSync(join(projectPath, "public", "tiny.png"), "image-bytes");

    const registration = {
      ...TOOL_REGISTRATION,
      filesReadAllowlist: ["./other/**"],
      permissions: ["storage:read", "files:read"],
      pluginPath,
    } satisfies PluginAgentToolRegistrationForThread;
    const manager = {
      invokeAgentTool: async () => ({
        mimeType: "image/png",
        path: "./public/tiny.png",
        type: "image:file",
      }),
      listAgentToolRegistrationsForThread: () => [registration],
    } as unknown as PluginSidecarProcessManager;
    const [tool] = createPiPluginTools({
      context: {
        contextKind: "threadTool",
        projectId: 3,
        threadId: 7,
        worktreePath: projectPath,
      },
      enabledPermissions: ["hello_plugin:hello_tools"],
      manager,
    });

    if (!tool) {
      throw new Error("Expected plugin tool.");
    }
    await expect(
      tool.execute("tool-call-1", {}, undefined, undefined, {} as never),
    ).rejects.toThrow(
      "Plugin image file result could not be read with declared permissions.",
    );
  });
});
