/**
 * @file src/bun/plugin/quickjs-runtime.test.ts
 * @description Tests for Plugin System v1 restricted QuickJS startup execution.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { executePluginCalendarEventsOperation } from "./calendar-events";
import { buildPluginEntrypoint } from "./entrypoint-build";
import {
  executePluginQuickJsRuntime,
  PluginQuickJsRuntimeError,
  rewriteEntrypointExports,
  startPluginQuickJsRuntime,
} from "./quickjs-runtime";
import { executePluginTerminalOperation } from "./terminal";

const tempDirectories = new Set<string>();
const testServers: Array<ReturnType<typeof Bun.serve>> = [];

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  writePluginFile(
    path,
    "metidos-plugin.json",
    `${JSON.stringify(
      {
        description: "QuickJS runtime test plugin.",
        id: "quickjs_test",
        main: "./index.ts",
        metidosApiVersion: "v1",
        name: "QuickJS Test",
        version: "1.0.0",
      },
      null,
      2,
    )}\n`,
  );
  return path;
}

function writePluginFile(
  root: string,
  relativePath: string,
  contents: string,
): void {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

async function buildAndRunPlugin(
  source: string,
  options: Parameters<typeof executePluginQuickJsRuntime>[1] = {},
) {
  const pluginRoot = createTempDirectory("metidos-plugin-quickjs-");
  writePluginFile(pluginRoot, "index.ts", source);
  const buildResult = await buildPluginEntrypoint({ pluginRoot });
  return await executePluginQuickJsRuntime(buildResult, {
    ...options,
    startupTimeoutMs: options.startupTimeoutMs ?? 1_000,
  });
}

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  tempDirectories.clear();
  for (const server of testServers.splice(0)) {
    server.stop(true);
  }
});

describe("rewriteEntrypointExports", () => {
  it("rewrites default exports and export-list default aliases without touching ordinary source", () => {
    expect(
      rewriteEntrypointExports(
        "const plugin = {}; export { plugin as default };",
      ),
    ).toBe("const plugin = {}; globalThis.__metidosDefaultExport = plugin;");
    expect(
      rewriteEntrypointExports(
        "const plugin = {};\nexport { helper, plugin as default };",
      ),
    ).toBe("const plugin = {};\nglobalThis.__metidosDefaultExport = plugin;");
    expect(
      rewriteEntrypointExports(
        "export default definePlugin({ name: 'demo' });",
      ),
    ).toBe(
      "globalThis.__metidosDefaultExport = definePlugin({ name: 'demo' });",
    );
    expect(
      rewriteEntrypointExports("export { helper };\nconst value = 1;"),
    ).toBe("\nconst value = 1;");
  });

  it("rejects oversized entrypoint source before applying export regexes", () => {
    const oversizedSource = `${" ".repeat(5 * 1024 * 1024 + 1)}export default {};`;

    expect(() => rewriteEntrypointExports(oversizedSource)).toThrow(
      "Plugin QuickJS entrypoint source is too large to rewrite exports safely.",
    );
  });

  it("rejects unsupported ESM, TypeScript, and CommonJS export styles with author-facing errors", () => {
    expect(() => rewriteEntrypointExports("export const plugin = {};")).toThrow(
      "Unsupported plugin QuickJS entrypoint export syntax.",
    );
    expect(() => rewriteEntrypointExports("export type Plugin = {};")).toThrow(
      "Unsupported plugin QuickJS entrypoint export syntax.",
    );
    expect(() => rewriteEntrypointExports("module.exports = {};")).toThrow(
      "Unsupported CommonJS plugin QuickJS entrypoint export syntax.",
    );
  });
});

describe("executePluginQuickJsRuntime", () => {
  it("rejects Python entrypoints because they require the Python runtime", async () => {
    const pluginRoot = createTempDirectory("metidos-plugin-quickjs-python-");
    writePluginFile(
      pluginRoot,
      "metidos-plugin.json",
      `${JSON.stringify({
        description: "Python test plugin.",
        id: "quickjs_python_test",
        main: "./main.py",
        metidosApiVersion: "v1",
        name: "QuickJS Python Test",
        version: "1.0.0",
      })}\n`,
    );
    writePluginFile(pluginRoot, "main.py", "print('hello')\n");
    const buildResult = await buildPluginEntrypoint({ pluginRoot });

    await expect(startPluginQuickJsRuntime(buildResult)).rejects.toThrow(
      "Python plugin entrypoints require the Python runtime",
    );
  });
  it("runs plugin setup in QuickJS with the injected plugin API", async () => {
    const result = await buildAndRunPlugin(`
      import { definePlugin, metidos } from "@metidos/plugin-api";
      const value = await Promise.resolve("ready");
      export default definePlugin({
        metidosIsInjected: typeof metidos === "object" && metidos !== null,
        name: value,
      });
    `);

    expect(result.setupResult).toEqual({
      metidosIsInjected: true,
      name: "ready",
    });
  });

  it("exposes btoa and atob as bare top-level QuickJS plugin functions", async () => {
    const result = await buildAndRunPlugin(`
      import { definePlugin } from "@metidos/plugin-api";
      const encoded = btoa("\\x00\\xffhello");
      const decodedCodes = Array.from(atob(encoded)).map((char) => char.charCodeAt(0));
      export default definePlugin({ decodedCodes, encoded });
    `);

    expect(result.setupResult).toEqual({
      decodedCodes: [0, 255, 104, 101, 108, 108, 111],
      encoded: "AP9oZWxsbw==",
    });
  });

  it("exposes host-backed YAML, TOML, HTML, and XML structured data helpers", async () => {
    const result = await buildAndRunPlugin(`
      import { definePlugin, metidos } from "@metidos/plugin-api";
      const yaml = metidos.yaml.parse("title: Hello\\ntags:\\n  - area:tasks\\n");
      const toml = metidos.toml.parse('title = "Hello"\\ntags = ["area:tasks"]\\n');
      const xml = metidos.xml.parse('<RSS><channel><item id="1"><title>Hello &amp; RSS</title></item></channel></RSS>', { lowercaseNames: true });
      const xmlText = metidos.xml.encode('A&B <tag> "quoted"');
      const markdown = metidos.html.toMarkdown('<main><h1>Hello</h1><p>Safe <strong>HTML</strong></p></main>');
      const html = metidos.html.fromMarkdown('# Hello\\n\\n<script>alert(1)</script> [bad](javascript:alert)');
      const yamlRoundTrip = metidos.yaml.parse(metidos.yaml.stringify({ ok: true, count: 2 }));
      const tomlText = metidos.toml.stringify({ title: "Hello", tags: ["area:tasks"] });
      let errorName = "none";
      let xmlErrorName = "none";
      try {
        metidos.yaml.parse("invalid: yaml: content:");
      } catch (error) {
        errorName = error.name;
      }
      try {
        metidos.xml.parse('<!DOCTYPE rss [<!ENTITY x "boom">]><rss>&x;</rss>');
      } catch (error) {
        xmlErrorName = error.name;
      }
      export default definePlugin({ errorName, html, markdown, toml, tomlText, xml, xmlErrorName, xmlText, yaml, yamlRoundTrip });
    `);

    expect(result.setupResult).toEqual({
      errorName: "SyntaxError",
      html: '<h1>Hello</h1>\n<p>&lt;script&gt;alert(1)&lt;/script&gt; <a href="#" rel="nofollow noopener noreferrer">bad</a></p>',
      markdown: "# Hello\n\nSafe **HTML**",
      toml: { tags: ["area:tasks"], title: "Hello" },
      tomlText: 'title = "Hello"\ntags = ["area:tasks"]\n',
      xml: {
        attributes: {},
        children: [
          {
            attributes: {},
            children: [
              {
                attributes: { id: "1" },
                children: [
                  {
                    attributes: {},
                    children: [],
                    name: "title",
                    text: "Hello & RSS",
                    type: "element",
                  },
                ],
                name: "item",
                text: "",
                type: "element",
              },
            ],
            name: "channel",
            text: "",
            type: "element",
          },
        ],
        name: "rss",
        text: "",
        type: "element",
      },
      xmlErrorName: "MetidosXmlParseError",
      xmlText: "A&amp;B &lt;tag&gt; &quot;quoted&quot;",
      yaml: { tags: ["area:tasks"], title: "Hello" },
      yamlRoundTrip: { count: 2, ok: true },
    });
  });

  it("exposes declared env and general settings", async () => {
    const result = await buildAndRunPlugin(
      `
        import { definePlugin, metidos } from "@metidos/plugin-api";
        export default definePlugin({
          apiToken: metidos.env.get("API_TOKEN"),
          missingOptionalEnv: metidos.env.get("OPTIONAL_VALUE"),
          refreshMinutes: metidos.settings.get("refresh_minutes"),
          allSettings: metidos.settings.all(),
          hasRefresh: metidos.settings.has("refresh_minutes"),
        });
      `,
      {
        pluginApi: {
          env: [
            {
              key: "API_TOKEN",
              required: true,
              secret: true,
              value: "secret-token",
            },
            {
              key: "OPTIONAL_VALUE",
              required: false,
              secret: false,
              value: null,
            },
          ],
          settings: {
            missingRequiredKeys: [],
            values: { refresh_minutes: 15 },
          },
        },
      },
    );

    expect(result.setupResult).toEqual({
      allSettings: { refresh_minutes: 15 },
      apiToken: "secret-token",
      hasRefresh: true,
      missingOptionalEnv: null,
      refreshMinutes: 15,
    });
  });

  it("exposes Plugin Settings", async () => {
    const result = await buildAndRunPlugin(
      `
        import { definePlugin, metidos } from "@metidos/plugin-api";
        export default definePlugin({
          allSettings: metidos.settings.all(),
          hasMode: metidos.settings.has("mode"),
          mode: metidos.settings.get("mode"),
        });
      `,
      {
        pluginApi: {
          settings: {
            missingRequiredKeys: [],
            values: { mode: "verbose", recipients: ["ops@example.test"] },
          },
        },
      },
    );

    expect(result.setupResult).toEqual({
      allSettings: { mode: "verbose", recipients: ["ops@example.test"] },
      hasMode: true,
      mode: "verbose",
    });
  });

  it("exposes permissioned metidos.fetch inside QuickJS", async () => {
    const server = Bun.serve({
      fetch: () =>
        Response.json({ ok: true }, { headers: { "x-plugin-test": "yes" } }),
      port: 0,
    });
    testServers.push(server);
    const url = `http://localhost:${server.port}/status`;

    const result = await buildAndRunPlugin(
      `
        import { definePlugin, metidos } from "@metidos/plugin-api";
        const response = await metidos.fetch(${JSON.stringify(url)});
        export default definePlugin({
          body: await response.json(),
          bodyStreamType: typeof response.body,
          header: response.headers["x-plugin-test"],
          headerGetterType: typeof response.headers.get,
          ok: response.ok,
          rawArrayBufferType: typeof response.arrayBuffer,
          status: response.status,
          url: response.url,
        });
      `,
      {
        pluginApi: {
          network: { allow: [url], enforceHttps: false },
          permissions: ["network:fetch"],
          unsafeAllowPrivateNetwork: true,
        },
      },
    );

    expect(result.setupResult).toEqual({
      body: { ok: true },
      bodyStreamType: "undefined",
      header: "yes",
      headerGetterType: "undefined",
      ok: true,
      rawArrayBufferType: "function",
      status: 200,
      url,
    });
  });

  it("exposes byte request bodies through metidos.fetch", async () => {
    let received = "";
    const server = Bun.serve({
      fetch: async (request) => {
        received = Array.from(new Uint8Array(await request.arrayBuffer())).join(
          ",",
        );
        return new Response("ok");
      },
      port: 0,
    });
    testServers.push(server);
    const url = `http://localhost:${server.port}/upload`;

    const result = await buildAndRunPlugin(
      `
        import { definePlugin, metidos } from "@metidos/plugin-api";
        const response = await metidos.fetch(${JSON.stringify(url)}, {
          body: new Uint8Array([0, 1, 2, 255]),
          method: "PUT",
        });
        export default definePlugin({ body: await response.text(), status: response.status });
      `,
      {
        pluginApi: {
          network: { allow: [url], enforceHttps: false },
          permissions: ["network:fetch"],
          unsafeAllowPrivateNetwork: true,
        },
      },
    );

    expect(result.setupResult).toEqual({ body: "ok", status: 200 });
    expect(received).toBe("0,1,2,255");
  });

  it("exposes host-backed metidos.websocket clients with receive and events", async () => {
    const seenRequests: Array<{ operation: string; request: unknown }> = [];
    const result = await buildAndRunPlugin(
      `
        import { definePlugin, metidos } from "@metidos/plugin-api";
        const socket = await metidos.websocket.connect("wss://stream.example.test/events", {
          protocols: ["json.v1"],
          timeoutMs: 5000,
        });
        await socket.sendText("hello");
        const first = await socket.receive({ timeoutMs: 5000 });
        const events = [];
        for await (const event of socket.events({ timeoutMs: 5000 })) {
          events.push(event);
        }
        await socket.close(1000, "done");
        export default definePlugin({
          events,
          first,
          id: socket.id,
          state: await socket.state(),
          url: socket.url,
        });
      `,
      {
        pluginApi: {
          webSocket: async (operation, request) => {
            seenRequests.push({ operation, request });
            if (operation === "websocket.connect") {
              return { id: 7, url: "wss://stream.example.test/events" };
            }
            if (operation === "websocket.receive") {
              const receiveCount = seenRequests.filter(
                (entry) => entry.operation === "websocket.receive",
              ).length;
              return receiveCount === 1
                ? { text: "first", type: "message" }
                : receiveCount === 2
                  ? { text: "second", type: "message" }
                  : { code: 1000, reason: "done", type: "close" };
            }
            if (operation === "websocket.state") {
              return { state: "open" };
            }
            return { success: true };
          },
        },
      },
    );

    expect(result.setupResult).toEqual({
      events: [
        { text: "second", type: "message" },
        { code: 1000, reason: "done", type: "close" },
      ],
      first: { text: "first", type: "message" },
      id: 7,
      state: "open",
      url: "wss://stream.example.test/events",
    });
    expect(seenRequests.map((entry) => entry.operation)).toEqual([
      "websocket.connect",
      "websocket.send",
      "websocket.receive",
      "websocket.receive",
      "websocket.receive",
      "websocket.close",
      "websocket.state",
    ]);
  });

  it("exposes permissioned metidos.log inside QuickJS", async () => {
    const logRequests: unknown[] = [];
    const result = await buildAndRunPlugin(
      `
        import { definePlugin, metidos } from "@metidos/plugin-api";
        await metidos.log("info", "hello from setup");
        export default definePlugin({ logged: true });
      `,
      {
        pluginApi: {
          log: async (request) => {
            logRequests.push(request);
            return { logged: true };
          },
          permissions: ["log:write"],
        },
      },
    );

    expect(result.setupResult).toEqual({ logged: true });
    expect(logRequests).toEqual([
      {
        context: null,
        deadlineMs: null,
        params: { level: "info", message: "hello from setup" },
      },
    ]);
  });

  it("throws PluginPermissionError from metidos.log without permission", async () => {
    const logRequests: unknown[] = [];
    const result = await buildAndRunPlugin(
      `
        import { definePlugin, metidos } from "@metidos/plugin-api";
        let errorName = "none";
        try {
          await metidos.log("info", "denied");
        } catch (error) {
          errorName = error.name;
        }
        export default definePlugin({ errorName });
      `,
      {
        pluginApi: {
          log: async (request) => {
            logRequests.push(request);
            return { logged: true };
          },
          permissions: [],
        },
      },
    );

    expect(result.setupResult).toEqual({ errorName: "PluginPermissionError" });
    expect(logRequests).toEqual([]);
  });

  it("throws PluginPermissionError from metidos.fetch without permission", async () => {
    const result = await buildAndRunPlugin(
      `
        import { definePlugin, metidos } from "@metidos/plugin-api";
        let errorName = "none";
        try {
          await metidos.fetch("https://api.example.test/status");
        } catch (error) {
          errorName = error.name;
        }
        export default definePlugin({ errorName });
      `,
      {
        pluginApi: {
          network: {
            allow: ["https://api.example.test/**"],
            enforceHttps: true,
          },
          permissions: [],
        },
      },
    );

    expect(result.setupResult).toEqual({ errorName: "PluginPermissionError" });
  });

  it("throws when plugin setup reads undeclared env or setting keys", async () => {
    await expect(
      buildAndRunPlugin(
        `
          import { metidos } from "@metidos/plugin-api";
          metidos.env.get("UNDECLARED_TOKEN");
          export default {};
        `,
        { pluginApi: { env: [] } },
      ),
    ).rejects.toThrow('Plugin env "UNDECLARED_TOKEN" is not declared.');

    await expect(
      buildAndRunPlugin(
        `
          import { metidos } from "@metidos/plugin-api";
          metidos.settings.get("missing_setting");
          export default {};
        `,
        {
          pluginApi: {
            settings: { missingRequiredKeys: [], values: {} },
          },
        },
      ),
    ).rejects.toThrow('Plugin setting "missing_setting" is not declared.');
  });

  it("does not expose raw host globals or unrestricted timers", async () => {
    const result = await buildAndRunPlugin(`
      import { definePlugin } from "@metidos/plugin-api";
      export default definePlugin({
        bun: typeof Bun,
        fetch: typeof fetch,
        process: typeof process,
        require: typeof require,
        setTimeout: typeof setTimeout,
      });
    `);

    expect(result.setupResult).toEqual({
      bun: "undefined",
      fetch: "undefined",
      process: "undefined",
      require: "undefined",
      setTimeout: "undefined",
    });
  });

  it("surfaces rejected top-level await setup as a startup failure", async () => {
    const pluginRoot = createTempDirectory("metidos-plugin-quickjs-reject-");
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        await Promise.reject(new Error("setup rejected"));
        export default {};
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });

    await expect(
      executePluginQuickJsRuntime(buildResult, { startupTimeoutMs: 1_000 }),
    ).rejects.toThrow(PluginQuickJsRuntimeError);
    await expect(
      executePluginQuickJsRuntime(buildResult, { startupTimeoutMs: 1_000 }),
    ).rejects.toThrow("setup rejected");
  });

  it("interrupts synchronous setup after the startup deadline", async () => {
    const pluginRoot = createTempDirectory("metidos-plugin-quickjs-loop-");
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        while (true) {}
        export default {};
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });

    await expect(
      executePluginQuickJsRuntime(buildResult, { startupTimeoutMs: 25 }),
    ).rejects.toThrow(PluginQuickJsRuntimeError);
  });

  it("collects agent tool registrations from definePlugin setup callbacks", async () => {
    const result = await buildAndRunPlugin(`
      import { definePlugin } from "@metidos/plugin-api";
      export default definePlugin((metidos) => {
        metidos.addAgentTool({
          tool: "hello_world",
          name: "Hello world",
          description: "Return a greeting.",
          timeoutMs: 5000,
          validateProps(props) {
            return props;
          },
          action(_context, props) {
            return { greeting: "hello", props };
          },
        });
      });
    `);

    expect(result.setupResult).toEqual({
      tools: [
        {
          actionHandle: "tool:action:2",
          description: "Return a greeting.",
          name: "Hello world",
          timeoutMs: 5_000,
          tool: "hello_world",
          validatePropsHandle: "tool:validateProps:1",
        },
      ],
    });
  });

  it("collects permissioned prompt injection registrations from definePlugin setup callbacks", async () => {
    const result = await buildAndRunPlugin(
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addInjection({
            inject: "thread_context",
            name: "Thread context",
            timeoutMs: 5000,
            prompt(_context, prompt) {
              return "context for " + prompt;
            },
          });
        });
      `,
      { pluginApi: { permissions: ["metidos:prompt_inject"] } },
    );

    expect(result.setupResult).toEqual({
      injections: [
        {
          inject: "thread_context",
          name: "Thread context",
          promptHandle: "injection:prompt:1",
          timeoutMs: 5_000,
        },
      ],
      tools: [],
    });
  });

  it("invokes registered agent tool callbacks while the runtime remains active", async () => {
    const pluginRoot = createTempDirectory("metidos-plugin-quickjs-callback-");
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "hello_world",
            name: "Hello world",
            description: "Return a greeting.",
            timeoutMs: 5000,
            validateProps(props) {
              return { ...props, validated: true };
            },
            action(context, props) {
              return { context, props };
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        tools: Array<{
          actionHandle: string;
          validatePropsHandle: string;
        }>;
      };
      const [tool] = registrations.tools;
      expect(tool).toBeDefined();
      if (!tool) {
        throw new Error("Expected plugin tool registration.");
      }
      const validated = await runtime.invokeCallback({
        args: [{ name: "Ada" }],
        deadlineMs: Date.now() + 1_000,
        handle: tool.validatePropsHandle,
        label: "validateProps",
      });
      expect(validated).toEqual({ name: "Ada", validated: true });

      await expect(
        runtime.invokeCallback({
          args: [{ threadId: 7 }, validated],
          deadlineMs: Date.now() + 1_000,
          handle: tool.actionHandle,
          label: "action",
        }),
      ).resolves.toEqual({
        context: { threadId: 7 },
        props: { name: "Ada", validated: true },
      });
    } finally {
      runtime.dispose();
    }
  });

  it("exposes permissioned metidos.notifications.send inside callback contexts", async () => {
    const pluginRoot = createTempDirectory("metidos-plugin-quickjs-notify-");
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "notify",
            name: "Notify",
            description: "Send a notification.",
            timeoutMs: 5000,
            validateProps(props) {
              return props;
            },
            async action() {
              return await metidos.notifications.send({
                title: "Build done",
                message: "The build finished.",
                tags: ["white_check_mark"],
              });
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const seenRequests: unknown[] = [];
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: {
        permissions: ["notification:send"],
        sendNotification: async (request) => {
          seenRequests.push(request);
          return {
            receipts: [
              {
                channel: "ntfy",
                deliveryId: 42,
                message: "Notification delivered.",
                outlet: "ntfy",
                status: "delivered",
              },
            ],
          };
        },
      },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        tools: Array<{ actionHandle: string }>;
      };
      const result = await runtime.invokeCallback({
        args: [{ contextKind: "threadTool", ownerUserId: 7, threadId: 12 }, {}],
        deadlineMs: Date.now() + 1_000,
        handle: registrations.tools[0]?.actionHandle ?? "missing",
        label: "notify action",
      });

      expect(result).toEqual({
        receipts: [
          {
            channel: "ntfy",
            deliveryId: 42,
            message: "Notification delivered.",
            outlet: "ntfy",
            status: "delivered",
          },
        ],
      });
      expect(seenRequests).toEqual([
        {
          body: "The build finished.",
          clickUrl: null,
          context: { contextKind: "threadTool", ownerUserId: 7, threadId: 12 },
          deadlineMs: expect.any(Number),
          priority: null,
          tags: ["white_check_mark"],
          title: "Build done",
        },
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("throws PluginNotificationError from metidos.notifications.send without permission", async () => {
    const pluginRoot = createTempDirectory(
      "metidos-plugin-quickjs-notify-deny-",
    );
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "notify",
            name: "Notify",
            description: "Send a notification.",
            timeoutMs: 5000,
            validateProps(props) { return props; },
            async action() {
              try {
                await metidos.notifications.send({ title: "Hi", message: "Denied" });
                return { errorName: "none" };
              } catch (error) {
                return { errorName: error.name, errorCode: error.code };
              }
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: {
        permissions: [],
        sendNotification: async () => ({ receipts: [] }),
      },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        tools: Array<{ actionHandle: string }>;
      };
      await expect(
        runtime.invokeCallback({
          args: [{ contextKind: "threadTool", ownerUserId: 7 }, {}],
          deadlineMs: Date.now() + 1_000,
          handle: registrations.tools[0]?.actionHandle ?? "missing",
          label: "notify action",
        }),
      ).resolves.toEqual({
        errorCode: "plugin_permission_error",
        errorName: "PluginNotificationError",
      });
    } finally {
      runtime.dispose();
    }
  });

  it("dispatches metidos.calendar and metidos.events through the host API", async () => {
    const pluginRoot = createTempDirectory("metidos-plugin-quickjs-calendar-");
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "calendar",
            name: "Calendar",
            description: "Exercise calendar APIs.",
            timeoutMs: 5000,
            validateProps(props) { return props; },
            async action() {
              const calendars = await metidos.calendar.list();
              const event = await metidos.events.get({ eventId: 42 });
              return { calendars, event };
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const seenRequests: unknown[] = [];
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: {
        calendarEvents: async (operation, request) => {
          seenRequests.push({ operation, request });
          return operation === "calendar.list"
            ? [{ id: 1, title: "Personal" }]
            : { id: 42, title: "Planning" };
        },
        permissions: ["calendar:list", "events:get"],
      },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        tools: Array<{ actionHandle: string }>;
      };
      await expect(
        runtime.invokeCallback({
          args: [{ contextKind: "threadTool", ownerUserId: 7 }, {}],
          deadlineMs: Date.now() + 1_000,
          handle: registrations.tools[0]?.actionHandle ?? "missing",
          label: "calendar action",
        }),
      ).resolves.toEqual({
        calendars: [{ id: 1, title: "Personal" }],
        event: { id: 42, title: "Planning" },
      });
      expect(seenRequests).toEqual([
        {
          operation: "calendar.list",
          request: {
            context: { contextKind: "threadTool", ownerUserId: 7 },
            deadlineMs: expect.any(Number),
            params: {},
          },
        },
        {
          operation: "events.get",
          request: {
            context: { contextKind: "threadTool", ownerUserId: 7 },
            deadlineMs: expect.any(Number),
            params: { eventId: 42 },
          },
        },
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("throws PluginPermissionError from calendar APIs without permission", async () => {
    const pluginRoot = createTempDirectory(
      "metidos-plugin-quickjs-calendar-deny-",
    );
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "calendar",
            name: "Calendar",
            description: "Exercise calendar APIs.",
            timeoutMs: 5000,
            validateProps(props) { return props; },
            async action() {
              try {
                await metidos.calendar.create({ title: "Denied" });
                return { errorName: "none" };
              } catch (error) {
                return { errorName: error.name, errorCode: error.code };
              }
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: {
        calendarEvents: async () => ({}),
        permissions: [],
      },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        tools: Array<{ actionHandle: string }>;
      };
      await expect(
        runtime.invokeCallback({
          args: [{ contextKind: "threadTool", ownerUserId: 7 }, {}],
          deadlineMs: Date.now() + 1_000,
          handle: registrations.tools[0]?.actionHandle ?? "missing",
          label: "calendar action",
        }),
      ).resolves.toEqual({
        errorCode: "plugin_permission_error",
        errorName: "PluginPermissionError",
      });
    } finally {
      runtime.dispose();
    }
  });

  it("dispatches metidos.terminal through the host API without exposing write", async () => {
    const pluginRoot = createTempDirectory("metidos-plugin-quickjs-terminal-");
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "terminal",
            name: "Terminal",
            description: "Exercise terminal APIs.",
            timeoutMs: 5000,
            validateProps(props) { return props; },
            async action() {
              const read = await metidos.terminal.read({ terminalIndex: 0, lineCount: 5 });
              const grep = await metidos.terminal.grep({ terminalIndex: 0, pattern: "ready" });
              return { grep, read, writeType: typeof metidos.terminal.write };
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const seenRequests: unknown[] = [];
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: {
        permissions: ["terminal:read"],
        terminal: async (operation, request) => {
          seenRequests.push({ operation, request });
          return operation === "terminal.grep" ? "grep result" : "read result";
        },
      },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        tools: Array<{ actionHandle: string }>;
      };
      await expect(
        runtime.invokeCallback({
          args: [
            {
              contextKind: "threadTool",
              ownerUserId: 7,
              projectId: 3,
              threadId: 9,
              worktreePath: "/repo",
            },
            {},
          ],
          deadlineMs: Date.now() + 1_000,
          handle: registrations.tools[0]?.actionHandle ?? "missing",
          label: "terminal action",
        }),
      ).resolves.toEqual({
        grep: "grep result",
        read: "read result",
        writeType: "undefined",
      });
      expect(seenRequests).toEqual([
        {
          operation: "terminal.read",
          request: {
            context: {
              contextKind: "threadTool",
              ownerUserId: 7,
              projectId: 3,
              threadId: 9,
              worktreePath: "/repo",
            },
            deadlineMs: expect.any(Number),
            params: { lineCount: 5, terminalIndex: 0 },
          },
        },
        {
          operation: "terminal.grep",
          request: {
            context: {
              contextKind: "threadTool",
              ownerUserId: 7,
              projectId: 3,
              threadId: 9,
              worktreePath: "/repo",
            },
            deadlineMs: expect.any(Number),
            params: { pattern: "ready", terminalIndex: 0 },
          },
        },
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("throws PluginPermissionError from terminal APIs without unsafe", async () => {
    const pluginRoot = createTempDirectory(
      "metidos-plugin-quickjs-terminal-deny-",
    );
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "terminal",
            name: "Terminal",
            description: "Exercise terminal APIs.",
            timeoutMs: 5000,
            validateProps(props) { return props; },
            async action() {
              try {
                await metidos.terminal.create({ title: "Denied" });
                return { errorName: "none" };
              } catch (error) {
                return { errorName: error.name, errorCode: error.code };
              }
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: {
        permissions: ["terminal:create"],
        terminal: async () => ({}),
      },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        tools: Array<{ actionHandle: string }>;
      };
      await expect(
        runtime.invokeCallback({
          args: [
            {
              contextKind: "threadTool",
              ownerUserId: 7,
              projectId: 3,
              threadId: 9,
              worktreePath: "/repo",
            },
            {},
          ],
          deadlineMs: Date.now() + 1_000,
          handle: registrations.tools[0]?.actionHandle ?? "missing",
          label: "terminal action",
        }),
      ).resolves.toEqual({
        errorCode: "plugin_unsafe_permission_required",
        errorName: "PluginPermissionError",
      });
    } finally {
      runtime.dispose();
    }
  });

  it("ignores forged host metadata from direct QuickJS host bridge calls", async () => {
    const pluginRoot = createTempDirectory(
      "metidos-plugin-quickjs-forged-meta-",
    );
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "forged_meta",
            name: "Forged metadata",
            description: "Attempt to spoof callback metadata.",
            timeoutMs: 5000,
            validateProps(props) { return props; },
            async action() {
              const payload = await globalThis.__metidosHostFsOperation(
                "fs.readText",
                { path: "./etc/passwd" },
                {
                  context: {
                    contextKind: "threadTool",
                    ownerUserId: 999,
                    projectId: 999,
                    threadId: 999,
                    worktreePath: "/",
                  },
                  deadlineMs: Date.now() + 600000,
                },
              );
              const parsed = JSON.parse(payload);
              return parsed.result;
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const seenRequests: unknown[] = [];
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: {
        fs: async (_operation, request) => {
          seenRequests.push(request);
          return request;
        },
        permissions: ["storage:read", "files:read"],
      },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        tools: Array<{ actionHandle: string }>;
      };
      await expect(
        runtime.invokeCallback({
          args: [
            {
              contextKind: "threadTool",
              ownerUserId: 7,
              projectId: 3,
              threadId: 9,
              worktreePath: "/trusted/worktree",
            },
            {},
          ],
          deadlineMs: Date.now() + 1_000,
          handle: registrations.tools[0]?.actionHandle ?? "missing",
          label: "forged metadata action",
        }),
      ).resolves.toMatchObject({
        context: {
          contextKind: "threadTool",
          ownerUserId: 7,
          projectId: 3,
          threadId: 9,
          worktreePath: "/trusted/worktree",
        },
        params: { path: "./etc/passwd" },
      });
      expect(seenRequests).toHaveLength(1);
      expect(seenRequests[0]).toMatchObject({
        context: {
          contextKind: "threadTool",
          ownerUserId: 7,
          projectId: 3,
          threadId: 9,
          worktreePath: "/trusted/worktree",
        },
        params: { path: "./etc/passwd" },
      });
    } finally {
      runtime.dispose();
    }
  });

  it("copies host byte payloads through JSON envelopes before returning them to QuickJS", async () => {
    const pluginRoot = createTempDirectory("metidos-plugin-quickjs-bytes-");
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "bytes",
            name: "Bytes",
            description: "Exercise byte payload copies.",
            timeoutMs: 5000,
            validateProps(props) { return props; },
            async action() {
              const typed = await metidos.fs.read("typed");
              typed[0] = 99;
              const typedAgain = await metidos.fs.read("typed");
              const buffer = await metidos.fs.read("buffer");
              return {
                buffer: Array.from(buffer),
                typed: Array.from(typed),
                typedAgain: Array.from(typedAgain),
              };
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const hostTypedBytes = new Uint8Array([0, 1, 2, 255]);
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: {
        fs: async (_operation, request) => {
          const path = (request.params as { path?: string }).path;
          if (path === "typed") {
            return hostTypedBytes.subarray(1, 3);
          }
          return new Uint8Array([9, 8, 7]).buffer;
        },
        permissions: ["storage:read"],
      },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        tools: Array<{ actionHandle: string }>;
      };
      await expect(
        runtime.invokeCallback({
          args: [{ contextKind: "threadTool", ownerUserId: 7 }, {}],
          deadlineMs: Date.now() + 1_000,
          handle: registrations.tools[0]?.actionHandle ?? "missing",
          label: "bytes action",
        }),
      ).resolves.toEqual({
        buffer: [9, 8, 7],
        typed: [99, 2],
        typedAgain: [1, 2],
      });
      expect(Array.from(hostTypedBytes)).toEqual([0, 1, 2, 255]);
    } finally {
      runtime.dispose();
    }
  });

  it("dispatches metidos.lancedb through the host API without exposing host paths", async () => {
    const pluginRoot = createTempDirectory("metidos-plugin-quickjs-lancedb-");
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "lancedb",
            name: "LanceDB",
            description: "Exercise LanceDB APIs.",
            timeoutMs: 5000,
            validateProps(props) { return props; },
            async action() {
              const db = await metidos.lancedb.open("~/vectors");
              const upsert = await db.upsert([{ id: 1, vector: [1, 0], title: "alpha" }]);
              const rows = await db.query([1, 0]);
              const remove = await db.remove(1);
              return { path: db.path, remove, rows, upsert };
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const seenRequests: unknown[] = [];
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: {
        lancedb: async (operation, request) => {
          seenRequests.push({ operation, request });
          if (operation === "lancedb.query") {
            return [{ id: 1, props: { title: "alpha" }, score: 1 }];
          }
          if (operation === "lancedb.delete") {
            return { deleted: true, id: 1 };
          }
          return { count: 1, ids: [1] };
        },
        permissions: ["metidos:lancedb", "storage:write"],
      },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        tools: Array<{ actionHandle: string }>;
      };
      await expect(
        runtime.invokeCallback({
          args: [{ contextKind: "threadTool", ownerUserId: 7 }, {}],
          deadlineMs: Date.now() + 1_000,
          handle: registrations.tools[0]?.actionHandle ?? "missing",
          label: "lancedb action",
        }),
      ).resolves.toEqual({
        path: "~/vectors",
        remove: { deleted: true, id: 1 },
        rows: [{ id: 1, props: { title: "alpha" }, score: 1 }],
        upsert: { count: 1, ids: [1] },
      });
      expect(seenRequests).toEqual([
        {
          operation: "lancedb.upsert",
          request: {
            context: { contextKind: "threadTool", ownerUserId: 7 },
            deadlineMs: expect.any(Number),
            params: {
              path: "~/vectors",
              rows: [{ id: 1, title: "alpha", vector: [1, 0] }],
            },
          },
        },
        {
          operation: "lancedb.query",
          request: {
            context: { contextKind: "threadTool", ownerUserId: 7 },
            deadlineMs: expect.any(Number),
            params: { path: "~/vectors", vector: [1, 0] },
          },
        },
        {
          operation: "lancedb.delete",
          request: {
            context: { contextKind: "threadTool", ownerUserId: 7 },
            deadlineMs: expect.any(Number),
            params: { id: 1, path: "~/vectors" },
          },
        },
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("dispatches metidos.sqlite through the host API without exposing host paths", async () => {
    const pluginRoot = createTempDirectory("metidos-plugin-quickjs-sqlite-");
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "sqlite",
            name: "SQLite",
            description: "Exercise SQLite APIs.",
            timeoutMs: 5000,
            validateProps(props) { return props; },
            async action() {
              const db = metidos.sqlite("~/state.sqlite");
              const run = await db.run("insert into notes (title) values (?)", ["hello"]);
              const rows = await db.all("select title from notes order by id");
              const first = await db.get("select title from notes where id = ?", [1]);
              return { first, path: db.path, rows, run, queryType: typeof db.query, close: await db.close() };
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const seenRequests: unknown[] = [];
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: {
        permissions: ["sqlite", "storage:write"],
        sqlite: async (operation, request) => {
          seenRequests.push({ operation, request });
          if (operation === "sqlite.run") {
            return { changes: 1, lastInsertRowid: 1 };
          }
          if (operation === "sqlite.get") {
            return { row: { title: "hello" } };
          }
          return { rows: [{ title: "hello" }] };
        },
      },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        tools: Array<{ actionHandle: string }>;
      };
      await expect(
        runtime.invokeCallback({
          args: [{ contextKind: "threadTool", ownerUserId: 7 }, {}],
          deadlineMs: Date.now() + 1_000,
          handle: registrations.tools[0]?.actionHandle ?? "missing",
          label: "sqlite action",
        }),
      ).resolves.toEqual({
        close: { success: true },
        first: { title: "hello" },
        path: "~/state.sqlite",
        queryType: "function",
        rows: [{ title: "hello" }],
        run: { changes: 1, lastInsertRowid: 1 },
      });
      expect(seenRequests).toEqual([
        {
          operation: "sqlite.run",
          request: {
            context: { contextKind: "threadTool", ownerUserId: 7 },
            deadlineMs: expect.any(Number),
            params: {
              bindings: ["hello"],
              path: "~/state.sqlite",
              statement: "insert into notes (title) values (?)",
            },
          },
        },
        {
          operation: "sqlite.all",
          request: {
            context: { contextKind: "threadTool", ownerUserId: 7 },
            deadlineMs: expect.any(Number),
            params: {
              path: "~/state.sqlite",
              statement: "select title from notes order by id",
            },
          },
        },
        {
          operation: "sqlite.get",
          request: {
            context: { contextKind: "threadTool", ownerUserId: 7 },
            deadlineMs: expect.any(Number),
            params: {
              bindings: [1],
              path: "~/state.sqlite",
              statement: "select title from notes where id = ?",
            },
          },
        },
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("collects permissioned cron registrations during initialization", async () => {
    const pluginRoot = createTempDirectory("metidos-plugin-quickjs-cron-");
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.cron({
            key: "refresh_models",
            schedule: "*/5 * * * *",
            timeoutMs: 5000,
            action(context) {
              return { contextKind: context.contextKind, refreshed: true };
            },
          });
          metidos.cron({
            key: "daily_digest",
            schedule: "0 6 * * *",
            timeoutMs: 5000,
            action(context) {
              return {
                contextKind: context.contextKind,
                ownerUserId: context.ownerUserId,
                feeds: metidos.settings.get("feeds"),
              };
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: {
        permissions: ["cron:create"],
        settings: {
          missingRequiredKeys: [],
          values: { feeds: ["https://example.test/rss"] },
        },
      },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        crons: Array<{
          actionHandle: string;
          key: string;
          schedule: string;
          timeoutMs: number;
        }>;
      };
      expect(registrations.crons).toEqual([
        {
          actionHandle: "cron:action:1",
          key: "refresh_models",
          schedule: "*/5 * * * *",
          timeoutMs: 5_000,
        },
        {
          actionHandle: "cron:action:2",
          key: "daily_digest",
          schedule: "0 6 * * *",
          timeoutMs: 5_000,
        },
      ]);
      await expect(
        runtime.invokeCallback({
          args: [{ contextKind: "cron" }],
          deadlineMs: Date.now() + 1_000,
          handle: registrations.crons[0]?.actionHandle ?? "missing",
          label: "cron action",
        }),
      ).resolves.toEqual({ contextKind: "cron", refreshed: true });
      await expect(
        runtime.invokeCallback({
          args: [
            {
              contextKind: "cron",
              ownerUserId: 7,
            },
          ],
          deadlineMs: Date.now() + 1_000,
          handle:
            registrations.crons.find((cron) => cron.key === "daily_digest")
              ?.actionHandle ?? "missing",
          label: "daily digest cron action",
        }),
      ).resolves.toEqual({
        contextKind: "cron",
        feeds: ["https://example.test/rss"],
        ownerUserId: 7,
      });
    } finally {
      runtime.dispose();
    }
  });

  it("rejects cron registration without permission, valid fields, or initialization context", async () => {
    await expect(
      buildAndRunPlugin(
        `
          import { definePlugin } from "@metidos/plugin-api";
          export default definePlugin((metidos) => {
            metidos.cron({
              key: "refresh_models",
              schedule: "*/5 * * * *",
              timeoutMs: 5000,
              action() {},
            });
          });
        `,
        { pluginApi: { permissions: [] } },
      ),
    ).rejects.toThrow("metidos.cron requires cron:create.");

    await expect(
      buildAndRunPlugin(
        `
          import { definePlugin } from "@metidos/plugin-api";
          export default definePlugin((metidos) => {
            for (let index = 0; index < 11; index += 1) {
              metidos.cron({
                key: "job_" + index,
                schedule: "*/5 * * * *",
                timeoutMs: 5000,
                action() {},
              });
            }
          });
        `,
        { pluginApi: { permissions: ["cron:create"] } },
      ),
    ).rejects.toThrow("metidos.cron supports at most 10 crons per plugin.");

    await expect(
      buildAndRunPlugin(
        `
          import { definePlugin } from "@metidos/plugin-api";
          export default definePlugin((metidos) => {
            metidos.cron({
              key: "refresh_models",
              schedule: "*/5 * * * *",
              timeoutMs: 999,
              action() {},
            });
          });
        `,
        { pluginApi: { permissions: ["cron:create"] } },
      ),
    ).rejects.toThrow(
      "metidos.cron registration.timeoutMs must be an integer between 1000 and 600000.",
    );

    const pluginRoot = createTempDirectory(
      "metidos-plugin-quickjs-cron-context-",
    );
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "bad_cron",
            name: "Bad cron",
            description: "Register late.",
            timeoutMs: 5000,
            validateProps(props) { return props; },
            action() {
              try {
                metidos.cron({
                  key: "late",
                  schedule: "*/5 * * * *",
                  timeoutMs: 5000,
                  action() {},
                });
                return { errorName: "none" };
              } catch (error) {
                return { errorCode: error.code, errorName: error.name };
              }
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: { permissions: ["cron:create"] },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        tools: Array<{ actionHandle: string }>;
      };
      await expect(
        runtime.invokeCallback({
          args: [{ contextKind: "threadTool" }, {}],
          deadlineMs: Date.now() + 1_000,
          handle: registrations.tools[0]?.actionHandle ?? "missing",
          label: "bad cron action",
        }),
      ).resolves.toEqual({
        errorCode: "plugin_context_error",
        errorName: "PluginContextError",
      });
    } finally {
      runtime.dispose();
    }
  });

  it("allows cron callbacks to use storage and network while denying terminal and confirmations", async () => {
    const server = Bun.serve({
      fetch: () => Response.json({ status: "fresh" }),
      port: 0,
    });
    testServers.push(server);
    const url = `http://localhost:${server.port}/cron-status`;
    const pluginRoot = createTempDirectory("metidos-plugin-quickjs-cron-apis-");
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.cron({
            key: "sync",
            schedule: "*/5 * * * *",
            timeoutMs: 5000,
            async action() {
              const response = await metidos.fetch(${JSON.stringify(url)});
              const db = metidos.sqlite("~/cron.sqlite");
              const storage = await db.run("insert into runs (status) values (?)", ["fresh"]);
              let terminalError = null;
              try {
                await metidos.terminal.read({ terminalIndex: 0 });
              } catch (error) {
                terminalError = { code: error.code, name: error.name };
              }
              let confirmationError = null;
              try {
                await metidos.events.delete({ eventId: 7, confirmation: true });
              } catch (error) {
                confirmationError = { code: error.code, name: error.name };
              }
              return {
                body: await response.json(),
                confirmationError,
                storage,
                terminalError,
              };
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const sqliteRequests: unknown[] = [];
    const terminalRequests: unknown[] = [];
    const calendarEventsRequests: unknown[] = [];
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: {
        calendarEvents: async (operation, request) => {
          calendarEventsRequests.push({ operation, request });
          const requestContext =
            request && typeof request === "object" && "context" in request
              ? (request as { context?: Record<string, unknown> | null })
                  .context
              : null;
          return await executePluginCalendarEventsOperation({
            context: requestContext as never,
            host: {
              createCalendar: async () => ({}) as never,
              createEvent: async () => ({}) as never,
              deleteCalendar: async () => ({ calendarId: 1, success: true }),
              deleteEvent: async () => ({ eventId: 7, success: true }),
              getEvent: async () => null,
              listCalendars: async () => [],
              listEvents: async () => [],
              updateCalendar: async () => ({}) as never,
              updateEvent: async () => ({}) as never,
            },
            operation,
            params:
              request && typeof request === "object" && "params" in request
                ? (request as { params?: unknown }).params
                : undefined,
            permissions: ["events:delete"],
          });
        },
        network: { allow: [url], enforceHttps: false },
        unsafeAllowPrivateNetwork: true,
        permissions: [
          "cron:create",
          "events:delete",
          "network:fetch",
          "sqlite",
          "storage:write",
          "terminal:read",
        ],
        sqlite: async (operation, request) => {
          sqliteRequests.push({ operation, request });
          return { changes: 1, lastInsertRowid: 99 };
        },
        terminal: async (operation, request) => {
          terminalRequests.push({ operation, request });
          const requestContext =
            request && typeof request === "object" && "context" in request
              ? (request as { context?: Record<string, unknown> | null })
                  .context
              : null;
          return await executePluginTerminalOperation({
            context: requestContext as never,
            host: {
              createTerminal: async () => {
                throw new Error("cron terminal create should be unavailable");
              },
              grepTerminal: async () => "",
              killTerminal: async () => {},
              readTerminal: async () => "",
            },
            operation,
            params:
              request && typeof request === "object" && "params" in request
                ? (request as { params?: unknown }).params
                : undefined,
            permissions: ["terminal:read"],
          });
        },
      },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        crons: Array<{ actionHandle: string }>;
      };
      await expect(
        runtime.invokeCallback({
          args: [{ contextKind: "cron", ownerUserId: null }],
          deadlineMs: Date.now() + 1_000,
          handle: registrations.crons[0]?.actionHandle ?? "missing",
          label: "cron action",
        }),
      ).resolves.toEqual({
        body: { status: "fresh" },
        confirmationError: {
          code: "plugin_confirmation_unavailable",
          name: "PluginContextError",
        },
        storage: { changes: 1, lastInsertRowid: 99 },
        terminalError: {
          code: "plugin_terminal_unavailable_in_cron",
          name: "PluginContextError",
        },
      });
      expect(sqliteRequests).toEqual([
        {
          operation: "sqlite.run",
          request: {
            context: { contextKind: "cron", ownerUserId: null },
            deadlineMs: expect.any(Number),
            params: {
              bindings: ["fresh"],
              path: "~/cron.sqlite",
              statement: "insert into runs (status) values (?)",
            },
          },
        },
      ]);
      expect(terminalRequests).toEqual([
        {
          operation: "terminal.read",
          request: {
            context: { contextKind: "cron", ownerUserId: null },
            deadlineMs: expect.any(Number),
            params: { terminalIndex: 0 },
          },
        },
      ]);
      expect(calendarEventsRequests).toEqual([
        {
          operation: "events.delete",
          request: {
            context: { contextKind: "cron", ownerUserId: null },
            deadlineMs: expect.any(Number),
            params: { confirmation: true, eventId: 7 },
          },
        },
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("collects permissioned model provider registrations without invoking discovery during startup", async () => {
    const result = await buildAndRunPlugin(
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.providers.addProvider({
            id: "ollama",
            refreshIntervalMs: 60000,
            timeoutMs: 5000,
            async getProviderConfigurations() {
              return [
                {
                  id: "local",
                  api: "openai-chat-completions",
                  baseUrl: "http://localhost:11434/v1",
                  models: [{ id: "llama3.2", name: "Llama 3.2" }],
                },
                {
                  id: "lab",
                  api: "openai-chat-completions",
                  baseUrl: "http://lab.example.test:11434/v1",
                  models: [],
                },
              ];
            },
          });
        });
      `,
      { pluginApi: { permissions: ["provider:register"] } },
    );

    expect(result.setupResult).toEqual({
      modelProviders: [
        {
          configurations: [],
          getProviderConfigurationsHandle:
            "modelProvider:getProviderConfigurations:1",
          id: "ollama",
          refreshIntervalMs: 60_000,
          timeoutMs: 5_000,
        },
      ],
      tools: [],
    });
  });

  it("runs model provider execute callbacks with general settings", async () => {
    const pluginRoot = createTempDirectory(
      "metidos-plugin-quickjs-model-provider-execute-",
    );
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.providers.addProvider({
            id: "ollama",
            timeoutMs: 5000,
            getProviderConfigurations() {
              return [{ id: "local", models: [{ id: "llama3.2", name: "Llama 3.2" }] }];
            },
            execute(_context, request) {
              return {
                text: metidos.settings.get("mode") + ":" + request.model.id,
              };
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: {
        permissions: ["provider:register"],
        settings: { missingRequiredKeys: [], values: { mode: "verbose" } },
      },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        modelProviders: Array<{ executeHandle: string }>;
      };
      expect(registrations.modelProviders[0]?.executeHandle).toBe(
        "modelProvider:execute:2",
      );
      await expect(
        runtime.invokeCallback({
          args: [
            {
              contextKind: "providerExecution",
            },
            { model: { id: "llama3.2" } },
          ],
          deadlineMs: Date.now() + 1_000,
          handle: registrations.modelProviders[0]?.executeHandle ?? "missing",
          label: "model provider execute",
        }),
      ).resolves.toEqual({ text: "verbose:llama3.2" });
    } finally {
      runtime.dispose();
    }
  });

  it("rejects model provider registration without permission, startup context, or limits", async () => {
    await expect(
      buildAndRunPlugin(
        `
          import { definePlugin } from "@metidos/plugin-api";
          export default definePlugin((metidos) => {
            metidos.providers.addProvider({
              id: "ollama",
              timeoutMs: 5000,
              getProviderConfigurations() { return []; },
            });
          });
        `,
        { pluginApi: { permissions: [] } },
      ),
    ).rejects.toThrow(
      "metidos.providers.addProvider requires provider:register.",
    );

    await expect(
      buildAndRunPlugin(
        `
          import { definePlugin } from "@metidos/plugin-api";
          export default definePlugin((metidos) => {
            for (let index = 0; index < 11; index += 1) {
              metidos.providers.addProvider({
                id: "provider_" + index,
                timeoutMs: 5000,
                getProviderConfigurations() { return []; },
              });
            }
          });
        `,
        { pluginApi: { permissions: ["provider:register"] } },
      ),
    ).rejects.toThrow(
      "metidos.providers.addProvider supports at most 10 provider families per plugin.",
    );

    await expect(
      buildAndRunPlugin(
        `
          import { definePlugin } from "@metidos/plugin-api";
          export default definePlugin((metidos) => {
            metidos.providers.addProvider({
              id: "ollama",
              timeoutMs: 5000,
              configurations: Array.from({ length: 26 }, (_value, index) => ({
                id: "config_" + index,
              })),
              getProviderConfigurations() {
                return [];
              },
            });
          });
        `,
        { pluginApi: { permissions: ["provider:register"] } },
      ),
    ).rejects.toThrow(
      "metidos.providers.addProvider supports at most 25 provider configurations per plugin.",
    );

    const pluginRoot = createTempDirectory(
      "metidos-plugin-quickjs-model-provider-context-",
    );
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "bad_model_provider",
            name: "Bad model provider",
            description: "Register late.",
            timeoutMs: 5000,
            validateProps(props) { return props; },
            action() {
              try {
                metidos.providers.addProvider({
                  id: "late",
                  timeoutMs: 5000,
                  getProviderConfigurations() { return []; },
                });
                return { errorName: "none" };
              } catch (error) {
                return { errorCode: error.code, errorName: error.name };
              }
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: { permissions: ["provider:register"] },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        tools: Array<{ actionHandle: string }>;
      };
      await expect(
        runtime.invokeCallback({
          args: [{ contextKind: "threadTool" }, {}],
          deadlineMs: Date.now() + 1_000,
          handle: registrations.tools[0]?.actionHandle ?? "missing",
          label: "bad model provider action",
        }),
      ).resolves.toEqual({
        errorCode: "plugin_context_error",
        errorName: "PluginContextError",
      });
    } finally {
      runtime.dispose();
    }
  });

  it("collects permissioned notification provider registrations during initialization", async () => {
    const pluginRoot = createTempDirectory("metidos-plugin-quickjs-provider-");
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.notifications.addProvider({
            id: "ntfy",
            timeoutMs: 5000,
            send(request) {
              return {
                receipts: [{ message: request.title, status: "delivered" }],
              };
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: { permissions: ["notification:provider"] },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        notificationProviders: Array<{
          id: string;
          sendHandle: string;
          timeoutMs: number;
        }>;
      };
      expect(registrations.notificationProviders).toEqual([
        {
          id: "ntfy",
          sendHandle: "notificationProvider:send:1",
          timeoutMs: 5_000,
        },
      ]);
      await expect(
        runtime.invokeCallback({
          args: [{ title: "Build done" }],
          deadlineMs: Date.now() + 1_000,
          handle:
            registrations.notificationProviders[0]?.sendHandle ?? "missing",
          label: "notification provider send",
        }),
      ).resolves.toEqual({
        receipts: [{ message: "Build done", status: "delivered" }],
      });
    } finally {
      runtime.dispose();
    }
  });

  it("rejects notification provider registration without permission, valid timeout, or initialization context", async () => {
    await expect(
      buildAndRunPlugin(
        `
          import { definePlugin } from "@metidos/plugin-api";
          export default definePlugin((metidos) => {
            metidos.notifications.addProvider({
              id: "ntfy",
              timeoutMs: 5000,
              send() { return { receipts: [] }; },
            });
          });
        `,
        { pluginApi: { permissions: [] } },
      ),
    ).rejects.toThrow(
      "metidos.notifications.addProvider requires notification:provider.",
    );

    await expect(
      buildAndRunPlugin(
        `
          import { definePlugin } from "@metidos/plugin-api";
          export default definePlugin((metidos) => {
            for (let index = 0; index < 11; index += 1) {
              metidos.notifications.addProvider({
                id: "ntfy_" + index,
                timeoutMs: 5000,
                send() { return { receipts: [] }; },
              });
            }
          });
        `,
        { pluginApi: { permissions: ["notification:provider"] } },
      ),
    ).rejects.toThrow(
      "metidos.notifications.addProvider supports at most 10 providers per plugin.",
    );

    await expect(
      buildAndRunPlugin(
        `
          import { definePlugin } from "@metidos/plugin-api";
          export default definePlugin((metidos) => {
            metidos.notifications.addProvider({
              id: "ntfy",
              timeoutMs: 999,
              send() { return { receipts: [] }; },
            });
          });
        `,
        { pluginApi: { permissions: ["notification:provider"] } },
      ),
    ).rejects.toThrow(
      "metidos.notifications.addProvider registration.timeoutMs must be an integer between 1000 and 600000.",
    );

    const pluginRoot = createTempDirectory(
      "metidos-plugin-quickjs-provider-context-",
    );
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "bad_provider",
            name: "Bad provider",
            description: "Register late.",
            timeoutMs: 5000,
            validateProps(props) { return props; },
            action() {
              try {
                metidos.notifications.addProvider({
                  id: "late",
                  timeoutMs: 5000,
                  send() { return { receipts: [] }; },
                });
                return { errorName: "none" };
              } catch (error) {
                return { errorCode: error.code, errorName: error.name };
              }
            },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: { permissions: ["notification:provider"] },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        tools: Array<{ actionHandle: string }>;
      };
      await expect(
        runtime.invokeCallback({
          args: [{ contextKind: "threadTool" }, {}],
          deadlineMs: Date.now() + 1_000,
          handle: registrations.tools[0]?.actionHandle ?? "missing",
          label: "bad provider action",
        }),
      ).resolves.toEqual({
        errorCode: "plugin_context_error",
        errorName: "PluginContextError",
      });
    } finally {
      runtime.dispose();
    }
  });

  it("rejects notification provider callbacks that do not return receipts", async () => {
    const pluginRoot = createTempDirectory(
      "metidos-plugin-quickjs-provider-receipts-",
    );
    writePluginFile(
      pluginRoot,
      "index.ts",
      `
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.notifications.addProvider({
            id: "ntfy",
            timeoutMs: 5000,
            send() { return { ok: true }; },
          });
        });
      `,
    );
    const buildResult = await buildPluginEntrypoint({ pluginRoot });
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: { permissions: ["notification:provider"] },
      startupTimeoutMs: 1_000,
    });
    try {
      const registrations = runtime.setupResult as {
        notificationProviders: Array<{ sendHandle: string }>;
      };
      await expect(
        runtime.invokeCallback({
          args: [{}],
          deadlineMs: Date.now() + 1_000,
          handle:
            registrations.notificationProviders[0]?.sendHandle ?? "missing",
          label: "notification provider send",
        }),
      ).rejects.toThrow("must return an object with a receipts array");
    } finally {
      runtime.dispose();
    }
  });

  it("rejects invalid agent tool setup registrations before startup succeeds", async () => {
    await expect(
      buildAndRunPlugin(`
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "bad_tool",
            name: "Bad tool",
            description: "Missing callback.",
            timeoutMs: 5000,
            validateProps(props) {
              return props;
            },
          });
        });
      `),
    ).rejects.toThrow(
      "metidos.addAgentTool registration.action must be a function.",
    );

    await expect(
      buildAndRunPlugin(`
        import { definePlugin } from "@metidos/plugin-api";
        export default definePlugin((metidos) => {
          metidos.addAgentTool({
            tool: "bad_tool",
            name: "Bad tool",
            description: "Bad timeout.",
            timeoutMs: 999,
            validateProps(props) {
              return props;
            },
            action() {
              return null;
            },
          });
        });
      `),
    ).rejects.toThrow(
      "metidos.addAgentTool registration.timeoutMs must be an integer between 1000 and 600000.",
    );
  });
});
