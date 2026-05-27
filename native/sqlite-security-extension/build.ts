#!/usr/bin/env bun

import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface BuildTarget {
  readonly triple: string;
  readonly platform: "linux" | "macos" | "windows";
  readonly arch: "x64" | "arm64";
  readonly extension: "so" | "dylib" | "dll";
  readonly needsPic: boolean;
}

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(projectDirectory, "src", "metidos_sqlite_security.c");
const includePath = join(projectDirectory, "src");
const distDirectory = join(projectDirectory, "dist");

const targets: readonly BuildTarget[] = [
  {
    arch: "x64",
    extension: "so",
    needsPic: true,
    platform: "linux",
    triple: "x86_64-linux-gnu",
  },
  {
    arch: "arm64",
    extension: "so",
    needsPic: true,
    platform: "linux",
    triple: "aarch64-linux-gnu",
  },
  {
    arch: "x64",
    extension: "dylib",
    needsPic: true,
    platform: "macos",
    triple: "x86_64-macos",
  },
  {
    arch: "arm64",
    extension: "dylib",
    needsPic: true,
    platform: "macos",
    triple: "aarch64-macos",
  },
  {
    arch: "x64",
    extension: "dll",
    needsPic: false,
    platform: "windows",
    triple: "x86_64-windows-gnu",
  },
];

function getHostTarget(): BuildTarget {
  const platform = process.platform;
  const arch = process.arch;
  const target = targets.find((candidate) => {
    if (platform === "linux") {
      return (
        candidate.platform === "linux" &&
        ((arch === "x64" && candidate.arch === "x64") ||
          (arch === "arm64" && candidate.arch === "arm64"))
      );
    }
    if (platform === "darwin") {
      return (
        candidate.platform === "macos" &&
        ((arch === "x64" && candidate.arch === "x64") ||
          (arch === "arm64" && candidate.arch === "arm64"))
      );
    }
    if (platform === "win32") {
      return candidate.platform === "windows" && candidate.arch === "x64";
    }
    return false;
  });

  if (!target) {
    throw new Error(
      `Unsupported host platform for SQLite extension: ${platform}/${arch}`,
    );
  }
  return target;
}

function parseTargets(): readonly BuildTarget[] {
  const targetArgument = process.argv.find((argument) =>
    argument.startsWith("--target="),
  );
  const requestedTarget = targetArgument?.slice("--target=".length) ?? "all";

  if (requestedTarget === "all") {
    return targets;
  }
  if (requestedTarget === "host") {
    return [getHostTarget()];
  }

  const target = targets.find(
    (candidate) =>
      candidate.triple === requestedTarget ||
      `${candidate.platform}-${candidate.arch}` === requestedTarget,
  );
  if (!target) {
    const supportedTargets = targets
      .map(
        (candidate) =>
          `${candidate.triple} (${candidate.platform}-${candidate.arch})`,
      )
      .join(", ");
    throw new Error(
      `Unsupported --target=${requestedTarget}. Supported targets: all, host, ${supportedTargets}`,
    );
  }
  return [target];
}

async function run(command: string, args: readonly string[]): Promise<void> {
  const proc = Bun.spawn([command, ...args], {
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with code ${exitCode}`,
    );
  }
}

async function buildTarget(target: BuildTarget): Promise<void> {
  const outputDirectory = join(distDirectory, target.triple);
  const outputPath = join(
    outputDirectory,
    `metidos_sqlite_security.${target.extension}`,
  );
  await mkdir(outputDirectory, { recursive: true });

  const args = [
    "cc",
    "-target",
    target.triple,
    "-shared",
    "-Os",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-I",
    includePath,
    sourcePath,
    "-o",
    outputPath,
  ];
  if (target.needsPic) {
    args.splice(4, 0, "-fPIC");
  }

  console.log(`Building ${target.triple} -> ${outputPath}`);
  await run("zig", args);
}

const clean = process.argv.includes("--clean");
const selectedTargets = parseTargets();

if (clean) {
  await rm(distDirectory, { force: true, recursive: true });
}

for (const target of selectedTargets) {
  await buildTarget(target);
}
