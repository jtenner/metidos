import { afterEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import {
  buildCleanTerminalBuffer,
  buildTerminalBridgeEnvironment,
  buildTerminalEnvironment,
  createSafeTerminalGrepRegex,
  normalizeTerminalInputData,
  normalizeTerminalResizeDimensions,
  resolveShellSpawn,
  resolveTerminalNodeBinary,
  terminalOwnerSessionKeyForThread,
  TerminalManager,
  TerminalOutputBuffer,
} from "./terminal-manager";

const tempDirectories = new Set<string>();
const originalMetidosNodeBinary = process.env.METIDOS_NODE_BINARY;
const originalPath = process.env.PATH;
const originalShell = process.env.SHELL;

afterEach(() => {
  if (typeof originalMetidosNodeBinary === "string") {
    process.env.METIDOS_NODE_BINARY = originalMetidosNodeBinary;
  } else {
    delete process.env.METIDOS_NODE_BINARY;
  }
  if (typeof originalPath === "string") {
    process.env.PATH = originalPath;
  } else {
    delete process.env.PATH;
  }
  if (typeof originalShell === "string") {
    process.env.SHELL = originalShell;
  } else {
    delete process.env.SHELL;
  }
  for (const path of tempDirectories) {
    rmSync(path, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-terminal-manager-"));
  tempDirectories.add(path);
  return path;
}

function addMockTerminalSession(
  manager: TerminalManager,
  terminalId: string,
  sockets: unknown[],
  onKill: (signal?: NodeJS.Signals) => void = () => {},
  scope: {
    createdFromThreadId?: number | null;
    ownerSessionId?: string | null;
  } = {},
): void {
  (
    manager as unknown as {
      sessions: Map<string, unknown>;
      terminalOrder: Array<string | undefined>;
    }
  ).sessions.set(terminalId, {
    closeTimer: null,
    cols: 80,
    command: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdFromThreadId: scope.createdFromThreadId ?? null,
    cwd: "/tmp",
    exitCode: null,
    exitSignal: null,
    exitedCleanupTimer: null,
    outputBuffer: new TerminalOutputBuffer(1024),
    ownerSessionId: scope.ownerSessionId ?? "session-1",
    pendingSocketOutput: "pending",
    projectId: 1,
    projectName: "Project",
    ptyProcess: {
      kill: onKill,
      onData: () => {},
      onExit: () => {},
      resize: () => {},
      write: () => {},
    },
    replayBufferBytes: 1024,
    rows: 24,
    socketFlushTimer: null,
    sockets: new Set(sockets),
    status: "running",
    terminalId,
    terminalIndex: 0,
    title: "Terminal",
    updatedAt: "2026-01-01T00:00:00.000Z",
    waitingForKeyToClose: false,
    worktreeFolder: "Project",
    worktreePath: "/tmp",
  });
  (
    manager as unknown as { terminalOrder: Array<string | undefined> }
  ).terminalOrder[0] = terminalId;
}

describe("terminal clean output buffer", () => {
  it("strips ANSI sequences that arrive split across PTY chunks", () => {
    let rawBuffer = "";
    let cleanBuffer = "";

    for (const chunk of ["\u001b[", "31mred", "\u001b[0", "m\n"]) {
      rawBuffer += chunk;
      cleanBuffer = buildCleanTerminalBuffer(rawBuffer, 1024);
    }

    expect(cleanBuffer).toBe("red\n");
    expect(cleanBuffer).not.toContain("\u001b");
    expect(cleanBuffer).not.toContain("[31m");
  });

  it("slices retained lines without rebuilding the full retained output", () => {
    const buffer = new TerminalOutputBuffer(1024);

    buffer.append("one\ntwo\n");
    buffer.append("\u001b[31mthree");
    buffer.append("\u001b[0m\nfour");

    expect(buffer.cleanLineCount()).toBe(4);
    expect(buffer.cleanLines(1, 2)).toEqual(["two", "three"]);
    expect(buffer.grepCleanLines(/thr/, 10, () => {})).toEqual(["3: three"]);
  });

  it("keeps the retained line index bounded by the replay buffer size", () => {
    const buffer = new TerminalOutputBuffer(11);

    buffer.append("alpha\nbeta\ngamma\n");

    expect(buffer.toString()).toBe("beta\ngamma\n");
    expect(buffer.cleanLines(0, 10)).toEqual(["beta", "gamma", ""]);
  });

  it("bounds retained output and line indexes after many small appends", () => {
    const buffer = new TerminalOutputBuffer(32);

    for (let index = 0; index < 500; index += 1) {
      buffer.append(`line-${index}\n`);
    }

    expect(Buffer.byteLength(buffer.toString(), "utf8")).toBeLessThanOrEqual(
      32,
    );
    expect(buffer.cleanLines(0, 10)).toEqual([
      "line-496",
      "line-497",
      "line-498",
      "line-499",
      "",
    ]);
    expect(buffer.grepCleanLines(/line-499/, 10, () => {})).toEqual([
      "4: line-499",
    ]);
  });
});

describe("terminal websocket message validation", () => {
  it("closes terminal sockets that exceed the message rate limit", () => {
    const manager = new TerminalManager(
      {
        exitedIdleTtlMs: 1_000,
        maxGlobalTerminals: 10,
        maxTerminalsPerOwner: 10,
      },
      {
        socketMessageRateLimit: {
          capacity: 1,
          maxBuckets: 10,
          refillIntervalMs: 60_000,
          refillTokens: 1,
        },
      },
    );
    const closeReasons: string[] = [];
    const socket = {
      close: (_code: number, reason: string) => {
        closeReasons.push(reason);
      },
      data: {
        isAdmin: true,
        sessionId: "session-1",
        terminalId: "terminal-1",
        userId: 7,
        username: "metidos",
      },
      send: () => {},
    };
    addMockTerminalSession(manager, "terminal-1", [socket]);

    manager.handleSocketMessage(
      socket as never,
      JSON.stringify({ type: "ping" }),
    );
    manager.handleSocketMessage(
      socket as never,
      JSON.stringify({ type: "ping" }),
    );

    expect(closeReasons).toEqual(["Terminal message rate limit exceeded."]);
  });

  it("scopes terminal socket message rate limits by session and terminal", () => {
    const manager = new TerminalManager(
      {
        exitedIdleTtlMs: 1_000,
        maxGlobalTerminals: 10,
        maxTerminalsPerOwner: 10,
      },
      {
        socketMessageRateLimit: {
          capacity: 1,
          maxBuckets: 10,
          refillIntervalMs: 60_000,
          refillTokens: 1,
        },
      },
    );
    const closeReasons: string[] = [];
    const firstSocket = {
      close: (_code: number, reason: string) => {
        closeReasons.push(`first:${reason}`);
      },
      data: {
        isAdmin: true,
        sessionId: "session-1",
        terminalId: "terminal-1",
        userId: 7,
        username: "metidos",
      },
      send: () => {},
    };
    const secondSocket = {
      close: (_code: number, reason: string) => {
        closeReasons.push(`second:${reason}`);
      },
      data: {
        isAdmin: true,
        sessionId: "session-1",
        terminalId: "terminal-2",
        userId: 7,
        username: "metidos",
      },
      send: () => {},
    };
    addMockTerminalSession(manager, "terminal-1", [firstSocket]);
    addMockTerminalSession(manager, "terminal-2", [secondSocket]);

    manager.handleSocketMessage(
      firstSocket as never,
      JSON.stringify({ type: "ping" }),
    );
    manager.handleSocketMessage(
      secondSocket as never,
      JSON.stringify({ type: "ping" }),
    );
    manager.handleSocketMessage(
      firstSocket as never,
      JSON.stringify({ type: "ping" }),
    );

    expect(closeReasons).toEqual([
      "first:Terminal message rate limit exceeded.",
    ]);
  });

  it("rejects terminal socket connections from a different owner session", () => {
    const manager = new TerminalManager();
    const closeReasons: string[] = [];
    const sentMessages: string[] = [];
    const socket = {
      close: (_code: number, reason: string) => {
        closeReasons.push(reason);
      },
      data: {
        isAdmin: true,
        sessionId: "session-2",
        terminalId: "terminal-1",
        userId: 7,
        username: "metidos",
      },
      send: (message: string) => {
        sentMessages.push(message);
      },
    };
    addMockTerminalSession(manager, "terminal-1", []);

    manager.connectSocket(socket as never);

    expect(closeReasons).toEqual(["Terminal not authorized."]);
    expect(sentMessages).toEqual([]);
    const session = (
      manager as unknown as { sessions: Map<string, { sockets: Set<unknown> }> }
    ).sessions.get("terminal-1");
    expect(session?.sockets.size).toBe(0);
  });

  it("can close terminal sockets without terminating the PTY", () => {
    const manager = new TerminalManager();
    const killedSignals: Array<NodeJS.Signals | undefined> = [];
    const closeReasons: string[] = [];
    const socket = {
      close: (_code: number, reason: string) => {
        closeReasons.push(reason);
      },
      data: {
        isAdmin: false,
        sessionId: "session-1",
        stepUpValidUntil: null,
        terminalId: "terminal-1",
        userId: 7,
        username: "metidos",
      },
      send: () => {},
    };
    addMockTerminalSession(manager, "terminal-1", [socket], (signal) => {
      killedSignals.push(signal);
    });

    const closedCount = manager.closeSocketsForUser(7, "Signed out.");

    expect(closedCount).toBe(1);
    expect(closeReasons).toEqual(["Signed out."]);
    expect(killedSignals).toEqual([]);
  });

  it("can close terminal sockets and terminate the associated PTY", () => {
    const manager = new TerminalManager();
    const killedSignals: Array<NodeJS.Signals | undefined> = [];
    const closeReasons: string[] = [];
    const socket = {
      close: (_code: number, reason: string) => {
        closeReasons.push(reason);
      },
      data: {
        isAdmin: false,
        sessionId: "session-1",
        stepUpValidUntil: null,
        terminalId: "terminal-1",
        userId: 7,
        username: "metidos",
      },
      send: () => {},
    };
    addMockTerminalSession(manager, "terminal-1", [socket], (signal) => {
      killedSignals.push(signal);
    });

    const closedCount = manager.closeSocketsForSession(
      "session-1",
      "Password reset.",
      { terminatePtys: true },
    );

    expect(closedCount).toBe(1);
    expect(closeReasons).toEqual(["Password reset."]);
    expect(killedSignals).toEqual([undefined]);
    const session = (
      manager as unknown as {
        sessions: Map<
          string,
          { closeTimer: ReturnType<typeof setTimeout> | null }
        >;
      }
    ).sessions.get("terminal-1");
    if (session?.closeTimer) {
      clearTimeout(session.closeTimer);
    }
  });

  it("accepts only string terminal input up to 64 KiB", () => {
    expect(normalizeTerminalInputData("a".repeat(64 * 1024))).toBe(
      "a".repeat(64 * 1024),
    );
    expect(normalizeTerminalInputData("a".repeat(64 * 1024 + 1))).toBeNull();
    expect(normalizeTerminalInputData({ data: "hello" })).toBeNull();
  });

  it("clamps terminal resize dimensions to PTY-safe bounds", () => {
    expect(
      normalizeTerminalResizeDimensions(
        { cols: 1, rows: 1 },
        { cols: 80, rows: 24 },
      ),
    ).toEqual({ cols: 10, rows: 5 });
    expect(
      normalizeTerminalResizeDimensions(
        { cols: 9999, rows: 9999 },
        { cols: 80, rows: 24 },
      ),
    ).toEqual({ cols: 500, rows: 200 });
    expect(
      normalizeTerminalResizeDimensions(
        { cols: "wide", rows: null },
        { cols: 80, rows: 24 },
      ),
    ).toEqual({ cols: 80, rows: 24 });
  });
});

describe("terminal environment", () => {
  it("keeps sensitive app and provider environment variables out by default", () => {
    const env = buildTerminalEnvironment({
      BRAVE_SEARCH_API_KEY: "brave-secret",
      COLORTERM: "24bit",
      HOME: "/home/metidos",
      LANG: "en_US.UTF-8",
      METIDOS_APP_DATA_DIR: "/secret/app-data",
      METIDOS_RUNTIME_STATS_SECRET: "stats-secret",
      OPENAI_API_KEY: "openai-secret",
      PATH: "/usr/bin",
      TERM: "vt100",
      USER: "metidos",
    });

    expect(env).toEqual({
      COLORTERM: "24bit",
      HOME: "/home/metidos",
      LANG: "en_US.UTF-8",
      PATH: "/usr/bin",
      TERM: "vt100",
      USER: "metidos",
    });
  });

  it("builds a minimal bridge process environment without app secrets", () => {
    const env = buildTerminalBridgeEnvironment({
      HOME: "/home/metidos",
      LANG: "en_US.UTF-8",
      METIDOS_RUNTIME_STATS_SECRET: "stats-secret",
      OPENAI_API_KEY: "openai-secret",
      PATH: "/usr/bin",
      USER: "metidos",
    });

    expect(env).toEqual({
      HOME: "/home/metidos",
      LANG: "en_US.UTF-8",
      PATH: "/usr/bin",
      USER: "metidos",
    });
  });

  it("excludes dynamic linker and runtime hook variables by default", () => {
    const terminalEnv = buildTerminalEnvironment({
      DYLD_INSERT_LIBRARIES: "/tmp/macos-hook.dylib",
      LD_LIBRARY_PATH: "/tmp/lib",
      LD_PRELOAD: "/tmp/hook.so",
      NODE_OPTIONS: "--require /tmp/hook.js",
      PATH: "/usr/bin",
    });
    const bridgeEnv = buildTerminalBridgeEnvironment({
      DYLD_INSERT_LIBRARIES: "/tmp/macos-hook.dylib",
      LD_LIBRARY_PATH: "/tmp/lib",
      LD_PRELOAD: "/tmp/hook.so",
      NODE_OPTIONS: "--require /tmp/hook.js",
      PATH: "/usr/bin",
    });

    expect(terminalEnv.LD_PRELOAD).toBeUndefined();
    expect(terminalEnv.LD_LIBRARY_PATH).toBeUndefined();
    expect(terminalEnv.DYLD_INSERT_LIBRARIES).toBeUndefined();
    expect(terminalEnv.NODE_OPTIONS).toBeUndefined();
    expect(terminalEnv.PATH).toBe("/usr/bin");
    expect(bridgeEnv.LD_PRELOAD).toBeUndefined();
    expect(bridgeEnv.LD_LIBRARY_PATH).toBeUndefined();
    expect(bridgeEnv.DYLD_INSERT_LIBRARIES).toBeUndefined();
    expect(bridgeEnv.NODE_OPTIONS).toBeUndefined();
    expect(bridgeEnv.PATH).toBe("/usr/bin");
  });

  it("fills terminal defaults and allows explicit opt-in for extra variables", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    let env: NodeJS.ProcessEnv = {};
    try {
      env = buildTerminalEnvironment({
        CUSTOM_PROVIDER_KEY: "provider-secret",
        METIDOS_TERMINAL_EXTRA_ENV_ALLOWLIST:
          "CUSTOM_PROVIDER_KEY, OPENAI_API_KEY, invalid-name",
        OPENAI_API_KEY: "openai-secret",
        PATH: "/bin",
      });
    } finally {
      console.warn = originalWarn;
    }

    expect(env.CUSTOM_PROVIDER_KEY).toBe("provider-secret");
    expect(env.OPENAI_API_KEY).toBe("openai-secret");
    expect(env.METIDOS_TERMINAL_EXTRA_ENV_ALLOWLIST).toBeUndefined();
    expect(env.PATH).toBe("/bin");
    expect(env.COLORTERM).toBe("truecolor");
    expect(env.TERM).toBe("xterm-256color");
    expect(env["invalid-name"]).toBeUndefined();
    expect(warnings).toHaveLength(2);
    expect(warnings.join("\n")).toContain("CUSTOM_PROVIDER_KEY");
    expect(warnings.join("\n")).toContain("OPENAI_API_KEY");
  });

  it("only accepts portable environment variable names in extra terminal allowlist", () => {
    const env = buildTerminalEnvironment({
      _UNDERSCORE_OK: "underscore",
      "1_LEADING_DIGIT": "digit",
      CAMEL_CASE_OK: "camel",
      METIDOS_TERMINAL_EXTRA_ENV_ALLOWLIST:
        "_UNDERSCORE_OK, CAMEL_CASE_OK, 1_LEADING_DIGIT, has-hyphen, HAS.DOT, HAS SPACE, ÜNICODE, =EMPTY_NAME",
      "HAS SPACE": "space",
      "HAS.DOT": "dot",
      "has-hyphen": "hyphen",
      ÜNICODE: "unicode",
    });

    expect(env._UNDERSCORE_OK).toBe("underscore");
    expect(env.CAMEL_CASE_OK).toBe("camel");
    expect(env["1_LEADING_DIGIT"]).toBeUndefined();
    expect(env["has-hyphen"]).toBeUndefined();
    expect(env["HAS.DOT"]).toBeUndefined();
    expect(env["HAS SPACE"]).toBeUndefined();
    expect(env.ÜNICODE).toBeUndefined();
    expect(env[""]).toBeUndefined();
  });
});

describe("terminal shell resolution", () => {
  it("falls back when an inherited SHELL points at a missing host shell", () => {
    if (process.platform === "win32") {
      return;
    }
    process.env.SHELL = "/tmp/metidos-missing-host-zsh";

    const spawnConfig = resolveShellSpawn(null, {
      defaultShell: "",
      replayBufferBytes: 1024,
    });

    const shellName = spawnConfig.file.split("/").at(-1) ?? "";

    expect(spawnConfig.file).not.toBe(process.env.SHELL);
    expect(["bash", "dash", "sh"]).toContain(shellName);
  });

  it("resolves configured bare shells through PATH before spawning", () => {
    if (process.platform === "win32") {
      return;
    }
    const root = createTempDirectory();
    const shellPath = join(root, "mysh");
    writeFileSync(shellPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    chmodSync(shellPath, 0o700);
    process.env.PATH = [root, process.env.PATH || ""].join(delimiter);

    const spawnConfig = resolveShellSpawn(null, {
      defaultShell: "mysh",
      replayBufferBytes: 1024,
    });

    expect(spawnConfig.file).toBe(realpathSync(shellPath));
  });

  it("canonicalizes symlinked configured shells before spawning", () => {
    if (process.platform === "win32") {
      return;
    }
    const root = createTempDirectory();
    const realShellPath = join(root, "realsh");
    const symlinkShellPath = join(root, "linksh");
    writeFileSync(realShellPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    chmodSync(realShellPath, 0o700);
    symlinkSync(realShellPath, symlinkShellPath);

    const absoluteSpawnConfig = resolveShellSpawn(null, {
      defaultShell: symlinkShellPath,
      replayBufferBytes: 1024,
    });

    process.env.PATH = [root, process.env.PATH || ""].join(delimiter);
    const pathSpawnConfig = resolveShellSpawn(null, {
      defaultShell: "linksh",
      replayBufferBytes: 1024,
    });

    expect(absoluteSpawnConfig.file).toBe(realpathSync(realShellPath));
    expect(pathSpawnConfig.file).toBe(realpathSync(realShellPath));
  });

  it("reports unavailable configured shells before node-pty sees them", () => {
    const root = createTempDirectory();
    const missingShell = join(root, "missing-shell");

    expect(() =>
      resolveShellSpawn(null, {
        defaultShell: missingShell,
        replayBufferBytes: 1024,
      }),
    ).toThrow("Configured terminal default shell");
  });
});

describe("terminal node binary resolution", () => {
  it("resolves the default node binary to an absolute executable", () => {
    if (process.platform === "win32") {
      return;
    }
    const root = createTempDirectory();
    const binaryPath = join(root, "node");
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    chmodSync(binaryPath, 0o700);
    delete process.env.METIDOS_NODE_BINARY;
    process.env.PATH = root;

    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      expect(resolveTerminalNodeBinary()).toBe(realpathSync(binaryPath));
    } finally {
      console.warn = originalWarn;
    }
  });

  it("does not fall back to a bare node command when PATH has no absolute candidate", () => {
    if (process.platform === "win32") {
      return;
    }
    delete process.env.METIDOS_NODE_BINARY;
    process.env.PATH = "relative-bin";

    expect(() => resolveTerminalNodeBinary()).toThrow(
      "Unable to resolve a terminal Node.js binary from PATH",
    );
  });

  it("canonicalizes custom terminal node binary paths before spawning", () => {
    if (process.platform === "win32") {
      return;
    }
    const root = createTempDirectory();
    const realBinaryPath = join(root, "node-real");
    const symlinkPath = join(root, "node-link");
    writeFileSync(realBinaryPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    chmodSync(realBinaryPath, 0o700);
    symlinkSync(realBinaryPath, symlinkPath);
    process.env.METIDOS_NODE_BINARY = symlinkPath;

    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      expect(resolveTerminalNodeBinary()).toBe(realBinaryPath);
    } finally {
      console.warn = originalWarn;
    }
  });

  for (const [name, mode] of [
    ["group-writable", 0o720],
    ["world-writable", 0o702],
  ] as const) {
    it(`rejects ${name} configured node binaries`, () => {
      if (process.platform === "win32") {
        return;
      }
      const root = createTempDirectory();
      const binaryPath = join(root, `node-${name}`);
      writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n", { mode });
      chmodSync(binaryPath, mode);
      process.env.METIDOS_NODE_BINARY = binaryPath;

      expect(() => resolveTerminalNodeBinary()).toThrow(
        "METIDOS_NODE_BINARY must not be writable by group or other users.",
      );
    });
  }

  for (const [name, directoryMode] of [
    ["group-writable", 0o770],
    ["world-writable", 0o707],
  ] as const) {
    it(`rejects default node binaries resolved from ${name} PATH directories`, () => {
      if (process.platform === "win32") {
        return;
      }
      const root = createTempDirectory();
      const binaryPath = join(root, `node`);
      writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
      chmodSync(binaryPath, 0o700);
      chmodSync(root, directoryMode);
      delete process.env.METIDOS_NODE_BINARY;
      process.env.PATH = root;

      expect(() => resolveTerminalNodeBinary()).toThrow(
        "Resolved terminal node binary directory must not be writable by group or other users.",
      );
    });
  }
});

describe("terminal index resolution", () => {
  it("resolves sparse terminal order entries directly by terminal index", () => {
    const manager = new TerminalManager({
      exitedIdleTtlMs: 1_000,
      maxGlobalTerminals: 10,
      maxTerminalsPerOwner: 10,
    });
    const session = {
      terminalId: "terminal-1",
      terminalIndex: 1,
    };
    const mutableManager = manager as unknown as {
      sessions: Map<string, typeof session>;
      terminalOrder: Array<string | undefined>;
    };
    mutableManager.sessions.set(session.terminalId, session);
    mutableManager.terminalOrder = [undefined, session.terminalId];

    expect(manager.resolveTerminalByIndex(1) as unknown).toBe(session);
    expect(() => manager.resolveTerminalByIndex(0)).toThrow(
      "Terminal 0 was not found.",
    );
  });
});

describe("terminal session limits", () => {
  it("refuses new terminals when the global cap is reached", () => {
    const manager = new TerminalManager({
      exitedIdleTtlMs: 1_000,
      maxGlobalTerminals: 0,
      maxTerminalsPerOwner: 1,
    });

    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      expect(() =>
        manager.createTerminal({
          cols: 80,
          command: null,
          createdFromThreadId: null,
          cwd: null,
          dir: null,
          projectId: 1,
          projectName: "Project",
          rows: 24,
          settings: { defaultShell: "", replayBufferBytes: 1024 },
          title: "shell",
          worktreePath: "/tmp/nonexistent-metidos-terminal-test",
        }),
      ).toThrow("Global terminal limit reached");
    } finally {
      console.warn = originalWarn;
    }
    expect(manager.getProcessMetrics()).toEqual({
      closing: 0,
      exited: 0,
      globalSessions: 0,
      owners: 0,
      running: 0,
      starting: 0,
    });
  });
});

describe("terminal access scoping", () => {
  it("allows the owning thread to read, grep, and kill a resumable thread-owned terminal", () => {
    const manager = new TerminalManager({
      exitedIdleTtlMs: 60_000,
      maxGlobalTerminals: 10,
      maxTerminalsPerOwner: 10,
    });
    let killed = false;
    addMockTerminalSession(
      manager,
      "terminal-1",
      [],
      () => {
        killed = true;
      },
      {
        createdFromThreadId: 10,
        ownerSessionId: terminalOwnerSessionKeyForThread(10),
      },
    );
    const access = { createdFromThreadId: 10 };

    expect(manager.viewTerminal(0, 0, 10, access)).toContain("Terminal 0");
    expect(manager.grepTerminal(0, "hi", false, 5, access)).toContain(
      "No matches",
    );

    manager.killTerminalByIndex(0, access);

    expect(killed).toBe(true);
  });

  it("denies read, grep, and kill when the caller thread does not own the terminal", () => {
    const manager = new TerminalManager({
      exitedIdleTtlMs: 60_000,
      maxGlobalTerminals: 10,
      maxTerminalsPerOwner: 10,
    });
    const terminal = manager.createTerminal({
      command: "echo hi",
      createdFromThreadId: 10,
      ownerSessionId: "thread:10",
      projectId: 1,
      projectName: "Project",
      settings: { defaultShell: "", replayBufferBytes: 1024 },
      title: "Owned",
      worktreePath: "/tmp",
    });
    const access = { createdFromThreadId: 99 };

    expect(() =>
      manager.viewTerminal(terminal.terminalIndex, 0, 10, access),
    ).toThrow("Terminal access is denied for the current context.");
    expect(() =>
      manager.grepTerminal(terminal.terminalIndex, "hi", false, 5, access),
    ).toThrow("Terminal access is denied for the current context.");
    expect(() =>
      manager.killTerminalByIndex(terminal.terminalIndex, access),
    ).toThrow("Terminal access is denied for the current context.");
  });
});

describe("terminal grep regex safety", () => {
  it("accepts ordinary grep regex patterns through RE2", () => {
    const regex = createSafeTerminalGrepRegex("hello.*world", true);
    expect(regex.test("HELLO terminal WORLD")).toBe(true);
  });

  it("keeps catastrophic backtracking patterns linear through RE2", () => {
    const nestedQuantifier = createSafeTerminalGrepRegex("(a+)+$");
    expect(nestedQuantifier.test(`${"a".repeat(4096)}!`)).toBe(false);

    const ambiguousAlternation = createSafeTerminalGrepRegex("(a|aa)+$");
    expect(ambiguousAlternation.test(`${"a".repeat(4096)}!`)).toBe(false);

    const repeatedOptionalGroup = createSafeTerminalGrepRegex("(a?){20}a{20}");
    expect(repeatedOptionalGroup.test("a".repeat(19))).toBe(false);
  });

  it("rejects long and unsupported regex patterns", () => {
    expect(() => createSafeTerminalGrepRegex("a".repeat(257))).toThrow(
      "256 characters or fewer",
    );
    expect(() => createSafeTerminalGrepRegex("(a)\\1")).toThrow(
      "not supported by RE2",
    );
  });
});
