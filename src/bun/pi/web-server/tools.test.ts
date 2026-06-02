/**
 * @file src/bun/pi/web-server/tools.test.ts
 * @description Tests for project-scoped local web-server tools.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { createPiWebServerManager, createPiWebServerTools } from "./tools";

const tempDirectories = new Set<string>();
const managers = new Set<ReturnType<typeof createPiWebServerManager>>();

function makeWorktree(): string {
  const directory = mkdtempSync(join(tmpdir(), "metidos-pi-web-server-"));
  tempDirectories.add(directory);
  return directory;
}

function resultText(result: { content: readonly unknown[] }) {
  const firstContent = result.content[0];
  return firstContent &&
    typeof firstContent === "object" &&
    firstContent !== null &&
    "text" in firstContent &&
    typeof firstContent.text === "string"
    ? firstContent.text
    : "";
}

afterEach(() => {
  for (const manager of managers) {
    manager.dispose();
  }
  managers.clear();
  for (const directory of tempDirectories) {
    rmSync(directory, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("createPiWebServerTools", () => {
  it("hosts a project-local directory on a local static server", async () => {
    const worktreePath = makeWorktree();
    const sitePath = join(worktreePath, "site");
    mkdirSync(sitePath, {
      recursive: true,
    });
    writeFileSync(
      join(sitePath, "index.html"),
      "<html><body>hello from web server</body></html>",
      "utf8",
    );

    const manager = createPiWebServerManager({
      worktreePathContext: worktreePath,
    });
    managers.add(manager);
    const tools = createPiWebServerTools(
      {
        worktreePathContext: worktreePath,
      },
      manager,
    );
    const hostTool = tools.find((entry) => entry.name === "web_server_host");
    const listTool = tools.find((entry) => entry.name === "web_server_list");
    const stopTool = tools.find((entry) => entry.name === "web_server_stop");
    if (!hostTool || !listTool || !stopTool) {
      throw new Error("Expected web server tools to be registered.");
    }
    expect(hostTool.description).toContain(
      "Returns a preferred stable share/open link first",
    );
    expect(hostTool.description).toContain("127.0.0.1");

    const hosted = await hostTool.execute(
      "call-1",
      { path: "site" } as never,
      undefined,
      async () => {},
      { cwd: worktreePath } as never,
    );

    const hostedDetails = hosted.details as {
      computerName: string | null;
      host: string;
      id: number;
      links: { host: string; url: string }[];
      path: string;
      port: number;
      serverInstanceId: string;
      shareOpenUrl: string | null;
      shareRouteUrl: string | null;
      url: string;
    };

    expect(resultText(hosted)).toContain("Hosted site as web server 1.");
    expect(resultText(hosted)).toContain("- Bound on: `127.0.0.1:");
    expect(resultText(hosted)).toContain(
      `[http://127.0.0.1:${hostedDetails.port}/](http://127.0.0.1:${hostedDetails.port}/)`,
    );
    if (hostname().trim() === "localhost") {
      expect(resultText(hosted)).toContain(`- Computer name: [`);
    } else {
      expect(resultText(hosted)).not.toContain(`- Computer name: [`);
    }
    expect(hostedDetails).toMatchObject({
      host: "127.0.0.1",
      id: 1,
      path: "site",
      shareOpenUrl: null,
      shareRouteUrl: null,
    });
    expect(hostedDetails.serverInstanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
    expect(hostedDetails.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          host: "127.0.0.1",
          url: `http://127.0.0.1:${hostedDetails.port}/`,
        }),
      ]),
    );
    expect(hostedDetails.links.map((link) => link.host).sort()).toEqual([
      "127.0.0.1",
      "::1",
      "localhost",
    ]);

    const response = await fetch(`http://127.0.0.1:${hostedDetails.port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("hello from web server");

    const listed = await listTool.execute(
      "call-2",
      {} as never,
      undefined,
      async () => {},
      { cwd: worktreePath } as never,
    );
    expect(resultText(listed)).toContain("| id | path | port |");
    expect(resultText(listed)).toContain("| 1 | site |");

    const stopped = await stopTool.execute(
      "call-3",
      { id: 1 } as never,
      undefined,
      async () => {},
      { cwd: worktreePath } as never,
    );
    expect(resultText(stopped)).toBe("Stopped web server 1.");

    const emptyList = await listTool.execute(
      "call-4",
      {} as never,
      undefined,
      async () => {},
      { cwd: worktreePath } as never,
    );
    expect(resultText(emptyList)).toContain("| id | path | port |");
    expect(resultText(emptyList)).toContain("| _None_ |  |  |");
  });

  it("encodes directory listing hrefs from decoded path segments", async () => {
    const worktreePath = makeWorktree();
    const nestedPath = join(worktreePath, "site", "hash#folder");
    mkdirSync(nestedPath, {
      recursive: true,
    });
    writeFileSync(join(nestedPath, "question?file#.txt"), "linked", "utf8");

    const manager = createPiWebServerManager({
      worktreePathContext: worktreePath,
    });
    managers.add(manager);
    const hostTool = createPiWebServerTools(
      {
        worktreePathContext: worktreePath,
      },
      manager,
    ).find((entry) => entry.name === "web_server_host");
    if (!hostTool) {
      throw new Error("Expected web_server_host to be registered.");
    }

    const hosted = await hostTool.execute(
      "call-1",
      { path: "site" } as never,
      undefined,
      async () => {},
      { cwd: worktreePath } as never,
    );
    const hostedDetails = hosted.details as {
      port: number;
    };

    const listingResponse = await fetch(
      `http://127.0.0.1:${hostedDetails.port}/hash%23folder/`,
    );
    expect(listingResponse.status).toBe(200);
    const listingHtml = await listingResponse.text();
    expect(listingHtml).toContain(
      'href="/hash%23folder/question%3Ffile%23.txt"',
    );
    expect(listingHtml).not.toContain('href="/hash#folder/');

    const linkedResponse = await fetch(
      `http://127.0.0.1:${hostedDetails.port}/hash%23folder/question%3Ffile%23.txt`,
    );
    expect(linkedResponse.status).toBe(200);
    expect(await linkedResponse.text()).toBe("linked");
  });

  it("bounds generated directory listings", async () => {
    const worktreePath = makeWorktree();
    const sitePath = join(worktreePath, "site");
    mkdirSync(sitePath, { recursive: true });
    for (let index = 0; index < 505; index += 1) {
      writeFileSync(
        join(sitePath, `file-${index.toString().padStart(3, "0")}.txt`),
        "x",
        "utf8",
      );
    }

    const manager = createPiWebServerManager({
      worktreePathContext: worktreePath,
    });
    managers.add(manager);
    const hostTool = createPiWebServerTools(
      {
        worktreePathContext: worktreePath,
      },
      manager,
    ).find((entry) => entry.name === "web_server_host");
    if (!hostTool) {
      throw new Error("Expected web_server_host to be registered.");
    }

    const hosted = await hostTool.execute(
      "call-1",
      { path: "site" } as never,
      undefined,
      async () => {},
      { cwd: worktreePath } as never,
    );
    const hostedDetails = hosted.details as { port: number };

    const listingResponse = await fetch(
      `http://127.0.0.1:${hostedDetails.port}/`,
    );
    expect(listingResponse.status).toBe(200);
    const listingHtml = await listingResponse.text();
    expect(listingHtml).toContain(
      "Directory listing truncated to 500 entries.",
    );
    expect(listingHtml).toContain("file-499.txt");
    expect(listingHtml).not.toContain("file-500.txt");
  });

  it("re-stats the hosted root on each request", async () => {
    const worktreePath = makeWorktree();
    const swapPath = join(worktreePath, "swap");
    writeFileSync(swapPath, "original file", "utf8");

    const manager = createPiWebServerManager({
      worktreePathContext: worktreePath,
    });
    managers.add(manager);
    const hostTool = createPiWebServerTools(
      {
        worktreePathContext: worktreePath,
      },
      manager,
    ).find((entry) => entry.name === "web_server_host");
    if (!hostTool) {
      throw new Error("Expected web_server_host to be registered.");
    }

    const hosted = await hostTool.execute(
      "call-1",
      { path: "swap" } as never,
      undefined,
      async () => {},
      { cwd: worktreePath } as never,
    );
    const hostedDetails = hosted.details as {
      port: number;
    };

    const fileResponse = await fetch(`http://127.0.0.1:${hostedDetails.port}/`);
    expect(fileResponse.status).toBe(200);
    expect(await fileResponse.text()).toBe("original file");

    unlinkSync(swapPath);
    mkdirSync(swapPath);
    writeFileSync(join(swapPath, "index.html"), "swapped directory", "utf8");

    const directoryResponse = await fetch(
      `http://127.0.0.1:${hostedDetails.port}/`,
    );
    expect(directoryResponse.status).toBe(200);
    expect(await directoryResponse.text()).toBe("swapped directory");
  });

  it("does not serve symlinks inside hosted directories that resolve outside the project root", async () => {
    const worktreePath = makeWorktree();
    const sitePath = join(worktreePath, "site");
    mkdirSync(sitePath, {
      recursive: true,
    });
    writeFileSync(join(sitePath, "index.html"), "inside", "utf8");

    const outsidePath = mkdtempSync(
      join(tmpdir(), "metidos-pi-web-server-out-"),
    );
    tempDirectories.add(outsidePath);
    writeFileSync(join(outsidePath, "secret.txt"), "outside secret", "utf8");
    symlinkSync(join(outsidePath, "secret.txt"), join(sitePath, "secret.txt"));

    const manager = createPiWebServerManager({
      worktreePathContext: worktreePath,
    });
    managers.add(manager);
    const tools = createPiWebServerTools(
      {
        worktreePathContext: worktreePath,
      },
      manager,
    );
    const hostTool = tools.find((entry) => entry.name === "web_server_host");
    if (!hostTool) {
      throw new Error("Expected web_server_host to be registered.");
    }

    const hosted = await hostTool.execute(
      "call-1",
      { path: "site" } as never,
      undefined,
      async () => {},
      { cwd: worktreePath } as never,
    );
    const hostedDetails = hosted.details as {
      port: number;
    };

    const indexResponse = await fetch(
      `http://127.0.0.1:${hostedDetails.port}/`,
    );
    expect(indexResponse.status).toBe(200);
    expect(await indexResponse.text()).toContain("inside");

    const secretResponse = await fetch(
      `http://127.0.0.1:${hostedDetails.port}/secret.txt`,
    );
    expect(secretResponse.status).toBe(404);
    expect(await secretResponse.text()).not.toContain("outside secret");
  });

  it("rejects symlinked hosted paths that resolve outside the project root", async () => {
    const worktreePath = makeWorktree();
    const outsidePath = mkdtempSync(
      join(tmpdir(), "metidos-pi-web-server-out-"),
    );
    tempDirectories.add(outsidePath);
    writeFileSync(join(outsidePath, "index.html"), "outside", "utf8");
    symlinkSync(outsidePath, join(worktreePath, "outside-link"), "dir");

    const manager = createPiWebServerManager({
      worktreePathContext: worktreePath,
    });
    managers.add(manager);
    const tool = createPiWebServerTools(
      {
        worktreePathContext: worktreePath,
      },
      manager,
    ).find((entry) => entry.name === "web_server_host");
    if (!tool) {
      throw new Error("Expected web_server_host to be registered.");
    }

    await expect(
      tool.execute(
        "call-1",
        { path: "outside-link" } as never,
        undefined,
        async () => {},
        { cwd: worktreePath } as never,
      ),
    ).rejects.toThrow("Path is outside the current project root");
    await expect(
      tool.execute(
        "call-2",
        { path: "outside-link" } as never,
        undefined,
        async () => {},
        { cwd: worktreePath } as never,
      ),
    ).rejects.not.toThrow(outsidePath);
  });

  it("rejects paths outside the current project root", async () => {
    const worktreePath = makeWorktree();
    const outsidePath = mkdtempSync(
      join(tmpdir(), "metidos-pi-web-server-out-"),
    );
    tempDirectories.add(outsidePath);
    writeFileSync(join(outsidePath, "index.html"), "outside", "utf8");

    const manager = createPiWebServerManager({
      worktreePathContext: worktreePath,
    });
    managers.add(manager);
    const tool = createPiWebServerTools(
      {
        worktreePathContext: worktreePath,
      },
      manager,
    ).find((entry) => entry.name === "web_server_host");
    if (!tool) {
      throw new Error("Expected web_server_host to be registered.");
    }

    await expect(
      tool.execute(
        "call-1",
        { path: outsidePath } as never,
        undefined,
        async () => {},
        { cwd: worktreePath } as never,
      ),
    ).rejects.toThrow("Path is outside the current project root");
    await expect(
      tool.execute(
        "call-2",
        { path: outsidePath } as never,
        undefined,
        async () => {},
        { cwd: worktreePath } as never,
      ),
    ).rejects.not.toThrow(outsidePath);
  });
});
