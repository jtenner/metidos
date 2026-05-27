import {
  atob,
  definePlugin,
  metidos as pluginMetidos,
  type MetidosWebSocketClient,
} from "@metidos/plugin-api";

const CDP_HTTP_BASE = "http://127.0.0.1:9222";
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const MIN_IDLE_TIMEOUT_MS = 60 * 1000;
const MAX_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_TEXT_LENGTH = 20_000;
const MAX_COORDINATE = 100_000;
const MAX_DIMENSION = 10_000;
const SCREENSHOT_DIR = "~/screenshots";
const BLOCKED_CDP_METHODS = new Set([
  "Network.clearBrowserCache",
  "Network.clearBrowserCookies",
  "Network.deleteCookies",
  "Network.getCookies",
  "Network.setCookie",
  "Network.setCookies",
]);

type CdpSession = {
  createdAt: string;
  height: number;
  id: string;
  idleTimeoutMs: number;
  lastUrl: string | undefined;
  lastUsedAt: string;
  lastUsedAtMs: number;
  nextMessageId: number;
  ownerKey: string;
  socket: MetidosWebSocketClient;
  targetId: string | undefined;
  title: string | undefined;
  webSocketDebuggerUrl: string;
  width: number;
};

type BrowserOpenProps = {
  height: number;
  idleTimeoutMs: number;
  sessionId: string | undefined;
  url: string;
  waitUntilLoad: boolean;
  width: number;
};

type SessionProps = {
  sessionId: string;
};

type NavigateProps = SessionProps & {
  url: string;
  waitUntilLoad: boolean;
};

type ScreenshotProps = SessionProps & {
  format: "jpeg" | "png";
  fullPage: boolean;
  quality: number | undefined;
};

type TypeProps = SessionProps & {
  text: string;
};

type KeyProps = SessionProps & {
  key: string;
  modifiers: number;
};

type ClickProps = SessionProps & {
  button: "left" | "middle" | "right";
  clickCount: number;
  x: number;
  y: number;
};

type ResizeProps = SessionProps & {
  height: number;
  width: number;
};

type EvalProps = SessionProps & {
  expression: string;
  awaitPromise: boolean;
};

type CdpProps = SessionProps & {
  method: string;
  params: Record<string, unknown>;
};

type CloseProps = {
  all: boolean;
  sessionId: string | undefined;
};

type StatusProps = {
  includeChromeTargets: boolean;
};

type PageMarkdownProps = SessionProps;

type CdpResponse = {
  error?: { code?: number; message?: string };
  id?: number;
  result?: unknown;
};

type ChromeTarget = {
  id?: string;
  title?: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

const sessions = new Map<string, CdpSession>();

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringProp(
  record: Record<string, unknown>,
  key: string,
  fallback = "",
): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : fallback;
}

function boolProp(
  record: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function intProp(input: {
  fallback: number;
  key: string;
  max: number;
  min: number;
  record: Record<string, unknown>;
}): number {
  const value = input.record[input.key];
  const number = typeof value === "number" ? Math.trunc(value) : input.fallback;
  if (!Number.isFinite(number) || number < input.min || number > input.max) {
    throw new Error(
      `${input.key} must be an integer from ${input.min} to ${input.max}.`,
    );
  }
  return number;
}

function requireSessionId(record: Record<string, unknown>): string {
  const sessionId = stringProp(record, "sessionId");
  if (!sessionId) {
    throw new Error("sessionId is required.");
  }
  return sessionId.slice(0, 80);
}

function requireUrl(record: Record<string, unknown>): string {
  const url = stringProp(record, "url");
  if (!url) {
    throw new Error("url is required.");
  }
  if (!/^https?:\/\/[^\s]+$/iu.test(url)) {
    throw new Error("url must use http or https.");
  }
  return url;
}

function safeSessionId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function makeSessionId(): string {
  return `browser_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function newUniqueSessionId(): string {
  let sessionId = makeSessionId();
  while (sessions.has(sessionId)) {
    sessionId = makeSessionId();
  }
  return sessionId;
}

function contextNumber(context: unknown, key: string): number | undefined {
  if (!isRecord(context)) {
    return undefined;
  }
  const value = context[key];
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function contextString(context: unknown, key: string): string | undefined {
  if (!isRecord(context)) {
    return undefined;
  }
  const value = context[key];
  return typeof value === "string" && value ? value : undefined;
}

function ownerKeyForContext(context: unknown): string {
  const threadId = contextNumber(context, "threadId");
  if (threadId !== undefined) {
    const ownerUserId = contextNumber(context, "ownerUserId");
    const projectId = contextNumber(context, "projectId");
    return [
      "thread",
      ownerUserId === undefined ? "unknown_user" : ownerUserId,
      projectId === undefined ? "unknown_project" : projectId,
      threadId,
    ].join(":");
  }

  const worktreePath = contextString(context, "worktreePath");
  if (worktreePath) {
    const ownerUserId = contextNumber(context, "ownerUserId");
    const projectId = contextNumber(context, "projectId");
    return [
      "worktree",
      ownerUserId === undefined ? "unknown_user" : ownerUserId,
      projectId === undefined ? "unknown_project" : projectId,
      worktreePath,
    ].join(":");
  }

  return "unknown_context";
}

function touchSession(session: CdpSession): void {
  const now = Date.now();
  session.lastUsedAtMs = now;
  session.lastUsedAt = new Date(now).toISOString();
}

function assertSessionOwner(session: CdpSession, ownerKey: string): void {
  if (session.ownerKey !== ownerKey) {
    throw new Error(
      `Browser session ${session.id} belongs to a different thread context.`,
    );
  }
}

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function screenshotPath(sessionId: string, format: "jpeg" | "png"): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${SCREENSHOT_DIR}/${safeSessionId(sessionId) || "browser"}-${timestamp}.${format === "jpeg" ? "jpg" : "png"}`;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function fetchJson(
  path: string,
  options?: { method?: string },
): Promise<unknown> {
  const response = await pluginMetidos.fetch(`${CDP_HTTP_BASE}${path}`, {
    method: options?.method ?? "GET",
  });
  if (!response.ok) {
    throw new Error(
      `Chrome CDP HTTP ${path} failed: ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}

async function cdpCall(
  session: CdpSession,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const id = session.nextMessageId;
  session.nextMessageId += 1;
  await session.socket.sendText(
    JSON.stringify({ id, method, params: params ?? {} }),
  );

  while (true) {
    const event = await session.socket.receive({ timeoutMs: 30_000 });
    if (event.type === "close") {
      sessions.delete(session.id);
      throw new Error(
        `Chrome session ${session.id} closed: ${event.reason || event.code}`,
      );
    }
    if (event.type === "error") {
      throw new Error(
        `Chrome session ${session.id} websocket error: ${event.message}`,
      );
    }

    const message = JSON.parse(event.text) as CdpResponse;
    if (message.id !== id) {
      continue;
    }
    if (message.error) {
      throw new Error(
        `CDP ${method} failed: ${message.error.message ?? message.error.code ?? "unknown error"}`,
      );
    }
    return message.result;
  }
}

function getSession(sessionId: string, ownerKey: string): CdpSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown browser session: ${sessionId}`);
  }
  assertSessionOwner(session, ownerKey);
  touchSession(session);
  return session;
}

async function cleanupExpiredSessions(): Promise<string[]> {
  const now = Date.now();
  const expired = Array.from(sessions.values()).filter(
    (session) => now - session.lastUsedAtMs > session.idleTimeoutMs,
  );
  const closed: string[] = [];
  for (const session of expired) {
    await closeSession(session);
    closed.push(session.id);
  }
  return closed;
}

async function cleanupScreenshots(): Promise<{ deleted: number }> {
  const screenshotPaths = new Set<string>();
  for (const pattern of ["*.png", "*.jpg", "*.jpeg"]) {
    for (const path of await pluginMetidos.fs.glob(
      `${SCREENSHOT_DIR}/${pattern}`,
    )) {
      screenshotPaths.add(path);
    }
  }
  let deleted = 0;
  for (const path of screenshotPaths) {
    await pluginMetidos.fs.rm(path, { force: true });
    deleted += 1;
  }
  return { deleted };
}

async function waitForLoad(session: CdpSession): Promise<void> {
  await cdpCall(session, "Runtime.evaluate", {
    awaitPromise: true,
    expression:
      "document.readyState === 'complete' ? true : new Promise(resolve => window.addEventListener('load', () => resolve(true), { once: true }))",
    returnByValue: true,
  });
}

async function evaluatePageValue(
  session: CdpSession,
  expression: string,
): Promise<unknown> {
  const result = await cdpCall(session, "Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  return isRecord(result) && isRecord(result.result)
    ? result.result.value
    : undefined;
}

async function pageHtml(session: CdpSession): Promise<string> {
  const value = await evaluatePageValue(
    session,
    "document.documentElement ? document.documentElement.outerHTML : document.body?.outerHTML ?? ''",
  );
  if (typeof value !== "string") {
    throw new Error("Chrome did not return page HTML.");
  }
  return value;
}

async function updateMetadata(session: CdpSession): Promise<void> {
  const value = await evaluatePageValue(
    session,
    "({ title: document.title, url: location.href })",
  );
  if (isRecord(value)) {
    session.title =
      typeof value.title === "string" ? value.title : session.title;
    session.lastUrl =
      typeof value.url === "string" ? value.url : session.lastUrl;
  }
}

async function createSession(
  props: BrowserOpenProps,
  ownerKey: string,
): Promise<CdpSession> {
  const sessionId = props.sessionId
    ? safeSessionId(props.sessionId)
    : newUniqueSessionId();
  const existing = sessions.get(sessionId);
  if (existing) {
    assertSessionOwner(existing, ownerKey);
    throw new Error(`Browser session ${sessionId} already exists.`);
  }

  const rawTarget = await fetchJson("/json/new?about:blank", {
    method: "PUT",
  });
  if (!isRecord(rawTarget)) {
    throw new Error("Chrome did not return a target object.");
  }
  const target = rawTarget as ChromeTarget;
  if (!target.webSocketDebuggerUrl) {
    throw new Error("Chrome target did not include webSocketDebuggerUrl.");
  }

  const socket = await pluginMetidos.websocket.connect(
    target.webSocketDebuggerUrl,
    {
      timeoutMs: 30_000,
    },
  );
  const session: CdpSession = {
    createdAt: nowIso(),
    height: props.height,
    id: sessionId,
    idleTimeoutMs: props.idleTimeoutMs,
    lastUrl: target.url,
    lastUsedAt: nowIso(),
    lastUsedAtMs: Date.now(),
    nextMessageId: 1,
    ownerKey,
    socket,
    targetId: target.id,
    title: target.title,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    width: props.width,
  };
  sessions.set(session.id, session);

  await cdpCall(session, "Page.enable");
  await cdpCall(session, "Runtime.enable");
  await cdpCall(session, "Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: props.height,
    mobile: false,
    width: props.width,
  });
  await cdpCall(session, "Page.navigate", { url: props.url });
  if (props.waitUntilLoad) {
    await waitForLoad(session);
  }
  await updateMetadata(session);
  return session;
}

async function closeSession(session: CdpSession): Promise<void> {
  sessions.delete(session.id);
  try {
    await session.socket.close(1000, "closed by browser_close");
  } catch {
    // The target may already be gone.
  }
  if (session.targetId) {
    try {
      await fetchJson(`/json/close/${encodeURIComponent(session.targetId)}`);
    } catch {
      // Chrome's close endpoint can fail after the websocket is closed.
    }
  }
}

function validateOpen(input: unknown): BrowserOpenProps {
  const record = isRecord(input) ? input : {};
  const sessionId = stringProp(record, "sessionId");
  return {
    height: intProp({
      fallback: DEFAULT_HEIGHT,
      key: "height",
      max: MAX_DIMENSION,
      min: 100,
      record,
    }),
    idleTimeoutMs: intProp({
      fallback: DEFAULT_IDLE_TIMEOUT_MS,
      key: "idleTimeoutMs",
      max: MAX_IDLE_TIMEOUT_MS,
      min: MIN_IDLE_TIMEOUT_MS,
      record,
    }),
    sessionId: sessionId ? safeSessionId(sessionId) : undefined,
    url: requireUrl(record),
    waitUntilLoad: boolProp(record, "waitUntilLoad", true),
    width: intProp({
      fallback: DEFAULT_WIDTH,
      key: "width",
      max: MAX_DIMENSION,
      min: 100,
      record,
    }),
  };
}

function validateNavigate(input: unknown): NavigateProps {
  const record = isRecord(input) ? input : {};
  return {
    sessionId: requireSessionId(record),
    url: requireUrl(record),
    waitUntilLoad: boolProp(record, "waitUntilLoad", true),
  };
}

function validateScreenshot(input: unknown): ScreenshotProps {
  const record = isRecord(input) ? input : {};
  const quality =
    record.quality === undefined
      ? undefined
      : intProp({ fallback: 80, key: "quality", max: 100, min: 1, record });
  const format = record.format === "jpeg" ? "jpeg" : "png";
  return {
    format,
    fullPage: boolProp(record, "fullPage", false),
    quality: format === "jpeg" ? (quality ?? 80) : undefined,
    sessionId: requireSessionId(record),
  };
}

function validateType(input: unknown): TypeProps {
  const record = isRecord(input) ? input : {};
  const text = stringProp(record, "text").slice(0, MAX_TEXT_LENGTH);
  if (!text) {
    throw new Error("text is required.");
  }
  return { sessionId: requireSessionId(record), text };
}

function validateKey(input: unknown): KeyProps {
  const record = isRecord(input) ? input : {};
  const key = stringProp(record, "key");
  if (!key) {
    throw new Error("key is required.");
  }
  return {
    key: key.slice(0, 80),
    modifiers: intProp({
      fallback: 0,
      key: "modifiers",
      max: 15,
      min: 0,
      record,
    }),
    sessionId: requireSessionId(record),
  };
}

function validateClick(input: unknown): ClickProps {
  const record = isRecord(input) ? input : {};
  const button =
    record.button === "middle" || record.button === "right"
      ? record.button
      : "left";
  return {
    button,
    clickCount: intProp({
      fallback: 1,
      key: "clickCount",
      max: 5,
      min: 1,
      record,
    }),
    sessionId: requireSessionId(record),
    x: intProp({ fallback: 0, key: "x", max: MAX_COORDINATE, min: 0, record }),
    y: intProp({ fallback: 0, key: "y", max: MAX_COORDINATE, min: 0, record }),
  };
}

function validateResize(input: unknown): ResizeProps {
  const record = isRecord(input) ? input : {};
  return {
    height: intProp({
      fallback: DEFAULT_HEIGHT,
      key: "height",
      max: MAX_DIMENSION,
      min: 100,
      record,
    }),
    sessionId: requireSessionId(record),
    width: intProp({
      fallback: DEFAULT_WIDTH,
      key: "width",
      max: MAX_DIMENSION,
      min: 100,
      record,
    }),
  };
}

function validateEval(input: unknown): EvalProps {
  const record = isRecord(input) ? input : {};
  const expression = stringProp(record, "expression").slice(0, MAX_TEXT_LENGTH);
  if (!expression) {
    throw new Error("expression is required.");
  }
  return {
    awaitPromise: boolProp(record, "awaitPromise", true),
    expression,
    sessionId: requireSessionId(record),
  };
}

function validateCdp(input: unknown): CdpProps {
  const record = isRecord(input) ? input : {};
  const method = stringProp(record, "method");
  if (!/^[A-Za-z0-9_.]+$/.test(method)) {
    throw new Error("method must be a Chrome DevTools Protocol method name.");
  }
  if (/^(Browser|Target)\./.test(method)) {
    throw new Error(
      "browser_cdp does not allow Browser.* or Target.* methods because they can affect other sessions.",
    );
  }
  if (BLOCKED_CDP_METHODS.has(method)) {
    throw new Error(
      `browser_cdp does not allow ${method} because shared cache and cookies can affect or expose other sessions.`,
    );
  }
  const params = isRecord(record.params) ? record.params : {};
  return { method, params, sessionId: requireSessionId(record) };
}

function validateClose(input: unknown): CloseProps {
  const record = isRecord(input) ? input : {};
  const sessionId = stringProp(record, "sessionId");
  const all = boolProp(record, "all", !sessionId);
  if (!all && !sessionId) {
    throw new Error("sessionId is required unless all is true.");
  }
  return { all, sessionId: sessionId ? sessionId.slice(0, 80) : undefined };
}

function validateStatus(input: unknown): StatusProps {
  const record = isRecord(input) ? input : {};
  return {
    includeChromeTargets: boolProp(record, "includeChromeTargets", false),
  };
}

function validatePageMarkdown(input: unknown): PageMarkdownProps {
  const record = isRecord(input) ? input : {};
  return { sessionId: requireSessionId(record) };
}

function sessionStatus(session: CdpSession): Record<string, unknown> {
  return {
    createdAt: session.createdAt,
    height: session.height,
    id: session.id,
    idleTimeoutMs: session.idleTimeoutMs,
    lastUsedAt: session.lastUsedAt,
    title: session.title,
    url: session.lastUrl,
    width: session.width,
  };
}

export default definePlugin((metidos) => {
  metidos.gc({
    timeoutMs: 30_000,
    async action() {
      const result = await cleanupScreenshots();
      await metidos.log(
        "info",
        `Browser screenshot GC deleted ${result.deleted} screenshot(s).`,
      );
      return result;
    },
  });

  metidos.addAgentTool({
    tool: "browser_open",
    name: "Browser open",
    description:
      "Open a new managed Chromium session owned by the current thread context. Required: url, an http or https URL. Optional: sessionId to choose a stable session id, width and height viewport integers from 100 to 10000, waitUntilLoad boolean to wait for the page load event, and idleTimeoutMs from 60000 to 3600000, default 900000. Returns the session id for later browser_* calls from the same thread context.",
    timeoutMs: 30_000,
    validateProps: validateOpen,
    async action(context, props) {
      await cleanupExpiredSessions();
      const session = await createSession(props, ownerKeyForContext(context));
      await metidos.log("info", `Opened browser session ${session.id}`);
      return {
        type: "markdown",
        markdown: `Opened browser session \`${session.id}\`.\n\n${jsonText({
          height: session.height,
          idleTimeoutMs: session.idleTimeoutMs,
          title: session.title,
          url: session.lastUrl,
          width: session.width,
        })}`,
      };
    },
  });

  metidos.addAgentTool({
    tool: "browser_navigate",
    name: "Browser navigate",
    description:
      "Navigate an existing browser session owned by the current thread context. Required: sessionId from browser_open and url, an http or https URL. Optional: waitUntilLoad boolean, default true, to wait for the page load event before returning.",
    timeoutMs: 30_000,
    validateProps: validateNavigate,
    async action(context, props) {
      await cleanupExpiredSessions();
      const session = getSession(props.sessionId, ownerKeyForContext(context));
      await cdpCall(session, "Page.navigate", { url: props.url });
      if (props.waitUntilLoad) {
        await waitForLoad(session);
      }
      await updateMetadata(session);
      return {
        type: "text",
        text: `Navigated ${session.id} to ${session.lastUrl ?? props.url}.`,
      };
    },
  });

  metidos.addAgentTool({
    tool: "browser_markdown",
    name: "Browser markdown",
    description:
      "Return Markdown converted from the current page HTML in an existing browser session owned by the current thread context. Required: sessionId. Conversion is host-backed, does not execute page HTML, and rejects inputs over 10 MiB.",
    timeoutMs: 30_000,
    validateProps: validatePageMarkdown,
    async action(context, props) {
      await cleanupExpiredSessions();
      const session = getSession(props.sessionId, ownerKeyForContext(context));
      const html = await pageHtml(session);
      const markdown = pluginMetidos.html.toMarkdown(html);
      await updateMetadata(session);
      return { type: "markdown", markdown };
    },
  });

  metidos.addAgentTool({
    tool: "browser_screenshot",
    name: "Browser screenshot",
    description:
      "Capture a screenshot from a browser session owned by the current thread context and return it as an image file. Required: sessionId. Optional: format, either png or jpeg, default png; fullPage boolean, default false; quality integer from 1 to 100 for jpeg only.",
    timeoutMs: 30_000,
    validateProps: validateScreenshot,
    async action(context, props) {
      await cleanupExpiredSessions();
      const session = getSession(props.sessionId, ownerKeyForContext(context));
      const result = await cdpCall(session, "Page.captureScreenshot", {
        captureBeyondViewport: props.fullPage,
        format: props.format,
        fromSurface: true,
        quality: props.quality,
      });
      if (!isRecord(result) || typeof result.data !== "string") {
        throw new Error("Chrome did not return screenshot data.");
      }
      await metidos.fs.mkdir(SCREENSHOT_DIR, { recursive: true });
      const path = screenshotPath(session.id, props.format);
      await metidos.fs.write(path, base64ToBytes(result.data));
      await updateMetadata(session);
      return {
        alt: `Screenshot of ${session.lastUrl ?? session.id}`,
        mimeType: props.format === "jpeg" ? "image/jpeg" : "image/png",
        path,
        type: "image:file",
      };
    },
  });

  metidos.addAgentTool({
    tool: "browser_type",
    name: "Browser type",
    description:
      "Type text into the currently focused element in a browser session owned by the current thread context. Required: sessionId and text. Focus an element first with browser_click or JavaScript evaluation when needed. Text is inserted as literal text, not keyboard shortcuts.",
    timeoutMs: 15_000,
    validateProps: validateType,
    async action(context, props) {
      await cleanupExpiredSessions();
      await cdpCall(
        getSession(props.sessionId, ownerKeyForContext(context)),
        "Input.insertText",
        {
          text: props.text,
        },
      );
      return { type: "text", text: `Typed ${props.text.length} characters.` };
    },
  });

  metidos.addAgentTool({
    tool: "browser_key",
    name: "Browser key",
    description:
      "Send one key press or keyboard shortcut to a browser session owned by the current thread context. Required: sessionId and key, such as Enter, Tab, Escape, Backspace, ArrowDown, or a single character. Optional: modifiers CDP bitmask, where Alt=1, Ctrl=2, Meta=4, Shift=8.",
    timeoutMs: 15_000,
    validateProps: validateKey,
    async action(context, props) {
      await cleanupExpiredSessions();
      const session = getSession(props.sessionId, ownerKeyForContext(context));
      await cdpCall(session, "Input.dispatchKeyEvent", {
        key: props.key,
        modifiers: props.modifiers,
        text: props.key.length === 1 ? props.key : undefined,
        type: "keyDown",
      });
      await cdpCall(session, "Input.dispatchKeyEvent", {
        key: props.key,
        modifiers: props.modifiers,
        type: "keyUp",
      });
      return { type: "text", text: `Sent key ${props.key}.` };
    },
  });

  metidos.addAgentTool({
    tool: "browser_click",
    name: "Browser click",
    description:
      "Click at viewport coordinates in a browser session owned by the current thread context. Required: sessionId, x, and y integer coordinates relative to the top-left of the viewport. Optional: button left, middle, or right, default left; clickCount integer from 1 to 5, default 1.",
    timeoutMs: 15_000,
    validateProps: validateClick,
    async action(context, props) {
      await cleanupExpiredSessions();
      const session = getSession(props.sessionId, ownerKeyForContext(context));
      const params = {
        button: props.button,
        clickCount: props.clickCount,
        x: props.x,
        y: props.y,
      };
      await cdpCall(session, "Input.dispatchMouseEvent", {
        ...params,
        type: "mousePressed",
      });
      await cdpCall(session, "Input.dispatchMouseEvent", {
        ...params,
        type: "mouseReleased",
      });
      return { type: "text", text: `Clicked ${props.x},${props.y}.` };
    },
  });

  metidos.addAgentTool({
    tool: "browser_resize",
    name: "Browser resize",
    description:
      "Resize the viewport for a browser session owned by the current thread context. Required: sessionId, width, and height integers from 100 to 10000. The viewport uses deviceScaleFactor 1 and desktop, non-mobile emulation.",
    timeoutMs: 15_000,
    validateProps: validateResize,
    async action(context, props) {
      await cleanupExpiredSessions();
      const session = getSession(props.sessionId, ownerKeyForContext(context));
      await cdpCall(session, "Emulation.setDeviceMetricsOverride", {
        deviceScaleFactor: 1,
        height: props.height,
        mobile: false,
        width: props.width,
      });
      session.width = props.width;
      session.height = props.height;
      return {
        type: "text",
        text: `Resized ${session.id} to ${props.width}x${props.height}.`,
      };
    },
  });

  metidos.addAgentTool({
    tool: "browser_eval",
    name: "Browser eval",
    description:
      "Evaluate JavaScript in the page for a browser session owned by the current thread context and return the CDP Runtime.evaluate result as JSON. Required: sessionId and expression JavaScript source. Optional: awaitPromise boolean, default true. Prefer returning JSON-serializable values.",
    timeoutMs: 15_000,
    validateProps: validateEval,
    async action(context, props) {
      await cleanupExpiredSessions();
      const result = await cdpCall(
        getSession(props.sessionId, ownerKeyForContext(context)),
        "Runtime.evaluate",
        {
          awaitPromise: props.awaitPromise,
          expression: props.expression,
          returnByValue: true,
        },
      );
      return {
        type: "markdown",
        markdown: `\`\`\`json\n${jsonText(result)}\n\`\`\``,
      };
    },
  });

  metidos.addAgentTool({
    tool: "browser_cdp",
    name: "Browser CDP",
    description:
      "Call a raw Chrome DevTools Protocol method on a browser session owned by the current thread context. Required: sessionId and method, such as Runtime.evaluate or DOM.getDocument. Optional: params object for the method arguments. Browser.* and Target.* methods are rejected, and shared cache/cookie methods are rejected: Network.clearBrowserCache, Network.clearBrowserCookies, Network.getCookies, Network.setCookie, Network.setCookies, and Network.deleteCookies. Use this for advanced page-scoped CDP features not covered by the higher-level tools.",
    timeoutMs: 15_000,
    validateProps: validateCdp,
    async action(context, props) {
      await cleanupExpiredSessions();
      const result = await cdpCall(
        getSession(props.sessionId, ownerKeyForContext(context)),
        props.method,
        props.params,
      );
      return {
        type: "markdown",
        markdown: `\`\`\`json\n${jsonText(result)}\n\`\`\``,
      };
    },
  });

  metidos.addAgentTool({
    tool: "browser_status",
    name: "Browser status",
    description:
      "List browser sessions owned by the current thread context and Chrome version/status. Optional: includeChromeTargets boolean, default false, to also include the raw current CDP target list. Use this to discover your active session ids, dimensions, titles, URLs, and idle timeouts before acting on a session.",
    timeoutMs: 10_000,
    validateProps: validateStatus,
    async action(context, props) {
      const expiredSessions = await cleanupExpiredSessions();
      const ownerKey = ownerKeyForContext(context);
      const version = await fetchJson("/json/version");
      const targets = props.includeChromeTargets
        ? await fetchJson("/json/list")
        : undefined;
      return {
        type: "markdown",
        markdown: `\`\`\`json\n${jsonText({
          expiredSessions,
          managedSessions: Array.from(sessions.values())
            .filter((session) => session.ownerKey === ownerKey)
            .map(sessionStatus),
          ...(targets === undefined ? {} : { targets }),
          version,
        })}\n\`\`\``,
      };
    },
  });

  metidos.addAgentTool({
    tool: "browser_close",
    name: "Browser close",
    description:
      "Close browser sessions owned by the current thread context. Required: sessionId to close one session unless all is true. Optional: all boolean; when true, closes every managed session owned by the current thread context only and ignores sessionId. It will not close sessions owned by other threads.",
    timeoutMs: 10_000,
    validateProps: validateClose,
    async action(context, props) {
      await cleanupExpiredSessions();
      const ownerKey = ownerKeyForContext(context);
      const closed: string[] = [];
      const selected = props.all
        ? Array.from(sessions.values()).filter(
            (session) => session.ownerKey === ownerKey,
          )
        : [getSession(props.sessionId ?? "", ownerKey)];
      for (const session of selected) {
        await closeSession(session);
        closed.push(session.id);
      }
      return {
        type: "text",
        text: `Closed ${closed.length} browser session(s): ${closed.join(", ")}`,
      };
    },
  });
});
