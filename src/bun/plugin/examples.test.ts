/**
 * @file src/bun/plugin/examples.test.ts
 * @description Validation coverage for copyable Plugin System v1 example folders.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import Ajv, { type AnySchema, type ValidateFunction } from "ajv";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import type { PluginNotificationSendResult } from "./notifications";
import { startPluginRuntime } from "./plugin-runtime";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

type ExamplePlugin = {
  expectedCrons?: string[];
  expectedModelProviders?: string[];
  expectedNotificationProviders?: string[];
  expectedTools?: string[];
  id: string;
  path: string;
};

type SetupToolRegistration = {
  actionHandle: string;
  description: string;
  name: string;
  timeoutMs: number;
  tool: string;
  validatePropsHandle: string;
};

type SetupCronRegistration = {
  actionHandle: string;
  key: string;
};

type SetupModelProviderRegistration = {
  configurations: Array<{ id: string; models?: Array<{ id?: string }> }>;
  id: string;
};

type SetupNotificationProviderRegistration = {
  id: string;
  sendHandle: string;
};

type SetupResult = {
  crons?: SetupCronRegistration[];
  modelProviders?: SetupModelProviderRegistration[];
  notificationProviders?: SetupNotificationProviderRegistration[];
  tools: SetupToolRegistration[];
};

const SCHEMA_PATH = join("docs", "metidos-plugin.schema.json");

const COPYABLE_EXAMPLES: ExamplePlugin[] = [
  {
    expectedCrons: ["send_digest"],
    id: "cron_notification_digest",
    path: join("docs", "examples", "plugins", "cron_notification_digest"),
  },
  {
    expectedTools: ["hello_world"],
    id: "hello_tool",
    path: join("docs", "examples", "plugins", "hello_tool"),
  },
  {
    expectedNotificationProviders: ["ntfy"],
    id: "ntfy_notification_provider",
    path: join("docs", "examples", "plugins", "ntfy_notification_provider"),
  },
  {
    expectedModelProviders: ["ollama"],
    id: "ollama_model_provider",
    path: join("docs", "examples", "plugins", "ollama_model_provider"),
  },
  {
    expectedTools: ["python_hello_world"],
    id: "python_hello_tool",
    path: join("docs", "examples", "plugins", "python_hello_tool"),
  },
  {
    expectedCrons: ["refresh_feeds"],
    expectedTools: ["rss_query"],
    id: "rss_feed_indexer",
    path: join("docs", "examples", "plugins", "rss_feed_indexer"),
  },
];

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function readManifest(example: ExamplePlugin): Record<string, unknown> {
  return readJsonFile(join(example.path, "metidos-plugin.json")) as Record<
    string,
    unknown
  >;
}

function buildSchemaValidator(): ValidateFunction {
  const schema = readJsonFile(SCHEMA_PATH);
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema as AnySchema);
}

function expectSchemaAccepts(
  validateManifest: ValidateFunction,
  manifest: Record<string, unknown>,
): void {
  if (!validateManifest(manifest)) {
    throw new Error(
      `Expected example manifest to match ${SCHEMA_PATH}: ${JSON.stringify(validateManifest.errors, null, 2)}`,
    );
  }
}

function parseExampleManifest(
  example: ExamplePlugin,
): RpcPluginInventoryPlugin["manifest"] {
  const manifestPath = join(example.path, "metidos-plugin.json");
  const result = parsePluginManifest(
    JSON.stringify(readManifest(example)),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error(`Expected ${manifestPath} to parse into a typed manifest.`);
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

function setupResult(value: unknown): SetupResult {
  expect(value).toEqual(
    expect.objectContaining({
      tools: expect.any(Array),
    }),
  );
  return value as SetupResult;
}

function manifestPermissions(manifest: Record<string, unknown>): string[] {
  return Array.isArray(manifest.permissions)
    ? manifest.permissions.filter(
        (permission): permission is string => typeof permission === "string",
      )
    : [];
}

function expectReferencedMarkdownLinksExist(path: string): void {
  const markdown = readFileSync(path, "utf8");
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(linkPattern)) {
    const rawTarget = match[1];
    if (!rawTarget) {
      continue;
    }
    const [target] = rawTarget.split("#");
    if (
      !target ||
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("mailto:")
    ) {
      continue;
    }
    const resolved = normalize(join(dirname(path), target));
    expect(
      existsSync(resolved),
      `${path} references missing Markdown link target ${target}`,
    ).toBe(true);
  }
}

describe("Plugin System v1 copyable examples", () => {
  it("keeps copyable example manifests valid", () => {
    const validateManifest = buildSchemaValidator();

    for (const example of COPYABLE_EXAMPLES) {
      const manifest = readManifest(example);
      expect(manifest.id).toBe(example.id);
      expectSchemaAccepts(validateManifest, manifest);
      expect(
        parsePluginManifest(
          JSON.stringify(manifest),
          join(example.path, "metidos-plugin.json"),
        ).issues,
      ).toEqual([]);
    }
  });

  it("builds and activates copyable example entrypoints", async () => {
    for (const example of COPYABLE_EXAMPLES) {
      const manifest = readManifest(example);
      const buildResult = await buildPluginEntrypoint({
        pluginRoot: example.path,
      });
      const runtime = await startPluginRuntime(buildResult, {
        pluginApi: {
          permissions: manifestPermissions(manifest),
        },
        startupTimeoutMs: 5000,
      });
      try {
        const setup = setupResult(runtime.setupResult);
        expect(setup.tools.map((tool) => tool.tool)).toEqual(
          example.expectedTools ?? [],
        );
        expect((setup.crons ?? []).map((cron) => cron.key)).toEqual(
          example.expectedCrons ?? [],
        );
        expect(
          (setup.modelProviders ?? []).map((provider) => provider.id),
        ).toEqual(example.expectedModelProviders ?? []);
        expect(
          (setup.notificationProviders ?? []).map((provider) => provider.id),
        ).toEqual(example.expectedNotificationProviders ?? []);
        expect(() =>
          validatePluginStartupRegistrations(setup, {
            manifest: parseExampleManifest(example),
            pluginId: example.id,
          } as RpcPluginInventoryPlugin),
        ).not.toThrow();
      } finally {
        runtime.dispose();
      }
    }
  });

  it("runs the hello-world tool callback with a markdown result", async () => {
    const example = COPYABLE_EXAMPLES.find(
      (candidate) => candidate.id === "hello_tool",
    );
    if (!example) {
      throw new Error("Missing hello_tool example fixture.");
    }
    const buildResult = await buildPluginEntrypoint({
      pluginRoot: example.path,
    });
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      startupTimeoutMs: 1000,
    });
    try {
      const setup = setupResult(runtime.setupResult);
      const [tool] = setup.tools;
      expect(tool?.tool).toBe("hello_world");
      if (!tool) {
        throw new Error("hello_world registration was not returned.");
      }

      const validatedProps = await runtime.invokeCallback({
        args: [{ format: "markdown", name: "Metidos" }],
        deadlineMs: Date.now() + 1000,
        handle: tool.validatePropsHandle,
        label: "hello_world validateProps",
      });
      expect(validatedProps).toEqual({ format: "markdown", name: "Metidos" });

      const result = await runtime.invokeCallback({
        args: [
          {
            contextKind: "threadTool",
            ownerUserId: 1,
            projectId: 1,
            threadId: 1,
            worktreePath: process.cwd(),
          },
          validatedProps,
        ],
        deadlineMs: Date.now() + 1000,
        handle: tool.actionHandle,
        label: "hello_world action",
      });
      expect(result).toEqual({
        markdown:
          "## Hello, Metidos!\n\nThis response came from the copyable Hello Tool example plugin.",
        type: "markdown",
      });
    } finally {
      runtime.dispose();
    }
  });

  it("returns a failed ntfy provider receipt when no topic is configured", async () => {
    const example = COPYABLE_EXAMPLES.find(
      (candidate) => candidate.id === "ntfy_notification_provider",
    );
    if (!example) {
      throw new Error("Missing ntfy_notification_provider example fixture.");
    }
    const manifest = readManifest(example);
    const buildResult = await buildPluginEntrypoint({
      pluginRoot: example.path,
    });
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: {
        env: [
          { key: "NTFY_TOPIC", required: false, secret: true, value: null },
          { key: "NTFY_TOKEN", required: false, secret: true, value: null },
        ],
        permissions: manifestPermissions(manifest),
        settings: {
          missingRequiredKeys: [],
          values: { default_topic: null, server_url: "https://ntfy.sh" },
        },
      },
      startupTimeoutMs: 1000,
    });
    try {
      const setup = setupResult(runtime.setupResult);
      const [provider] = setup.notificationProviders ?? [];
      expect(provider?.id).toBe("ntfy");
      if (!provider) {
        throw new Error("ntfy provider registration was not returned.");
      }

      const result = await runtime.invokeCallback({
        args: [{ message: "Build finished.", title: "Build done" }],
        deadlineMs: Date.now() + 1000,
        handle: provider.sendHandle,
        label: "ntfy send",
      });
      expect(result).toEqual({
        receipts: [
          {
            code: "NTFY_TOPIC_MISSING",
            message:
              "Set NTFY_TOPIC or the plugin default_topic setting before sending.",
            status: "failed",
          },
        ],
      });
    } finally {
      runtime.dispose();
    }
  });

  it("runs the cron notification example through no-outlet and rate-limit receipts", async () => {
    const example = COPYABLE_EXAMPLES.find(
      (candidate) => candidate.id === "cron_notification_digest",
    );
    if (!example) {
      throw new Error("Missing cron_notification_digest example fixture.");
    }
    const manifest = readManifest(example);
    const sendResults: PluginNotificationSendResult[] = [
      {
        receipts: [
          {
            channel: "plugin",
            code: "NO_ENABLED_NOTIFICATION_OUTLETS",
            deliveryId: null,
            message:
              "No enabled notification outlets are configured for this cron context.",
            outlet: "plugin",
            status: "failed",
          },
        ],
      },
      {
        receipts: [
          {
            channel: "plugin",
            code: "RATE_LIMITED",
            deliveryId: null,
            message: "Plugin notification rate limit exceeded.",
            outlet: "plugin",
            retryAfter: 60,
            retryable: true,
            status: "failed",
          },
        ],
      },
    ];
    const notificationRequests: unknown[] = [];
    const logRequests: unknown[] = [];
    const buildResult = await buildPluginEntrypoint({
      pluginRoot: example.path,
    });
    const runtime = await startPluginQuickJsRuntime(buildResult, {
      pluginApi: {
        log: async (request) => {
          logRequests.push(request);
          return { ok: true };
        },
        permissions: manifestPermissions(manifest),
        sendNotification: async (request) => {
          notificationRequests.push(request);
          const result = sendResults.shift();
          if (!result) {
            throw new Error("Unexpected notification send.");
          }
          return result;
        },
        settings: {
          missingRequiredKeys: [],
          values: { enabled: true, title_prefix: "Metidos" },
        },
      },
      startupTimeoutMs: 1000,
    });
    try {
      const setup = setupResult(runtime.setupResult);
      const [cron] = setup.crons ?? [];
      expect(cron?.key).toBe("send_digest");
      if (!cron) {
        throw new Error("send_digest cron registration was not returned.");
      }

      await expect(
        runtime.invokeCallback({
          args: [{ contextKind: "cron", scheduledAt: "2026-04-28T00:00:00Z" }],
          deadlineMs: Date.now() + 1000,
          handle: cron.actionHandle,
          label: "send_digest cron no outlets",
        }),
      ).resolves.toEqual({
        receipts: [
          expect.objectContaining({
            code: "NO_ENABLED_NOTIFICATION_OUTLETS",
            status: "failed",
          }),
        ],
        status: "failed",
      });

      await expect(
        runtime.invokeCallback({
          args: [{ contextKind: "cron", scheduledAt: "2026-04-28T00:15:00Z" }],
          deadlineMs: Date.now() + 1000,
          handle: cron.actionHandle,
          label: "send_digest cron rate limited",
        }),
      ).resolves.toEqual({
        receipts: [
          expect.objectContaining({ code: "RATE_LIMITED", status: "failed" }),
        ],
        status: "failed",
      });

      expect(notificationRequests).toHaveLength(2);
      expect(notificationRequests[0]).toEqual(
        expect.objectContaining({
          body: expect.stringContaining("cron_notification_digest example ran"),
          context: expect.objectContaining({ contextKind: "cron" }),
          title: "Metidos cron digest",
        }),
      );
      expect(logRequests).toHaveLength(2);
    } finally {
      runtime.dispose();
    }
  });

  it("keeps authoring documentation links and example references current", () => {
    const docs = [
      "docs/metidos-plugin-authoring-guide.md",
      "docs/metidos-plugin-agents-guide.md",
      "docs/examples/plugins/README.md",
      ".pi/skills/metidos-plugin-authoring/SKILL.md",
    ];
    const docsWithCopyableExampleInventory = [
      "docs/metidos-plugin-authoring-guide.md",
      "docs/examples/plugins/README.md",
      ".pi/skills/metidos-plugin-authoring/SKILL.md",
    ];

    for (const path of docs) {
      expectReferencedMarkdownLinksExist(path);
    }
    for (const path of docsWithCopyableExampleInventory) {
      const text = readFileSync(path, "utf8");
      for (const example of COPYABLE_EXAMPLES) {
        expect(text).toContain(example.id);
      }
    }

    const authoringGuide = readFileSync(
      "docs/metidos-plugin-authoring-guide.md",
      "utf8",
    );
    const examplePermissions = new Set(
      COPYABLE_EXAMPLES.flatMap((example) =>
        manifestPermissions(readManifest(example)),
      ),
    );
    for (const permission of examplePermissions) {
      expect(authoringGuide).toContain(permission);
    }

    for (const example of COPYABLE_EXAMPLES) {
      const manifest = readManifest(example);
      const main = typeof manifest.main === "string" ? manifest.main : null;
      for (const fileName of [
        "AGENTS.md",
        "README.md",
        "metidos-plugin.json",
        ...(main ? [main.replace(/^\.\//, "")] : []),
      ]) {
        const filePath = join(example.path, fileName);
        expect(existsSync(filePath), `${filePath} should exist`).toBe(true);
        expect(
          statSync(filePath).isFile(),
          `${filePath} should be a file`,
        ).toBe(true);
      }
      expect(existsSync(join(example.path, "node_modules"))).toBe(false);
    }
  });

  it("documents multi-instance Ollama configuration in seed data", () => {
    const seed = JSON.parse(
      readFileSync(
        join(
          "docs",
          "examples",
          "plugins",
          "ollama_model_provider",
          "seed",
          "providers.json",
        ),
        "utf8",
      ),
    ) as {
      providers?: Array<{
        baseUrl?: string;
        discoverModels?: boolean;
        id?: string;
        models?: unknown[];
      }>;
    };

    expect(seed.providers?.map((provider) => provider.id)).toEqual([
      "local",
      "workstation",
    ]);
    expect(seed.providers?.map((provider) => provider.baseUrl)).toEqual([
      "http://localhost:11434",
      "http://127.0.0.1:11434",
    ]);
    expect(
      seed.providers?.every(
        (provider) =>
          provider.discoverModels === true ||
          (Array.isArray(provider.models) && provider.models.length > 0),
      ),
    ).toBe(true);
  });
});
