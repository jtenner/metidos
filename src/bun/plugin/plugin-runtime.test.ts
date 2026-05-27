/**
 * @file src/bun/plugin/plugin-runtime.test.ts
 * @description Tests for language-dispatching plugin runtime startup.
 */

import { describe, expect, it } from "bun:test";

import type { PluginEntrypointBuildResult } from "./entrypoint-build";
import {
  getPluginRuntimeAdapter,
  PluginRuntimeError,
  startPluginRuntime,
} from "./plugin-runtime";
import { createPluginPythonExecutionHost } from "./python-runtime";

describe("startPluginRuntime", () => {
  it("selects the documented startup adapters by entrypoint language", () => {
    const javascriptAdapter = getPluginRuntimeAdapter({
      entrypointPath: "/tmp/plugin/main.ts",
      language: "javascript",
      outputCount: 1,
      source: "",
      sourceMap: null,
    });
    const pythonAdapter = getPluginRuntimeAdapter({
      entrypointPath: "/tmp/plugin/main.py",
      language: "python",
      outputCount: 1,
      pythonSource: "",
      source: "",
      sourceMap: null,
    });

    expect(javascriptAdapter.language).toBe("javascript");
    expect(pythonAdapter.language).toBe("python");
  });

  it("rejects unsupported entrypoint languages with a predictable runtime error", async () => {
    const buildResult = {
      entrypointPath: "/tmp/plugin/main.rb",
      language: "ruby",
      outputCount: 1,
      source: "",
      sourceMap: null,
    } as unknown as PluginEntrypointBuildResult;

    expect(() => getPluginRuntimeAdapter(buildResult)).toThrow(
      new PluginRuntimeError("Unsupported plugin entrypoint language: ruby"),
    );
    await expect(startPluginRuntime(buildResult)).rejects.toThrow(
      PluginRuntimeError,
    );
    await expect(startPluginRuntime(buildResult)).rejects.toThrow(
      "Unsupported plugin entrypoint language: ruby",
    );
  });

  it("starts Python entrypoints and invokes registered tool callbacks", async () => {
    const fsRequests: unknown[] = [];
    const buildResult: PluginEntrypointBuildResult = {
      entrypointPath: "/tmp/plugin/main.py",
      language: "python",
      outputCount: 1,
      pythonSource: `
from metidos import add_agent_tool

def validate_props(props):
    return {"message": props.get("message", "hello")}

async def action(context, props):
    from metidos import fs
    note = await fs.readText('~/note.txt')
    return {"type": "text", "text": props["message"] + ' ' + note}

add_agent_tool({
    "tool": "python_hello",
    "name": "Python hello",
    "description": "Return a Python greeting.",
    "timeoutMs": 1000,
    "validateProps": validate_props,
    "action": action,
})
`,
      source: "",
      sourceMap: null,
    };

    const runtime = await startPluginRuntime(buildResult, {
      pluginApi: {
        fs: async (operation, request) => {
          fsRequests.push({ operation, request });
          return "from fs";
        },
      },
    });
    const setup = runtime.setupResult as {
      tools: Array<{ actionHandle: string; validatePropsHandle: string }>;
    };

    expect(setup.tools).toHaveLength(1);
    const [tool] = setup.tools;
    if (!tool) {
      throw new Error("Expected one Python tool registration.");
    }
    const props = await runtime.invokeCallback({
      args: [{ message: "from python" }],
      deadlineMs: Date.now() + 1000,
      handle: tool.validatePropsHandle,
      label: "validate python props",
    });
    await expect(
      runtime.invokeCallback({
        args: [{ contextKind: "threadTool" }, props],
        deadlineMs: Date.now() + 1000,
        handle: tool.actionHandle,
        label: "run python tool",
      }),
    ).resolves.toEqual({ type: "text", text: "from python from fs" });
    expect(fsRequests).toEqual([
      {
        operation: "fs.readText",
        request: {
          context: { contextKind: "threadTool" },
          deadlineMs: expect.any(Number),
          params: { path: "~/note.txt" },
        },
      },
    ]);
  });

  it("exposes declared env, settings, and permissioned log to Python plugins", async () => {
    const logRequests: unknown[] = [];
    const buildResult: PluginEntrypointBuildResult = {
      entrypointPath: "/tmp/plugin/settings.py",
      language: "python",
      outputCount: 1,
      pythonSource: `
from metidos import add_agent_tool, env, log, settings

async def validate_props(props):
    await log("info", env.get("EXAMPLE_TOKEN"))
    return {"mode": settings.get("mode")}

def action(context, props):
    return {"type": "text", "text": props["mode"]}

add_agent_tool({
    "tool": "python_settings",
    "name": "Python settings",
    "description": "Read declared settings.",
    "timeoutMs": 1000,
    "validateProps": validate_props,
    "action": action,
})
`,
      source: "",
      sourceMap: null,
    };

    const runtime = await startPluginRuntime(buildResult, {
      pluginApi: {
        env: [
          {
            key: "EXAMPLE_TOKEN",
            required: true,
            secret: true,
            value: "token-value",
          },
        ],
        log: async (request) => {
          logRequests.push(request);
          return { logged: true };
        },
        permissions: ["log:write"],
        settings: { missingRequiredKeys: [], values: { mode: "safe" } },
      },
    });
    const setup = runtime.setupResult as {
      tools: Array<{ validatePropsHandle: string }>;
    };
    const [tool] = setup.tools;
    if (!tool) {
      throw new Error("Expected one Python tool registration.");
    }

    await expect(
      runtime.invokeCallback({
        args: [{}],
        deadlineMs: Date.now() + 1000,
        handle: tool.validatePropsHandle,
        label: "validate settings",
      }),
    ).resolves.toEqual({ mode: "safe" });
    expect(logRequests).toEqual([
      {
        context: {},
        deadlineMs: expect.any(Number),
        params: { level: "info", message: "token-value" },
      },
    ]);
  });

  it("exposes callback-context host APIs to Python plugins", async () => {
    const hostRequests: unknown[] = [];
    const buildResult: PluginEntrypointBuildResult = {
      entrypointPath: "/tmp/plugin/host-apis.py",
      language: "python",
      outputCount: 1,
      pythonSource: `
from metidos import add_agent_tool, calendar, events, notifications, sqlite, terminal, toml, yaml
import metidos


def validate_props(props):
    return props

async def action(context, props):
    await notifications.send({"title": "Hi", "body": "Body"})
    await calendar.list({"calendarId": "primary"})
    await events.get({"eventId": "evt_1"})
    await terminal.read({"terminalId": "term_1"})
    db = sqlite("~/state.db")
    await db.run("create table items(id text)")
    parsed_toml = toml.parse("mode = 'safe'")
    parsed_yaml = yaml.parse("name: safe")
    return {
        "type": "text",
        "text": metidos.settings.get("nickname") + ":" + parsed_toml.mode + ":" + parsed_yaml.name,
    }

add_agent_tool({
    "tool": "python_host_apis",
    "name": "Python host APIs",
    "description": "Call Python host API bridges.",
    "timeoutMs": 1000,
    "validateProps": validate_props,
    "action": action,
})
`,
      source: "",
      sourceMap: null,
    };

    const runtime = await startPluginRuntime(buildResult, {
      pluginApi: {
        calendarEvents: async (operation, request) => {
          hostRequests.push({ operation, request });
          return { ok: true };
        },
        permissions: [
          "notification:send",
          "calendar:list",
          "events:get",
          "terminal:read",
          "sqlite",
          "storage:write",
        ],
        sendNotification: async (request) => {
          hostRequests.push({ operation: "notifications.send", request });
          return { receipts: [] };
        },
        sqlite: async (operation, request) => {
          hostRequests.push({ operation, request });
          return { changes: 0 };
        },
        terminal: async (operation, request) => {
          hostRequests.push({ operation, request });
          return { output: "" };
        },
        settings: { missingRequiredKeys: [], values: { nickname: "ada" } },
      },
    });
    const setup = runtime.setupResult as {
      tools: Array<{ actionHandle: string; validatePropsHandle: string }>;
    };
    const [tool] = setup.tools;
    if (!tool) {
      throw new Error("Expected one Python tool registration.");
    }

    const callbackResult = await runtime.invokeCallback({
      args: [
        {
          contextKind: "threadTool",
        },
        {},
      ],
      deadlineMs: Date.now() + 1000,
      handle: tool.actionHandle,
      label: "run python host APIs",
    });
    expect(callbackResult).toEqual({ type: "text", text: "ada:safe:safe" });
    expect(
      hostRequests.map(
        (request) => (request as { operation: string }).operation,
      ),
    ).toEqual([
      "notifications.send",
      "calendar.list",
      "events.get",
      "terminal.read",
      "sqlite.run",
    ]);
    expect(hostRequests[0]).toEqual({
      operation: "notifications.send",
      request: expect.objectContaining({
        context: expect.objectContaining({ contextKind: "threadTool" }),
        deadlineMs: expect.any(Number),
        title: "Hi",
      }),
    });
  });

  it("collects Python startup registrations beyond tools", async () => {
    const buildResult: PluginEntrypointBuildResult = {
      entrypointPath: "/tmp/plugin/registrations.py",
      language: "python",
      outputCount: 1,
      pythonSource: `
from metidos import add_agent_tool, cron, notifications, oauth, providers, settings

def validate_props(props):
    return props

async def action(context, props):
    return {"kind": context.get("contextKind"), "props": props}

async def notify(request):
    return [{"status": "delivered"}]

async def refresh(context, props=None):
    return {"token": "refreshed"}

cron({
    "key": "heartbeat",
    "schedule": "*/5 * * * *",
    "timeoutMs": 2000,
    "action": action,
})

async def daily_digest(context):
    return {
        "kind": context.get("contextKind"),
        "ownerUserId": context.get("ownerUserId"),
        "mode": settings.get("mode"),
    }

cron({
    "key": "daily_digest",
    "schedule": "0 6 * * *",
    "timeoutMs": 2000,
    "action": daily_digest,
})

notifications.addProvider({
    "id": "alpha_notify",
    "timeoutMs": 2000,
    "send": notify,
})

oauth.registerProvider({
    "id": "github_oauth",
    "provider": "github",
    "refresh": refresh,
    "timeoutMs": 2000,
})

providers.addProvider({
    "id": "alpha_provider",
    "configurations": [{"id": "default", "label": "Default"}],
    "execute": action,
    "timeoutMs": 2000,
})

add_agent_tool({
    "tool": "python_hello",
    "name": "Python hello",
    "description": "Return a Python greeting.",
    "timeoutMs": 2000,
    "validateProps": validate_props,
    "action": action,
})
`,
      source: "",
      sourceMap: null,
    };

    const runtime = await startPluginRuntime(buildResult, {
      pluginApi: {
        permissions: [
          "cron:create",
          "notification:provider",
          "oauth:register",
          "provider:register",
        ],
        settings: { missingRequiredKeys: [], values: { mode: "daily" } },
      },
    });
    const setup = runtime.setupResult as {
      crons: Array<{ actionHandle: string; key: string }>;
      modelProviders: Array<{ executeHandle?: string; id: string }>;
      notificationProviders: Array<{ id: string; sendHandle: string }>;
      oauthProviders: Array<{ id: string; refreshHandle?: string }>;
      tools: Array<{ actionHandle: string; validatePropsHandle: string }>;
    };

    expect(setup.crons).toEqual([
      expect.objectContaining({
        key: "heartbeat",
        actionHandle: expect.any(String),
      }),
      expect.objectContaining({
        key: "daily_digest",
        actionHandle: expect.any(String),
      }),
    ]);
    expect(setup.notificationProviders).toEqual([
      expect.objectContaining({
        id: "alpha_notify",
        sendHandle: expect.any(String),
      }),
    ]);
    expect(setup.oauthProviders).toEqual([
      expect.objectContaining({
        id: "github_oauth",
        refreshHandle: expect.any(String),
      }),
    ]);
    expect(setup.modelProviders).toEqual([
      expect.objectContaining({
        id: "alpha_provider",
        executeHandle: expect.any(String),
      }),
    ]);
    expect(setup.tools).toEqual([
      expect.objectContaining({
        actionHandle: expect.any(String),
        validatePropsHandle: expect.any(String),
      }),
    ]);

    const [tool] = setup.tools;
    const [provider] = setup.modelProviders;
    const [notificationProvider] = setup.notificationProviders;
    const [oauthProvider] = setup.oauthProviders;
    const userCron = setup.crons.find((cron) => cron.key === "daily_digest");
    if (
      !tool ||
      !provider?.executeHandle ||
      !notificationProvider ||
      !oauthProvider?.refreshHandle ||
      !userCron
    ) {
      throw new Error("Expected Python startup callback handles.");
    }

    await expect(
      runtime.invokeCallback({
        args: [{ ping: true }],
        deadlineMs: Date.now() + 1000,
        handle: tool.validatePropsHandle,
        label: "validate startup registrations",
      }),
    ).resolves.toEqual({ ping: true });
    await expect(
      runtime.invokeCallback({
        args: [{ contextKind: "providerExecution" }, { prompt: "hello" }],
        deadlineMs: Date.now() + 1000,
        handle: provider.executeHandle,
        label: "run python model provider",
      }),
    ).resolves.toEqual({
      kind: "providerExecution",
      props: { prompt: "hello" },
    });
    await expect(
      runtime.invokeCallback({
        args: [{ title: "Build done" }],
        deadlineMs: Date.now() + 1000,
        handle: notificationProvider.sendHandle,
        label: "run python notification provider",
      }),
    ).resolves.toEqual([{ status: "delivered" }]);
    await expect(
      runtime.invokeCallback({
        args: [{ ownerUserId: 7 }],
        deadlineMs: Date.now() + 1000,
        handle: oauthProvider.refreshHandle,
        label: "run python oauth refresh",
      }),
    ).resolves.toEqual({ token: "refreshed" });
    await expect(
      runtime.invokeCallback({
        args: [
          {
            contextKind: "cron",
            ownerUserId: 9,
          },
        ],
        deadlineMs: Date.now() + 1000,
        handle: userCron.actionHandle,
        label: "run python user cron",
      }),
    ).resolves.toEqual({
      kind: "cron",
      mode: "daily",
      ownerUserId: 9,
    });
  });

  it("passes callback context into Python host APIs and general settings", async () => {
    const notificationsRequests: unknown[] = [];
    const calendarRequests: unknown[] = [];
    const terminalRequests: unknown[] = [];
    const sqliteRequests: unknown[] = [];
    const server = Bun.serve({
      fetch: () => Response.json({ ok: true }),
      port: 0,
    });
    const url = `http://localhost:${server.port}/status`;

    try {
      const buildResult: PluginEntrypointBuildResult = {
        entrypointPath: "/tmp/plugin/callbacks.py",
        language: "python",
        outputCount: 1,
        pythonSource: `
from metidos import add_agent_tool, calendar, events, fetch, html, notifications, settings, sqlite, terminal, toml, util, xml, yaml

def validate_props(props):
    return props

async def action(context, props):
    notice = await notifications.send({
        "title": "Build done",
        "message": "The build finished.",
        "tags": ["white_check_mark"],
    })
    calendars = await calendar.list()
    event = await events.get({"eventId": 42})
    read = await terminal.read({"terminalIndex": 0, "lineCount": 5})
    db = sqlite("~/state.sqlite")
    run = await db.run("insert into notes (title) values (?)", ["hello"])
    row = await db.get("select title from notes where id = ?", [1])
    rows = await db.all("select title from notes order by id")
    fetched = await fetch(${JSON.stringify(url)})
    fetched_body = await fetched.text()
    return {
        "apiKey": settings.get("api_key"),
        "calendars": calendars,
        "event": event,
        "fetchedBody": fetched_body,
        "fetchedStatus": fetched.status,
        "fetchedUrl": fetched.url,
        "htmlFromMarkdown": html.fromMarkdown('# Hi\\n\\n<script>alert(1)</script>'),
        "jwtExp": util.decodeJwtExp("eyJhbGciOiJub25lIn0.eyJleHAiOjQyfQ."),
        "markdownFromHtml": html.toMarkdown('<main><h1>Hi</h1><p>Python <strong>plugin</strong></p></main>'),
        "notice": notice,
        "read": read,
        "row": row,
        "rows": rows,
        "run": run,
        "toml": toml.parse("title = \\"Hello\\"\\n"),
        "tomlText": toml.stringify({"title": "Hello"}),
        "xml": xml.parse('<feed><entry id="a"><title>Hi &amp; XML</title></entry></feed>'),
        "xmlText": xml.encode('A&B <tag>'),
        "yaml": yaml.parse("ok: true\\ncount: 2\\n"),
        "yamlText": yaml.stringify({"ok": True}),
    }

add_agent_tool({
    "tool": "python_context",
    "name": "Python context",
    "description": "Expose callback-scoped APIs.",
    "timeoutMs": 2000,
    "validateProps": validate_props,
    "action": action,
})
`,
        source: "",
        sourceMap: null,
      };

      const runtime = await startPluginRuntime(buildResult, {
        pluginApi: {
          calendarEvents: async (operation, request) => {
            calendarRequests.push({ operation, request });
            return operation === "calendar.list"
              ? [{ id: 1, title: "Personal" }]
              : { id: 42, title: "Planning" };
          },
          network: { allow: [url], enforceHttps: false },
          permissions: [
            "notification:send",
            "calendar:list",
            "events:get",
            "terminal:read",
            "network:fetch",
            "sqlite",
            "storage:write",
          ],
          unsafeAllowPrivateNetwork: true,
          settings: {
            missingRequiredKeys: [],
            values: { api_key: "secret-token" },
          },
          sendNotification: async (request) => {
            notificationsRequests.push(request);
            return { delivered: true, receipts: [] };
          },
          sqlite: async (operation, request) => {
            sqliteRequests.push({ operation, request });
            if (operation === "sqlite.run") {
              return { changes: 1, lastInsertRowid: 1 };
            }
            if (operation === "sqlite.get") {
              return { row: { title: "hello" } };
            }
            return { rows: [{ title: "hello" }] };
          },
          terminal: async (operation, request) => {
            terminalRequests.push({ operation, request });
            return "read result";
          },
        },
      });
      const setup = runtime.setupResult as {
        tools: Array<{ actionHandle: string; validatePropsHandle: string }>;
      };
      const [tool] = setup.tools;
      if (!tool) {
        throw new Error("Expected one Python tool registration.");
      }

      const callbackResult = await runtime.invokeCallback({
        args: [
          {
            contextKind: "threadTool",
            ownerUserId: 7,
            projectId: 9,
            threadId: 11,
            worktreePath: "/tmp/worktree",
          },
          {},
        ],
        deadlineMs: Date.now() + 5000,
        handle: tool.actionHandle,
        label: "run python context tool",
      });
      expect(callbackResult).toEqual({
        apiKey: "secret-token",
        calendars: [{ id: 1, title: "Personal" }],
        event: { id: 42, title: "Planning" },
        fetchedBody: '{"ok":true}',
        fetchedStatus: 200,
        fetchedUrl: url,
        htmlFromMarkdown:
          "<h1>Hi</h1>\n<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
        jwtExp: 42_000,
        markdownFromHtml: "# Hi\n\nPython **plugin**",
        notice: { delivered: true, receipts: [] },
        read: "read result",
        row: { row: { title: "hello" } },
        rows: { rows: [{ title: "hello" }] },
        run: { changes: 1, lastInsertRowid: 1 },
        toml: { title: "Hello" },
        tomlText: 'title = "Hello"\n',
        xml: {
          attributes: {},
          children: [
            {
              attributes: { id: "a" },
              children: [
                {
                  attributes: {},
                  children: [],
                  name: "title",
                  text: "Hi & XML",
                  type: "element",
                },
              ],
              name: "entry",
              text: "",
              type: "element",
            },
          ],
          name: "feed",
          text: "",
          type: "element",
        },
        xmlText: "A&amp;B &lt;tag&gt;",
        yaml: { count: 2, ok: true },
        yamlText: "{ok: true}",
      });

      const expectedContext = {
        contextKind: "threadTool",
        ownerUserId: 7,
        projectId: 9,
        threadId: 11,
        worktreePath: "/tmp/worktree",
      };
      expect(notificationsRequests).toEqual([
        {
          context: expectedContext,
          deadlineMs: expect.any(Number),
          body: "The build finished.",
          clickUrl: null,
          priority: null,
          tags: ["white_check_mark"],
          title: "Build done",
        },
      ]);
      expect(calendarRequests).toEqual([
        {
          operation: "calendar.list",
          request: {
            context: expectedContext,
            deadlineMs: expect.any(Number),
            params: {},
          },
        },
        {
          operation: "events.get",
          request: {
            context: expectedContext,
            deadlineMs: expect.any(Number),
            params: { eventId: 42 },
          },
        },
      ]);
      expect(terminalRequests).toEqual([
        {
          operation: "terminal.read",
          request: {
            context: expectedContext,
            deadlineMs: expect.any(Number),
            params: { lineCount: 5, terminalIndex: 0 },
          },
        },
      ]);
      expect(sqliteRequests).toEqual([
        {
          operation: "sqlite.run",
          request: {
            context: expectedContext,
            deadlineMs: expect.any(Number),
            params: {
              bindings: ["hello"],
              path: "~/state.sqlite",
              statement: "insert into notes (title) values (?)",
            },
          },
        },
        {
          operation: "sqlite.get",
          request: {
            context: expectedContext,
            deadlineMs: expect.any(Number),
            params: {
              bindings: [1],
              path: "~/state.sqlite",
              statement: "select title from notes where id = ?",
            },
          },
        },
        {
          operation: "sqlite.all",
          request: {
            context: expectedContext,
            deadlineMs: expect.any(Number),
            params: {
              bindings: undefined,
              path: "~/state.sqlite",
              statement: "select title from notes order by id",
            },
          },
        },
      ]);
    } finally {
      server.stop(true);
    }
  });

  it("exposes permissioned fetch to Python plugins", async () => {
    const server = Bun.serve({
      fetch() {
        return Response.json({ greeting: "hello" });
      },
      port: 0,
    });
    try {
      const buildResult: PluginEntrypointBuildResult = {
        entrypointPath: "/tmp/plugin/fetch.py",
        language: "python",
        outputCount: 1,
        pythonSource: `
from metidos import add_agent_tool, fetch


def validate_props(props):
    return props

async def action(context, props):
    response = await fetch(props["url"])
    data = await response.json()
    return {"type": "text", "text": data.greeting + ":" + str(response.status)}

add_agent_tool({
    "tool": "python_fetch",
    "name": "Python fetch",
    "description": "Fetch JSON from an allowed URL.",
    "timeoutMs": 1000,
    "validateProps": validate_props,
    "action": action,
})
`,
        source: "",
        sourceMap: null,
      };
      const runtime = await startPluginRuntime(buildResult, {
        pluginApi: {
          network: {
            allow: [`http://127.0.0.1:${server.port}/**`],
            enforceHttps: false,
          },
          permissions: ["network:fetch"],
          unsafeAllowPrivateNetwork: true,
        },
      });
      const setup = runtime.setupResult as {
        tools: Array<{ actionHandle: string }>;
      };
      const [tool] = setup.tools;
      if (!tool) {
        throw new Error("Expected one Python tool registration.");
      }

      await expect(
        runtime.invokeCallback({
          args: [{}, { url: `http://127.0.0.1:${server.port}/hello` }],
          deadlineMs: Date.now() + 1000,
          handle: tool.actionHandle,
          label: "run python fetch",
        }),
      ).resolves.toEqual({ type: "text", text: "hello:200" });
    } finally {
      await server.stop(true);
    }
  });

  it("exposes host-backed websocket clients to Python plugins", async () => {
    const seenRequests: Array<{ operation: string; request: unknown }> = [];
    const buildResult: PluginEntrypointBuildResult = {
      entrypointPath: "/tmp/plugin/websocket.py",
      language: "python",
      outputCount: 1,
      pythonSource: `
from metidos import add_agent_tool, websocket


def validate_props(props):
    return props

async def action(context, props):
    socket = await websocket.connect("wss://stream.example.test/events", {
        "protocols": ["json.v1"],
        "timeoutMs": 5000,
    })
    await socket.sendText("hello")
    first = await socket.receive({"timeoutMs": 5000})
    await socket.close(1000, "done")
    return {
        "first": first,
        "id": socket.id,
        "state": await socket.state(),
        "url": socket.url,
    }

add_agent_tool({
    "tool": "python_websocket",
    "name": "Python websocket",
    "description": "Use the websocket host API.",
    "timeoutMs": 1000,
    "validateProps": validate_props,
    "action": action,
})
`,
      source: "",
      sourceMap: null,
    };

    const runtime = await startPluginRuntime(buildResult, {
      pluginApi: {
        webSocket: async (operation, request) => {
          seenRequests.push({ operation, request });
          if (operation === "websocket.connect") {
            return { id: 7, url: "wss://stream.example.test/events" };
          }
          if (operation === "websocket.receive") {
            return { text: "first", type: "message" };
          }
          if (operation === "websocket.state") {
            return { state: "open" };
          }
          return { success: true };
        },
      },
    });
    const setup = runtime.setupResult as {
      tools: Array<{ actionHandle: string }>;
    };
    const [tool] = setup.tools;
    if (!tool) {
      throw new Error("Expected one Python tool registration.");
    }

    await expect(
      runtime.invokeCallback({
        args: [{ contextKind: "threadTool", ownerUserId: 7 }, {}],
        deadlineMs: Date.now() + 5000,
        handle: tool.actionHandle,
        label: "run python websocket",
      }),
    ).resolves.toEqual({
      first: { text: "first", type: "message" },
      id: 7,
      state: "open",
      url: "wss://stream.example.test/events",
    });
    expect(seenRequests).toEqual([
      {
        operation: "websocket.connect",
        request: {
          context: { contextKind: "threadTool", ownerUserId: 7 },
          deadlineMs: expect.any(Number),
          params: {
            options: { protocols: ["json.v1"], timeoutMs: 5000 },
            url: "wss://stream.example.test/events",
          },
        },
      },
      {
        operation: "websocket.send",
        request: {
          context: { contextKind: "threadTool", ownerUserId: 7 },
          deadlineMs: expect.any(Number),
          params: { id: 7, text: "hello" },
        },
      },
      {
        operation: "websocket.receive",
        request: {
          context: { contextKind: "threadTool", ownerUserId: 7 },
          deadlineMs: expect.any(Number),
          params: { id: 7, options: { timeoutMs: 5000 } },
        },
      },
      {
        operation: "websocket.close",
        request: {
          context: { contextKind: "threadTool", ownerUserId: 7 },
          deadlineMs: expect.any(Number),
          params: { code: 1000, id: 7, reason: "done" },
        },
      },
      {
        operation: "websocket.state",
        request: {
          context: { contextKind: "threadTool", ownerUserId: 7 },
          deadlineMs: expect.any(Number),
          params: { id: 7 },
        },
      },
    ]);
  });

  it("streams websocket events into Python plugins", async () => {
    const seenRequests: Array<{ operation: string; request: unknown }> = [];
    const buildResult: PluginEntrypointBuildResult = {
      entrypointPath: "/tmp/plugin/websocket-events.py",
      language: "python",
      outputCount: 1,
      pythonSource: `
from metidos import add_agent_tool, websocket


def validate_props(props):
    return props

async def action(context, props):
    socket = await websocket.connect("wss://stream.example.test/events")
    events = []
    async for event in socket.events({"timeoutMs": 5000}):
        events.append(event)
    return {"events": events, "id": socket.id}

add_agent_tool({
    "tool": "python_websocket_events",
    "name": "Python websocket events",
    "description": "Stream websocket events.",
    "timeoutMs": 1000,
    "validateProps": validate_props,
    "action": action,
})
`,
      source: "",
      sourceMap: null,
    };

    const runtime = await startPluginRuntime(buildResult, {
      pluginApi: {
        webSocket: async (operation, request) => {
          seenRequests.push({ operation, request });
          if (operation === "websocket.connect") {
            return { id: 9, url: "wss://stream.example.test/events" };
          }
          const receiveCount = seenRequests.filter(
            (entry) => entry.operation === "websocket.receive",
          ).length;
          return receiveCount === 1
            ? { text: "first", type: "message" }
            : { code: 1000, reason: "done", type: "close" };
        },
      },
    });
    const setup = runtime.setupResult as {
      tools: Array<{ actionHandle: string }>;
    };
    const [tool] = setup.tools;
    if (!tool) {
      throw new Error("Expected one Python tool registration.");
    }

    await expect(
      runtime.invokeCallback({
        args: [{ contextKind: "threadTool", ownerUserId: 7 }, {}],
        deadlineMs: Date.now() + 5000,
        handle: tool.actionHandle,
        label: "run python websocket events",
      }),
    ).resolves.toEqual({
      events: [
        { text: "first", type: "message" },
        { code: 1000, reason: "done", type: "close" },
      ],
      id: 9,
    });
  });

  it("applies startup and callback deadlines to Python plugins", async () => {
    await expect(
      startPluginRuntime(
        {
          entrypointPath: "/tmp/plugin/slow-start.py",
          language: "python",
          outputCount: 1,
          pythonSource: `
import asyncio
await asyncio.sleep(0.05)
`,
          source: "",
          sourceMap: null,
        },
        { startupTimeoutMs: 1 },
      ),
    ).rejects.toThrow("Plugin Python setup timed out after 1 ms.");

    const runtime = await startPluginRuntime({
      entrypointPath: "/tmp/plugin/slow-callback.py",
      language: "python",
      outputCount: 1,
      pythonSource: `
import asyncio
from metidos import add_agent_tool


def validate_props(props):
    return props

async def action(context, props):
    await asyncio.sleep(0.05)
    return {"type": "text", "text": "late"}

add_agent_tool({
    "tool": "python_slow",
    "name": "Python slow",
    "description": "Sleeps longer than the callback deadline.",
    "timeoutMs": 1000,
    "validateProps": validate_props,
    "action": action,
})
`,
      source: "",
      sourceMap: null,
    });
    const setup = runtime.setupResult as {
      tools: Array<{ actionHandle: string }>;
    };
    const [tool] = setup.tools;
    if (!tool) {
      throw new Error("Expected one Python tool registration.");
    }
    await expect(
      runtime.invokeCallback({
        args: [{}, {}],
        deadlineMs: Date.now() + 1,
        handle: tool.actionHandle,
        label: "run slow Python tool",
      }),
    ).rejects.toThrow("run slow Python tool timed out.");
  });

  it("creates a safe Pyodide host with only the Metidos js bridge exposed", async () => {
    const host = await createPluginPythonExecutionHost({
      metidos: {
        addAgentTool() {},
        calendar: {},
        env: {},
        events: {},
        fs: {
          readText(path: string) {
            return `virtual:${path}`;
          },
        },
        fetch() {},
        settings: {},
        log() {},
        notifications: {},
        oauth: {},
        providers: {},
        registerOAuth() {},
        sqlite() {},
        terminal: {},
        toml: {},
        users: {},
        util: {},
        websocket: {},
        xml: {},
        yaml: {},
      },
    });

    await expect(host.runPythonAsync("from js import process")).rejects.toThrow(
      "cannot import name 'process'",
    );
    await expect(host.runPythonAsync("from js import Bun")).rejects.toThrow(
      "cannot import name 'Bun'",
    );
    await expect(
      host.runPythonAsync("from js import globalThis"),
    ).rejects.toThrow("cannot import name 'globalThis'");
    await expect(
      host.runPythonAsync("open('/etc/passwd').read()"),
    ).rejects.toThrow("FileNotFoundError");
    await expect(
      host.runPythonAsync("from metidos import fs\nfs.readText('~/note.txt')"),
    ).resolves.toBe("virtual:~/note.txt");
  });
});
