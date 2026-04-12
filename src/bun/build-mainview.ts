/**
 * @file src/bun/build-mainview.ts
 * @description Module for build mainview.
 */

import { rmSync } from "node:fs";
import { resolve } from "node:path";

import reactCompiler from "../../bun-plugin-react-compiler";

/** Absolute path to the main frontend entry module used to produce the browser bundle. */
const MAINVIEW_ENTRYPOINT = resolve(process.cwd(), "src/mainview/index.ts");

/** Output directory for the built frontend assets consumed by the Bun sidecar. */
export const MAINVIEW_BUILD_DIR = resolve(process.cwd(), ".metidos-build");

/** Canonical sourcemap path produced when external sourcemaps are enabled. */
const MAINVIEW_BUNDLE_SOURCE_MAP_PATH = resolve(
  MAINVIEW_BUILD_DIR,
  "index.js.map",
);

export type MainviewBuildMode = "development" | "production";

export type MainviewBuildOptions = {
  args?: readonly string[];
  emitSourceMap?: boolean;
  env?: NodeJS.ProcessEnv;
  mode?: MainviewBuildMode;
};

export type ResolvedMainviewBuildOptions = {
  emitSourceMap: boolean;
  minify: boolean;
  mode: MainviewBuildMode;
  sourcemap: "external" | "none";
};

export type MainviewBuildResult = {
  bundlePath: string;
  minify: boolean;
  mode: MainviewBuildMode;
  sourceMapPath: string | null;
  sourcemap: "external" | "none";
};

function readEnvVar(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function readEnvFlag(env: NodeJS.ProcessEnv, name: string): boolean {
  return readEnvVar(env, name) === "1";
}

function readLastCliFlag(
  args: readonly string[],
  allowedFlags: readonly string[],
): string | null {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const value = args[index];
    if (value && allowedFlags.includes(value)) {
      return value;
    }
  }

  return null;
}

/**
 * Resolve the intended frontend build mode so dev and production behave differently on purpose.
 */
export function resolveMainviewBuildOptions({
  args = [],
  emitSourceMap,
  env = process.env,
  mode,
}: MainviewBuildOptions = {}): ResolvedMainviewBuildOptions {
  const modeFlag = readLastCliFlag(args, ["--dev", "--production"]);
  const resolvedMode =
    mode ??
    (modeFlag === "--dev"
      ? "development"
      : modeFlag === "--production"
        ? "production"
        : readEnvFlag(env, "METIDOS_DEV")
          ? "development"
          : "production");

  const sourceMapFlag = readLastCliFlag(args, [
    "--sourcemap",
    "--no-sourcemap",
  ]);
  const resolvedEmitSourceMap =
    emitSourceMap ??
    (sourceMapFlag === "--sourcemap"
      ? true
      : sourceMapFlag === "--no-sourcemap"
        ? false
        : resolvedMode === "development" ||
          readEnvFlag(env, "METIDOS_MAINVIEW_SOURCEMAP"));

  return {
    emitSourceMap: resolvedEmitSourceMap,
    minify: resolvedMode === "production",
    mode: resolvedMode,
    sourcemap: resolvedEmitSourceMap ? "external" : "none",
  };
}

/**
 * Build the mainview frontend bundle and return the emitted artifact paths.
 *
 * Uses Bun’s bundler with the custom React compiler plugin to transform TSX.
 * Returns absolute paths and throws when the bundling result is incomplete.
 */
export async function buildMainviewBundle(
  options: MainviewBuildOptions = {},
): Promise<MainviewBuildResult> {
  const resolvedOptions = resolveMainviewBuildOptions(options);

  const buildResult = await Bun.build({
    entrypoints: [MAINVIEW_ENTRYPOINT],
    format: "esm",
    minify: resolvedOptions.minify,
    outdir: MAINVIEW_BUILD_DIR,
    plugins: [reactCompiler],
    sourcemap: resolvedOptions.sourcemap,
    target: "browser",
  });

  // Surface build errors early and include Bun-provided diagnostic logs for debugging.
  if (!buildResult.success) {
    for (const log of buildResult.logs) {
      console.error(log);
    }
    throw new Error("Failed to build browser bundle");
  }

  // The output naming is controlled by Bun; we require `index.js` for the runtime loader.
  const mainviewBundle = buildResult.outputs.find((output) =>
    output.path.endsWith("index.js"),
  );
  if (!mainviewBundle) {
    throw new Error("Mainview JavaScript bundle was not emitted");
  }

  let sourceMapPath: string | null = null;
  if (resolvedOptions.emitSourceMap) {
    const mainviewSourceMap = buildResult.outputs.find((output) =>
      output.path.endsWith("index.js.map"),
    );
    if (!mainviewSourceMap) {
      throw new Error(
        "Mainview JavaScript source map was requested but not emitted",
      );
    }
    sourceMapPath = mainviewSourceMap.path;
  } else {
    rmSync(MAINVIEW_BUNDLE_SOURCE_MAP_PATH, {
      force: true,
    });
  }

  return {
    bundlePath: mainviewBundle.path,
    minify: resolvedOptions.minify,
    mode: resolvedOptions.mode,
    sourceMapPath,
    sourcemap: resolvedOptions.sourcemap,
  };
}

/** CLI entrypoint: build and print the produced bundle path when directly executed. */
if (import.meta.main) {
  const buildResult = await buildMainviewBundle({
    args: Bun.argv.slice(2),
    env: process.env,
  });
  const sourceMapNote = buildResult.sourceMapPath
    ? ` with sourcemap ${buildResult.sourceMapPath}`
    : " without sourcemap";
  console.log(
    `Built ${buildResult.mode} mainview bundle at ${buildResult.bundlePath}${sourceMapNote}`,
  );
}
