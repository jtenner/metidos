/**
 * @file src/bun/project-procedures.no-response.test.ts
 * @description Regression tests for empty final assistant response handling.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAppDatabase, resetResolvedAppDataDirectory } from "./db";

let assistantResponseTextOrToolUseFallback: typeof import("./project-procedures").assistantResponseTextOrToolUseFallback;
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
let appDataDir: string | null = null;

beforeAll(async () => {
  appDataDir = mkdtempSync(join(tmpdir(), "metidos-no-response-test-"));
  process.env.METIDOS_APP_DATA_DIR = appDataDir;
  resetResolvedAppDataDirectory();
  ({ assistantResponseTextOrToolUseFallback } = await import(
    `./project-procedures?no-response=${Date.now()}`
  ));
});

afterAll(() => {
  closeAppDatabase();
  if (originalAppDataDir === undefined) {
    delete process.env.METIDOS_APP_DATA_DIR;
  } else {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  }
  resetResolvedAppDataDirectory();
  if (appDataDir) {
    rmSync(appDataDir, { force: true, recursive: true });
  }
});

describe("assistantResponseTextOrToolUseFallback", () => {
  it("uses a friendly completion message when the final assistant message only used tools", () => {
    expect(
      assistantResponseTextOrToolUseFallback(
        "",
        {
          content: [
            {
              id: "call_1",
              name: "read",
              type: "toolCall",
            },
          ],
          role: "assistant",
          stopReason: "toolUse",
        },
        "gpt-5.1-codex",
      ),
    ).toBe("Finished with no response.");
  });

  it("accepts image-only assistant responses", () => {
    expect(
      assistantResponseTextOrToolUseFallback(
        "",
        {
          content: [
            {
              data: ONE_PIXEL_PNG,
              mimeType: "image/png",
              type: "image",
            },
          ],
          role: "assistant",
          stopReason: "stop",
        },
        "openai/gpt-image-1",
      ),
    ).toBe("Generated image.");
  });

  it("still rejects empty assistant responses without a final tool call or image", () => {
    expect(() =>
      assistantResponseTextOrToolUseFallback(
        "",
        {
          content: [],
          role: "assistant",
          stopReason: "stop",
        },
        "gpt-5.1-codex",
      ),
    ).toThrow("Thread run completed without returning an assistant response.");
  });

  it("explains Ollama thinking-only completions", () => {
    expect(() =>
      assistantResponseTextOrToolUseFallback(
        "",
        {
          content: [],
          role: "assistant",
          stopReason: "stop",
        },
        "ollama:titus-cybersecurity-tools:latest",
      ),
    ).toThrow(
      "The Ollama model may have emitted only thinking output without a final answer",
    );
  });
});
