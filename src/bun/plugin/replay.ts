/**
 * @file src/bun/plugin/replay.ts
 * @description Deterministic replay harness for repository-safe Plugin System v1 fixtures.
 */

import { readFileSync } from "node:fs";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

type JsonRecord = Record<string, unknown>;

export type PluginReplayHostCall = {
  operation: string;
  params?: JsonRecord;
  result?: unknown;
  error?: string;
};

export type PluginReplayToolEvent = {
  kind: "tool.execute";
  tool: string;
  context?: JsonRecord;
  props?: JsonRecord;
  hostCalls?: PluginReplayHostCall[];
  expect: { result: unknown } | { markdownJson: unknown } | { error: string };
};

export type PluginReplayFixture = {
  schema: "metidos.plugin-replay/v1";
  pluginRoot: string;
  description?: string;
  expectedTools?: string[];
  events: PluginReplayToolEvent[];
};

export type PluginReplayDiff = {
  path: string;
  expected: unknown;
  actual: unknown;
};

export type PluginReplayResult = {
  diffs: PluginReplayDiff[];
  hostCalls: Array<{ operation: string; params: JsonRecord }>;
};

type ToolRegistration = {
  actionHandle: string;
  tool: string;
  validatePropsHandle?: string;
};

type RuntimeSetup = {
  tools: ToolRegistration[];
};

export function readPluginReplayFixture(path: string): PluginReplayFixture {
  return JSON.parse(readFileSync(path, "utf8")) as PluginReplayFixture;
}

export function redactReplayValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactReplayValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: JsonRecord = {};
  for (const [key, entry] of Object.entries(value as JsonRecord).sort()) {
    if (/authorization|api[_-]?key|password|secret|token/iu.test(key)) {
      output[key] = "[REDACTED]";
    } else {
      output[key] = redactReplayValue(entry);
    }
  }
  return output;
}

export function normalizeReplayValue(value: unknown): unknown {
  return redactReplayValue(value);
}

export async function replayPluginFixture(
  fixture: PluginReplayFixture,
): Promise<PluginReplayResult> {
  if (fixture.schema !== "metidos.plugin-replay/v1") {
    throw new Error(`Unsupported plugin replay schema ${fixture.schema}.`);
  }
  const diffs: PluginReplayDiff[] = [];
  const observedHostCalls: Array<{ operation: string; params: JsonRecord }> =
    [];
  const pendingHostCalls: PluginReplayHostCall[] = [];

  const manifestPath = `${fixture.pluginRoot}/metidos-plugin.json`;
  const manifestResult = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  if (manifestResult.issues.length > 0 || !manifestResult.manifest) {
    throw new Error(
      `Plugin replay fixture manifest is invalid: ${JSON.stringify(
        manifestResult.issues,
      )}`,
    );
  }

  const build = await buildPluginEntrypoint({ pluginRoot: fixture.pluginRoot });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      fs: async (operation, request) => {
        const params = paramsFromRequest(request);
        observedHostCalls.push({ operation, params });
        const expected = pendingHostCalls.shift();
        if (!expected) {
          throw new Error(`Unexpected host call ${operation}.`);
        }
        compareValue(
          diffs,
          `hostCalls.${observedHostCalls.length - 1}.operation`,
          expected.operation,
          operation,
        );
        compareValue(
          diffs,
          `hostCalls.${observedHostCalls.length - 1}.params`,
          expected.params ?? {},
          params,
        );
        if (expected.error) {
          throw new Error(expected.error);
        }
        return expected.result;
      },
      permissions: ["files:read", "log:write", "network:fetch"],
    },
    startupTimeoutMs: 1000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    validatePluginStartupRegistrations(setup, {
      manifest: manifestResult.manifest,
      pluginId: manifestResult.manifest.id,
    } as unknown as RpcPluginInventoryPlugin);
    if (fixture.expectedTools) {
      compareValue(
        diffs,
        "expectedTools",
        fixture.expectedTools,
        setup.tools.map((tool) => tool.tool),
      );
    }

    for (const [eventIndex, event] of fixture.events.entries()) {
      pendingHostCalls.splice(
        0,
        pendingHostCalls.length,
        ...(event.hostCalls ?? []),
      );
      const tool = setup.tools.find(
        (candidate) => candidate.tool === event.tool,
      );
      if (!tool) {
        diffs.push({
          actual: null,
          expected: event.tool,
          path: `events.${eventIndex}.tool`,
        });
        continue;
      }
      try {
        const props = tool.validatePropsHandle
          ? await runtime.invokeCallback({
              args: [event.props ?? {}],
              deadlineMs: Date.now() + 5000,
              handle: tool.validatePropsHandle,
              label: `${event.tool}.validateProps`,
            })
          : (event.props ?? {});
        const result = await runtime.invokeCallback({
          args: [event.context ?? { contextKind: "threadTool" }, props],
          deadlineMs: Date.now() + 5000,
          handle: tool.actionHandle,
          label: event.tool,
        });
        compareExpectation(
          diffs,
          `events.${eventIndex}.expect`,
          event.expect,
          result,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if ("error" in event.expect) {
          compareValue(
            diffs,
            `events.${eventIndex}.expect.error`,
            event.expect.error,
            message,
          );
        } else {
          diffs.push({
            actual: message,
            expected: event.expect,
            path: `events.${eventIndex}.expect`,
          });
        }
      }
      if (pendingHostCalls.length > 0) {
        diffs.push({
          actual: [],
          expected: pendingHostCalls,
          path: `events.${eventIndex}.hostCalls.unused`,
        });
      }
    }
  } finally {
    runtime.dispose();
  }

  return { diffs, hostCalls: observedHostCalls };
}

function paramsFromRequest(request: unknown): JsonRecord {
  if (request && typeof request === "object" && "params" in request) {
    const params = (request as { params?: unknown }).params;
    return params && typeof params === "object" && !Array.isArray(params)
      ? (params as JsonRecord)
      : {};
  }
  return {};
}

function compareExpectation(
  diffs: PluginReplayDiff[],
  path: string,
  expected: PluginReplayToolEvent["expect"],
  actual: unknown,
): void {
  if ("result" in expected) {
    compareValue(diffs, `${path}.result`, expected.result, actual);
    return;
  }
  if ("markdownJson" in expected) {
    compareValue(
      diffs,
      `${path}.markdownJson`,
      expected.markdownJson,
      markdownJson(actual),
    );
  }
}

function markdownJson(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  const markdown = (value as { markdown?: unknown }).markdown;
  if (typeof markdown !== "string") {
    return value;
  }
  const match = markdown.match(/```json\n([\s\S]+)\n```/u);
  return match?.[1] ? JSON.parse(match[1]) : value;
}

function compareValue(
  diffs: PluginReplayDiff[],
  path: string,
  expected: unknown,
  actual: unknown,
): void {
  const normalizedExpected = normalizeReplayValue(expected);
  const normalizedActual = normalizeReplayValue(actual);
  if (stableJson(normalizedExpected) !== stableJson(normalizedActual)) {
    diffs.push({
      path,
      expected: normalizedExpected,
      actual: normalizedActual,
    });
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]),
  );
}
