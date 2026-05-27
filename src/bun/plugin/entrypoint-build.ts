/**
 * @file src/bun/plugin/entrypoint-build.ts
 * @description Build and import-policy enforcement for Plugin System v1 entrypoints.
 */

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  METIDOS_PLUGIN_MANIFEST_FILE_NAME,
  parsePluginManifest,
} from "./manifest";
import { pythonPluginEntrypointSource } from "./python-runtime";
import { createMetidosPluginApiBuildPlugin } from "./quickjs-runtime";

export const METIDOS_PLUGIN_API_IMPORT = "@metidos/plugin-api";

export type PluginEntrypointLanguage = "javascript" | "python";

const IMPORTABLE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
] as const;
const PYTHON_ENTRYPOINT_EXTENSION = ".py";
const PLUGIN_IMPORT_EXCLUDED_ROOT_DIRECTORY_NAMES = new Set([".data", ".logs"]);
export const DEFAULT_PLUGIN_SOURCE_FILE_MAX_BYTES = 1024 * 1024;
export const DEFAULT_PLUGIN_SOURCE_TOTAL_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_PLUGIN_BUILD_OUTPUT_MAX_BYTES = 5 * 1024 * 1024;
const PLUGIN_TRANSPILER = new Bun.Transpiler({ loader: "ts" });

type PluginEntrypointBuildOptions = {
  pluginRoot: string;
};

type PluginEntrypointBunBuildConfig = Bun.BuildConfig & {
  write: false;
};

export type PluginEntrypointBuildResult = {
  entrypointPath: string;
  language: PluginEntrypointLanguage;
  outputCount: number;
  pythonSource?: string;
  source: string;
  sourceMap: string | null;
};

export class PluginImportPolicyError extends Error {
  readonly sourcePath: string | null;
  readonly specifier: string;

  constructor(input: {
    message: string;
    sourcePath?: string | null;
    specifier: string;
  }) {
    super(input.message);
    this.name = "PluginImportPolicyError";
    this.sourcePath = input.sourcePath ?? null;
    this.specifier = input.specifier;
  }
}

export class PluginEntrypointBuildError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : options);
    this.name = "PluginEntrypointBuildError";
  }
}

function normalizePluginPath(path: string): string {
  return path.split(sep).join("/");
}

function pathInsideOrEqual(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function displayPath(rootPath: string, filePath: string): string {
  const relativePath = relative(rootPath, filePath);
  return relativePath === "" ? "." : normalizePluginPath(relativePath);
}

function isPluginImportExcludedPath(input: {
  candidatePath: string;
  pluginRoot: string;
}): boolean {
  const [rootName] = normalizePluginPath(
    relative(input.pluginRoot, input.candidatePath),
  ).split("/");
  return (
    rootName !== undefined &&
    (PLUGIN_IMPORT_EXCLUDED_ROOT_DIRECTORY_NAMES.has(rootName) ||
      rootName.startsWith(".data-bak-"))
  );
}

function importPolicyFailure(input: {
  pluginRoot: string;
  reason: string;
  sourcePath: string | null;
  specifier: string;
}): PluginImportPolicyError {
  const from = input.sourcePath
    ? ` from ${displayPath(input.pluginRoot, input.sourcePath)}`
    : "";
  return new PluginImportPolicyError({
    message: `Plugin import policy rejected ${JSON.stringify(input.specifier)}${from}: ${input.reason}`,
    sourcePath: input.sourcePath,
    specifier: input.specifier,
  });
}

function existingFileCandidate(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  const stat = lstatSync(path);
  return stat.isFile() || stat.isSymbolicLink() ? path : null;
}

function resolveRelativeImportCandidate(input: {
  pluginRoot: string;
  sourcePath: string;
  specifier: string;
}): string | null {
  const basePath = resolve(dirname(input.sourcePath), input.specifier);
  if (!pathInsideOrEqual(input.pluginRoot, basePath)) {
    throw importPolicyFailure({
      pluginRoot: input.pluginRoot,
      reason: "relative imports must stay inside the plugin folder",
      sourcePath: input.sourcePath,
      specifier: input.specifier,
    });
  }

  const candidates: string[] = [];
  for (const extension of IMPORTABLE_EXTENSIONS) {
    candidates.push(`${basePath}${extension}`);
  }
  for (const extension of IMPORTABLE_EXTENSIONS) {
    candidates.push(join(basePath, `index${extension}`));
  }

  for (const candidate of candidates) {
    const fileCandidate = existingFileCandidate(candidate);
    if (!fileCandidate) {
      continue;
    }
    const realCandidate = realpathSync.native(fileCandidate);
    if (!pathInsideOrEqual(input.pluginRoot, realCandidate)) {
      throw importPolicyFailure({
        pluginRoot: input.pluginRoot,
        reason:
          "relative imports must not resolve through symlinks outside the plugin folder",
        sourcePath: input.sourcePath,
        specifier: input.specifier,
      });
    }
    if (
      isPluginImportExcludedPath({
        candidatePath: realCandidate,
        pluginRoot: input.pluginRoot,
      })
    ) {
      throw importPolicyFailure({
        pluginRoot: input.pluginRoot,
        reason:
          "plugin-managed data, log, and backup directories are not importable source roots",
        sourcePath: input.sourcePath,
        specifier: input.specifier,
      });
    }
    return realCandidate;
  }

  return null;
}

function validateImportSpecifier(input: {
  kind: Bun.ImportKind;
  pluginRoot: string;
  sourcePath: string;
  specifier: string;
}): string | null {
  if (input.kind === "dynamic-import") {
    throw importPolicyFailure({
      pluginRoot: input.pluginRoot,
      reason: "dynamic import(...) is not supported",
      sourcePath: input.sourcePath,
      specifier: input.specifier,
    });
  }
  if (input.kind === "require-call" || input.kind === "require-resolve") {
    throw importPolicyFailure({
      pluginRoot: input.pluginRoot,
      reason: "CommonJS require is not supported",
      sourcePath: input.sourcePath,
      specifier: input.specifier,
    });
  }
  if (input.specifier === METIDOS_PLUGIN_API_IMPORT) {
    return null;
  }
  if (input.specifier.startsWith("node:")) {
    throw importPolicyFailure({
      pluginRoot: input.pluginRoot,
      reason: "node: imports are not supported",
      sourcePath: input.sourcePath,
      specifier: input.specifier,
    });
  }
  if (input.specifier.startsWith("bun:")) {
    throw importPolicyFailure({
      pluginRoot: input.pluginRoot,
      reason: "bun: imports are not supported",
      sourcePath: input.sourcePath,
      specifier: input.specifier,
    });
  }
  if (input.specifier.startsWith("./") || input.specifier.startsWith("../")) {
    return resolveRelativeImportCandidate(input);
  }
  if (isAbsolute(input.specifier)) {
    throw importPolicyFailure({
      pluginRoot: input.pluginRoot,
      reason: "absolute imports are not supported",
      sourcePath: input.sourcePath,
      specifier: input.specifier,
    });
  }

  throw importPolicyFailure({
    pluginRoot: input.pluginRoot,
    reason: `package imports are not supported; only ${METIDOS_PLUGIN_API_IMPORT} may be imported by package name`,
    sourcePath: input.sourcePath,
    specifier: input.specifier,
  });
}

function scanPluginSourceLimits(input: {
  entrypointPath: string;
  maxSourceFileBytes?: number;
  maxTotalSourceBytes?: number;
  pluginRoot: string;
}): void {
  const stat = lstatSync(input.entrypointPath);
  const maxSourceFileBytes =
    input.maxSourceFileBytes ?? DEFAULT_PLUGIN_SOURCE_FILE_MAX_BYTES;
  if (stat.size > maxSourceFileBytes) {
    throw new PluginEntrypointBuildError(
      `Plugin source file ${displayPath(input.pluginRoot, input.entrypointPath)} exceeds the ${maxSourceFileBytes} byte file limit.`,
    );
  }
  const maxTotalSourceBytes =
    input.maxTotalSourceBytes ?? DEFAULT_PLUGIN_SOURCE_TOTAL_MAX_BYTES;
  if (stat.size > maxTotalSourceBytes) {
    throw new PluginEntrypointBuildError(
      `Plugin source graph exceeds the ${maxTotalSourceBytes} byte total source limit.`,
    );
  }
}

function scanPluginImportPolicy(input: {
  entrypointPath: string;
  maxSourceFileBytes?: number;
  maxTotalSourceBytes?: number;
  pluginRoot: string;
}): void {
  const pending = [input.entrypointPath];
  const visited = new Set<string>();
  let totalBytes = 0;

  while (pending.length > 0) {
    const sourcePath = pending.pop();
    if (!sourcePath || visited.has(sourcePath)) {
      continue;
    }
    visited.add(sourcePath);
    scanPluginSourceLimits({
      entrypointPath: sourcePath,
      ...(input.maxSourceFileBytes === undefined
        ? {}
        : { maxSourceFileBytes: input.maxSourceFileBytes }),
      ...(input.maxTotalSourceBytes === undefined
        ? {}
        : { maxTotalSourceBytes: input.maxTotalSourceBytes }),
      pluginRoot: input.pluginRoot,
    });
    totalBytes += lstatSync(sourcePath).size;
    const maxTotalSourceBytes =
      input.maxTotalSourceBytes ?? DEFAULT_PLUGIN_SOURCE_TOTAL_MAX_BYTES;
    if (totalBytes > maxTotalSourceBytes) {
      throw new PluginEntrypointBuildError(
        `Plugin source graph exceeds the ${maxTotalSourceBytes} byte total source limit.`,
      );
    }
    const source = readFileSync(sourcePath, "utf8");
    if (/\brequire\s*\.\s*resolve\s*\(/u.test(source)) {
      throw importPolicyFailure({
        pluginRoot: input.pluginRoot,
        reason: "CommonJS require is not supported",
        sourcePath,
        specifier: "require.resolve",
      });
    }
    for (const importRecord of PLUGIN_TRANSPILER.scanImports(source)) {
      const nestedSourcePath = validateImportSpecifier({
        kind: importRecord.kind,
        pluginRoot: input.pluginRoot,
        sourcePath,
        specifier: importRecord.path,
      });
      if (nestedSourcePath) {
        pending.push(nestedSourcePath);
      }
    }
  }
}

function formatBuildLogs(logs: Bun.BuildOutput["logs"]) {
  return logs
    .map((log) => String(log))
    .join("\n")
    .trim();
}

export async function buildPluginEntrypoint(
  options: PluginEntrypointBuildOptions,
): Promise<PluginEntrypointBuildResult> {
  const pluginRoot = realpathSync.native(resolve(options.pluginRoot));
  const manifestPath = join(pluginRoot, METIDOS_PLUGIN_MANIFEST_FILE_NAME);
  if (!existsSync(manifestPath)) {
    throw new PluginEntrypointBuildError(
      `Plugin manifest ${METIDOS_PLUGIN_MANIFEST_FILE_NAME} was not found.`,
    );
  }
  const parsedManifest = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  if (parsedManifest.issues.length > 0 || !parsedManifest.manifest?.main) {
    throw new PluginEntrypointBuildError(
      `Plugin manifest must declare a valid main entry file.`,
    );
  }
  const entrypointFile = parsedManifest.manifest.main;
  const resolvedEntrypointPath = resolve(pluginRoot, entrypointFile);
  if (!existsSync(resolvedEntrypointPath)) {
    throw new PluginEntrypointBuildError(
      `Plugin entrypoint ${entrypointFile} was not found.`,
    );
  }
  const entrypointPath = realpathSync.native(resolvedEntrypointPath);
  if (!pathInsideOrEqual(pluginRoot, entrypointPath)) {
    throw new PluginEntrypointBuildError(
      "Plugin entrypoint must stay inside the plugin folder.",
    );
  }

  if (entrypointPath.endsWith(PYTHON_ENTRYPOINT_EXTENSION)) {
    scanPluginSourceLimits({ entrypointPath, pluginRoot });
    const pythonSource = readFileSync(entrypointPath, "utf8");
    return {
      entrypointPath,
      language: "python",
      outputCount: 1,
      pythonSource,
      source: pythonPluginEntrypointSource({
        callbackInvocationToken: "__metidos_runtime_callback_token__",
        entrypointPath: displayPath(pluginRoot, entrypointPath),
        pythonSource,
      }),
      sourceMap: null,
    };
  }

  scanPluginImportPolicy({ entrypointPath, pluginRoot });

  const buildConfig: PluginEntrypointBunBuildConfig = {
    allowUnresolved: [],
    define: {
      Bun: "undefined",
      fetch: "undefined",
      process: "undefined",
      require: "undefined",
      setTimeout: "undefined",
    },
    entrypoints: [entrypointPath],
    env: "disable",
    external: [METIDOS_PLUGIN_API_IMPORT],
    format: "esm",
    minify: true,
    packages: "bundle",
    plugins: [createMetidosPluginApiBuildPlugin()],
    sourcemap: "external",
    target: "browser",
    write: false,
  };
  const buildOutput = await Bun.build(buildConfig);
  if (!buildOutput.success) {
    const logs = formatBuildLogs(buildOutput.logs);
    throw new PluginEntrypointBuildError(
      logs
        ? `Plugin entrypoint build failed.\n${logs}`
        : "Plugin entrypoint build failed.",
    );
  }

  const output =
    buildOutput.outputs.find((item) => item.path.endsWith(".js")) ??
    buildOutput.outputs[0];
  if (!output) {
    throw new PluginEntrypointBuildError(
      "Plugin entrypoint build produced no output.",
    );
  }

  const source = await output.text();
  if (Buffer.byteLength(source) > DEFAULT_PLUGIN_BUILD_OUTPUT_MAX_BYTES) {
    throw new PluginEntrypointBuildError(
      `Plugin build output exceeds the ${DEFAULT_PLUGIN_BUILD_OUTPUT_MAX_BYTES} byte limit.`,
    );
  }
  const sourceMapOutput = buildOutput.outputs.find((item) =>
    item.path.endsWith(".js.map"),
  );
  return {
    entrypointPath,
    language: "javascript",
    outputCount: buildOutput.outputs.length,
    source,
    sourceMap: sourceMapOutput ? await sourceMapOutput.text() : null,
  };
}
