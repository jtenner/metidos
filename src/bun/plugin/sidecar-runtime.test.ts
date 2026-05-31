/**
 * @file src/bun/plugin/sidecar-runtime.test.ts
 * @description Tests for Plugin System v1 sidecar runtime process/worker primitives.
 */

import { describe, expect, it } from "bun:test";

import {
  buildDefaultPluginSidecarCommand,
  buildPluginSidecarHostEnvironment,
  DEFAULT_PLUGIN_SIDECAR_MEMORY_LIMIT_BYTES,
  resolvePluginSidecarRuntimeKind,
} from "./sidecar-runtime";

describe("plugin sidecar runtime", () => {
  it("resolves the explicit plugin sidecar runtime kind", () => {
    expect(resolvePluginSidecarRuntimeKind()).toBe("process");
    expect(resolvePluginSidecarRuntimeKind("worker")).toBe("worker");
    expect(resolvePluginSidecarRuntimeKind(" process ")).toBe("process");
    expect(() => resolvePluginSidecarRuntimeKind("isolated")).toThrow(
      'Invalid METIDOS_PLUGIN_RUNTIME_KIND "isolated". Expected "worker" or "process".',
    );
  });

  it("keeps worker and process sidecar host environments minimal", () => {
    expect(
      buildPluginSidecarHostEnvironment(
        {
          HOST_SECRET: "do-not-forward",
          METIDOS_APP_DATA_DIR: "/sensitive/app-data",
          PATH: "/usr/bin",
          SystemRoot: "C:\\Windows",
        },
        "linux",
      ),
    ).toEqual({ PATH: "/usr/bin" });

    expect(
      buildPluginSidecarHostEnvironment(
        {
          HOST_SECRET: "do-not-forward",
          PATH: "C:\\Windows\\System32",
          SystemRoot: "C:\\Windows",
        },
        "win32",
      ),
    ).toEqual({ PATH: "C:\\Windows\\System32", SystemRoot: "C:\\Windows" });
  });

  it("applies the default POSIX sidecar memory limit to spawned command lines", () => {
    const command = buildDefaultPluginSidecarCommand(
      DEFAULT_PLUGIN_SIDECAR_MEMORY_LIMIT_BYTES,
    );

    if (process.platform === "win32") {
      expect(command).toEqual([
        process.execPath,
        "run",
        expect.stringContaining("sidecar-windows-job.ts"),
        "--",
        process.execPath,
        "run",
        expect.stringContaining("sidecar-main.ts"),
      ]);
      return;
    }

    expect(command.slice(0, 4)).toEqual([
      "sh",
      "-c",
      'ulimit -v 4194304; exec "$@"',
      "metidos-plugin-sidecar",
    ]);
    expect(command.slice(4)).toEqual([
      process.execPath,
      "run",
      expect.stringContaining("sidecar-main.ts"),
    ]);
  });
});
