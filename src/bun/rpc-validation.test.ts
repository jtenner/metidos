import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirectories = new Set<string>();

function useIsolatedAppDataDir(): void {
  const appDataDir = mkdtempSync(join(tmpdir(), "metidos-rpc-validation-"));
  tempDirectories.add(appDataDir);
  process.env.METIDOS_APP_DATA_DIR = appDataDir;
}

afterEach(() => {
  delete process.env.METIDOS_APP_DATA_DIR;
  for (const path of tempDirectories) {
    rmSync(path, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("RPC request validation", () => {
  test("normalizes request ids before logging", async () => {
    useIsolatedAppDataDir();
    const { normalizeRequestIdHeader } = await import("./index");

    expect(normalizeRequestIdHeader(" request-123_ABC.4 ")).toBe(
      "request-123_ABC.4",
    );
    expect(normalizeRequestIdHeader("bad\nrequest")).toBeNull();
    expect(normalizeRequestIdHeader("x".repeat(129))).toBeNull();
  });

  test("rejects unknown RPC methods without echoing method text", async () => {
    useIsolatedAppDataDir();
    const { validateRpcRequestParams } = await import("./index");

    const arbitraryMethod = "attacker.controlled.method";
    expect(() =>
      validateRpcRequestParams(arbitraryMethod as never, {}),
    ).toThrow("Invalid RPC method.");
    try {
      validateRpcRequestParams(arbitraryMethod as never, {});
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(arbitraryMethod);
    }
  });

  test("accepts the openProject websocket RPC schema", async () => {
    useIsolatedAppDataDir();
    const { validateRpcRequestParams } = await import("./index");

    expect(
      validateRpcRequestParams("openProject", {
        createIfMissing: true,
        initGitIfNeeded: true,
        name: null,
        pinWorktree: true,
        projectPath: "/tmp/metidos-project",
      }),
    ).toEqual({
      createIfMissing: true,
      initGitIfNeeded: true,
      name: null,
      pinWorktree: true,
      projectPath: "/tmp/metidos-project",
    });
  });

  test("rejects legacy openProject path-only params", async () => {
    useIsolatedAppDataDir();
    const { validateRpcRequestParams } = await import("./index");

    expect(() =>
      validateRpcRequestParams("openProject", { path: "/tmp/metidos-project" }),
    ).toThrow(/openProject\.projectPath is required/);
  });

  test("validates createTerminal request fields before procedure dispatch", async () => {
    useIsolatedAppDataDir();
    const { validateRpcRequestParams } = await import("./index");

    expect(() =>
      validateRpcRequestParams("createTerminal", {
        command: "echo hello",
        cwd: null,
        dir: null,
        projectId: 1,
        rows: 24,
        title: null,
        worktreePath: "/tmp/metidos-project",
      }),
    ).not.toThrow();
    expect(() =>
      validateRpcRequestParams("createTerminal", {
        cwd: "/tmp/metidos-project",
        title: "shell",
      }),
    ).toThrow(/createTerminal\.projectId is required/);
    expect(() =>
      validateRpcRequestParams("createTerminal", {
        command: ["echo", "hello"],
        projectId: 1,
        worktreePath: "/tmp/metidos-project",
      }),
    ).toThrow(/createTerminal\.command must be nullableString/);
  });

  test("bounds listThreadStatuses ids", async () => {
    useIsolatedAppDataDir();
    const { validateRpcRequestParams } = await import("./index");

    expect(() =>
      validateRpcRequestParams("listThreadStatuses", {
        threadIds: Array.from({ length: 201 }, (_, index) => index + 1),
      }),
    ).toThrow(/at most 200 items/);
    expect(() =>
      validateRpcRequestParams("listThreadStatuses", { threadIds: ["1"] }),
    ).toThrow(/threadIds\[0\] must be number/);
  });

  test("validates batch project and worktree item shapes", async () => {
    useIsolatedAppDataDir();
    const { validateRpcRequestParams } = await import("./index");

    expect(() =>
      validateRpcRequestParams("openProjectsBatch", {
        projects: [{ projectId: 1, projectPath: "/tmp/project" }],
      }),
    ).not.toThrow();
    expect(() =>
      validateRpcRequestParams("openProjectsBatch", {
        projects: [{ projectId: "1", projectPath: "/tmp/project" }],
      }),
    ).toThrow(/projects\[0\]\.projectId must be number/);
    expect(() =>
      validateRpcRequestParams("openWorktreesBatch", {
        worktrees: [{ projectId: 1, worktreePath: 2 }],
      }),
    ).toThrow(/worktrees\[0\]\.worktreePath must be string/);
  });

  test("bounds sendThreadMessage input and image attachments", async () => {
    useIsolatedAppDataDir();
    const {
      MAX_RPC_PARAM_STRING_BYTES,
      MAX_RPC_WEBSOCKET_MESSAGE_BYTES,
      MAX_THREAD_MESSAGE_INPUT_BYTES,
      validateRpcRequestParams,
    } = await import("./index");
    const { MAX_CHAT_IMAGE_ATTACHMENTS, MAX_CHAT_IMAGE_BYTES } = await import(
      "../shared/chat-images"
    );

    expect(() =>
      validateRpcRequestParams("sendThreadMessage", {
        images: Array.from({ length: 9 }, () => ({
          data: "abc",
          mimeType: "image/png",
          type: "image",
        })),
        input: "hello",
        threadId: 1,
      }),
    ).toThrow(/at most 8 items/);
    expect(() =>
      validateRpcRequestParams("sendThreadMessage", {
        input: "x".repeat(MAX_THREAD_MESSAGE_INPUT_BYTES + 1),
        threadId: 1,
      }),
    ).toThrow(/sendThreadMessage\.input string must be at most/);
    expect(() =>
      validateRpcRequestParams("sendThreadMessage", {
        images: [
          {
            data: "x".repeat(MAX_RPC_PARAM_STRING_BYTES + 1),
            mimeType: "image/png",
            type: "image",
          },
        ],
        input: "hello",
        threadId: 1,
      }),
    ).not.toThrow();

    const maxBase64ChatImageBytes = Math.ceil((MAX_CHAT_IMAGE_BYTES * 4) / 3);
    expect(() =>
      validateRpcRequestParams("sendThreadMessage", {
        images: [
          {
            data: "x".repeat(maxBase64ChatImageBytes + 1),
            mimeType: "image/png",
            type: "image",
          },
        ],
        input: "hello",
        threadId: 1,
      }),
    ).toThrow(/sendThreadMessage\.images\[0\]\.data string must be at most/);
    expect(() =>
      validateRpcRequestParams("sendThreadMessage", {
        images: [
          {
            data: "abc",
            extra: "x".repeat(MAX_RPC_PARAM_STRING_BYTES + 1),
            mimeType: "image/png",
            type: "image",
          },
        ],
        input: "hello",
        threadId: 1,
      }),
    ).toThrow(/sendThreadMessage\.images\[0\]\.extra string must be at most/);
    expect(MAX_RPC_WEBSOCKET_MESSAGE_BYTES).toBeGreaterThan(
      maxBase64ChatImageBytes * MAX_CHAT_IMAGE_ATTACHMENTS,
    );
  });

  test("bounds generic RPC string fields and extension editor text", async () => {
    useIsolatedAppDataDir();
    const {
      MAX_RPC_PARAM_STRING_BYTES,
      MAX_THREAD_EXTENSION_EDITOR_TEXT_BYTES,
      validateRpcRequestParams,
    } = await import("./index");

    expect(() =>
      validateRpcRequestParams("openProject", {
        extra: "x".repeat(MAX_RPC_PARAM_STRING_BYTES + 1),
        projectPath: "/tmp/metidos-project",
      }),
    ).toThrow(/extra string must be at most/);

    const fourByteCharacters = "😀".repeat(
      Math.floor(MAX_RPC_PARAM_STRING_BYTES / 4) + 1,
    );
    expect(fourByteCharacters.length).toBeLessThan(MAX_RPC_PARAM_STRING_BYTES);
    expect(() =>
      validateRpcRequestParams("openProject", {
        extra: fourByteCharacters,
        projectPath: "/tmp/metidos-project",
      }),
    ).toThrow(/extra string must be at most/);

    expect(() =>
      validateRpcRequestParams("updateThreadExtensionEditor", {
        text: "x".repeat(MAX_THREAD_EXTENSION_EDITOR_TEXT_BYTES + 1),
        threadId: 1,
      }),
    ).toThrow(/updateThreadExtensionEditor\.text must be at most/);
  });

  test("validates worktree file path fields before procedure dispatch", async () => {
    useIsolatedAppDataDir();
    const { validateRpcRequestParams } = await import("./index");

    expect(() =>
      validateRpcRequestParams("readWorktreeFileContentPage", {
        path: "src/index.ts\0suffix",
        projectId: 1,
        worktreePath: "/tmp/project",
      }),
    ).toThrow(/path must not contain NUL/);
    expect(() =>
      validateRpcRequestParams("readWorktreeFileDiff", {
        change: { previousPath: "old.ts" },
        projectId: 1,
        worktreePath: "/tmp/project",
      }),
    ).toThrow(/change\.path must be string/);
    expect(() =>
      validateRpcRequestParams("readWorktreeFileDiff", {
        change: { path: "new.ts", previousPath: null },
        projectId: 1,
        worktreePath: "/tmp/project",
      }),
    ).not.toThrow();
    expect(() =>
      validateRpcRequestParams("readWorktreeFileDiff", {
        change: { path: "new.ts", previousPath: 1 },
        projectId: 1,
        worktreePath: "/tmp/project",
      }),
    ).toThrow(/change\.previousPath must be nullableString/);
  });

  test("clamps client supplied RPC timeouts", async () => {
    useIsolatedAppDataDir();
    const { MAX_RPC_REQUEST_TIMEOUT_MS, parseRpcClientMessage } = await import(
      "./index"
    );

    expect(
      parseRpcClientMessage({
        type: "request",
        id: 1,
        method: "listProjects",
        timeoutMs: Number.MAX_SAFE_INTEGER,
      }),
    ).toMatchObject({ timeoutMs: MAX_RPC_REQUEST_TIMEOUT_MS });
    expect(
      parseRpcClientMessage({
        type: "request",
        id: 2,
        method: "listProjects",
        timeoutMs: 0,
      }),
    ).not.toHaveProperty("timeoutMs");
  });

  test("rejects unsafe RPC request and cancel ids", async () => {
    useIsolatedAppDataDir();
    const { parseRpcClientMessage } = await import("./index");

    for (const id of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        parseRpcClientMessage({ type: "request", id, method: "listProjects" }),
      ).toThrow(/Invalid RPC request payload/);
      expect(() => parseRpcClientMessage({ type: "cancel", id })).toThrow(
        /Invalid RPC request payload/,
      );
    }

    expect(
      parseRpcClientMessage({ type: "request", id: 0, method: "listProjects" }),
    ).toMatchObject({ id: 0, method: "listProjects", type: "request" });
    expect(parseRpcClientMessage({ type: "cancel", id: 0 })).toEqual({
      id: 0,
      type: "cancel",
    });
  });

  test("classifies Bun websocket send backpressure as a failed send", async () => {
    useIsolatedAppDataDir();
    const { classifyRpcWebSocketSendStatus } = await import("./index");

    expect(classifyRpcWebSocketSendStatus(-1)).toBe("backpressure");
    expect(classifyRpcWebSocketSendStatus(0)).toBe("dropped");
    expect(classifyRpcWebSocketSendStatus(1)).toBe("sent");
  });

  test("bounds generic RPC record params", async () => {
    useIsolatedAppDataDir();
    const { validateRpcRequestParams } = await import("./index");

    expect(() =>
      validateRpcRequestParams("updatePluginSettings", {
        directoryName: "demo",
        values: {
          nested: Object.fromEntries(
            Array.from({ length: 1001 }, (_, index) => [`key${index}`, "x"]),
          ),
        },
      }),
    ).toThrow(/updatePluginSettings\.values\.nested would raise the total/);
    expect(() =>
      validateRpcRequestParams("updatePluginSettings", {
        directoryName: "demo",
        values: { key: "x".repeat(64 * 1024 + 1) },
      }),
    ).toThrow(/string must be at most/);
  });

  test("recognizes only JSON content types for sensitive mutation routes", async () => {
    useIsolatedAppDataDir();
    const { isJsonContentTypeHeader } = await import("./index");

    expect(isJsonContentTypeHeader("application/json")).toBeTrue();
    expect(
      isJsonContentTypeHeader("application/json; charset=utf-8"),
    ).toBeTrue();
    expect(isJsonContentTypeHeader("text/plain")).toBeFalse();
    expect(isJsonContentTypeHeader(null)).toBeFalse();
  });
});
