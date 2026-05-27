/**
 * @file src/bun/plugin/entrypoint-build.test.ts
 * @description Tests for Plugin System v1 entrypoint build import policy.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  buildPluginEntrypoint,
  DEFAULT_PLUGIN_SOURCE_FILE_MAX_BYTES,
} from "./entrypoint-build";
import {
  decodePluginSidecarRpcEnvelope,
  encodePluginSidecarRpcEnvelope,
  PLUGIN_SIDECAR_RPC_PROTOCOL_VERSION,
  type PluginSidecarEnvelope,
} from "./sidecar-rpc";

const tempDirectories = new Set<string>();
const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  writeManifest(path);
  return path;
}

function writePluginFile(
  root: string,
  relativePath: string,
  contents: string,
): void {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeManifest(root: string, main = "./index.ts"): void {
  writePluginFile(
    root,
    "metidos-plugin.json",
    `${JSON.stringify(
      {
        description: "Entrypoint build test plugin.",
        id: "entrypoint_test",
        main,
        metidosApiVersion: "v1",
        name: "Entrypoint Test",
        version: "1.0.0",
      },
      null,
      2,
    )}\n`,
  );
}

function createPluginRoot(indexSource: string, main = "./index.ts"): string {
  const root = createTempDirectory("metidos-plugin-entrypoint-");
  writeManifest(root, main);
  writePluginFile(root, main.replace(/^\.\//, ""), indexSource);
  return root;
}

type SidecarInputStream =
  | WritableStream<Uint8Array>
  | {
      flush?: () => unknown;
      write: (chunk: string | Uint8Array) => unknown;
    };

async function writeSidecarInput(
  stream: SidecarInputStream,
  frame: string,
): Promise<void> {
  if ("getWriter" in stream) {
    const writer = stream.getWriter();
    try {
      await writer.write(TEXT_ENCODER.encode(frame));
    } finally {
      writer.releaseLock();
    }
    return;
  }
  await stream.write(frame);
  await stream.flush?.();
}

async function readStreamLine(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  let buffer = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffer += TEXT_DECODER.decode(chunk.value, { stream: true });
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex !== -1) {
        return buffer.slice(0, newlineIndex).trimEnd();
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error("Stream ended before a line was available.");
}

function encodeHostStartup(pluginId: string): string {
  const encoded = encodePluginSidecarRpcEnvelope({
    id: "startup-test",
    payload: {
      apiVersion: "v1",
      env: [],
      protocolVersion: PLUGIN_SIDECAR_RPC_PROTOCOL_VERSION,
      reviewHash: "sha256:test",
    },
    pluginId,
    type: "host.startup",
  });
  if (typeof encoded !== "string") {
    throw new Error(encoded.error.message);
  }
  return encoded;
}

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("buildPluginEntrypoint", () => {
  it("builds local multi-file plugins with the Metidos plugin API externalized", async () => {
    const pluginRoot = createPluginRoot(`
      import { definePlugin } from "@metidos/plugin-api";
      import { greeting } from "./lib/greeting";
      export default definePlugin({ name: greeting });
    `);
    writePluginFile(
      pluginRoot,
      "lib/greeting.ts",
      `export const greeting = "hello";\n`,
    );

    await expect(buildPluginEntrypoint({ pluginRoot })).resolves.toMatchObject({
      outputCount: 2,
      sourceMap: expect.any(String),
    });
  });

  it("builds plugins that re-export local modules", async () => {
    const pluginRoot = createPluginRoot(`
      import { definePlugin } from "@metidos/plugin-api";
      export { helper } from "./lib/helper";
      export default definePlugin({ tools: [] });
    `);
    writePluginFile(pluginRoot, "lib/helper.ts", `export const helper = 1;\n`);

    await expect(buildPluginEntrypoint({ pluginRoot })).resolves.toMatchObject({
      language: "javascript",
      outputCount: 2,
      sourceMap: expect.any(String),
    });
  });

  it("builds plugins that import base64 helpers from the Metidos plugin API", async () => {
    const pluginRoot = createPluginRoot(`
      import { atob, btoa, definePlugin } from "@metidos/plugin-api";
      const encoded = btoa("ok");
      export default definePlugin({ encoded, decoded: atob(encoded) });
    `);

    await expect(buildPluginEntrypoint({ pluginRoot })).resolves.toMatchObject({
      language: "javascript",
      outputCount: 2,
      sourceMap: expect.any(String),
    });
  });

  it("builds Python entrypoints into a Pyodide bootstrap with a metidos module bridge", async () => {
    const pluginRoot = createPluginRoot(
      `from metidos import fs\nprint(fs)\n`,
      "./main.py",
    );

    const result = await buildPluginEntrypoint({ pluginRoot });

    expect(result).toMatchObject({
      entrypointPath: expect.stringContaining("main.py"),
      language: "python",
      outputCount: 1,
      sourceMap: null,
    });
    expect(result.source).not.toContain("@pyscript/core");
    expect(result.source).toContain("from js import metidos as _js_metidos");
    expect(result.source).toContain("from metidos import fs");
  });

  it("rejects oversized plugin source files before bundling", async () => {
    const pluginRoot = createPluginRoot(
      `export default ${JSON.stringify("x".repeat(DEFAULT_PLUGIN_SOURCE_FILE_MAX_BYTES))};\n`,
    );

    await expect(buildPluginEntrypoint({ pluginRoot })).rejects.toThrow(
      "byte file limit",
    );
  });

  it("rejects oversized Python entrypoints before reading bootstrap source", async () => {
    const pluginRoot = createPluginRoot(
      `print(${JSON.stringify("x".repeat(DEFAULT_PLUGIN_SOURCE_FILE_MAX_BYTES))})\n`,
      "./main.py",
    );

    await expect(buildPluginEntrypoint({ pluginRoot })).rejects.toThrow(
      "byte file limit",
    );
  });

  it.each([
    [
      "bare fs import",
      `import fs from "fs"; export default fs;`,
      "package imports are not supported",
    ],
    [
      "node import",
      `import fs from "node:fs"; export default fs;`,
      "node: imports are not supported",
    ],
    [
      "bun import",
      `import sqlite from "bun:sqlite"; export default sqlite;`,
      "bun: imports are not supported",
    ],
    [
      "package import",
      `import leftPad from "left-pad"; export default leftPad;`,
      "package imports are not supported",
    ],
    [
      "dynamic import",
      `const local = await import("./local"); export default local;`,
      "dynamic import(...) is not supported",
    ],
    [
      "require call",
      `const local = require("./local"); export default local;`,
      "CommonJS require is not supported",
    ],
    [
      "require resolve",
      `const local = require.resolve("./local"); export default local;`,
      "CommonJS require is not supported",
    ],
  ])("rejects %s before execution", async (_name, source, expectedMessage) => {
    const pluginRoot = createPluginRoot(source);
    writePluginFile(pluginRoot, "local.ts", "export default {};\n");

    await expect(buildPluginEntrypoint({ pluginRoot })).rejects.toThrow(
      expectedMessage,
    );
  });

  it("rejects absolute imports", async () => {
    const pluginRoot = createTempDirectory(
      "metidos-plugin-entrypoint-absolute-",
    );
    const absolutePath = join(pluginRoot, "local.ts");
    writePluginFile(
      pluginRoot,
      "index.ts",
      `import local from ${JSON.stringify(absolutePath)}; export default local;\n`,
    );
    writePluginFile(pluginRoot, "local.ts", "export default {};\n");

    await expect(buildPluginEntrypoint({ pluginRoot })).rejects.toThrow(
      "absolute imports are not supported",
    );
  });

  it("rejects relative imports that escape the plugin folder", async () => {
    const parent = createTempDirectory("metidos-plugin-entrypoint-parent-");
    const pluginRoot = join(parent, "plugin");
    mkdirSync(pluginRoot, { recursive: true });
    writeManifest(pluginRoot);
    writeFileSync(join(parent, "outside.ts"), "export default {};\n");
    writePluginFile(
      pluginRoot,
      "index.ts",
      `import outside from "../outside"; export default outside;\n`,
    );

    await expect(buildPluginEntrypoint({ pluginRoot })).rejects.toThrow(
      "relative imports must stay inside the plugin folder",
    );
  });

  it("rejects relative imports from plugin-managed data, log, and backup roots", async () => {
    for (const directoryName of [
      ".data",
      ".logs",
      ".data-bak-2026-04-28",
    ] as const) {
      const pluginRoot = createPluginRoot(
        `import hidden from "./${directoryName}/hidden"; export default hidden;\n`,
      );
      writePluginFile(
        pluginRoot,
        `${directoryName}/hidden.ts`,
        "export default {};\n",
      );

      await expect(buildPluginEntrypoint({ pluginRoot })).rejects.toThrow(
        "plugin-managed data, log, and backup directories are not importable source roots",
      );
    }
  });

  it("rejects relative imports that resolve through symlinks outside the plugin folder", async () => {
    const parent = createTempDirectory("metidos-plugin-entrypoint-symlink-");
    const pluginRoot = join(parent, "plugin");
    mkdirSync(pluginRoot, { recursive: true });
    writeManifest(pluginRoot);
    writeFileSync(join(parent, "outside.ts"), "export default {};\n");
    symlinkSync(join(parent, "outside.ts"), join(pluginRoot, "linked.ts"));
    writePluginFile(
      pluginRoot,
      "index.ts",
      `import linked from "./linked"; export default linked;\n`,
    );

    await expect(buildPluginEntrypoint({ pluginRoot })).rejects.toThrow(
      "relative imports must not resolve through symlinks outside the plugin folder",
    );
  });

  it("rejects forbidden imports before plugin source execution", async () => {
    const pluginRoot = createTempDirectory("metidos-plugin-entrypoint-gated-");
    const markerPath = join(pluginRoot, "source-executed.txt");
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import fs from "fs";
        await Bun.write(${JSON.stringify(markerPath)}, "executed");
        export default fs;
      `,
    );

    await expect(buildPluginEntrypoint({ pluginRoot })).rejects.toThrow(
      "package imports are not supported",
    );
    expect(existsSync(markerPath)).toBe(false);
  });

  it("starts sidecars after executing top-level await plugin setup registrations in QuickJS", async () => {
    const pluginId = "async_plugin";
    const pluginRoot = createPluginRoot(`
      import { definePlugin } from "@metidos/plugin-api";
      const name = await Promise.resolve("async plugin");
      export default definePlugin(async (metidos) => {
        await Promise.resolve(name);
        metidos.addAgentTool({
          tool: "hello_world",
          name: "Hello world",
          description: "Say hello.",
          timeoutMs: 5000,
          validateProps(props) {
            return props;
          },
          action() {
            return "hello";
          },
        });
      });
    `);
    const sidecarProcess = Bun.spawn({
      cmd: [process.execPath, "run", join(import.meta.dir, "sidecar-main.ts")],
      cwd: pluginRoot,
      env: {
        ...process.env,
        METIDOS_PLUGIN_ID: pluginId,
        METIDOS_PLUGIN_ROOT: pluginRoot,
      },
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    });
    if (!sidecarProcess.stdin || !sidecarProcess.stdout) {
      throw new Error("Sidecar process did not expose standard streams.");
    }

    await writeSidecarInput(sidecarProcess.stdin, encodeHostStartup(pluginId));

    const stdoutLine = await readStreamLine(sidecarProcess.stdout);
    const decoded = decodePluginSidecarRpcEnvelope(stdoutLine, {
      expectedPluginId: pluginId,
    });
    expect(decoded.ok).toBe(true);
    const envelope = (decoded as { envelope: PluginSidecarEnvelope }).envelope;
    expect(envelope.type).toBe("sidecar.ready");
    if (envelope.type === "sidecar.ready") {
      expect(envelope.payload.registrations).toEqual({
        tools: [
          {
            actionHandle: "tool:action:2",
            description: "Say hello.",
            name: "Hello world",
            timeoutMs: 5000,
            tool: "hello_world",
            validatePropsHandle: "tool:validateProps:1",
          },
        ],
      });
    }

    sidecarProcess.kill("SIGTERM");
    await sidecarProcess.exited;
  });

  it("surfaces rejected QuickJS setup through the sidecar protocol and stderr", async () => {
    const pluginId = "reject_plugin";
    const pluginRoot = createPluginRoot(`
      await Promise.reject(new Error("setup rejected"));
      export default {};
    `);
    const sidecarProcess = Bun.spawn({
      cmd: [process.execPath, "run", join(import.meta.dir, "sidecar-main.ts")],
      cwd: pluginRoot,
      env: {
        ...process.env,
        METIDOS_PLUGIN_ID: pluginId,
        METIDOS_PLUGIN_ROOT: pluginRoot,
      },
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    });
    if (
      !sidecarProcess.stdin ||
      !sidecarProcess.stdout ||
      !sidecarProcess.stderr
    ) {
      throw new Error("Sidecar process did not expose standard streams.");
    }

    await writeSidecarInput(sidecarProcess.stdin, encodeHostStartup(pluginId));

    const stdoutLine = await readStreamLine(sidecarProcess.stdout);
    const decoded = decodePluginSidecarRpcEnvelope(stdoutLine, {
      expectedPluginId: pluginId,
    });
    expect(decoded.ok).toBe(true);
    const envelope = (decoded as { envelope: PluginSidecarEnvelope }).envelope;
    expect(envelope.type).toBe("sidecar.error");
    if (envelope.type === "sidecar.error") {
      expect(envelope.payload.code).toBe("plugin_startup_failed");
      expect(envelope.payload.message).toContain("setup rejected");
    }

    const stderrLine = await readStreamLine(sidecarProcess.stderr);
    expect(stderrLine).toContain("Plugin QuickJS setup failed");
    sidecarProcess.kill("SIGTERM");
    await sidecarProcess.exited;
  });

  it("surfaces import-policy startup failures through the sidecar protocol and stderr", async () => {
    const pluginId = "bad_plugin";
    const pluginRoot = createPluginRoot(
      `import fs from "fs"; export default fs;\n`,
    );
    const sidecarProcess = Bun.spawn({
      cmd: [process.execPath, "run", join(import.meta.dir, "sidecar-main.ts")],
      cwd: pluginRoot,
      env: {
        ...process.env,
        METIDOS_PLUGIN_ID: pluginId,
        METIDOS_PLUGIN_ROOT: pluginRoot,
      },
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    });
    if (
      !sidecarProcess.stdin ||
      !sidecarProcess.stdout ||
      !sidecarProcess.stderr
    ) {
      throw new Error("Sidecar process did not expose standard streams.");
    }

    await writeSidecarInput(sidecarProcess.stdin, encodeHostStartup(pluginId));

    const stdoutLine = await readStreamLine(sidecarProcess.stdout);
    const decoded = decodePluginSidecarRpcEnvelope(stdoutLine, {
      expectedPluginId: pluginId,
    });
    expect(decoded.ok).toBe(true);
    const envelope = (decoded as { envelope: PluginSidecarEnvelope }).envelope;
    expect(envelope.type).toBe("sidecar.error");
    if (envelope.type === "sidecar.error") {
      expect(envelope.payload.code).toBe("plugin_build_failed");
      expect(envelope.payload.message).toContain(
        "package imports are not supported",
      );
    }

    const stderrLine = await readStreamLine(sidecarProcess.stderr);
    expect(stderrLine).toContain("Plugin entrypoint build failed");
    sidecarProcess.kill("SIGTERM");
    await sidecarProcess.exited;
  });
});
