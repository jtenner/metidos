import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildPiThreadSessionDirectoryPath,
  createPiThreadRuntime,
  PI_THREAD_RUNTIME_TEST_PROVIDER_ENV,
  PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE,
} from "./pi-thread-runtime";

const originalPiRuntimeTestProvider =
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV];

function collectAssistantText(
  runtime: Awaited<ReturnType<typeof createPiThreadRuntime>>,
) {
  let text = "";
  const unsubscribe = runtime.session.subscribe((event) => {
    if (
      event.type !== "message_update" ||
      event.assistantMessageEvent.type !== "text_delta"
    ) {
      return;
    }
    text += event.assistantMessageEvent.delta ?? "";
  });
  return {
    getText: () => text,
    unsubscribe,
  };
}

afterEach(() => {
  if (typeof originalPiRuntimeTestProvider === "string") {
    process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
      originalPiRuntimeTestProvider;
  } else {
    delete process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV];
  }
});

test("creates deterministic Pi sessions and resumes them for the same thread", async () => {
  const appDataDir = mkdtempSync(join(tmpdir(), "jolt-pi-thread-runtime-app-"));
  const workspaceDir = mkdtempSync(
    join(tmpdir(), "jolt-pi-thread-runtime-ws-"),
  );
  process.env[PI_THREAD_RUNTIME_TEST_PROVIDER_ENV] =
    PI_THREAD_RUNTIME_TEST_PROVIDER_OPENAI_PROBE;

  try {
    const safeRuntime = await createPiThreadRuntime(
      {
        id: 17,
        model: "gpt-5.4",
        reasoningEffort: "medium",
        unsafeMode: 0,
        worktreePath: workspaceDir,
      },
      {
        appDataDir,
      },
    );

    expect(safeRuntime.sessionDirectory).toBe(
      buildPiThreadSessionDirectoryPath(17, appDataDir),
    );
    expect(safeRuntime.session.getActiveToolNames()).toEqual([
      "read",
      "ls",
      "find",
      "grep",
      "edit",
      "write",
    ]);

    const streamed = collectAssistantText(safeRuntime);
    await safeRuntime.session.prompt("resume-safe-runtime");
    streamed.unsubscribe();

    expect(streamed.getText()).toContain("pi-runtime-probe");
    expect(streamed.getText()).toContain("resume-safe-runtime");

    const initialSessionId = safeRuntime.session.sessionId;
    const initialSessionFile = safeRuntime.session.sessionFile;
    safeRuntime.session.dispose();

    const resumedRuntime = await createPiThreadRuntime(
      {
        id: 17,
        model: "gpt-5.4",
        reasoningEffort: "medium",
        unsafeMode: 0,
        worktreePath: workspaceDir,
      },
      {
        appDataDir,
      },
    );

    expect(resumedRuntime.session.sessionId).toBe(initialSessionId);
    expect(resumedRuntime.session.sessionFile).toBe(initialSessionFile);
    resumedRuntime.session.dispose();

    const unsafeRuntime = await createPiThreadRuntime(
      {
        id: 18,
        model: "gpt-5.4",
        reasoningEffort: "medium",
        unsafeMode: 1,
        worktreePath: workspaceDir,
      },
      {
        appDataDir,
      },
    );

    expect(unsafeRuntime.session.getActiveToolNames()).toEqual([
      "read",
      "bash",
      "ls",
      "find",
      "grep",
      "edit",
      "write",
    ]);
    unsafeRuntime.session.dispose();
  } finally {
    rmSync(appDataDir, {
      force: true,
      recursive: true,
    });
    rmSync(workspaceDir, {
      force: true,
      recursive: true,
    });
  }
});
