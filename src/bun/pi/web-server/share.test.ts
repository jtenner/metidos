/**
 * @file src/bun/pi/web-server/share.test.ts
 * @description Tests for stable cookie-backed web-server share URLs.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  claimWebServerShareSession,
  closeAppDatabase,
  createThread,
  createWebServerShare,
  createWebServerShareSession,
  DEFAULT_THREAD_MODEL,
  DEFAULT_THREAD_REASONING_EFFORT,
  getActiveWebServerShareByClaimToken,
  getAppDatabasePath,
  getWebServerShareSessionByTokenHash,
  initAppDatabase,
  resetResolvedAppDataDirectory,
  resolveActiveWebServerShareSession,
  stopWebServerShareByServerInstanceId,
  upsertProject,
} from "../../db";
import {
  buildWebServerShareRoutePath,
  generateWebServerShareOpaqueToken,
  hashWebServerShareOpaqueToken,
  parseCookieHeaderValue,
  resolveWebServerShareHost,
  resolveWebServerShareOrigin,
  stripWebServerShareSessionCookieHeader,
  WEB_SERVER_SHARE_COOKIE_NAME,
  WEB_SERVER_SHARE_UPSTREAM_INSTANCE_HEADER,
} from "./share";
import {
  startPiWebServerShareWorker,
  stopPiWebServerShareWorker,
} from "./share-worker";
import { createPiWebServerManager, createPiWebServerTools } from "./tools";

const tempDirectories = new Set<string>();
const managers = new Set<ReturnType<typeof createPiWebServerManager>>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
const originalSharePort = process.env.METIDOS_WEB_SERVER_SHARE_PORT;
const originalShareOrigin = process.env.METIDOS_WEB_SERVER_SHARE_ORIGIN;
const originalShareHost = process.env.METIDOS_WEB_SERVER_SHARE_HOST;
const originalShareAllowPublicHost =
  process.env.METIDOS_WEB_SERVER_SHARE_ALLOW_PUBLIC_HOST;
const originalPublicOrigin = process.env.METIDOS_PUBLIC_ORIGIN;

function createTempDirectory(prefix = "metidos-pi-web-server-share-"): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() =>
          reject(new Error("Failed to resolve a free TCP port.")),
        );
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function rawHttpGet(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = connect({ host: "127.0.0.1", port }, () => {
      const headerLines = Object.entries(headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n${headerLines}\r\n\r\n`,
      );
    });
    socket.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    socket.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    socket.on("error", reject);
  });
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

function createThreadScopedWebServerTools(worktreePath: string) {
  const database = initAppDatabase();
  const project = upsertProject(database, {
    name: "Shared web server project",
    projectPath: worktreePath,
  });
  const thread = createThread(database, {
    agentsAccess: false,
    githubAccess: false,
    metidosAccess: true,
    model: DEFAULT_THREAD_MODEL,
    projectId: project.id,
    reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
    title: "Shared web server thread",
    unsafeMode: false,
    webServerAccess: true,
    worktreePath,
  });
  const manager = createPiWebServerManager({
    ownerUserId: 1,
    projectId: thread.projectId,
    threadId: thread.id,
    worktreePathContext: worktreePath,
  });
  managers.add(manager);
  const tools = createPiWebServerTools(
    {
      ownerUserId: 1,
      projectId: thread.projectId,
      threadId: thread.id,
      worktreePathContext: worktreePath,
    },
    manager,
  );
  return {
    manager,
    thread,
    tools,
  };
}

async function claimShareSession(
  shareOpenUrl: string,
  claimToken?: string,
): Promise<{
  cookie: string;
  redirectUrl: string;
}> {
  const resolvedClaimToken =
    claimToken ??
    new URLSearchParams(new URL(shareOpenUrl).hash.slice(1)).get("claimToken");
  if (!resolvedClaimToken) {
    throw new Error("Share claim token was not available.");
  }
  const response = await fetch(shareOpenUrl, {
    body: JSON.stringify({ claimToken: resolvedClaimToken }),
    headers: {
      "content-type": "application/json",
      origin: new URL(shareOpenUrl).origin,
    },
    method: "POST",
  });
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { redirectTo?: string };
  expect(payload.redirectTo).toBeTruthy();
  const setCookieHeader = response.headers.get("set-cookie");
  expect(setCookieHeader).toContain(`${WEB_SERVER_SHARE_COOKIE_NAME}=`);
  expect(setCookieHeader).toContain(
    `Path=${new URL(payload.redirectTo ?? "/", shareOpenUrl).pathname}`,
  );
  return {
    cookie: setCookieHeader?.split(";")[0] ?? "",
    redirectUrl: new URL(payload.redirectTo ?? "/", shareOpenUrl).toString(),
  };
}

afterEach(async () => {
  for (const manager of managers) {
    manager.dispose();
  }
  managers.clear();
  await stopPiWebServerShareWorker();
  closeAppDatabase();
  resetResolvedAppDataDirectory();

  if (typeof originalAppDataDir === "string") {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.METIDOS_APP_DATA_DIR;
  }
  if (typeof originalSharePort === "string") {
    process.env.METIDOS_WEB_SERVER_SHARE_PORT = originalSharePort;
  } else {
    delete process.env.METIDOS_WEB_SERVER_SHARE_PORT;
  }
  if (typeof originalShareOrigin === "string") {
    process.env.METIDOS_WEB_SERVER_SHARE_ORIGIN = originalShareOrigin;
  } else {
    delete process.env.METIDOS_WEB_SERVER_SHARE_ORIGIN;
  }
  if (typeof originalShareHost === "string") {
    process.env.METIDOS_WEB_SERVER_SHARE_HOST = originalShareHost;
  } else {
    delete process.env.METIDOS_WEB_SERVER_SHARE_HOST;
  }
  if (typeof originalShareAllowPublicHost === "string") {
    process.env.METIDOS_WEB_SERVER_SHARE_ALLOW_PUBLIC_HOST =
      originalShareAllowPublicHost;
  } else {
    delete process.env.METIDOS_WEB_SERVER_SHARE_ALLOW_PUBLIC_HOST;
  }
  if (typeof originalPublicOrigin === "string") {
    process.env.METIDOS_PUBLIC_ORIGIN = originalPublicOrigin;
  } else {
    delete process.env.METIDOS_PUBLIC_ORIGIN;
  }

  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("web-server share host binding", () => {
  it("uses loopback by default and rewrites wildcard hosts to loopback", () => {
    expect(resolveWebServerShareHost({})).toBe("127.0.0.1");
    expect(
      resolveWebServerShareHost({ METIDOS_WEB_SERVER_SHARE_HOST: "0.0.0.0" }),
    ).toBe("127.0.0.1");
    expect(
      resolveWebServerShareHost({ METIDOS_WEB_SERVER_SHARE_HOST: "::" }),
    ).toBe("127.0.0.1");
  });

  it("accepts loopback host configuration", () => {
    for (const host of [
      "127.0.0.1",
      "127.10.20.30",
      "localhost",
      "::1",
      "[::1]",
    ]) {
      expect(
        resolveWebServerShareHost({ METIDOS_WEB_SERVER_SHARE_HOST: host }),
      ).toBe(host);
    }
  });

  it("rejects non-loopback host configuration without explicit opt-in", () => {
    expect(() =>
      resolveWebServerShareHost({
        METIDOS_WEB_SERVER_SHARE_HOST: "192.168.1.10",
      }),
    ).toThrow("METIDOS_WEB_SERVER_SHARE_ALLOW_PUBLIC_HOST=true");
  });

  it("allows non-loopback host configuration with explicit unsafe opt-in and TLS", () => {
    expect(
      resolveWebServerShareHost({
        METIDOS_TLS: "1",
        METIDOS_WEB_SERVER_SHARE_ALLOW_PUBLIC_HOST: "true",
        METIDOS_WEB_SERVER_SHARE_HOST: "192.168.1.10",
      }),
    ).toBe("192.168.1.10");
  });
});

describe("stable web-server share URL cookies", () => {
  it("parses cookie values with equals signs and quoted values", () => {
    expect(parseCookieHeaderValue("foo=a=b=c; bar=1", "foo")).toBe("a=b=c");
    expect(parseCookieHeaderValue('foo="quoted=value"; bar=1', "foo")).toBe(
      "quoted=value",
    );
    expect(parseCookieHeaderValue("foo=; bar=1", "foo")).toBeNull();
  });

  it("strips only the gateway share session cookie before proxying upstream", () => {
    expect(
      stripWebServerShareSessionCookieHeader(
        `${WEB_SERVER_SHARE_COOKIE_NAME}=gateway-token; upstream_pref=keep-me; theme=dark`,
      ),
    ).toBe("upstream_pref=keep-me; theme=dark");
    expect(
      stripWebServerShareSessionCookieHeader(
        `${WEB_SERVER_SHARE_COOKIE_NAME}=one; ${WEB_SERVER_SHARE_COOKIE_NAME}=two`,
      ),
    ).toBeNull();
  });
});

describe("stable web-server share URLs", () => {
  it("prefers the configured public origin without rewriting it to the share worker port", () => {
    expect(
      resolveWebServerShareOrigin({
        env: {
          METIDOS_PUBLIC_ORIGIN: "https://metidos.example.com",
          METIDOS_WEB_SERVER_SHARE_PORT: "7600",
        } as NodeJS.ProcessEnv,
      }),
    ).toBe("https://metidos.example.com");
  });

  it("persists share and session lifecycle state in the app database", () => {
    const appDataDir = createTempDirectory("metidos-pi-web-server-share-db-");
    const worktreePath = createTempDirectory(
      "metidos-pi-web-server-share-worktree-",
    );
    process.env.METIDOS_APP_DATA_DIR = appDataDir;

    const database = initAppDatabase();
    const project = upsertProject(database, {
      name: "Lifecycle project",
      projectPath: worktreePath,
    });
    const thread = createThread(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: DEFAULT_THREAD_MODEL,
      projectId: project.id,
      reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
      title: "Lifecycle thread",
      unsafeMode: false,
      webServerAccess: true,
      worktreePath,
    });
    const claimToken = generateWebServerShareOpaqueToken();
    const serverInstanceId = crypto.randomUUID();
    const sessionToken = generateWebServerShareOpaqueToken();

    const share = createWebServerShare(database, {
      claimTokenHash: hashWebServerShareOpaqueToken(claimToken),
      projectId: thread.projectId,
      serverId: 1,
      serverInstanceId,
      targetPort: 43123,
      threadId: thread.id,
      worktreePath,
    });
    expect(share.threadId).toBe(thread.id);
    expect(getActiveWebServerShareByClaimToken(database, claimToken)?.id).toBe(
      share.id,
    );

    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const session = createWebServerShareSession(database, {
      expiresAt,
      serverId: 1,
      serverInstanceId,
      sessionTokenHash: hashWebServerShareOpaqueToken(sessionToken),
      threadId: thread.id,
    });
    expect(
      getWebServerShareSessionByTokenHash(
        database,
        hashWebServerShareOpaqueToken(sessionToken),
      )?.id,
    ).toBe(session.id);
    expect(resolveActiveWebServerShareSession(database, sessionToken)?.id).toBe(
      session.id,
    );

    expect(
      stopWebServerShareByServerInstanceId(database, serverInstanceId),
    ).toBe(true);
    expect(
      getActiveWebServerShareByClaimToken(database, claimToken),
    ).toBeNull();
    expect(
      resolveActiveWebServerShareSession(database, sessionToken),
    ).toBeNull();
  });

  it("claims a share token atomically and rejects reuse", () => {
    const appDataDir = createTempDirectory(
      "metidos-pi-web-server-share-claim-",
    );
    const worktreePath = createTempDirectory(
      "metidos-pi-web-server-share-claim-worktree-",
    );
    process.env.METIDOS_APP_DATA_DIR = appDataDir;

    const database = initAppDatabase();
    const project = upsertProject(database, {
      name: "Claim project",
      projectPath: worktreePath,
    });
    const thread = createThread(database, {
      agentsAccess: false,
      githubAccess: false,
      metidosAccess: true,
      model: DEFAULT_THREAD_MODEL,
      projectId: project.id,
      reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
      title: "Claim thread",
      unsafeMode: false,
      webServerAccess: true,
      worktreePath,
    });
    const claimToken = generateWebServerShareOpaqueToken();
    const serverInstanceId = crypto.randomUUID();
    createWebServerShare(database, {
      claimTokenHash: hashWebServerShareOpaqueToken(claimToken),
      projectId: thread.projectId,
      serverId: 1,
      serverInstanceId,
      targetPort: 43123,
      threadId: thread.id,
      worktreePath,
    });

    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const firstSessionToken = generateWebServerShareOpaqueToken();
    const claimed = claimWebServerShareSession(database, {
      claimToken,
      sessionExpiresAt: expiresAt,
      sessionTokenHash: hashWebServerShareOpaqueToken(firstSessionToken),
    });
    expect(claimed?.threadId).toBe(thread.id);
    expect(
      getActiveWebServerShareByClaimToken(database, claimToken),
    ).toBeNull();
    expect(
      resolveActiveWebServerShareSession(database, firstSessionToken)?.id,
    ).toBeTruthy();

    const secondSessionToken = generateWebServerShareOpaqueToken();
    expect(
      claimWebServerShareSession(database, {
        claimToken,
        sessionExpiresAt: expiresAt,
        sessionTokenHash: hashWebServerShareOpaqueToken(secondSessionToken),
      }),
    ).toBeNull();
    expect(
      resolveActiveWebServerShareSession(database, secondSessionToken),
    ).toBeNull();
  });

  it("rate-limits share-open routes per peer", async () => {
    const appDataDir = createTempDirectory(
      "metidos-pi-web-server-share-open-rate-limit-",
    );
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    initAppDatabase();
    const sharePort = await findFreePort();
    process.env.METIDOS_WEB_SERVER_SHARE_PORT = String(sharePort);
    process.env.METIDOS_WEB_SERVER_SHARE_ORIGIN = `http://127.0.0.1:${sharePort}`;
    await startPiWebServerShareWorker({
      dbPath: getAppDatabasePath({ appDataDir }),
      port: sharePort,
      secureCookies: false,
    });

    const openUrl = `http://127.0.0.1:${sharePort}/share/open`;
    let response = new Response(null, { status: 500 });
    for (let index = 0; index < 31; index += 1) {
      response = await fetch(openUrl, { redirect: "manual" });
    }

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(await response.text()).toContain("Too many share-open requests");

    const clientScriptResponse = await fetch(
      `http://127.0.0.1:${sharePort}/share/open/client.js`,
    );
    expect(clientScriptResponse.status).toBe(200);
  });

  it("claims a share URL into a cookie-backed session, proxies assets, and denies bare route access", async () => {
    const appDataDir = createTempDirectory("metidos-pi-web-server-share-app-");
    const worktreePath = createTempDirectory(
      "metidos-pi-web-server-share-worktree-",
    );
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    initAppDatabase();
    const sharePort = await findFreePort();
    process.env.METIDOS_WEB_SERVER_SHARE_PORT = String(sharePort);
    process.env.METIDOS_WEB_SERVER_SHARE_ORIGIN = `http://127.0.0.1:${sharePort}`;
    await startPiWebServerShareWorker({
      dbPath: getAppDatabasePath({ appDataDir }),
      port: sharePort,
      secureCookies: false,
    });

    const sitePath = join(worktreePath, "site");
    mkdirSync(join(sitePath, "assets"), {
      recursive: true,
    });
    writeFileSync(
      join(sitePath, "index.html"),
      "<html><body>hello stable share</body></html>",
      "utf8",
    );
    writeFileSync(
      join(sitePath, "assets", "style.css"),
      "body{color:red}",
      "utf8",
    );
    const outsidePath = createTempDirectory(
      "metidos-pi-web-server-share-outside-",
    );
    writeFileSync(join(outsidePath, "secret.txt"), "outside secret", "utf8");
    symlinkSync(join(outsidePath, "secret.txt"), join(sitePath, "secret.txt"));

    const { tools } = createThreadScopedWebServerTools(worktreePath);
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
      id: number;
      port: number;
      serverInstanceId: string;
      shareOpenUrl: string;
      shareRouteUrl: string;
    };
    const claimToken = new URLSearchParams(
      new URL(hostedDetails.shareOpenUrl).hash.slice(1),
    ).get("claimToken");
    expect(claimToken).toBeTruthy();

    expect(resultText(hosted)).toContain("- Preferred share link: [");
    expect(resultText(hosted)).toContain(hostedDetails.shareOpenUrl);
    expect(resultText(hosted).indexOf(hostedDetails.shareOpenUrl)).toBeLessThan(
      resultText(hosted).indexOf(`http://127.0.0.1:${hostedDetails.port}/`),
    );
    expect(hostedDetails.serverInstanceId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(new URL(hostedDetails.shareOpenUrl).hash).toBe(
      `#claimToken=${claimToken}`,
    );
    const openPageResponse = await fetch(hostedDetails.shareOpenUrl);
    expect(openPageResponse.status).toBe(200);
    const openPageHtml = await openPageResponse.text();
    expect(openPageResponse.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    expect(
      openPageResponse.headers.get("content-security-policy"),
    ).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(openPageHtml).toContain('src="/share/open/client.js"');
    expect(openPageHtml).not.toContain("sessionStorage");

    const openClientScript = await fetch(
      new URL("/share/open/client.js", hostedDetails.shareOpenUrl),
    );
    expect(openClientScript.status).toBe(200);
    expect(openClientScript.headers.get("content-type")).toContain(
      "application/javascript",
    );
    expect(await openClientScript.text()).toContain("location.hash");

    const denied = await fetch(hostedDetails.shareRouteUrl, {
      redirect: "manual",
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain("share session");

    const { cookie, redirectUrl } = await claimShareSession(
      hostedDetails.shareOpenUrl,
    );
    expect(new URL(redirectUrl).pathname).toBe(
      new URL(hostedDetails.shareRouteUrl).pathname,
    );

    const claimed = await fetch(redirectUrl, {
      headers: {
        Cookie: cookie,
      },
      redirect: "manual",
    });
    expect(claimed.status).toBe(200);
    expect(await claimed.text()).toContain("hello stable share");

    const assetResponse = await fetch(
      new URL("assets/style.css", hostedDetails.shareRouteUrl),
      {
        headers: {
          Cookie: cookie,
        },
        redirect: "manual",
      },
    );
    expect(assetResponse.status).toBe(200);
    expect(await assetResponse.text()).toContain("color:red");

    const symlinkResponse = await fetch(
      new URL("secret.txt", hostedDetails.shareRouteUrl),
      {
        headers: {
          Cookie: cookie,
        },
        redirect: "manual",
      },
    );
    expect(symlinkResponse.status).toBe(404);
    expect(await symlinkResponse.text()).not.toContain("outside secret");
  });

  it("rewrites localhost upstream redirects back through the share route", async () => {
    const appDataDir = createTempDirectory(
      "metidos-pi-web-server-share-redirect-",
    );
    const worktreePath = createTempDirectory(
      "metidos-pi-web-server-share-redirect-worktree-",
    );
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    initAppDatabase();
    const sharePort = await findFreePort();
    process.env.METIDOS_WEB_SERVER_SHARE_PORT = String(sharePort);
    process.env.METIDOS_WEB_SERVER_SHARE_ORIGIN = `http://127.0.0.1:${sharePort}`;
    await startPiWebServerShareWorker({
      dbPath: getAppDatabasePath({ appDataDir }),
      port: sharePort,
      secureCookies: false,
    });

    let upstreamPort = 0;
    let observedAuthorization: string | null = null;
    let observedApiKey: string | null = null;
    let observedCookie: string | null = null;
    let observedForwardedFor = "";
    let expectedServerInstanceId = "";
    const upstreamServer = Bun.serve({
      fetch: (request) => {
        observedAuthorization = request.headers.get("authorization");
        observedApiKey = request.headers.get("x-api-key");
        observedCookie = request.headers.get("cookie");
        observedForwardedFor = request.headers.get("x-forwarded-for") ?? "";
        const requestUrl = new URL(request.url);
        if (requestUrl.pathname !== "/redirect") {
          return new Response("unexpected upstream route", {
            status: 404,
          });
        }
        return new Response(null, {
          headers: {
            "cache-control": "public, max-age=30",
            "clear-site-data": '"cookies"',
            "content-security-policy-report-only": "default-src *",
            link: "</leaked>; rel=preload",
            location: `http://localhost:${upstreamPort}/next?ok=1#section`,
            "referrer-policy": "unsafe-url",
            "set-cookie": "upstream_session=bad; Path=/",
            "x-upstream-secret": "leak-me",
            [WEB_SERVER_SHARE_UPSTREAM_INSTANCE_HEADER]:
              expectedServerInstanceId,
          },
          status: 302,
        });
      },
      hostname: "127.0.0.1",
      port: 0,
    });
    if (typeof upstreamServer.port !== "number") {
      upstreamServer.stop(true);
      throw new Error("Upstream test server did not report a port.");
    }
    upstreamPort = upstreamServer.port;

    try {
      const database = initAppDatabase();
      const project = upsertProject(database, {
        name: "Redirect share project",
        projectPath: worktreePath,
      });
      const thread = createThread(database, {
        agentsAccess: false,
        githubAccess: false,
        metidosAccess: true,
        model: DEFAULT_THREAD_MODEL,
        projectId: project.id,
        reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
        title: "Redirect share thread",
        unsafeMode: false,
        webServerAccess: true,
        worktreePath,
      });
      const claimToken = generateWebServerShareOpaqueToken();
      const sessionToken = generateWebServerShareOpaqueToken();
      const serverInstanceId = crypto.randomUUID();
      expectedServerInstanceId = serverInstanceId;
      createWebServerShare(database, {
        claimTokenHash: hashWebServerShareOpaqueToken(claimToken),
        projectId: thread.projectId,
        serverId: 7,
        serverInstanceId,
        targetPort: upstreamPort,
        threadId: thread.id,
        worktreePath,
      });
      createWebServerShareSession(database, {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        serverId: 7,
        serverInstanceId,
        sessionTokenHash: hashWebServerShareOpaqueToken(sessionToken),
        threadId: thread.id,
      });

      const routeUrl = `http://127.0.0.1:${sharePort}${buildWebServerShareRoutePath(
        thread.id,
        7,
        "/redirect",
      )}`;
      const response = await fetch(routeUrl, {
        headers: {
          authorization: "Bearer public-side-token",
          Cookie: `${WEB_SERVER_SHARE_COOKIE_NAME}=${sessionToken}; upstream_pref=keep-me`,
          "x-api-key": "public-side-api-key",
        },
        redirect: "manual",
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        `http://127.0.0.1:${sharePort}${buildWebServerShareRoutePath(
          thread.id,
          7,
          "/next",
        )}?ok=1#section`,
      );
      expect(response.headers.get("location")).not.toContain(
        `localhost:${upstreamPort}`,
      );
      expect(response.headers.get("cache-control")).toBe("public, max-age=30");
      expect(response.headers.get("clear-site-data")).toBeNull();
      expect(
        response.headers.get("content-security-policy-report-only"),
      ).toBeNull();
      expect(response.headers.get("link")).toBeNull();
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("x-upstream-secret")).toBeNull();
      expect(observedAuthorization).toBeNull();
      expect(observedApiKey).toBeNull();
      const upstreamObservedCookie = observedCookie as string | null;
      if (upstreamObservedCookie !== null) {
        expect(upstreamObservedCookie).toBe("upstream_pref=keep-me");
        expect(upstreamObservedCookie).not.toContain(
          WEB_SERVER_SHARE_COOKIE_NAME,
        );
      }
      expect(observedForwardedFor).toBe("127.0.0.1");
    } finally {
      upstreamServer.stop(true);
    }
  });

  it("rejects unsafe share proxy paths before forwarding upstream", async () => {
    const appDataDir = createTempDirectory(
      "metidos-pi-web-server-share-path-safety-",
    );
    const worktreePath = createTempDirectory(
      "metidos-pi-web-server-share-path-safety-worktree-",
    );
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    initAppDatabase();
    const sharePort = await findFreePort();
    process.env.METIDOS_WEB_SERVER_SHARE_PORT = String(sharePort);
    process.env.METIDOS_WEB_SERVER_SHARE_ORIGIN = `http://127.0.0.1:${sharePort}`;
    await startPiWebServerShareWorker({
      dbPath: getAppDatabasePath({ appDataDir }),
      port: sharePort,
      secureCookies: false,
    });

    let upstreamRequests = 0;
    let expectedServerInstanceId = "";
    const upstreamServer = Bun.serve({
      fetch: () => {
        upstreamRequests += 1;
        return new Response("unexpected unsafe path", {
          headers: {
            [WEB_SERVER_SHARE_UPSTREAM_INSTANCE_HEADER]:
              expectedServerInstanceId,
          },
          status: 200,
        });
      },
      hostname: "127.0.0.1",
      port: 0,
    });
    if (typeof upstreamServer.port !== "number") {
      upstreamServer.stop(true);
      throw new Error("Upstream test server did not report a port.");
    }

    try {
      const database = initAppDatabase();
      const project = upsertProject(database, {
        name: "Path safety share project",
        projectPath: worktreePath,
      });
      const thread = createThread(database, {
        agentsAccess: false,
        githubAccess: false,
        metidosAccess: true,
        model: DEFAULT_THREAD_MODEL,
        projectId: project.id,
        reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
        title: "Path safety share thread",
        unsafeMode: false,
        webServerAccess: true,
        worktreePath,
      });
      const sessionToken = generateWebServerShareOpaqueToken();
      const serverInstanceId = crypto.randomUUID();
      expectedServerInstanceId = serverInstanceId;
      createWebServerShare(database, {
        claimTokenHash: hashWebServerShareOpaqueToken(
          generateWebServerShareOpaqueToken(),
        ),
        projectId: thread.projectId,
        serverId: 9,
        serverInstanceId,
        targetPort: upstreamServer.port,
        threadId: thread.id,
        worktreePath,
      });
      createWebServerShareSession(database, {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        serverId: 9,
        serverInstanceId,
        sessionTokenHash: hashWebServerShareOpaqueToken(sessionToken),
        threadId: thread.id,
      });

      const cookie = `${WEB_SERVER_SHARE_COOKIE_NAME}=${sessionToken}`;
      const traversalResponse = await rawHttpGet(
        sharePort,
        `/s/${thread.id}/9/../../escape`,
        { Cookie: cookie },
      );
      expect(traversalResponse).toStartWith("HTTP/1.1 404");
      expect(traversalResponse).toContain("Not found.");

      const emptySegmentResponse = await fetch(
        `http://127.0.0.1:${sharePort}/s/${thread.id}/9/assets//style.css`,
        {
          headers: { Cookie: cookie },
          redirect: "manual",
        },
      );
      expect(emptySegmentResponse.status).toBe(404);
      expect(await emptySegmentResponse.text()).toContain("Not found.");
      expect(upstreamRequests).toBe(0);
    } finally {
      upstreamServer.stop(true);
    }
  });

  it("times out hung upstream share proxy fetches", async () => {
    const appDataDir = createTempDirectory(
      "metidos-pi-web-server-share-fetch-timeout-",
    );
    const worktreePath = createTempDirectory(
      "metidos-pi-web-server-share-fetch-timeout-worktree-",
    );
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    initAppDatabase();
    const sharePort = await findFreePort();
    process.env.METIDOS_WEB_SERVER_SHARE_PORT = String(sharePort);
    process.env.METIDOS_WEB_SERVER_SHARE_ORIGIN = `http://127.0.0.1:${sharePort}`;
    await startPiWebServerShareWorker({
      dbPath: getAppDatabasePath({ appDataDir }),
      outboundFetchTimeoutMs: 25,
      port: sharePort,
      secureCookies: false,
    });

    const upstreamServer = Bun.serve({
      fetch: () => new Promise<Response>(() => {}),
      hostname: "127.0.0.1",
      port: 0,
    });
    if (typeof upstreamServer.port !== "number") {
      upstreamServer.stop(true);
      throw new Error("Upstream test server did not report a port.");
    }

    try {
      const database = initAppDatabase();
      const project = upsertProject(database, {
        name: "Fetch timeout share project",
        projectPath: worktreePath,
      });
      const thread = createThread(database, {
        agentsAccess: false,
        githubAccess: false,
        metidosAccess: true,
        model: DEFAULT_THREAD_MODEL,
        projectId: project.id,
        reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
        title: "Fetch timeout share thread",
        unsafeMode: false,
        webServerAccess: true,
        worktreePath,
      });
      const sessionToken = generateWebServerShareOpaqueToken();
      const serverInstanceId = crypto.randomUUID();
      createWebServerShare(database, {
        claimTokenHash: hashWebServerShareOpaqueToken(
          generateWebServerShareOpaqueToken(),
        ),
        projectId: thread.projectId,
        serverId: 10,
        serverInstanceId,
        targetPort: upstreamServer.port,
        threadId: thread.id,
        worktreePath,
      });
      createWebServerShareSession(database, {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        serverId: 10,
        serverInstanceId,
        sessionTokenHash: hashWebServerShareOpaqueToken(sessionToken),
        threadId: thread.id,
      });

      const routeUrl = `http://127.0.0.1:${sharePort}${buildWebServerShareRoutePath(
        thread.id,
        10,
        "/hung",
      )}`;
      const response = await fetch(routeUrl, {
        headers: {
          Cookie: `${WEB_SERVER_SHARE_COOKIE_NAME}=${sessionToken}`,
        },
        redirect: "manual",
      });

      expect(response.status).toBe(502);
      expect(await response.text()).toContain("temporarily unavailable");
    } finally {
      upstreamServer.stop(true);
    }
  });

  it("rejects upstream responses with oversized content lengths", async () => {
    const appDataDir = createTempDirectory(
      "metidos-pi-web-server-share-response-limit-",
    );
    const worktreePath = createTempDirectory(
      "metidos-pi-web-server-share-response-limit-worktree-",
    );
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    initAppDatabase();
    const sharePort = await findFreePort();
    process.env.METIDOS_WEB_SERVER_SHARE_PORT = String(sharePort);
    process.env.METIDOS_WEB_SERVER_SHARE_ORIGIN = `http://127.0.0.1:${sharePort}`;
    await startPiWebServerShareWorker({
      dbPath: getAppDatabasePath({ appDataDir }),
      maxProxyResponseBodyBytes: 4,
      port: sharePort,
      secureCookies: false,
    });

    let expectedServerInstanceId = "";
    const upstreamServer = Bun.serve({
      fetch: () =>
        new Response("too large", {
          headers: {
            [WEB_SERVER_SHARE_UPSTREAM_INSTANCE_HEADER]:
              expectedServerInstanceId,
          },
          status: 200,
        }),
      hostname: "127.0.0.1",
      port: 0,
    });
    if (typeof upstreamServer.port !== "number") {
      upstreamServer.stop(true);
      throw new Error("Upstream test server did not report a port.");
    }

    try {
      const database = initAppDatabase();
      const project = upsertProject(database, {
        name: "Response limit share project",
        projectPath: worktreePath,
      });
      const thread = createThread(database, {
        agentsAccess: false,
        githubAccess: false,
        metidosAccess: true,
        model: DEFAULT_THREAD_MODEL,
        projectId: project.id,
        reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
        title: "Response limit share thread",
        unsafeMode: false,
        webServerAccess: true,
        worktreePath,
      });
      const sessionToken = generateWebServerShareOpaqueToken();
      const serverInstanceId = crypto.randomUUID();
      expectedServerInstanceId = serverInstanceId;
      createWebServerShare(database, {
        claimTokenHash: hashWebServerShareOpaqueToken(
          generateWebServerShareOpaqueToken(),
        ),
        projectId: thread.projectId,
        serverId: 8,
        serverInstanceId,
        targetPort: upstreamServer.port,
        threadId: thread.id,
        worktreePath,
      });
      createWebServerShareSession(database, {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        serverId: 8,
        serverInstanceId,
        sessionTokenHash: hashWebServerShareOpaqueToken(sessionToken),
        threadId: thread.id,
      });

      const routeUrl = `http://127.0.0.1:${sharePort}${buildWebServerShareRoutePath(
        thread.id,
        8,
        "/large",
      )}`;
      const response = await fetch(routeUrl, {
        headers: {
          Cookie: `${WEB_SERVER_SHARE_COOKIE_NAME}=${sessionToken}`,
        },
        redirect: "manual",
      });

      expect(response.status).toBe(502);
      expect(await response.text()).toContain("response body is too large");
    } finally {
      upstreamServer.stop(true);
    }
  });

  it("aborts upstream response streams that exceed the body limit without content length", async () => {
    const appDataDir = createTempDirectory(
      "metidos-pi-web-server-share-stream-limit-",
    );
    const worktreePath = createTempDirectory(
      "metidos-pi-web-server-share-stream-limit-worktree-",
    );
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    initAppDatabase();
    const sharePort = await findFreePort();
    process.env.METIDOS_WEB_SERVER_SHARE_PORT = String(sharePort);
    process.env.METIDOS_WEB_SERVER_SHARE_ORIGIN = `http://127.0.0.1:${sharePort}`;
    await startPiWebServerShareWorker({
      dbPath: getAppDatabasePath({ appDataDir }),
      maxProxyResponseBodyBytes: 4,
      port: sharePort,
      secureCookies: false,
    });

    let expectedServerInstanceId = "";
    const upstreamServer = Bun.serve({
      fetch: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start: (controller) => {
              controller.enqueue(new TextEncoder().encode("12345"));
            },
          }),
          {
            headers: {
              [WEB_SERVER_SHARE_UPSTREAM_INSTANCE_HEADER]:
                expectedServerInstanceId,
            },
            status: 200,
          },
        ),
      hostname: "127.0.0.1",
      port: 0,
    });
    if (typeof upstreamServer.port !== "number") {
      upstreamServer.stop(true);
      throw new Error("Upstream test server did not report a port.");
    }

    try {
      const database = initAppDatabase();
      const project = upsertProject(database, {
        name: "Streaming response limit share project",
        projectPath: worktreePath,
      });
      const thread = createThread(database, {
        agentsAccess: false,
        githubAccess: false,
        metidosAccess: true,
        model: DEFAULT_THREAD_MODEL,
        projectId: project.id,
        reasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
        title: "Streaming response limit share thread",
        unsafeMode: false,
        webServerAccess: true,
        worktreePath,
      });
      const sessionToken = generateWebServerShareOpaqueToken();
      const serverInstanceId = crypto.randomUUID();
      expectedServerInstanceId = serverInstanceId;
      createWebServerShare(database, {
        claimTokenHash: hashWebServerShareOpaqueToken(
          generateWebServerShareOpaqueToken(),
        ),
        projectId: thread.projectId,
        serverId: 12,
        serverInstanceId,
        targetPort: upstreamServer.port,
        threadId: thread.id,
        worktreePath,
      });
      createWebServerShareSession(database, {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        serverId: 12,
        serverInstanceId,
        sessionTokenHash: hashWebServerShareOpaqueToken(sessionToken),
        threadId: thread.id,
      });

      const routeUrl = `http://127.0.0.1:${sharePort}${buildWebServerShareRoutePath(
        thread.id,
        12,
        "/stream-large",
      )}`;
      const response = await fetch(routeUrl, {
        headers: {
          Cookie: `${WEB_SERVER_SHARE_COOKIE_NAME}=${sessionToken}`,
        },
        redirect: "manual",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBeNull();
      expect(await response.text()).not.toBe("12345");
    } finally {
      upstreamServer.stop(true);
    }
  });

  it("invalidates share sessions after web_server_stop", async () => {
    const appDataDir = createTempDirectory("metidos-pi-web-server-share-stop-");
    const worktreePath = createTempDirectory(
      "metidos-pi-web-server-share-stop-worktree-",
    );
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    initAppDatabase();
    const sharePort = await findFreePort();
    process.env.METIDOS_WEB_SERVER_SHARE_PORT = String(sharePort);
    process.env.METIDOS_WEB_SERVER_SHARE_ORIGIN = `http://127.0.0.1:${sharePort}`;
    await startPiWebServerShareWorker({
      dbPath: getAppDatabasePath({ appDataDir }),
      port: sharePort,
      secureCookies: false,
    });

    const sitePath = join(worktreePath, "site");
    mkdirSync(sitePath, {
      recursive: true,
    });
    writeFileSync(join(sitePath, "index.html"), "stoppable share", "utf8");

    const { tools } = createThreadScopedWebServerTools(worktreePath);
    const hostTool = tools.find((entry) => entry.name === "web_server_host");
    const stopTool = tools.find((entry) => entry.name === "web_server_stop");
    if (!hostTool || !stopTool) {
      throw new Error("Expected web server tools to be registered.");
    }

    const hosted = await hostTool.execute(
      "call-1",
      { path: "site" } as never,
      undefined,
      async () => {},
      { cwd: worktreePath } as never,
    );
    const hostedDetails = hosted.details as {
      id: number;
      shareOpenUrl: string;
      shareRouteUrl: string;
    };
    const { cookie } = await claimShareSession(hostedDetails.shareOpenUrl);

    const stopped = await stopTool.execute(
      "call-2",
      { id: hostedDetails.id } as never,
      undefined,
      async () => {},
      { cwd: worktreePath } as never,
    );
    expect(resultText(stopped)).toBe(`Stopped web server ${hostedDetails.id}.`);

    const routeResponse = await fetch(hostedDetails.shareRouteUrl, {
      headers: {
        Cookie: cookie,
      },
      redirect: "manual",
    });
    expect(routeResponse.status).toBe(403);

    const claimToken = new URLSearchParams(
      new URL(hostedDetails.shareOpenUrl).hash.slice(1),
    ).get("claimToken");
    const openResponse = await fetch(hostedDetails.shareOpenUrl, {
      body: JSON.stringify({ claimToken }),
      headers: {
        "content-type": "application/json",
        origin: new URL(hostedDetails.shareOpenUrl).origin,
      },
      method: "POST",
    });
    expect(openResponse.status).toBe(404);
  });

  it("invalidates share sessions after runtime dispose", async () => {
    const appDataDir = createTempDirectory(
      "metidos-pi-web-server-share-dispose-",
    );
    const worktreePath = createTempDirectory(
      "metidos-pi-web-server-share-dispose-worktree-",
    );
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    initAppDatabase();
    const sharePort = await findFreePort();
    process.env.METIDOS_WEB_SERVER_SHARE_PORT = String(sharePort);
    process.env.METIDOS_WEB_SERVER_SHARE_ORIGIN = `http://127.0.0.1:${sharePort}`;
    await startPiWebServerShareWorker({
      dbPath: getAppDatabasePath({ appDataDir }),
      port: sharePort,
      secureCookies: false,
    });

    const sitePath = join(worktreePath, "site");
    mkdirSync(sitePath, {
      recursive: true,
    });
    writeFileSync(join(sitePath, "index.html"), "disposable share", "utf8");

    const { manager, tools } = createThreadScopedWebServerTools(worktreePath);
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
      shareOpenUrl: string;
      shareRouteUrl: string;
    };
    const { cookie } = await claimShareSession(hostedDetails.shareOpenUrl);

    manager.dispose();

    const routeResponse = await fetch(hostedDetails.shareRouteUrl, {
      headers: {
        Cookie: cookie,
      },
      redirect: "manual",
    });
    expect(routeResponse.status).toBe(403);

    const claimToken = new URLSearchParams(
      new URL(hostedDetails.shareOpenUrl).hash.slice(1),
    ).get("claimToken");
    const openResponse = await fetch(hostedDetails.shareOpenUrl, {
      body: JSON.stringify({ claimToken }),
      headers: {
        "content-type": "application/json",
        origin: new URL(hostedDetails.shareOpenUrl).origin,
      },
      method: "POST",
    });
    expect(openResponse.status).toBe(404);
  });
});
