/**
 * @file src/bun/plugin/discovery.test.ts
 * @description Tests for side-effect-free Metidos plugin folder discovery.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  discoverPluginCandidates,
  getPluginsDirectoryPath,
  PluginDiscoveryService,
  type PluginDiscoverySnapshot,
} from "./discovery";

const tempDirectories = new Set<string>();

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

function writeStructurallyValidPlugin(
  pluginsDirectoryPath: string,
  directoryName: string,
  options: { indexSource?: string } = {},
): string {
  const pluginPath = join(pluginsDirectoryPath, directoryName);
  mkdirSync(pluginPath, { recursive: true });
  writeFileSync(
    join(pluginPath, "metidos-plugin.json"),
    JSON.stringify({
      id: directoryName,
      name: directoryName,
      version: "1.0.0",
      metidosApiVersion: "v1",
      main: "./index.ts",
      description: "test plugin",
    }),
  );
  writeFileSync(join(pluginPath, "AGENTS.md"), "# Test plugin\n");
  writeFileSync(
    join(pluginPath, "index.ts"),
    options.indexSource ?? "export default {};\n",
  );
  return pluginPath;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSnapshot(
  service: PluginDiscoveryService,
  predicate: (snapshot: PluginDiscoverySnapshot | null) => boolean,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate(service.snapshot)) {
      return;
    }
    await sleep(25);
  }
  throw new Error(
    `Timed out waiting for plugin discovery snapshot; last count was ${service.snapshot?.candidates.length ?? 0}.`,
  );
}

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  tempDirectories.clear();
});

describe("plugin discovery", () => {
  it("tolerates an absent APP_DATA/plugins directory", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-discovery-absent-");

    const snapshot = await discoverPluginCandidates({ appDataDir });

    expect(snapshot.pluginsDirectoryPath).toBe(join(appDataDir, "plugins"));
    expect(snapshot.pluginsDirectoryExists).toBe(false);
    expect(snapshot.candidates).toEqual([]);
    expect(snapshot.issues).toEqual([]);
  });

  it("discovers one structurally valid candidate per immediate child without executing index.ts", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-discovery-valid-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({ appDataDir });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    writeStructurallyValidPlugin(pluginsDirectoryPath, "hello_plugin", {
      indexSource: "throw new Error('plugin code was executed');\n",
    });

    const snapshot = await discoverPluginCandidates({ appDataDir });

    expect(snapshot.pluginsDirectoryExists).toBe(true);
    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0]).toMatchObject({
      directoryName: "hello_plugin",
      structurallyValid: true,
      hasRootNodeModules: false,
      issues: [],
    });
    expect(
      snapshot.candidates[0]?.requiredFiles["metidos-plugin.json"],
    ).toMatchObject({
      exists: true,
      isFile: true,
      readable: true,
    });
  });

  it("reports missing root files and forbidden root node_modules without traversing nested packages", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-discovery-errors-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({ appDataDir });
    mkdirSync(join(pluginsDirectoryPath, "outer", "nested-plugin"), {
      recursive: true,
    });
    writeStructurallyValidPlugin(
      join(pluginsDirectoryPath, "outer"),
      "nested-plugin",
    );
    mkdirSync(join(pluginsDirectoryPath, "outer", "node_modules"));

    const snapshot = await discoverPluginCandidates({ appDataDir });

    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0]?.directoryName).toBe("outer");
    expect(snapshot.candidates[0]?.structurallyValid).toBe(false);
    expect(
      snapshot.candidates[0]?.issues.map((issue) => issue.code).sort(),
    ).toEqual([
      "forbidden_root_node_modules",
      "missing_required_file",
      "missing_required_file",
    ]);
  });

  it("refreshes watched inventory when uninitialized plugin folders are added and removed", async () => {
    const appDataDir = createTempDirectory("metidos-plugin-discovery-watch-");
    const pluginsDirectoryPath = getPluginsDirectoryPath({ appDataDir });
    mkdirSync(pluginsDirectoryPath, { recursive: true });
    const service = new PluginDiscoveryService({ appDataDir, debounceMs: 10 });
    try {
      const initialSnapshot = await service.start();
      expect(initialSnapshot.candidates).toEqual([]);

      const pluginPath = writeStructurallyValidPlugin(
        pluginsDirectoryPath,
        "watched_plugin",
      );
      await waitForSnapshot(
        service,
        (snapshot) => snapshot?.candidates.length === 1,
      );
      expect(service.snapshot?.candidates[0]?.directoryName).toBe(
        "watched_plugin",
      );

      unlinkSync(join(pluginPath, "AGENTS.md"));
      await waitForSnapshot(
        service,
        (snapshot) =>
          snapshot?.candidates[0]?.issues.some(
            (issue) => issue.code === "missing_required_file",
          ) === true,
      );

      rmSync(pluginPath, { recursive: true, force: true });
      await waitForSnapshot(
        service,
        (snapshot) => snapshot?.candidates.length === 0,
      );
      expect(service.snapshot?.candidates).toEqual([]);
    } finally {
      service.stop();
    }
  });
});
