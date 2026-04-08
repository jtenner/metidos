/**
 * @file src/bun/project-procedures/codex-session-telemetry.test.ts
 * @description Test file for Codex session telemetry parsing.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RpcThread } from "../rpc-schema";
import {
  applyCodexSessionUsageTelemetry,
  clearCodexSessionTelemetryCache,
  parseCodexSessionUsageTelemetry,
} from "./codex-session-telemetry";

const tempDirectories = new Set<string>();
const originalCodexHome = process.env.CODEX_HOME;

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

function threadFixture(): RpcThread {
  return {
    id: 9,
    projectId: 3,
    worktreePath: "/repo",
    title: "Thread",
    summary: null,
    model: "gpt-5.4",
    reasoningEffort: "medium",
    githubAccess: false,
    agentsAccess: false,
    joltAccess: true,
    unsafeMode: false,
    codexThreadId: "019d5060-50d3-7722-a2b8-5d11311102e0",
    pinnedAt: null,
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z",
    lastRunAt: null,
    usage: {
      inputTokens: 11_000,
      cachedInputTokens: 5_000,
      outputTokens: 400,
    },
    compaction: {
      estimatedTriggerTokens: 320_000,
      estimatedTriggerSource: "heuristic",
      maxObservedInputTokens: null,
      inferredCount: 0,
      lastInferredAt: null,
      lastInferredBeforeInputTokens: null,
      lastInferredAfterInputTokens: null,
    },
    runStatus: {
      state: "idle",
      startedAt: null,
      updatedAt: null,
      error: null,
      hasUnreadError: false,
    },
  };
}

afterEach(() => {
  clearCodexSessionTelemetryCache();

  if (typeof originalCodexHome === "string") {
    process.env.CODEX_HOME = originalCodexHome;
  } else {
    delete process.env.CODEX_HOME;
  }

  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("parseCodexSessionUsageTelemetry", () => {
  it("returns the latest token_count usage and context window", () => {
    const telemetry = parseCodexSessionUsageTelemetry(`
{"timestamp":"2026-04-08T18:00:00.000Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1","model_context_window":121600}}
{"timestamp":"2026-04-08T18:00:01.000Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":17831,"cached_input_tokens":9856,"output_tokens":381},"model_context_window":121600}}}
{"timestamp":"2026-04-08T18:00:02.000Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":20361,"cached_input_tokens":19584,"output_tokens":341},"model_context_window":121600}}}
    `);

    expect(telemetry).toEqual({
      contextWindowTokens: 121_600,
      usage: {
        inputTokens: 20_361,
        cachedInputTokens: 19_584,
        outputTokens: 341,
        contextWindowTokens: 121_600,
      },
    });
  });

  it("keeps the real window size even before token_count carries info", () => {
    const telemetry = parseCodexSessionUsageTelemetry(`
{"timestamp":"2026-04-08T18:00:00.000Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1","model_context_window":258400}}
{"timestamp":"2026-04-08T18:00:01.000Z","type":"event_msg","payload":{"type":"token_count","info":null}}
    `);

    expect(telemetry).toEqual({
      contextWindowTokens: 258_400,
      usage: null,
    });
  });
});

describe("applyCodexSessionUsageTelemetry", () => {
  it("overrides persisted usage with live session telemetry", () => {
    const codexHome = createTempDirectory("jolt-codex-home-");
    process.env.CODEX_HOME = codexHome;

    const sessionsDirectory = join(codexHome, "sessions", "2026", "04", "08");
    const sessionFilePath = join(
      sessionsDirectory,
      "rollout-2026-04-08T18-00-00-019d5060-50d3-7722-a2b8-5d11311102e0.jsonl",
    );
    mkdirSync(sessionsDirectory, {
      recursive: true,
    });
    writeFileSync(
      sessionFilePath,
      `{"timestamp":"2026-04-08T18:00:00.000Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1","model_context_window":121600}}
{"timestamp":"2026-04-08T18:00:01.000Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":20361,"cached_input_tokens":19584,"output_tokens":341},"model_context_window":121600}}}
`,
    );

    const hydratedThread = applyCodexSessionUsageTelemetry(threadFixture());

    expect(hydratedThread.usage).toEqual({
      inputTokens: 20_361,
      cachedInputTokens: 19_584,
      outputTokens: 341,
      contextWindowTokens: 121_600,
    });
  });

  it("applies only the real window size when persisted usage exists but live usage has not landed", () => {
    const codexHome = createTempDirectory("jolt-codex-home-");
    process.env.CODEX_HOME = codexHome;

    const sessionsDirectory = join(codexHome, "sessions", "2026", "04", "08");
    const sessionFilePath = join(
      sessionsDirectory,
      "rollout-2026-04-08T18-00-00-019d5060-50d3-7722-a2b8-5d11311102e0.jsonl",
    );
    mkdirSync(sessionsDirectory, {
      recursive: true,
    });
    writeFileSync(
      sessionFilePath,
      `{"timestamp":"2026-04-08T18:00:00.000Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1","model_context_window":121600}}
`,
    );

    const hydratedThread = applyCodexSessionUsageTelemetry(threadFixture());

    expect(hydratedThread.usage).toEqual({
      inputTokens: 11_000,
      cachedInputTokens: 5_000,
      outputTokens: 400,
      contextWindowTokens: 121_600,
    });
  });
});
