/**
 * @file src/bun/plugin/plugin-runtime.ts
 * @description Plugin System v1 runtime adapter startup helpers.
 */

import type { PluginEntrypointBuildResult } from "./entrypoint-build";
import type {
  PluginRuntimeAdapter,
  PluginRuntimeInstance,
  PluginRuntimeOptions,
} from "./plugin-runtime-contract";
import { startPluginPythonRuntime } from "./python-runtime";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";

export type { PluginRuntimeInstance, PluginRuntimeOptions };

export class PluginRuntimeError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : options);
    this.name = "PluginRuntimeError";
  }
}

const PLUGIN_RUNTIME_ADAPTERS = [
  {
    language: "javascript",
    start: startPluginQuickJsRuntime,
  },
  {
    language: "python",
    start: startPluginPythonRuntime,
  },
] satisfies readonly PluginRuntimeAdapter[];

export function getPluginRuntimeAdapter(
  buildResult: PluginEntrypointBuildResult,
): PluginRuntimeAdapter {
  const adapter = PLUGIN_RUNTIME_ADAPTERS.find(
    (candidate) => candidate.language === buildResult.language,
  );
  if (!adapter) {
    throw new PluginRuntimeError(
      `Unsupported plugin entrypoint language: ${String(buildResult.language)}`,
    );
  }
  return adapter;
}

export async function startPluginRuntime(
  buildResult: PluginEntrypointBuildResult,
  options: PluginRuntimeOptions = {},
): Promise<PluginRuntimeInstance> {
  return await getPluginRuntimeAdapter(buildResult).start(buildResult, options);
}
