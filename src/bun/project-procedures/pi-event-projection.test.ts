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
import { encodePiWebSearchMarker } from "./pi-sdk-shapes";

const STARTED_AT = "2026-04-09T12:00:00.000Z";
const THREAD_ID = 17;

describe("createPiThreadEventProjector", () => {
  it("projects assistant thinking and text deltas into reasoning/chat activity writes", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "metidos-pi-projection-"));
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

  it("persists assistant-generated image attachments from final messages", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "metidos-pi-projection-"));
    const projector = createPiThreadEventProjector({
      startedAt: STARTED_AT,
      threadId: THREAD_ID,
      worktreePath,
    });

    try {
      const writes = projector.project({
        message: {
          content: [
            { text: "Generated image.", type: "text" },
            { data: "iVBORw0KGgo=", mimeType: "image/png", type: "image" },
          ],
          role: "assistant",
          timestamp: 104,
        },
        type: "message_end",
      } as AgentSessionEvent);

      expect(writes).toEqual([
        {
          activityId: `${STARTED_AT}:assistant:104`,
          force: true,
          inputs: [
            expect.objectContaining({
              itemId: `${STARTED_AT}:assistant:104`,
              kind: "chat",
              payloadJson: JSON.stringify({
                images: [
                  {
                    data: "iVBORw0KGgo=",
                    mimeType: "image/png",
                    type: "image",
                  },
                ],
              }),
              role: "assistant",
              state: "completed",
              text: "Generated image.",
              threadId: THREAD_ID,
            }),
          ],
          signature: "completed\u0000Generated image.\u0000images:1",
          terminal: true,
        },
      ]);
    } finally {
      rmSync(worktreePath, { force: true, recursive: true });
    }
  });

  it("persists image-only assistant final messages", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "metidos-pi-projection-"));
    const projector = createPiThreadEventProjector({
      startedAt: STARTED_AT,
      threadId: THREAD_ID,
      worktreePath,
    });

    try {
      const writes = projector.project({
        message: {
          content: [
            { data: "iVBORw0KGgo=", mimeType: "image/png", type: "image" },
          ],
          role: "assistant",
          timestamp: 105,
        },
        type: "message_end",
      } as unknown as AgentSessionEvent);

      expect(writes).toEqual([
        expect.objectContaining({
          activityId: `${STARTED_AT}:assistant:105`,
          inputs: [
            expect.objectContaining({
              payloadJson: JSON.stringify({
                images: [
                  {
                    data: "iVBORw0KGgo=",
                    mimeType: "image/png",
                    type: "image",
                  },
                ],
              }),
              role: "assistant",
              state: "completed",
              text: "",
              threadId: THREAD_ID,
            }),
          ],
          signature: "completed\u0000\u0000images:1",
          terminal: true,
        }),
      ]);
      expect(projector.snapshot()).toEqual({
        lastAssistantItemId: `${STARTED_AT}:assistant:105`,
        lastAssistantText: "",
        usage: null,
      });
    } finally {
      rmSync(worktreePath, { force: true, recursive: true });
    }
  });

  it("projects inline <think> tags from assistant text deltas into reasoning and chat writes", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "metidos-pi-projection-"));
    const projector = createPiThreadEventProjector({
      startedAt: STARTED_AT,
      threadId: THREAD_ID,
      worktreePath,
    });

    try {
      const ambiguousStartWrites = projector.project({
        assistantMessageEvent: {
          delta: "<thi",
          type: "text_delta",
        },
        message: {
          role: "assistant",
          timestamp: 102,
        },
        type: "message_update",
      } as AgentSessionEvent);
      const reasoningWrites = projector.project({
        assistantMessageEvent: {
          delta: "nk>Plan first.\n2. Do work</thi",
          type: "text_delta",
        },
        message: {
          role: "assistant",
          timestamp: 102,
        },
        type: "message_update",
      } as AgentSessionEvent);
      const chatWrites = projector.project({
        assistantMessageEvent: {
          delta: "nk>\nFinal answer.",
          type: "text_delta",
        },
        message: {
          role: "assistant",
          timestamp: 102,
        },
        type: "message_update",
      } as AgentSessionEvent);
      const completionWrites = projector.project({
        message: {
          content: [
            {
              text: "<think>Plan first.\n2. Do work</think>\nFinal answer.",
              type: "text",
            },
          ],
          role: "assistant",
          timestamp: 102,
        },
        type: "message_end",
      } as AgentSessionEvent);

      expect(ambiguousStartWrites).toEqual([]);
      expect(reasoningWrites).toEqual([
        {
          activityId: `${STARTED_AT}:reasoning:102`,
          inputs: [
            expect.objectContaining({
              itemId: `${STARTED_AT}:reasoning:102`,
              kind: "reasoning",
              state: "in_progress",
              text: "Plan first.\n2. Do work",
              threadId: THREAD_ID,
            }),
          ],
          signature: "in_progress\u0000Plan first.\n2. Do work",
        },
      ]);
      expect(chatWrites).toEqual([
        {
          activityId: `${STARTED_AT}:assistant:102`,
          inputs: [
            expect.objectContaining({
              itemId: `${STARTED_AT}:assistant:102`,
              kind: "chat",
              role: "assistant",
              state: "in_progress",
              text: "Final answer.",
              threadId: THREAD_ID,
            }),
          ],
          signature: "in_progress\u0000Final answer.",
        },
      ]);
      expect(completionWrites).toEqual([
        {
          activityId: `${STARTED_AT}:assistant:102`,
          force: true,
          inputs: [
            expect.objectContaining({
              itemId: `${STARTED_AT}:assistant:102`,
              kind: "chat",
              role: "assistant",
              state: "completed",
              text: "Final answer.",
              threadId: THREAD_ID,
            }),
          ],
          signature: "completed\u0000Final answer.",
          terminal: true,
        },
        {
          activityId: `${STARTED_AT}:reasoning:102`,
          force: true,
          inputs: [
            expect.objectContaining({
              itemId: `${STARTED_AT}:reasoning:102`,
              kind: "reasoning",
              state: "completed",
              text: "Plan first.\n2. Do work",
              threadId: THREAD_ID,
            }),
          ],
          signature: "completed\u0000Plan first.\n2. Do work",
          terminal: true,
        },
      ]);
      expect(projector.snapshot()).toEqual({
        lastAssistantItemId: `${STARTED_AT}:assistant:102`,
        lastAssistantText: "Final answer.",
        usage: null,
      });
    } finally {
      rmSync(worktreePath, { force: true, recursive: true });
    }
  });

  it("maps bash lifecycle events to command rows and non-file tools to generic tool-call rows", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "metidos-pi-projection-"));
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

  it("projects plugin markdown results into generic tool-call output rows", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "metidos-pi-projection-"));
    const projector = createPiThreadEventProjector({
      startedAt: STARTED_AT,
      threadId: THREAD_ID,
      worktreePath,
    });

    try {
      projector.project({
        args: {
          id: "19e21a3f3d201870",
        },
        toolCallId: "gmail-read-1",
        toolName: "gmail_gmail_read",
        type: "tool_execution_start",
      } as AgentSessionEvent);
      const writes = projector.project({
        isError: false,
        result: {
          details: {
            pluginId: "gmail",
            result: {
              markdown: "# Subject\n\nMessage body",
              type: "markdown",
            },
            resultKind: "markdown",
            runtimeId: "gmail_gmail_read",
            tool: "gmail_read",
          },
        },
        toolCallId: "gmail-read-1",
        toolName: "gmail_gmail_read",
        type: "tool_execution_end",
      } as AgentSessionEvent);

      expect(writes).toEqual([
        expect.objectContaining({
          activityId: `${STARTED_AT}:tool:gmail-read-1`,
          force: true,
          signature:
            "completed\u0000gmail_gmail_read\u0000# Subject\n\nMessage body",
          terminal: true,
        }),
      ]);
      expect(
        JSON.parse(String(writes[0]?.inputs[0]?.payloadJson ?? "null")),
      ).toEqual({
        argumentsText: '{\n  "id": "19e21a3f3d201870"\n}',
        output: "# Subject\n\nMessage body",
        server: "pi",
        tool: "gmail_gmail_read",
      });
    } finally {
      rmSync(worktreePath, { force: true, recursive: true });
    }
  });

  it("projects web_search tool lifecycle events into dedicated web-search rows", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "metidos-pi-projection-"));
    const projector = createPiThreadEventProjector({
      startedAt: STARTED_AT,
      threadId: THREAD_ID,
      worktreePath,
    });

    try {
      const searchStart = projector.project({
        args: {
          query: "bun docs",
        },
        toolCallId: "search-1",
        toolName: "web_search",
        type: "tool_execution_start",
      } as AgentSessionEvent);
      const searchEnd = projector.project({
        isError: false,
        result: {
          content: [
            {
              text: "1. Bun v1.3.12",
              type: "text",
            },
          ],
        },
        toolCallId: "search-1",
        toolName: "web_search",
        type: "tool_execution_end",
      } as AgentSessionEvent);

      expect(searchStart).toEqual([
        {
          activityId: `${STARTED_AT}:tool:search-1`,
          inputs: [
            expect.objectContaining({
              itemId: `${STARTED_AT}:tool:search-1`,
              kind: "web_search",
              state: "in_progress",
              text: "bun docs",
              threadId: THREAD_ID,
            }),
          ],
          signature: "in_progress\u0000bun docs",
        },
      ]);
      expect(searchEnd).toEqual([
        {
          activityId: `${STARTED_AT}:tool:search-1`,
          force: true,
          inputs: [
            expect.objectContaining({
              itemId: `${STARTED_AT}:tool:search-1`,
              kind: "web_search",
              state: "completed",
              text: "bun docs",
              threadId: THREAD_ID,
            }),
          ],
          signature: "completed\u0000bun docs",
          terminal: true,
        },
      ]);
    } finally {
      rmSync(worktreePath, { force: true, recursive: true });
    }
  });

  it("projects native web-search transcript markers without leaking them into assistant text", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "metidos-pi-projection-"));
    const projector = createPiThreadEventProjector({
      startedAt: STARTED_AT,
      threadId: THREAD_ID,
      worktreePath,
    });

    try {
      const writes = projector.project({
        assistantMessageEvent: {
          delta: `${encodePiWebSearchMarker({
            id: "ws_1",
            query: "bun docs",
            state: "in_progress",
          })}${encodePiWebSearchMarker({
            id: "ws_1",
            query: "bun docs",
            state: "completed",
          })}Answer after search.`,
          type: "text_delta",
        },
        message: {
          role: "assistant",
          timestamp: 202,
        },
        type: "message_update",
      } as AgentSessionEvent);

      expect(writes).toEqual([
        {
          activityId: `${STARTED_AT}:web_search:ws_1`,
          inputs: [
            expect.objectContaining({
              itemId: `${STARTED_AT}:web_search:ws_1`,
              kind: "web_search",
              state: "in_progress",
              text: "bun docs",
              threadId: THREAD_ID,
            }),
          ],
          signature: "in_progress\u0000bun docs",
        },
        {
          activityId: `${STARTED_AT}:web_search:ws_1`,
          force: true,
          inputs: [
            expect.objectContaining({
              itemId: `${STARTED_AT}:web_search:ws_1`,
              kind: "web_search",
              state: "completed",
              text: "bun docs",
              threadId: THREAD_ID,
            }),
          ],
          signature: "completed\u0000bun docs",
          terminal: true,
        },
        {
          activityId: `${STARTED_AT}:assistant:202`,
          inputs: [
            expect.objectContaining({
              itemId: `${STARTED_AT}:assistant:202`,
              kind: "chat",
              state: "in_progress",
              text: "Answer after search.",
              threadId: THREAD_ID,
            }),
          ],
          signature: "in_progress\u0000Answer after search.",
        },
      ]);
    } finally {
      rmSync(worktreePath, { force: true, recursive: true });
    }
  });

  it("does not persist split native web-search markers as chat rows", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "metidos-pi-projection-"));
    const projector = createPiThreadEventProjector({
      startedAt: STARTED_AT,
      threadId: THREAD_ID,
      worktreePath,
    });
    const marker = encodePiWebSearchMarker({
      id: "ws_1",
      query: "bun docs",
      state: "completed",
    });

    try {
      const writesBeforeSuffix = projector.project({
        assistantMessageEvent: {
          delta: marker.slice(0, -1),
          type: "text_delta",
        },
        message: {
          role: "assistant",
          timestamp: 203,
        },
        type: "message_update",
      } as AgentSessionEvent);
      const writesAfterSuffix = projector.project({
        assistantMessageEvent: {
          delta: marker.slice(-1),
          type: "text_delta",
        },
        message: {
          role: "assistant",
          timestamp: 203,
        },
        type: "message_update",
      } as AgentSessionEvent);

      expect(writesBeforeSuffix).toEqual([
        {
          activityId: `${STARTED_AT}:web_search:ws_1`,
          force: true,
          inputs: [
            expect.objectContaining({
              itemId: `${STARTED_AT}:web_search:ws_1`,
              kind: "web_search",
              state: "completed",
              text: "bun docs",
              threadId: THREAD_ID,
            }),
          ],
          signature: "completed\u0000bun docs",
          terminal: true,
        },
      ]);
      expect(writesAfterSuffix).toEqual([]);
    } finally {
      rmSync(worktreePath, { force: true, recursive: true });
    }
  });

  it("projects Pi edit completions into both tool-call and file-change rows", () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "metidos-pi-projection-"));
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
    const worktreePath = mkdtempSync(join(tmpdir(), "metidos-pi-projection-"));
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
