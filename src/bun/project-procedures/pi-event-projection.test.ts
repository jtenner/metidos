/**
 * @file src/bun/project-procedures/pi-event-projection.test.ts
 * @description Test file for Pi event projection helpers.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

import { createPiThreadEventProjector } from "./pi-event-projection";

const STARTED_AT = "2026-04-09T12:00:00.000Z";
const THREAD_ID = 17;

describe("createPiThreadEventProjector", () => {
  it("projects assistant thinking and text deltas into reasoning/chat activity writes", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "jolt-pi-projection-"));
    const projector = createPiThreadEventProjector({
      startedAt: STARTED_AT,
      threadId: THREAD_ID,
      worktreePath,
    });

    try {
      const thinkingWrites = projector.project({
        assistantMessageEvent: {
          delta: "Plan first. ",
          type: "thinking_delta",
        },
        message: {
          role: "assistant",
          timestamp: 101,
        },
        type: "message_update",
      } as AgentSessionEvent);
      const textWrites = projector.project({
        assistantMessageEvent: {
          delta: "Answer draft. ",
          type: "text_delta",
        },
        message: {
          role: "assistant",
          timestamp: 101,
        },
        type: "message_update",
      } as AgentSessionEvent);
      const completionWrites = projector.project({
        message: {
          content: [{ text: "Answer complete.", type: "text" }],
          role: "assistant",
          timestamp: 101,
          usage: {
            cacheRead: 9,
            input: 11,
            output: 7,
          },
        },
        type: "message_end",
      } as AgentSessionEvent);

      expect(thinkingWrites).toEqual([
        {
          activityId: `${STARTED_AT}:reasoning:101`,
          inputs: [
            expect.objectContaining({
              itemId: `${STARTED_AT}:reasoning:101`,
              kind: "reasoning",
              state: "in_progress",
              text: "Plan first.",
              threadId: THREAD_ID,
            }),
          ],
          signature: "in_progress\u0000Plan first.",
        },
      ]);
      expect(textWrites).toEqual([
        {
          activityId: `${STARTED_AT}:assistant:101`,
          inputs: [
            expect.objectContaining({
              itemId: `${STARTED_AT}:assistant:101`,
              kind: "chat",
              role: "assistant",
              state: "in_progress",
              text: "Answer draft.",
              threadId: THREAD_ID,
            }),
          ],
          signature: "in_progress\u0000Answer draft.",
        },
      ]);
      expect(completionWrites).toEqual([
        {
          activityId: `${STARTED_AT}:assistant:101`,
          force: true,
          inputs: [
            expect.objectContaining({
              itemId: `${STARTED_AT}:assistant:101`,
              kind: "chat",
              role: "assistant",
              state: "completed",
              text: "Answer complete.",
              threadId: THREAD_ID,
            }),
          ],
          signature: "completed\u0000Answer complete.",
          terminal: true,
        },
        {
          activityId: `${STARTED_AT}:reasoning:101`,
          force: true,
          inputs: [
            expect.objectContaining({
              itemId: `${STARTED_AT}:reasoning:101`,
              kind: "reasoning",
              state: "completed",
              text: "Plan first.",
              threadId: THREAD_ID,
            }),
          ],
          signature: "completed\u0000Plan first.",
          terminal: true,
        },
      ]);
      expect(projector.snapshot()).toEqual({
        lastAssistantItemId: `${STARTED_AT}:assistant:101`,
        lastAssistantText: "Answer complete.",
        usage: {
          cachedInputTokens: 9,
          inputTokens: 11,
          outputTokens: 7,
        },
      });
    } finally {
      rmSync(worktreePath, { force: true, recursive: true });
    }
  });

  it("maps bash lifecycle events to command rows and non-file tools to generic tool-call rows", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "jolt-pi-projection-"));
    const projector = createPiThreadEventProjector({
      startedAt: STARTED_AT,
      threadId: THREAD_ID,
      worktreePath,
    });

    try {
      const bashStart = projector.project({
        args: {
          command: 'bash -lc "printf \\"hi\\""',
        },
        toolCallId: "bash-1",
        toolName: "bash",
        type: "tool_execution_start",
      } as AgentSessionEvent);
      const bashEnd = projector.project({
        isError: true,
        result: {
          content: [
            {
              text: "stderr line\nCommand exited with code 2",
              type: "text",
            },
          ],
        },
        toolCallId: "bash-1",
        toolName: "bash",
        type: "tool_execution_end",
      } as AgentSessionEvent);
      const readUpdate = projector.project({
        args: {
          path: "README.md",
        },
        partialResult: {
          content: [
            {
              text: "Read README.md",
              type: "text",
            },
          ],
        },
        toolCallId: "read-1",
        toolName: "read",
        type: "tool_execution_update",
      } as AgentSessionEvent);
      const readEnd = projector.project({
        isError: false,
        result: {
          content: [
            {
              text: "Read complete",
              type: "text",
            },
          ],
        },
        toolCallId: "read-1",
        toolName: "read",
        type: "tool_execution_end",
      } as AgentSessionEvent);

      expect(bashStart[0]?.activityId).toBe(`${STARTED_AT}:tool:bash-1`);
      expect(bashStart[0]?.signature).toBe('in_progress\u0000printf "hi"');
      expect(
        JSON.parse(String(bashStart[0]?.inputs[0]?.payloadJson ?? "null")),
      ).toEqual({
        command: 'printf "hi"',
        exitCode: null,
        output: "",
      });

      expect(bashEnd[0]).toEqual(
        expect.objectContaining({
          activityId: `${STARTED_AT}:tool:bash-1`,
          force: true,
          signature:
            'failed\u0000printf "hi"\u0000stderr line\nCommand exited with code 2',
          terminal: true,
        }),
      );
      expect(
        JSON.parse(String(bashEnd[0]?.inputs[0]?.payloadJson ?? "null")),
      ).toEqual({
        command: 'printf "hi"',
        exitCode: 2,
        output: "stderr line\nCommand exited with code 2",
      });

      expect(readUpdate[0]).toEqual(
        expect.objectContaining({
          activityId: `${STARTED_AT}:tool:read-1`,
          signature: "in_progress\u0000read\u0000Read README.md",
        }),
      );
      expect(
        JSON.parse(String(readUpdate[0]?.inputs[0]?.payloadJson ?? "null")),
      ).toEqual({
        argumentsText: '{\n  "path": "README.md"\n}',
        output: "Read README.md",
        server: "pi",
        tool: "read",
      });

      expect(readEnd).toEqual([
        expect.objectContaining({
          activityId: `${STARTED_AT}:tool:read-1`,
          force: true,
          signature: "completed\u0000read\u0000Read complete",
          terminal: true,
        }),
      ]);
      expect(
        JSON.parse(String(readEnd[0]?.inputs[0]?.payloadJson ?? "null")),
      ).toEqual({
        argumentsText: '{\n  "path": "README.md"\n}',
        output: "Read complete",
        server: "pi",
        tool: "read",
      });
    } finally {
      rmSync(worktreePath, { force: true, recursive: true });
    }
  });

  it("projects Pi edit completions into both tool-call and file-change rows", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "jolt-pi-projection-"));
    writeFileSync(join(worktreePath, "README.md"), "before\n");

    const projector = createPiThreadEventProjector({
      startedAt: STARTED_AT,
      threadId: THREAD_ID,
      worktreePath,
    });

    try {
      projector.project({
        args: {
          edits: [{ newText: "after\n", oldText: "before\n" }],
          path: "README.md",
        },
        toolCallId: "edit-1",
        toolName: "edit",
        type: "tool_execution_start",
      } as AgentSessionEvent);

      const writes = projector.project({
        isError: false,
        result: {
          content: [
            {
              text: "Successfully replaced 1 block(s) in README.md.",
              type: "text",
            },
          ],
          details: {
            diff: "--- a/README.md\n+++ b/README.md\n@@ -1,1 +1,1 @@\n-before\n+after",
          },
        },
        toolCallId: "edit-1",
        toolName: "edit",
        type: "tool_execution_end",
      } as AgentSessionEvent);

      expect(writes).toHaveLength(2);
      expect(writes[0]).toEqual(
        expect.objectContaining({
          activityId: `${STARTED_AT}:tool:edit-1`,
          force: true,
          signature:
            "completed\u0000edit\u0000Successfully replaced 1 block(s) in README.md.",
          terminal: true,
        }),
      );
      expect(
        JSON.parse(String(writes[1]?.inputs[0]?.payloadJson ?? "null")),
      ).toEqual({
        changeKind: "update",
        diffText:
          "--- a/README.md\n+++ b/README.md\n@@ -1,1 +1,1 @@\n-before\n+after",
        path: "README.md",
      });
    } finally {
      rmSync(worktreePath, { force: true, recursive: true });
    }
  });

  it("synthesizes write diffs from the pre-write file contents", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "jolt-pi-projection-"));
    writeFileSync(join(worktreePath, "README.md"), "before\n");

    const projector = createPiThreadEventProjector({
      startedAt: STARTED_AT,
      threadId: THREAD_ID,
      worktreePath,
    });

    try {
      projector.project({
        args: {
          content: "after\n",
          path: "README.md",
        },
        toolCallId: "write-1",
        toolName: "write",
        type: "tool_execution_start",
      } as AgentSessionEvent);

      writeFileSync(join(worktreePath, "README.md"), "after\n");

      const writes = projector.project({
        isError: false,
        result: {
          content: [
            {
              text: "Successfully wrote 6 bytes to README.md",
              type: "text",
            },
          ],
        },
        toolCallId: "write-1",
        toolName: "write",
        type: "tool_execution_end",
      } as AgentSessionEvent);

      expect(writes).toHaveLength(2);
      expect(writes[0]).toEqual(
        expect.objectContaining({
          activityId: `${STARTED_AT}:tool:write-1`,
          force: true,
          signature:
            "completed\u0000write\u0000Successfully wrote 6 bytes to README.md",
          terminal: true,
        }),
      );
      expect(
        JSON.parse(String(writes[0]?.inputs[0]?.payloadJson ?? "null")),
      ).toEqual({
        argumentsText: '{\n  "content": "after\\n",\n  "path": "README.md"\n}',
        output: "Successfully wrote 6 bytes to README.md",
        server: "pi",
        tool: "write",
      });

      expect(writes[1]).toEqual(
        expect.objectContaining({
          activityId: `${STARTED_AT}:file:write-1:README.md`,
          force: true,
          signature:
            "completed\u0000update\u0000README.md\u0000--- a/README.md\n+++ b/README.md\n@@ -1,1 +1,1 @@\n-before\n+after",
          terminal: true,
        }),
      );
      expect(
        JSON.parse(String(writes[1]?.inputs[0]?.payloadJson ?? "null")),
      ).toEqual({
        changeKind: "update",
        diffText:
          "--- a/README.md\n+++ b/README.md\n@@ -1,1 +1,1 @@\n-before\n+after",
        path: "README.md",
      });
    } finally {
      rmSync(worktreePath, { force: true, recursive: true });
    }
  });
});
